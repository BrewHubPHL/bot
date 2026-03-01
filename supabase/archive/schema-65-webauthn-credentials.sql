-- ─────────────────────────────────────────────────────────────────────────────
-- Schema 65: WebAuthn / Passkey credentials for biometric staff login
-- (Face ID, Touch ID, Windows Hello)
--
-- Each staff member can register multiple passkeys (e.g. iPad + personal phone).
-- Challenges are ephemeral (5-min TTL) to prevent replay attacks.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Credentials table — stores registered passkeys
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id              text        PRIMARY KEY,          -- base64url credential ID
  staff_id        uuid        NOT NULL REFERENCES public.staff_directory(id) ON DELETE CASCADE,
  public_key      text        NOT NULL,             -- base64url-encoded public key
  counter         bigint      NOT NULL DEFAULT 0,   -- signature counter (replay protection)
  transports      text[]      DEFAULT '{}',         -- e.g. {'internal','hybrid'}
  device_name     text,                             -- friendly label ("iPad Pro", "Tommy's iPhone")
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webauthn_creds_staff ON public.webauthn_credentials(staff_id);

-- RLS: Only service_role / SECURITY DEFINER can read/write
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to webauthn_credentials" ON public.webauthn_credentials;
CREATE POLICY "No direct access to webauthn_credentials" ON public.webauthn_credentials
  FOR ALL USING (false);

-- 2. Challenges table — ephemeral challenges for registration & authentication
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge       text        NOT NULL,             -- base64url challenge string
  staff_id        uuid        REFERENCES public.staff_directory(id) ON DELETE CASCADE,  -- NULL for auth (discoverable)
  type            text        NOT NULL CHECK (type IN ('register', 'authenticate')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON public.webauthn_challenges(expires_at);

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to webauthn_challenges" ON public.webauthn_challenges;
CREATE POLICY "No direct access to webauthn_challenges" ON public.webauthn_challenges
  FOR ALL USING (false);

-- 3. Cleanup function — purge expired challenges (called by pg_cron)
CREATE OR REPLACE FUNCTION cleanup_webauthn_challenges()
RETURNS void AS $$
BEGIN
  DELETE FROM public.webauthn_challenges WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cleanup every 10 minutes
SELECT cron.schedule(
  'cleanup-webauthn-challenges',
  '*/10 * * * *',
  'SELECT cleanup_webauthn_challenges()'
);

COMMENT ON TABLE public.webauthn_credentials IS
  'Stores WebAuthn/passkey credentials for biometric staff login (Face ID, Touch ID, Windows Hello).';
COMMENT ON TABLE public.webauthn_challenges IS
  'Ephemeral WebAuthn challenges with 5-minute TTL. Cleaned up by pg_cron.';
