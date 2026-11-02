// AI helpers for people: a whole tournament drafted from an organizer's description, and teammates suggested
// to a player from the tournaments they played. Invitations between players go out as notifications.
import type { User } from 'npm:@supabase/supabase-js@2.117.3';
import { admin, json, text, UserError } from './common.ts';
import { FORMATS } from './engine.js';
import { askJson } from './gemini.ts';
import { notify } from './notify.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function roleOf(user: User): Promise<Row | null> {
  const { data } = await admin.from('profiles').select('id, role, username, full_name').eq('id', user.id).maybeSingle();
  return data;
}

const clamp = (value: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

const DRAFT_SYSTEM = `You set up tournaments on TurniRUM, a platform for esports and sports tournaments.
Turn the organizer's description into a complete tournament. Write all texts in English, even if the description is in
another language. Use every fact the organizer gives; choose sensible values for anything missing and list those
assumptions in "assumptions" (short, comma separated).
Rules: title 3-80 characters, catchy but clear. game: the usual English name (e.g. "Counter-Strike 2", "Dota 2",
"Valorant", "EA FC", "Chess"). description: 3-6 short lines with the format, rules and schedule. format: "online" or
"offline" (offline needs city with the venue). start_date YYYY-MM-DD (not before today) and start_time HH:MM (24h,
organizer's local time). max_teams 2-256, team_size 1-12. Paid tournaments: entry_fee 1-10000 USD, otherwise
is_paid false and entry_fee 0. prize_percent 0-90 (the platform keeps 10%, the organizer keeps the rest).
prize_split: 1-5 whole percentages adding up to 100 (e.g. [50,30,20]). bracket_format: the best fit.`;

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, game: { type: 'string' }, description: { type: 'string' },
    format: { type: 'string', enum: ['online', 'offline'] }, city: { type: 'string' },
    start_date: { type: 'string' }, start_time: { type: 'string' },
    max_teams: { type: 'integer' }, team_size: { type: 'integer' },
    is_paid: { type: 'boolean' }, entry_fee: { type: 'number' }, prize_percent: { type: 'integer' },
    prize_split: { type: 'array', items: { type: 'integer' } }, prize_note: { type: 'string' },
    bracket_format: { type: 'string', enum: FORMATS }, assumptions: { type: 'string' },
  },
  required: ['title', 'game', 'description', 'format', 'start_date', 'start_time', 'max_teams', 'team_size', 'is_paid',
    'entry_fee', 'prize_percent', 'prize_split', 'bracket_format'],
};

export async function draftTournament(user: User, body: Row): Promise<Response> {
  if ((await roleOf(user))?.role !== 'organizer') throw new UserError('Only organizers can create tournaments.');
  const prompt = text(body.prompt, 2000);
  if (prompt.length < 10) throw new UserError('Describe the tournament in a sentence or two.');
  const today = text(body.today, 10) || new Date().toISOString().slice(0, 10);
  const d = await askJson<Row>(DRAFT_SYSTEM, { today, organizer_description: prompt }, DRAFT_SCHEMA, 0.5);

  const isPaid = Boolean(d.is_paid) && Number(d.entry_fee) >= 1;
  let prizeSplit = Array.isArray(d.prize_split) ? d.prize_split.map((x: unknown) => Math.round(Number(x))).filter((x: number) => x >= 1).slice(0, 5) : [];
  if (prizeSplit.reduce((a: number, b: number) => a + b, 0) !== 100) prizeSplit = [50, 30, 20];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.start_date) && d.start_date >= today ? d.start_date : today;
  const draft = {
    title: text(d.title, 80),
    game: text(d.game, 40),
    description: text(d.description, 2000),
    format: d.format === 'offline' && text(d.city, 80) ? 'offline' : 'online',
    city: text(d.city, 80),
    start_date: date,
    start_time: /^\d{2}:\d{2}$/.test(d.start_time) ? d.start_time : '18:00',
    max_teams: Math.round(clamp(d.max_teams, 2, 256, 16)),
    team_size: Math.round(clamp(d.team_size, 1, 12, 5)),
    is_paid: isPaid,
    entry_fee: isPaid ? Math.round(clamp(d.entry_fee, 1, 10000, 10) * 100) / 100 : 0,
    prize_percent: Math.round(clamp(d.prize_percent, 0, 90, 60) / 5) * 5,
    prize_split: prizeSplit,
    prize_note: text(d.prize_note, 200),
    bracket_format: FORMATS.includes(d.bracket_format) ? d.bracket_format : null,
    assumptions: text(d.assumptions, 400),
  };
  if (draft.title.length < 3 || !draft.game) throw new UserError('The AI could not understand the description. Add the game and what kind of tournament it is.');
  return json({ draft });
}

const MATCH_SYSTEM = `You help players on TurniRUM, a tournament platform, find teammates.
You get the player's own tournaments and a list of other players with their tournament history.
Pick 3-6 candidates who would make good teammates: prefer the same games, a similar level (win rate, results),
players who are looking for a team, and the same city for offline events. Use only the given data.
For each pick give match (0-100) and one friendly sentence addressed to the player that explains why
(e.g. "You both play Valorant and reached the playoffs in October").`;

interface Candidate {
  user_id: string; username: string; full_name: string; games: string[]; cities: string[]; tournaments: number;
  wins: number; draws: number; losses: number; titles: number; looking: boolean; note: string; contact: string;
}

