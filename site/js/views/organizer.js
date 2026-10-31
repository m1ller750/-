import * as api from '../api.js';
import { MAX_PRIZE_PERCENT, PLATFORM_FEE } from '../config.js';
import { PRIZE_PRESETS, split, splitOk, splitTotal, sumSplits, toCents, tournamentFinance } from '../finance.js';
import { GAME_NAMES, gameStyle } from '../games.js';
import {
  busy, centsToMoney, confirmDialog, countdown, coverStyle, donut, emptyState, formValues, formatDate, gameTile, html,
  icon, kpi, messagePage, money, notFound, ordinal, paymentBadge, payoutBadge, placeBadge, plural, priceBadge, prizePlaces,
  showFieldErrors, splitLegend, splitMembers, standings, standingsTable, statusBadge, toast,
} from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function ownTournaments(profile) {
  const all = await api.listTournaments();
  const rank = { active: 0, registration: 1, finished: 2 };
  return all.filter((t) => t.organizer_id === profile.id)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.start_at.localeCompare(b.start_at));
}

// Mirrors the checks in public.save_tournament so mistakes show up next to the right field.
function validateTournament(v, isNew, prizeSplit, needsAck) {
  const errors = {};
  const start = new Date(`${v.start_date}T${v.start_time || '18:00'}`);
  if (v.title.trim().length < 3 || v.title.trim().length > 80) errors.title = 'The title must be 3–80 characters long.';
  if (!v.game.trim()) errors.game = 'Choose the game or discipline.';
  if (v.description.length > 2000) errors.description = 'Keep the description under 2,000 characters.';
  if (Number.isNaN(start.getTime())) errors.start_date = 'Choose the start date and time.';
  else if (isNew && start.getTime() < Date.now() - 86_400_000) errors.start_date = 'The start date cannot be in the past.';
  if (v.format === 'offline' && !v.city.trim()) errors.city = 'Add the city and venue for an offline tournament.';
  const maxTeams = Number(v.max_teams);
  if (!Number.isInteger(maxTeams) || maxTeams < 2 || maxTeams > 256) errors.max_teams = 'From 2 to 256 teams.';
  const teamSize = Number(v.team_size);
  if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 12) errors.team_size = 'From 1 to 12 players.';
  if (v.is_paid === '1') {
    const fee = Number(v.entry_fee);
    if (!Number.isFinite(fee) || fee < 1 || fee > 10000) errors.entry_fee = 'Enter an amount from $1 to $10,000.';
    if (!splitOk(prizeSplit)) errors.prize_split = `Prize places must add up to 100% (now ${splitTotal(prizeSplit)}%).`;
    if (needsAck && !v.fee_ack) errors.fee_ack = 'Please confirm that TurniRUM keeps 10% of the entry fees.';
  }
  return { errors, start };
}

// --------------------------------------------------------- create / edit --

