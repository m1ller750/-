// PayPal Checkout: the server creates the order with the real entry fee, captures it after the buyer
// approves, checks the captured amount, and only then admits the team. Failed admissions are refunded.
import type { User } from 'npm:@supabase/supabase-js@2.117.3';
import { admin, json, text } from './common.ts';

export interface PayPalConfig {
  env: 'sandbox' | 'live';
  api: string;
  clientId: string | null;
  secret: string | null;
}

interface Payment {
  id: string;
  tournament_id: number | null;
  tournament_title: string;
  user_id: string | null;
  team_id: number | null;
  amount: number | string;
  status: string;
  failure_reason: string | null;
}

// Credentials come from the Edge Function secrets; if those are not set, from app_settings
// (a table only the secret key can read), so they can also be stored with SQL.
export async function paypalConfig(): Promise<PayPalConfig> {
  let clientId = Deno.env.get('PAYPAL_CLIENT_ID')?.trim() || null;
  let secret = Deno.env.get('PAYPAL_CLIENT_SECRET')?.trim() || null;
  let envName = Deno.env.get('PAYPAL_ENV')?.trim() || '';
  if (!clientId || !secret) {
    const { data, error } = await admin.from('app_settings').select('key, value')
      .in('key', ['paypal_client_id', 'paypal_client_secret', 'paypal_env']);
    if (error) console.error('app_settings read failed', error);
    const stored = Object.fromEntries((data ?? []).map((row) => [row.key, String(row.value ?? '').trim()]));
    clientId = stored.paypal_client_id || null;
    secret = stored.paypal_client_secret || null;
    envName ||= stored.paypal_env ?? '';
  }
  const env = envName.toLowerCase() === 'live' ? 'live' : 'sandbox';
  return {
    env,
    api: env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    clientId,
    secret,
  };
}

export async function publicConfig(): Promise<Response> {
  const cfg = await paypalConfig();
  return json({ enabled: Boolean(cfg.clientId && cfg.secret), clientId: cfg.clientId, currency: 'USD', env: cfg.env });
}

let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null;

