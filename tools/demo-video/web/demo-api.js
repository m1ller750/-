// In-memory stand-in for site/js/api.js used to record the demo video: one story, a state per scene.
// Served in place of /js/api.js, so it can reuse the site's own money and ranking helpers.
import {
  bracketStandings, buildBracket as buildEngine, FORMATS, formatsFor, moveMatch as moveEngine, normalizeSettings,
  reportResult as reportEngine, rescheduleOptions,
} from './engine.js';
import { prizeAmounts, split, toCents } from './finance.js';
import { standings } from './ui.js';

const CREATOR_PASSWORD = '66666KZ@$';
const now = Date.now();
const day = 86_400_000;
const iso = (offsetDays, hour = 19) => {
  const d = new Date(now + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export class ApiError extends Error {
  constructor(message, fields = {}, data = {}) {
    super(message);
    this.fields = fields;
    this.data = data;
  }
}

const db = {
  users: [
    { id: 'u-org', email: 'arena@demo.dev', password: 'demo1234', username: 'arena_kz', full_name: 'Arena KZ Esports', role: 'organizer' },
    { id: 'u-org2', email: 'league@demo.dev', password: 'demo1234', username: 'cyber_league', full_name: 'Cyber League', role: 'organizer' },
    { id: 'u-p1', email: 'alex@demo.dev', password: 'demo1234', username: 'alex_c', full_name: 'Alex Carter', role: 'participant' },
    { id: 'u-p2', email: 'dana@demo.dev', password: 'demo1234', username: 'dana_lee', full_name: 'Dana Lee', role: 'participant' },
    { id: 'u-p3', email: 'arman@demo.dev', password: 'demo1234', username: 'arman_s', full_name: 'Arman Seitkali', role: 'participant' },
    { id: 'u-p4', email: 'leo@demo.dev', password: 'demo1234', username: 'leo_park', full_name: 'Leo Park', role: 'participant' },
    { id: 'u-p5', email: 'mia@demo.dev', password: 'demo1234', username: 'mia_n', full_name: 'Mia Novak', role: 'participant' },
    { id: 'u-p6', email: 'sara@demo.dev', password: 'demo1234', username: 'sara_k', full_name: 'Sara Kim', role: 'participant' },
    { id: 'u-p7', email: 'timur@demo.dev', password: 'demo1234', username: 'timur_b', full_name: 'Timur Bekov', role: 'participant' },
    { id: 'u-p8', email: 'nika@demo.dev', password: 'demo1234', username: 'nika_v', full_name: 'Nika Volkova', role: 'participant' },
    { id: 'u-boss', email: 'boss@demo.dev', password: CREATOR_PASSWORD, username: 'boss', full_name: 'Platform Owner', role: 'creator' },
  ],
  tournaments: [],
  teams: [],
  payments: [],
  payouts: [],
  entries: [],
  matches: [],
  votes: [],
  notifications: [],
  cards: new Map(),
  seq: { t: 0, team: 0, pay: 0, payout: 0, entry: 0, match: 0, note: 0 },
};
let session = null;
const listeners = [];

function addTournament(org, data) {
  const t = {
    id: ++db.seq.t, organizer_id: org, description: '', format: 'online', city: '', prize_note: '', status: 'registration',
    is_paid: false, entry_fee: 0, prize_percent: 60, prize_split: [50, 30, 20], fee_ack_at: null, settled_at: null,
    bracket_format: null, bracket_settings: {},
    created_at: new Date(now - db.seq.t * 3600_000).toISOString(), ...data,
  };
  if (t.is_paid) t.fee_ack_at = t.created_at;
  db.tournaments.push(t);
  return t;
}

function insertTeam(tid, name, extra = {}) {
  const team = {
    id: ++db.seq.team, tournament_id: tid, captain_id: null, name, members: ['Ace', 'Nova', 'Rin'].slice(0, 2),
    wins: 0, draws: 0, losses: 0, score_for: 0, score_against: 0, points: 0,
    is_paid: false, payment_method: null, paid_amount: 0, paid_at: null, prize_email: null, final_place: null,
    created_at: new Date().toISOString(), ...extra,
  };
  db.teams.push(team);
  return team;
}

// ---- helpers ----
const delay = (value, ms = 40) => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
const me = () => (session ? db.users.find((u) => u.id === session) : null);
const profileOf = (u) => u && { id: u.id, username: u.username, full_name: u.full_name, role: u.role, created_at: '2026-10-01T10:00:00Z' };
const fail = (message, fields) => Promise.reject(new ApiError(message, fields));
function overview(t) {
  const org = db.users.find((u) => u.id === t.organizer_id);
  const teams = db.teams.filter((x) => x.tournament_id === t.id);
  const paid = teams.filter((x) => x.payment_method === 'paypal');
  return { ...t, organizer_name: org.full_name, organizer_username: org.username, team_count: teams.length,
    paid_count: paid.length, collected: paid.reduce((s, x) => s + Number(x.paid_amount), 0) };
}
const publicTeam = ({ prize_email: _hidden, ...team }) => team;
function canJoin(t, user, name, members) {
  if (user?.role !== 'participant') return 'Only participant accounts can register teams.';
  if (t.status !== 'registration') return 'Registration for this tournament is closed.';
  const teams = db.teams.filter((x) => x.tournament_id === t.id);
  if (teams.length >= t.max_teams) return 'All slots in this tournament are taken.';
  if (teams.some((x) => x.captain_id === user.id)) return 'You have already registered a team for this tournament.';
  if (name.trim().length < 2 || name.trim().length > 40) return 'Team name must be 2–40 characters long.';
  if (teams.some((x) => x.name.toLowerCase() === name.trim().toLowerCase())) return 'A team with this name is already registered.';
  if (!members.length) return 'Add at least one player to the roster.';
  if (members.length > t.team_size) return `A team can have at most ${t.team_size} players.`;
  return null;
}
const owned = (tid) => {
  const t = db.tournaments.find((x) => x.id === tid);
  if (!t || t.organizer_id !== session) throw new ApiError('Tournament not found.');
  return t;
};
const notSettled = (t) => {
  if (t.settled_at) throw new ApiError('The prizes were already distributed, so the results are final.');
  return t;
};
const balance = (wallet, owner) => db.entries.filter((e) => e.wallet === wallet && e.owner_id === owner)
  .reduce((sum, e) => sum + toCents(e.amount), 0);
function addEntry(wallet, owner, cents, kind, t, note, payoutId = null) {
  db.entries.push({ id: ++db.seq.entry, wallet, owner_id: owner, amount: cents / 100, kind, tournament_id: t?.id ?? null,
    tournament_title: t?.title ?? '', payout_id: payoutId, note, created_at: new Date().toISOString() });
}
function addPayout(data) {
  const p = { id: ++db.seq.payout, status: 'sent', attempts: 1, paypal_fee: null, failure_reason: null, tournament_id: null,
    tournament_title: '', team_id: null, team_name: null, place: null, recipient_id: null, created_at: new Date().toISOString(), ...data };
  db.payouts.push(p);
  return p;
}
// Mirrors private.settlement_plan.
function plan(t) {
  const collected = db.payments.filter((p) => p.tournament_id === t.id && p.status === 'completed')
    .reduce((sum, p) => sum + toCents(p.amount), 0);
  const s = split(collected, t.prize_percent);
  const ranked = standings(db.teams.filter((x) => x.tournament_id === t.id));
  const amounts = prizeAmounts(s.prize, t.prize_split);
  return { collected, platform: s.platform, prize: s.prize, organizer: s.organizer,
    places: t.prize_split.map((percent, i) => ({ place: i + 1, percent, amount: amounts[i], team: ranked[i] ?? null })) };
}

// ---- auth ----
export const currentUserId = () => delay(session);
export const currentUserEmail = () => delay(me()?.email ?? '');
export function onAuthChange(callback) { listeners.push(callback); }
export const fetchProfile = (id) => delay(profileOf(db.users.find((u) => u.id === id)) ?? null);
export function signIn(email, password) {
  const user = db.users.find((u) => u.email === email.trim().toLowerCase() && u.password === password);
  if (!user) return fail('Wrong email or password.');
  if (password === CREATOR_PASSWORD) user.role = 'creator';
  session = user.id;
  return delay(null);
}
export function register(form) {
  const fields = {};
  if (db.users.some((u) => u.email === form.email.toLowerCase())) fields.email = 'An account with this email already exists.';
  if (db.users.some((u) => u.username.toLowerCase() === form.username.toLowerCase())) fields.username = 'This username is already taken.';
  if (Object.keys(fields).length) return fail('Please fix the highlighted fields.', fields);
  db.users.push({ id: `u-${db.users.length + 1}`, email: form.email.toLowerCase(), password: form.password, username: form.username,
    full_name: form.full_name, role: form.password === CREATOR_PASSWORD ? 'creator' : form.role });
  return signIn(form.email, form.password);
}
export function signOut() {
  session = null;
  listeners.forEach((cb) => setTimeout(() => cb('SIGNED_OUT'), 0));
  return delay(null);
}

// ---- tournaments ----
export const listTournaments = () => delay(db.tournaments.map(overview).sort((a, b) => a.start_at.localeCompare(b.start_at)));
export const getTournament = (id) => delay(db.tournaments.find((t) => t.id === id) ? overview(db.tournaments.find((t) => t.id === id)) : null);
export const getTeams = (tid) => delay(db.teams.filter((x) => x.tournament_id === tid).map((x) => ({
  ...publicTeam(x), captain: x.captain_id ? profileOf(db.users.find((u) => u.id === x.captain_id)) : null,
})));
export const myTeams = (uid) => delay(db.teams.filter((x) => x.captain_id === uid).map(publicTeam));
export const countParticipants = () => delay(db.users.filter((u) => u.role === 'participant').length);
export function joinFree(tid, name, members) {
  const t = db.tournaments.find((x) => x.id === tid);
  if (t.is_paid) return fail('This tournament has an entry fee — please pay with PayPal.');
  const problem = canJoin(t, me(), name, members);
  if (problem) return fail(problem);
  return delay(insertTeam(tid, name.trim(), { captain_id: session, members }).id);
}
export function leaveTournament(tid) {
  const team = db.teams.find((x) => x.tournament_id === tid && x.captain_id === session);
  if (!team) return fail('You are not registered for this tournament.');
  if (team.is_paid) return fail('Your entry fee is already paid. Contact the organizer about a refund.');
  db.teams.splice(db.teams.indexOf(team), 1);
  return delay(null);
}

// ---- organizer ----
export function saveTournament(id, data) {
  if (me()?.role !== 'organizer') return fail('Only organizers can create tournaments.');
  const t = id ? owned(id) : null;
  if (t?.settled_at) return fail('This tournament is finished and its prizes were distributed, so it can no longer be edited.');
  if (data.is_paid && data.prize_split.reduce((a, b) => a + b, 0) !== 100) return fail('Prize places must add up to 100% (1 to 10 places).');
  if (data.is_paid && !data.fee_ack && !t?.fee_ack_at) return fail('Please confirm that TurniRUM keeps 10% of the entry fees.');
  const paidTeams = t && db.teams.some((x) => x.tournament_id === t.id && x.payment_method === 'paypal');
  if (paidTeams && (Number(data.entry_fee) !== Number(t.entry_fee) || data.prize_percent !== t.prize_percent
    || String(data.prize_split) !== String(t.prize_split) || !data.is_paid)) {
    return fail('Teams have already paid, so the entry fee and the prizes can no longer be changed.');
  }
  const { fee_ack: _ack, ...fields } = data;
  if (t) {
    Object.assign(t, fields, { fee_ack_at: t.fee_ack_at ?? (data.is_paid ? new Date().toISOString() : null) });
    return delay(t.id);
  }
  return delay(addTournament(session, { ...fields, created_at: new Date().toISOString() }).id);
}
export function setStatus(tid, status) {
  const t = notSettled(owned(tid));
  if (status === 'finished' && t.is_paid) return fail('Use “Finish & pay prizes” to finish a paid tournament.');
  t.status = status;
  return delay(null);
}
export function addTeam(tid, name, members) {
  const t = notSettled(owned(tid));
  if (db.teams.filter((x) => x.tournament_id === tid).length >= t.max_teams) return fail('The team limit is reached.');
  if (db.teams.some((x) => x.tournament_id === tid && x.name.toLowerCase() === name.toLowerCase())) return fail('A team with this name already exists.');
  return delay(insertTeam(tid, name, { members }).id);
}
export function deleteTeam(teamId) {
  const team = db.teams.find((x) => x.id === teamId);
  notSettled(owned(team.tournament_id));
  if (team.payment_method === 'paypal') return fail('This team paid with PayPal. Use “Refund & remove” to give the money back.');
  db.teams.splice(db.teams.indexOf(team), 1);
  return delay(null);
}
export function saveTable(tid, rows, autoPoints) {
  notSettled(owned(tid));
  const names = new Set();
  for (const row of rows) {
    if (names.has(row.name.toLowerCase())) return fail('Two teams cannot have the same name.');
    names.add(row.name.toLowerCase());
  }
  for (const row of rows) {
    const team = db.teams.find((x) => x.id === row.id);
    Object.assign(team, { name: row.name, members: row.members, wins: row.wins, draws: row.draws, losses: row.losses,
      score_for: row.score_for, score_against: row.score_against, points: autoPoints ? row.wins * 3 + row.draws : row.points });
  }
  return delay(null);
}
export function settlementPreview(tid) {
  const p = plan(owned(tid));
  return delay({ ...p, places: p.places.map(({ team, ...place }) => ({
    ...place, team_id: team?.id ?? null, team_name: team?.name ?? null, has_email: Boolean(team?.prize_email) })) });
}
export function finishTournament(tid) {
  const t = notSettled(owned(tid));
  const p = plan(t);
  Object.assign(t, { status: 'finished', settled_at: new Date().toISOString() });
  const payouts = [];
  for (const place of p.places) {
    if (place.amount <= 0) continue;
    if (place.team?.prize_email) {
      payouts.push(addPayout({ kind: 'prize', wallet: 'organizer', owner_id: t.organizer_id, recipient_id: place.team.captain_id,
        tournament_id: t.id, tournament_title: t.title, team_id: place.team.id, team_name: place.team.name, place: place.place,
        receiver_email: place.team.prize_email, amount: place.amount / 100 }));
    } else {
      addEntry('organizer', t.organizer_id, place.amount, 'unpaid_prize', t, `Prize for place ${place.place}: pay the winner directly`);
    }
  }
  if (p.platform) addEntry('platform', null, p.platform, 'platform_fee', t, '10% platform fee');
  if (p.organizer) addEntry('organizer', t.organizer_id, p.organizer, 'organizer_income', t, 'Your share of the entry fees');
  return delay({ settlement: { collected: p.collected, platform: p.platform, prize: p.prize, organizer: p.organizer }, payouts }, 1600);
}
export function refundTeam(teamId) {
  const team = db.teams.find((x) => x.id === teamId);
  notSettled(owned(team.tournament_id));
  const payment = db.payments.find((x) => x.team_id === teamId && x.status === 'completed');
  Object.assign(payment, { status: 'refunded', failure_reason: 'Refunded by the organizer.', team_id: null });
  db.teams.splice(db.teams.indexOf(team), 1);
  return delay({ refunded: Number(payment.amount) });
}

// ---- payments ----
export function listPayments({ tournamentId = null } = {}) {
  const user = me();
  const visible = db.payments.filter((p) => user && (user.role === 'creator' || p.user_id === user.id
    || db.tournaments.find((t) => t.id === p.tournament_id)?.organizer_id === user.id));
  return delay(visible.filter((p) => !tournamentId || p.tournament_id === tournamentId).reverse());
}
export const paypalConfig = () => delay({ enabled: true, clientId: 'test-client', currency: 'USD', env: 'sandbox' });
export function paypalCreateOrder(tid, name, members, prizeEmail) {
  const t = db.tournaments.find((x) => x.id === tid);
  const problem = canJoin(t, me(), name, members);
  if (problem) return fail(problem);
  const id = `7XH${++db.seq.pay + 31840}LK`;
  db.payments.push({ id: `pay-${id}`, tournament_id: tid, tournament_title: t.title, user_id: session, team_id: null, team_name: name,
    members, amount: t.entry_fee, currency: 'USD', status: 'created', paypal_order_id: id, paypal_capture_id: null,
    payer_email: null, payer_name: null, prize_email: prizeEmail || null, failure_reason: null, created_at: new Date().toISOString() });
  return delay({ orderId: id, amount: String(t.entry_fee), currency: 'USD' }, 700);
}
export function paypalCapture(orderId) {
  const p = db.payments.find((x) => x.paypal_order_id === orderId && x.user_id === session);
  if (!p) return fail('Payment not found.');
  const t = db.tournaments.find((x) => x.id === p.tournament_id);
  const problem = canJoin(t, me(), p.team_name, p.members);
  if (problem) {
    Object.assign(p, { status: 'refunded', failure_reason: problem });
    return fail(`${problem} Your payment was refunded automatically.`);
  }
  const team = insertTeam(t.id, p.team_name, { captain_id: session, members: p.members, is_paid: true, payment_method: 'paypal',
    paid_amount: p.amount, prize_email: p.prize_email ?? me().email, paid_at: new Date().toISOString() });
  Object.assign(p, { status: 'completed', team_id: team.id, paypal_capture_id: `CAP-${orderId}`, payer_email: 'buyer@personal.example.com' });
  return delay({ status: 'completed', teamId: team.id, tournamentId: t.id }, 1600);
}

// ---- wallets and payouts ----
function visiblePayout(p, user) {
  return user && (user.role === 'creator' || p.owner_id === user.id || p.recipient_id === user.id);
}
export function walletEntries(wallet) {
  const user = me();
  return delay(db.entries.filter((e) => e.wallet === wallet && (user?.role === 'creator' || e.owner_id === user?.id)).reverse());
}
export function listPayouts({ tournamentId = null, kind = null, wallet = null, recipientId = null } = {}) {
  const user = me();
  return delay(db.payouts.filter((p) => visiblePayout(p, user) && (!tournamentId || p.tournament_id === tournamentId)
    && (!kind || p.kind === kind) && (!wallet || p.wallet === wallet) && (!recipientId || p.recipient_id === recipientId)).reverse());
}
// PayPal "delivers" every payout on the first status check.
export function refreshPayouts() {
  const user = me();
  const moving = db.payouts.filter((p) => visiblePayout(p, user) && p.status === 'sent');
  moving.forEach((p) => Object.assign(p, { status: 'paid', paypal_fee: 0.25 }));
  return delay(moving.length);
}
export const resendPayout = (id) => delay({ payout: db.payouts.find((p) => p.id === id) });
export function withdraw(wallet, amount, email) {
  const user = me();
  const owner = wallet === 'platform' ? null : user.id;
  if ((wallet === 'platform') !== (user.role === 'creator')) return fail('This wallet is not yours.');
  const cents = toCents(amount);
  if (cents > balance(wallet, owner)) return fail(`You can withdraw at most $${(balance(wallet, owner) / 100).toFixed(2)}.`);
  const payout = addPayout({ kind: 'withdrawal', wallet, owner_id: owner, requested_by: user.id, receiver_email: email.toLowerCase(), amount: cents / 100 });
  addEntry(wallet, owner, -cents, 'withdrawal', null, `Withdrawal to ${payout.receiver_email}`, payout.id);
  return delay({ payout });
}

// ---- brackets ----
const teamsOf = (tid) => db.teams.filter((x) => x.tournament_id === tid);
const matchesOf = (tid) => db.matches.filter((m) => m.tournament_id === tid).sort((a, b) => a.phase - b.phase || a.position - b.position);
function note(userId, kind, title, body, link) {
  if (userId) db.notifications.push({ id: ++db.seq.note, user_id: userId, kind, title, body, link, read_at: null, created_at: new Date().toISOString() });
}
function applyStats(t) {
  for (const s of bracketStandings(matchesOf(t.id), teamsOf(t.id).map((x) => x.id), t.bracket_settings.places ?? {})) {
    const { id, ...stats } = s;
    Object.assign(db.teams.find((x) => x.id === id), stats);
  }
}
export const getMatches = (tid) => delay(matchesOf(tid));
export const teamMatches = (ids) => delay(db.matches.filter((m) => ids.includes(m.team_a) || ids.includes(m.team_b)));
export const getVotes = (ids) => delay(db.votes.filter((v) => ids.includes(v.match_id)));
export function buildBracket(tid, format) {
  const t = notSettled(owned(tid));
  const teams = teamsOf(tid);
  if (teams.length < 2) return fail('At least 2 teams are needed to build a bracket.');
  if (matchesOf(tid).some((m) => m.status === 'finished')) return fail('Results are already in.');
  const chosen = FORMATS.includes(format) ? format : 'single_elimination';
  if (!formatsFor(teams.length).includes(chosen)) return fail('This format needs more teams.');
  const start = new Date(Math.max(Date.parse(t.start_at), Date.now() + 30 * 60_000)).toISOString();
  const order = SEEDED.map((name) => teams.find((x) => x.name === name)).filter(Boolean);
  const seeded = order.length === teams.length ? order : teams;
  const { matches, settings } = buildEngine(chosen, seeded.map((x) => x.id), PLAN, t.start_at, teams);
  db.matches = db.matches.filter((m) => m.tournament_id !== tid)
    .concat(matches.map((m) => ({ ...m, id: ++db.seq.match, tournament_id: tid, reschedule_count: 0 })));
  Object.assign(t, { bracket_format: chosen, bracket_settings: { ...settings, reason: PLAN.reason, ai: true } });
  if (t.status === 'registration') t.status = 'active';
  applyStats(t);
  teams.forEach((team) => note(team.captain_id, 'bracket', `The bracket of ${t.title} is ready`, 'Open the bracket to see your first match.', `/t/${tid}`));
  return delay({ format: chosen, reason: t.bracket_settings.reason, ai: true, matches: matches.filter((m) => m.status !== 'bye').length }, 2200);
}
export function reportMatch(tid, key, a, b) {
  const t = notSettled(owned(tid));
  const all = matchesOf(tid);
  try {
    reportEngine(all, key, a, b, teamsOf(tid));
  } catch (error) {
    return fail(error.message);
  }
  applyStats(t);
  return delay({ ok: true });
}
export function moveMatch(tid, key, iso) {
  const t = notSettled(owned(tid));
  const moved = moveEngine(matchesOf(tid), key, iso, normalizeSettings(t.bracket_format, teamsOf(tid).length, t.bracket_settings));
  return delay({ moved });
}
export function removeBracket(tid) {
  const t = notSettled(owned(tid));
  db.matches = db.matches.filter((m) => m.tournament_id !== tid);
  teamsOf(tid).forEach((team) => Object.assign(team, { wins: 0, draws: 0, losses: 0, score_for: 0, score_against: 0, points: 0, final_place: null }));
  t.bracket_settings = {};
  return delay({ removed: true });
}
export function voteReschedule(matchId) {
  const m = db.matches.find((x) => x.id === matchId);
  const team = db.teams.find((x) => (x.id === m.team_a || x.id === m.team_b) && x.captain_id === session);
  if (!team) return fail('Only the captains of the two teams can ask to move this match.');
  if (!db.votes.some((v) => v.match_id === matchId && v.user_id === session)) db.votes.push({ match_id: matchId, user_id: session, team_id: team.id });
  const votes = new Set(db.votes.filter((v) => v.match_id === matchId).map((v) => v.team_id)).size;
  const needed = db.teams.filter((x) => (x.id === m.team_a || x.id === m.team_b) && x.captain_id).length;
  if (votes < needed) return delay({ votes, needed, complete: false, rescheduled: null });
  const t = db.tournaments.find((x) => x.id === m.tournament_id);
  const s = normalizeSettings(t.bracket_format, teamsOf(t.id).length, t.bracket_settings);
  const [option] = rescheduleOptions(matchesOf(t.id), m.match_key, s, new Date().toISOString()).filter((o) => new Date(o.scheduled_at).getHours() >= 20);
  const moved = moveEngine(matchesOf(t.id), m.match_key, option.scheduled_at, s);
  m.reschedule_count += 1;
  db.votes = db.votes.filter((v) => v.match_id !== matchId);
  const when = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(option.scheduled_at));
  const message = `Both captains asked, so the AI moved ${m.label} to ${when}. No clashes for either team, and the later matches moved along.`;
  db.teams.filter((x) => x.id === m.team_a || x.id === m.team_b).forEach((x) => note(x.captain_id, 'reschedule', `${m.label} moved`, message, `/t/${t.id}`));
  return delay({ votes, needed, complete: true, rescheduled: { scheduled_at: option.scheduled_at, message, moved } }, 1500);
}

// ---- AI and team finder ----
export function aiDraftTournament() {
  const d = saturday;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return delay({ draft: {
    title: VALORANT.title, game: 'Valorant', description: VALORANT.description, format: 'online', city: '', start_date: date, start_time: '19:00',
    max_teams: 16, team_size: 5, is_paid: true, entry_fee: 20, prize_percent: 60, prize_split: [50, 30, 20], prize_note: '',
    bracket_format: 'single_elimination', assumptions: 'online on EU servers, start at 7 PM, 60% of the entry fees go to the prize pool',
  } }, 2600);
}
export function aiTeammates() {
  const pick = (uid, games, tournaments, wins, losses, titles, match, reason) => {
    const u = db.users.find((x) => x.id === uid); const c = db.cards.get(uid);
    return { user_id: uid, username: u.username, full_name: u.full_name, games, cities: [], tournaments, wins, draws: 0, losses, titles,
      looking: Boolean(c?.looking), note: c?.looking ? c.note : '', contact: c?.looking ? c.contact : '', match, reason };
  };
  return delay({ ai: true, picks: [
    pick('u-p4', ['Valorant', 'Counter-Strike 2'], 4, 9, 4, 0, 93, 'You both play Valorant on weekend evenings, and his team reached the final of Valorant Spike Rush, one place above yours.'),
    pick('u-p6', ['Valorant', 'Rocket League'], 3, 6, 4, 0, 87, 'She is looking for a stable Valorant roster right now and plays Sentinel, which fits your Initiator role.'),
    pick('u-p8', ['Valorant'], 2, 4, 3, 0, 81, 'A Valorant duelist with a similar win rate to yours (about 55%) who is also looking for a team.'),
    pick('u-p7', ['Valorant', 'EA FC'], 3, 5, 4, 0, 72, 'You both play Valorant and EA FC; he finished third in EA FC Weekend League, right behind you.'),
  ] }, 1900);
}
export function inviteTeammate(userId, message) {
  const card = db.cards.get(session);
  if (!card?.contact) return fail('Add your contact (Discord, Telegram…) to your card first, so the player can reach you.');
  note(userId, 'invite', `${me().full_name} wants to team up with you`, `${message}\n\nReach them here: ${card.contact}`, '/team-finder');
  return delay({ sent: true });
}
export const getPlayerCard = (uid) => delay(db.cards.get(uid) ?? null);
export const lookingPlayers = () => delay([...db.cards.values()].filter((c) => c.looking).map((c) => ({
  ...c, profile: profileOf(db.users.find((u) => u.id === c.user_id)),
})));
export function savePlayerCard(card) {
  db.cards.set(session, { ...card, user_id: session, updated_at: new Date().toISOString() });
  return delay(null);
}

// ---- seed: one story, a state per scene of the demo video ----
const DEMO = window.__DEMO__ ?? { scene: 'create' };
const SCENE = DEMO.scene;
const saturday = (() => { const d = new Date(now); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d; })();
const at = (date, h, m = 0) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d.toISOString(); };
const VALORANT = {
  title: 'Valorant Night Cup', game: 'Valorant', start_at: at(saturday, 19), max_teams: 16, team_size: 5, is_paid: true, entry_fee: 20,
  prize_percent: 60, prize_split: [50, 30, 20],
  description: 'Online 5v5 Valorant cup for up to 16 teams.\nSingle elimination: Bo1 until the semifinals, Bo3 semifinals and final.\nCheck-in opens 30 minutes before the start; captains report scores on TurniRUM.\nStandard competitive rules, all agents allowed, EU servers.\nPrizes: 50% / 30% / 20% of the prize pool for the top three.',
};
const ROSTERS = {
  'Aurora': ['Dana Lee', 'Kira', 'Vex', 'Moon', 'Rook'], 'Qyran Five': ['Arman Seitkali', 'Saken', 'Bolat', 'Erzhan', 'Dias'],
  'Steppe Wolves': ['Timur Bekov', 'Asel', 'Marat', 'Ruslan', 'Aibek'], 'Nomad Five': ['Leo Park', 'Jin', 'Hugo', 'Ola', 'Ben'],
  'Astana Lions': ['Nika Volkova', 'Ira', 'Den', 'Sol', 'Max'], 'Barys Gaming': ['Sara Kim', 'Yuna', 'Eli', 'Noah', 'Ari'],
  'Silk Road': ['Omar', 'Farid', 'Lin', 'Kai', 'Zed'], 'Tengri Force': ['Alex Carter', 'Mirage', 'Kairat', 'Dias', 'Nova'],
};
const CAPTAINS = { 'Aurora': 'u-p2', 'Qyran Five': 'u-p3', 'Nomad Five': 'u-p4', 'Steppe Wolves': 'u-p7', 'Astana Lions': 'u-p8', 'Barys Gaming': 'u-p6', 'Tengri Force': 'u-p1' };
function paidTeam(t, name, extra = {}) {
  const team = insertTeam(t.id, name, { is_paid: true, payment_method: 'paypal', paid_amount: t.entry_fee, paid_at: new Date(now - 3600_000).toISOString(),
    members: ROSTERS[name] ?? ['Ace', 'Nova'], captain_id: CAPTAINS[name] ?? null,
    prize_email: `${name.toLowerCase().replace(/\W+/g, '.')}@paypal.example.com`, ...extra });
  db.payments.push({ id: `pay-${team.id}`, tournament_id: t.id, tournament_title: t.title, user_id: team.captain_id, team_id: team.id,
    team_name: name, members: team.members, amount: t.entry_fee, currency: 'USD', status: 'completed', paypal_order_id: `5UX${48210 + team.id}PQ`,
    paypal_capture_id: `9KJ${77310 + team.id}TS`, payer_email: null, payer_name: null, prize_email: null, paypal_fee: 1.08,
    failure_reason: null, created_at: new Date(now - (20 - team.id) * 1800_000).toISOString() });
  return team;
}
// The rest of the catalog (other organizers' events).
const cup = addTournament('u-org', { title: 'Steppe Cup 2026', game: 'Counter-Strike 2', start_at: at(new Date(now + 16 * day), 18), max_teams: 16, team_size: 5,
  is_paid: true, entry_fee: 25, prize_percent: 60, description: 'The main online CS2 event of the fall. Bo1 groups, Bo3 playoffs.' });
