// TurniRUM backend actions that need the secret key: accounts, PayPal payments, prizes, wallets and refunds.
// Deployed with verify_jwt = false; actions that need a user check the access token themselves.
import type { User } from 'npm:@supabase/supabase-js@2.117.3';
import { claimCreator, register } from './account.ts';
import { CORS_HEADERS, json, readJson, userFromRequest } from './common.ts';
import { deleteTournament, finishTournament, refreshPayouts, refundTeam, resendPayout, withdraw } from './payouts.ts';
import { captureOrder, createOrder, publicConfig } from './paypal.ts';

// Actions that need a signed-in user.
const USER_ACTIONS: Record<string, (user: User, body: Record<string, unknown>) => Promise<Response>> = {
  'paypal-create-order': createOrder,
  'paypal-capture-order': captureOrder,
  'finish-tournament': finishTournament,
  'payout-resend': resendPayout,
  'payouts-refresh': refreshPayouts,
  'wallet-withdraw': withdraw,
  'refund-team': refundTeam,
  'delete-tournament': deleteTournament,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const body = await readJson(req);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  try {
    switch (body.action) {
      case 'register':
        return await register(body);
      case 'claim-creator':
        return await claimCreator(req, body);
      case 'paypal-config':
        return await publicConfig();
      default: {
        const action = String(body.action);
        if (!Object.hasOwn(USER_ACTIONS, action)) return json({ error: 'Unknown action.' }, 400);
        const user = await userFromRequest(req);
        if (!user) return json({ error: 'Please sign in first.' }, 401);
        return await USER_ACTIONS[action](user, body);
      }
    }
  } catch (error) {
    console.error(error);
    return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  }
});
