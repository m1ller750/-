// Tournament brackets: the matches of a format, their schedule, and teams moving forward as results come in.
// Pure functions without I/O, shared by the `api` Edge Function and the browser tests. The AI only chooses the
// format, the seeding and the timing; everything here is deterministic, so a bracket is always valid.
//
// A match slot is filled from a source: { team: id }, { winner: key }, { loser: key }, { group: 'A', rank: 1 }
// or { empty: true } (a bye). resolveBracket() recomputes every unplayed slot from the sources and the results.

export const FORMATS = ['single_elimination', 'double_elimination', 'round_robin', 'groups_playoffs'];

export const FORMAT_LABELS = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  round_robin: 'Round robin',
  groups_playoffs: 'Groups + playoffs',
};

// Stages that need a winner (no draws).
export const KNOCKOUT_STAGES = new Set(['upper', 'lower', 'playoff', 'final', 'grand_final', 'third_place']);

const EMPTY = { empty: true };
const PENDING = 'pending';
const MINUTE = 60_000;
const DAY = 86_400_000;
const LETTERS = 'ABCDEFGH';

// Formats that work for n teams.
export function formatsFor(n) {
  const list = [];
  if (n >= 2) list.push('single_elimination');
  if (n >= 4) list.push('double_elimination');
  if (n >= 3 && n <= 16) list.push('round_robin');
  if (n >= 6) list.push('groups_playoffs');
  return list;
}

const clampInt = (value, lo, hi, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

// Fills in and bounds the settings, so whatever the AI or a person proposes can be built.
export function normalizeSettings(format, n, raw = {}) {
  const s = {
    best_of: [1, 3, 5].includes(Number(raw.best_of)) ? Number(raw.best_of) : 1,
    match_minutes: clampInt(raw.match_minutes, 10, 300, 45),
    break_minutes: clampInt(raw.break_minutes, 0, 120, 15),
    parallel: clampInt(raw.parallel, 1, 32, Math.max(1, Math.floor(n / 2))),
    rounds_per_day: clampInt(raw.rounds_per_day, 0, 30, 0),
    third_place: raw.third_place !== false,
  };
  if (format === 'groups_playoffs') {
    const maxGroups = Math.min(8, Math.floor(n / 3));
    s.groups = clampInt(raw.groups, 2, maxGroups, Math.min(maxGroups, n >= 16 ? 4 : 2));
    const smallest = Math.floor(n / s.groups);
    s.advance = clampInt(raw.advance, 1, Math.min(4, smallest - 1), Math.min(2, smallest - 1));
  }
  return s;
}

// Classic seeding: 1 meets the last seed, and the top two can only meet in the final.
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, sum - seed]);
  }
  return order;
}

function newMatch(key, stage, round, position, a, b, extra = {}) {
  return {
    match_key: key, stage, group_name: null, round, position, phase: 0, label: '', source_a: a, source_b: b,
    team_a: null, team_b: null, score_a: null, score_b: null, winner_id: null, loser_id: null,
    status: 'pending', scheduled_at: null, ...extra,
  };
}

const teamSource = (id) => (id == null ? EMPTY : { team: id });

function roundLabel(r, k, i, count, prefix = '') {
  const n = count > 1 ? ` ${i + 1}` : '';
  if (r === k) return `${prefix}Final`;
  if (r === k - 1) return `${prefix}Semifinal${n}`;
  if (r === k - 2) return `${prefix}Quarterfinal${n}`;
  return `${prefix}Round of ${2 ** (k - r + 1)}${n}`;
}

// A knockout tree for seeded sources (team or group-rank sources; missing seeds are byes).
function knockout(sources, prefix, { thirdPlace = false, stage = 'playoff', finalStage = 'final', labelPrefix = '' } = {}) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, sources.length)));
  const k = Math.log2(size);
  const order = seedOrder(size);
  const matches = [];
  for (let r = 1; r <= k; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      const a = r === 1 ? sources[order[2 * i] - 1] ?? EMPTY : { winner: `${prefix}${r - 1}-${2 * i + 1}` };
      const b = r === 1 ? sources[order[2 * i + 1] - 1] ?? EMPTY : { winner: `${prefix}${r - 1}-${2 * i + 2}` };
      matches.push(newMatch(`${prefix}${r}-${i + 1}`, r === k ? finalStage : stage, r, i + 1, a, b,
        { label: roundLabel(r, k, i, count, labelPrefix) }));
    }
  }
  let thirdKey = null;
  if (thirdPlace && k >= 2) {
    thirdKey = `${prefix}3RD`;
    matches.push(newMatch(thirdKey, 'third_place', k, 2, { loser: `${prefix}${k - 1}-1` }, { loser: `${prefix}${k - 1}-2` },
      { label: 'Third place' }));
  }
  return { matches, k, finalKey: `${prefix}${k}-1`, thirdKey };
}

