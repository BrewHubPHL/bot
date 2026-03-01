-- schema-56: Auto-ban trigger — 5 guest orders from the same IP in 24 hours
-- Fires AFTER INSERT on orders. If a guest IP hash hits the threshold it is
-- automatically inserted into guest_order_denylist with a 24-hour expiry.
-- Staff can promote a temporary auto-ban to permanent by setting expires_at = NULL.

CREATE OR REPLACE FUNCTION fn_auto_ban_guest_ip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the table owner, not the calling role
AS $$
DECLARE
  v_order_count int;
  v_threshold   constant int  := 5;
  v_window      constant interval := interval '24 hours';
  v_ban_ttl     constant interval := interval '24 hours';
BEGIN
  -- Only act on guest orders with a known IP hash
  IF NEW.is_guest_order IS NOT TRUE OR NEW.client_ip_hash IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count orders from this hash within the rolling window (includes the new row)
  SELECT COUNT(*)
    INTO v_order_count
    FROM orders
   WHERE client_ip_hash = NEW.client_ip_hash
     AND is_guest_order = true
     AND created_at > (now() - v_window);

  IF v_order_count >= v_threshold THEN
    INSERT INTO guest_order_denylist (client_ip_hash, reason, created_by, expires_at)
    VALUES (
      NEW.client_ip_hash,
      format('Auto-banned: %s guest orders in 24 hours (triggered at order %s)',
             v_order_count, LEFT(NEW.id::text, 8)),
      'system/trigger',
      now() + v_ban_ttl
    )
    ON CONFLICT (client_ip_hash)
      -- If already on the denylist (manual or prior auto-ban), leave it untouched
      DO NOTHING;

    RAISE LOG '[auto_ban] ip_hash=% banned after % guest orders in 24h',
      LEFT(NEW.client_ip_hash, 12), v_order_count;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger — fires after every INSERT, before the transaction commits
CREATE TRIGGER trg_auto_ban_guest_ip
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_ban_guest_ip();

COMMENT ON FUNCTION fn_auto_ban_guest_ip() IS
  'Auto-bans guest IP hashes that place 5+ orders in a 24-hour window. '
  'Inserts a 24-hour temporary entry into guest_order_denylist. '
  'Staff can make it permanent by setting expires_at = NULL.';
