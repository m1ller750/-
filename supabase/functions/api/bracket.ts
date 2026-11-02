// Brackets: Gemini picks the format, the seeding and the timing, engine.js builds and runs the bracket.
// Organizers report results and move matches; captains vote to move their match, and when both teams agree the AI
// picks a new time.
import type { User } from 'npm:@supabase/supabase-js@2.117.3';
import { admin, json, text, UserError, utcTime } from './common.ts';
import {
  bracketStandings, buildBracket, FORMAT_LABELS, FORMATS, formatsFor, moveMatch, normalizeSettings, reportResult,
  rescheduleOptions,
} from './engine.js';
import { askJson } from './gemini.ts';
import { type Note, notify } from './notify.ts';

const MINUTE = 60_000;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface Team { id: number; name: string; captain_id: string | null }

async function organizerTournament(user: User, id: unknown): Promise<Row> {
  const { data: t } = await admin.from('tournaments').select('*').eq('id', Number(id)).maybeSingle();
  if (!t || t.organizer_id !== user.id) throw new UserError('Tournament not found.');
  if (t.settled_at) throw new UserError('The prizes were already distributed, so the bracket is final.');
  return t;
}

async function loadMatches(tournamentId: number): Promise<Row[]> {
  const { data, error } = await admin.from('matches').select('*').eq('tournament_id', tournamentId)
    .order('phase').order('position');
  if (error) throw error;
  return data ?? [];
}

async function loadTeams(tournamentId: number): Promise<Team[]> {
  const { data, error } = await admin.from('teams').select('id, name, captain_id').eq('tournament_id', tournamentId);
  if (error) throw error;
  return data ?? [];
}

async function save(t: Row, matches: Row[], teams: Team[], replace: boolean, extra: { format?: string; settings?: Row; close?: boolean } = {}) {
  const settings = extra.settings ?? t.bracket_settings ?? {};
  const stats = bracketStandings(matches, teams.map((team) => team.id), settings.places ?? {});
  const { error } = await admin.rpc('apply_bracket', {
    p_tournament_id: t.id, p_version: t.bracket_version, p_format: extra.format ?? null, p_settings: settings,
    p_matches: matches, p_stats: stats, p_replace: replace, p_close_registration: extra.close ?? false,
  });
  if (error) throw new UserError(error.message);
}

const names = (teams: Team[]) => (id: number | null) => teams.find((t) => t.id === id)?.name ?? 'TBD';

// Earlier results of each captain on the platform, used to seed teams.
async function captainHistory(teams: Team[], tournamentId: number): Promise<Map<string, Row>> {
  const captains = [...new Set(teams.map((t) => t.captain_id).filter(Boolean))] as string[];
  const history = new Map<string, Row>();
  if (!captains.length) return history;
  const { data } = await admin.from('teams').select('captain_id, wins, draws, losses, final_place, tournament_id')
    .in('captain_id', captains).neq('tournament_id', tournamentId);
  for (const row of data ?? []) {
    const h = history.get(row.captain_id) ?? { tournaments: 0, wins: 0, draws: 0, losses: 0, titles: 0, podiums: 0 };
    h.tournaments += 1; h.wins += row.wins; h.draws += row.draws; h.losses += row.losses;
    if (row.final_place === 1) h.titles += 1;
    if (row.final_place && row.final_place <= 3) h.podiums += 1;
    history.set(row.captain_id, h);
  }
  return history;
}

const strength = (h: Row | undefined) => (h ? h.titles * 6 + h.podiums * 3 + h.wins * 2 + h.draws - h.losses : -1000);

function fallbackFormat(n: number): string {
  if (n <= 2) return 'single_elimination';
  if (n <= 6) return 'round_robin';
  if (n >= 12 && n <= 16) return 'groups_playoffs';
  return 'single_elimination';
}

interface Plan {
  format: string; reason: string; seeding: number[]; best_of?: number; match_minutes?: number; break_minutes?: number;
  parallel?: number; rounds_per_day?: number; groups?: number; advance?: number; third_place?: boolean;
}