function singleElimination(teamIds, s) {
  const tree = knockout(teamIds.map(teamSource), 'W', { thirdPlace: s.third_place });
  const places = { 1: { winner: tree.finalKey }, 2: { loser: tree.finalKey } };
  if (tree.thirdKey) Object.assign(places, { 3: { winner: tree.thirdKey }, 4: { loser: tree.thirdKey } });
  return { matches: tree.matches, places };
}

function doubleElimination(teamIds) {
  const upper = knockout(teamIds.map(teamSource), 'U', { stage: 'upper', finalStage: 'upper', labelPrefix: 'Upper ' });
  const { k } = upper;
  const size = 2 ** k;
  const matches = [...upper.matches];
  const lowerRounds = 2 * (k - 1);
  const lower = (round, count, a, b) => {
    for (let i = 0; i < count; i++) {
      const label = round === lowerRounds ? 'Lower final' : `Lower round ${round}${count > 1 ? ` · ${i + 1}` : ''}`;
      matches.push(newMatch(`L${round}-${i + 1}`, 'lower', round, i + 1, a(i, count), b(i, count), { label }));
    }
  };
  // Round 1: the losers of the first upper round play each other.
  lower(1, size / 4, (i) => ({ loser: `U1-${2 * i + 1}` }), (i) => ({ loser: `U1-${2 * i + 2}` }));
  for (let m = 1; m <= k - 1; m++) {
    // Survivors meet the losers of the next upper round (in reverse order every other round to avoid rematches).
    lower(2 * m, size / 2 ** (m + 1), (i) => ({ winner: `L${2 * m - 1}-${i + 1}` }),
      (i, count) => ({ loser: `U${m + 1}-${m % 2 ? count - i : i + 1}` }));
    if (m <= k - 2) {
      lower(2 * m + 1, size / 2 ** (m + 2), (i) => ({ winner: `L${2 * m}-${2 * i + 1}` }), (i) => ({ winner: `L${2 * m}-${2 * i + 2}` }));
    }
  }
  matches.push(newMatch('GF', 'grand_final', k + 1, 1, { winner: upper.finalKey }, { winner: `L${lowerRounds}-1` },
    { label: 'Grand final' }));
  const places = {
    1: { winner: 'GF' }, 2: { loser: 'GF' }, 3: { loser: `L${lowerRounds}-1` }, 4: { loser: `L${lowerRounds - 1}-1` },
  };
  return { matches, places };
}

// Circle method: everyone plays everyone once, nobody plays twice in a round.
function roundRobin(teamIds, prefix, stage, group = null) {
  const list = [...teamIds];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const matches = [];
  for (let r = 0; r < n - 1; r++) {
    let position = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a == null || b == null) continue;
      position += 1;
      matches.push(newMatch(`${prefix}${r + 1}-${position}`, stage, r + 1, position, teamSource(a), teamSource(b),
        { group_name: group, label: `${group ? `Group ${group} · ` : ''}Round ${r + 1}` }));
    }
    list.splice(1, 0, list.pop());
  }
  return matches;
}

