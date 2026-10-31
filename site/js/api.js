// The only module that talks to Supabase. Tests swap it for an in-memory mock with the same exports.
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'turnirum-auth' },
});

export class ApiError extends Error {
  constructor(message, fields = {}, data = {}) {
    super(message);
    this.fields = fields ?? {};
    this.data = data ?? {};
  }
}

function check({ data, error, count }, withCount = false) {
  if (error) throw new ApiError(error.message || 'Request failed.');
  return withCount ? count : data;
}

const TEAM_COLUMNS = 'id, tournament_id, captain_id, name, members, wins, draws, losses, score_for, score_against, '
  + 'points, is_paid, payment_method, paid_amount, paid_at, created_at';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Calls the `api` Edge Function (accounts and PayPal).
async function callApi(action, payload = {}) {
  const { data } = await sb.auth.getSession();
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
      method: 'POST', headers, body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new ApiError('Network error — check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status}).`, body.fields, body);
  return body;
}

// ---------------------------------------------------------------- auth --

export async function currentUserId() {
  const { data } = await sb.auth.getSession();
  return data.session?.user?.id ?? null;
}

export async function currentUserEmail() {
  const { data } = await sb.auth.getSession();
  return data.session?.user?.email ?? '';
}

export function onAuthChange(callback) {
  sb.auth.onAuthStateChange((event) => setTimeout(() => callback(event), 0));
}

export async function fetchProfile(userId) {
  return check(await sb.from('profiles').select('id, username, full_name, role, created_at').eq('id', userId).maybeSingle());
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) {
    throw new ApiError(/invalid login credentials/i.test(error.message) ? 'Wrong email or password.' : error.message);
  }
  // Signing in with the platform creator password turns the account into the creator account.
  try {
    await callApi('claim-creator', { password_sha256: await sha256Hex(password) });
  } catch (err) {
    console.warn('creator check failed', err);
  }
}

export async function register(form) {
  await callApi('register', form);
  await signIn(form.email, form.password);
}

export async function signOut() {
  await sb.auth.signOut();
}

// ----------------------------------------------------------- tournaments --

export async function listTournaments() {
  return check(await sb.from('tournament_overview').select('*').order('start_at', { ascending: true }).limit(1000));
}

export async function getTournament(id) {
  return check(await sb.from('tournament_overview').select('*').eq('id', id).maybeSingle());
}

export async function getTeams(tournamentId) {
  return check(await sb.from('teams').select(`${TEAM_COLUMNS}, captain:profiles(full_name, username)`)
    .eq('tournament_id', tournamentId));
}

export async function myTeams(userId) {
  return check(await sb.from('teams').select(TEAM_COLUMNS).eq('captain_id', userId));
}

export async function countParticipants() {
  return check(await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'participant'), true) ?? 0;
}

export async function joinFree(tournamentId, name, members) {
  return check(await sb.rpc('join_free_tournament', { p_tournament_id: tournamentId, p_name: name, p_members: members }));
}

export async function leaveTournament(tournamentId) {
  check(await sb.rpc('leave_tournament', { p_tournament_id: tournamentId }));
}

// ------------------------------------------------------------- organizer --

export async function saveTournament(id, data) {
  return check(await sb.rpc('save_tournament', { p_id: id ?? null, p_data: data }));
}

export async function setStatus(tournamentId, status) {
  check(await sb.rpc('set_tournament_status', { p_tournament_id: tournamentId, p_status: status }));
}

export async function addTeam(tournamentId, name, members) {
  return check(await sb.rpc('organizer_add_team', { p_tournament_id: tournamentId, p_name: name, p_members: members }));
}

export async function deleteTeam(teamId) {
  check(await sb.rpc('organizer_delete_team', { p_team_id: teamId }));
}

export async function saveTable(tournamentId, rows, autoPoints) {
  check(await sb.rpc('organizer_save_table', { p_tournament_id: tournamentId, p_rows: rows, p_auto_points: autoPoints }));
}

// What finishing a paid tournament pays out (amounts in cents), computed by the database.
export async function settlementPreview(tournamentId) {
  return check(await sb.rpc('settlement_preview', { p_tournament_id: tournamentId }));
}

export const finishTournament = (tournamentId) => callApi('finish-tournament', { tournament_id: tournamentId });

export const refundTeam = (teamId) => callApi('refund-team', { team_id: teamId });

// -------------------------------------------------------------- payments --

export async function listPayments({ tournamentId = null, limit = 200 } = {}) {
  let query = sb.from('payments').select('*').order('created_at', { ascending: false }).limit(limit);
  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  return check(await query);
}

export const paypalConfig = () => callApi('paypal-config');

export const paypalCreateOrder = (tournamentId, teamName, members, prizeEmail) =>
  callApi('paypal-create-order', { tournament_id: tournamentId, team_name: teamName, members, prize_email: prizeEmail });

export const paypalCapture = (orderId) => callApi('paypal-capture-order', { order_id: orderId });

// ------------------------------------------------------- wallets, payouts --

export async function walletEntries(wallet, limit = 500) {
  return check(await sb.from('wallet_entries').select('*').eq('wallet', wallet)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit));
}

export async function listPayouts({ tournamentId = null, kind = null, wallet = null, recipientId = null, limit = 200 } = {}) {
  let query = sb.from('payouts').select('*').order('created_at', { ascending: false }).order('id').limit(limit);
  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  if (kind) query = query.eq('kind', kind);
  if (wallet) query = query.eq('wallet', wallet);
  if (recipientId) query = query.eq('recipient_id', recipientId);
  return check(await query);
}

// Asks PayPal about payouts still on their way; returns how many changed.
export const refreshPayouts = async () => (await callApi('payouts-refresh')).updated ?? 0;

export const resendPayout = (payoutId) => callApi('payout-resend', { payout_id: payoutId });

export const withdraw = (wallet, amount, email) => callApi('wallet-withdraw', { wallet, amount, email });

// --------------------------------------------------------------- creator --

export async function adminUsers() {
  return check(await sb.rpc('admin_list_users'));
}

// Unsettled paid tournaments are refunded in full before they are deleted.
export const adminDeleteTournament = (tournamentId) => callApi('delete-tournament', { tournament_id: tournamentId });
