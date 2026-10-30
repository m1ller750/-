import * as api from '../api.js';
import { PLATFORM_FEE } from '../config.js';
import { sumSplits, tournamentFinance } from '../finance.js';
import { hueOf, initials } from '../games.js';
import {
  STATUS_LABELS, centsToMoney, emptyState, formatNumber, gameTile, html, icon, placeBadge, pluralWord, standings,
  tournamentCard,
} from '../ui.js';

const SAMPLE_BOARD = [['Steppe Wolves', 6, 1, 18], ['Nomad Five', 5, 2, 15], ['Astana Lions', 4, 3, 12],
  ['Qazaq Eagles', 3, 4, 9], ['Tengri Force', 2, 5, 6]];

function heroActions(profile) {
  if (!profile) {
    return html`
      <a class="btn btn-primary btn-lg" href="#/register?role=organizer">${icon('trophy', 18)} Host a tournament</a>
      <a class="btn btn-ghost btn-lg" href="#/register?role=participant">${icon('swords', 18)} Compete</a>`;
  }
  const main = {
    organizer: html`<a class="btn btn-primary btn-lg" href="#/organizer/new">${icon('plus', 18)} Create a tournament</a>`,
    creator: html`<a class="btn btn-primary btn-lg" href="#/creator">${icon('crown', 18)} Creator dashboard</a>`,
    participant: html`<a class="btn btn-primary btn-lg" href="#/tournaments?available=1">${icon('swords', 18)} Find a tournament</a>`,
  }[profile.role];
  return html`${main}<a class="btn btn-ghost btn-lg" href="#/tournaments">Browse tournaments ${icon('arrow', 18)}</a>`;
}

function board(showcase, teams) {
  const rows = teams.length
    ? teams.map((t) => html`
        <li>${placeBadge(t.place)}<span class="team-avatar" style="--h: ${t.hue}">${t.initials}</span>
          <span class="board-name">${t.name}</span><span class="board-wl">${t.wins}–${t.losses}</span><b class="board-pts">${t.points}</b></li>`)
    : SAMPLE_BOARD.map(([name, w, l, p], i) => html`
        <li>${placeBadge(i + 1)}<span class="team-avatar" style="--h: ${hueOf(name)}">${initials(name)}</span>
          <span class="board-name">${name}</span><span class="board-wl">${w}–${l}</span><b class="board-pts">${p}</b></li>`);
  const head = showcase
    ? html`${gameTile(showcase, 'sm')}<div><b>${showcase.title}</b><small>${showcase.game} · ${STATUS_LABELS[showcase.status]}</small></div>
        ${showcase.status === 'active' ? html`<span class="live-pill"><i></i>LIVE</span>` : ''}`
    : html`<span class="game-tile game-tile-sm" style="--c1: #f59e0b; --c2: #ef4444">CS2</span>
        <div><b>Steppe Cup</b><small>Counter-Strike 2 · Live</small></div><span class="live-pill"><i></i>LIVE</span>`;
  return html`<div class="float-card hero-board"><div class="board-head">${head}</div><ol class="board-list">${rows}</ol></div>`;
}

