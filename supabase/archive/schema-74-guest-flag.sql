-- schema-74-guest-flag.sql
-- Adds is_guest boolean column to residents table so staff-added guests
-- are distinguishable from verified building residents.
-- Guests are auto-created by the parcel dashboard when no matching
-- resident is found, and can self-promote to full resident via the
-- HMAC-signed invite link.

ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN residents.is_guest IS
  'True for walk-in / guest entries created via parcel check-in. '
  'Auto-set to false when resident completes onboarding via invite URL.';
