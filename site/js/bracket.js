// The tournament bracket on the page: matches by stage and round, results for the organizer, and the
// "Reschedule" button for the captains of the two teams.
import * as api from './api.js';
import { busy, emptyState, formatDate, html, icon, toast } from './ui.js';

export const FORMAT_LABELS = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  round_robin: 'Round robin',
  groups_playoffs: 'Groups + playoffs',
};

export const FORMAT_HINTS = {
  single_elimination: 'Lose once and you are out. Fast and dramatic.',
  double_elimination: 'A second chance through the lower bracket.',
  round_robin: 'Everyone plays everyone. Fairest for small fields.',
  groups_playoffs: 'Groups first, then the best teams play knockout.',
};

const pad = (n) => String(n).padStart(2, '0');
const localInput = (iso) => {
  const d = new Date(iso ?? Date.now() + 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// League and group columns are rounds; knockout columns drop the match number ("Quarterfinal 2" → "Quarterfinals").
const columnTitle = (m) => (m.stage === 'league' || m.stage === 'group' ? `Round ${m.round}`
  : m.label.replace(/( ·)? \d+$/, '').replace(/^(Semi|Quarter)final$/, '$1finals'));

function sections(matches) {
  const shown = matches.filter((m) => m.status !== 'bye');
  const double = matches.some((m) => m.stage === 'lower');
  const out = [];
  const league = shown.filter((m) => m.stage === 'league');
  if (league.length) out.push({ title: 'Matches', matches: league });
  const groups = [...new Set(shown.filter((m) => m.stage === 'group').map((m) => m.group_name))].sort();
  for (const g of groups) out.push({ title: `Group ${g}`, group: g, matches: shown.filter((m) => m.stage === 'group' && m.group_name === g) });
  const main = shown.filter((m) => ['upper', 'playoff', 'final', 'third_place'].includes(m.stage));
  if (main.length) out.push({ title: double ? 'Upper bracket' : 'Playoffs', matches: main });
  const lower = shown.filter((m) => m.stage === 'lower');
  if (lower.length) out.push({ title: 'Lower bracket', matches: lower });
  const grand = shown.filter((m) => m.stage === 'grand_final');
  if (grand.length) out.push({ title: 'Grand final', matches: grand });
  return out;
}

// Points table of one group from its played matches.
function groupTable(matches, teamOf) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, name: teamOf.get(id)?.name ?? 'TBD', p: 0, w: 0, d: 0, l: 0, diff: 0, pts: 0 });
    return rows.get(id);
  };
  for (const m of matches) {
    if (m.team_a != null) row(m.team_a);
    if (m.team_b != null) row(m.team_b);
    if (m.status !== 'finished') continue;
    const a = row(m.team_a);
    const b = row(m.team_b);
    a.p += 1; b.p += 1;
    a.diff += m.score_a - m.score_b; b.diff += m.score_b - m.score_a;
    if (m.score_a > m.score_b) { a.w += 1; b.l += 1; } else if (m.score_b > m.score_a) { b.w += 1; a.l += 1; } else { a.d += 1; b.d += 1; }
  }
  for (const r of rows.values()) r.pts = r.w * 3 + r.d;
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.diff - x.diff || x.name.localeCompare(y.name));
}

function slotName(m, side, teamOf, byKey) {
  const id = side === 'a' ? m.team_a : m.team_b;
  if (id != null) return { name: teamOf.get(id)?.name ?? 'Team', known: true };
  const src = side === 'a' ? m.source_a : m.source_b;
  if (src.winner) return { name: `Winner · ${byKey.get(src.winner)?.label ?? src.winner}` };
  if (src.loser) return { name: `Loser · ${byKey.get(src.loser)?.label ?? src.loser}` };
  if (src.group) return { name: `Group ${src.group} · #${src.rank}` };
  return { name: 'Bye' };
}

const STATUS_TEXT = { pending: 'Waiting for teams', scheduled: 'Upcoming', finished: 'Played' };

