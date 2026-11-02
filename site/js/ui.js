// Rendering helpers and shared UI components.
import { prizeAmounts, tournamentFinance } from './finance.js';
import { gameStyle, hueOf, initials } from './games.js';
import { ICONS } from './icons.js';

// ------------------------------------------------------------ templating --

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

// Every interpolated value is escaped unless it is itself the result of html`` or raw().
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += renderValue(value) + strings[i + 1]; });
  return new SafeHtml(out);
}

export const raw = (value) => new SafeHtml(String(value));

export function icon(name, size = 18, cls = '') {
  const body = ICONS[name] ?? ICONS.info;
  return raw(`<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
}

// ------------------------------------------------------------ formatting --

const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const numberFmt = new Intl.NumberFormat('en-US');

export const formatNumber = (n) => numberFmt.format(n);
export const centsToMoney = (cents) => (Math.round(cents) % 100 === 0 ? usdWhole : usdCents).format(Math.round(cents) / 100);
export const money = (amount) => centsToMoney(Math.round((Number(amount) || 0) * 100));

export function formatDate(value, { time = false, short = false } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const options = { month: short ? 'short' : 'long', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  if (time) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function daysUntil(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(date) - startOf(new Date())) / 86_400_000);
}

export function countdown(value) {
  const days = daysUntil(value);
  if (days === null) return '';
  if (days > 1) return `in ${days} days`;
  if (days === 1) return 'tomorrow';
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  return `${-days} days ago`;
}

export const pluralWord = (n, one, many) => (Math.abs(n) === 1 ? one : many);
export const plural = (n, one, many) => `${formatNumber(n)} ${pluralWord(n, one, many)}`;

// ------------------------------------------------------------- feedback --

const TOAST_ICONS = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };

export function toast(message, kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = html`<span class="toast-icon">${icon(TOAST_ICONS[kind] ?? 'info')}</span>
    <span class="toast-text">${message}</span>
    <button class="toast-close" type="button" aria-label="Dismiss">${icon('x', 16)}</button>`.toString();
  const dismiss = () => {
    if (el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 350);
  };
  el.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, kind === 'error' ? 8000 : 5200);
  box.append(el);
}

export function confirmDialog({ title = 'Are you sure?', text = '', ok = 'Delete', tone = 'danger' } = {}) {
  const modal = document.getElementById('confirm-modal');
  if (!modal || typeof modal.showModal !== 'function') return Promise.resolve(window.confirm(text || title));
  modal.querySelector('[data-confirm-title]').textContent = title;
  modal.querySelector('[data-confirm-text]').textContent = text;
  const okButton = modal.querySelector('[data-confirm-ok]');
  okButton.textContent = ok;
  okButton.className = tone === 'primary' ? 'btn btn-primary' : 'btn btn-danger-solid';
  modal.returnValue = '';
  modal.showModal();
  return new Promise((resolve) => {
    modal.addEventListener('close', () => resolve(modal.returnValue === 'ok'), { once: true });
  });
}

// Disables a button while an async action runs.
export async function busy(button, action) {
  if (!button) return action();
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
}

// ----------------------------------------------------------- tournaments --

export const STATUS_LABELS = { registration: 'Registration open', active: 'Live', finished: 'Finished' };

export const isOpen = (t) => t.status === 'registration' && t.team_count < t.max_teams;
export const fillPercent = (t) => (t.max_teams ? Math.min(100, Math.round((t.team_count * 100) / t.max_teams)) : 0);

export function statusBadge(t) {
  return html`<span class="badge badge-${t.status}">${t.status !== 'finished' ? html`<i class="dot"></i>` : ''}${STATUS_LABELS[t.status] ?? t.status}</span>`;
}

export function priceBadge(t) {
  return t.is_paid
    ? html`<span class="badge badge-paid">${icon('coins', 13)}${money(t.entry_fee)}</span>`
    : html`<span class="badge badge-free">${icon('gift', 13)}Free</span>`;
}

export function gameTile(t, size = 'md') {
  const st = gameStyle(t.game);
  return html`<span class="game-tile game-tile-${size} ${st.abbr.length > 4 ? 'is-long' : ''}" style="--c1: ${st.c1}; --c2: ${st.c2}">${st.abbr}</span>`;
}

export function coverStyle(t) {
  const st = gameStyle(t.game);
  return `--c1: ${st.c1}; --c2: ${st.c2}`;
}

export function tournamentCard(t, joined = false) {
  const st = gameStyle(t.game);
  const fin = tournamentFinance(t);
  const open = isOpen(t);
  let prize;
  if (t.is_paid) {
    prize = html`<small>Prize pool up to</small><b class="grad-text">${centsToMoney(fin.potential.prize)}</b>`;
  } else if (t.prize_note) {
    prize = html`<small>Prizes</small><b class="t-prize-note" title="${t.prize_note}">${t.prize_note}</b>`;
  } else {
    prize = html`<small>Organizer</small><b>${t.organizer_name}</b>`;
  }
  return html`
    <article class="card t-card reveal">
      <a class="t-cover" href="#/t/${t.id}" style="--c1: ${st.c1}; --c2: ${st.c2}" tabindex="-1" aria-hidden="true">
        <span class="t-cover-abbr">${st.abbr}</span>
        <span class="t-cover-badges">${statusBadge(t)}${priceBadge(t)}</span>
        ${joined ? html`<span class="t-cover-joined">${icon('check', 14)} You're in</span>` : ''}
        <span class="t-cover-game">${icon('gamepad', 14)} ${t.game}</span>
      </a>
      <div class="t-body">
        <h3 class="t-title"><a href="#/t/${t.id}">${t.title}</a></h3>
        <div class="t-meta">
          <span>${icon('calendar', 15)} ${formatDate(t.start_at, { time: true, short: true })}</span>
          ${t.format === 'offline' ? html`<span>${icon('pin', 15)} ${t.city}</span>` : html`<span>${icon('globe', 15)} Online</span>`}
          <span>${icon('users', 15)} ${t.team_size}v${t.team_size}</span>
        </div>
        <div class="t-progress">
          <div class="t-progress-head"><span>Teams</span><b>${t.team_count}<small> / ${t.max_teams}</small></b></div>
          <div class="progress"><span style="width: ${fillPercent(t)}%"></span></div>
        </div>
        <div class="t-foot">
          <div class="t-prize">${prize}</div>
          <a class="btn btn-sm ${open && !joined ? 'btn-primary' : 'btn-ghost'}" href="#/t/${t.id}">
            ${open && !joined ? 'Join' : 'View'} ${icon('arrow', 15)}
          </a>
        </div>
      </div>
    </article>`;
}

// ------------------------------------------------------------- standings --

export function standings(teams) {
  // Places decided by the bracket (final, third-place match) come first.
  const placed = (t) => t.final_place ?? Infinity;
  const sorted = [...teams].sort((a, b) =>
    placed(a) - placed(b)
    || b.points - a.points
    || (b.score_for - b.score_against) - (a.score_for - a.score_against)
    || b.score_for - a.score_for
    || b.wins - a.wins
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return sorted.map((team, i) => ({
    ...team,
    place: i + 1,
    played: team.wins + team.draws + team.losses,
    diff: team.score_for - team.score_against,
    hue: hueOf(team.name),
    initials: initials(team.name),
  }));
}

export function placeBadge(place) {
  return html`<span class="place place-${place <= 3 ? place : 'n'}">${place === 1 ? icon('crown', 16) : place}</span>`;
}

export function teamCell(team) {
  return html`
    <div class="team-cell">
      <span class="team-avatar" style="--h: ${team.hue}">${team.initials}</span>
      <div class="team-name">
        <b>${team.name}</b>
        ${team.members?.length ? html`<small>${team.members.join(' · ')}</small>` : ''}
      </div>
    </div>`;
}

export function standingsTable(teams, highlightId = null) {
  if (!teams.length) {
    return emptyState('users', 'No teams yet', 'The table appears as soon as the first team registers.');
  }
  return html`
    <div class="table-wrap">
      <table class="standings">
        <thead>
          <tr>
            <th class="num">#</th><th>Team</th>
            <th class="num" title="Played">P</th><th class="num" title="Wins">W</th>
            <th class="num" title="Draws">D</th><th class="num" title="Losses">L</th>
            <th class="num" title="Score for : against">Score</th><th class="num" title="Difference">+/−</th>
            <th class="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          ${teams.map((team) => html`
            <tr class="${highlightId && team.id === highlightId ? 'is-mine' : ''} ${team.place <= 3 && team.played ? `top-${team.place}` : ''}">
              <td class="num">${placeBadge(team.place)}</td>
              <td>${teamCell(team)}${highlightId && team.id === highlightId ? html`<span class="mine-tag">Your team</span>` : ''}</td>
              <td class="num muted">${team.played}</td>
              <td class="num win">${team.wins}</td>
              <td class="num">${team.draws}</td>
              <td class="num loss">${team.losses}</td>
              <td class="num muted nowrap">${team.score_for}:${team.score_against}</td>
              <td class="num ${team.diff > 0 ? 'diff-pos' : team.diff < 0 ? 'diff-neg' : ''}">${team.diff > 0 ? '+' : ''}${team.diff}</td>
              <td class="num"><span class="pts">${team.points}</span></td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------- blocks --

export function emptyState(ic, title, text, actionHref = null, actionLabel = null) {
  return html`
    <div class="empty">
      <div class="empty-icon">${icon(ic, 30)}</div>
      <h3>${title}</h3>
      <p>${text}</p>
      ${actionHref ? html`<a class="btn btn-primary" href="${actionHref}">${icon('plus', 16)} ${actionLabel}</a>` : ''}
    </div>`;
}

export function kpi(ic, label, value, hint = null, tone = 'violet') {
  return html`
    <div class="card kpi kpi-${tone} reveal">
      <div class="kpi-top"><span class="kpi-icon">${icon(ic, 20)}</span><span class="kpi-label">${label}</span></div>
      <div class="kpi-value">${value}</div>
      ${hint ? html`<div class="kpi-hint" title="${hint}">${hint}</div>` : ''}
    </div>`;
}

export function donut(s, centerLabel = 'Total', size = 190) {
  return html`
    <div class="donut ${s.total ? '' : 'donut-empty'}" style="--size: ${size}px; --p1: ${s.prizePercent}; --p2: ${s.organizerPercent}">
      <div class="donut-center"><small>${centerLabel}</small><b>${centsToMoney(s.total)}</b></div>
    </div>`;
}

export function splitLegend(s, highlight = null) {
  const rows = [
    ['prize', 'sw-prize', 'Prize pool', s.prizePercent, s.prize],
    ['organizer', 'sw-org', 'Organizer', s.organizerPercent, s.organizer],
    ['platform', 'sw-platform', 'Platform', s.platformPercent, s.platform],
  ];
  return html`
    <ul class="legend">
      ${rows.map(([key, sw, label, pct, cents]) => html`
        <li class="${highlight === key ? 'is-hl' : ''}"><i class="sw ${sw}"></i><span>${label}</span><em>${pct}%</em><b>${centsToMoney(cents)}</b></li>`)}
    </ul>`;
}

export function fieldError(errors, name) {
  return errors?.[name] ? html`<span class="field-error">${icon('alert', 13)} ${errors[name]}</span>` : '';
}

export function messagePage(code, title, text) {
  return {
    title,
    html: html`
      <section class="container error-page">
        <div class="error-code grad-text">${code}</div>
        <h1>${title}</h1>
        <p class="muted">${text}</p>
        <div class="hero-actions hero-actions-center">
          <a class="btn btn-primary" href="#/">${icon('back', 16)} Home</a>
          <a class="btn btn-ghost" href="#/tournaments">Browse tournaments</a>
        </div>
      </section>`,
  };
}

export const notFound = () => messagePage(404, 'Page not found', 'The tournament may have been deleted, or the link is wrong.');

export const loader = () => html`<div class="page-loader" role="status" aria-label="Loading"><span class="spinner"></span></div>`;

export const PAYMENT_LABELS = {
  completed: 'Paid', created: 'Started', pending: 'In review', failed: 'Failed', refunding: 'Refunding', refunded: 'Refunded',
};

export function paymentBadge(status) {
  return html`<span class="badge pay-badge pay-${status}">${PAYMENT_LABELS[status] ?? status}</span>`;
}

export const PAYOUT_LABELS = {
  queued: 'Not sent yet', sent: 'On the way', unclaimed: 'Waiting for receiver', paid: 'Paid', failed: 'Returned',
};
const PAYOUT_TONES = { queued: 'pending', sent: 'created', unclaimed: 'pending', paid: 'completed', failed: 'refunded' };

export function payoutBadge(status) {
  return html`<span class="badge pay-badge pay-${PAYOUT_TONES[status] ?? 'created'}">${PAYOUT_LABELS[status] ?? status}</span>`;
}

export function ordinal(n) {
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n)];
  return `${n}${suffix}`;
}