['Nomad Five', 'Astana Lions', 'Qazaq Eagles', 'Kok Bori', 'Aral Storm'].forEach((name) => paidTeam(cup, name, { captain_id: null }));
const night = addTournament('u-org2', { title: 'Dota 2 Night Cup', game: 'Dota 2', start_at: at(new Date(now - 2 * day), 21), max_teams: 8, team_size: 5,
  is_paid: true, entry_fee: 15, prize_percent: 70, prize_split: [70, 30], status: 'active' });
['Snow Leopards', 'Barys Gaming', 'Kok Bori', 'Silk Road', 'Aral Storm', 'Altyn Orda'].forEach((name, i) => paidTeam(night, name, {
  captain_id: null, wins: 5 - i, losses: i, score_for: 10 - i, score_against: 2 + i, points: (5 - i) * 3 }));
addTournament('u-org2', { title: 'Chess Blitz Almaty', game: 'Chess', format: 'offline', city: 'Almaty, Dostyk Plaza', start_at: at(new Date(now + 12 * day), 11),
  max_teams: 32, team_size: 1, is_paid: true, entry_fee: 5, prize_percent: 50 });
const fc = addTournament('u-org2', { title: 'EA FC Weekend League', game: 'EA FC', start_at: at(new Date(now - 20 * day), 16), max_teams: 10, team_size: 1, status: 'finished' });
['Mia Novak', 'Sara Kim', 'Timur Bekov'].forEach((name, i) => insertTeam(fc.id, name, { members: [name], wins: 4 - i, losses: i, points: (4 - i) * 3, final_place: i + 1 }));
const spike = addTournament('u-org2', { title: 'Valorant Spike Rush', game: 'Valorant', start_at: at(new Date(now - 9 * day), 19), max_teams: 8, team_size: 5,
  prize_note: 'Gaming gear from our partners', status: 'finished' });
