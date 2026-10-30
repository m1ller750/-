import * as api from '../api.js';
import { tournamentFinance } from '../finance.js';
import { gameStyle } from '../games.js';
import { emptyState, html, icon, money, pluralWord, tournamentCard } from '../ui.js';

const SORTS = {
  soon: ['Starting soon', (a, b) => a.start_at.localeCompare(b.start_at)],
  new: ['Newest', (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id],
  popular: ['Most popular', (a, b) => b.team_count - a.team_count || a.start_at.localeCompare(b.start_at)],
  prize: ['Biggest prize pool', (a, b) => tournamentFinance(b).potential.prize - tournamentFinance(a).potential.prize],
  fee_asc: ['Cheapest', (a, b) => Number(a.is_paid) - Number(b.is_paid) || a.entry_fee - b.entry_fee],
  fee_desc: ['Most expensive', (a, b) => Number(b.is_paid) - Number(a.is_paid) || b.entry_fee - a.entry_fee],
};

function readFilters(query, feeCeiling) {
  const pick = (name, allowed, fallback) => (allowed.includes(query.get(name)) ? query.get(name) : fallback);
  const maxFee = Number(query.get('max_fee'));
  return {
    q: (query.get('q') ?? '').trim().slice(0, 80),
    game: (query.get('game') ?? '').trim(),
    price: pick('price', ['all', 'free', 'paid'], 'all'),
    status: pick('status', ['all', 'registration', 'active', 'finished'], 'all'),
    fmt: pick('fmt', ['all', 'online', 'offline'], 'all'),
    maxFee: query.has('max_fee') && Number.isFinite(maxFee) && maxFee < feeCeiling ? Math.max(0, maxFee) : null,
    available: query.get('available') === '1',
    joined: query.get('joined') === '1',
    sort: pick('sort', Object.keys(SORTS), 'soon'),
  };
}

function applyFilters(tournaments, f, joinedIds) {
  const q = f.q.toLowerCase();
  return tournaments.filter((t) => {
    if (q && ![t.title, t.game, t.description, t.city, t.organizer_name].some((v) => (v ?? '').toLowerCase().includes(q))) return false;
    if (f.game && t.game.toLowerCase() !== f.game.toLowerCase()) return false;
    if (f.price === 'free' && t.is_paid) return false;
    if (f.price === 'paid' && !t.is_paid) return false;
    if (f.status !== 'all' && t.status !== f.status) return false;
    if (f.fmt !== 'all' && t.format !== f.fmt) return false;
    if (f.maxFee !== null && f.price !== 'free' && t.is_paid && Number(t.entry_fee) > f.maxFee) return false;
    if (f.available && !(t.status === 'registration' && t.team_count < t.max_teams)) return false;
    if (f.joined && !joinedIds.has(t.id)) return false;
    return true;
  }).sort(SORTS[f.sort][1]);
}

const activeCount = (f) => [f.q, f.game, f.price !== 'all', f.status !== 'all', f.fmt !== 'all', f.maxFee !== null,
  f.available, f.joined].filter(Boolean).length;

function segmented(name, current, options) {
  return html`<div class="segmented">${options.map(([value, label, ic]) => html`
    <input type="radio" name="${name}" id="${name}-${value}" value="${value}" ${current === value ? 'checked' : ''}>
    <label for="${name}-${value}">${ic ? icon(ic, 14) : ''} ${label}</label>`)}</div>`;
}

function results(list, f, joinedIds, profile) {
  if (list.length) return html`<div class="t-grid">${list.map((t) => tournamentCard(t, joinedIds.has(t.id)))}</div>`;
  if (activeCount(f)) return emptyState('search', 'Nothing found', 'Try loosening the filters or searching for another game.');
  if (profile?.role === 'organizer') {
    return emptyState('trophy', 'Nothing here yet', 'Create the first tournament — players are waiting.', '#/organizer/new', 'Create a tournament');
  }
  return emptyState('trophy', 'Nothing here yet', 'Organizers have not created any tournaments yet. Check back soon!');
}

export async function catalogView({ query, profile }) {
  const [tournaments, mine] = await Promise.all([
    api.listTournaments(),
    profile?.role === 'participant' ? api.myTeams(profile.id) : Promise.resolve([]),
  ]);
  const joinedIds = new Set(mine.map((team) => team.tournament_id));
  const maxPaidFee = Math.max(0, ...tournaments.filter((t) => t.is_paid).map((t) => Number(t.entry_fee)));
  const feeCeiling = Math.max(50, Math.ceil(maxPaidFee / 5) * 5);
  const f = readFilters(query, feeCeiling);

  const games = [...tournaments.reduce((map, t) => {
    const key = t.game.toLowerCase();
    const entry = map.get(key) ?? { game: t.game, n: 0 };
    entry.n += 1;
    return map.set(key, entry);
  }, new Map()).values()].sort((a, b) => b.n - a.n || a.game.localeCompare(b.game));

  const list = applyFilters(tournaments, f, joinedIds);
  const sliderValue = f.maxFee ?? feeCeiling;

  return {
    title: 'Tournament catalog',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('trophy', 14)} Catalog</span>
            <h1>Find your tournament</h1>
            <p class="muted">Filter by game, price, format and status — then register your team.</p>
          </div>
          <div class="result-count"><b data-result-count>${list.length}</b><span data-result-label>${pluralWord(list.length, 'tournament found', 'tournaments found')}</span></div>
        </div>

        <form class="card filters" data-filters novalidate>
          <div class="filters-top">
            <label class="search-field">
              ${icon('search', 20)}
              <input class="input input-lg" type="search" name="q" value="${f.q}" placeholder="Title, game, city or organizer" aria-label="Search">
            </label>
            <label class="select-wrap">
              ${icon('sliders', 16)}
              <select class="select" name="sort" aria-label="Sort by">
                ${Object.entries(SORTS).map(([key, [label]]) => html`<option value="${key}" ${f.sort === key ? 'selected' : ''}>${label}</option>`)}
              </select>
            </label>
          </div>

          <div class="filters-grid">
            <div class="filter-group"><span class="label">Price</span>
              ${segmented('price', f.price, [['all', 'All', 'star'], ['free', 'Free', 'gift'], ['paid', 'Paid', 'coins']])}</div>
            <div class="filter-group"><span class="label">Status</span>
              ${segmented('status', f.status, [['all', 'Any'], ['registration', 'Open'], ['active', 'Live'], ['finished', 'Finished']])}</div>
            <div class="filter-group"><span class="label">Format</span>
              ${segmented('fmt', f.fmt, [['all', 'All', 'star'], ['online', 'Online', 'globe'], ['offline', 'Offline', 'pin']])}</div>
            <div class="filter-group filter-range ${f.price === 'free' ? 'is-disabled' : ''}" data-fee-group>
              <span class="label">Entry fee up to <output data-fee-out>${money(sliderValue)}</output></span>
              <input class="range" type="range" name="max_fee" min="0" max="${feeCeiling}" step="5" value="${sliderValue}" ${f.price === 'free' ? 'disabled' : ''} aria-label="Maximum entry fee">
            </div>
          </div>

          ${games.length ? html`
            <div class="filter-group">
              <span class="label">Game</span>
              <div class="chips">
                <input type="radio" name="game" id="game-all" value="" ${f.game ? '' : 'checked'}>
                <label for="game-all" class="chip">All games</label>
                ${games.map((g, i) => {
                  const st = gameStyle(g.game);
                  return html`
                    <input type="radio" name="game" id="game-${i}" value="${g.game}" ${f.game.toLowerCase() === g.game.toLowerCase() ? 'checked' : ''}>
                    <label for="game-${i}" class="chip" style="--c1: ${st.c1}; --c2: ${st.c2}"><i class="chip-dot"></i>${g.game} <small>${g.n}</small></label>`;
                })}
              </div>
            </div>` : ''}

          <div class="filters-bottom">
            <label class="switch"><input type="checkbox" name="available" ${f.available ? 'checked' : ''}><span class="track"></span><span>Only with free slots</span></label>
            ${profile?.role === 'participant' ? html`
              <label class="switch"><input type="checkbox" name="joined" ${f.joined ? 'checked' : ''}><span class="track"></span><span>Only my tournaments</span></label>` : ''}
            <div class="filters-actions">
              <button class="btn btn-ghost btn-sm" type="button" data-reset ${activeCount(f) ? '' : 'hidden'}>${icon('x', 14)} Reset filters</button>
            </div>
          </div>
        </form>

        <div data-results>${results(list, f, joinedIds, profile)}</div>
      </section>`,

    mount(root) {
      const form = root.querySelector('[data-filters]');
      const out = root.querySelector('[data-results]');
      const feeOut = root.querySelector('[data-fee-out]');
      const range = form.elements.max_fee;
      let timer = null;

      const update = () => {
        const params = new URLSearchParams();
        const v = (name) => form.elements[name]?.value ?? '';
        if (v('q').trim()) params.set('q', v('q').trim());
        const game = form.querySelector('input[name="game"]:checked')?.value;
        if (game) params.set('game', game);
        for (const name of ['price', 'status', 'fmt']) {
          const value = form.querySelector(`input[name="${name}"]:checked`)?.value;
          if (value && value !== 'all') params.set(name, value);
        }
        if (Number(range.value) < feeCeiling) params.set('max_fee', range.value);
        if (form.elements.available.checked) params.set('available', '1');
        if (form.elements.joined?.checked) params.set('joined', '1');
        if (v('sort') !== 'soon') params.set('sort', v('sort'));

        const qs = params.toString();
        history.replaceState(null, '', `#/tournaments${qs ? `?${qs}` : ''}`);
        const filters = readFilters(params, feeCeiling);
        const found = applyFilters(tournaments, filters, joinedIds);
        out.innerHTML = results(found, filters, joinedIds, profile).toString();
        out.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
        root.querySelector('[data-result-count]').textContent = found.length;
        root.querySelector('[data-result-label]').textContent = pluralWord(found.length, 'tournament found', 'tournaments found');
        root.querySelector('[data-reset]').hidden = !activeCount(filters);
        const freeOnly = filters.price === 'free';
        range.disabled = freeOnly;
        root.querySelector('[data-fee-group]').classList.toggle('is-disabled', freeOnly);
      };

      form.addEventListener('submit', (event) => event.preventDefault());
      form.addEventListener('change', (event) => { if (event.target.name !== 'q') update(); });
      form.addEventListener('input', (event) => {
        if (event.target === range) feeOut.textContent = money(range.value);
        if (event.target.name === 'q') {
          clearTimeout(timer);
          timer = setTimeout(update, 250);
        }
      });
      root.querySelector('[data-reset]').addEventListener('click', () => {
        form.reset();
        form.elements.q.value = '';
        form.querySelector('#game-all').checked = true;
        for (const name of ['price', 'status', 'fmt']) form.querySelector(`#${name}-all`).checked = true;
        range.value = feeCeiling;
        feeOut.textContent = money(feeCeiling);
        form.elements.available.checked = false;
        if (form.elements.joined) form.elements.joined.checked = false;
        form.elements.sort.value = 'soon';
        update();
      });
    },
  };
}
