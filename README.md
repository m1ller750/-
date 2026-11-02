# 🏆 TurniRUM

**Tournaments that run themselves.** TurniRUM is an open-source tournament platform for esports and sports:
organizers host free or paid tournaments, players register teams and pay entry fees with **PayPal**,
**Google Gemini** picks the format, seeds the teams and builds the schedule, and prizes are paid to the winners'
PayPal accounts automatically. The platform earns 10% of every paid tournament.

| | |
|---|---|
| 🌐 **Live site** | [raw.githack.com/m1ller750/TurniRUM/main/site/index.html](https://raw.githack.com/m1ller750/TurniRUM/main/site/index.html) (PayPal sandbox — no real money) |
| 📖 **Guide** | [docs/GUIDE.md](docs/GUIDE.md) — also on the site under **Guide** |
| 🎬 **Demo video** | [docs/demo/TurniRUM-demo.mp4](docs/demo/TurniRUM-demo.mp4) (≈3 min, English voice-over and subtitles) |
| 🧰 **Built with** | [AI models, APIs and tools](docs/GUIDE.md#built-with-ai-models-apis-and-tools) |
| ⚖️ **License** | [MIT](LICENSE) |

## The problem

Amateur and semi-pro tournaments are still run with spreadsheets and group chats. Organizers draw brackets by hand,
juggle match times in endless messages and collect entry fees through screenshots of bank transfers. Players struggle
to find a team, and prize money arrives late — or never. Nobody can see where the entry fees went.

## The solution

- **AI does the organizing.** Describe a tournament in one sentence and the AI fills in the whole form. When
  registration closes, it chooses the bracket format, seeds the teams and plans the schedule. When both captains ask
  to move a match, it finds a new free time. It writes the reminders and suggests teammates.
- **PayPal handles the money.** Entry fees are paid with PayPal (account or card) and verified on the server before a
  team is admitted. At the end, prizes go to the winners' PayPal with PayPal Payouts, 10% goes to the platform and the
  organizer withdraws the rest. Refunds are automatic.
- **Everyone sees the same truth.** Live brackets, standings, notifications and a ledger of every payment.

**Who benefits:** organizers save hours and get paid fairly; players get clear brackets, fair rescheduling and
guaranteed prizes; clubs, schools and communities can run paid events transparently; the platform earns a simple,
visible 10% fee.

The repository also has an offline desktop version (Russian, Flask + SQLite) — see [the end of this file](#desktop-app-russian-flask--sqlite).

---

## Web app

**Stack:** static single-page app (HTML/CSS/vanilla JS modules, no build step) ·
Supabase Postgres + Row Level Security + RPC functions · Supabase Auth · one Supabase Edge Function (`api`)
for registration and PayPal · PayPal Checkout (sandbox).

**Hosting:** `site/` is a static site — it can be served as is (githack, any static host), or as one file:
`python tools/build_netlify.py` builds `release/netlify/index.html` with everything inline for Netlify.
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

### AI (Gemini)

The `api` Edge Function uses Google Gemini (key in `app_settings.gemini_api_key`, or the `GEMINI_API_KEY` secret;
`gemini_model` / `gemini_models` put preferred models first, overloaded ones are skipped) for:

- **Create with AI** — an organizer describes a tournament in any language and the AI fills in the whole form.
- **Brackets** — the AI picks the format (single or double elimination, round robin, groups + playoffs), seeds the
  teams by their results on TurniRUM and plans the timing (match length, breaks, parallel matches, rounds per day).
  The bracket itself is built by a deterministic engine (`supabase/functions/api/engine.js`), so it is always valid;
  without the AI the same engine works with standard rules.
- **Rescheduling** — on the player's **Bracket** tab captains press **Reschedule**; when the captains of both teams
  asked, the AI picks a new free time (no team plays twice at once, later matches move along) and everyone is notified.
- **Reminders** — a `pg_cron` job calls the function every 10 minutes: AI-written reminders 24 h and 1 h before a
  tournament, a reminder before each match, and the email queue.
- **Find a team** — players keep a "looking for a team" card; the AI suggests teammates from the tournaments they
  played (games, level, city) and players invite each other.

Notifications appear in the bell on the site and go out by email through **Brevo** once `app_settings` has
`brevo_api_key` and `email_sender` (a sender address verified in Brevo); `site_url` is the link used in emails.

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
  js/views/*.js           pages: home, catalog, tournament + join, auth, organizer, player, creator, wallet,
                          bracket + team finder (play.js), notifications
  js/bracket.js           the bracket board: matches by stage and round, results, Reschedule
  Dockerfile, Caddyfile, railway.json   optional static hosting on Railway
supabase/migrations/      schema, RLS policies and RPC functions (wallets and prizes in the second migration)
supabase/functions/api/   Edge Function: registration, creator password, PayPal orders and captures,
                          prize payouts, withdrawals, refunds, brackets, AI helpers and notifications
release/netlify/index.html  the whole site in one file (for Netlify), rebuilt by tools/build_netlify.py
docs/GUIDE.md             user guide + the list of AI models, APIs and tools
docs/demo/                demo video with English voice-over and subtitles (.srt)
site-tests/               browser tests (Playwright) against an in-memory mock of api.js
```

### Tests

```bash
pip install playwright && python site-tests/run_ui_tests.py   # UI checks with a mocked backend
node site-tests/engine_test.mjs                                 # random brackets of every format played to the end
```

The database logic (permissions, RPC validation, PayPal admission and idempotency, settlement and wallets) was
checked directly against the Supabase project, and the whole money flow (card payment → admission → finish →
prize payouts → withdrawal → refund) ran against the real PayPal sandbox.

---

## Desktop app (Russian, Flask + SQLite)

`release/TurniRUM.exe` starts a local server and opens the browser — nothing to install.
Rebuilt automatically by `.github/workflows/build-exe.yml` when the Python code changes.
For development: `pip install -r requirements.txt && python run.py`, tests: `pytest`.
