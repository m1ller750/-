# 🏆 TurniRUM

An online tournament platform. Organizers run free and paid tournaments and keep live standings,
players find tournaments with filters and pay entry fees with **PayPal** (checked automatically on the server),
winners get their prizes on PayPal automatically, and the platform creator earns 10% of every paid tournament.

The repository contains two versions:

| Version | Folder | Language | How to use |
|---------|--------|----------|------------|
| **Web app** (main) | `site/`, `supabase/` | English | open the link below, backend on Supabase |
| Desktop app | `turnirum/`, `launcher.py` | Russian | `release/TurniRUM.exe`, double-click |

---

## Web app

**Stack:** static single-page app (HTML/CSS/vanilla JS modules, no build step) ·
Supabase Postgres + Row Level Security + RPC functions · Supabase Auth · one Supabase Edge Function (`api`)
for registration and PayPal · PayPal Checkout (sandbox).

**Live:** the site is served straight from this public repository by githack —
`https://rawcdn.githack.com/m1ller750/-/<commit-sha>/site/index.html` (a link per commit, it never changes).
`site/` also has a `Dockerfile`, `Caddyfile` and `railway.json` for hosting it on Railway.

### Roles

- **Organizer** — creates free or paid tournaments. A paid tournament has an entry fee, a prize share (0–90%)
  split between prize places (e.g. 1st 50% · 2nd 30% · 3rd 20%), and the organizer must confirm that TurniRUM keeps
  10% of the entry fees. Edits the team table (names, rosters, W/D/L, score, points with automatic W×3 + D), invites
  teams, refunds and removes teams that paid, and finishes the tournament with **Finish & pay prizes**. Has a
  **wallet** (income from finished tournaments, withdrawals to PayPal) and a **business model** page.
- **Player** — browses the catalog with filters (search, game, price, status, format, max fee, open slots,
  "only my tournaments", sorting), registers a team; for a paid tournament pays with PayPal (account or card) and is
  admitted instantly after the server verifies the payment. Can name a PayPal email for prizes, and sees the prize
  payout on the **My tables** page.
- **Platform creator** — anyone who signs up or signs in with the creator password (only its SHA-256 is stored,
  in `app_settings.creator_password_sha256`). Has the **platform wallet** (10% of every finished paid tournament),
  sees turnover by game, top organizers, the ledger of payments, prizes and withdrawals and the user list, and can
  delete any tournament (unfinished paid tournaments are refunded first).

### How a PayPal payment is verified

1. The player fills in the team and clicks the PayPal button.
2. `api` → `paypal-create-order`: the server re-checks the registration (slots, duplicates, roster size),
   records a pending payment and creates a PayPal order with the entry fee **taken from the database**.
3. The player approves the payment in the PayPal window.
4. `api` → `paypal-capture-order`: the server captures the order, checks that PayPal reports `COMPLETED`
   with the exact amount, currency and order reference, and only then admits the team (`paypal_admit_team`).
   If the team can no longer join (the last slot was taken meanwhile), the payment is **refunded automatically**.

### Where the money goes

All entry fees are captured into the platform's PayPal business account. When the organizer finishes a paid
tournament, the database settles it in one transaction (`settle_tournament`):

- 10% of the collected fees is credited to the **platform wallet**;
- the prize pool is split between the prize places by the final standings and sent to the winners with
  **PayPal Payouts** (to the team's prize email, else the PayPal payer, else the captain's account email);
  a prize that cannot be sent automatically goes to the organizer's wallet with a note to pay it directly;
- the rest is credited to the **organizer's wallet**.

Wallets are a ledger (`wallet_entries`); withdrawals are PayPal payouts too, and a payout PayPal returns puts the
money back into the wallet. Payout statuses are refreshed from PayPal when a wallet or results page opens.
A team that paid can only be removed with a refund, and the entry fee and prizes are locked once a team has paid.
PayPal's own fees (per payment and per payout) are paid by the platform account.

### Turning on PayPal

The site works without PayPal keys, but paid registrations show "payments are being set up".
To enable them, set two Edge Function secrets in Supabase (Project → Edge Functions → Secrets):

| Secret | Value |
|--------|-------|
| `PAYPAL_CLIENT_ID` | Client ID of a PayPal REST app (developer.paypal.com → Apps & Credentials → Sandbox) |
| `PAYPAL_CLIENT_SECRET` | Secret of the same app |
| `PAYPAL_ENV` | optional, `sandbox` (default) or `live` |

No redeploy is needed. If the secrets are not set, the function falls back to the rows `paypal_client_id`,
`paypal_client_secret` and `paypal_env` of the `app_settings` table, which only the server can read (that is
where the current sandbox keys are). The PayPal app needs the **Payouts** feature for prizes and withdrawals.
Use a sandbox *personal* test account (Developer dashboard → Testing tools → Sandbox accounts) to pay on the site.

### Demo accounts

The database starts without tournaments: everything in the catalog is created by real organizers.
These test accounts exist for trying the roles:

| Role | Email | Password |
|------|-------|----------|
| Organizer | `organizer@example.com`, `league@example.com` | `demo1234` |
| Player | `player1@example.com` … `player4@example.com` | `demo1234` |
| Creator | sign up with any email and the creator password | — |

### Project layout

```
site/                     the web app (served as-is)
  index.html, css/, img/, vendor/supabase-*.js
  js/api.js               the only module that talks to Supabase
  js/main.js              router, session, navigation by role
  js/views/*.js           pages: home, catalog, tournament + join, auth, organizer, player, creator, wallet
  Dockerfile, Caddyfile, railway.json   optional static hosting on Railway
supabase/migrations/      schema, RLS policies and RPC functions (wallets and prizes in the second migration)
supabase/functions/api/   Edge Function: registration, creator password, PayPal orders and captures,
                          prize payouts, withdrawals and refunds
site-tests/               browser tests (Playwright) against an in-memory mock of api.js
```

### Tests

```bash
pip install playwright && python site-tests/run_ui_tests.py   # 56 UI checks with a mocked backend
```

The database logic (permissions, RPC validation, PayPal admission and idempotency, settlement and wallets) was
checked directly against the Supabase project, and the whole money flow (card payment → admission → finish →
prize payouts → withdrawal → refund) ran against the real PayPal sandbox.

---

## Desktop app (Russian, Flask + SQLite)

`release/TurniRUM.exe` starts a local server and opens the browser — nothing to install.
Rebuilt automatically by `.github/workflows/build-exe.yml` when the Python code changes.
For development: `pip install -r requirements.txt && python run.py`, tests: `pytest`.
