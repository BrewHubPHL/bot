-- ============================================================================
-- SCHEMA 48 — TCPA / 10DLC Compliance (SMS Opt-Out & Quiet Hours)
-- ============================================================================
-- Fixes the "10DLC Blacklist" vulnerability:
--   1. Application-level opt-out table — never rely solely on Twilio built-in
--   2. Consent audit log — immutable record of every opt-in/out event
--   3. Quiet hours enforcement — no SMS between 9 PM and 9 AM local time
--   4. Pre-send gate RPC — atomic check before every SMS send
--   5. SMS delivery log — track every outbound message for compliance
--
-- TCPA requires:
--   - Honor STOP within 10 business days (we honor instantly)
--   - Maintain opt-out records indefinitely
--   - Never text opted-out numbers even via a different code path
--   - Quiet hours: no auto-messages before 8 AM or after 9 PM recipient time
-- ============================================================================

-- ─── 1. SMS opt-out registry ────────────────────────────────────────────────
-- Canonical opt-out state for every phone number. Checked BEFORE every send.

CREATE TABLE IF NOT EXISTS sms_opt_out (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text NOT NULL UNIQUE,    -- E.164 format: +12675551234
  opted_out     boolean NOT NULL DEFAULT true,
  opted_out_at  timestamptz DEFAULT now(),
  opted_in_at   timestamptz,             -- when they re-subscribed (if ever)
  source        text NOT NULL DEFAULT 'twilio_stop',  -- how the opt-out happened
  carrier_name  text,                    -- carrier info if available
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- E.164 phone lookup must be instant
CREATE INDEX IF NOT EXISTS idx_sms_opt_out_phone ON sms_opt_out(phone_e164);

-- Constrain source to known values
DO $$ BEGIN
  ALTER TABLE sms_opt_out ADD CONSTRAINT chk_optout_source
    CHECK (source IN (
      'twilio_stop',          -- inbound STOP keyword
      'twilio_webhook',       -- Twilio opt-out webhook
      'admin_manual',         -- staff manually opted out a number
      'resident_portal',      -- resident opted out via portal
      'fcc_complaint',        -- FCC complaint-driven opt-out
      'carrier_block',        -- carrier-level block notification
      'twilio_start',         -- re-subscribe via START keyword
      'resident_resubscribe'  -- re-subscribe via portal
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE sms_opt_out IS
  'TCPA-mandated opt-out registry. Checked before EVERY outbound SMS. Never deleted.';

-- RLS: service_role only (written by webhook, read by send functions)
ALTER TABLE sms_opt_out ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public sms_opt_out"
    ON sms_opt_out FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read sms_opt_out"
    ON sms_opt_out FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Immutable SMS consent audit log ─────────────────────────────────────
-- Every opt-in, opt-out, and re-subscribe event is logged permanently.
-- This is your evidence if the FCC comes knocking.

CREATE TABLE IF NOT EXISTS sms_consent_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text NOT NULL,
  event_type    text NOT NULL,     -- 'opt_in' | 'opt_out' | 'resubscribe'
  source        text NOT NULL,     -- how this event happened
  source_detail text,              -- e.g. 'inbound SMS body: STOP'
  ip_address    text,              -- if from web form
  user_agent    text,              -- if from web form
  staff_email   text,              -- if admin-initiated
  twilio_sid    text,              -- Twilio message SID if applicable
  created_at    timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE sms_consent_log ADD CONSTRAINT chk_consent_event_type
    CHECK (event_type IN ('opt_in', 'opt_out', 'resubscribe'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_consent_log_phone ON sms_consent_log(phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_log_created ON sms_consent_log(created_at DESC);

-- RLS: immutable audit trail
ALTER TABLE sms_consent_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public sms_consent_log"
    ON sms_consent_log FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read consent log"
    ON sms_consent_log FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. SMS delivery log ────────────────────────────────────────────────────
-- Tracks every outbound SMS for compliance reporting and debugging.

CREATE TABLE IF NOT EXISTS sms_delivery_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text NOT NULL,
  message_type  text NOT NULL,     -- 'parcel_arrived', 'loyalty_qr', etc.
  twilio_sid    text,              -- Twilio message SID
  status        text DEFAULT 'sent',  -- 'sent', 'blocked_optout', 'blocked_quiet', 'failed'
  blocked_reason text,             -- why it was blocked (if applicable)
  source_function text,            -- which function sent it: 'send-sms-email', 'notification-worker', etc.
  staff_email   text,              -- who triggered it (if staff-initiated)
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_delivery_phone ON sms_delivery_log(phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_created ON sms_delivery_log(created_at DESC);

ALTER TABLE sms_delivery_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public sms_delivery_log"
    ON sms_delivery_log FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read delivery log"
    ON sms_delivery_log FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 4. Pre-send gate RPC ──────────────────────────────────────────────────
-- Called before EVERY SMS send. Returns whether the send is allowed.
-- Checks opt-out status AND quiet hours.

CREATE OR REPLACE FUNCTION check_sms_allowed(
  p_phone_e164      text,
  p_timezone         text DEFAULT 'America/New_York',
  p_quiet_start_hour int DEFAULT 21,   -- 9 PM
  p_quiet_end_hour   int DEFAULT 9     -- 9 AM
)
RETURNS TABLE(
  allowed        boolean,
  block_reason   text,
  opted_out      boolean,
  in_quiet_hours boolean
) AS $$
DECLARE
  v_opted_out    boolean;
  v_local_hour   int;
  v_in_quiet     boolean;
BEGIN
  -- Check opt-out registry
  SELECT soo.opted_out INTO v_opted_out
  FROM sms_opt_out soo
  WHERE soo.phone_e164 = p_phone_e164;

  -- If no record, assume not opted out
  v_opted_out := COALESCE(v_opted_out, false);

  -- Check quiet hours in recipient's timezone
  v_local_hour := EXTRACT(HOUR FROM now() AT TIME ZONE p_timezone)::int;
  v_in_quiet := (v_local_hour >= p_quiet_start_hour OR v_local_hour < p_quiet_end_hour);

  IF v_opted_out THEN
    RETURN QUERY SELECT false, 'opted_out'::text, true, v_in_quiet;
    RETURN;
  END IF;

  IF v_in_quiet THEN
    RETURN QUERY SELECT false, 'quiet_hours'::text, false, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, false, false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_sms_allowed(text, text, int, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION check_sms_allowed(text, text, int, int)
  TO service_role;

-- ─── 5. Opt-out management RPC ──────────────────────────────────────────────
-- Atomic upsert for opt-out/re-subscribe events.

CREATE OR REPLACE FUNCTION record_sms_opt_out(
  p_phone_e164   text,
  p_source        text,
  p_source_detail text DEFAULT NULL,
  p_twilio_sid    text DEFAULT NULL,
  p_staff_email   text DEFAULT NULL,
  p_ip_address    text DEFAULT NULL
)
RETURNS TABLE(success boolean, was_already_opted_out boolean) AS $$
DECLARE
  v_existing sms_opt_out%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM sms_opt_out WHERE phone_e164 = p_phone_e164 FOR UPDATE;

  IF FOUND THEN
    IF v_existing.opted_out THEN
      -- Already opted out, just log it
      INSERT INTO sms_consent_log (phone_e164, event_type, source, source_detail, twilio_sid, staff_email, ip_address)
      VALUES (p_phone_e164, 'opt_out', p_source, p_source_detail, p_twilio_sid, p_staff_email, p_ip_address);
      RETURN QUERY SELECT true, true;
      RETURN;
    END IF;

    -- Re-opt-out
    UPDATE sms_opt_out SET
      opted_out = true,
      opted_out_at = now(),
      source = p_source,
      updated_at = now()
    WHERE phone_e164 = p_phone_e164;
  ELSE
    -- First opt-out
    INSERT INTO sms_opt_out (phone_e164, opted_out, opted_out_at, source)
    VALUES (p_phone_e164, true, now(), p_source);
  END IF;

  -- Immutable audit log
  INSERT INTO sms_consent_log (phone_e164, event_type, source, source_detail, twilio_sid, staff_email, ip_address)
  VALUES (p_phone_e164, 'opt_out', p_source, p_source_detail, p_twilio_sid, p_staff_email, p_ip_address);

  RETURN QUERY SELECT true, false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION record_sms_opt_out(text, text, text, text, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_sms_opt_out(text, text, text, text, text, text)
  TO service_role;

-- ─── 6. Re-subscribe RPC ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_sms_resubscribe(
  p_phone_e164    text,
  p_source        text,
  p_source_detail text DEFAULT NULL,
  p_twilio_sid    text DEFAULT NULL,
  p_ip_address    text DEFAULT NULL
)
RETURNS TABLE(success boolean, was_opted_out boolean) AS $$
DECLARE
  v_existing sms_opt_out%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM sms_opt_out WHERE phone_e164 = p_phone_e164 FOR UPDATE;

  IF NOT FOUND THEN
    -- Never opted out, nothing to re-subscribe
    INSERT INTO sms_consent_log (phone_e164, event_type, source, source_detail, twilio_sid, ip_address)
    VALUES (p_phone_e164, 'resubscribe', p_source, p_source_detail, p_twilio_sid, p_ip_address);
    RETURN QUERY SELECT true, false;
    RETURN;
  END IF;

  IF NOT v_existing.opted_out THEN
    -- Already subscribed
    RETURN QUERY SELECT true, false;
    RETURN;
  END IF;

  UPDATE sms_opt_out SET
    opted_out = false,
    opted_in_at = now(),
    source = p_source,
    updated_at = now()
  WHERE phone_e164 = p_phone_e164;

  INSERT INTO sms_consent_log (phone_e164, event_type, source, source_detail, twilio_sid, ip_address)
  VALUES (p_phone_e164, 'resubscribe', p_source, p_source_detail, p_twilio_sid, p_ip_address);

  RETURN QUERY SELECT true, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION record_sms_resubscribe(text, text, text, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_sms_resubscribe(text, text, text, text, text)
  TO service_role;

-- ─── 7. Compliance dashboard RPCs ──────────────────────────────────────────

-- Count of opted-out numbers
CREATE OR REPLACE FUNCTION get_sms_opt_out_stats()
RETURNS TABLE(
  total_opted_out  bigint,
  opted_out_today  bigint,
  total_resubscribed bigint,
  total_sms_sent_today bigint,
  total_sms_blocked_today bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM sms_opt_out WHERE opted_out = true)::bigint,
    (SELECT COUNT(*) FROM sms_opt_out WHERE opted_out = true AND opted_out_at::date = CURRENT_DATE)::bigint,
    (SELECT COUNT(*) FROM sms_opt_out WHERE opted_out = false AND opted_in_at IS NOT NULL)::bigint,
    (SELECT COUNT(*) FROM sms_delivery_log WHERE created_at::date = CURRENT_DATE AND status = 'sent')::bigint,
    (SELECT COUNT(*) FROM sms_delivery_log WHERE created_at::date = CURRENT_DATE AND status LIKE 'blocked%')::bigint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION get_sms_opt_out_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_sms_opt_out_stats() TO service_role;

-- ─── 8. Consent persistence for resident registration ───────────────────────
-- Add SMS consent tracking to expected_parcels (resident pre-registration)

ALTER TABLE expected_parcels ADD COLUMN IF NOT EXISTS sms_consent       boolean DEFAULT false;
ALTER TABLE expected_parcels ADD COLUMN IF NOT EXISTS sms_consent_at    timestamptz;
ALTER TABLE expected_parcels ADD COLUMN IF NOT EXISTS sms_consent_ip    text;

COMMENT ON COLUMN expected_parcels.sms_consent IS
  'Whether the resident gave TCPA-compliant SMS consent during registration.';
