// Shared helpers for the TurniRUM `api` Edge Function.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.117.3';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const value = JSON.parse(keys)?.default;
      if (value) return value;
    } catch {
      // fall back to the legacy key below
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

// Bypasses RLS — only ever used on the server.
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export async function userFromRequest(req: Request): Promise<User | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sb_')) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function text(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
