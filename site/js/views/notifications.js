// Notifications: reminders, schedule changes, invitations and prizes (the same ones go out by email).
import * as api from '../api.js';
import { emptyState, formatDate, html, icon } from '../ui.js';

const KIND_ICONS = { reminder: 'bell', match: 'clock', bracket: 'swords', reschedule: 'refresh', invite: 'users', prize: 'trophy' };

export async function notificationsView() {
  const list = await api.listNotifications();
  const unread = list.some((n) => !n.read_at);
  return {
    title: 'Notifications',
    html: html`
      <section class="container narrow">
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('bell', 14)} Inbox</span>
            <h1>Notifications</h1>
            <p class="muted">Tournament reminders, schedule changes, invitations and prizes. They are also sent to the email of your account.</p>
          </div>
        </div>
        ${list.length ? html`
          <ul class="notes">
            ${list.map((n) => html`
              <li class="card note ${n.read_at ? '' : 'is-unread'}">
                <span class="note-icon note-${n.kind}">${icon(KIND_ICONS[n.kind] ?? 'bell', 18)}</span>
                <div class="note-body">
                  <div class="note-head"><b>${n.title}</b><small class="muted">${formatDate(n.created_at, { time: true, short: true })}</small></div>
                  <p class="prewrap">${n.body}</p>
                  ${n.link ? html`<a class="btn btn-ghost btn-sm" href="#${n.link}">Open ${icon('arrow', 14)}</a>` : ''}
                </div>
              </li>`)}
          </ul>` : emptyState('bell', 'No notifications yet', 'Reminders before your tournaments, schedule changes and invitations will appear here.')}
      </section>`,
    async mount() {
      if (!unread) return;
      await api.markNotificationsRead().catch(() => {});
      window.dispatchEvent(new Event('turnirum:notifications'));
    },
  };
}