const PLAN_SYSTEM = `You are the tournament director of TurniRUM, a platform for esports and sports tournaments.
Plan the bracket of one tournament:
- Choose the format from allowed_formats that fits the number of teams, the game and the time available. Round robin is fair for small fields, single elimination is fast, double elimination gives a second chance, groups + playoffs suits 12+ teams.
- Seed the teams strongest first using their history (titles, podiums, wins, losses). Teams without history go after teams with a good history, keeping the given order among themselves. Return every team id exactly once.
- Choose realistic timing for the game: best_of (1, 3 or 5), match_minutes for one match including all its games (CS2/Valorant Bo1 about 45-60, Dota 2 about 50-60, mobile games 20-30, chess blitz 15-20, EA FC/football games 15-20, multiply for Bo3), break_minutes between matches, parallel (matches at the same time: online up to half the teams, offline 1-4 depending on the venue) and rounds_per_day (0 = everything in one day; use 2-4 when the whole bracket would take more than about 8 hours).
- For groups_playoffs choose groups (2-8, at least 3 teams each) and advance (teams per group going to the playoffs).
- third_place: true when a match for third place makes sense (prize places).
- reason: one or two short sentences for the organizer explaining the choice.`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    format: { type: 'string', enum: FORMATS },
    reason: { type: 'string' },
    seeding: { type: 'array', items: { type: 'integer' } },
    best_of: { type: 'integer' },
    match_minutes: { type: 'integer' },
    break_minutes: { type: 'integer' },
    parallel: { type: 'integer' },
    rounds_per_day: { type: 'integer' },
    groups: { type: 'integer' },
    advance: { type: 'integer' },
    third_place: { type: 'boolean' },
  },
  required: ['format', 'reason', 'seeding', 'best_of', 'match_minutes', 'break_minutes', 'parallel', 'rounds_per_day'],
};

export async function buildBracketAction(user: User, body: Row): Promise<Response> {
  const t = await organizerTournament(user, body.tournament_id);
  const teams = await loadTeams(t.id);
  if (teams.length < 2) throw new UserError('At least 2 teams are needed to build a bracket.');
  const existing = await loadMatches(t.id);
  if (existing.some((m) => m.status === 'finished')) {
    throw new UserError('Results are already in. Remove the bracket first if you really want to build a new one.');
  }
  const allowed = formatsFor(teams.length);
  const fixed = FORMATS.includes(body.format) ? body.format : null;
  if (fixed && !allowed.includes(fixed)) throw new UserError(`${FORMAT_LABELS[fixed as keyof typeof FORMAT_LABELS]} needs more teams.`);

  const history = await captainHistory(teams, t.id);
  const byStrength = [...teams].sort((a, b) => strength(history.get(b.captain_id ?? '')) - strength(history.get(a.captain_id ?? '')));
  const start = Math.max(Date.parse(t.start_at), Math.ceil((Date.now() + 30 * MINUTE) / (15 * MINUTE)) * 15 * MINUTE);

  let plan: Plan;
  let ai = true;
  try {
    plan = await askJson<Plan>(PLAN_SYSTEM, {
      tournament: {
        title: t.title, game: t.game, description: t.description.slice(0, 600), where: t.format === 'offline' ? `offline, ${t.city}` : 'online',
        players_per_team: t.team_size, first_match_utc: new Date(start).toISOString(),
      },
      team_count: teams.length,
      allowed_formats: fixed ? [fixed] : allowed,
      teams: byStrength.map((team) => ({ id: team.id, name: team.name, history: history.get(team.captain_id ?? '') ?? 'no earlier tournaments' })),
    }, { ...PLAN_SCHEMA, properties: { ...PLAN_SCHEMA.properties, format: { type: 'string', enum: fixed ? [fixed] : allowed } } }, 0.3);
  } catch (error) {
    console.warn('bracket plan fallback', String(error));
    ai = false;
    plan = { format: fixed ?? fallbackFormat(teams.length), reason: '', seeding: [] };
  }

  const format = fixed ?? (allowed.includes(plan.format) ? plan.format : fallbackFormat(teams.length));
  const ids = new Set(teams.map((team) => team.id));
  const seeded = [...new Set((plan.seeding ?? []).map(Number).filter((id) => ids.has(id)))];
  for (const team of byStrength) if (!seeded.includes(team.id)) seeded.push(team.id);

  const { matches, settings } = buildBracket(format, seeded, plan, new Date(start).toISOString(), teams);
  const reason = text(plan.reason, 400) || `${FORMAT_LABELS[format as keyof typeof FORMAT_LABELS]} fits ${teams.length} teams; teams are seeded by their results on TurniRUM.`;
  await save(t, matches, teams, true, { format, settings: { ...settings, reason, ai }, close: true });

  const name = names(teams);
  await notify(teams.filter((team) => team.captain_id).map((team) => {
    const first = matches.find((m: Row) => m.status === 'scheduled' && (m.team_a === team.id || m.team_b === team.id));
    return {
      user_id: team.captain_id!,
      kind: 'bracket',
      title: `The bracket of ${t.title} is ready`,
      body: first
        ? `Your first match: ${first.label}, ${name(first.team_a)} vs ${name(first.team_b)}, on ${utcTime(first.scheduled_at)}.`
        : 'Your team waits for its first opponent. Open the bracket to see the schedule.',
      link: `/t/${t.id}`,
      dedupe_key: `b${t.id}:v${t.bracket_version + 1}:${team.captain_id}`,
    };
  }));
  return json({ format, reason, ai, matches: matches.filter((m: Row) => m.status !== 'bye').length });
}