[['Aurora', 'u-p2', 1], ['Ghost Pixels', 'u-p5', 3], ['Nomad Five', 'u-p4', 2], ['Qyran Five', 'u-p3', 4]].forEach(([name, captain, place], i) => insertTeam(spike.id, name, {
  captain_id: captain, members: ROSTERS[name] ?? [captain === 'u-p5' ? 'Mia Novak' : 'Player', 'Jett'], wins: 4 - place, losses: place - 1, final_place: place, points: (4 - place) * 3 }));
addTournament('u-org2', { title: 'Rocket League 2v2 Rumble', game: 'Rocket League', start_at: at(new Date(now + 6 * day), 20), max_teams: 16, team_size: 2,
  prize_note: 'Steam gift cards for the top 2' });

// The Valorant Night Cup at each moment of the story.
const SEEDED = ['Aurora', 'Qyran Five', 'Steppe Wolves', 'Nomad Five', 'Astana Lions', 'Barys Gaming', 'Silk Road', 'Tengri Force'];
const PLAN = { reason: 'Eight teams fit a clean single-elimination bracket in one evening: quarterfinals at 7 PM, semifinals at 8, the final and the third-place match at 9. Seeded by results on TurniRUM, so Aurora and Qyran Five can only meet in the final.',
  ai: true, best_of: 1, match_minutes: 45, break_minutes: 15, parallel: 4 };
