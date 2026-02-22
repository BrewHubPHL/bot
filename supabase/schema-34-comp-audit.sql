-- ============================================================
-- SCHEMA 34: Comp Audit Trail
--   Tracks every "comp" (complimentary) order with who did it,
--   when, how much, and why.  Provides manager visibility into
--   comps and enforces a dollar-cap for non-manager staff.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- TABLE: comp_audit
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS comp_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL,  -- FK to orders.id
  staff_id    uuid        NOT NULL,  -- FK to staff_directory.id
  staff_email text        NOT NULL,  -- denormalized for quick reads
  staff_role  text        NOT NULL,  -- role at time of comp (staff / manager / admin)
  amount_cents int        NOT NULL CHECK (amount_cents >= 0),
  reason      text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for dashboard queries (recent comps, comps by staff)
CREATE INDEX IF NOT EXISTS idx_comp_audit_created   ON comp_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comp_audit_staff     ON comp_audit (staff_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- RLS: deny-all by default, service_role bypasses
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE comp_audit ENABLE ROW LEVEL SECURITY;

-- Deny all for anon/authenticated (service_role inserts from Netlify functions)
CREATE POLICY comp_audit_deny_all ON comp_audit FOR ALL USING (false);

COMMENT ON TABLE comp_audit IS 'Audit trail for complimentary (comped) orders. Written by update-order-status.js.';
