-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 84 — agreement_signatures table + atomic sign RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- Immutable audit trail for staff digital signatures on the Mutual Working
-- Agreement.  The RPC performs the insert + staff_directory update inside a
-- single transaction so the two writes can never diverge.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agreement_signatures (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid        NOT NULL REFERENCES staff_directory(id),
  version_tag  text        NOT NULL,
  sha256_hash  text        NOT NULL,       -- hex-encoded SHA-256 of the agreement text
  ip_address   text        NOT NULL,       -- hashed IP (via hashIP / hash_ip)
  user_agent   text,
  signed_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for lookups by staff_id (e.g. "has this employee signed?")
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_staff
  ON agreement_signatures (staff_id);

-- ── 2. RLS — service-role only (no direct client access) ─────────────────
ALTER TABLE agreement_signatures ENABLE ROW LEVEL SECURITY;
-- No permissive policies → only service-role key can read/write.

-- ── 3. Atomic RPC ────────────────────────────────────────────────────────
-- Inserts the signature row AND sets contract_signed = true on
-- staff_directory in a single transaction.
-- Uses pg_advisory_xact_lock keyed on the staff UUID to serialise
-- concurrent attempts for the same employee.
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
  v_sig_id   uuid;
  v_now      timestamptz := now();
BEGIN
  -- Serialise concurrent signatures for the same staff member
  PERFORM pg_advisory_xact_lock(
    ('x' || left(replace(p_staff_id::text, '-', ''), 15))::bit(64)::bigint
  );

  -- 1. Insert the immutable audit row
  INSERT INTO agreement_signatures (
    staff_id, version_tag, sha256_hash, ip_address, user_agent, signed_at, created_at
  ) VALUES (
    p_staff_id, p_version_tag, p_sha256_hash, p_ip_address, p_user_agent, v_now, v_now
  )
  RETURNING id INTO v_sig_id;

  -- 2. Mark the employee's contract as signed + rotate token_version
  --    Bumping token_version forces any existing sessions to become
  --    invalid, requiring a fresh login that picks up the new
  --    onboarding_complete = true status. (Phase 1 -- Vulnerability #2)
  UPDATE staff_directory
     SET contract_signed      = true,
         onboarding_complete  = true,
         token_version        = token_version + 1,
         version_updated_at   = v_now
   WHERE id        = p_staff_id
     AND is_active = true;

  RETURN jsonb_build_object(
    'signature_id', v_sig_id,
    'signed_at',    v_now
  );
END;
$$;
