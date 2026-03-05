-- Schema 92: Add 'rate_limit_triggered' to manager_override_log action types
-- and create an RPC for serverless functions to log rate-limit events.

-- ── 1. Expand the action_type CHECK constraint ──────────────────────────────
ALTER TABLE manager_override_log DROP CONSTRAINT IF EXISTS chk_override_action_type;
ALTER TABLE manager_override_log ADD CONSTRAINT chk_override_action_type
  CHECK (action_type IN (
    'comp_order', 'adjust_hours', 'fix_clock', 'void_order',
    'voucher_override', 'inventory_adjust', 'discount_override',
    'parcel_override', 'schedule_edit', 'pin_reset', 'role_change',
    'rate_limit_triggered'
  ));

-- ── 2. RPC: log_rate_limit_event ────────────────────────────────────────────
-- Callable by service_role only (RLS blocks anon/authenticated).
-- Accepts IP, source function name, and optional detail JSON.
CREATE OR REPLACE FUNCTION public.log_rate_limit_event(
  p_ip_address   text,
  p_source       text,
  p_details      jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO manager_override_log (
    action_type,
    manager_email,
    target_entity,
    details,
    ip_address
  ) VALUES (
    'rate_limit_triggered',
    'system',
    p_source,
    p_details,
    p_ip_address
  );
END;
$$;
