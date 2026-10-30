// In-memory stand-in for site/js/api.js used by the browser tests (same exports, no network).
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
  payouts: new Map(),
  seq: { t: 0, team: 0, pay: 0 },
};
let session = null;
const listeners = [];

function addTournament(org, data, payout = null) {
  const t = {
    id: ++db.seq.t, organizer_id: org, description: '', format: 'online', city: '', prize_note: '', status: 'registration',
    is_paid: false, entry_fee: 0, prize_percent: 60, created_at: new Date(now - db.seq.t * 3600_000).toISOString(), ...data,
  };
  db.tournaments.push(t);
  if (payout) db.payouts.set(t.id, payout);
  return t;
}

function insertTeam(tid, name, extra = {}) {
  const team = {
    id: ++db.seq.team, tournament_id: tid, captain_id: null, name, members: ['Ace', 'Nova', 'Rin'].slice(0, 2),
    wins: 0, draws: 0, losses: 0, score_for: 0, score_against: 0, points: 0,
    is_paid: false, payment_method: null, paid_amount: 0, paid_at: null, created_at: new Date().toISOString(), ...extra,
  };
  db.teams.push(team);
  return team;
}

// ---- seed ----
const cup = addTournament('u-org', { title: 'Steppe Cup 2026', game: 'Counter-Strike 2', start_at: iso(9), max_teams: 16, team_size: 5,
  is_paid: true, entry_fee: 25, prize_percent: 60, description: 'The main online CS2 event of the fall. Bo1 groups, Bo3 playoffs.' }, 'payouts@arena.dev');
const night = addTournament('u-org', { title: 'Dota 2 Night Cup', game: 'Dota 2', start_at: iso(-3, 22), max_teams: 8, team_size: 5,
  is_paid: true, entry_fee: 15, prize_percent: 70, status: 'active' }, 'payouts@arena.dev');
const val = addTournament('u-org2', { title: 'Valorant Spike Rush', game: 'Valorant', start_at: iso(5), max_teams: 12, team_size: 5,
  prize_note: 'Gaming gear from our partners' });
addTournament('u-org2', { title: 'Chess Blitz Almaty', game: 'Chess', format: 'offline', city: 'Almaty, Dostyk Plaza', start_at: iso(14),
  max_teams: 32, team_size: 1, is_paid: true, entry_fee: 5, prize_percent: 50 }, 'chess@league.dev');
addTournament('u-org2', { title: 'EA FC Weekend League', game: 'EA FC', start_at: iso(-20), max_teams: 10, team_size: 1, status: 'finished' });
['Steppe Wolves', 'Nomad Five', 'Astana Lions', 'Qazaq Eagles'].forEach((name, i) => insertTeam(cup.id, name, i < 3
  ? { is_paid: true, payment_method: i === 0 ? 'paypal' : 'manual', paid_amount: 25, paid_at: new Date().toISOString() } : {}));
['Snow Leopards', 'Barys Gaming', 'Kok Bori', 'Silk Road', 'Aral Storm'].forEach((name, i) => insertTeam(night.id, name, {
  wins: 5 - i, losses: i, score_for: 10 - i, score_against: 2 + i, points: (5 - i) * 3,
  is_paid: true, payment_method: 'paypal', paid_amount: 15, paid_at: new Date().toISOString(),
}));
insertTeam(val.id, 'Tengri Force', { captain_id: 'u-p1', members: ['Alex Carter', 'Mirage'] });
db.payments.push({ id: 'pay-1', tournament_id: night.id, tournament_title: night.title, user_id: 'u-p2', team_id: 5, team_name: 'Snow Leopards',
  members: [], amount: 15, currency: 'USD', status: 'completed', paypal_order_id: 'ORDER-1', paypal_capture_id: 'CAPTURE-1',
  payer_email: 'buyer@personal.example.com', payer_name: 'Test Buyer', failure_reason: null, created_at: new Date().toISOString() });

// ---- helpers ----
const delay = (value) => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), 40));
const me = () => (session ? db.users.find((u) => u.id === session) : null);
const profileOf = (u) => u && { id: u.id, username: u.username, full_name: u.full_name, role: u.role, created_at: '2026-10-01T10:00:00Z' };
const fail = (message, fields) => Promise.reject(new ApiError(message, fields));
function overview(t) {
  const org = db.users.find((u) => u.id === t.organizer_id);
  const teams = db.teams.filter((x) => x.tournament_id === t.id);
  const paid = teams.filter((x) => x.is_paid);
  return { ...t, organizer_name: org.full_name, organizer_username: org.username, team_count: teams.length,
    paid_count: paid.length, collected: paid.reduce((s, x) => s + Number(x.paid_amount), 0) };
}
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

