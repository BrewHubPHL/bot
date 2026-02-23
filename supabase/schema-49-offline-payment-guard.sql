-- ============================================================================
-- SCHEMA 49 — Offline Payment Guard (Ghost Revenue Defense)
-- ============================================================================
-- Fixes the "Square Offline Mode Trap" vulnerability:
--
--   When Comcast drops, baristas enable Square Terminal's built-in Offline
--   Mode and swipe cards without real-time authorization. When the batch
--   processes post-recovery, 30-40% of cards decline. The cafe eats $400+
--   in inventory losses with no way to trace or collect.
--
-- Defense layers:
--   1. Offline session tracking — every outage is a logged event
--   2. Cash-only exposure caps — hard limit on unverified revenue
--   3. Post-recovery reconciliation — aggressive decline detection
--   4. Loss ledger — every declined offline payment is tracked
--   5. Staff accountability — who was on shift during the outage
-- ============================================================================

-- ─── 1. Offline sessions ────────────────────────────────────────────────────
-- One row per outage. Opened when POS detects connectivity loss,
-- closed on recovery. Tracks running cash exposure against cap.

CREATE TABLE IF NOT EXISTS offline_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,                       -- NULL while still offline
  staff_email         text,                              -- who was on duty
  staff_name          text,
  -- Exposure tracking
  cash_orders_count   int NOT NULL DEFAULT 0,
  cash_total_cents    int NOT NULL DEFAULT 0,            -- running cash total
  cap_cents           int NOT NULL DEFAULT 20000,        -- $200.00 default cap
  cap_hit_at          timestamptz,                       -- when cap was reached
  cap_overridden_by   text,                              -- manager who approved override
  -- Post-recovery stats (filled during reconciliation)
  recovery_started_at timestamptz,
  decline_count       int DEFAULT 0,                     -- cards declined in batch
  decline_total_cents int DEFAULT 0,                     -- total $ lost to declines
  ghost_revenue_cents int DEFAULT 0,                     -- unrecoverable losses
  notes               text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_sessions_open
  ON offline_sessions(opened_at DESC) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_offline_sessions_recent
  ON offline_sessions(opened_at DESC);

ALTER TABLE offline_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public offline_sessions"
    ON offline_sessions FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read offline_sessions"
    ON offline_sessions FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE offline_sessions IS
  'Tracks every internet outage period. Cash exposure is capped per session to prevent Ghost Revenue losses from Square Offline Mode.';

-- ─── 2. Offline loss ledger ─────────────────────────────────────────────────
-- Every declined payment that we detect in the post-recovery batch.
-- These represent actual money lost — drinks given away for nothing.

CREATE TABLE IF NOT EXISTS offline_loss_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid REFERENCES offline_sessions(id),
  square_payment_id   text,                  -- Square payment ID (if available)
  square_checkout_id  text,                  -- Terminal checkout ID
  order_id            uuid,                  -- BrewHub order (if linked)
  amount_cents        int NOT NULL,          -- amount that was supposed to be paid
  decline_reason      text,                  -- 'insufficient_funds', 'card_expired', etc.
  card_last_four      text,                  -- for dispute tracking
  card_brand          text,                  -- VISA, MASTERCARD, etc.
  detected_at         timestamptz DEFAULT now(),
  recovered           boolean DEFAULT false, -- if we managed to collect later
  recovered_at        timestamptz,
  recovery_method     text,                  -- 'customer_returned', 'insurance', etc.
  staff_on_duty       text,                  -- who took the order
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_loss_session
  ON offline_loss_ledger(session_id);

CREATE INDEX IF NOT EXISTS idx_offline_loss_recent
  ON offline_loss_ledger(detected_at DESC);

ALTER TABLE offline_loss_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public offline_loss_ledger"
    ON offline_loss_ledger FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read offline_loss_ledger"
    ON offline_loss_ledger FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE offline_loss_ledger IS
  'Immutable record of every declined payment from Square Offline Mode batches. These are actual inventory losses.';

-- ─── 3. Offline policy configuration ────────────────────────────────────────
-- Singleton config row for offline caps and behavior.

CREATE TABLE IF NOT EXISTS offline_policy (
  id                        int PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  max_session_cash_cents    int NOT NULL DEFAULT 20000,   -- $200 per outage
  max_single_order_cents    int NOT NULL DEFAULT 2500,    -- $25 per offline order
  require_manager_override  boolean DEFAULT true,         -- require PIN to exceed cap
  auto_close_after_minutes  int DEFAULT 240,              -- auto-close session after 4h
  enable_terminal_lockout   boolean DEFAULT true,         -- show "do not use terminal" warning
  alert_manager_at_pct      int DEFAULT 75,               -- alert at 75% of cap
  updated_at                timestamptz DEFAULT now(),
  updated_by                text
);

-- Seed default policy
INSERT INTO offline_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE offline_policy ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public offline_policy"
    ON offline_policy FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read offline_policy"
    ON offline_policy FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 4. Open offline session RPC ────────────────────────────────────────────
