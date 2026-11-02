// Player pages: the bracket of their tournaments (with "Reschedule") and the team finder with AI teammate picks.
import * as api from '../api.js';
import { bindBracket, bracketBoard, FORMAT_LABELS, votesByMatch } from '../bracket.js';
import { GAME_NAMES } from '../games.js';
import {
  avatar, busy, emptyState, formValues, formatDate, gameTile, html, icon, plural, showFieldErrors, toast,
} from '../ui.js';

// ---------------------------------------------------------------- bracket --

export async function bracketPageView({ query, profile, reload }) {
  const [tournaments, myTeams] = await Promise.all([api.listTournaments(), api.myTeams(profile.id)]);
  const myTeamIds = new Set(myTeams.map((team) => team.id));
  const myMatches = await api.teamMatches([...myTeamIds]);
  const bracketIds = new Set(myMatches.map((m) => m.tournament_id));
  const list = tournaments.filter((t) => bracketIds.has(t.id))
    .sort((a, b) => ({ active: 0, registration: 1, finished: 2 })[a.status] - ({ active: 0, registration: 1, finished: 2 })[b.status]);
  const head = html`
    <div class="page-head">
      <div>
        <span class="eyebrow">${icon('swords', 14)} Player</span>
        <h1>Bracket</h1>
        <p class="muted">Your next matches and the full bracket. If your team cannot play at the planned time, press <b>Reschedule</b>: when both teams ask, the AI moves the match to a free time.</p>
      </div>
    </div>`;
  if (!list.length) {
    return {
      title: 'Bracket',
      html: html`<section class="container">${head}${emptyState('swords', 'No brackets yet',
        'Your tournaments get a bracket and a schedule when the organizer builds it. Join a tournament to play.', '#/tournaments?available=1', 'Find a tournament')}</section>`,
    };
  }
  const t = list.find((item) => item.id === Number(query.get('id'))) ?? list[0];
  const upcoming = myMatches.filter((m) => m.status === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const neededTeams = [...new Set([...upcoming.map((m) => m.tournament_id), t.id])];
  const teamLists = await Promise.all(neededTeams.map((id) => api.getTeams(id)));
  const allTeams = new Map(teamLists.flat().map((team) => [team.id, team]));
  const [matches, voteRows] = await Promise.all([
    api.getMatches(t.id),
    api.getVotes([...new Set([...upcoming.map((m) => m.id), ...myMatches.filter((m) => m.tournament_id === t.id).map((m) => m.id)])]),
  ]);
  const votes = votesByMatch(voteRows);
  const titleOf = new Map(tournaments.map((item) => [item.id, item.title]));
  const name = (id) => allTeams.get(id)?.name ?? 'TBD';

  return {
    title: 'Bracket',
    html: html`
      <section class="container">
        ${head}
        <div class="split">
          <aside class="side-list card">
            <div class="side-list-head"><span class="label">My tournaments</span><span class="count-pill">${list.length}</span></div>
            <nav>${list.map((item) => html`
              <a href="#/bracket?id=${item.id}" class="side-item ${item.id === t.id ? 'active' : ''}">
                ${gameTile(item, 'sm')}
                <span class="side-item-text"><b>${item.title}</b><small>${FORMAT_LABELS[item.bracket_format] ?? 'Bracket'} · ${item.game}</small></span>
              </a>`)}</nav>
          </aside>
          <div class="split-main">
            <div class="card card-pad">
              <div class="card-head"><h3 class="card-title">${icon('clock', 18)} Your next matches</h3><span class="muted small">${plural(upcoming.length, 'match', 'matches')}</span></div>
              ${upcoming.length ? html`
                <ul class="next-matches">
                  ${upcoming.slice(0, 8).map((m) => {
                    const mine = myTeamIds.has(m.team_a) ? m.team_a : m.team_b;
                    const other = mine === m.team_a ? m.team_b : m.team_a;
                    const v = votes.get(m.id) ?? { teams: new Set(), users: new Set() };
                    const needed = [m.team_a, m.team_b].filter((id) => allTeams.get(id)?.captain_id).length || 1;
                    const voted = v.users.has(profile.id);
                    return html`
                      <li class="next-match">
                        <div class="next-match-time"><b>${formatDate(m.scheduled_at, { short: true })}</b><small>${new Date(m.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></div>
                        <div class="next-match-body">
                          <b>${name(mine)} <span class="muted">vs</span> ${name(other)}</b>
                          <small>${titleOf.get(m.tournament_id)} · ${m.label}${m.reschedule_count ? ' · moved' : ''}</small>
                        </div>
                        <button class="btn ${voted ? 'btn-ghost' : 'btn-cyan'} btn-sm" type="button" data-reschedule="${m.id}" ${voted ? 'disabled' : ''}>
                          ${icon('clock', 14)} ${voted ? 'Asked' : 'Reschedule'} · ${v.teams.size}/${needed}
                        </button>
                      </li>`;
                  })}
                </ul>` : html`<p class="muted">No upcoming matches. The next ones appear when the teams of the previous round are known.</p>`}
            </div>
            <div class="card card-pad">
              <div class="card-head">
                <h3 class="card-title">${icon('swords', 18)} ${t.title}</h3>
                <a class="btn btn-ghost btn-sm" href="#/t/${t.id}">${icon('eye', 15)} Tournament page</a>
              </div>
              ${bracketBoard(matches, teamLists[neededTeams.indexOf(t.id)], { mode: 'player', myTeamIds, votes, userId: profile.id })}
            </div>
          </div>
        </div>
      </section>`,
    mount(root) {
      bindBracket(root, t.id, reload);
      if (query.get('id') !== String(t.id)) history.replaceState(null, '', `#/bracket?id=${t.id}`);
    },
  };
}

// ------------------------------------------------------------ team finder --

function playerCard(p, { reason = null, match = null } = {}) {
  return html`
    <article class="mate-card">
      <div class="mate-head">
        ${avatar(p.full_name, p.username)}
        <div class="mate-name"><b>${p.full_name}</b><small>@${p.username}</small></div>
        ${match != null ? html`<span class="mate-match" title="How well you would fit">${match}%</span>` : ''}
      </div>
      ${reason ? html`<p class="mate-reason">${icon('sparkles', 14)} ${reason}</p>` : ''}
      <div class="mate-tags">
        ${(p.games ?? []).map((g) => html`<span class="chip chip-sm">${g}</span>`)}
        ${p.tournaments != null ? html`<span class="chip chip-sm chip-muted">${plural(p.tournaments, 'tournament', 'tournaments')} · ${p.wins}–${p.draws}–${p.losses}</span>` : ''}
        ${p.looking ? html`<span class="badge badge-registration"><i class="dot"></i>Looking for a team</span>` : ''}
      </div>
      ${p.note ? html`<p class="muted small">“${p.note}”</p>` : ''}
      ${p.contact ? html`<p class="small">${icon('send', 13)} ${p.contact}</p>` : ''}
      <form class="mate-invite" data-invite="${p.user_id}" novalidate>
        <input class="input input-sm" name="message" maxlength="300" placeholder="Say hi (optional)" aria-label="Message">
        <button class="btn btn-primary btn-sm" type="submit">${icon('send', 14)} Invite</button>
      </form>
    </article>`;
}

export async function teamFinderView({ profile, reload }) {
  const [card, looking, myTeams, tournaments] = await Promise.all([
    api.getPlayerCard(profile.id), api.lookingPlayers(), api.myTeams(profile.id), api.listTournaments(),
  ]);
  const playedGames = [...new Set(tournaments.filter((t) => myTeams.some((team) => team.tournament_id === t.id)).map((t) => t.game))];
  const others = looking.filter((c) => c.user_id !== profile.id).map((c) => ({
    ...c, username: c.profile?.username ?? '', full_name: c.profile?.full_name ?? 'Player',
  }));
  const games = card?.games?.length ? card.games : playedGames;

  return {
    title: 'Find a team',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('users', 14)} Player</span>
            <h1>Find a team</h1>
            <p class="muted">The AI looks at the tournaments you played (games, results, cities) and suggests players who would fit your team.</p>
          </div>
        </div>
        <div class="two-col two-col-wide">
          <div class="card card-pad">
            <h3 class="card-title">${icon('user', 18)} Your card</h3>
            <form class="form" data-card novalidate>
              <label class="switch"><input type="checkbox" name="looking" ${card?.looking ? 'checked' : ''}><span class="track"></span><span>I am looking for a team</span></label>
              <label class="field" data-field="games">
                <span class="label">Games, comma separated</span>
                <input class="input" name="games" list="finder-games" value="${games.join(', ')}" placeholder="Valorant, CS2">
                <datalist id="finder-games">${GAME_NAMES.map((g) => html`<option value="${g}">`)}</datalist>
              </label>
              <label class="field" data-field="note">
                <span class="label">About you <em class="muted">(role, schedule, level)</em></span>
                <textarea class="textarea" name="note" rows="3" maxlength="300" placeholder="Duelist, evenings after 19:00, Gold 2">${card?.note ?? ''}</textarea>
              </label>
              <label class="field" data-field="contact">
                <span class="label">Contact for teammates</span>
                <span class="input-icon">${icon('send', 17)}<input class="input" name="contact" maxlength="100" value="${card?.contact ?? ''}" placeholder="Discord: nick#1234 or Telegram: @nick"></span>
                <small class="muted">Shown to players you invite, and to everyone while you are looking for a team.</small>
              </label>
              <button class="btn btn-primary" type="submit">${icon('save', 16)} Save card</button>
            </form>
          </div>
          <div class="card card-pad">
            <div class="card-head">
              <h3 class="card-title">${icon('sparkles', 18)} AI teammate picks</h3>
              <button class="btn btn-primary btn-sm" type="button" data-ai-mates>${icon('sparkles', 15)} Find teammates</button>
            </div>
            <div data-mates>
              <p class="muted">${playedGames.length
                ? `Based on your ${plural(myTeams.length, 'tournament', 'tournaments')} in ${playedGames.join(', ')}.`
                : 'Play a tournament or fill in your games, then let the AI find you teammates.'}</p>
            </div>
          </div>
        </div>
        <div class="card card-pad">
          <div class="card-head"><h3 class="card-title">${icon('users', 18)} Players looking for a team</h3><span class="muted small">${plural(others.length, 'player', 'players')}</span></div>
          ${others.length ? html`<div class="mates-grid">${others.map((p) => playerCard(p))}</div>`
            : emptyState('users', 'Nobody is looking right now', 'Turn on “I am looking for a team” on your card so others can find you.')}
        </div>
      </section>`,
    mount(root) {
      const form = root.querySelector('[data-card]');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = formValues(form);
        const list = values.games.split(',').map((g) => g.trim()).filter(Boolean);
        const errors = {};
        if (list.length > 8) errors.games = 'Pick at most 8 games.';
        if (values.looking && !values.contact.trim()) errors.contact = 'Add a contact so teams can reach you.';
        showFieldErrors(form, errors);
        if (Object.keys(errors).length) return;
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            await api.savePlayerCard({ looking: values.looking, games: list, note: values.note.trim(), contact: values.contact.trim() });
            toast('Your card is saved.', 'success');
            reload();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      const bindInvites = (scope) => scope.querySelectorAll('[data-invite]').forEach((invite) => invite.addEventListener('submit', (event) => {
        event.preventDefault();
        busy(invite.querySelector('[type=submit]'), async () => {
          try {
            await api.inviteTeammate(invite.dataset.invite, invite.elements.message.value.trim());
            invite.innerHTML = html`<span class="pay-state pay-ok">${icon('check', 13)} Invitation sent</span>`.toString();
            toast('Invitation sent. The player gets a notification and an email.', 'success');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      }));
      bindInvites(root);

      const box = root.querySelector('[data-mates]');
      root.querySelector('[data-ai-mates]').addEventListener('click', (event) => busy(event.currentTarget, async () => {
        box.innerHTML = html`<div class="paypal-loading"><span class="spinner"></span> The AI is looking through tournaments…</div>`.toString();
        try {
          const { picks, ai } = await api.aiTeammates();
          box.innerHTML = (picks.length
            ? html`${ai ? '' : html`<p class="muted small">The AI was busy, so these picks come from simple matching.</p>`}
                <div class="mates-grid">${picks.map((p) => playerCard(p, { reason: p.reason, match: p.match }))}</div>`
            : emptyState('users', 'No matches yet', 'There are not enough players with tournament history yet. Turn on “looking for a team” so others find you.')).toString();
          bindInvites(box);
        } catch (error) {
          box.innerHTML = '';
          toast(error.message, 'error');
        }
      }));
    },
  };
}