function matchCard(m, ctx) {
  const { teamOf, byKey, mode, myTeamIds, votes, userId } = ctx;
  const a = slotName(m, 'a', teamOf, byKey);
  const b = slotName(m, 'b', teamOf, byKey);
  const mine = myTeamIds.has(m.team_a) || myTeamIds.has(m.team_b);
  const editable = mode === 'organizer' && (m.status === 'scheduled' || m.status === 'finished');
  const side = (s, id, score, team) => html`
    <div class="m-team ${m.status === 'finished' && m.winner_id === id ? 'is-win' : ''} ${myTeamIds.has(id) ? 'is-me' : ''} ${team.known ? '' : 'is-tbd'}">
      <span class="m-name" title="${team.name}">${team.name}</span>
      ${editable
        ? html`<input class="m-input" type="number" min="0" max="999" inputmode="numeric" data-score="${s}" value="${score ?? ''}" aria-label="Score of ${team.name}">`
        : html`<b class="m-score">${score ?? ''}</b>`}
    </div>`;

  let actions = '';
  if (editable) {
    actions = html`<button class="btn btn-primary btn-sm btn-block" type="button" data-report="${m.match_key}">${icon('check', 14)} ${m.status === 'finished' ? 'Update result' : 'Save result'}</button>`;
  }
  if (mode === 'organizer' && (m.status === 'scheduled' || m.status === 'pending')) {
    actions = html`${actions}
      <details class="m-move">
        <summary>${icon('clock', 13)} Move</summary>
        <div class="m-move-row">
          <input class="input input-sm" type="datetime-local" value="${localInput(m.scheduled_at)}" data-move-time aria-label="New start time">
          <button class="btn btn-ghost btn-sm" type="button" data-move="${m.match_key}">Save</button>
        </div>
      </details>`;
  }
  if (mode === 'player' && mine && m.status === 'scheduled' && Date.parse(m.scheduled_at) > Date.now()) {
    const v = votes.get(m.id) ?? { teams: new Set(), users: new Set() };
    const needed = [m.team_a, m.team_b].filter((id) => teamOf.get(id)?.captain_id).length || 1;
    const voted = v.users.has(userId);
    actions = html`
      <button class="btn ${voted ? 'btn-ghost' : 'btn-cyan'} btn-sm btn-block" type="button" data-reschedule="${m.id}" ${voted ? 'disabled' : ''}>
        ${icon('clock', 14)} ${voted ? 'You asked to move it' : 'Reschedule'} · ${v.teams.size}/${needed}
      </button>
      <small class="m-hint">${voted ? 'The match moves when the other team asks too.' : 'When both teams ask, the AI picks a new free time.'}</small>`;
  }
  return html`
    <div class="m-card m-${m.status} ${mine ? 'is-mine' : ''}" data-match="${m.id}">
      <div class="m-head"><span>${m.label}</span><span class="m-time">${m.scheduled_at && m.status !== 'finished'
        ? html`${icon('clock', 12)} ${formatDate(m.scheduled_at, { time: true, short: true })}` : STATUS_TEXT[m.status] ?? ''}</span></div>
      ${side('a', m.team_a, m.score_a, a)}
      ${side('b', m.team_b, m.score_b, b)}
      ${m.reschedule_count ? html`<small class="m-hint">${icon('refresh', 11)} moved ${m.reschedule_count === 1 ? 'once' : `${m.reschedule_count} times`}</small>` : ''}
      ${actions}
    </div>`;
}

export function bracketBoard(matches, teams, { mode = 'view', myTeamIds = new Set(), votes = new Map(), userId = null } = {}) {
  if (!matches.length) return emptyState('swords', 'No bracket yet', 'The organizer builds the bracket and the schedule when registration closes.');
  const ctx = {
    teamOf: new Map(teams.map((t) => [t.id, t])), byKey: new Map(matches.map((m) => [m.match_key, m])),
    mode, myTeamIds, votes, userId,
  };
  return html`
    <div class="bracket">
      ${sections(matches).map((section) => {
        const rounds = new Map();
        for (const m of section.matches) {
          if (!rounds.has(m.round)) rounds.set(m.round, []);
          rounds.get(m.round).push(m);
        }
        const columns = [...rounds.entries()].sort((x, y) => x[0] - y[0]);
        return html`
          <section class="br-section">
            <h4 class="br-title">${section.title}</h4>
            ${section.group ? html`
              <table class="br-table">
                <thead><tr><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">+/−</th><th class="num">Pts</th></tr></thead>
                <tbody>${groupTable(section.matches, ctx.teamOf).map((r, i) => html`
                  <tr class="${myTeamIds.has(r.id) ? 'is-mine' : ''}"><td><span class="br-rank">${i + 1}</span>${r.name}</td><td class="num">${r.p}</td><td class="num">${r.w}</td>
                  <td class="num">${r.d}</td><td class="num">${r.l}</td><td class="num">${r.diff > 0 ? '+' : ''}${r.diff}</td><td class="num"><b>${r.pts}</b></td></tr>`)}</tbody>
              </table>` : ''}
            <div class="br-rounds">
              ${columns.map(([, list]) => html`
                <div class="br-round">
                  <h5>${columnTitle(list.find((m) => m.stage !== 'third_place') ?? list[0])}</h5>
                  <div class="br-matches">${list.sort((x, y) => (x.stage === 'third_place') - (y.stage === 'third_place') || x.position - y.position).map((m) => matchCard(m, ctx))}</div>
                </div>`)}
            </div>
          </section>`;
      })}
    </div>`;
}

// Votes per match: which teams and which users asked to move it.
export function votesByMatch(rows) {
  const map = new Map();
  for (const v of rows) {
    if (!map.has(v.match_id)) map.set(v.match_id, { teams: new Set(), users: new Set() });
    map.get(v.match_id).teams.add(v.team_id);
    map.get(v.match_id).users.add(v.user_id);
  }
  return map;
}

export function bindBracket(root, tournamentId, reload) {
  root.querySelectorAll('[data-report]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
    const card = button.closest('[data-match]');
    const a = card.querySelector('[data-score="a"]').value;
    const b = card.querySelector('[data-score="b"]').value;
    if (a === '' || b === '') {
      toast('Enter the score of both teams.', 'error');
      return;
    }
    try {
      await api.reportMatch(tournamentId, button.dataset.report, Number(a), Number(b));
      toast('Result saved. The bracket and the standings are updated.', 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  })));
  root.querySelectorAll('[data-move]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
    const value = button.closest('.m-move').querySelector('[data-move-time]').value;
    const when = new Date(value);
    if (!value || Number.isNaN(when.getTime())) {
      toast('Pick the new start time.', 'error');
      return;
    }
    try {
      const { moved } = await api.moveMatch(tournamentId, button.dataset.move, when.toISOString());
      toast(moved.length > 1 ? `Moved. ${moved.length - 1} later match(es) moved along.` : 'The match was moved. The teams were notified.', 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  })));
  root.querySelectorAll('[data-reschedule]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
    try {
      const result = await api.voteReschedule(Number(button.dataset.reschedule));
      if (result.rescheduled) toast(`Moved: ${result.rescheduled.message}`, 'success');
      else toast(`Your request is in (${result.votes}/${result.needed}). The match moves when the other team asks too.`, 'info');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  })));
}