-- Called by POS when connectivity is lost.

CREATE OR REPLACE FUNCTION open_offline_session(
  p_staff_email  text DEFAULT NULL,
  p_staff_name   text DEFAULT NULL
)
RETURNS TABLE(
  session_id     uuid,
  cap_cents      int,
  already_open   boolean
) AS $$
DECLARE
  v_existing  offline_sessions%ROWTYPE;
  v_new_id    uuid;
  v_cap       int;
BEGIN
  -- Check for already-open session
  SELECT * INTO v_existing
  FROM offline_sessions
  WHERE closed_at IS NULL
  ORDER BY opened_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.cap_cents, true;
    RETURN;
  END IF;

  -- Get cap from policy
  SELECT op.max_session_cash_cents INTO v_cap FROM offline_policy op WHERE op.id = 1;
  v_cap := COALESCE(v_cap, 20000);

  v_new_id := gen_random_uuid();
  INSERT INTO offline_sessions (id, staff_email, staff_name, cap_cents)
  VALUES (v_new_id, p_staff_email, p_staff_name, v_cap);

  RETURN QUERY SELECT v_new_id, v_cap, false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION open_offline_session(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION open_offline_session(text, text) TO service_role;

-- ─── 5. Record offline cash sale RPC ────────────────────────────────────────
-- Called for every cash order placed during an offline session.
-- Returns whether the sale is within cap.

CREATE OR REPLACE FUNCTION record_offline_sale(
  p_session_id    uuid,
  p_amount_cents  int,
  p_order_id      text DEFAULT NULL
)
RETURNS TABLE(
  allowed         boolean,
  new_total_cents int,
  remaining_cents int,
  cap_cents       int,
  pct_used        int
) AS $$
DECLARE
  v_session  offline_sessions%ROWTYPE;
  v_new_total int;
  v_policy   offline_policy%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM offline_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offline session % not found', p_session_id;
  END IF;

  IF v_session.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Offline session % is already closed', p_session_id;
  END IF;

  -- Check per-order cap
  SELECT * INTO v_policy FROM offline_policy WHERE id = 1;
  IF p_amount_cents > COALESCE(v_policy.max_single_order_cents, 2500) THEN
    RETURN QUERY SELECT
      false,
      v_session.cash_total_cents,
      GREATEST(0, v_session.cap_cents - v_session.cash_total_cents),
      v_session.cap_cents,
      CASE WHEN v_session.cap_cents > 0
        THEN LEAST(100, (v_session.cash_total_cents * 100) / v_session.cap_cents)
        ELSE 100
      END;
    RETURN;
  END IF;

  v_new_total := v_session.cash_total_cents + p_amount_cents;

  -- Check session cap
  IF v_new_total > v_session.cap_cents AND v_session.cap_overridden_by IS NULL THEN
    RETURN QUERY SELECT
      false,
      v_session.cash_total_cents,
      GREATEST(0, v_session.cap_cents - v_session.cash_total_cents),
      v_session.cap_cents,
      CASE WHEN v_session.cap_cents > 0
        THEN LEAST(100, (v_session.cash_total_cents * 100) / v_session.cap_cents)
        ELSE 100
      END;
    RETURN;
  END IF;

  -- Record the sale
  UPDATE offline_sessions SET
    cash_orders_count = cash_orders_count + 1,
    cash_total_cents = v_new_total,
    cap_hit_at = CASE
      WHEN v_new_total >= v_session.cap_cents AND cap_hit_at IS NULL
      THEN now()
      ELSE cap_hit_at
    END
  WHERE id = p_session_id;

  RETURN QUERY SELECT
    true,
    v_new_total,
    GREATEST(0, v_session.cap_cents - v_new_total),
    v_session.cap_cents,
    CASE WHEN v_session.cap_cents > 0
      THEN LEAST(100, (v_new_total * 100) / v_session.cap_cents)
      ELSE 100
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION record_offline_sale(uuid, int, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_offline_sale(uuid, int, text) TO service_role;

-- ─── 6. Close offline session RPC ──────────────────────────────────────────
-- Called when connectivity restores.

CREATE OR REPLACE FUNCTION close_offline_session(
  p_session_id uuid DEFAULT NULL
)
RETURNS TABLE(
  session_id        uuid,
  duration_minutes  int,
  cash_total_cents  int,
  orders_count      int
) AS $$
DECLARE
  v_session offline_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM offline_sessions WHERE id = p_session_id FOR UPDATE;
  ELSE
    SELECT * INTO v_session FROM offline_sessions
    WHERE closed_at IS NULL
    ORDER BY opened_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE offline_sessions SET
    closed_at = now(),
    recovery_started_at = now()
  WHERE id = v_session.id;

  RETURN QUERY SELECT
    v_session.id,
    EXTRACT(EPOCH FROM (now() - v_session.opened_at))::int / 60,
    v_session.cash_total_cents,
    v_session.cash_orders_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION close_offline_session(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION close_offline_session(uuid) TO service_role;

-- ─── 7. Override offline cap (manager-only) ─────────────────────────────────

CREATE OR REPLACE FUNCTION override_offline_cap(
  p_session_id      uuid,
  p_manager_email   text,
  p_new_cap_cents   int DEFAULT NULL  -- NULL = remove cap entirely
)
RETURNS TABLE(success boolean, new_cap_cents int) AS $$
BEGIN
  UPDATE offline_sessions SET
    cap_cents = COALESCE(p_new_cap_cents, 99999999),
    cap_overridden_by = p_manager_email
  WHERE id = p_session_id AND closed_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, COALESCE(p_new_cap_cents, 99999999);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION override_offline_cap(uuid, text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION override_offline_cap(uuid, text, int) TO service_role;

-- ─── 8. Record offline decline RPC ──────────────────────────────────────────
-- Called by square-webhook when a payment from an offline batch declines.

CREATE OR REPLACE FUNCTION record_offline_decline(
  p_square_payment_id   text,
  p_square_checkout_id  text DEFAULT NULL,
  p_order_id            uuid DEFAULT NULL,
  p_amount_cents        int DEFAULT 0,
  p_decline_reason      text DEFAULT 'unknown',
  p_card_last_four      text DEFAULT NULL,
  p_card_brand          text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_session_id uuid;
  v_loss_id    uuid;
BEGIN
  -- Find the most recent offline session that overlaps
  SELECT id INTO v_session_id
  FROM offline_sessions
  WHERE opened_at < now()
  ORDER BY opened_at DESC
  LIMIT 1;

  v_loss_id := gen_random_uuid();

  INSERT INTO offline_loss_ledger (
    id, session_id, square_payment_id, square_checkout_id,
    order_id, amount_cents, decline_reason,
    card_last_four, card_brand
  ) VALUES (
    v_loss_id, v_session_id, p_square_payment_id, p_square_checkout_id,
    p_order_id, p_amount_cents, p_decline_reason,
    p_card_last_four, p_card_brand
  );

  -- Update session totals
  IF v_session_id IS NOT NULL THEN
    UPDATE offline_sessions SET
      decline_count = decline_count + 1,
      decline_total_cents = decline_total_cents + p_amount_cents,
      ghost_revenue_cents = ghost_revenue_cents + p_amount_cents
    WHERE id = v_session_id;
  END IF;

  RETURN v_loss_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION record_offline_decline(text, text, uuid, int, text, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_offline_decline(text, text, uuid, int, text, text, text)
  TO service_role;

-- ─── 9. Get offline exposure stats RPC ──────────────────────────────────────
-- Dashboard stats for managers to see offline risk.

CREATE OR REPLACE FUNCTION get_offline_exposure_stats()
RETURNS TABLE(
  active_session_id       uuid,
  is_offline              boolean,
  current_cash_cents      int,
  current_cap_cents       int,
  current_pct_used        int,
  offline_since           timestamptz,
  total_losses_30d_cents  int,
  total_declines_30d      int,
  total_sessions_30d      int
) AS $$
DECLARE
  v_session offline_sessions%ROWTYPE;
BEGIN
  -- Active session check
  SELECT * INTO v_session
  FROM offline_sessions
  WHERE closed_at IS NULL
  ORDER BY opened_at DESC
  LIMIT 1;

  RETURN QUERY SELECT
    v_session.id,
    (v_session.id IS NOT NULL),
    COALESCE(v_session.cash_total_cents, 0),
    COALESCE(v_session.cap_cents, 20000),
    CASE WHEN COALESCE(v_session.cap_cents, 20000) > 0
      THEN LEAST(100, (COALESCE(v_session.cash_total_cents, 0) * 100) / COALESCE(v_session.cap_cents, 20000))
      ELSE 0
    END,
    v_session.opened_at,
    COALESCE((
      SELECT SUM(oll.amount_cents)
      FROM offline_loss_ledger oll
      WHERE oll.detected_at > now() - interval '30 days'
    ), 0)::int,
    COALESCE((
      SELECT COUNT(*)
      FROM offline_loss_ledger oll2
      WHERE oll2.detected_at > now() - interval '30 days'
    ), 0)::int,
    COALESCE((
      SELECT COUNT(*)
      FROM offline_sessions os2
      WHERE os2.opened_at > now() - interval '30 days'
    ), 0)::int;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION get_offline_exposure_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_offline_exposure_stats() TO service_role;

-- ─── 10. Add offline tracking columns to orders ─────────────────────────────
-- Flag orders created during offline sessions for post-recovery audit.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS offline_session_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_offline_order   boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_offline_session
  ON orders(offline_session_id) WHERE offline_session_id IS NOT NULL;

COMMENT ON COLUMN orders.offline_session_id IS
  'Links order to the offline_sessions row when it was created during an outage.';
COMMENT ON COLUMN orders.is_offline_order IS
  'True if this order was created while the POS was offline (cash-only).';