export async function tournamentFormView({ params, profile, navigate }) {
  const editing = params.id !== undefined;
  let t = null;
  if (editing) {
    t = await api.getTournament(Number(params.id));
    if (!t || t.organizer_id !== profile.id) return notFound();
    if (t.settled_at) return messagePage('Final', 'This tournament is closed', 'Its prizes were distributed, so it can no longer be edited.');
  }
  // Once a team has paid, the money rules of the tournament stay as they were.
  const locked = editing && t.paid_count > 0;
  const acked = Boolean(t?.fee_ack_at);
  let prizeSplit = [...(t?.prize_split ?? PRIZE_PRESETS[3])];
  const start = t ? new Date(t.start_at) : null;
  const v = {
    title: t?.title ?? '', game: t?.game ?? '', description: t?.description ?? '', format: t?.format ?? 'online',
    city: t?.city ?? '', start_date: start ? localDate(start) : '', start_time: start ? localTime(start) : '18:00',
    max_teams: t?.max_teams ?? 16, team_size: t?.team_size ?? 5, is_paid: t?.is_paid ? '1' : '0',
    entry_fee: t?.is_paid ? Number(t.entry_fee) : '', prize_percent: t?.prize_percent ?? 60, prize_note: t?.prize_note ?? '',
  };
  const lock = locked ? 'disabled' : '';

  return {
    title: editing ? 'Tournament settings' : 'New tournament',
    html: html`
      <section class="container">
        ${editing ? html`<a class="back-link" href="#/organizer?id=${t.id}">${icon('back', 16)} ${t.title}</a>` : ''}
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('trophy', 14)} ${editing ? 'Settings' : 'New tournament'}</span>
            <h1>${editing ? 'Tournament settings' : 'Create a tournament'}</h1>
            <p class="muted">${editing ? 'Players see the changes right away.' : 'Fill in the details — the tournament appears in the catalog with registration open.'}</p>
          </div>
        </div>

        <form class="form-layout" novalidate data-tournament-form>
          <div class="form-main">
            <div class="card card-pad">
              <div class="step-title"><span class="step-n">1</span><h3>Basics</h3></div>
              <label class="field" data-field="title">
                <span class="label">Tournament title</span>
                <input class="input input-lg" name="title" value="${v.title}" maxlength="80" placeholder="Steppe Cup 2026" required>
              </label>
              <label class="field" data-field="game">
                <span class="label">Game or discipline</span>
                <span class="input-icon">${icon('gamepad', 17)}<input class="input" name="game" value="${v.game}" list="games" maxlength="40" placeholder="Counter-Strike 2" required></span>
                <datalist id="games">${GAME_NAMES.map((name) => html`<option value="${name}">`)}</datalist>
              </label>
              <div class="quick-games">${GAME_NAMES.slice(0, 8).map((name) => html`<button type="button" class="chip chip-sm" data-fill-game="${name}">${name}</button>`)}</div>
              <label class="field" data-field="description">
                <span class="label">Description and rules</span>
                <textarea class="textarea" name="description" rows="5" maxlength="2000" placeholder="Match format, rules, schedule, how to reach you…">${v.description}</textarea>
              </label>
            </div>

            <div class="card card-pad">
              <div class="step-title"><span class="step-n">2</span><h3>When and where</h3></div>
              <div class="form-row">
                <label class="field" data-field="start_date">
                  <span class="label">Start date</span>
                  <input class="input" type="date" name="start_date" value="${v.start_date}" ${editing ? '' : html`min="${localDate(new Date())}"`} required>
                </label>
                <label class="field" data-field="start_time">
                  <span class="label">Start time</span>
                  <input class="input" type="time" name="start_time" value="${v.start_time}">
                </label>
              </div>
              <div class="field">
                <span class="label">Format</span>
                <div class="segmented segmented-lg">
                  <input type="radio" name="format" id="format-online" value="online" ${v.format === 'online' ? 'checked' : ''}>
                  <label for="format-online">${icon('globe', 16)} Online</label>
                  <input type="radio" name="format" id="format-offline" value="offline" ${v.format === 'offline' ? 'checked' : ''}>
                  <label for="format-offline">${icon('pin', 16)} Offline</label>
                </div>
              </div>
              <label class="field" data-field="city" data-city ${v.format === 'offline' ? '' : 'hidden'}>
                <span class="label">City and venue</span>
                <span class="input-icon">${icon('pin', 17)}<input class="input" name="city" value="${v.city}" maxlength="80" placeholder="Almaty, Esports Arena"></span>
              </label>
            </div>

            <div class="card card-pad">
              <div class="step-title"><span class="step-n">3</span><h3>Teams</h3></div>
              <div class="form-row">
                <label class="field" data-field="max_teams">
                  <span class="label">Maximum teams</span>
                  <input class="input" type="number" name="max_teams" value="${v.max_teams}" min="2" max="256" required>
                </label>
                <label class="field" data-field="team_size">
                  <span class="label">Players per team</span>
                  <input class="input" type="number" name="team_size" value="${v.team_size}" min="1" max="12" required>
                </label>
              </div>
            </div>

            <div class="card card-pad">
              <div class="step-title"><span class="step-n">4</span><h3>Entry fee</h3></div>
              ${locked ? html`<div class="hint hint-lock">${icon('lock', 16)} <span>Teams have already paid, so the entry fee and the prizes are locked.</span></div>` : ''}
              <div class="segmented segmented-lg segmented-wide">
                <input type="radio" name="is_paid" id="paid-0" value="0" ${v.is_paid === '0' ? 'checked' : ''} ${lock}>
                <label for="paid-0">${icon('gift', 16)} Free</label>
                <input type="radio" name="is_paid" id="paid-1" value="1" ${v.is_paid === '1' ? 'checked' : ''} ${lock}>
                <label for="paid-1">${icon('coins', 16)} Paid (PayPal)</label>
              </div>
              <div class="paid-fields" data-paid-only ${v.is_paid === '1' ? '' : 'hidden'}>
                <label class="field" data-field="entry_fee">
                  <span class="label">Entry fee per team, USD</span>
                  <span class="input-icon">${icon('coins', 17)}<input class="input" type="number" name="entry_fee" value="${v.entry_fee}" min="1" max="10000" step="0.5" placeholder="25" ${lock}></span>
                </label>
                <div class="field" data-field="prize_percent">
                  <div class="range-head">
                    <span class="label">Share of entry fees for the prize pool</span>
                    <b class="range-value"><output data-prize-out>${v.prize_percent}</output>%</b>
                  </div>
                  <input class="range range-prize" type="range" name="prize_percent" min="0" max="${MAX_PRIZE_PERCENT}" step="5" value="${v.prize_percent}" ${lock}>
                  <div class="range-scale"><span>0%</span><span>The rest is yours. ${PLATFORM_FEE}% always goes to the platform</span><span>${MAX_PRIZE_PERCENT}%</span></div>
                </div>
                <div class="field" data-field="prize_split" data-prize-split>
                  <div class="range-head">
                    <span class="label">Prize places</span>
                    <b class="split-sum" data-split-sum></b>
                  </div>
                  <div class="segmented" role="group" aria-label="Number of prize places">
                    ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class="seg-btn" data-places="${n}" ${lock}>Top ${n}</button>`)}
                  </div>
                  <div class="split-inputs" data-split-inputs></div>
                  <small class="muted">Shares of the prize pool. When you finish the tournament, TurniRUM sends each prize to the winning team's PayPal automatically.</small>
                </div>
                <div class="fee-notice" data-field="fee_ack">
                  <span class="fee-notice-icon">${PLATFORM_FEE}%</span>
                  <div>
                    <b>TurniRUM keeps ${PLATFORM_FEE}% of the entry fees</b>
                    <p>From every entry fee paid for this tournament, ${PLATFORM_FEE}% goes to the TurniRUM platform. The other ${MAX_PRIZE_PERCENT}% is yours: the prize pool is paid to the winners automatically and the rest goes to your wallet, from where you withdraw it to PayPal.</p>
                    <label class="check"><input type="checkbox" name="fee_ack" ${acked ? 'checked' : ''} ${acked ? 'disabled' : ''}><span>I understand and agree that ${PLATFORM_FEE}% of the entry fees goes to TurniRUM</span></label>
                  </div>
                </div>
              </div>
              <label class="field" data-field="prize_note">
                <span class="label">Sponsor prizes <em class="muted">(optional)</em></span>
                <span class="input-icon">${icon('gift', 17)}<input class="input" name="prize_note" value="${v.prize_note}" maxlength="200" placeholder="Gear, merch, subscriptions…"></span>
              </label>
            </div>
          </div>

          <aside class="form-side">
            <div class="side-sticky">
              <div class="card preview-card">
                <div class="t-cover" data-preview-cover>
                  <span class="t-cover-abbr" data-preview-abbr>?</span>
                  <span class="t-cover-badges"><span class="badge badge-registration"><i class="dot"></i>Registration open</span><span class="badge" data-preview-price></span></span>
                  <span class="t-cover-game">${icon('gamepad', 14)} <span data-preview-game>Game</span></span>
                </div>
                <div class="t-body">
                  <h3 class="t-title" data-preview-title>Tournament title</h3>
                  <small class="muted">This is how it looks in the catalog</small>
                </div>
              </div>

              <div class="card card-pad" data-paid-only ${v.is_paid === '1' ? '' : 'hidden'}>
                <div class="payout-card">
                  <div class="payout-card-top"><span class="paypal-word paypal-word-lg">PayPal</span><span class="badge badge-glass">${icon('shield', 13)} Verified checkout</span></div>
                  <div><small>Prizes go to</small><b>the winners' PayPal, automatically</b></div>
                  <div class="payout-card-bottom"><span>Players pay</span><b data-preview-fee>—</b></div>
                </div>
                <h4 class="split-title">With a full roster</h4>
                <div class="calc-total"><small>Total revenue</small><b data-out="total">$0</b></div>
                <div class="stack-bar"><span class="seg-prize" data-seg="prize"></span><span class="seg-org" data-seg="organizer"></span><span class="seg-platform" data-seg="platform"></span></div>
                <ul class="legend legend-compact">
                  <li><i class="sw sw-prize"></i><span>Prize pool</span><em data-pct="prize"></em><b data-out="prize"></b></li>
                  <li class="is-hl"><i class="sw sw-org"></i><span>Your income</span><em data-pct="organizer"></em><b data-out="organizer"></b></li>
                  <li><i class="sw sw-platform"></i><span>Platform</span><em data-pct="platform"></em><b data-out="platform"></b></li>
                </ul>
                <div data-preview-places></div>
              </div>

              <div class="alert alert-error" data-error hidden></div>
              <button class="btn btn-primary btn-lg btn-block" type="submit">
                ${editing ? html`${icon('save', 18)} Save changes` : html`${icon('sparkles', 18)} Create tournament`}
              </button>
            </div>
          </aside>
        </form>
      </section>`,

    mount(root) {
      const form = root.querySelector('[data-tournament-form]');
      const $ = (sel) => root.querySelector(sel);
      const errorBox = $('[data-error]');

      // Disabled (locked) fields are not part of the form values, so they come from the saved tournament.
      const readValues = () => {
        const values = formValues(form);
        if (locked) Object.assign(values, { is_paid: t.is_paid ? '1' : '0', entry_fee: t.entry_fee, prize_percent: t.prize_percent });
        return values;
      };
      const refresh = () => {
        const values = readValues();
        const paid = values.is_paid === '1';
        root.querySelectorAll('[data-paid-only]').forEach((el) => { el.hidden = !paid; });
        $('[data-city]').hidden = values.format !== 'offline';

        const st = gameStyle(values.game.trim() || '?');
        const cover = $('[data-preview-cover]');
        cover.style.setProperty('--c1', st.c1);
        cover.style.setProperty('--c2', st.c2);
        $('[data-preview-abbr]').textContent = values.game.trim() ? st.abbr : '?';
        $('[data-preview-game]').textContent = values.game.trim() || 'Game';
        $('[data-preview-title]').textContent = values.title.trim() || 'Tournament title';
        const price = $('[data-preview-price]');
        price.className = `badge ${paid ? 'badge-paid' : 'badge-free'}`;
        price.textContent = paid ? (Number(values.entry_fee) > 0 ? money(values.entry_fee) : 'Paid') : 'Free';

        const range = form.elements.prize_percent;
        const prizePercent = Number(range.value);
        $('[data-prize-out]').textContent = prizePercent;
        range.style.setProperty('--fill', `${(prizePercent * 100) / MAX_PRIZE_PERCENT}%`);
        const fee = Number(values.entry_fee);
        $('[data-preview-fee]').textContent = fee > 0 ? `${money(fee)} per team` : '—';
        $('[data-prize-split]').hidden = prizePercent === 0;

        const total = splitTotal(prizeSplit);
        const sum = $('[data-split-sum]');
        sum.textContent = `${total}%`;
        sum.classList.toggle('is-bad', total !== 100);
        root.querySelectorAll('[data-places]').forEach((button) => {
          button.classList.toggle('is-on', Number(button.dataset.places) === prizeSplit.length);
        });

        const s = split(toCents(fee) * Math.max(0, Number(values.max_teams) || 0), prizePercent);
        $('[data-preview-places]').innerHTML = prizePercent && splitOk(prizeSplit)
          ? prizePlaces({ prize_split: prizeSplit }, s.prize).toString() : '';
        root.querySelectorAll('[data-out]').forEach((el) => { el.textContent = centsToMoney(s[el.dataset.out]); });
        root.querySelectorAll('[data-pct]').forEach((el) => { el.textContent = `${s[`${el.dataset.pct}Percent`]}%`; });
        root.querySelectorAll('[data-seg]').forEach((el) => { el.style.flexGrow = Math.max(0.001, s[`${el.dataset.seg}Percent`]); });
      };

      const splitBox = $('[data-split-inputs]');
      const renderSplit = () => {
        splitBox.innerHTML = prizeSplit.map((pct, i) => html`
          <label class="split-input">${placeBadge(i + 1)}<span>${ordinal(i + 1)}</span>
            <input class="input" type="number" min="1" max="100" step="1" value="${pct}" data-pct="${i}" aria-label="${ordinal(i + 1)} place share" ${lock}><em>%</em>
          </label>`).join('');
      };
      splitBox.addEventListener('input', (event) => {
        const i = event.target.dataset.pct;
        if (i === undefined) return;
        prizeSplit[Number(i)] = Math.round(Number(event.target.value) || 0);
      });
      root.querySelectorAll('[data-places]').forEach((button) => button.addEventListener('click', () => {
        prizeSplit = [...PRIZE_PRESETS[Number(button.dataset.places)]];
        renderSplit();
        refresh();
      }));
      renderSplit();

      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      root.querySelectorAll('[data-fill-game]').forEach((button) => button.addEventListener('click', () => {
        form.elements.game.value = button.dataset.fillGame;
        refresh();
      }));
      refresh();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = readValues();
        const { errors, start } = validateTournament(values, !editing, prizeSplit, !acked);
        showFieldErrors(form, errors);
        errorBox.hidden = true;
        if (Object.keys(errors).length) {
          toast('Please check the highlighted fields.', 'error');
          return;
        }
        const paid = values.is_paid === '1';
        const data = {
          title: values.title.trim(), game: values.game.trim(), description: values.description.trim(),
          format: values.format, city: values.format === 'offline' ? values.city.trim() : '',
          start_at: start.toISOString(), max_teams: Number(values.max_teams), team_size: Number(values.team_size),
          is_paid: paid, entry_fee: paid ? Number(values.entry_fee) : 0,
          prize_percent: Number(values.prize_percent), prize_split: locked ? t.prize_split : prizeSplit,
          prize_note: values.prize_note.trim(), fee_ack: acked || Boolean(values.fee_ack),
        };
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            const id = await api.saveTournament(editing ? t.id : null, data);
            toast(editing ? 'Changes saved.' : `“${data.title}” is live and open for registration!`, 'success');
            navigate(`/organizer?id=${id}`);
          } catch (error) {
            errorBox.innerHTML = html`${icon('alert', 18)} ${error.message}`.toString();
            errorBox.hidden = false;
          }
        });
      });
    },
  };
}

// --------------------------------------------------------- my tournaments --

function paymentCell(t, team) {
  if (!t.is_paid) return '';
  if (team.payment_method === 'paypal') {
    return html`<td class="num"><span class="badge pay-badge pay-completed" title="Verified PayPal payment">${icon('check', 12)} PayPal</span><small class="pay-note">${money(team.paid_amount)}</small></td>`;
  }
  return html`<td class="num"><span class="badge pay-badge pay-created" title="${team.captain_id ? 'Has not paid the entry fee' : 'Added by you without an entry fee'}">${team.captain_id ? 'Unpaid' : 'Invited'}</span></td>`;
}

const inTransit = (p) => p.status === 'sent' || p.status === 'unclaimed';

// Loads payouts and, if some are still on their way, asks PayPal for news first.
export async function withFreshPayouts(load) {
  const payouts = await load();
  if (!payouts.some(inTransit)) return payouts;
  return (await api.refreshPayouts().catch(() => 0)) ? load() : payouts;
}

export function payoutsTable(payouts, { prizes = false, resend = false } = {}) {
  return html`
    <div class="table-wrap">
      <table class="standings">
        <thead><tr>
          <th>Date</th>${prizes ? html`<th class="num">Place</th><th>Team</th>` : ''}<th>PayPal account</th>
          <th class="num">Amount</th><th class="num">Status</th>
        </tr></thead>
        <tbody>
          ${payouts.map((p) => html`
            <tr>
              <td class="nowrap muted">${formatDate(p.created_at, { time: true, short: true })}</td>
              ${prizes ? html`<td class="num">${placeBadge(p.place)}</td><td><b>${p.team_name}</b>${p.tournament_id ? '' : html`<small class="pay-note">${p.tournament_title}</small>`}</td>` : ''}
              <td class="muted">${p.receiver_email}</td>
              <td class="num nowrap"><b>${money(p.amount)}</b></td>
              <td class="num">${payoutBadge(p.status)}
                ${p.status === 'unclaimed' ? html`<small class="pay-note">The receiver has to claim it in PayPal</small>` : ''}
                ${p.failure_reason ? html`<small class="pay-note" title="${p.failure_reason}">${p.failure_reason}</small>` : ''}
                ${resend && p.status === 'queued' ? html`<button class="btn btn-ghost btn-sm" type="button" data-resend="${p.id}">${icon('refresh', 14)} Send again</button>` : ''}
              </td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

export function bindResend(root, reload) {
  root.querySelectorAll('[data-resend]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
    try {
      const { payout } = await api.resendPayout(Number(button.dataset.resend));
      toast(payout.status === 'queued' ? payout.failure_reason || 'PayPal did not accept it yet.' : 'Sent with PayPal.',
        payout.status === 'queued' ? 'warning' : 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  })));
}

// Asks for confirmation with the exact money the database will move, then settles the tournament.
async function finishPaidTournament(t, reload) {
  const plan = await api.settlementPreview(t.id);
  const lines = [
    `Collected with PayPal: ${centsToMoney(plan.collected)}`,
    `Platform fee (${PLATFORM_FEE}%): ${centsToMoney(plan.platform)} · to your wallet: ${centsToMoney(plan.organizer)}`,
  ];
  const prizes = plan.places.filter((place) => place.amount > 0);
  if (prizes.length) {
    lines.push('', 'Prizes:');
    for (const place of prizes) {
      const where = !place.team_id ? 'nobody finished there, goes to your wallet'
        : place.has_email ? `${place.team_name}, sent to their PayPal` : `${place.team_name}, no PayPal email: goes to your wallet`;
      lines.push(`${ordinal(place.place)} place: ${centsToMoney(place.amount)} · ${where}`);
    }
  }
  lines.push('', 'The standings become final.');
  const ok = await confirmDialog({ title: 'Finish and pay the prizes?', text: lines.join('\n'), ok: 'Finish & pay', tone: 'primary' });
  if (!ok) return;
  const { payouts } = await api.finishTournament(t.id);
  const waiting = payouts.filter((p) => p.status === 'queued').length;
  if (waiting) toast(`The tournament is finished, but ${plural(waiting, 'prize', 'prizes')} could not be sent yet. See “Prize payouts”.`, 'warning');
  else toast(payouts.length ? `The tournament is finished. ${plural(payouts.length, 'prize was', 'prizes were')} sent with PayPal!` : 'The tournament is finished.', 'success');
  reload();
}

export async function manageView({ query, profile, reload }) {
  const tournaments = await ownTournaments(profile);
  if (!tournaments.length) {
    return {
      title: 'My tournaments',
      html: html`
        <section class="container">
          <div class="page-head"><div><span class="eyebrow">${icon('table', 14)} Organizer</span><h1>My tournaments</h1></div></div>
          ${emptyState('trophy', 'No tournaments yet', 'Create your first tournament — it appears in the catalog right away and you manage the standings here.',
            '#/organizer/new', 'Create your first tournament')}
        </section>`,
    };
  }
  const wanted = Number(query.get('id'));
  const t = tournaments.find((item) => item.id === wanted) ?? tournaments[0];
  const settled = Boolean(t.settled_at);
  const [teamRows, payments, prizePayouts] = await Promise.all([
    api.getTeams(t.id),
    t.is_paid ? api.listPayments({ tournamentId: t.id, limit: 20 }) : Promise.resolve([]),
    settled ? withFreshPayouts(() => api.listPayouts({ tournamentId: t.id, kind: 'prize' })) : Promise.resolve([]),
  ]);
  prizePayouts.sort((a, b) => a.place - b.place);
  const teams = standings(teamRows);
  const fin = tournamentFinance(t);
  const slotsLeft = Math.max(0, t.max_teams - t.team_count);
  const paypalCount = teams.filter((team) => team.payment_method === 'paypal').length;

  return {
    title: 'My tournaments',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('table', 14)} Organizer</span>
            <h1>My tournaments</h1>
            <p class="muted">Pick a tournament to edit its standings, see PayPal payments and change its status.</p>
          </div>
          <a class="btn btn-primary" href="#/organizer/new">${icon('plus', 16)} New tournament</a>
        </div>

        <div class="split">
          <aside class="side-list card">
            <div class="side-list-head"><span class="label">Tournaments</span><span class="count-pill">${tournaments.length}</span></div>
            <nav>${tournaments.map((item) => html`
              <a href="#/organizer?id=${item.id}" class="side-item ${item.id === t.id ? 'active' : ''}">
                ${gameTile(item, 'sm')}
                <span class="side-item-text"><b>${item.title}</b>
                  <small><i class="status-dot status-${item.status}"></i>${item.status === 'registration' ? 'Open' : item.status === 'active' ? 'Live' : 'Finished'} · ${item.team_count}/${item.max_teams}</small></span>
              </a>`)}</nav>
          </aside>

          <div class="split-main">
            <div class="card manage-head" style="${coverStyle(t)}">
              <div class="manage-head-top">
                ${gameTile(t, 'lg')}
                <div class="manage-head-title">
                  <div class="t-hero-badges">${statusBadge(t)}${priceBadge(t)}</div>
                  <h2>${t.title}</h2>
                  <div class="t-meta">
                    <span>${icon('gamepad', 15)} ${t.game}</span>
                    <span>${icon('calendar', 15)} ${formatDate(t.start_at, { time: true })}</span>
                    <span>${t.format === 'offline' ? html`${icon('pin', 15)} ${t.city}` : html`${icon('globe', 15)} Online`}</span>
                  </div>
                </div>
                <div class="manage-head-actions">
                  <a class="btn btn-ghost btn-sm" href="#/t/${t.id}">${icon('eye', 15)} Public page</a>
                  ${settled ? '' : html`<a class="btn btn-ghost btn-sm" href="#/organizer/t/${t.id}/edit">${icon('edit', 15)} Settings</a>`}
                </div>
              </div>
              ${settled ? html`
                <div class="status-switch">
                  <span class="badge pay-badge pay-completed">${icon('trophy', 13)} Prizes distributed</span>
                  <span class="muted small">${formatDate(t.settled_at, { time: true })} · the standings are final</span>
                </div>` : html`
                <div class="status-switch">
                  <span class="label">Status</span>
                  <div class="segmented">
                    ${[['registration', 'Registration', 'door'], ['active', 'Live', 'play'], ['finished', t.is_paid ? 'Finish & pay prizes' : 'Finished', 'flag']].map(([value, label, ic]) => html`
                      <button type="button" class="seg-btn ${t.status === value ? 'is-on' : ''}" data-status="${value}">${icon(ic, 14)} ${label}</button>`)}
                  </div>
                </div>`}
            </div>

            <div class="kpis kpis-4">
              ${kpi('users', 'Teams', `${t.team_count} / ${t.max_teams}`, `${plural(slotsLeft, 'slot', 'slots')} left`, 'violet')}
              ${t.is_paid ? html`
                ${kpi('check', 'Paid', `${t.paid_count} of ${t.team_count}`, `${plural(paypalCount, 'PayPal payment', 'PayPal payments')}`, 'green')}
                ${kpi('trophy', 'Prize pool', centsToMoney(fin.collected.prize), `up to ${centsToMoney(fin.potential.prize)} when full`, 'amber')}
                ${kpi('wallet', 'Your income', centsToMoney(fin.collected.organizer), settled ? 'in your wallet' : 'reaches your wallet when you finish', 'cyan')}` : html`
                ${kpi('gift', 'Entry', 'Free', t.prize_note || 'no entry fee', 'green')}
                ${kpi('calendar', 'Starts', formatDate(t.start_at, { short: true }), countdown(t.start_at), 'amber')}
                ${kpi('user', 'Self-registered', teams.filter((team) => team.captain_id).length, 'teams signed up by players', 'cyan')}`}
            </div>

            ${t.is_paid ? html`
              <div class="card pay-strip">
                <span class="kpi-icon">${icon('wallet', 18)}</span>
                <div><small>Entry fee</small><b>${money(t.entry_fee)}</b></div>
                <div><small>Split</small><b>${t.prize_percent}% prizes · ${100 - PLATFORM_FEE - t.prize_percent}% you · ${PLATFORM_FEE}% platform</b></div>
                <div><small>Prize places</small><b>${t.prize_percent ? t.prize_split.map((pct, i) => `${ordinal(i + 1)} ${pct}%`).join(' · ') : 'no prize pool'}</b></div>
                <a class="btn btn-ghost btn-sm" href="#/wallet">${icon('wallet', 15)} Wallet</a>
              </div>` : ''}

            ${settled && t.is_paid ? html`
              <div class="card card-pad" id="prizes">
                <div class="card-head"><h3 class="card-title">${icon('trophy', 18)} Prize payouts</h3><span class="muted small">sent with PayPal</span></div>
                ${prizePayouts.length ? payoutsTable(prizePayouts, { prizes: true, resend: true })
                  : emptyState('trophy', 'No PayPal prize payouts', 'No prize was sent automatically. Prizes you pay yourself are in your wallet.')}
              </div>` : ''}

            <div class="card card-pad" id="table">
              <div class="card-head">
                <h3 class="card-title">${icon('table', 18)} Teams</h3>
                ${teams.length && !settled ? html`
                  <div class="table-tools">
                    <label class="switch switch-sm"><input type="checkbox" data-auto-points checked><span class="track"></span><span>Auto points (W×3 + D)</span></label>
                    <button class="btn btn-primary btn-sm" type="button" data-save>${icon('save', 15)} Save table</button>
                  </div>` : ''}
              </div>
              ${settled ? standingsTable(teams) : teams.length ? html`
                <div class="table-wrap">
                  <table class="standings standings-edit">
                    <thead><tr>
                      <th class="num">#</th><th>Team and roster</th>
                      <th class="num" title="Wins">W</th><th class="num" title="Draws">D</th><th class="num" title="Losses">L</th>
                      <th class="num" title="Scored">For</th><th class="num" title="Conceded">Ag.</th><th class="num">Pts</th>
                      ${t.is_paid ? html`<th class="num">Payment</th>` : ''}<th></th>
                    </tr></thead>
                    <tbody>
                      ${teams.map((team) => html`
                        <tr data-row="${team.id}">
                          <td class="num">${placeBadge(team.place)}</td>
                          <td class="team-edit">
                            <input class="cell-input cell-name" data-stat="name" value="${team.name}" maxlength="40" aria-label="Team name">
                            <input class="cell-input cell-members" data-stat="members" value="${(team.members ?? []).join(', ')}" placeholder="Players, comma separated" aria-label="Roster">
                            ${team.captain?.full_name ? html`<small class="captain">${icon('crown', 12)} ${team.captain.full_name}</small>` : ''}
                          </td>
                          ${['wins', 'draws', 'losses', 'score_for', 'score_against'].map((field) => html`
                            <td class="num"><input class="cell-input cell-num" type="number" min="0" max="99999" data-stat="${field}" value="${team[field]}" aria-label="${field.replace('_', ' ')}"></td>`)}
                          <td class="num"><input class="cell-input cell-num cell-pts" type="number" min="0" max="99999" data-stat="points" value="${team.points}" aria-label="Points"></td>
                          ${paymentCell(t, team)}
                          <td class="num">${team.payment_method === 'paypal'
                            ? html`<button class="icon-btn icon-btn-danger" type="button" data-refund="${team.id}" data-name="${team.name}" data-amount="${team.paid_amount}" title="Refund and remove" aria-label="Refund and remove">${icon('refresh', 16)}</button>`
                            : html`<button class="icon-btn icon-btn-danger" type="button" data-delete="${team.id}" data-name="${team.name}" title="Remove team" aria-label="Remove team">${icon('trash', 16)}</button>`}</td>
                        </tr>`)}
                    </tbody>
                  </table>
                </div>
                <div class="table-foot">
                  <span class="muted small">${icon('info', 14)} Places update automatically: points → difference → scored → wins. A team that paid with PayPal can only be removed with a refund.</span>
                  <button class="btn btn-primary" type="button" data-save>${icon('save', 16)} Save table</button>
                </div>` : emptyState('users', 'No teams yet', 'Share the tournament link or add teams manually below.')}
            </div>

            ${settled ? '' : html`
              <div class="card card-pad">
                <h3 class="card-title">${icon('plus', 18)} Add a team manually</h3>
                ${t.is_paid ? html`<p class="muted small">Teams you add are invited: they play without paying the entry fee.</p>` : ''}
                ${slotsLeft > 0 ? html`
                  <form class="add-team" data-add-team novalidate>
                    <input class="input" name="name" maxlength="40" placeholder="Team name" required aria-label="Team name">
                    <input class="input" name="members" placeholder="Players, comma separated (up to ${t.team_size})" aria-label="Players">
                    <button class="btn btn-primary" type="submit">${icon('plus', 16)} Add</button>
                  </form>` : html`<div class="hint">${icon('info', 16)} <span>All ${t.max_teams} slots are taken. Raise the limit in the <a class="link" href="#/organizer/t/${t.id}/edit">tournament settings</a>.</span></div>`}
              </div>`}

            ${t.is_paid ? html`
              <div class="card card-pad">
                <div class="card-head"><h3 class="card-title">${icon('receipt', 18)} PayPal payments</h3><span class="muted small">latest 20</span></div>
                ${payments.length ? paymentsTable(payments, { showTournament: false }) : emptyState('receipt', 'No payments yet', 'Payments appear here the moment players pay their entry fee with PayPal.')}
              </div>` : ''}
          </div>
        </div>
      </section>`,

    mount(root) {
      const autoPoints = root.querySelector('[data-auto-points]');

      root.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
        if (button.dataset.status === t.status) return;
        try {
          if (button.dataset.status === 'finished' && t.is_paid) {
            await finishPaidTournament(t, reload);
            return;
          }
          await api.setStatus(t.id, button.dataset.status);
          toast({ registration: 'Registration is open.', active: 'The tournament is live!', finished: 'The tournament is finished.' }[button.dataset.status], 'success');
          reload();
        } catch (error) {
          toast(error.message, 'error');
        }
      })));

      root.querySelector('tbody')?.addEventListener('input', (event) => {
        const stat = event.target.dataset.stat;
        if (!autoPoints?.checked || (stat !== 'wins' && stat !== 'draws')) return;
        const row = event.target.closest('[data-row]');
        const value = (name) => Number(row.querySelector(`[data-stat="${name}"]`).value) || 0;
        const points = row.querySelector('[data-stat="points"]');
        points.value = value('wins') * 3 + value('draws');
        points.classList.remove('is-auto');
        void points.offsetWidth;
        points.classList.add('is-auto');
      });

      root.querySelectorAll('[data-save]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
        const rows = [...root.querySelectorAll('[data-row]')].map((row) => {
          const get = (name) => row.querySelector(`[data-stat="${name}"]`);
          const num = (name) => Math.max(0, Math.min(99999, Math.round(Number(get(name).value) || 0)));
          const entry = {
            id: Number(row.dataset.row), name: get('name').value.trim(), members: splitMembers(get('members').value),
            wins: num('wins'), draws: num('draws'), losses: num('losses'),
            score_for: num('score_for'), score_against: num('score_against'), points: num('points'),
          };
          return entry;
        });
        const bad = rows.find((row) => row.name.length < 2);
        if (bad) {
          toast('Every team needs a name of at least 2 characters.', 'error');
          return;
        }
        try {
          await api.saveTable(t.id, rows, autoPoints?.checked ?? true);
          toast('Standings saved.', 'success');
          reload();
        } catch (error) {
          toast(error.message, 'error');
        }
      })));

      root.querySelectorAll('[data-refund]').forEach((button) => button.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Refund and remove this team?',
          text: `${money(button.dataset.amount)} goes back to the PayPal account of “${button.dataset.name}”, and the team and its results are removed.`,
          ok: 'Refund & remove',
        });
        if (!ok) return;
        await busy(button, async () => {
          try {
            const { refunded } = await api.refundTeam(Number(button.dataset.refund));
            toast(`${money(refunded)} was refunded and “${button.dataset.name}” was removed.`, 'success');
            reload();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      }));

      bindResend(root, reload);

      root.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Remove this team?',
          text: `Team “${button.dataset.name}” and its results will be removed.`,
          ok: 'Remove',
        });
        if (!ok) return;
        try {
          await api.deleteTeam(Number(button.dataset.delete));
          toast('Team removed.', 'info');
          reload();
        } catch (error) {
          toast(error.message, 'error');
        }
      }));

      const addForm = root.querySelector('[data-add-team]');
      addForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = formValues(addForm);
        const name = values.name.trim();
        if (name.length < 2) {
          toast('Team name must be 2–40 characters long.', 'error');
          addForm.elements.name.focus();
          return;
        }
        busy(addForm.querySelector('[type=submit]'), async () => {
          try {
            await api.addTeam(t.id, name, splitMembers(values.members));
            toast(`Team “${name}” added.`, 'success');
            reload();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      if (query.get('id') !== String(t.id)) history.replaceState(null, '', `#/organizer?id=${t.id}`);
    },
  };
}

