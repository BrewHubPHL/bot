-- ═══════════════════════════════════════════════════════════════════════════════
-- F3.6-C: Harden parcel tracking index to prevent double-scan race condition
-- ═══════════════════════════════════════════════════════════════════════════════
-- The existing partial index only covers status = 'arrived', which means a
-- second scan can insert a duplicate row with status = 'pending_notification'
-- before the notification worker promotes it to 'arrived'.
--
-- Fix: Drop the narrow index and replace it with a broader unique index
-- covering BOTH 'arrived' AND 'pending_notification' statuses.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop the old narrow index
DROP INDEX IF EXISTS idx_parcels_tracking_arrived;

-- Create the broader unique index covering both active statuses
CREATE UNIQUE INDEX idx_parcels_tracking_arrived
  ON parcels (tracking_number)
  WHERE status IN ('arrived', 'pending_notification');

COMMIT;
