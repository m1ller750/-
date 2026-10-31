// Money going out: prizes when an organizer finishes a paid tournament and withdrawals from wallets (both with
// PayPal Payouts), plus refunds when an organizer removes a paid team or the creator deletes a tournament.
import type { User } from 'npm:@supabase/supabase-js@2.117.3';
import { admin, json, text } from './common.ts';
import { paypal, paypalConfig, requireConfigured, type PayPalConfig } from './paypal.ts';

interface Payout {
  id: number;
  kind: 'prize' | 'withdrawal';
  wallet: 'platform' | 'organizer';
  owner_id: string | null;
  tournament_title: string;
  place: number | null;
  receiver_email: string;
  amount: number | string;
  status: string;
  attempts: number;
  paypal_batch_id: string | null;
  failure_reason: string | null;
}

interface Payment {
  id: string;
  amount: number | string;
  paypal_capture_id: string | null;
}

// PayPal item states → our payout states. Anything that ends without the money arriving is "failed".
const ITEM_STATUS: Record<string, string> = {
  SUCCESS: 'paid', UNCLAIMED: 'unclaimed', PENDING: 'sent', ONHOLD: 'sent', NEW: 'sent',
  FAILED: 'failed', RETURNED: 'failed', BLOCKED: 'failed', REFUNDED: 'failed', REVERSED: 'failed', DENIED: 'failed',
};

const PAYPAL_REASONS: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'The platform PayPal balance is too low to send this money.',
  RECEIVER_UNREGISTERED: 'This email has no PayPal account.',
  RECEIVER_ACCOUNT_LOCKED: 'The receiving PayPal account is locked.',
};

async function roleOf(user: User): Promise<string | null> {
  const { data } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return data?.role ?? null;
}

function paypalReason(data: Record<string, unknown> | undefined, status: number): string {
  const name = String(data?.name ?? '');
  return PAYPAL_REASONS[name] ?? String(data?.message ?? (name || `PayPal error ${status}.`));
}

async function updatePayout(id: number, status: string, extra: Record<string, unknown> = {}): Promise<Payout> {
  const { data, error } = await admin.rpc('payout_update', { p_payout_id: id, p_status: status, ...extra });
  if (error) throw error;
  return data as Payout;
}

function payoutNote(p: Payout): string {
  return p.kind === 'prize'
    ? `Your prize for place ${p.place} in ${p.tournament_title} on TurniRUM`.slice(0, 4000)
    : 'Withdrawal from your TurniRUM wallet';
}

// Sends one payout as its own PayPal batch. The ids carry the attempt number: a request PayPal answered is
// never repeated, a request it did not answer is repeated with the same ids, so nobody is paid twice.
async function sendPayout(cfg: PayPalConfig, p: Payout): Promise<Payout> {
  const attempt = p.attempts + 1;
  const batchId = `turnirum-${p.id}-${attempt}`;
  let res: Awaited<ReturnType<typeof paypal>> | null = null;
  try {
    res = await paypal(cfg, '/v1/payments/payouts', {
      method: 'POST',
      requestId: batchId,
      body: {
        sender_batch_header: {
          sender_batch_id: batchId,
          email_subject: p.kind === 'prize' ? 'You won a prize on TurniRUM!' : 'Money from your TurniRUM wallet',
          email_message: payoutNote(p),
        },
        items: [{
          recipient_type: 'EMAIL',
          receiver: p.receiver_email,
          amount: { value: Number(p.amount).toFixed(2), currency: 'USD' },
          note: payoutNote(p),
          sender_item_id: String(p.id),
        }],
      },
    });
  } catch (error) {
    console.error('payout request failed', error);
  }
  const batch = res?.ok ? res.data?.batch_header?.payout_batch_id : null;
  if (batch) return await updatePayout(p.id, 'sent', { p_attempt: attempt, p_batch_id: batch });
  if (res && res.status >= 400 && res.status < 500) {
    // PayPal refused: a withdrawal goes straight back to its wallet, a prize waits for "Send again".
    return await updatePayout(p.id, p.kind === 'withdrawal' ? 'failed' : 'queued', {
      p_attempt: attempt, p_reason: paypalReason(res.data, res.status),
    });
  }
  return await updatePayout(p.id, 'queued', { p_reason: 'PayPal did not answer. Please send it again.' });
}

async function refreshPayout(cfg: PayPalConfig, p: Payout): Promise<Payout> {
  if (!p.paypal_batch_id) return p;
  const res = await paypal(cfg, `/v1/payments/payouts/${encodeURIComponent(p.paypal_batch_id)}`);
  if (!res.ok) return p;
  const item = res.data?.items?.[0];
  const batchStatus = res.data?.batch_header?.batch_status;
  let status = item ? ITEM_STATUS[item.transaction_status] : undefined;
  if (!status && (batchStatus === 'DENIED' || batchStatus === 'CANCELED')) status = 'failed';
  if (!status || status === p.status) return p;
  const reason = status === 'failed'
    ? PAYPAL_REASONS[item?.errors?.name] ?? item?.errors?.message ?? `PayPal: ${item?.transaction_status ?? batchStatus}.`
    : null;
  return await updatePayout(p.id, status, {
    p_item_id: item?.payout_item_id ?? null, p_reason: reason, p_fee: item?.payout_item_fee?.value ?? null,
  });
}

async function loadPayouts(ids: number[]): Promise<Payout[]> {
  if (!ids.length) return [];
  const { data, error } = await admin.from('payouts').select('*').in('id', ids).order('place');
  if (error) throw error;
  return data as Payout[];
}

// ------------------------------------------------------------------ prizes --