function groupsPlayoffs(teamIds, s) {
  const groups = Array.from({ length: s.groups }, () => []);
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / s.groups);
    const col = i % s.groups;
    groups[row % 2 ? s.groups - 1 - col : col].push(id);
  });
  const matches = groups.flatMap((ids, g) => roundRobin(ids, `G${LETTERS[g]}`, 'group', LETTERS[g]));

  // Group winners are the top seeds; lower ranks are rotated so round-one pairs come from different groups.
  const letters = LETTERS.slice(0, s.groups).split('');
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, s.groups * s.advance)));
  const order = seedOrder(size);
  const clashes = (seeds) => {
    let count = 0;
    for (let i = 0; i < size; i += 2) {
      const a = seeds[order[i] - 1];
      const b = seeds[order[i + 1] - 1];
      if (a && b && a.group === b.group) count += 1;
    }
    return count;
  };
  let seeds = letters.map((group) => ({ group, rank: 1 }));
  for (let rank = 2; rank <= s.advance; rank++) {
    let best = null;
    for (let shift = 0; shift < letters.length; shift++) {
      for (const reverse of [false, true]) {
        const list = letters.map((_, i) => letters[(i + shift) % letters.length]);
        if (reverse) list.reverse();
        const candidate = [...seeds, ...list.map((group) => ({ group, rank }))];
        const score = clashes(candidate);
        if (!best || score < best.score) best = { candidate, score };
      }
    }
    seeds = best.candidate;
  }
  const tree = knockout(seeds, 'P', { thirdPlace: s.third_place, labelPrefix: 'Playoff ' });
  matches.push(...tree.matches);
  const places = { 1: { winner: tree.finalKey }, 2: { loser: tree.finalKey } };
  if (tree.thirdKey) Object.assign(places, { 3: { winner: tree.thirdKey }, 4: { loser: tree.thirdKey } });
  return { matches, places };
}

const keyOf = (src) => src.winner ?? src.loser ?? null;

// A match is played after everything it waits for; league and group rounds keep their order.
function assignPhases(matches) {
  const byKey = new Map(matches.map((m) => [m.match_key, m]));
  const groupLast = new Map();
  for (const m of matches) {
    m.phase = 0;
    if (m.stage === 'league' || m.stage === 'group') {
      m.phase = m.round;
      groupLast.set(m.group_name, Math.max(groupLast.get(m.group_name) ?? 0, m.round));
    }
  }
  const depends = (src) => {
    if (keyOf(src)) return phaseOf(byKey.get(keyOf(src)));
    if (src.group) return groupLast.get(src.group) ?? 0;
    return 0;
  };
  const phaseOf = (m) => {
    if (!m.phase) m.phase = 1 + Math.max(depends(m.source_a), depends(m.source_b));
    return m.phase;
  };
  matches.forEach(phaseOf);
}

// Standings inside a set of matches: points (3/1/0), score difference, scored, wins, name.
export function rankTeams(matches, teamIds, teams = []) {
  const names = new Map(teams.map((t) => [t.id, t.name ?? '']));
  const rows = new Map(teamIds.map((id) => [id, { id, points: 0, wins: 0, diff: 0, scored: 0 }]));
  for (const m of matches) {
    if (m.status !== 'finished' || m.team_a == null || m.team_b == null) continue;
    const a = rows.get(m.team_a);
    const b = rows.get(m.team_b);
    if (!a || !b) continue;
    a.scored += m.score_a; b.scored += m.score_b;
    a.diff += m.score_a - m.score_b; b.diff += m.score_b - m.score_a;
    if (m.score_a > m.score_b) { a.points += 3; a.wins += 1; } else if (m.score_b > m.score_a) { b.points += 3; b.wins += 1; } else {
      a.points += 1; b.points += 1;
    }
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || y.diff - x.diff || y.scored - x.scored || y.wins - x.wins
    || String(names.get(x.id)).localeCompare(String(names.get(y.id)), 'en', { sensitivity: 'base' }) || x.id - y.id).map((row) => row.id);
}

const groupTeams = (matches, group) => [...new Set(matches.filter((m) => m.stage === 'group' && m.group_name === group)
  .flatMap((m) => [m.source_a.team, m.source_b.team]).filter((id) => id != null))];