export async function reportResultAction(user: User, body: Row): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await organizerTournament(user, body.tournament_id);
    const [matches, teams] = await Promise.all([loadMatches(t.id), loadTeams(t.id)]);
    try {
      reportResult(matches, String(body.match_key), body.score_a, body.score_b, teams);
    } catch (error) {
      throw new UserError((error as Error).message);
    }
    try {
      await save(t, matches, teams, false);
      return json({ ok: true });
    } catch (error) {
      if (!String((error as Error).message).includes('changed in the meantime') || attempt) throw error;
    }
  }
  throw new UserError('The bracket changed in the meantime. Please try again.');
}

function bracketSettings(t: Row, teamCount: number) {
  return normalizeSettings(t.bracket_settings?.format ?? 'single_elimination', teamCount, t.bracket_settings ?? {});
}

async function notifyMoved(t: Row, matches: Row[], teams: Team[], keys: string[], message: string, extraUsers: string[] = []) {
  const name = names(teams);
  const notes: Note[] = [];
  for (const key of keys) {
    const m = matches.find((x) => x.match_key === key)!;
    const users = new Set([
      ...teams.filter((team) => team.captain_id && (team.id === m.team_a || team.id === m.team_b)).map((team) => team.captain_id!),
      ...(key === keys[0] ? extraUsers : []),
    ]);
    for (const userId of users) {
      notes.push({
        user_id: userId,
        kind: 'reschedule',
        title: `${m.label} in ${t.title} moved to ${utcTime(m.scheduled_at)}`,
        body: `${key === keys[0] ? message : `It moved because an earlier match was moved.`}\n\n${name(m.team_a)} vs ${name(m.team_b)}, new start: ${utcTime(m.scheduled_at)}.`,
        link: `/t/${t.id}`,
        dedupe_key: `r${m.id}:${m.scheduled_at}:${userId}`,
      });
    }
  }
  await notify(notes);
}

// The organizer sets a new start time; later matches move along if needed.
export async function moveMatchAction(user: User, body: Row): Promise<Response> {
  const t = await organizerTournament(user, body.tournament_id);
  const [matches, teams] = await Promise.all([loadMatches(t.id), loadTeams(t.id)]);
  const m = matches.find((x) => x.match_key === String(body.match_key));
  if (!m || m.status === 'finished' || m.status === 'bye') throw new UserError('Only matches that are not played yet can be moved.');
  const when = Date.parse(String(body.scheduled_at));
  if (!Number.isFinite(when) || when < Date.now()) throw new UserError('Pick a start time in the future.');
  const moved = moveMatch(matches, m.match_key, new Date(when).toISOString(), bracketSettings(t, teams.length));
  await save(t, matches, teams, false);
  await notifyMoved(t, matches, teams, moved, 'The organizer moved this match.');
  return json({ moved });
}