// ------------------------------------------------------------- payments --

export function paymentsTable(payments, { showTournament = true, showPayer = true } = {}) {
  return html`
    <div class="table-wrap">
      <table class="standings">
        <thead><tr>
          <th>Date</th>${showTournament ? html`<th>Tournament</th>` : ''}<th>Team</th>
          ${showPayer ? html`<th>PayPal payer</th>` : ''}<th class="num">Amount</th><th class="num">Status</th>
        </tr></thead>
        <tbody>
          ${payments.map((p) => html`
            <tr>
              <td class="nowrap muted">${formatDate(p.created_at, { time: true, short: true })}</td>
              ${showTournament ? html`<td>${p.tournament_id ? html`<a class="link-plain" href="#/t/${p.tournament_id}">${p.tournament_title}</a>` : html`<span class="dim">${p.tournament_title} (deleted)</span>`}</td>` : ''}
              <td><b>${p.team_name}</b></td>
              ${showPayer ? html`<td class="muted">${p.payer_email || p.payer_name || '—'}${p.paypal_capture_id ? html`<small class="mono-id">${p.paypal_capture_id}</small>` : ''}</td>` : ''}
              <td class="num nowrap"><b>${money(p.amount)}</b></td>
              <td class="num">${paymentBadge(p.status)}${p.failure_reason && p.status !== 'completed' ? html`<small class="pay-note" title="${p.failure_reason}">${p.failure_reason}</small>` : ''}</td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------- business model --

export async function businessView({ profile }) {
  const tournaments = (await ownTournaments(profile)).sort((a, b) => b.start_at.localeCompare(a.start_at));
  const paid = tournaments.filter((t) => t.is_paid);
  const collected = sumSplits(paid.map((t) => tournamentFinance(t).collected));
  const potential = sumSplits(paid.map((t) => tournamentFinance(t).potential));
  const avgPrize = paid.length ? Math.round(paid.reduce((sum, t) => sum + t.prize_percent, 0) / paid.length) : 60;
  const paidTeams = paid.reduce((sum, t) => sum + t.paid_count, 0);

  return {
    title: 'Business model',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('pie', 14)} Business model</span>
            <h1>How you earn</h1>
            <p class="muted">Entry fees are split three ways: the prize pool, your income and ${PLATFORM_FEE}% for the platform creator.</p>
          </div>
        </div>

        <div class="flow reveal">
          <div class="flow-source card">
            <span class="kpi-icon">${icon('users', 20)}</span>
            <small>Team entry fees</small><b>100%</b>
            <span class="muted small">Players pay with PayPal — verified automatically</span>
          </div>
          <div class="flow-arrows" aria-hidden="true">
            <svg viewBox="0 0 120 220" preserveAspectRatio="none">
              <defs><linearGradient id="fa" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
              <path d="M0 110 C 60 110, 60 30, 120 30"/><path d="M0 110 L 120 110"/><path d="M0 110 C 60 110, 60 190, 120 190"/>
            </svg>
          </div>
          <div class="flow-targets">
            <div class="flow-target card flow-prize"><i class="sw sw-prize"></i>
              <div><b>Prize pool</b><small>0 to ${MAX_PRIZE_PERCENT}%, split between prize places. Sent to the winners' PayPal when you finish</small></div>
              <em>${avgPrize}%<small>your average</small></em></div>
            <div class="flow-target card flow-org"><i class="sw sw-org"></i>
              <div><b>Your income</b><small>Everything left after prizes and the platform fee. Lands in your wallet</small></div>
              <em>${MAX_PRIZE_PERCENT - avgPrize}%<small>your average</small></em></div>
            <div class="flow-target card flow-platform"><i class="sw sw-platform"></i>
              <div><b>Platform creator</b><small>A flat fee on the revenue of every paid tournament</small></div>
              <em>${PLATFORM_FEE}%<small>always</small></em></div>
          </div>
        </div>

        <div class="kpis">
          ${kpi('coins', 'Collected', centsToMoney(collected.total), plural(paid.length, 'paid tournament', 'paid tournaments'), 'violet')}
          ${kpi('wallet', 'Your income', centsToMoney(collected.organizer), 'from paid entry fees', 'cyan')}
          ${kpi('trophy', 'Prize pools', centsToMoney(collected.prize), 'for the winners', 'amber')}
          ${kpi('bank', 'Platform fee', centsToMoney(collected.platform), `${PLATFORM_FEE}% of revenue`, 'pink')}
          ${kpi('check', 'Paid teams', paidTeams, `potential: ${centsToMoney(potential.total)}`, 'green')}
        </div>

        <div class="two-col">
          <div class="card card-pad reveal">
            <div class="card-head"><h3 class="card-title">${icon('pie', 18)} Actual split</h3><span class="muted small">from confirmed payments</span></div>
            <div class="donut-row">${donut(collected, collected.total ? 'Collected' : 'No payments yet')}${splitLegend(collected, 'organizer')}</div>
          </div>
          <div class="card card-pad reveal">
            <div class="card-head"><h3 class="card-title">${icon('trend', 18)} Potential</h3><span class="muted small">if every slot is filled and paid</span></div>
            <div class="donut-row">${donut(potential, potential.total ? 'Maximum' : 'No paid tournaments')}${splitLegend(potential, 'organizer')}</div>
          </div>
        </div>

        <div class="card card-pad reveal">
          <div class="card-head"><h3 class="card-title">${icon('table', 18)} Income by tournament</h3></div>
          ${tournaments.length ? html`
            <div class="table-wrap">
              <table class="standings">
                <thead><tr><th>Tournament</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Collected</th>
                  <th class="num">Prizes</th><th class="num">You</th><th class="num">Platform</th><th></th></tr></thead>
                <tbody>
                  ${tournaments.map((t) => {
                    const c = tournamentFinance(t).collected;
                    return html`
                      <tr>
                        <td><div class="team-cell">${gameTile(t, 'sm')}<div class="team-name"><b>${t.title}</b><small>${t.game} · ${t.status === 'registration' ? 'Open' : t.status === 'active' ? 'Live' : 'Finished'}</small></div></div></td>
                        ${t.is_paid ? html`
                          <td class="num nowrap">${money(t.entry_fee)}</td>
                          <td class="num nowrap">${t.paid_count} / ${t.team_count}</td>
                          <td class="num nowrap"><b>${centsToMoney(c.total)}</b></td>
                          <td class="num nowrap"><span class="money-prize">${centsToMoney(c.prize)}</span><small class="pct">${t.prize_percent}%</small></td>
                          <td class="num nowrap"><span class="money-org">${centsToMoney(c.organizer)}</span><small class="pct">${100 - PLATFORM_FEE - t.prize_percent}%</small></td>
                          <td class="num nowrap"><span class="money-platform">${centsToMoney(c.platform)}</span><small class="pct">${PLATFORM_FEE}%</small></td>`
                        : html`<td class="num" colspan="6"><span class="badge badge-free">${icon('gift', 13)}Free tournament — no fees, no commission</span></td>`}
                        <td class="num"><a class="icon-btn" href="#/organizer/t/${t.id}/edit" title="Change the split" aria-label="Edit">${icon('edit', 16)}</a></td>
                      </tr>`;
                  })}
                </tbody>
              </table>
            </div>` : emptyState('coins', 'No tournaments yet', 'Create a paid tournament to start earning.', '#/organizer/new', 'Create a tournament')}
        </div>

        <div class="card card-pad calc reveal" data-calc>
          <div class="card-head"><h3 class="card-title">${icon('sparkles', 18)} Income calculator</h3><span class="muted small">Plan your next tournament</span></div>
          <div class="calc-grid">
            <div class="calc-inputs">
              <label class="field"><span class="label">Entry fee per team, USD</span><input class="input input-lg" type="number" min="0" step="1" value="25" name="fee"></label>
              <label class="field"><span class="label">Number of teams</span><input class="input input-lg" type="number" min="0" max="256" value="16" name="teams"></label>
              <div class="field">
                <div class="range-head"><span class="label">Prize pool share</span><b class="range-value"><output data-prize-out>60</output>%</b></div>
                <input class="range range-prize" type="range" min="0" max="${MAX_PRIZE_PERCENT}" step="5" value="60" name="prize">
              </div>
            </div>
            <div class="calc-results">
              <div class="calc-total"><small>Total revenue</small><b data-out="total">$0</b></div>
              <div class="stack-bar stack-bar-lg"><span class="seg-prize" data-seg="prize"></span><span class="seg-org" data-seg="organizer"></span><span class="seg-platform" data-seg="platform"></span></div>
              <div class="calc-tiles">
                <div class="calc-tile tile-prize"><small>Prize pool</small><b data-out="prize">$0</b><em data-pct="prize"></em></div>
                <div class="calc-tile tile-org"><small>Your income</small><b data-out="organizer">$0</b><em data-pct="organizer"></em></div>
                <div class="calc-tile tile-platform"><small>Platform</small><b data-out="platform">$0</b><em data-pct="platform"></em></div>
              </div>
            </div>
          </div>
        </div>
      </section>`,
    mount(root) {
      const calc = root.querySelector('[data-calc]');
      const input = (name) => calc.querySelector(`[name="${name}"]`);
      const update = () => {
        const prize = Number(input('prize').value);
        calc.querySelector('[data-prize-out]').textContent = prize;
        input('prize').style.setProperty('--fill', `${(prize * 100) / MAX_PRIZE_PERCENT}%`);
        const s = split(toCents(input('fee').value) * Math.max(0, Number(input('teams').value) || 0), prize);
        calc.querySelectorAll('[data-out]').forEach((el) => { el.textContent = centsToMoney(s[el.dataset.out]); });
        calc.querySelectorAll('[data-pct]').forEach((el) => { el.textContent = `${s[`${el.dataset.pct}Percent`]}%`; });
        calc.querySelectorAll('[data-seg]').forEach((el) => { el.style.flexGrow = Math.max(0.001, s[`${el.dataset.seg}Percent`]); });
      };
      calc.addEventListener('input', update);
      update();
    },
  };
}
