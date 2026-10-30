import * as api from '../api.js';
import { PLATFORM_FEE } from '../config.js';
import { sumSplits, tournamentFinance } from '../finance.js';
import { gameStyle, hueOf, initials } from '../games.js';
import {
  STATUS_LABELS, avatar, centsToMoney, confirmDialog, donut, emptyState, formatDate, formatNumber, gameTile, html, icon,
  kpi, money, placeBadge, plural, pluralWord, splitLegend, statusBadge, toast,
} from '../ui.js';
import { ROLE_LABELS } from '../roles.js';
import { paymentsTable } from './organizer.js';

async function deleteTournament(t, reload) {
  const ok = await confirmDialog({
    title: 'Delete this tournament?',
    text: `“${t.title}” and ${plural(t.team_count, 'team', 'teams')} will be deleted permanently. Payment records stay in the ledger.`,
  });
  if (!ok) return;
  try {
    await api.adminDeleteTournament(t.id);
    toast(`“${t.title}” was deleted.`, 'success');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindDeletes(root, tournaments, reload) {
  root.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => {
    const t = tournaments.find((item) => item.id === Number(button.dataset.delete));
    if (t) deleteTournament(t, reload);
  }));
}

const deleteButton = (t) => html`<button class="icon-btn icon-btn-danger" type="button" data-delete="${t.id}" title="Delete tournament" aria-label="Delete tournament">${icon('trash', 16)}</button>`;

// ------------------------------------------------------------- dashboard --

