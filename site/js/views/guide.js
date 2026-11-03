// The user guide: how every role uses TurniRUM, how PayPal payments and the AI work, and what the platform is built with.
import { PLATFORM_FEE } from '../config.js';
import { html, icon } from '../ui.js';

const SECTIONS = [
  ['start', 'rocket', 'Getting started'],
  ['organizers', 'trophy', 'For organizers'],
  ['players', 'swords', 'For players'],
  ['creator', 'crown', 'For the platform creator'],
  ['payments', 'card', 'Payments with PayPal'],
  ['ai', 'bot', 'Where the AI helps'],
  ['built-with', 'code', 'Built with'],
  ['faq', 'info', 'FAQ'],
];

const ORGANIZER_STEPS = [
  ['Create a tournament', html`Open <b>Create tournament</b>. Fill in the form yourself, or describe the event in a sentence
    (in any language) under <b>Create with AI</b> and press <b>Fill the form with AI</b>. The AI fills in the title, game,
    description, date and time, online or offline, team limits, entry fee, prize share, prize places and bracket format,
    and lists what it assumed. Check everything, change what you like and save.`],
  ['Set up the money', html`A free tournament can list sponsor prizes. For a paid one, set the entry fee per team, the
    share of the fees for the prize pool (0–90%) and the prize places (top 1 to top 5, shares add up to 100%). TurniRUM
    keeps ${PLATFORM_FEE}% of the entry fees, which you confirm before publishing; the rest is your income. The preview
    shows the split live. Once a team has paid, the entry fee and the prizes are locked.`],
  ['Collect registrations', html`Teams register and pay on the tournament page. <b>My tournaments</b> shows every team,
    who paid and each PayPal payment. You can add a team manually (it plays without paying), edit rosters and remove
    teams. A team that paid is removed with <b>Refund &amp; remove</b>, and PayPal returns its money automatically.`],
  ['Build the bracket with AI', html`In <b>Bracket and schedule</b> leave <i>Format: let the AI decide</i> or pick one,
    then press <b>Build bracket with AI</b>. The AI chooses single or double elimination, round robin or groups + playoffs,
    seeds the teams by their results on TurniRUM and plans match length, breaks, parallel matches and rounds per day.
    Registration closes and every captain gets a notification. Until the first result is in you can <b>Rebuild with AI</b>.`],
  ['Run the matches', html`Enter the score of a match and press <b>Save result</b>: the winner moves on, in double
    elimination the loser drops to the lower bracket, and group tables and standings update by themselves. <b>Move</b>
    changes a match time; later matches of the same teams move along and both teams are notified.`],
  ['Finish and get paid', html`Switch the status to <b>Finish &amp; pay prizes</b>. TurniRUM fixes the final places,
    sends every prize to the winners' PayPal with PayPal Payouts, credits ${PLATFORM_FEE}% to the platform and the rest to
    your <b>Wallet</b>. Withdraw it to any PayPal email (from $1). <b>Business model</b> shows your income per tournament
    and has an income calculator.`],
];

const PLAYER_STEPS = [
  ['Find a tournament', html`<b>Tournaments</b> lists everything that is open, live or finished. Search and filter by
    game, price, status, online or offline, maximum entry fee and free slots.`],
  ['Register your team', html`Press <b>Join</b> on the tournament page and enter the team name, the players (up to the
    team size) and, if you like, the PayPal email where prizes should go.`],
  ['Pay the entry fee', html`A free tournament admits you at once. For a paid one, press the PayPal button and pay with a
    PayPal account or a debit or credit card. The server confirms the payment with PayPal and admits your team instantly.
    <span class="guide-note">Sandbox mode: choose <i>Debit or Credit Card</i> and use the test card
    <b class="mono">4111 1111 1111 1111</b> with any future date and any CVV. No real money is charged.</span>`],
  ['Follow your matches', html`The <b>Bracket</b> tab shows your next matches and the whole bracket. Can't play at that
    time? Press <b>Reschedule</b>. When the captains of both teams have asked, the AI picks a new free time and everyone is
    notified.`],
  ['Find teammates', html`In <b>Find a team</b> fill in your card (games, a few words about you, a contact) and turn on
    <i>I am looking for a team</i>. <b>Find teammates</b> asks the AI for players who suit you, with a reason for each
    pick, and <b>Invite</b> sends them your contact.`],
  ['Get reminded and get paid', html`The bell shows bracket news, moved matches, reminders and invitations, and the same
    notices go to your email: 24 hours and 1 hour before a tournament and 1 hour before each match. Prizes arrive on your
    PayPal by themselves; <b>My tables</b> shows your standings and the payout status.`],
];

