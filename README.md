# CrowdFax

A free, crowd-funded, non-profit fax service. Upload a PDF, enter the recipient's fax details, and
send. Costs are covered by donations and by ads served through [A-ADS](https://a-ads.com).

Live site: https://crowdfax.apramodk.com

Status: the site, ad slots, and wallet badge are in place. Sending faxes is not enabled yet (the
fax provider and a small serverless backend are still to be chosen).

## Setup

Plain HTML/CSS/JS, no build step. To run locally:

    python3 -m http.server

### Ads
Create ad units in the A-ADS dashboard and paste each unit ID into `ads.config.js`. Slots without
an ID show a placeholder. Impressions are reported in the A-ADS dashboard.

### Wallet badge
The top-right balance reads from `data/wallet.json`. Edit `balance` and `updated` and push.

## Deployment
Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`. The custom domain is set
in `CNAME`; DNS needs `CNAME crowdfax -> apramodk.github.io`.

## Sending faxes
The backend lives in `worker/` (Cloudflare Worker, free tier) and sends through Telnyx at about
$0.007 per page. See `worker/README.md` for the setup steps. Run its tests with `cd worker && npm test`.
