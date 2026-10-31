import * as api from '../api.js';
import { tournamentFinance } from '../finance.js';
import {
  centsToMoney, coverStyle, emptyState, formatDate, gameTile, html, icon, kpi, money, ordinal, payoutBadge, plural, priceBadge,
  standings, standingsTable, statusBadge,
} from '../ui.js';
import { withFreshPayouts } from './organizer.js';

const STATUS_SHORT = { registration: 'Open', active: 'Live', finished: 'Finished' };

const PRIZE_TEXT = {
  queued: (email) => `The prize is about to be sent to ${email}.`,
  sent: (email) => `PayPal is sending the prize to ${email}.`,
  unclaimed: (email) => `PayPal sent the prize to ${email}. If there is no PayPal account with this email yet, create one within 30 days to claim it.`,
  paid: (email) => `The prize arrived on the PayPal account ${email}.`,
  failed: (email) => `PayPal could not deliver the prize to ${email}, so the organizer pays you directly.`,
};

function prizeNotice(prize) {
  return html`
    <div class="card card-pad notice notice-prize">
      ${icon('trophy', 22)}
      <div>
        <b>Your team won ${ordinal(prize.place)} place: ${money(prize.amount)}</b>
        <p>${(PRIZE_TEXT[prize.status] ?? PRIZE_TEXT.sent)(prize.receiver_email)}</p>
        ${payoutBadge(prize.status)}
      </div>
    </div>`;
}

function sideItem(item, selectedId, mine) {
  return html`
    <a href="#/player?id=${item.id}" class="side-item ${item.id === selectedId ? 'active' : ''}">
      ${gameTile(item, 'sm')}
      <span class="side-item-text"><b>${item.title}</b>
        <small><i class="status-dot status-${item.status}"></i>${STATUS_SHORT[item.status]} · ${item.game}</small></span>
      ${mine ? html`<span class="side-star" title="You are playing">${icon('star', 14)}</span>` : ''}
    </a>`;
}

