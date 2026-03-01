-- ============================================================
-- SCHEMA 60: Payment Dead-Letter Queue + System Errors
--   IRS reconciliation safety net for orphan payments.
--   If Square captures a payment but the Supabase INSERT INTO orders
--   fails (timeout, network partition, disk full, etc.), the payment
--   is logged here so it can be reconciled with the Square dashboard.
--
-- Doomsday Scenario 5: THE PAPER TRAIL DISCREPANCY
--   Square shows $1,200 but Supabase shows $1,150 → the $50 orphan
--   payment is captured in this dead-letter queue for auditing.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- TABLE: system_errors
--   General-purpose error log for critical failures that require
--   human attention. Written by Netlify functions on unrecoverable
--   errors (DB insert failures after payment, webhook processing
--   errors, etc.).
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS system_errors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_type      text        NOT NULL,           -- 'orphan_payment', 'db_insert_failed', 'webhook_error', etc.
  severity        text        NOT NULL DEFAULT 'critical'
                              CHECK (severity IN ('critical', 'warning', 'info')),
  source_function text        NOT NULL,           -- 'cafe-checkout', 'square-webhook', etc.
  order_id        uuid,                           -- nullable — may not have an order yet
  payment_id      text,                           -- Square payment ID if applicable
  amount_cents    int,                            -- dollar amount at risk
  error_message   text        NOT NULL,           -- sanitized error description
  context         jsonb       DEFAULT '{}',       -- additional metadata (cart items, customer info, etc.)
  resolved        boolean     NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  resolved_by     text,                           -- manager email who resolved
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for dashboard queries and alerting
CREATE INDEX IF NOT EXISTS idx_system_errors_unresolved
  ON system_errors (created_at DESC) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_system_errors_type
  ON system_errors (error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_payment
  ON system_errors (payment_id) WHERE payment_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- RLS: deny-all writes, staff can read for dashboard
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE system_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "System errors deny writes" ON system_errors;
CREATE POLICY "System errors deny writes"
  ON system_errors FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Staff can read system errors" ON system_errors;
CREATE POLICY "Staff can read system errors"
  ON system_errors FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff_directory
    WHERE lower(email) = lower(auth.email())
  ));

COMMENT ON TABLE system_errors IS
  'Dead-letter queue for critical system failures. Captures orphan payments, '
  'failed DB inserts, and webhook errors requiring manual reconciliation. '
  'Doomsday Scenario 5: THE PAPER TRAIL DISCREPANCY.';
