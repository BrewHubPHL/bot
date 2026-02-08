#!/usr/bin/env bash
set -euo pipefail

# Rotate secrets across Netlify + Supabase.
# Requires: netlify CLI, supabase CLI, openssl
# Assumes netlify site is already linked (netlify link).
# Requires SUPABASE_PROJECT_REF env var to be set.

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required." >&2
  exit 1
fi

if ! command -v netlify >/dev/null 2>&1; then
  echo "ERROR: netlify CLI is required." >&2
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI is required." >&2
  exit 1
fi

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "ERROR: SUPABASE_PROJECT_REF env var is required." >&2
  exit 1
fi

# Generate new secrets
INTERNAL_SYNC_SECRET_NEW=$(openssl rand -hex 32)
SUPABASE_WEBHOOK_SECRET_NEW=$(openssl rand -hex 32)

# Square webhook signature must be rotated in Square dashboard first
if [[ -z "${SQUARE_WEBHOOK_SIGNATURE_NEW:-}" ]]; then
  echo "Enter NEW SQUARE_WEBHOOK_SIGNATURE (from Square dashboard):"
  read -r -s SQUARE_WEBHOOK_SIGNATURE_NEW
  echo ""
fi

if [[ -z "$SQUARE_WEBHOOK_SIGNATURE_NEW" ]]; then
  echo "ERROR: SQUARE_WEBHOOK_SIGNATURE_NEW cannot be empty." >&2
  exit 1
fi

echo "Updating Netlify environment variables..."
netlify env:set INTERNAL_SYNC_SECRET "$INTERNAL_SYNC_SECRET_NEW"
netlify env:set SUPABASE_WEBHOOK_SECRET "$SUPABASE_WEBHOOK_SECRET_NEW"
netlify env:set SQUARE_WEBHOOK_SIGNATURE "$SQUARE_WEBHOOK_SIGNATURE_NEW"

echo "Updating Supabase secrets for Edge Functions..."
supabase secrets set \
  --project-ref "$SUPABASE_PROJECT_REF" \
  INTERNAL_SYNC_SECRET="$INTERNAL_SYNC_SECRET_NEW" \
  SUPABASE_WEBHOOK_SECRET="$SUPABASE_WEBHOOK_SECRET_NEW"

# Optional: also store Square signature in Supabase secrets if you want parity
# supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" SQUARE_WEBHOOK_SIGNATURE="$SQUARE_WEBHOOK_SIGNATURE_NEW"

echo "Triggering Netlify redeploy to flush cached secrets..."
netlify deploy --prod --message "Rotate secrets" --build

echo "Redeploying Supabase Edge Functions to flush secrets..."
supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"

echo "Done. New secrets have been applied."