// The prize places of a paid tournament with their amounts for a given prize pool.
export function prizePlaces(t, prizeCents) {
  const prizeSplit = t.prize_split?.length ? t.prize_split : [100];
  const amounts = prizeAmounts(prizeCents, prizeSplit);
  return html`
    <ol class="prize-places">
      ${prizeSplit.map((pct, i) => html`
        <li>${placeBadge(i + 1)}<span>${ordinal(i + 1)} place</span><em>${pct}%</em><b>${centsToMoney(amounts[i])}</b></li>`)}
    </ol>`;
}

export function avatar(name, key = name) {
  return html`<span class="avatar" style="--h: ${hueOf(key)}">${initials(name)}</span>`;
}

// Reads a form into a plain object (checkboxes become booleans).
export function formValues(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') values[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) values[el.name] = el.value; }
    else values[el.name] = el.value;
  }
  return values;
}

// Shows per-field errors next to inputs that have data-field="name".
export function showFieldErrors(form, errors = {}) {
  form.querySelectorAll('[data-field]').forEach((field) => {
    const name = field.dataset.field;
    field.classList.toggle('has-error', Boolean(errors[name]));
    field.querySelector('.field-error')?.remove();
    if (errors[name]) field.insertAdjacentHTML('beforeend', fieldError(errors, name).toString());
  });
  form.querySelector('.has-error input, .has-error textarea, .has-error select')?.focus();
}

export function splitMembers(text) {
  return String(text ?? '').split(/[\n,;]+/).map((m) => m.trim()).filter(Boolean).map((m) => m.slice(0, 40));
}
