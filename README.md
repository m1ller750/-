# 🏆 TurniRUM

An online tournament platform. Organizers run free and paid tournaments and keep live standings,
players find tournaments with filters and pay entry fees with **PayPal** (checked automatically on the server),
and the platform creator earns 10% of every paid tournament.

The repository contains two versions:

| Version | Folder | Language | How to use |
|---------|--------|----------|------------|
| **Web app** (main) | `site/`, `supabase/` | English | hosted on Railway, backend on Supabase |
| Desktop app | `turnirum/`, `launcher.py` | Russian | `release/TurniRUM.exe`, double-click |

---

## Web app

**Stack:** static single-page app (HTML/CSS/vanilla JS modules, no build step) served by Caddy on Railway ·
Supabase Postgres + Row Level Security + RPC functions · Supabase Auth · one Supabase Edge Function (`api`)
for registration and PayPal · PayPal Checkout (sandbox).

### Roles

- **Organizer** — creates free or paid tournaments (paid ones take a PayPal payout email), edits the team table
  (names, rosters, W/D/L, score, points with automatic W×3 + D), changes the status, adds or removes teams,
  sees the PayPal payments of a tournament and a **business model** page: prize pool / organizer / 10% platform,
  income per tournament and an income calculator.
- **Player** — browses the catalog with filters (search, game, price, status, format, max fee, open slots,
  "only my tournaments", sorting), registers a team; for a paid tournament pays with PayPal and is admitted
  instantly after the server verifies the payment. Has a **My tables** page with the standings of every tournament.
- **Platform creator** — anyone who signs up or signs in with the creator password `66666KZ@$`.
  Sees platform profit (10% of revenue), turnover by game, top organizers, the PayPal payment ledger
  and the user list, and can delete any tournament.

### How a PayPal payment is verified

1. The player fills in the team and clicks the PayPal button.
2. `api` → `paypal-create-order`: the server re-checks the registration (slots, duplicates, roster size),
   records a pending payment and creates a PayPal order with the entry fee **taken from the database**.
3. The player approves the payment in the PayPal window.
4. `api` → `paypal-capture-order`: the server captures the order, checks that PayPal reports `COMPLETED`
   with the exact amount, currency and order reference, and only then admits the team (`paypal_admit_team`).
   If the team can no longer join (the last slot was taken meanwhile), the payment is **refunded automatically**.

### Turning on PayPal

The site works without PayPal keys, but paid registrations show "payments are being set up".
To enable them, set two Edge Function secrets in Supabase (Project → Edge Functions → Secrets):

| Secret | Value |
|--------|-------|
| `PAYPAL_CLIENT_ID` | Client ID of a PayPal REST app (developer.paypal.com → Apps & Credentials → Sandbox) |
| `PAYPAL_CLIENT_SECRET` | Secret of the same app |
| `PAYPAL_ENV` | optional, `sandbox` (default) or `live` |

No redeploy is needed. Use a sandbox *personal* test account (Developer dashboard → Testing tools →
Sandbox accounts) to pay on the site.

### Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Organizer | `organizer@example.com`, `league@example.com` | `demo1234` |
| Player | `player1@example.com` … `player4@example.com` | `demo1234` |
| Creator | sign up with any email and the creator password | `66666KZ@$` |

### Project layout

```
site/                     the web app (served as-is)
  index.html, css/, img/, vendor/supabase-*.js
  js/api.js               the only module that talks to Supabase
  js/main.js              router, session, navigation by role
  js/views/*.js           pages: home, catalog, tournament + join, auth, organizer, player, creator
  Dockerfile, Caddyfile, railway.json   static hosting on Railway
supabase/migrations/      schema, RLS policies and RPC functions
supabase/functions/api/   Edge Function: registration, creator password, PayPal orders and captures
site-tests/               browser tests (Playwright) against an in-memory mock of api.js
```

### Tests

```bash
pip install playwright && python site-tests/run_ui_tests.py   # 40 UI checks with a mocked backend
```

The database logic (permissions, RPC validation, PayPal admission and idempotency) was checked directly
against the Supabase project with SQL as the `anon`, `authenticated` and `service_role` roles.

---

## Desktop app (Russian, Flask + SQLite)

`release/TurniRUM.exe` starts a local server and opens the browser — nothing to install.
Rebuilt automatically by `.github/workflows/build-exe.yml` when the Python code changes.
For development: `pip install -r requirements.txt && python run.py`, tests: `pytest`.