export async function tablesView({ query, profile }) {
  const [tournaments, myTeams] = await Promise.all([api.listTournaments(), api.myTeams(profile.id)]);
  const joined = new Set(myTeams.map((team) => team.tournament_id));
  const rank = { active: 0, registration: 1, finished: 2 };
  const mine = tournaments.filter((t) => joined.has(t.id))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.start_at.localeCompare(b.start_at));
  const others = tournaments.filter((t) => !joined.has(t.id)).sort((a, b) => b.start_at.localeCompare(a.start_at));
  const everything = [...mine, ...others];
  const wanted = Number(query.get('id'));
  const t = everything.find((item) => item.id === wanted) ?? everything[0] ?? null;

  const head = html`
    <div class="page-head">
      <div>
        <span class="eyebrow">${icon('table', 14)} Player</span>
        <h1>My tables</h1>
        <p class="muted">Follow your team's position and the standings of any tournament on the platform.</p>
      </div>
      <a class="btn btn-primary" href="#/tournaments?available=1">${icon('search', 16)} Find a tournament</a>
    </div>`;
  if (!t) {
    return {
      title: 'My tables',
      html: html`<section class="container">${head}${emptyState('table', 'No tournaments yet', 'As soon as organizers create tournaments, their standings appear here.')}</section>`,
    };
  }

  const teams = standings(await api.getTeams(t.id));
  const myTeam = teams.find((team) => team.captain_id === profile.id) ?? null;
  const fin = tournamentFinance(t);
  const [prize] = myTeam && t.settled_at
    ? await withFreshPayouts(() => api.listPayouts({ recipientId: profile.id, tournamentId: t.id }))
    : [];
  let stats = '';
  if (myTeam) {
    const payment = myTeam.payment_method === 'paypal' ? 'Paid with PayPal' : 'Not paid';
    stats = html`
      <div class="kpis kpis-4">
        ${kpi('crown', 'Place', `${myTeam.place} of ${teams.length}`, myTeam.name, 'amber')}
        ${kpi('star', 'Points', myTeam.points, plural(myTeam.played, 'match played', 'matches played'), 'violet')}
        ${kpi('swords', 'Record', `${myTeam.wins}–${myTeam.draws}–${myTeam.losses}`, 'wins · draws · losses', 'cyan')}
        ${t.is_paid
          ? kpi(myTeam.is_paid ? 'check' : 'hourglass', 'Entry fee', myTeam.is_paid ? 'Paid' : 'Unpaid', `${money(t.entry_fee)} · ${payment}`, myTeam.is_paid ? 'green' : 'pink')
          : kpi('gift', 'Entry', 'Free', t.prize_note || 'no entry fee', 'green')}
      </div>`;
  } else if (t.is_paid) {
    stats = html`
      <div class="kpis kpis-3">
        ${kpi('trophy', 'Prize pool', centsToMoney(fin.collected.prize), `up to ${centsToMoney(fin.potential.prize)}`, 'amber')}
        ${kpi('users', 'Teams', `${t.team_count} / ${t.max_teams}`, plural(Math.max(0, t.max_teams - t.team_count), 'slot left', 'slots left'), 'violet')}
        ${kpi('coins', 'Entry fee', money(t.entry_fee), 'per team, paid with PayPal', 'cyan')}
      </div>`;
  }

  return {
    title: 'My tables',
    html: html`
      <section class="container">
        ${head}
        <div class="split">
          <aside class="side-list card" data-tabs>
            <div class="tabs" role="tablist">
              <button type="button" class="tab ${mine.length ? 'is-on' : ''}" data-tab="mine" role="tab">Mine <span class="count-pill">${mine.length}</span></button>
              <button type="button" class="tab ${mine.length ? '' : 'is-on'}" data-tab="all" role="tab">All <span class="count-pill">${others.length}</span></button>
            </div>
            <nav data-tab-panel="mine" ${mine.length ? '' : 'hidden'}>
              ${mine.length ? mine.map((item) => sideItem(item, t.id, true)) : html`
                <div class="side-empty">${icon('swords', 22)}<p>You have not joined any tournament yet.</p>
                  <a class="btn btn-primary btn-sm" href="#/tournaments?available=1">Pick a tournament</a></div>`}
            </nav>
            <nav data-tab-panel="all" ${mine.length ? 'hidden' : ''}>
              ${others.length ? others.map((item) => sideItem(item, t.id, false)) : html`<div class="side-empty"><p>No other tournaments yet.</p></div>`}
            </nav>
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
                    <span>${icon('user', 15)} ${t.organizer_name}</span>
                  </div>
                </div>
                <div class="manage-head-actions"><a class="btn btn-ghost btn-sm" href="#/t/${t.id}">${icon('eye', 15)} Tournament page</a></div>
              </div>
            </div>
            ${prize ? prizeNotice(prize) : ''}
            ${stats}
            <div class="card card-pad">
              <div class="card-head">
                <h3 class="card-title">${icon('table', 18)} Standings</h3>
                ${!myTeam && t.status === 'registration' && t.team_count < t.max_teams
                  ? html`<a class="btn btn-primary btn-sm" href="#/t/${t.id}/join">${icon('swords', 15)} Join</a>` : ''}
              </div>
              ${standingsTable(teams, myTeam?.id)}
            </div>
          </div>
        </div>
      </section>`,
    mount(root) {
      const box = root.querySelector('[data-tabs]');
      const tabs = [...box.querySelectorAll('[data-tab]')];
      tabs.forEach((tab) => tab.addEventListener('click', () => {
        tabs.forEach((other) => other.classList.toggle('is-on', other === tab));
        box.querySelectorAll('[data-tab-panel]').forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== tab.dataset.tab; });
      }));
      if (query.get('id') !== String(t.id)) history.replaceState(null, '', `#/player?id=${t.id}`);
    },
  };
}
