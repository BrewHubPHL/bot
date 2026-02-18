## 🔒 Security
This project implements strict architectural security (HMAC, RLS, and Atomic Locks). 
Please review [README_SECURITY.md](./README_SECURITY.md) before making changes to the backend.

# BrewHub PHL

BrewHub PHL is a Netlify-hosted static site backed by Supabase. It includes a customer homepage, resident portal, staff POS, parcel operations, inventory scanning, and a kitchen display system (KDS).

## Voice Usage Policy
Voice features are limited to the public-facing chatbot only.
- Allowed: homepage voice chat with Elise (ElevenLabs ConvAI + TTS).
- Not allowed: voice announcements for orders, KDS, or operational alerts.
- Keep all operational flows text-only unless explicitly approved.

## Key Pages
- /index.html: homepage, waitlist, chat, staff login
- /portal.html: resident portal (loyalty + parcels)
- /cafe.html: staff POS
- /parcels.html: parcel check-in
- /scan.html: inventory scanning
- /manager.html: manager dashboard
- /kds.html: kitchen display
- /shop.html: coffee + merch storefront (Square Checkout links)

## Netlify Functions (high level)
- square-webhook: payment.updated -> order paid, loyalty, vouchers, inventory
- square-sync: create Square order for new Supabase orders
- collect-payment: Square Terminal checkout
- redeem-voucher: burn voucher and zero order
- supabase-webhook: internal router for order events
- parcel-check-in/register-tracking/parcel-pickup: parcel flow
- elevenlabs-chat/get-voice-session/text-to-speech: chatbot
- marketing-bot/marketing-sync/supabase-to-sheets: marketing ops

## Environment Variables
Required for Netlify:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_ANON_KEY (client-side)
- INTERNAL_SYNC_SECRET
- SQUARE_LOCATION_ID
- SQUARE_SANDBOX_TOKEN (sandbox)
- SQUARE_ACCESS_TOKEN (production)
- SQUARE_WEBHOOK_SIGNATURE
- SQUARE_WEBHOOK_URL (exact webhook URL for signature checks)
- ELEVENLABS_API_KEY
- ELEVENLABS_AGENT_ID
- GOOGLE_SCRIPT_URL
- CLAUDE_API_KEY
- RESEND_API_KEY

## Notes
- Square environment switches automatically based on NODE_ENV.
- KDS is a standalone public page (no React build step).
- shop.html uses hosted Square Checkout links per product.