async function accessToken(cfg: PayPalConfig): Promise<string> {
  if (cachedToken && cachedToken.clientId === cfg.clientId && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const res = await fetch(`${cfg.api}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    console.error('PayPal auth failed', res.status, data);
    throw new Error('PayPal rejected the API credentials.');
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 300) * 1000, clientId: cfg.clientId! };
  return cachedToken.value;
}

export async function paypal(cfg: PayPalConfig, path: string, options: { method?: string; body?: unknown; requestId?: string } = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken(cfg)}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  if (options.requestId) headers['PayPal-Request-Id'] = options.requestId;
  const res = await fetch(`${cfg.api}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('PayPal error', path, res.status, JSON.stringify(data));
  return { ok: res.ok, status: res.status, data };
}

async function updatePayment(id: string, values: Record<string, unknown>) {
  const { error } = await admin.from('payments').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error('payment update failed', error);
}

async function refund(cfg: PayPalConfig, payment: Payment, captureId: string, reason: string): Promise<boolean> {
  const res = await paypal(cfg, `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    body: {},
    requestId: `refund-${payment.id}`,
  });
  await updatePayment(payment.id, {
    status: res.ok ? 'refunded' : 'failed',
    paypal_capture_id: captureId,
    failure_reason: res.ok ? reason : `${reason} Automatic refund failed — refund it in PayPal.`,
  });
  return res.ok;
}

export function requireConfigured(cfg: PayPalConfig): Response | null {
  return cfg.clientId && cfg.secret ? null : json({ error: 'PayPal payments are not configured yet.' }, 503);
}

export async function createOrder(user: User, body: Record<string, unknown>): Promise<Response> {
  const cfg = await paypalConfig();
  const notReady = requireConfigured(cfg);
  if (notReady) return notReady;

  const tournamentId = Number(body.tournament_id);
  const members = Array.isArray(body.members) ? body.members.slice(0, 12).map((m) => text(m, 40)) : [];
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) return json({ error: 'Tournament not found.' }, 404);

  // Check the credentials before anything is recorded, so bad keys leave no pending payments behind.
  try {
    await accessToken(cfg);
  } catch {
    return json({ error: 'PayPal is not available right now. Please try again later.' }, 503);
  }

  // Validates everything (slots, duplicates, roster size, role) and stores the pending payment.
  const { data: payment, error } = await admin.rpc('paypal_start_payment', {
    p_user_id: user.id,
    p_tournament_id: tournamentId,
    p_name: text(body.team_name, 60),
    p_members: members,
    p_prize_email: text(body.prize_email, 254) || null,
  });
  if (error || !payment) return json({ error: error?.message ?? 'Could not start the payment.' }, 400);

  const amount = Number(payment.amount).toFixed(2);
  const order = await paypal(cfg, '/v2/checkout/orders', {
    method: 'POST',
    requestId: payment.id,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `tournament-${tournamentId}`,
        custom_id: payment.id,
        description: `TurniRUM entry fee: ${payment.tournament_title}`.slice(0, 127),
        amount: { currency_code: 'USD', value: amount },
      }],
      application_context: { brand_name: 'TurniRUM', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
    },
  });
  if (!order.ok || !order.data?.id) {
    await updatePayment(payment.id, { status: 'failed', failure_reason: `Order creation failed (${order.status}).` });
    return json({ error: 'PayPal could not create the order. Please try again.' }, 502);
  }
  await updatePayment(payment.id, { paypal_order_id: order.data.id });
  return json({ orderId: order.data.id, amount, currency: 'USD' });
}

export async function captureOrder(user: User, body: Record<string, unknown>): Promise<Response> {
  const cfg = await paypalConfig();
  const notReady = requireConfigured(cfg);
  if (notReady) return notReady;

  const orderId = text(body.order_id, 64);
  if (!/^[A-Z0-9-]{5,64}$/i.test(orderId)) return json({ error: 'Unknown PayPal order.' }, 400);

  const { data: payment, error } = await admin.from('payments').select('*').eq('paypal_order_id', orderId).maybeSingle<Payment>();
  if (error) throw error;
  if (!payment || payment.user_id !== user.id) return json({ error: 'Payment not found.' }, 404);
  if (payment.status === 'completed') {
    return json({ status: 'completed', teamId: payment.team_id, tournamentId: payment.tournament_id });
  }
  if (payment.status === 'refunded') {
    return json({ status: 'refunded', error: `${payment.failure_reason ?? 'This payment was refunded.'}` }, 409);
  }

  let result = await paypal(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    body: {},
    requestId: `capture-${payment.id}`,
  });
  if (!result.ok) {
    const issue = result.data?.details?.[0]?.issue;
    if (issue === 'ORDER_ALREADY_CAPTURED') {
      result = await paypal(cfg, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    } else if (issue === 'ORDER_NOT_APPROVED') {
      return json({ error: 'The payment has not been approved in PayPal yet.' }, 402);
    } else if (issue === 'INSTRUMENT_DECLINED') {
      return json({ error: 'PayPal declined this payment method. Please try another one.', retry: true }, 402);
    } else {
      await updatePayment(payment.id, { status: 'failed', failure_reason: `Capture failed (${issue ?? result.status}).` });
      return json({ error: 'PayPal could not complete the payment.' }, 502);
    }
  }

  const order = result.data ?? {};
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const payerEmail = order.payer?.email_address ?? null;
  const payerName = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(' ') || null;

  if (!capture) {
    await updatePayment(payment.id, { status: 'failed', failure_reason: 'PayPal returned no capture.' });
    return json({ error: 'PayPal did not confirm the payment.' }, 502);
  }
  if (capture.status === 'PENDING') {
    await updatePayment(payment.id, { status: 'pending', paypal_capture_id: capture.id, payer_email: payerEmail, payer_name: payerName });
    return json({ status: 'pending', error: 'PayPal is still reviewing this payment. Your team will be admitted once it clears.' }, 202);
  }
  if (capture.status !== 'COMPLETED' || order.status !== 'COMPLETED') {
    await updatePayment(payment.id, { status: 'failed', failure_reason: `Capture status ${capture.status}.` });
    return json({ error: 'PayPal did not complete the payment.' }, 402);
  }

  // Never trust the browser: compare what PayPal actually captured with the stored entry fee.
  const expected = Number(payment.amount).toFixed(2);
  const sameAmount = capture.amount?.currency_code === 'USD' && Number(capture.amount?.value).toFixed(2) === expected;
  const sameOrder = (capture.custom_id ?? unit?.custom_id) === payment.id;
  if (!sameAmount || !sameOrder) {
    await refund(cfg, payment, capture.id, 'The captured amount did not match the entry fee.');
    return json({ status: 'refunded', error: 'The payment did not match the entry fee, so it was refunded.' }, 409);
  }

  const { data: teamId, error: admitError } = await admin.rpc('paypal_admit_team', {
    p_payment_id: payment.id,
    p_capture_id: capture.id,
    p_payer_email: payerEmail,
    p_payer_name: payerName,
  });
  if (admitError) {
    const refunded = await refund(cfg, payment, capture.id, admitError.message);
    return json({
      status: refunded ? 'refunded' : 'failed',
      error: refunded
        ? `${admitError.message} Your payment was refunded automatically.`
        : `${admitError.message} Please contact the organizer about a refund.`,
    }, 409);
  }
  const fee = capture.seller_receivable_breakdown?.paypal_fee?.value;
  if (fee !== undefined) await updatePayment(payment.id, { paypal_fee: Number(fee) });
  return json({ status: 'completed', teamId, tournamentId: payment.tournament_id });
}