const CREATOR_POINTS = [
  ['crown', 'Sign in', 'Sign up or sign in with the creator password. Only its SHA-256 hash is stored.'],
  ['pie', 'Business model', 'Platform profit, turnover by game, top organizers and the latest payments.'],
  ['wallet', 'Platform wallet', `${PLATFORM_FEE}% of every finished paid tournament, withdrawable to PayPal.`],
  ['shield', 'Manage', 'Every tournament on the platform. Deleting an unfinished paid tournament refunds all teams first.'],
  ['receipt', 'Payments', 'The ledger of entry fees, prize payouts and withdrawals with their PayPal status.'],
  ['users', 'Users', 'All accounts with their roles.'],
];

const MONEY_FLOW = [
  ['card', 'Pay', 'The team pays with a PayPal account or a card. The order is created by our server with the fee taken from the database.'],
  ['shield', 'Verify', 'The server captures the order and checks that PayPal reports COMPLETED with the exact amount. Only then is the team admitted.'],
  ['pie', 'Split', `When the tournament ends: prizes by place, ${PLATFORM_FEE}% to the platform, the rest to the organizer, in one database transaction.`],
  ['send', 'Pay out', 'Prizes and withdrawals go out with PayPal Payouts. A payout PayPal returns goes back to the wallet.'],
];

const AI_FEATURES = [
  ['Create with AI', 'Turns a free-form description in any language into a complete tournament form, and lists its assumptions.', 'Create tournament', 'You fill in the form yourself'],
  ['Bracket format', 'Chooses single or double elimination, round robin or groups + playoffs for the number of teams, the game and the time available.', 'Bracket and schedule', 'Standard rules by team count'],
  ['Seeding', 'Distributes the teams so the strongest meet later, using their wins, losses and titles on TurniRUM.', 'Bracket and schedule', 'Seeding by results'],
  ['Schedule', 'Plans match length, breaks, how many matches run at once and how many rounds a day; the engine turns the plan into start times.', 'Bracket and schedule', 'Default timing'],
  ['Rescheduling', 'When both captains press Reschedule, picks a new free time with no clashes for either team; later matches move along.', 'Bracket tab', 'The first free slot'],
  ['Reminders', 'Writes the friendly opening of the reminders sent 24 hours and 1 hour before a tournament.', 'Email and the bell', 'A standard text'],
  ['Teammates', 'Looks at games, level, city and tournament history and explains each suggested teammate in one sentence.', 'Find a team', 'Ranking by shared games and level'],
];

const BUILT_WITH = [
  ['sparkles', 'AI models', [
    ['Gemini 3.6 Flash', 'gemini-3.6-flash', 'Google’s model for planning brackets, schedules, drafts and texts (structured JSON output).'],
    ['Gemini 3.5 Flash-Lite', 'gemini-3.5-flash-lite', 'Fast model that answers first in our chain.'],
    ['Gemini Flash-Lite (latest)', 'gemini-flash-lite-latest', 'Fallback when the other models are overloaded.'],
    ['Gemini 3.5 Flash', 'gemini-3.5-flash', 'Last fallback of the chain.'],
    ['Gemini 3.8 Flash TTS', 'gemini-3.8-flash-tts', 'Text-to-speech voice-over of the demo video (voice “Charon”).'],
    ['Gemini 2.5 Flash TTS', 'gemini-2.5-flash-preview-tts', 'Voice-over of the last three scenes of the demo video, same voice.'],
  ]],
  ['plug', 'APIs', [
    ['Gemini API', 'generateContent', 'All AI features, with JSON Schema answers that the server validates.'],
    ['PayPal JavaScript SDK', 'Buttons', 'Checkout with a PayPal account or a debit or credit card.'],
    ['PayPal REST APIs', 'Orders v2 · Payments v2 · Payouts v1', 'OAuth 2.0, order create and capture, refunds, prize payouts and withdrawals (sandbox).'],
    ['Supabase Auth', 'email + password', 'Accounts and sessions.'],
    ['Supabase Data API', 'PostgREST + RPC', 'Every read and write, guarded by Row Level Security.'],
    ['Supabase Edge Functions', 'Deno', 'Server logic: payments, payouts, refunds, brackets, AI and notifications.'],
    ['pg_cron + pg_net', 'every 10 minutes', 'Runs the reminders and the email queue.'],
    ['Brevo', 'Transactional Email API v3', 'Reminder and notification emails.'],
    ['Google Fonts', 'Manrope · Unbounded', 'Typography.'],
  ]],
  ['wrench', 'Tools', [
    ['Supabase', 'PostgreSQL 17', 'Database with Row Level Security, Auth and Edge Functions hosting.'],
    ['JavaScript, HTML, CSS', 'ES modules', 'The single-page app, without a framework; supabase-js 2.117.3.'],
    ['esbuild', 'bundler', 'Builds the whole site into one HTML file for Netlify.'],
    ['Netlify · githack', 'hosting', 'The public site and per-commit preview links.'],
    ['GitHub · GitHub Actions', 'code + CI', 'The open-source repository and the Windows build of the desktop version.'],
    ['Playwright · Node.js', 'tests', 'Browser tests of every page and randomized tests of the bracket engine.'],
    ['Python · Flask · PyInstaller', 'desktop', 'The offline desktop version (TurniRUM.exe).'],
    ['FFmpeg · Playwright', 'demo video', 'Recording the real UI, motion graphics, editing and subtitles of the demo video.'],
    ['Claude Code', 'Anthropic', 'AI coding assistant used to write, test and deploy the project.'],
  ]],
];

