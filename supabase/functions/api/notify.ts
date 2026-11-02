// Notifications: rows shown in the site's bell, the same messages by email (Brevo), and the reminders that the
// pg_cron job asks for every 10 minutes.
import { admin, json, safeEqual, settings, utcTime } from './common.ts';
import { askJson } from './gemini.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Note {
  user_id: string;
  kind: 'reminder' | 'match' | 'bracket' | 'reschedule' | 'invite' | 'prize';
  title: string;
  body: string;
  link?: string | null;
  dedupe_key?: string | null;
}

// Stores notifications (a repeated dedupe_key is skipped) and tries to email them right away.
export async function notify(notes: Note[]): Promise<number> {
  if (!notes.length) return 0;
  const rows = notes.map((n) => ({ ...n, title: n.title.slice(0, 200), body: n.body.slice(0, 2000) }));
  const { data, error } = await admin.from('notifications')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
  if (error) {
    console.error('notify failed', error);
    return 0;
  }
  await sendPendingEmails(25).catch((e) => console.error('email failed', e));
  return data?.length ?? 0;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function emailHtml(name: string, title: string, body: string, url: string): string {
  const paragraphs = body.split(/\n+/).map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f3f1fb;font-family:Arial,Helvetica,sans-serif;color:#1d1b2e">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
<div style="background:linear-gradient(135deg,#8b5cf6,#22d3ee);border-radius:16px 16px 0 0;padding:20px 24px;color:#fff;font-size:22px;font-weight:800">TurniRUM</div>
<div style="background:#fff;border-radius:0 0 16px 16px;padding:24px;font-size:15px;line-height:1.55">
<p style="margin:0 0 14px">Hi ${escapeHtml(name)},</p>
<h2 style="margin:0 0 14px;font-size:19px">${escapeHtml(title)}</h2>${paragraphs}
<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:6px;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Open TurniRUM</a>
</div>
<p style="font-size:12px;color:#7a7690;text-align:center;margin-top:14px">You get this email because you play or organize tournaments on TurniRUM.</p>
</div></body></html>`;
}

interface PendingEmail { id: number; email: string; full_name: string; title: string; body: string; link: string | null }

// Sends waiting emails through Brevo. Without Brevo settings they wait (for up to two days) until it is set up.
export async function sendPendingEmails(limit = 40): Promise<{ sent: number; failed: number; configured: boolean }> {
  const cfg = await settings(['brevo_api_key', 'email_sender', 'email_sender_name', 'site_url']);
  if (!cfg.brevo_api_key || !cfg.email_sender) return { sent: 0, failed: 0, configured: false };
  const { data, error } = await admin.rpc('pending_emails', { p_limit: limit });
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  for (const row of (data ?? []) as PendingEmail[]) {
    // Claim the row first, so two runs never send the same email twice.
    const { data: claimed } = await admin.from('notifications').update({ email_status: 'sent' })
      .eq('id', row.id).eq('email_status', 'pending').select('id');
    if (!claimed?.length) continue;
    const url = `${cfg.site_url || ''}#${row.link || '/'}`;
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': cfg.brevo_api_key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: cfg.email_sender, name: cfg.email_sender_name || 'TurniRUM' },
          to: [{ email: row.email, name: row.full_name }],
          subject: row.title,
          htmlContent: emailHtml(row.full_name, row.title, row.body, url),
          textContent: `${row.title}\n\n${row.body}\n\n${url}`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
      sent += 1;
    } catch (e) {
      failed += 1;
      await admin.from('notifications').update({ email_status: 'failed', email_error: String(e).slice(0, 300) }).eq('id', row.id);
    }
  }
  return { sent, failed, configured: true };
}

interface Tournament {
  id: number; title: string; game: string; start_at: string; format: string; city: string; is_paid: boolean;
  entry_fee: number; prize_percent: number; reminder_text: string | null;
}