let cupT = null;
if (SCENE !== 'create') {
  cupT = addTournament('u-org', { ...VALORANT, created_at: new Date(now - 2 * day).toISOString() });
  const names = SCENE === 'pay' ? SEEDED.slice(0, 7) : SEEDED;
  names.forEach((name) => paidTeam(cupT, name));
}
function seedBracket(results = []) {
  const ids = SEEDED.map((name) => db.teams.find((x) => x.tournament_id === cupT.id && x.name === name).id);
  const { matches, settings } = buildEngine('single_elimination', ids, PLAN, cupT.start_at, teamsOf(cupT.id));
  db.matches = matches.map((m) => ({ ...m, id: ++db.seq.match, tournament_id: cupT.id, reschedule_count: 0 }));
  Object.assign(cupT, { status: 'active', bracket_format: 'single_elimination', bracket_settings: { ...settings, reason: PLAN.reason, ai: true } });
  for (const [label, a, b] of results) {
    const m = matchesOf(cupT.id).find((x) => x.label === label);
    reportEngine(matchesOf(cupT.id), m.match_key, a, b, teamsOf(cupT.id));
  }
  applyStats(cupT);
}
if (['reschedule', 'results', 'teammates'].includes(SCENE)) {
  if (SCENE === 'reschedule' || SCENE === 'teammates') seedBracket();
  else seedBracket([['Quarterfinal 1', 13, 7], ['Quarterfinal 2', 11, 13], ['Quarterfinal 3', 13, 5], ['Quarterfinal 4', 13, 10],
    ['Semifinal 1', 13, 9], ['Semifinal 2', 13, 11], ['Third place', 13, 8]]);
}
if (SCENE === 'reschedule') {
  const qf = matchesOf(cupT.id).find((m) => m.label === 'Quarterfinal 1');
  db.votes.push({ match_id: qf.id, user_id: 'u-p2', team_id: qf.team_a });
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  db.notifications.push(
    { id: ++db.seq.note, user_id: 'u-p1', kind: 'bracket', title: 'The bracket of Valorant Night Cup is ready', body: 'Your first match: Quarterfinal 1 against Aurora, Saturday at 7:00 PM.', link: '/bracket', read_at: ago(50), created_at: ago(180) },
    { id: ++db.seq.note, user_id: 'u-p1', kind: 'reminder', title: 'Valorant Night Cup starts in 24 hours', body: 'Big night ahead, Tengri Force! Check in 30 minutes before your quarterfinal against Aurora. We also sent this reminder to alex@demo.dev.', link: '/bracket', read_at: null, created_at: ago(20) },
  );
}
if (SCENE === 'teammates') {
  const card = (uid, games, note, contact, looking = true) => db.cards.set(uid, { user_id: uid, looking, games, note, contact, updated_at: new Date(now - 3600_000).toISOString() });
  card('u-p5', ['Valorant', 'EA FC'], 'Initiator main, plays evenings (UTC+5). Looking for a team for the next cups.', 'Discord: mia.novak');
  card('u-p4', ['Valorant', 'Counter-Strike 2'], 'IGL, calm comms, free on weekends.', 'Discord: leopark');
  card('u-p6', ['Valorant', 'Rocket League'], 'Sentinel / smokes. Want a stable roster.', 'Telegram: @sarakim');
  card('u-p8', ['Valorant'], 'Duelist, 2 years ranked.', 'Discord: nika.v');
}
if (DEMO.as) session = DEMO.as;