export async function creatorDashboardView({ reload }) {
  const [tournaments, users, payments] = await Promise.all([api.listTournaments(), api.adminUsers(), api.listPayments({ limit: 8 })]);
  const paid = tournaments.filter((t) => t.is_paid);
  const collected = sumSplits(paid.map((t) => tournamentFinance(t).collected));
  const potential = sumSplits(paid.map((t) => tournamentFinance(t).potential));

  const byGame = new Map();
  const byOrganizer = new Map();
  for (const t of tournaments) {
    const fin = tournamentFinance(t).collected;
    const g = byGame.get(t.game) ?? { game: t.game, gmv: 0, platform: 0, count: 0 };
    g.gmv += fin.total; g.platform += fin.platform; g.count += 1;
    byGame.set(t.game, g);
    const o = byOrganizer.get(t.organizer_id) ?? { name: t.organizer_name, key: t.organizer_username, gmv: 0, platform: 0, count: 0 };
    o.gmv += fin.total; o.platform += fin.platform; o.count += 1;
    byOrganizer.set(t.organizer_id, o);
  }
  const games = [...byGame.values()].sort((a, b) => b.gmv - a.gmv || b.count - a.count).slice(0, 8);
  const gamesTop = Math.max(1, ...games.map((g) => g.gmv));
  const organizers = [...byOrganizer.values()].sort((a, b) => b.platform - a.platform || b.count - a.count).slice(0, 6);
  const topPaid = [...paid].sort((a, b) => tournamentFinance(b).collected.platform - tournamentFinance(a).collected.platform).slice(0, 8);
  const roleCount = (role) => users.filter((u) => u.role === role).length;
  const counts = {
    tournaments: tournaments.length, paid: paid.length, free: tournaments.length - paid.length,
    active: tournaments.filter((t) => t.status === 'active').length,
    organizers: roleCount('organizer'), players: roleCount('participant'),
    teams: tournaments.reduce((sum, t) => sum + t.team_count, 0),
  };

  return {
    title: 'Creator dashboard',
    html: html`
      <section class="container">
        <div class="creator-hero card reveal">
          <div class="creator-hero-copy">
            <span class="eyebrow eyebrow-gold">${icon('crown', 14)} Platform creator</span>
            <h1>TurniRUM profit</h1>
            <p class="muted">You earn <b>${PLATFORM_FEE}%</b> of the revenue of every paid tournament. Free tournaments carry no fee.</p>
            <div class="creator-actions">
              <a class="btn btn-gold" href="#/creator/tournaments">${icon('shield', 16)} Manage tournaments</a>
              <a class="btn btn-ghost" href="#/creator/payments">${icon('receipt', 16)} PayPal payments</a>
            </div>
          </div>
          <div class="creator-profit">
            <small>Your profit</small>
            <b>${centsToMoney(collected.platform)}</b>
            <span>${icon('trend', 15)} up to ${centsToMoney(potential.platform)} when every tournament fills up</span>
          </div>
          <div class="creator-hero-crown" aria-hidden="true">${icon('crown', 220)}</div>
        </div>

        <div class="kpis">
          ${kpi('coins', 'Platform turnover', centsToMoney(collected.total), 'all confirmed entry fees', 'violet')}
          ${kpi('bank', 'Platform profit', centsToMoney(collected.platform), `${PLATFORM_FEE}% of turnover`, 'amber')}
          ${kpi('trend', 'Profit potential', centsToMoney(potential.platform), 'if all tournaments fill up', 'cyan')}
          ${kpi('trophy', 'Prize pools', centsToMoney(collected.prize), 'for the winners', 'pink')}
          ${kpi('wallet', 'Organizer income', centsToMoney(collected.organizer), plural(counts.organizers, 'organizer', 'organizers'), 'green')}
        </div>

        <div class="two-col">
          <div class="card card-pad reveal">
            <div class="card-head"><h3 class="card-title">${icon('pie', 18)} Where the money goes</h3><span class="muted small">all paid tournaments</span></div>
            <div class="donut-row">${donut(collected, collected.total ? 'Turnover' : 'No payments yet')}${splitLegend(collected, 'platform')}</div>
          </div>
          <div class="card card-pad reveal">
            <div class="card-head"><h3 class="card-title">${icon('dashboard', 18)} Platform in numbers</h3></div>
            <div class="mini-stats">
              <div><b>${formatNumber(counts.tournaments)}</b><small>${pluralWord(counts.tournaments, 'tournament', 'tournaments')}</small></div>
              <div><b>${counts.paid}</b><small>paid</small></div>
              <div><b>${counts.free}</b><small>free</small></div>
              <div><b>${counts.active}</b><small>live now</small></div>
              <div><b>${counts.organizers}</b><small>${pluralWord(counts.organizers, 'organizer', 'organizers')}</small></div>
              <div><b>${counts.players}</b><small>${pluralWord(counts.players, 'player', 'players')}</small></div>
              <div><b>${counts.teams}</b><small>${pluralWord(counts.teams, 'team', 'teams')}</small></div>
              <div><b>${PLATFORM_FEE}%</b><small>fee rate</small></div>
            </div>
          </div>
        </div>

        <div class="two-col">
          <div class="card card-pad reveal">
            <div class="card-head"><h3 class="card-title">${icon('gamepad', 18)} Turnover by game</h3></div>
            ${games.length ? html`<ul class="hbars">${games.map((g) => {
              const st = gameStyle(g.game);
              return html`
                <li>
                  <div class="hbar-head"><span><i class="chip-dot" style="--c1: ${st.c1}; --c2: ${st.c2}"></i>${g.game} <small class="muted">· ${plural(g.count, 'tournament', 'tournaments')}</small></span><b>${centsToMoney(g.gmv)}</b></div>
                  <div class="hbar"><span style="--w: ${((g.gmv * 100) / gamesTop).toFixed(1)}; --c1: ${st.c1}; --c2: ${st.c2}"></span></div>
                  <small class="muted">platform profit: ${centsToMoney(g.platform)}</small>
                </li>`;
            })}</ul>` : emptyState('gamepad', 'No data yet', 'Statistics appear once organizers create tournaments.')}
          </div>
          <div class="card card-pad reveal">
            <div class="card-head"><h3 class="card-title">${icon('crown', 18)} Top organizers</h3><span class="muted small">by profit brought</span></div>
            ${organizers.length ? html`<ol class="leaderboard">${organizers.map((o, i) => html`
              <li>${placeBadge(i + 1)}<span class="avatar" style="--h: ${hueOf(o.key)}">${initials(o.name)}</span>
                <div class="leader-name"><b>${o.name}</b><small>${plural(o.count, 'tournament', 'tournaments')} · turnover ${centsToMoney(o.gmv)}</small></div>
                <b class="leader-value">${centsToMoney(o.platform)}</b></li>`)}</ol>`
              : emptyState('users', 'No organizers yet', 'Invite the first organizers to the platform.')}
          </div>
        </div>

        <div class="card card-pad reveal">
          <div class="card-head"><h3 class="card-title">${icon('receipt', 18)} Latest PayPal payments</h3><a class="btn btn-ghost btn-sm" href="#/creator/payments">All payments ${icon('arrow', 15)}</a></div>
          ${payments.length ? paymentsTable(payments) : emptyState('receipt', 'No PayPal payments yet', 'Verified payments appear here instantly.')}
        </div>

        <div class="card card-pad reveal">
          <div class="card-head"><h3 class="card-title">${icon('coins', 18)} Most profitable tournaments</h3><a class="btn btn-ghost btn-sm" href="#/creator/tournaments">All tournaments ${icon('arrow', 15)}</a></div>
          ${topPaid.length ? html`
            <div class="table-wrap">
              <table class="standings">
                <thead><tr><th>Tournament</th><th>Organizer</th><th class="num">Paid</th><th class="num">Turnover</th><th class="num">Your profit</th><th></th></tr></thead>
                <tbody>${topPaid.map((t) => {
                  const c = tournamentFinance(t).collected;
                  return html`
                    <tr>
                      <td><div class="team-cell">${gameTile(t, 'sm')}<div class="team-name"><a href="#/t/${t.id}"><b>${t.title}</b></a><small>${t.game} · ${STATUS_LABELS[t.status]}</small></div></div></td>
                      <td class="muted">${t.organizer_name}</td>
                      <td class="num nowrap">${t.paid_count} × ${money(t.entry_fee)}</td>
                      <td class="num nowrap">${centsToMoney(c.total)}</td>
                      <td class="num nowrap"><b class="money-platform">${centsToMoney(c.platform)}</b></td>
                      <td class="num">${deleteButton(t)}</td>
                    </tr>`;
                })}</tbody>
              </table>
            </div>` : emptyState('coins', 'No paid tournaments yet', 'Profit appears once organizers run their first paid tournaments.')}
        </div>
      </section>`,
    mount(root) { bindDeletes(root, tournaments, reload); },
  };
}

