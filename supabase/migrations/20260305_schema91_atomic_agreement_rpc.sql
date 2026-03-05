-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 91 — Harden record_agreement_signature RPC (Ticket C-1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Problem:  The Schema-84 RPC inserts into agreement_signatures and then
--           UPDATEs staff_directory, but never checks whether the UPDATE
--           actually matched a row.  If the staff member was deactivated
--           (is_active = false) between PIN verification and the RPC call,
--           the signature row would be committed while contract_signed
--           remained false — a partial / inconsistent state.
--
-- Fix:     After the UPDATE, check FOUND.  If no row was touched, RAISE
--           an exception which rolls back the entire transaction (including
--           the preceding INSERT), guaranteeing all-or-nothing semantics.
--           Also adds explicit row-count tracking via GET DIAGNOSTICS for
--           defense-in-depth.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_agreement_signature(
  p_staff_id    uuid,
  p_version_tag text,
  p_sha256_hash text,
  p_ip_address  text,
  p_user_agent  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig_id      uuid;
  v_now         timestamptz := now();
  v_rows        int;
BEGIN
  -- ── Serialise concurrent signatures for the same staff member ──────
  PERFORM pg_advisory_xact_lock(
    ('x' || left(replace(p_staff_id::text, '-', ''), 15))::bit(64)::bigint
  );

  -- ── 1. Insert the immutable audit row ──────────────────────────────
  INSERT INTO agreement_signatures (
    staff_id, version_tag, sha256_hash, ip_address, user_agent, signed_at, created_at
  ) VALUES (
    p_staff_id, p_version_tag, p_sha256_hash, p_ip_address, p_user_agent, v_now, v_now
  )
  RETURNING id INTO v_sig_id;

  -- ── 2. Mark the employee's contract as signed ──────────────────────
  --    Bumping token_version forces existing sessions to become invalid,
  --    requiring a fresh login that picks up the new status.
  UPDATE staff_directory
     SET contract_signed      = true,
         onboarding_complete  = true,
         token_version        = token_version + 1,
         version_updated_at   = v_now
   WHERE id        = p_staff_id
     AND is_active = true;

  -- ── 3. Verify the UPDATE matched exactly one row ───────────────────
  --    If no row was touched (staff deactivated, id missing, etc.) we
  --    MUST roll back the INSERT above — otherwise the audit trail says
  --    "signed" but contract_signed is still false.
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'staff_directory update matched 0 rows for staff_id=% (deactivated or missing)', p_staff_id
      USING ERRCODE = 'P0002';  -- no_data_found
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'signature_id', v_sig_id,
    'signed_at',    v_now
  );
END;
$$;
