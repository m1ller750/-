# TurniRUM user guide

TurniRUM is a tournament platform for esports and sports. Organizers host free or paid tournaments, players register
teams and pay entry fees with **PayPal**, **Google Gemini** builds the brackets and schedules, and prizes are paid to
the winners' PayPal accounts automatically. The same guide is on the site under **Guide** (`#/guide`).

- [Getting started](#getting-started)
- [For organizers](#for-organizers)
- [For players](#for-players)
- [For the platform creator](#for-the-platform-creator)
- [Payments with PayPal](#payments-with-paypal)
- [Where the AI helps](#where-the-ai-helps)
- [Built with: AI models, APIs and tools](#built-with-ai-models-apis-and-tools)
- [FAQ](#faq)

---

## Getting started

TurniRUM has three kinds of accounts. Pick yours when you sign up; the menu then shows the pages for your role.

| Role | What it does |
|------|--------------|
| **Organizer** | Hosts free or paid tournaments, lets the AI build the bracket and withdraws the income. |
| **Player** | Finds tournaments, registers a team, pays with PayPal and receives prizes automatically. |
| **Platform creator** | Earns 10% of every paid tournament and manages the whole platform. |

**Demo accounts** (password `demo1234`): organizer `organizer@example.com`, players `player1@example.com` …
`player4@example.com`. Payments run in **PayPal sandbox** mode, so no real money is involved.

## For organizers

1. **Create a tournament.** Open **Create tournament**. Fill in the form yourself, or describe the event in a sentence
   (in any language) under **Create with AI** and press **Fill the form with AI**. The AI fills in the title, game,
   description, date and time, online or offline, team limits, entry fee, prize share, prize places and bracket format,
   and lists what it assumed. Check everything, change what you like and save.
2. **Set up the money.** A free tournament can list sponsor prizes. For a paid one, set the entry fee per team, the
   share of the fees for the prize pool (0–90%) and the prize places (top 1 to top 5, shares add up to 100%).
   TurniRUM keeps **10%** of the entry fees, which you confirm before publishing; the rest is your income.
   Once a team has paid, the entry fee and the prizes are locked.
3. **Collect registrations.** Teams register and pay on the tournament page. **My tournaments** shows every team, who
   paid and each PayPal payment. You can add a team manually (it plays without paying), edit rosters and remove teams.
   A team that paid is removed with **Refund & remove**, and PayPal returns its money automatically.
4. **Build the bracket with AI.** In **Bracket and schedule** leave *Format: let the AI decide* or pick one, then press
   **Build bracket with AI**. The AI chooses single or double elimination, round robin or groups + playoffs, seeds the
   teams by their results on TurniRUM and plans match length, breaks, parallel matches and rounds per day.
   Registration closes and every captain gets a notification. Until the first result is in you can **Rebuild with AI**.
5. **Run the matches.** Enter the score of a match and press **Save result**: the winner moves on, in double
   elimination the loser drops to the lower bracket, and group tables and standings update by themselves. **Move**
   changes a match time; later matches of the same teams move along and both teams are notified.
6. **Finish and get paid.** Switch the status to **Finish & pay prizes**. TurniRUM fixes the final places, sends every
   prize to the winners' PayPal with PayPal Payouts, credits 10% to the platform and the rest to your **Wallet**.
   Withdraw it to any PayPal email (from $1). **Business model** shows your income per tournament and has an income
   calculator.

## For players

1. **Find a tournament.** **Tournaments** lists everything that is open, live or finished. Search and filter by game,
   price, status, online or offline, maximum entry fee and free slots.
2. **Register your team.** Press **Join** on the tournament page and enter the team name, the players (up to the team
   size) and, if you like, the PayPal email where prizes should go.
3. **Pay the entry fee.** A free tournament admits you at once. For a paid one, press the PayPal button and pay with a
   PayPal account or a debit or credit card. The server confirms the payment with PayPal and admits your team
   instantly.
   > **Sandbox mode:** choose *Debit or Credit Card* and use the test card `4111 1111 1111 1111` with any future date
   > and any CVV. No real money is charged.
4. **Follow your matches.** The **Bracket** tab shows your next matches and the whole bracket. Can't play at that time?
   Press **Reschedule**. When the captains of both teams have asked, the AI picks a new free time and everyone is
   notified.
5. **Find teammates.** In **Find a team** fill in your card (games, a few words about you, a contact) and turn on
   *I am looking for a team*. **Find teammates** asks the AI for players who suit you, with a reason for each pick, and
   **Invite** sends them your contact.
6. **Get reminded and get paid.** The bell shows bracket news, moved matches, reminders and invitations, and the same
   notices go to your email: 24 hours and 1 hour before a tournament and 1 hour before each match. Prizes arrive on your
   PayPal by themselves; **My tables** shows your standings and the payout status.

## For the platform creator

| Page | What it shows |
|------|---------------|
| Sign in | Sign up or sign in with the creator password. Only its SHA-256 hash is stored. |
| Business model | Platform profit, turnover by game, top organizers and the latest payments. |
| Wallet | 10% of every finished paid tournament, withdrawable to PayPal. |
| Manage | Every tournament. Deleting an unfinished paid tournament refunds all teams first. |
| Payments | The ledger of entry fees, prize payouts and withdrawals with their PayPal status. |
| Users | All accounts with their roles. |

## Payments with PayPal

```
 Player ──PayPal checkout──▶ Edge Function ──Orders v2: create → capture──▶ PayPal
                                   │ verified COMPLETED, exact amount
                                   ▼
                       team admitted (Postgres transaction)
                                   │ organizer presses "Finish & pay prizes"
                                   ▼
          settle_tournament: prizes by place · 10% platform wallet · rest organizer wallet
                                   │
                                   ▼
                    PayPal Payouts v1 ──▶ winners' PayPal accounts
```

1. **Pay** — the team pays with a PayPal account or a card. The order is created by our server with the entry fee
   taken from the database, never from the browser.
2. **Verify** — the server captures the order and checks that PayPal reports `COMPLETED` with the exact amount,
   currency and reference. Only then is the team admitted. If the last slot was taken while the player paid, the
   payment is refunded automatically.
3. **Split** — when the tournament ends: prizes by place, 10% to the platform, the rest to the organizer, in one
   database transaction. Example: 16 teams × $25 = **$400** → prize pool 60% **$240**, organizer 30% **$120**,
   platform 10% **$40**.
4. **Pay out** — prizes and withdrawals go out with PayPal Payouts; statuses are refreshed from PayPal, and a payout
   PayPal returns goes back to the wallet.

Card details are typed into PayPal's own fields and never reach TurniRUM. API keys stay on the server (Edge Function
secrets or server-only settings), and Row Level Security protects every table.

## Where the AI helps

TurniRUM uses Google Gemini for the planning work. The AI suggests, the server checks: a deterministic engine
(`supabase/functions/api/engine.js`) builds every bracket, so it is always valid, and each feature has a fallback.

| Feature | What the AI does | Where | Without the AI |
|---------|------------------|-------|----------------|
| Create with AI | Turns a free-form description in any language into a complete tournament form and lists its assumptions. | Create tournament | You fill in the form yourself |
| Bracket format | Chooses single or double elimination, round robin or groups + playoffs for the number of teams, the game and the time available. | Bracket and schedule | Standard rules by team count |
| Seeding | Distributes the teams so the strongest meet later, using their wins, losses and titles on TurniRUM. | Bracket and schedule | Seeding by results |
| Schedule | Plans match length, breaks, how many matches run at once and how many rounds a day; the engine turns the plan into start times. | Bracket and schedule | Default timing |
| Rescheduling | When both captains press Reschedule, picks a new free time with no clashes for either team; later matches move along. | Bracket tab | The first free slot |
| Reminders | Writes the friendly opening of the reminders sent 24 hours and 1 hour before a tournament. | Email and the bell | A standard text |
| Teammates | Looks at games, level, city and tournament history and explains each suggested teammate in one sentence. | Find a team | Ranking by shared games and level |

## Built with: AI models, APIs and tools

### AI models

| Model | ID | Used for |
|-------|----|----------|
| Gemini 3.6 Flash | `gemini-3.6-flash` | Planning brackets, schedules, tournament drafts and texts (structured JSON output) |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | Fast model that answers first in the chain |
| Gemini Flash-Lite (latest) | `gemini-flash-lite-latest` | Fallback when the other models are overloaded |
| Gemini 3.5 Flash | `gemini-3.5-flash` | Last fallback of the chain |
| Gemini 3.8 Flash TTS | `gemini-3.8-flash-tts` | Text-to-speech voice-over of the demo video |

The server tries the models in turn (`app_settings.gemini_model` / `gemini_models` can put others first) and skips a
model that is overloaded or unavailable.

### APIs

| API | Part | Used for |
|-----|------|----------|
| Gemini API | `generateContent` | All AI features, with JSON Schema answers that the server validates |
| PayPal JavaScript SDK | Buttons | Checkout with a PayPal account or a debit or credit card |
| PayPal REST APIs | OAuth 2.0 · Orders v2 · Payments v2 · Payouts v1 | Order create and capture, refunds, prize payouts and withdrawals (sandbox) |
| Supabase Auth | email + password | Accounts and sessions |
| Supabase Data API | PostgREST + RPC | Every read and write, guarded by Row Level Security |
| Supabase Edge Functions | Deno | Server logic: payments, payouts, refunds, brackets, AI and notifications |
| pg_cron + pg_net | every 10 minutes | Runs the reminders and the email queue |
| Brevo | Transactional Email API v3 | Reminder and notification emails |
| Google Fonts | Manrope · Unbounded | Typography |

### Tools

| Tool | Used for |
|------|----------|
| Supabase (PostgreSQL 17) | Database with Row Level Security, Auth and Edge Functions hosting |
| JavaScript (ES modules), HTML, CSS | The single-page app, without a framework; supabase-js 2.117.3 |
| esbuild | Builds the whole site into one HTML file for Netlify (`tools/build_netlify.py`) |
| Netlify · githack | The public site and per-commit preview links |
| GitHub · GitHub Actions | The open-source repository and the Windows build of the desktop version |
| Playwright · Node.js | Browser tests of every page and randomized tests of the bracket engine |
| Python · Flask · PyInstaller | The offline desktop version (`TurniRUM.exe`) |
| FFmpeg | Editing of the demo video |
| Claude Code (Anthropic) | AI coding assistant used to write, test and deploy the project |

## FAQ

**Is the money real?** No. The site runs on the PayPal sandbox, so every payment, prize and withdrawal uses test
money. Going live only needs live PayPal keys and `PAYPAL_ENV=live` on the server.

**What happens when the AI is busy?** The server tries several Gemini models in turn. If none answers, every feature
falls back to plain rules, so brackets, schedules and reminders still work.

**Where are my card details stored?** Nowhere on TurniRUM. You enter them in PayPal's own fields and PayPal processes
the payment; we only keep the PayPal order and capture IDs.

**Can an organizer change the prizes after teams paid?** No. The entry fee, the prize share and the prize places are
locked as soon as the first team has paid.

**What if a prize cannot be delivered?** It is listed under **Prize payouts** with a **Send again** button. A prize
that cannot be sent automatically goes to the organizer's wallet with a note to pay the winners directly.

**Who sees my contact in Find a team?** Players you invite, and everyone while *I am looking for a team* is on.