// ---------------------------------------------------------- tournaments --

export async function creatorTournamentsView({ query, reload }) {
  const all = await api.listTournaments();
  const q = (query.get('q') ?? '').trim();
  const needle = q.toLowerCase();
  const tournaments = all
    .filter((t) => !needle || [t.title, t.game, t.organizer_name].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);

  return {
    title: 'Manage tournaments',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow eyebrow-gold">${icon('shield', 14)} Moderation</span>
            <h1>All tournaments</h1>
            <p class="muted">As the platform creator you can delete any tournament together with its teams and standings.</p>
          </div>
          <div class="result-count"><b>${tournaments.length}</b><span>${pluralWord(tournaments.length, 'tournament', 'tournaments')}</span></div>
        </div>
        <form class="card filters filters-compact" data-search>
          <label class="search-field">${icon('search', 20)}<input class="input input-lg" type="search" name="q" value="${q}" placeholder="Search by title, game or organizer" aria-label="Search"></label>
          <button class="btn btn-primary" type="submit">Search</button>
          ${q ? html`<a class="btn btn-ghost" href="#/creator/tournaments">${icon('x', 14)} Clear</a>` : ''}
        </form>
        ${tournaments.length ? html`
          <div class="card card-pad">
            <div class="table-wrap">
              <table class="standings">
                <thead><tr><th>Tournament</th><th>Organizer</th><th>Status</th><th class="num">Teams</th><th class="num">Turnover</th><th class="num">Profit (${PLATFORM_FEE}%)</th><th class="num">Actions</th></tr></thead>
                <tbody>${tournaments.map((t) => {
                  const c = tournamentFinance(t).collected;
                  return html`
                    <tr>
                      <td><div class="team-cell">${gameTile(t, 'sm')}<div class="team-name"><a href="#/t/${t.id}"><b>${t.title}</b></a>
                        <small>${t.game} · ${formatDate(t.start_at, { short: true })} · ${t.is_paid ? money(t.entry_fee) : 'free'}</small></div></div></td>
                      <td class="muted">${t.organizer_name}<br><small class="dim">@${t.organizer_username}</small></td>
                      <td>${statusBadge(t)}</td>
                      <td class="num nowrap">${t.team_count} / ${t.max_teams}</td>
                      <td class="num nowrap">${t.is_paid ? centsToMoney(c.total) : '—'}</td>
                      <td class="num nowrap">${t.is_paid ? html`<b class="money-platform">${centsToMoney(c.platform)}</b>` : html`<span class="dim">—</span>`}</td>
                      <td class="num"><div class="row-actions">
                        <a class="icon-btn" href="#/t/${t.id}" title="Open" aria-label="Open">${icon('eye', 16)}</a>${deleteButton(t)}</div></td>
                    </tr>`;
                })}</tbody>
              </table>
            </div>
          </div>` : emptyState('search', 'No tournaments found', 'Change the search or wait for organizers to create tournaments.')}
      </section>`,
    mount(root) {
      const form = root.querySelector('[data-search]');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = form.elements.q.value.trim();
        location.hash = value ? `#/creator/tournaments?q=${encodeURIComponent(value)}` : '#/creator/tournaments';
      });
      bindDeletes(root, tournaments, reload);
    },
  };
}