// One AI-written intro per tournament, reused for every player's reminder.
async function reminderIntro(t: Tournament): Promise<string> {
  try {
    const answer = await askJson<{ message: string }>(
      'You write short, warm reminder messages for players of tournaments on TurniRUM, an esports and sports tournament platform. English, 2 to 3 sentences, at most one emoji. Mention the tournament, the game and that it starts soon. Use only the facts given; do not invent prizes, places or rules.',
      {
        tournament: t.title, game: t.game, starts_utc: utcTime(t.start_at),
        where: t.format === 'offline' ? t.city : 'online',
        entry: t.is_paid ? `paid, ${t.prize_percent}% of the entry fees go to prizes` : 'free',
      },
      { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }, 0.7);
    if (answer.message?.trim()) return answer.message.trim().slice(0, 600);
  } catch (e) {
    console.warn('reminder text fallback', String(e));
  }
  return `${t.title} (${t.game}) starts on ${utcTime(t.start_at)}. Check your roster and be ready a little early. Good luck!`;
}

async function tournamentReminders(now: number): Promise<number> {
  const { data: tournaments } = await admin.from('tournaments')
    .select('id, title, game, start_at, format, city, is_paid, entry_fee, prize_percent, reminder_text')
    .in('status', ['registration', 'active']).is('settled_at', null)
    .gt('start_at', new Date(now).toISOString()).lte('start_at', new Date(now + DAY).toISOString());
  let created = 0;
  for (const t of (tournaments ?? []) as Tournament[]) {
    const { data: teams } = await admin.from('teams').select('id, name, captain_id')
      .eq('tournament_id', t.id).not('captain_id', 'is', null);
    if (!teams?.length) continue;
    const { data: matches } = await admin.from('matches').select('label, team_a, team_b, scheduled_at')
      .eq('tournament_id', t.id).eq('status', 'scheduled').order('scheduled_at');
    const soon = Date.parse(t.start_at) - now <= HOUR;
    const kind = soon ? '1h' : '24h';
    let intro = t.reminder_text;
    if (!intro) {
      intro = await reminderIntro(t);
      await admin.from('tournaments').update({ reminder_text: intro }).eq('id', t.id);
    }
    created += await notify(teams.map((team) => {
      const first = (matches ?? []).find((m) => m.team_a === team.id || m.team_b === team.id);
      return {
        user_id: team.captain_id,
        kind: 'reminder',
        title: soon ? `${t.title} starts within an hour` : `${t.title} starts in less than 24 hours`,
        body: `${intro}\n\nYour team: ${team.name}.${first ? ` Your first match (${first.label}) starts on ${utcTime(first.scheduled_at)}.` : ''}`,
        link: `/t/${t.id}`,
        dedupe_key: `t${t.id}:${kind}:${team.captain_id}`,
      };
    }));
  }
  return created;
}

async function matchReminders(now: number): Promise<number> {
  const { data: matches } = await admin.from('matches')
    .select('id, label, tournament_id, team_a, team_b, scheduled_at, tournaments(title)')
    .eq('status', 'scheduled').gt('scheduled_at', new Date(now).toISOString())
    .lte('scheduled_at', new Date(now + HOUR).toISOString());
  const notes: Note[] = [];
  for (const m of matches ?? []) {
    const { data: teams } = await admin.from('teams').select('id, name, captain_id').in('id', [m.team_a, m.team_b]);
    const name = (id: number) => teams?.find((t) => t.id === id)?.name ?? 'TBD';
    for (const team of teams ?? []) {
      if (!team.captain_id) continue;
      const title = (m.tournaments as unknown as { title: string } | null)?.title ?? 'your tournament';
      notes.push({
        user_id: team.captain_id,
        kind: 'match',
        title: `Your match starts soon: ${m.label}`,
        body: `${name(m.team_a)} vs ${name(m.team_b)} in ${title} starts on ${utcTime(m.scheduled_at)}.`,
        link: `/t/${m.tournament_id}`,
        dedupe_key: `m${m.id}:${m.scheduled_at}:${team.captain_id}`,
      });
    }
  }
  return notify(notes);
}

// Called by pg_cron with the shared secret from app_settings.
export async function cronTick(req: Request): Promise<Response> {
  const { cron_secret } = await settings(['cron_secret']);
  if (!cron_secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', cron_secret)) {
    return json({ error: 'Forbidden.' }, 403);
  }
  const now = Date.now();
  const reminders = await tournamentReminders(now);
  const matches = await matchReminders(now);
  const emails = await sendPendingEmails(60);
  return json({ reminders, matches, emails });
}