export async function suggestTeammates(user: User): Promise<Response> {
  const me = await roleOf(user);
  if (me?.role !== 'participant') throw new UserError('The team finder is for player accounts.');

  const { data: rows } = await admin.from('teams')
    .select('captain_id, name, wins, draws, losses, final_place, tournaments(title, game, city, format, start_at)')
    .not('captain_id', 'is', null);
  const { data: profiles } = await admin.from('profiles').select('id, username, full_name').eq('role', 'participant');
  const { data: cards } = await admin.from('player_cards').select('*');
  const cardOf = new Map((cards ?? []).map((c) => [c.user_id, c]));

  const people = new Map<string, Candidate>();
  for (const p of profiles ?? []) {
    const card = cardOf.get(p.id);
    people.set(p.id, {
      user_id: p.id, username: p.username, full_name: p.full_name, games: [...(card?.games ?? [])], cities: [],
      tournaments: 0, wins: 0, draws: 0, losses: 0, titles: 0, looking: Boolean(card?.looking),
      note: card?.looking ? card.note : '', contact: card?.looking ? card.contact : '',
    });
  }
  const mine: Row[] = [];
  for (const row of rows ?? []) {
    const person = people.get(row.captain_id);
    const t = row.tournaments as Row | null;
    if (!person || !t) continue;
    if (row.captain_id === user.id) mine.push({ tournament: t.title, game: t.game, team: row.name, wins: row.wins, draws: row.draws, losses: row.losses, place: row.final_place, where: t.format === 'offline' ? t.city : 'online' });
    if (!person.games.includes(t.game)) person.games.push(t.game);
    if (t.format === 'offline' && t.city && !person.cities.includes(t.city)) person.cities.push(t.city);
    person.tournaments += 1; person.wins += row.wins; person.draws += row.draws; person.losses += row.losses;
    if (row.final_place === 1) person.titles += 1;
  }
  const self = people.get(user.id)!;
  people.delete(user.id);

  // Plain pre-ranking keeps the AI prompt short and is the answer when the AI is unavailable.
  const rate = (c: { wins: number; draws: number; losses: number }) => (c.wins + c.draws / 2) / Math.max(1, c.wins + c.draws + c.losses);
  const score = (c: Candidate) => c.games.filter((g) => self.games.includes(g)).length * 30 + (c.looking ? 25 : 0)
    + (c.cities.some((city) => self.cities.includes(city)) ? 10 : 0) + Math.min(c.tournaments, 5) * 3
    - Math.abs(rate(c) - rate(self)) * 20;
  const pool = [...people.values()].filter((c) => c.tournaments > 0 || c.looking).sort((a, b) => score(b) - score(a)).slice(0, 25);
  if (!pool.length) return json({ picks: [], ai: false });

  let picks: { user_id: string; match: number; reason: string }[] = [];
  let ai = true;
  try {
    const answer = await askJson<{ picks: { user_id: string; match: number; reason: string }[] }>(MATCH_SYSTEM, {
      player: { games: self.games, cities: self.cities, card_note: cardOf.get(user.id)?.note ?? '', tournaments: mine },
      candidates: pool.map(({ contact: _contact, username: _u, ...c }) => c),
    }, {
      type: 'object',
      properties: { picks: { type: 'array', items: { type: 'object', properties: { user_id: { type: 'string' }, match: { type: 'integer' }, reason: { type: 'string' } }, required: ['user_id', 'match', 'reason'] } } },
      required: ['picks'],
    }, 0.4);
    const ids = new Set(pool.map((c) => c.user_id));
    picks = (answer.picks ?? []).filter((p) => ids.has(p.user_id)).slice(0, 6);
  } catch (error) {
    console.warn('teammates fallback', String(error));
  }
  if (!picks.length) {
    ai = false;
    picks = pool.slice(0, 5).map((c) => {
      const shared = c.games.filter((g) => self.games.includes(g));
      return {
        user_id: c.user_id, match: Math.max(20, Math.min(95, Math.round(score(c)))),
        reason: shared.length ? `You both play ${shared.join(', ')}.` : c.looking ? 'Looking for a team right now.' : 'Active on TurniRUM.',
      };
    });
  }
  return json({
    ai,
    picks: picks.map((p) => {
      const c = pool.find((x) => x.user_id === p.user_id)!;
      return { ...c, match: Math.round(clamp(p.match, 0, 100, 50)), reason: text(p.reason, 300) };
    }),
  });
}

export async function teamInvite(user: User, body: Row): Promise<Response> {
  const me = await roleOf(user);
  if (me?.role !== 'participant') throw new UserError('Only players can invite teammates.');
  const { data: target } = await admin.from('profiles').select('id, role').eq('id', String(body.user_id)).maybeSingle();
  if (!target || target.role !== 'participant' || target.id === user.id) throw new UserError('Player not found.');
  const { data: card } = await admin.from('player_cards').select('contact, games').eq('user_id', user.id).maybeSingle();
  if (!card?.contact) throw new UserError('Add your contact (Discord, Telegram…) to your card first, so the player can reach you.');
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true })
    .like('dedupe_key', `invite:${user.id}:%`).gte('created_at', since);
  if ((count ?? 0) >= 20) throw new UserError('You sent 20 invitations today. Try again tomorrow.');
  const message = text(body.message, 300);
  const day = new Date().toISOString().slice(0, 10);
  const created = await notify([{
    user_id: target.id,
    kind: 'invite',
    title: `${me.full_name} wants to team up with you`,
    body: `${me.full_name} (@${me.username})${card.games?.length ? ` plays ${card.games.join(', ')} and` : ''} invites you to play together on TurniRUM.${message ? `\n\n“${message}”` : ''}\n\nReach them here: ${card.contact}`,
    link: '/team-finder',
    dedupe_key: `invite:${user.id}:${target.id}:${day}`,
  }]);
  if (!created) throw new UserError('You already invited this player today.');
  return json({ sent: true });
}
