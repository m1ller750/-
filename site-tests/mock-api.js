// In-memory stand-in for site/js/api.js used by the browser tests (same exports, no network).
// Served in place of /js/api.js, so it can reuse the site's own money and ranking helpers.
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
    { id: 'u-p1', email: 'player1@demo.dev', password: 'demo1234', username: 'player1', full_name: 'Alex Carter', role: 'participant' },
    { id: 'u-p2', email: 'player2@demo.dev', password: 'demo1234', username: 'player2', full_name: 'Dana Lee', role: 'participant' },
    { id: 'u-boss', email: 'boss@demo.dev', password: CREATOR_PASSWORD, username: 'boss', full_name: 'Platform Owner', role: 'creator' },
  ],
  tournaments: [],
  teams: [],
  payments: [],
  payouts: [],
  entries: [],
  seq: { t: 0, team: 0, pay: 0, payout: 0, entry: 0 },
};
let session = null;
const listeners = [];

function addTournament(org, data) {
  const t = {
    id: ++db.seq.t, organizer_id: org, description: '', format: 'online', city: '', prize_note: '', status: 'registration',
    is_paid: false, entry_fee: 0, prize_percent: 60, prize_split: [50, 30, 20], fee_ack_at: null, settled_at: null,
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
    is_paid: false, payment_method: null, paid_amount: 0, paid_at: null, prize_email: null, created_at: new Date().toISOString(), ...extra,
  };
  db.teams.push(team);
  return team;
}

// ---- seed ----
const cup = addTournament('u-org', { title: 'Steppe Cup 2026', game: 'Counter-Strike 2', start_at: iso(9), max_teams: 16, team_size: 5,
  is_paid: true, entry_fee: 25, prize_percent: 60, description: 'The main online CS2 event of the fall. Bo1 groups, Bo3 playoffs.' });
const night = addTournament('u-org', { title: 'Dota 2 Night Cup', game: 'Dota 2', start_at: iso(-3, 22), max_teams: 8, team_size: 5,
  is_paid: true, entry_fee: 15, prize_percent: 70, prize_split: [70, 30], status: 'active' });
const val = addTournament('u-org2', { title: 'Valorant Spike Rush', game: 'Valorant', start_at: iso(5), max_teams: 12, team_size: 5,
  prize_note: 'Gaming gear from our partners' });
addTournament('u-org2', { title: 'Chess Blitz Almaty', game: 'Chess', format: 'offline', city: 'Almaty, Dostyk Plaza', start_at: iso(14),
  max_teams: 32, team_size: 1, is_paid: true, entry_fee: 5, prize_percent: 50 });
addTournament('u-org2', { title: 'EA FC Weekend League', game: 'EA FC', start_at: iso(-20), max_teams: 10, team_size: 1, status: 'finished' });
function paidTeam(t, name, extra = {}) {
  const team = insertTeam(t.id, name, { is_paid: true, payment_method: 'paypal', paid_amount: t.entry_fee, paid_at: new Date().toISOString(),
    prize_email: `${name.toLowerCase().replace(/\W+/g, '.')}@paypal.example.com`, ...extra });
  db.payments.push({ id: `pay-${team.id}`, tournament_id: t.id, tournament_title: t.title, user_id: team.captain_id, team_id: team.id,
    team_name: name, members: team.members, amount: t.entry_fee, currency: 'USD', status: 'completed', paypal_order_id: `ORDER-${team.id}`,
    paypal_capture_id: `CAPTURE-${team.id}`, payer_email: null, payer_name: null, prize_email: null, paypal_fee: 0.99,
    failure_reason: null, created_at: new Date().toISOString() });
  return team;
}
paidTeam(cup, 'Steppe Wolves');
['Nomad Five', 'Astana Lions', 'Qazaq Eagles'].forEach((name) => insertTeam(cup.id, name));
['Snow Leopards', 'Barys Gaming', 'Kok Bori', 'Silk Road', 'Aral Storm'].forEach((name, i) => paidTeam(night, name, {
  wins: 5 - i, losses: i, score_for: 10 - i, score_against: 2 + i, points: (5 - i) * 3, captain_id: i === 0 ? 'u-p2' : null,
}));
insertTeam(val.id, 'Tengri Force', { captain_id: 'u-p1', members: ['Alex Carter', 'Mirage'] });

// ---- helpers ----
const delay = (value) => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), 40));
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
  return delay({ settlement: { collected: p.collected, platform: p.platform, prize: p.prize, organizer: p.organizer }, payouts });
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
  const id = `ORDER-${++db.seq.pay + 100}`;
  db.payments.push({ id: `pay-${id}`, tournament_id: tid, tournament_title: t.title, user_id: session, team_id: null, team_name: name,
    members, amount: t.entry_fee, currency: 'USD', status: 'created', paypal_order_id: id, paypal_capture_id: null,
    payer_email: null, payer_name: null, prize_email: prizeEmail || null, failure_reason: null, created_at: new Date().toISOString() });
  return delay({ orderId: id, amount: String(t.entry_fee), currency: 'USD' });
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
    paid_amount: p.amount, prize_email: p.prize_email ?? me().email });
  Object.assign(p, { status: 'completed', team_id: team.id, paypal_capture_id: `CAP-${orderId}`, payer_email: 'buyer@personal.example.com' });
  return delay({ status: 'completed', teamId: team.id, tournamentId: t.id });
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
