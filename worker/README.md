# CrowdFax API (Cloudflare Worker)

Receives a fax request from the site, checks it, and forwards the PDF to Telnyx. Runs on the
Cloudflare Workers free tier. Tested with `npm test` (mocked Telnyx, Turnstile and KV).

## What it does
- `POST /send`: validates origin, PDF (magic bytes, <=10 MB, rough page cap), phone number format,
  Cloudflare Turnstile token, and per-IP and global daily caps, then sends via Telnyx.
- `GET /status?id=`: returns only the delivery status.
- `GET /balance`: returns the Telnyx balance for the "Fund" badge.

## Privacy by design
- The PDF is held in memory only. It is never written to storage or logs (`observability` is off).
- Sent to Telnyx with `store_media=false` and `store_preview=false`.
- The recipient name is never sent. Provider error details are never forwarded.
- Only anonymous counters are kept: hashed IP (secret salt) and a daily total, expiring after 24 hours.
- Telnyx itself still handles the document. Read their data-retention terms before launching.

## Setup (one time)

### 1. Telnyx
1. Create an account and complete verification.
2. Buy a phone number to send from, and create a Fax Application. Note its **connection ID**.
   Follow Telnyx's Programmable Fax quickstart so the number is assigned to that application.
3. Create a v2 **API key**.
4. Add funds. Cards, PayPal and ACH work. Bitcoin works on-chain only with a $100 minimum per payment.

### 2. Cloudflare
```
cd worker
npx wrangler login
npx wrangler kv namespace create RATE        # paste the id into wrangler.toml
npx wrangler secret put TELNYX_API_KEY
npx wrangler secret put TELNYX_CONNECTION_ID
npx wrangler secret put TELNYX_FROM          # your number in E.164, e.g. +15551234567
npx wrangler secret put IP_SALT              # any long random string
npx wrangler secret put TURNSTILE_SECRET     # from the Turnstile widget (step 3)
npx wrangler deploy
```
Create the Turnstile widget (Cloudflare dashboard, Turnstile, add site `crowdfax.apramodk.com`)
to get the site key and secret.

### 3. Connect the site
Set `API_URL` and `TURNSTILE_SITEKEY` in `../site.config.js`, then push. Until `API_URL` is set the
form shows "sending isn't enabled yet".

## Spend controls
`MAX_FAXES_PER_DAY` (default 40) and `MAX_FAXES_PER_IP_DAY` (default 3) in `wrangler.toml` bound the
daily spend. When the Telnyx balance runs out, senders see "The fund is empty right now."