// ---- auth ----
export const currentUserId = () => delay(session);
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
  ...x, captain: x.captain_id ? profileOf(db.users.find((u) => u.id === x.captain_id)) : null,
})));
export const myTeams = (uid) => delay(db.teams.filter((x) => x.captain_id === uid));
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
export function saveTournament(id, data, payoutEmail) {
  if (me()?.role !== 'organizer') return fail('Only organizers can create tournaments.');
  if (data.is_paid && !payoutEmail) return fail('Add the PayPal email where you want to receive payouts.');
  let t;
  if (id) {
    t = owned(id);
    Object.assign(t, data);
  } else {
    t = addTournament(session, { ...data, created_at: new Date().toISOString() });
  }
  if (data.is_paid) db.payouts.set(t.id, payoutEmail);
  return delay(t.id);
}
export const getPayoutEmail = (tid) => delay(db.payouts.get(tid) ?? '');
export function setStatus(tid, status) { owned(tid).status = status; return delay(null); }
export function addTeam(tid, name, members, paid) {
  const t = owned(tid);
  if (db.teams.filter((x) => x.tournament_id === tid).length >= t.max_teams) return fail('The team limit is reached.');
  if (db.teams.some((x) => x.tournament_id === tid && x.name.toLowerCase() === name.toLowerCase())) return fail('A team with this name already exists.');
  const isPaid = t.is_paid && paid;
  return delay(insertTeam(tid, name, { members, is_paid: isPaid, payment_method: isPaid ? 'manual' : null, paid_amount: isPaid ? t.entry_fee : 0 }).id);
}
export function deleteTeam(teamId) {
  const team = db.teams.find((x) => x.id === teamId);
  owned(team.tournament_id);
  db.teams.splice(db.teams.indexOf(team), 1);
  return delay(null);
}
export function saveTable(tid, rows, autoPoints) {
  const t = owned(tid);
  const names = new Set();
  for (const row of rows) {
    if (names.has(row.name.toLowerCase())) return fail('Two teams cannot have the same name.');
    names.add(row.name.toLowerCase());
  }
  for (const row of rows) {
    const team = db.teams.find((x) => x.id === row.id);
    Object.assign(team, { name: row.name, members: row.members, wins: row.wins, draws: row.draws, losses: row.losses,
      score_for: row.score_for, score_against: row.score_against, points: autoPoints ? row.wins * 3 + row.draws : row.points });
    if (t.is_paid && team.payment_method !== 'paypal' && 'paid' in row) {
      Object.assign(team, row.paid ? { is_paid: true, payment_method: 'manual', paid_amount: t.entry_fee }
        : { is_paid: false, payment_method: null, paid_amount: 0 });
    }
  }
  return delay(null);
}

// ---- payments ----
export function listPayments({ tournamentId = null } = {}) {
  const user = me();
  const visible = db.payments.filter((p) => user && (user.role === 'creator' || p.user_id === user.id
    || db.tournaments.find((t) => t.id === p.tournament_id)?.organizer_id === user.id));
  return delay(visible.filter((p) => !tournamentId || p.tournament_id === tournamentId).reverse());
}
export const paypalConfig = () => delay({ enabled: true, clientId: 'test-client', currency: 'USD', env: 'sandbox' });
export function paypalCreateOrder(tid, name, members) {
  const t = db.tournaments.find((x) => x.id === tid);
  const problem = canJoin(t, me(), name, members);
  if (problem) return fail(problem);
  const id = `ORDER-${++db.seq.pay + 100}`;
  db.payments.push({ id: `pay-${id}`, tournament_id: tid, tournament_title: t.title, user_id: session, team_id: null, team_name: name,
    members, amount: t.entry_fee, currency: 'USD', status: 'created', paypal_order_id: id, paypal_capture_id: null,
    payer_email: null, payer_name: null, failure_reason: null, created_at: new Date().toISOString() });
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
  const team = insertTeam(t.id, p.team_name, { captain_id: session, members: p.members, is_paid: true, payment_method: 'paypal', paid_amount: p.amount });
  Object.assign(p, { status: 'completed', team_id: team.id, paypal_capture_id: `CAP-${orderId}`, payer_email: 'buyer@personal.example.com' });
  return delay({ status: 'completed', teamId: team.id, tournamentId: t.id });
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
  db.tournaments = db.tournaments.filter((t) => t.id !== tid);
  db.teams = db.teams.filter((x) => x.tournament_id !== tid);
  return delay(null);
}