// -------------------------------------------------------------- payments --

export async function creatorPaymentsView() {
  const payments = await api.listPayments({ limit: 500 });
  const completed = payments.filter((p) => p.status === 'completed');
  const volume = completed.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
  const refunded = payments.filter((p) => p.status === 'refunded').length;
  return {
    title: 'PayPal payments',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow eyebrow-gold">${icon('receipt', 14)} Ledger</span>
            <h1>PayPal payments</h1>
            <p class="muted">Every entry fee is captured and verified on the server before a team is admitted.</p>
          </div>
        </div>
        <div class="kpis kpis-4">
          ${kpi('check', 'Verified', completed.length, 'teams admitted after payment', 'green')}
          ${kpi('coins', 'Volume', centsToMoney(volume), 'captured with PayPal', 'violet')}
          ${kpi('bank', 'Your share', centsToMoney(Math.floor((volume * PLATFORM_FEE + 50) / 100)), `${PLATFORM_FEE}% platform fee`, 'amber')}
          ${kpi('refresh', 'Refunded', refunded, 'automatic refunds', 'pink')}
        </div>
        <div class="card card-pad">
          ${payments.length ? paymentsTable(payments) : emptyState('receipt', 'No payments yet', 'Payments appear here when players pay entry fees with PayPal.')}
        </div>
      </section>`,
  };
}

// ----------------------------------------------------------------- users --

export async function creatorUsersView() {
  const users = await api.adminUsers();
  return {
    title: 'Users',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow eyebrow-gold">${icon('users', 14)} Community</span>
            <h1>Platform users</h1>
            <p class="muted">Organizers, players and creators of TurniRUM.</p>
          </div>
          <div class="result-count"><b>${users.length}</b><span>${pluralWord(users.length, 'account', 'accounts')}</span></div>
        </div>
        <div class="card card-pad">
          <div class="table-wrap">
            <table class="standings">
              <thead><tr><th>User</th><th>Email</th><th>Role</th><th class="num">Tournaments</th><th class="num">Teams</th><th class="num">Joined</th></tr></thead>
              <tbody>${users.map((u) => html`
                <tr>
                  <td><div class="team-cell">${avatar(u.full_name, u.username)}<div class="team-name"><b>${u.full_name}</b><small>@${u.username}</small></div></div></td>
                  <td class="muted">${u.email}</td>
                  <td><span class="role-tag role-${u.role}">${u.role === 'creator' ? icon('crown', 12) : ''}${ROLE_LABELS[u.role]}</span></td>
                  <td class="num">${u.tournaments_count || '—'}</td>
                  <td class="num">${u.teams_count || '—'}</td>
                  <td class="num nowrap muted">${formatDate(u.created_at, { short: true })}</td>
                </tr>`)}</tbody>
            </table>
          </div>
        </div>
      </section>`,
  };
}