export async function finishTournament(user: User, body: Record<string, unknown>): Promise<Response> {
  const cfg = await paypalConfig();
  const notReady = requireConfigured(cfg);
  if (notReady) return notReady;
  const { data: settlement, error } = await admin.rpc('settle_tournament', {
    p_tournament_id: Number(body.tournament_id), p_user_id: user.id,
  });
  if (error) return json({ error: error.message }, 400);

  const payouts = [];
  for (const p of await loadPayouts(settlement.payout_ids ?? [])) payouts.push(await sendPayout(cfg, p));
  return json({ settlement, payouts });
}

// "Send again" for a prize PayPal did not accept yet, or a withdrawal PayPal did not answer.
export async function resendPayout(user: User, body: Record<string, unknown>): Promise<Response> {
  const cfg = await paypalConfig();
  const notReady = requireConfigured(cfg);
  if (notReady) return notReady;
  const [p] = await loadPayouts([Number(body.payout_id)]);
  const allowed = p && (p.owner_id === user.id || (await roleOf(user)) === 'creator');
  if (!allowed) return json({ error: 'Payout not found.' }, 404);
  if (p.status !== 'queued') return json({ payout: p });
  return json({ payout: await sendPayout(cfg, p) });
}

// Asks PayPal about payouts that are still on their way (called when a wallet or results page opens).
export async function refreshPayouts(user: User): Promise<Response> {
  const cfg = await paypalConfig();
  if (!cfg.clientId || !cfg.secret) return json({ updated: 0 });
  let query = admin.from('payouts').select('*').in('status', ['sent', 'unclaimed'])
    .order('updated_at', { ascending: true }).limit(20);
  if ((await roleOf(user)) !== 'creator') query = query.or(`owner_id.eq.${user.id},recipient_id.eq.${user.id}`);
  const { data, error } = await query;
  if (error) throw error;
  let updated = 0;
  for (const p of data as Payout[]) {
    const next = await refreshPayout(cfg, p);
    if (next.status !== p.status) updated += 1;
  }
  return json({ updated });
}

// ----------------------------------------------------------------- wallets --

export async function withdraw(user: User, body: Record<string, unknown>): Promise<Response> {
  const cfg = await paypalConfig();
  const notReady = requireConfigured(cfg);
  if (notReady) return notReady;
  const { data, error } = await admin.rpc('start_withdrawal', {
    p_user_id: user.id,
    p_wallet: body.wallet === 'platform' ? 'platform' : 'organizer',
    p_amount: Number(body.amount),
    p_email: text(body.email, 254),
  });
  if (error) return json({ error: error.message }, 400);
  const payout = await sendPayout(cfg, data as Payout);
  if (payout.status === 'failed') {
    return json({ error: `PayPal refused the withdrawal: ${payout.failure_reason} The money is back in the wallet.`, payout }, 409);
  }
  return json({ payout });
}

// ----------------------------------------------------------------- refunds --

async function refundPayment(cfg: PayPalConfig, payment: Payment): Promise<string | null> {
  try {
    const res = await paypal(cfg, `/v2/payments/captures/${encodeURIComponent(payment.paypal_capture_id ?? '')}/refund`, {
      method: 'POST', body: {}, requestId: `refund-${payment.id}`,
    });
    return res.ok ? null : paypalReason(res.data, res.status);
  } catch (error) {
    console.error('refund failed', error);
    return 'PayPal did not answer.';
  }
}

export async function refundTeam(user: User, body: Record<string, unknown>): Promise<Response> {
  const cfg = await paypalConfig();
  const notReady = requireConfigured(cfg);
  if (notReady) return notReady;
  const { data: payment, error } = await admin.rpc('refund_team_start', {
    p_team_id: Number(body.team_id), p_user_id: user.id,
  });
  if (error) return json({ error: error.message }, 400);
  const failure = await refundPayment(cfg, payment as Payment);
  const { error: finishError } = await admin.rpc('refund_team_finish', {
    p_payment_id: payment.id, p_refunded: !failure, p_reason: failure ? `Refund failed: ${failure}` : null,
  });
  if (finishError) throw finishError;
  if (failure) return json({ error: `PayPal could not refund the payment: ${failure}` }, 502);
  return json({ refunded: Number(payment.amount) });
}

// Paid tournaments that have not paid out their prizes are refunded in full before they are deleted.
export async function deleteTournament(user: User, body: Record<string, unknown>): Promise<Response> {
  const id = Number(body.tournament_id);
  const { data: before } = await admin.from('tournaments').select('status').eq('id', id).maybeSingle();
  const { data: payments, error } = await admin.rpc('delete_tournament_start', { p_tournament_id: id, p_user_id: user.id });
  if (error) return json({ error: error.message }, 400);

  const cfg = await paypalConfig();
  const failures: string[] = [];
  for (const payment of (payments ?? []) as Payment[]) {
    const failure = cfg.clientId && cfg.secret ? await refundPayment(cfg, payment) : 'PayPal is not configured.';
    await admin.rpc('refund_team_finish', {
      p_payment_id: payment.id, p_refunded: !failure,
      p_reason: failure ? `Refund failed: ${failure}` : 'Refunded: the tournament was deleted.',
    });
    if (failure) failures.push(failure);
  }
  if (failures.length) {
    if (before?.status) await admin.from('tournaments').update({ status: before.status }).eq('id', id);
    return json({ error: `${failures.length} PayPal refund(s) failed (${failures[0]}), so the tournament was kept.` }, 502);
  }
  const { error: deleteError } = await admin.from('tournaments').delete().eq('id', id);
  if (deleteError) throw deleteError;
  return json({ deleted: true, refunded: (payments ?? []).length });
}