export async function homeView({ profile }) {
  const [tournaments, players] = await Promise.all([api.listTournaments(), api.countParticipants()]);
  const byNewest = [...tournaments].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  let featured = byNewest.filter((t) => t.status === 'registration').slice(0, 6);
  if (featured.length < 3) featured = byNewest.slice(0, 6);

  const prizeCents = sumSplits(tournaments.map((t) => tournamentFinance(t).collected)).prize;
  const teamCount = tournaments.reduce((sum, t) => sum + t.team_count, 0);
  const rank = { active: 0, finished: 1, registration: 2 };
  const showcase = [...tournaments].sort((a, b) => rank[a.status] - rank[b.status] || b.team_count - a.team_count)
    .find((t) => t.team_count >= 3) ?? null;
  const showcaseTeams = showcase ? standings(await api.getTeams(showcase.id)).slice(0, 5) : [];

  return {
    title: 'Tournaments that crown champions',
    html: html`
      <section class="hero">
        <div class="container hero-grid">
          <div class="hero-copy">
            <span class="eyebrow">${icon('sparkles', 14)} The next-gen tournament platform</span>
            <h1 class="hero-title">Tournaments that <span class="grad-text grad-anim">crown champions</span></h1>
            <p class="hero-lead">
              Launch free or paid tournaments in minutes, keep live standings and split the prize pool transparently.
              Players find their next competition with smart filters and pay entry fees securely with PayPal.
            </p>
            <div class="hero-actions">${heroActions(profile)}</div>
            <div class="hero-trust">
              <div class="avatars">${['Alex', 'Dana', 'Tim', 'Maria', 'Arman'].map((n) => html`<span class="avatar" style="--h: ${hueOf(n)}">${n[0]}</span>`)}</div>
              <span>Thousands of matches. One platform. <b>Zero spreadsheet chaos.</b></span>
            </div>
          </div>
          <div class="hero-visual" aria-hidden="true">
            ${board(showcase, showcaseTeams)}
            <div class="float-card hero-split">
              <div class="mini-donut" style="--p1: 60; --p2: 30"></div>
              <div>
                <small>Where entry fees go</small>
                <ul>
                  <li><i class="sw sw-prize"></i>Prizes <b>60%</b></li>
                  <li><i class="sw sw-org"></i>Organizer <b>30%</b></li>
                  <li><i class="sw sw-platform"></i>Platform <b>${PLATFORM_FEE}%</b></li>
                </ul>
              </div>
            </div>
            <div class="float-card hero-card-mini">
              <span class="kpi-icon">${icon('trophy', 18)}</span>
              <div><small>Prize pools</small><b>${centsToMoney(prizeCents || 1250000)}</b></div>
            </div>
          </div>
        </div>
      </section>

      <section class="container stats-strip reveal">
        <div class="stat"><b data-count="${tournaments.length}">${formatNumber(tournaments.length)}</b><span>${pluralWord(tournaments.length, 'tournament', 'tournaments')} hosted</span></div>
        <div class="stat"><b data-count="${teamCount}">${formatNumber(teamCount)}</b><span>${pluralWord(teamCount, 'team', 'teams')} competing</span></div>
        <div class="stat"><b data-count="${players}">${formatNumber(players)}</b><span>${pluralWord(players, 'player', 'players')} signed up</span></div>
        <div class="stat"><b>${centsToMoney(prizeCents)}</b><span>raised for prize pools</span></div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head section-head-row">
            <div>
              <span class="eyebrow">${icon('zap', 14)} Registration open</span>
              <h2>Fresh tournaments</h2>
              <p>Pick a discipline, assemble your team and fight for the prize pool.</p>
            </div>
            <a class="btn btn-ghost" href="#/tournaments">All tournaments ${icon('arrow', 16)}</a>
          </div>
          ${featured.length
            ? html`<div class="t-grid">${featured.map((t) => tournamentCard(t))}</div>`
            : emptyState('trophy', 'No tournaments yet', 'Be the first organizer on the platform — it takes a couple of minutes.',
              '#/register?role=organizer', 'Create a tournament')}
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow">${icon('users', 14)} Two roles — one platform</span>
            <h2>Who are you today?</h2>
            <p>Pick a role when you sign up and get a workspace built for what you do.</p>
          </div>
          <div class="roles-grid">
            <article class="card role-card role-card-org reveal">
              <div class="role-card-icon">${icon('trophy', 28)}</div>
              <h3>Organizer</h3>
              <p>Run tournaments and earn from them.</p>
              <ul class="check-list">
                <li>${icon('check', 16)} Free and paid tournaments</li>
                <li>${icon('check', 16)} Entry fees collected with PayPal</li>
                <li>${icon('check', 16)} Editable live standings</li>
                <li>${icon('check', 16)} Business model and income analytics</li>
              </ul>
              ${profile ? '' : html`<a class="btn btn-primary btn-block" href="#/register?role=organizer">Become an organizer ${icon('arrow', 16)}</a>`}
            </article>
            <article class="card role-card role-card-player reveal">
              <div class="role-card-icon">${icon('swords', 28)}</div>
              <h3>Player</h3>
              <p>Find tournaments and compete for prizes.</p>
              <ul class="check-list">
                <li>${icon('check', 16)} Catalog with smart filters</li>
                <li>${icon('check', 16)} One-click team registration</li>
                <li>${icon('check', 16)} Instant PayPal checkout — no waiting for approval</li>
                <li>${icon('check', 16)} Standings for all your tournaments</li>
              </ul>
              ${profile ? '' : html`<a class="btn btn-cyan btn-block" href="#/register?role=participant">Start competing ${icon('arrow', 16)}</a>`}
            </article>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="card model-teaser reveal">
            <div class="model-teaser-copy">
              <span class="eyebrow">${icon('pie', 14)} Fair economics</span>
              <h2>Every entry fee powers the tournament</h2>
              <p>
                The organizer decides how much of the entry fees goes to the prize pool and how much they keep.
                The platform takes a flat <b>${PLATFORM_FEE}%</b> of paid tournaments only. Free tournaments stay free.
              </p>
              <div class="model-steps">
                <div><span class="step-n">1</span><b>Pay</b><small>The team pays the entry fee with PayPal</small></div>
                <div><span class="step-n">2</span><b>Verify</b><small>The payment is verified automatically on our server</small></div>
                <div><span class="step-n">3</span><b>Split</b><small>Prizes, organizer income and ${PLATFORM_FEE}% for the platform</small></div>
              </div>
            </div>
            <div class="model-teaser-visual">
              <div class="donut" style="--size: 240px; --p1: 60; --p2: 30">
                <div class="donut-center"><small>Example: 16 teams × $25</small><b>$400</b></div>
              </div>
              <ul class="legend legend-compact">
                <li><i class="sw sw-prize"></i><span>Prize pool</span><em>60%</em><b>$240</b></li>
                <li><i class="sw sw-org"></i><span>Organizer</span><em>30%</em><b>$120</b></li>
                <li><i class="sw sw-platform"></i><span>Platform</span><em>${PLATFORM_FEE}%</em><b>$40</b></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      ${profile ? '' : html`
        <section class="section section-cta">
          <div class="container">
            <div class="cta-box reveal">
              <h2>Ready for your first tournament?</h2>
              <p>Signing up is free and takes less than a minute.</p>
              <div class="hero-actions hero-actions-center">
                <a class="btn btn-light btn-lg" href="#/register">Create an account ${icon('arrow', 18)}</a>
                <a class="btn btn-outline-light btn-lg" href="#/login">I already have an account</a>
              </div>
            </div>
          </div>
        </section>`}`,
  };
}