// Recomputes the teams and status of every match that has not been played yet.
export function resolveBracket(matches, teams = []) {
  const byKey = new Map(matches.map((m) => [m.match_key, m]));
  const tables = new Map();
  const groupRank = (group, rank) => {
    if (!tables.has(group)) {
      const games = matches.filter((m) => m.stage === 'group' && m.group_name === group);
      tables.set(group, games.some((m) => m.status !== 'finished') ? PENDING : rankTeams(games, groupTeams(matches, group), teams));
    }
    const table = tables.get(group);
    return table === PENDING ? PENDING : table[rank - 1] ?? EMPTY;
  };
  const slot = (src) => {
    if (src.team != null) return src.team;
    if (src.empty) return EMPTY;
    if (src.group) return groupRank(src.group, src.rank);
    const from = byKey.get(keyOf(src));
    if (!from || (from.status !== 'finished' && from.status !== 'bye')) return PENDING;
    return (src.winner ? from.winner_id : from.loser_id) ?? EMPTY;
  };
  const known = (value) => value !== PENDING && value !== EMPTY;
  for (const m of [...matches].sort((a, b) => a.phase - b.phase || a.position - b.position)) {
    if (m.status === 'finished') continue;
    const a = slot(m.source_a);
    const b = slot(m.source_b);
    m.team_a = known(a) ? a : null;
    m.team_b = known(b) ? b : null;
    m.score_a = null;
    m.score_b = null;
    m.loser_id = null;
    if (a === PENDING || b === PENDING) {
      m.status = 'pending';
      m.winner_id = null;
    } else if (m.team_a != null && m.team_b != null) {
      m.status = 'scheduled';
      m.winner_id = null;
    } else {
      m.status = 'bye';
      m.winner_id = m.team_a ?? m.team_b;
      m.scheduled_at = null;
    }
  }
  return matches;
}

// Matches that take a team from this one (its winner, its loser, or its group table).
export function dependentsOf(matches, m) {
  return matches.filter((x) => x !== m && [x.source_a, x.source_b].some((src) =>
    keyOf(src) === m.match_key || (m.stage === 'group' && src.group === m.group_name)));
}

// Records a result and moves the teams on. Throws a readable error when the result is not allowed.
export function reportResult(matches, key, scoreA, scoreB, teams = []) {
  const m = matches.find((x) => x.match_key === key);
  if (!m) throw new Error('Match not found.');
  if (m.status !== 'scheduled' && m.status !== 'finished') throw new Error('Both teams of this match are not known yet.');
  const a = Number(scoreA);
  const b = Number(scoreB);
  if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 999)) throw new Error('Scores must be whole numbers from 0 to 999.');
  if (KNOCKOUT_STAGES.has(m.stage) && a === b) throw new Error('A knockout match needs a winner, so the scores cannot be equal.');
  if (m.status === 'finished' && dependentsOf(matches, m).some((x) => x.status === 'finished')) {
    throw new Error('Later matches already have results, so this one can no longer change.');
  }
  Object.assign(m, {
    score_a: a, score_b: b, status: 'finished',
    winner_id: a > b ? m.team_a : a < b ? m.team_b : null,
    loser_id: a > b ? m.team_b : a < b ? m.team_a : null,
  });
  return resolveBracket(matches, teams);
}

// Wins, draws, losses, score and points of every team, plus final places once the deciding matches are played.
export function bracketStandings(matches, teamIds, places = {}) {
  const stats = new Map(teamIds.map((id) => [id, {
    id, wins: 0, draws: 0, losses: 0, score_for: 0, score_against: 0, points: 0, final_place: null,
  }]));
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    const a = stats.get(m.team_a);
    const b = stats.get(m.team_b);
    if (!a || !b) continue;
    a.score_for += m.score_a; a.score_against += m.score_b;
    b.score_for += m.score_b; b.score_against += m.score_a;
    if (m.score_a === m.score_b) { a.draws += 1; b.draws += 1; } else {
      const [w, l] = m.score_a > m.score_b ? [a, b] : [b, a];
      w.wins += 1; l.losses += 1;
    }
  }
  const byKey = new Map(matches.map((m) => [m.match_key, m]));
  for (const [place, src] of Object.entries(places)) {
    const m = byKey.get(keyOf(src));
    if (!m || (m.status !== 'finished' && m.status !== 'bye')) continue;
    const id = src.winner ? m.winner_id : m.loser_id;
    if (stats.has(id)) stats.get(id).final_place = Number(place);
  }
  for (const s of stats.values()) s.points = s.wins * 3 + s.draws;
  return [...stats.values()];
}

