-- schema-68-receipt-claim.sql
-- Phase 3 Security Remediation: Atomic receipt claiming
--
-- Prevents duplicate prints when multiple iPads / hardware daemons
-- poll simultaneously. Uses SELECT … FOR UPDATE SKIP LOCKED so each
-- receipt is claimed exactly once.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_unprinted_receipts(p_limit int DEFAULT 5)
RETURNS TABLE (
  id         uuid,
  order_id   uuid,
  receipt_text text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE receipt_queue rq
  SET    printed = true
  WHERE  rq.id IN (
    SELECT rq2.id
    FROM   receipt_queue rq2
    WHERE  rq2.printed = false
    ORDER  BY rq2.created_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING rq.id, rq.order_id, rq.receipt_text, rq.created_at;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION public.claim_unprinted_receipts(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_unprinted_receipts(int) FROM anon;
REVOKE ALL ON FUNCTION public.claim_unprinted_receipts(int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_unprinted_receipts(int) TO service_role;

COMMIT;
