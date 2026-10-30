// Registration and the "platform creator" password.
import { admin, json, safeEqual, sha256Hex, text, userFromRequest } from './common.ts';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function creatorPasswordHash(): Promise<string | null> {
  const { data, error } = await admin.from('app_settings').select('value')
    .eq('key', 'creator_password_sha256').maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function isCreatorDigest(digest: string): Promise<boolean> {
  const expected = await creatorPasswordHash();
  return Boolean(expected) && /^[0-9a-f]{64}$/.test(digest) && safeEqual(digest, expected!);
}

// Accounts are created on the server so nobody has to confirm an email address first.
export async function register(body: Record<string, unknown>): Promise<Response> {
  const email = text(body.email, 254).toLowerCase();
  const password = String(body.password ?? '');
  const username = text(body.username, 32);
  const fullName = text(body.full_name, 60);
  const role = body.role === 'organizer' ? 'organizer' : 'participant';

  const fields: Record<string, string> = {};
  if (!USERNAME_RE.test(username)) fields.username = 'Use 3–32 characters: letters, digits, “_”, “.” or “-”.';
  if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
  if (fullName.length < 2) fields.full_name = 'Enter your name or team name (2–60 characters).';
  if (password.length < 6 || password.length > 72) fields.password = 'Use 6–72 characters.';
  if (!fields.username) {
    const { data } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (data) fields.username = 'This username is already taken.';
  }
  if (Object.keys(fields).length) return json({ error: 'Please fix the highlighted fields.', fields }, 400);

  const finalRole = await isCreatorDigest(await sha256Hex(password)) ? 'creator' : role;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
  });
  if (createError || !created.user) {
    const message = (createError?.message ?? '').toLowerCase();
    if (createError?.code === 'email_exists' || message.includes('already')) {
      return json({ error: 'Please fix the highlighted fields.', fields: { email: 'An account with this email already exists.' } }, 400);
    }
    if (createError?.code === 'weak_password' || message.includes('password')) {
      return json({ error: 'Please fix the highlighted fields.', fields: { password: createError?.message ?? 'Password is too weak.' } }, 400);
    }
    throw createError;
  }

  const { error: profileError } = await admin.from('profiles')
    .insert({ id: created.user.id, username, full_name: fullName, role: finalRole });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (profileError.code === '23505') {
      return json({ error: 'Please fix the highlighted fields.', fields: { username: 'This username is already taken.' } }, 400);
    }
    throw profileError;
  }
  return json({ ok: true, role: finalRole });
}

// Called right after sign-in with the SHA-256 of the password the user typed.
export async function claimCreator(req: Request, body: Record<string, unknown>): Promise<Response> {
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!await isCreatorDigest(text(body.password_sha256, 64).toLowerCase())) return json({ creator: false });
  const { error } = await admin.from('profiles').update({ role: 'creator' }).eq('id', user.id);
  if (error) throw error;
  return json({ creator: true });
}