const MOVE_SYSTEM = `You are the scheduler of TurniRUM tournaments. The captains of both teams asked to move a match.
Pick the best new start time from the options:
- prefer times close to the original time of day, so players keep their routine;
- prefer options with pushes_later_matches false;
- for offline events avoid times late at night in the event's city.
Then write one short, friendly sentence for the players that explains the new time; write the time exactly as the
"start" text of the chosen option.`;

// Moves a match to a new time chosen by the AI from free slots (or the first free slot without the AI).
async function rescheduleByVotes(tournamentId: number, key: string) {
  const { data: t } = await admin.from('tournaments').select('*').eq('id', tournamentId).single();
  const [matches, teams] = await Promise.all([loadMatches(tournamentId), loadTeams(tournamentId)]);
  const m = matches.find((x) => x.match_key === key)!;
  const s = bracketSettings(t, teams.length);
  const options = rescheduleOptions(matches, key, s, new Date().toISOString());
  if (!options.length) throw new UserError('There is no free time for this match in the next week. Ask the organizer to move it.');
  const name = names(teams);
  let pick = 0;
  let message = '';
  try {
    const answer = await askJson<{ index: number; message: string }>(MOVE_SYSTEM, {
      tournament: { title: t.title, game: t.game, where: t.format === 'offline' ? `offline, ${t.city}` : 'online' },
      match: { label: m.label, teams: [name(m.team_a), name(m.team_b)], original_start_utc: m.scheduled_at },
      options: options.map((o, index) => ({ index, start: utcTime(o.scheduled_at), start_utc: o.scheduled_at, pushes_later_matches: o.shifts })),
    }, {
      type: 'object',
      properties: { index: { type: 'integer' }, message: { type: 'string' } },
      required: ['index', 'message'],
    }, 0.3);
    if (Number.isInteger(answer.index) && options[answer.index]) pick = answer.index;
    message = text(answer.message, 300);
  } catch (error) {
    console.warn('reschedule fallback', String(error));
  }
  const when = options[pick].scheduled_at;
  if (!message) message = `Both teams asked to move ${m.label}, so it now starts on ${utcTime(when)}.`;
  const moved = moveMatch(matches, key, when, s);
  m.rescheduled = 1;
  await save(t, matches, teams, false);
  await admin.from('reschedule_votes').delete().eq('match_id', m.id);
  await notifyMoved(t, matches, teams, moved, message, [t.organizer_id]);
  return { scheduled_at: when, message, moved };
}

export async function rescheduleVoteAction(user: User, body: Row): Promise<Response> {
  const { data: vote, error } = await admin.rpc('cast_reschedule_vote', { p_match_id: Number(body.match_id), p_user_id: user.id });
  if (error) throw new UserError(error.message);
  if (!vote.complete) return json({ ...vote, rescheduled: null });
  return json({ ...vote, rescheduled: await rescheduleByVotes(vote.tournament_id, vote.match_key) });
}

export async function removeBracketAction(user: User, body: Row): Promise<Response> {
  const t = await organizerTournament(user, body.tournament_id);
  const teams = await loadTeams(t.id);
  const { error } = await admin.rpc('apply_bracket', {
    p_tournament_id: t.id, p_version: t.bracket_version, p_format: null, p_settings: {}, p_matches: [],
    p_stats: teams.map((team) => ({ id: team.id, wins: 0, draws: 0, losses: 0, score_for: 0, score_against: 0, points: 0, final_place: null })),
    p_replace: true,
  });
  if (error) throw new UserError(error.message);
  return json({ removed: true });
}