// ---- notifications ----
export const listNotifications = () => delay(db.notifications.filter((n) => n.user_id === session).reverse());
export const unreadCount = () => delay(db.notifications.filter((n) => n.user_id === session && !n.read_at).length);
export function markNotificationsRead() {
  db.notifications.filter((n) => n.user_id === session).forEach((n) => { n.read_at = n.read_at ?? new Date().toISOString(); });
  return delay(null);
}

// ---- creator ----
export function adminUsers() {
  if (me()?.role !== 'creator') return fail('Only the platform creator can see the user list.');
  return delay(db.users.map((u) => ({ ...profileOf(u), email: u.email,
    tournaments_count: db.tournaments.filter((t) => t.organizer_id === u.id).length,
    teams_count: db.teams.filter((x) => x.captain_id === u.id).length })));
}
export function adminDeleteTournament(tid) {
  if (me()?.role !== 'creator') return fail('Only the platform creator can delete tournaments.');
  const t = db.tournaments.find((x) => x.id === tid);
  const refunds = t.settled_at ? [] : db.payments.filter((p) => p.tournament_id === tid && p.status === 'completed');
  refunds.forEach((p) => Object.assign(p, { status: 'refunded', failure_reason: 'Refunded: the tournament was deleted.' }));
  db.tournaments = db.tournaments.filter((x) => x.id !== tid);
  db.teams = db.teams.filter((x) => x.tournament_id !== tid);
  return delay({ deleted: true, refunded: refunds.length });
}
