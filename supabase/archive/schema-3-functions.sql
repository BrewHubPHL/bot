-- ============================================================
-- BREWHUB SCHEMA PART 3: Functions & Triggers
-- ============================================================

-- Auto-create profiles row when user signs up (required for loyalty points)
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, loyalty_points, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;  -- Idempotent: skip if already exists
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users (Supabase built-in table)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Staff role change trigger
DROP FUNCTION IF EXISTS staff_role_change_invalidator() CASCADE;
CREATE OR REPLACE FUNCTION staff_role_change_invalidator()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.email IS DISTINCT FROM NEW.email THEN
    NEW.token_version := OLD.token_version + 1;
    NEW.version_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_role_change_trigger ON staff_directory;
CREATE TRIGGER staff_role_change_trigger
  BEFORE UPDATE ON staff_directory
  FOR EACH ROW EXECUTE FUNCTION staff_role_change_invalidator();

-- Order amount tampering prevention
DROP FUNCTION IF EXISTS prevent_order_amount_tampering() CASCADE;
CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.total_amount_cents IS NOT NULL AND NEW.total_amount_cents <> OLD.total_amount_cents THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_no_amount_tampering ON orders;
CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_order_amount_tampering();

-- Inventory functions
DROP FUNCTION IF EXISTS adjust_inventory_quantity(uuid, int);
CREATE OR REPLACE FUNCTION adjust_inventory_quantity(p_id uuid, p_delta int)
RETURNS void AS $$
  UPDATE inventory 
  SET current_stock = GREATEST(0, current_stock + p_delta),
      updated_at = now()
  WHERE id = p_id;
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_low_stock_items();
CREATE OR REPLACE FUNCTION get_low_stock_items()
RETURNS TABLE(item_name text, current_stock int, min_threshold int, unit text) AS $$
  SELECT item_name, current_stock, min_threshold, unit
  FROM inventory
  WHERE current_stock <= min_threshold;
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS decrement_inventory(text, int);
CREATE OR REPLACE FUNCTION decrement_inventory(p_item_name text, p_quantity int DEFAULT 1)
RETURNS void AS $$
  UPDATE inventory
  SET current_stock = GREATEST(0, current_stock - p_quantity),
      updated_at = now()
  WHERE item_name ILIKE p_item_name;
$$ LANGUAGE sql SECURITY DEFINER;

-- Order completion trigger for inventory decrement
DROP FUNCTION IF EXISTS handle_order_completion() CASCADE;
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_cup_count int;
BEGIN
  -- Only fire on completion, only once
  IF NEW.status = 'completed' 
     AND (OLD.status IS DISTINCT FROM 'completed') 
     AND NOT COALESCE(NEW.inventory_decremented, false) THEN
    
    -- Count drinks in this order
    SELECT COUNT(*)::int INTO v_cup_count
    FROM coffee_orders
    WHERE order_id = NEW.id;
    
    -- Decrement cups if any drinks
    IF v_cup_count > 0 THEN
      PERFORM decrement_inventory('12oz Cups', v_cup_count);
    END IF;
    
    -- Mark as processed to prevent double-decrement
    NEW.inventory_decremented := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_order_completion ON orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION handle_order_completion();

-- API Usage function
DROP FUNCTION IF EXISTS increment_api_usage(text);
CREATE OR REPLACE FUNCTION increment_api_usage(p_service text)
RETURNS boolean AS $$
DECLARE
  v_under_limit boolean;
BEGIN
  INSERT INTO api_usage (service_name, usage_date, call_count, daily_limit)
  VALUES (p_service, CURRENT_DATE, 1, 100)
  ON CONFLICT (service_name, usage_date) 
  DO UPDATE SET call_count = api_usage.call_count + 1;
  
  SELECT call_count <= daily_limit INTO v_under_limit
  FROM api_usage
  WHERE service_name = p_service AND usage_date = CURRENT_DATE;
  
  RETURN COALESCE(v_under_limit, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Notification queue functions
DROP FUNCTION IF EXISTS claim_notification_tasks(text, int);
CREATE OR REPLACE FUNCTION claim_notification_tasks(p_worker_id text, p_batch_size int DEFAULT 10)
RETURNS SETOF notification_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE notification_queue
  SET status = 'processing', locked_until = now() + interval '60 seconds',
      locked_by = p_worker_id, attempt_count = attempt_count + 1
  WHERE id IN (
    SELECT id FROM notification_queue
    WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT p_batch_size
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS complete_notification(uuid);
CREATE OR REPLACE FUNCTION complete_notification(p_task_id uuid)
RETURNS void AS $$
  UPDATE notification_queue SET status = 'completed', completed_at = now(),
    locked_until = NULL, locked_by = NULL WHERE id = p_task_id;
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS fail_notification(uuid, text);
CREATE OR REPLACE FUNCTION fail_notification(p_task_id uuid, p_error text)
RETURNS void AS $$
DECLARE
  v_attempts int; v_max int; v_backoff int;
BEGIN
  SELECT attempt_count, max_attempts INTO v_attempts, v_max FROM notification_queue WHERE id = p_task_id;
  v_backoff := POWER(2, LEAST(v_attempts, 4));
  IF v_attempts >= v_max THEN
    UPDATE notification_queue SET status = 'dead_letter', last_error = p_error, locked_until = NULL WHERE id = p_task_id;
  ELSE
    UPDATE notification_queue SET status = 'failed', next_attempt_at = now() + (v_backoff * interval '1 minute'),
      last_error = p_error, locked_until = NULL WHERE id = p_task_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tombstone check
DROP FUNCTION IF EXISTS is_tombstoned(text, text);
CREATE OR REPLACE FUNCTION is_tombstoned(p_table text, p_key text)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM deletion_tombstones WHERE table_name = p_table AND record_key = lower(p_key));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Session invalidation
DROP FUNCTION IF EXISTS invalidate_staff_sessions(text);
CREATE OR REPLACE FUNCTION invalidate_staff_sessions(p_email text)
RETURNS void AS $$
  UPDATE staff_directory SET token_version = token_version + 1, version_updated_at = now() WHERE lower(email) = lower(p_email);
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS invalidate_all_staff_sessions();
CREATE OR REPLACE FUNCTION invalidate_all_staff_sessions()
RETURNS int AS $$
DECLARE v_count int;
BEGIN
  UPDATE staff_directory SET token_version = token_version + 1, version_updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
