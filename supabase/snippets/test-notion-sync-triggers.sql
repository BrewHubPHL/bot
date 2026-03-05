-- ============================================================================
-- TEST SCRIPT: Notion Sync Triggers
-- Run in Supabase SQL Editor to fire trg_manager_override_notion_sync
-- and trg_orders_notion_sync and verify they enqueue pg_net HTTP posts.
--
-- Pre-requisites:
--   • pg_net extension enabled
--   • app.settings.internal_sync_secret configured
--   • app.settings.notion_sync_webhook_url configured (or defaults to prod)
-- ============================================================================

-- ── 1. Manager Override Log — INSERT trigger test ────────────────────────
-- Inserts a clearly-labeled test row. The AFTER INSERT trigger
-- (trg_manager_override_notion_sync) will fire synchronously and
-- enqueue an HTTP POST to the notion-sync Netlify function.

INSERT INTO public.manager_override_log (
  action_type,
  manager_email,
  target_entity,
  target_id,
  details,
  challenge_method
)
VALUES (
  'void_order',                                   -- allowed by CHECK constraint
  'test-notion-trigger@brewhubphl.com',           -- dummy manager email
  'orders',                                       -- target_entity
  '00000000-0000-0000-0000-000000000000',         -- placeholder target_id
  '{"test": "Live from Supabase!", "triggered_at": "' || now()::text || '"}',
  'none_legacy'                                   -- allowed by CHECK constraint
)
RETURNING id, action_type, created_at;

-- After running: check the Netlify function logs for a notion-sync
-- invocation with source_table = 'manager_override_log'.


-- ── 2. Orders — UPDATE trigger test ─────────────────────────────────────
-- The trigger (trg_orders_notion_sync) only fires on the exact transition
-- NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'.
--
-- Option A: Update an existing test order (replace the UUID below).
-- Option B: Create a throwaway order first, then complete it.

-- ── Option A: Complete an existing test order ────────────────────────────
-- ⚠️  Replace 'YOUR_TEST_ORDER_ID' with a real order UUID you want to test.
--     Do NOT use a production customer order.

/*
UPDATE public.orders
SET    status       = 'completed',
       completed_at = now(),
       updated_at   = now()
WHERE  id = 'YOUR_TEST_ORDER_ID'
  AND  status IS DISTINCT FROM 'completed'    -- safety: no-op if already completed
RETURNING id, status, completed_at;
*/

-- ── Option B: Insert + complete a disposable test order ─────────────────
-- Creates a $0.00 test order in 'pending', then immediately completes it
-- so the trigger fires. Both statements run in sequence; Supabase SQL
-- Editor executes them in an implicit transaction.

DO $$
DECLARE
  test_order_id uuid;
BEGIN
  -- Step 1: Insert a zero-dollar test order
  INSERT INTO public.orders (
    status,
    total_amount_cents,
    customer_name,
    customer_email,
    notes,
    type
  )
  VALUES (
    'pending',
    0,
    'Notion Trigger Test',
    'test-notion-trigger@brewhubphl.com',
    'Auto-generated to test trg_orders_notion_sync — safe to delete',
    'cafe'
  )
  RETURNING id INTO test_order_id;

  RAISE NOTICE '[test] Created test order: %', test_order_id;

  -- Step 2: Transition to completed (fires the trigger)
  UPDATE public.orders
  SET    status       = 'completed',
         completed_at = now(),
         updated_at   = now()
  WHERE  id = test_order_id;

  RAISE NOTICE '[test] Completed test order: % — trigger should have fired', test_order_id;
END$$;


-- ── 3. Verify: Check pg_net request queue ───────────────────────────────
-- pg_net stores outbound requests in net._http_response. Query the most
-- recent entries to confirm the webhooks were enqueued.

SELECT
  id,
  status_code,
  url,
  created AS queued_at
FROM net._http_response
ORDER BY created DESC
LIMIT 5;


-- ── 4. Verify: Check processed_notion_syncs idempotency table ──────────
-- If the Netlify function responded successfully, it will have inserted
-- rows here. Empty results mean the function hasn't processed yet or
-- returned an error (check function logs).

SELECT
  id,
  sync_key,
  source_table,
  notion_database,
  processed_at
FROM public.processed_notion_syncs
ORDER BY processed_at DESC
LIMIT 10;


-- ── 5. Cleanup (optional) ───────────────────────────────────────────────
-- Uncomment these to remove test data after verifying.

/*
DELETE FROM public.orders
WHERE  customer_email = 'test-notion-trigger@brewhubphl.com'
  AND  total_amount_cents = 0
  AND  notes LIKE '%test trg_orders_notion_sync%';

DELETE FROM public.manager_override_log
WHERE  manager_email = 'test-notion-trigger@brewhubphl.com'
  AND  target_id = '00000000-0000-0000-0000-000000000000';

DELETE FROM public.processed_notion_syncs
WHERE  sync_key LIKE '%test-notion-trigger%'
   OR  sync_key LIKE '%00000000-0000-0000-0000-000000000000%';
*/