// Plays the phases one after another, `parallel` matches at a time; with rounds_per_day the next day starts at
// the same time of day.
export function scheduleMatches(matches, s, startIso) {
  const slot = (s.match_minutes + s.break_minutes) * MINUTE;
  const first = Date.parse(startIso);
  let cursor = first;
  let dayStart = first;
  let phasesToday = 0;
  const phases = [...new Set(matches.filter((m) => m.status !== 'bye').map((m) => m.phase))].sort((a, b) => a - b);
  for (const phase of phases) {
    if (s.rounds_per_day && phasesToday >= s.rounds_per_day) {
      dayStart += DAY;
      cursor = Math.max(cursor, dayStart);
      phasesToday = 0;
    }
    const games = matches.filter((m) => m.phase === phase && m.status !== 'bye').sort((a, b) => a.position - b.position);
    games.forEach((m, i) => { m.scheduled_at = new Date(cursor + Math.floor(i / s.parallel) * slot).toISOString(); });
    cursor += Math.ceil(games.length / s.parallel) * slot;
    phasesToday += 1;
  }
  return matches;
}

// Builds a whole bracket for teams listed strongest first.
export function buildBracket(format, seededTeamIds, rawSettings, startIso, teams = []) {
  const n = seededTeamIds.length;
  if (!formatsFor(n).includes(format)) throw new Error(`${FORMAT_LABELS[format] ?? 'This format'} does not work for ${n} teams.`);
  const s = normalizeSettings(format, n, rawSettings);
  const built = {
    single_elimination: () => singleElimination(seededTeamIds, s),
    double_elimination: () => doubleElimination(seededTeamIds),
    round_robin: () => ({ matches: roundRobin(seededTeamIds, 'R', 'league'), places: {} }),
    groups_playoffs: () => groupsPlayoffs(seededTeamIds, s),
  }[format]();
  assignPhases(built.matches);
  resolveBracket(built.matches, teams);
  scheduleMatches(built.matches, s, startIso);
  return { matches: built.matches, settings: { ...s, format, places: built.places, seeding: seededTeamIds } };
}

// Start times a match could move to: neither team plays at the same time, and it ends before the matches waiting
// for it (`shifts` marks times that would push those later). Spaced at least an hour apart.
export function rescheduleOptions(matches, key, s, nowIso, limit = 8) {
  const m = matches.find((x) => x.match_key === key);
  const slot = (s.match_minutes + s.break_minutes) * MINUTE;
  const teamsOf = new Set([m.team_a, m.team_b].filter((id) => id != null));
  const busy = matches.filter((x) => x !== m && x.scheduled_at && x.status !== 'bye' && x.status !== 'finished'
    && [x.team_a, x.team_b].some((id) => teamsOf.has(id))).map((x) => Date.parse(x.scheduled_at));
  const waiting = dependentsOf(matches, m).filter((x) => x.scheduled_at).map((x) => Date.parse(x.scheduled_at));
  const deadline = waiting.length ? Math.min(...waiting) - slot : Infinity;
  const step = 15 * MINUTE;
  const earliest = Math.max(Date.parse(nowIso) + 2 * 60 * MINUTE, Date.parse(m.scheduled_at ?? nowIso) + slot);
  const options = [];
  for (let t = Math.ceil(earliest / step) * step; options.length < limit && t < earliest + 7 * DAY; t += step) {
    if (busy.some((other) => Math.abs(other - t) < slot)) continue;
    options.push({ scheduled_at: new Date(t).toISOString(), shifts: t > deadline });
    t += Math.max(slot, 60 * MINUTE) - step;
  }
  return options;
}

// Moves a match and pushes the matches waiting for it (and theirs) so the order of the bracket still holds.
export function moveMatch(matches, key, startIso, s) {
  const slot = (s.match_minutes + s.break_minutes) * MINUTE;
  const moved = [];
  const visit = (m, start) => {
    m.scheduled_at = new Date(start).toISOString();
    moved.push(m.match_key);
    for (const next of dependentsOf(matches, m)) {
      if (next.status === 'finished' || next.status === 'bye' || !next.scheduled_at) continue;
      const earliest = Date.parse(m.scheduled_at) + slot;
      if (Date.parse(next.scheduled_at) < earliest) visit(next, earliest);
    }
  };
  visit(matches.find((x) => x.match_key === key), Date.parse(startIso));
  return moved;
}
