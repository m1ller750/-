// TurniRUM backend actions that need the secret key: accounts and PayPal payments.
// Deployed with verify_jwt = false; actions that need a user check the access token themselves.
import { claimCreator, register } from './account.ts';
import { CORS_HEADERS, json, readJson, userFromRequest } from './common.ts';
import { captureOrder, createOrder, publicConfig } from './paypal.ts';

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
        return publicConfig();
      case 'paypal-create-order':
      case 'paypal-capture-order': {
        const user = await userFromRequest(req);
        if (!user) return json({ error: 'Please sign in first.' }, 401);
        return body.action === 'paypal-create-order' ? await createOrder(user, body) : await captureOrder(user, body);
      }
      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  } catch (error) {
    console.error(error);
    return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  }
});