const FAQ = [
  ['Is the money real?', 'No. The site runs on the PayPal sandbox, so every payment, prize and withdrawal uses test money. Going live only needs live PayPal keys and PAYPAL_ENV=live on the server.'],
  ['What happens when the AI is busy?', 'The server tries several Gemini models in turn. If none answers, every feature falls back to plain rules, so brackets, schedules and reminders still work.'],
  ['Where are my card details stored?', 'Nowhere on TurniRUM. You enter them in PayPal’s own fields and PayPal processes the payment; we only keep the PayPal order and capture IDs.'],
  ['Can an organizer change the prizes after teams paid?', 'No. The entry fee, the prize share and the prize places are locked as soon as the first team has paid.'],
  ['What if a prize cannot be delivered?', 'It is listed under Prize payouts with a Send again button. A prize that cannot be sent automatically goes to the organizer’s wallet with a note to pay the winners directly.'],
  ['Who sees my contact in Find a team?', 'Players you invite, and everyone while “I am looking for a team” is on.'],
];

function steps(list) {
  return html`<ol class="guide-steps">${list.map(([title, text], i) => html`
    <li class="guide-step reveal"><span class="step-n">${i + 1}</span><div><h3>${title}</h3><p>${text}</p></div></li>`)}</ol>`;
}

function section(id, ic, title, lead, body) {
  return html`
    <section class="card card-pad guide-section" data-section="${id}">
      <h2 class="guide-h">${icon(ic, 22)} ${title}</h2>
      ${lead ? html`<p class="guide-lead">${lead}</p>` : ''}
      ${body}
    </section>`;
}

