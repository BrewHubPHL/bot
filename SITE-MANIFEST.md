# SITE-MANIFEST.md

## Site Toggles
- **Shop/Cafe Modes**: Configurable via `site-settings-sync.js`.
  - **Shop**: Merch store functionality.
  - **Cafe**: Food and beverage ordering.

---

## Environment Variable Requirements

### Supabase
- `SUPABASE_URL`: Project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Server-side admin key.
- `NEXT_PUBLIC_SUPABASE_URL`: Client-side URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Client-side anon key.

### Square (Production)
- `SQUARE_PRODUCTION_TOKEN`: Server API access token.
- `SQUARE_PRODUCTION_APPLICATION_ID`: Client app ID.
- `SQUARE_LOCATION_ID`: Point Breeze location.
- `SQUARE_WEBHOOK_SIGNATURE`: HMAC key for webhook validation.
- `SQUARE_WEBHOOK_URL`: Base URL for signature computation.
- `SQUARE_TERMINAL_DEVICE_ID`: Hardware terminal device code.

### Auth & Security
- `BREWHUB_API_KEY`: Internal API auth.
- `OPS_HMAC_SECRET`: HMAC key for PIN session tokens.
- `ALLOWED_IPS`: Comma-separated IP allowlist for PIN login.
- `SERVICE_SECRET`: Internal service-to-service auth.

### AI & Voice
- `CLAUDE_API_KEY`: Anthropic Claude.
- `ELEVENLABS_API_KEY`: ElevenLabs voice.
- `ELEVENLABS_AGENT_ID`: Elise agent.

### Communications
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`: SMS.
- `RESEND_API_KEY`: Transactional email.

### Infrastructure
- `SITE_URL` / `URL`: Site base URL for CORS + redirects.

---

## 3rd Party API Dependencies

| API         | Purpose                  | Key/ID Required           |
|-------------|--------------------------|---------------------------|
| Square      | Payments, Webhooks      | `SQUARE_PRODUCTION_TOKEN` |
| ElevenLabs  | Text-to-Speech (TTS)    | `ELEVENLABS_API_KEY`      |
| Twilio      | SMS Notifications       | `TWILIO_ACCOUNT_SID`      |
| Resend      | Transactional Emails    | `RESEND_API_KEY`          |