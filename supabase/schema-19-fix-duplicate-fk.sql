-- ============================================================
-- Schema 19 — Drop duplicate coffee_orders → orders FK
--
-- Problem: schema-16 added a named FK (fk_coffee_orders_order)
-- but the live DB already had an unnamed FK on the same column
-- (coffee_orders.order_id → orders.id), likely created by an
-- earlier migration or manual edit. PostgREST PGRST201 fires
-- when it finds more than one relationship for an embed.
--
-- Fix: drop the unnamed FK if it exists, keep only the named one.
-- The !order_id hint in KDS/manager queries handles it in the
-- meantime, but this cleans up the schema permanently.
--
-- Safe to run multiple times (DO block guards each DROP).
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Find all FK constraints on coffee_orders.order_id EXCEPT our named one.
  FOR r IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'coffee_orders'
      AND kcu.column_name = 'order_id'
      AND tc.constraint_name != 'fk_coffee_orders_order'
  LOOP
    EXECUTE format('ALTER TABLE coffee_orders DROP CONSTRAINT IF EXISTS %I', r.constraint_name);
    RAISE NOTICE 'Dropped duplicate FK: %', r.constraint_name;
  END LOOP;
END $$;