export function guideView({ profile }) {
  return {
    title: 'Guide',
    html: html`
      <div class="container">
        <div class="page-head guide-head">
          <div>
            <span class="eyebrow">${icon('book', 14)} User guide</span>
            <h1>How TurniRUM works</h1>
            <p class="muted">Everything about running a tournament or playing in one: accounts and roles, the organizer's
              and the player's workflow, PayPal payments and prizes, the AI assistant and the technology behind it.</p>
          </div>
          <div class="hero-actions">
            ${profile ? '' : html`<a class="btn btn-primary" href="#/register">${icon('user', 16)} Create an account</a>`}
            <a class="btn btn-ghost" href="#/tournaments">${icon('search', 16)} Browse tournaments</a>
          </div>
        </div>

        <div class="guide-grid">
          <aside class="guide-toc">
            <nav class="card guide-toc-card" aria-label="Guide sections">
              ${SECTIONS.map(([id, ic, label]) => html`<button type="button" class="guide-toc-link" data-jump="${id}">${icon(ic, 15)} ${label}</button>`)}
            </nav>
          </aside>

          <div class="guide-body">
            ${section('start', 'rocket', 'Getting started', 'TurniRUM has three kinds of accounts. Pick yours when you sign up; the menu then shows the pages for your role.', html`
              <div class="guide-roles">
                <div class="guide-role reveal"><span class="role-option-icon role-org">${icon('trophy', 20)}</span><div><b>Organizer</b><small>Hosts free or paid tournaments, lets the AI build the bracket and withdraws the income.</small></div></div>
                <div class="guide-role reveal"><span class="role-option-icon role-player">${icon('swords', 20)}</span><div><b>Player</b><small>Finds tournaments, registers a team, pays with PayPal and receives prizes automatically.</small></div></div>
                <div class="guide-role reveal"><span class="role-option-icon role-creator">${icon('crown', 20)}</span><div><b>Platform creator</b><small>Earns ${PLATFORM_FEE}% of every paid tournament and manages the whole platform.</small></div></div>
              </div>
              <div class="hint guide-demo">${icon('info', 16)}
                <span>Try it with the demo accounts — organizer: <b>organizer@example.com</b>, players: <b>player1@example.com</b> … <b>player4@example.com</b>,
                  password <b>demo1234</b>. Payments run in PayPal sandbox mode, so no real money is involved.</span>
              </div>`)}

            ${section('organizers', 'trophy', 'For organizers', 'From an idea to paid-out prizes in six steps.', steps(ORGANIZER_STEPS))}

            ${section('players', 'swords', 'For players', 'Register, pay, play and get your prize without chasing anyone.', steps(PLAYER_STEPS))}

            ${section('creator', 'crown', 'For the platform creator', `The creator account receives the ${PLATFORM_FEE}% platform fee and sees everything.`, html`
              <div class="guide-points">${CREATOR_POINTS.map(([ic, title, text]) => html`
                <div class="guide-point reveal"><span class="kpi-icon">${icon(ic, 17)}</span><div><b>${title}</b><small>${text}</small></div></div>`)}</div>`)}

            ${section('payments', 'card', 'Payments with PayPal', 'Entry fees, prizes, withdrawals and refunds all go through PayPal and are checked on the server.', html`
              <div class="guide-flow">${MONEY_FLOW.map(([ic, title, text], i) => html`
                <div class="guide-flow-step reveal"><span class="guide-flow-icon">${icon(ic, 20)}</span><b>${i + 1}. ${title}</b><small>${text}</small></div>`)}</div>
              <div class="guide-example">
                <div><small>Example</small><b>16 teams × $25 = $400</b></div>
                <div><i class="sw sw-prize"></i><span>Prize pool 60%</span><b>$240</b></div>
                <div><i class="sw sw-org"></i><span>Organizer 30%</span><b>$120</b></div>
                <div><i class="sw sw-platform"></i><span>Platform ${PLATFORM_FEE}%</span><b>$40</b></div>
              </div>
              <ul class="check-list guide-checks">
                <li>${icon('check', 16)} Card details are typed into PayPal's own fields and never reach TurniRUM.</li>
                <li>${icon('check', 16)} The price comes from the database, never from the browser, and every capture is verified.</li>
                <li>${icon('check', 16)} If the last slot was taken while you paid, the payment is refunded automatically.</li>
                <li>${icon('check', 16)} API keys stay on the server; Row Level Security protects every table.</li>
              </ul>`)}

            ${section('ai', 'bot', 'Where the AI helps', 'TurniRUM uses Google Gemini for the planning work. The AI suggests, the server checks: a deterministic engine builds every bracket, so it is always valid, and each feature has a fallback.', html`
              <div class="table-wrap">
                <table class="standings guide-table">
                  <thead><tr><th>Feature</th><th>What the AI does</th><th>Where</th><th>Without the AI</th></tr></thead>
                  <tbody>${AI_FEATURES.map(([name, what, where, fallback]) => html`
                    <tr><td><b>${icon('sparkles', 14)} ${name}</b></td><td>${what}</td><td class="nowrap">${where}</td><td class="muted">${fallback}</td></tr>`)}</tbody>
                </table>
              </div>`)}

            ${section('built-with', 'code', 'Built with', 'The AI models, APIs and tools behind TurniRUM. The code is open source under the MIT license.', html`
              <div class="guide-stack">${BUILT_WITH.map(([ic, title, items]) => html`
                <div class="guide-stack-col">
                  <h3>${icon(ic, 18)} ${title}</h3>
                  <ul>${items.map(([name, tag, text]) => html`
                    <li><div><b>${name}</b><code>${tag}</code></div><small>${text}</small></li>`)}</ul>
                </div>`)}</div>`)}

            ${section('faq', 'info', 'FAQ', '', html`
              <div class="guide-faq">${FAQ.map(([q, a]) => html`
                <details class="guide-faq-item"><summary>${q}</summary><p>${a}</p></details>`)}</div>`)}
          </div>
        </div>
      </div>`,
    mount(root) {
      root.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => {
        root.querySelector(`[data-section="${button.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
    },
  };
}
