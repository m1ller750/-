import * as api from '../api.js';
import { split, tournamentFinance } from '../finance.js';
import { gameStyle } from '../games.js';
import {
  busy, centsToMoney, confirmDialog, countdown, coverStyle, fillPercent, formValues, formatDate, gameTile, html, icon,
  isOpen, messagePage, money, notFound, plural, priceBadge, showFieldErrors, splitMembers, standings, standingsTable,
  statusBadge, toast,
} from '../ui.js';

function paymentLine(team) {
  if (team.payment_method === 'paypal') return html`<span class="pay-state pay-ok">${icon('check', 13)} Paid with PayPal · ${money(team.paid_amount)}</span>`;
  if (team.payment_method === 'manual') return html`<span class="pay-state pay-ok">${icon('check', 13)} Payment confirmed by the organizer</span>`;
  return html`<span class="pay-state pay-wait">${icon('hourglass', 13)} Entry fee not paid yet</span>`;
}

function sideActions(t, myTeam, profile) {
  if (myTeam) {
    return html`
      <div class="my-team-box">
        <span class="team-avatar" style="--h: ${myTeam.hue}">${myTeam.initials}</span>
        <div><small>Your team</small><b>${myTeam.name}</b>${t.is_paid ? paymentLine(myTeam) : ''}</div>
      </div>
      <a class="btn btn-ghost btn-block" href="#/player?id=${t.id}">${icon('table', 16)} Open in my tables</a>
      ${t.status === 'registration' && !myTeam.is_paid
        ? html`<button class="btn btn-danger btn-block" type="button" data-leave>${icon('door', 16)} Leave tournament</button>`
        : ''}`;
  }
  if (profile && profile.id === t.organizer_id) {
    return html`<a class="btn btn-primary btn-block" href="#/organizer?id=${t.id}">${icon('edit', 16)} Manage tournament</a>`;
  }
  if (profile?.role === 'creator') {
    return html`<a class="btn btn-ghost btn-block" href="#/creator/tournaments?q=${encodeURIComponent(t.title)}">${icon('shield', 16)} Open in the admin panel</a>`;
  }
  if (!isOpen(t)) {
    const reason = t.status === 'registration' ? 'All slots are taken.'
      : `Registration is closed — the tournament ${t.status === 'active' ? 'is live' : 'has finished'}.`;
    return html`<div class="hint">${icon('lock', 16)} <span>${reason}</span></div>`;
  }
  if (profile?.role === 'participant') {
    return html`<a class="btn btn-primary btn-lg btn-block" href="#/t/${t.id}/join">
      ${icon('swords', 18)} ${t.is_paid ? `Join · pay ${money(t.entry_fee)}` : 'Register your team'}</a>`;
  }
  if (profile) return html`<div class="hint">${icon('info', 16)} <span>Only player accounts can register teams.</span></div>`;
  return html`
    <a class="btn btn-primary btn-lg btn-block" href="#/login?next=${encodeURIComponent(`/t/${t.id}/join`)}">${icon('login', 18)} Sign in to join</a>
    <a class="btn btn-ghost btn-block" href="#/register?role=participant">Create a player account</a>`;
}

export async function tournamentView({ params, profile, navigate, reload }) {
  const id = Number(params.id);
  const t = Number.isInteger(id) ? await api.getTournament(id) : null;
  if (!t) return notFound();
  const teams = standings(await api.getTeams(id));
  const myTeam = profile?.role === 'participant' ? teams.find((team) => team.captain_id === profile.id) ?? null : null;
  const fin = tournamentFinance(t);

  return {
    title: t.title,
    html: html`
      <section class="container">
        <a class="back-link" href="#/tournaments">${icon('back', 16)} All tournaments</a>
        <div class="t-hero card" style="${coverStyle(t)}">
          <div class="t-hero-bg"><span>${gameStyle(t.game).abbr}</span></div>
          <div class="t-hero-content">
            <div class="t-hero-badges">${statusBadge(t)}${priceBadge(t)}<span class="badge badge-glass">${icon('gamepad', 13)}${t.game}</span></div>
            <h1>${t.title}</h1>
            <div class="t-hero-meta">
              <span>${icon('calendar', 16)} ${formatDate(t.start_at, { time: true })} <em>· ${countdown(t.start_at)}</em></span>
              <span>${t.format === 'offline' ? html`${icon('pin', 16)} ${t.city}` : html`${icon('globe', 16)} Online`}</span>
              <span>${icon('users', 16)} ${plural(t.team_size, 'player', 'players')} per team</span>
              <span>${icon('user', 16)} ${t.organizer_name}</span>
            </div>
          </div>
        </div>

        <div class="detail-grid">
          <div class="detail-main">
            ${t.description ? html`
              <div class="card card-pad reveal">
                <h3 class="card-title">${icon('info', 18)} About</h3>
                <p class="prewrap">${t.description}</p>
              </div>` : ''}
            <div class="card card-pad reveal" id="table">
              <div class="card-head">
                <h3 class="card-title">${icon('table', 18)} Standings</h3>
                <span class="muted small">${plural(teams.length, 'team', 'teams')}</span>
              </div>
              ${standingsTable(teams, myTeam?.id)}
            </div>
          </div>

          <aside class="detail-side">
            <div class="card card-pad side-sticky reveal">
              ${t.is_paid ? html`
                <div class="prize-box">
                  <small>Prize pool when full</small>
                  <b>${centsToMoney(fin.potential.prize)}</b>
                  <span>Collected so far: ${centsToMoney(fin.collected.prize)}</span>
                </div>` : html`
                <div class="prize-box prize-box-free">
                  <small>Entry</small><b>Free</b>
                  ${t.prize_note ? html`<span>${icon('gift', 14)} ${t.prize_note}</span>` : ''}
                </div>`}
              <dl class="facts">
                ${t.is_paid ? html`
                  <div><dt>Entry fee per team</dt><dd>${money(t.entry_fee)}</dd></div>
                  <div><dt>Goes to prizes</dt><dd>${t.prize_percent}% of fees</dd></div>
                  <div><dt>Payment</dt><dd class="paypal-word">PayPal</dd></div>` : ''}
                <div><dt>Slots left</dt><dd>${Math.max(0, t.max_teams - t.team_count)} of ${t.max_teams}</dd></div>
                <div><dt>Starts</dt><dd>${formatDate(t.start_at, { time: true, short: true })}</dd></div>
              </dl>
              <div class="progress progress-lg"><span style="width: ${fillPercent(t)}%"></span></div>
              <div class="side-actions">${sideActions(t, myTeam, profile)}</div>
            </div>
          </aside>
        </div>
      </section>`,
    mount(root) {
      root.querySelector('[data-leave]')?.addEventListener('click', async (event) => {
        const ok = await confirmDialog({ title: 'Leave the tournament?', text: `Team “${myTeam.name}” will be removed from the tournament.`, ok: 'Leave' });
        if (!ok) return;
        await busy(event.currentTarget, async () => {
          try {
            await api.leaveTournament(t.id);
            toast(`Team “${myTeam.name}” has left the tournament.`, 'info');
            reload();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });
      if (location.hash.includes('#table')) navigate(`/t/${t.id}`, { replace: true });
    },
  };
}

// ------------------------------------------------------------------ join --

let paypalSdk = null;

function loadPayPal(clientId) {
  if (!paypalSdk) {
    paypalSdk = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({
        'client-id': clientId, currency: 'USD', intent: 'capture', components: 'buttons',
        'enable-funding': 'card', 'disable-funding': 'paylater,venmo',
      });
      script.src = `https://www.paypal.com/sdk/js?${params}`;
      script.onload = () => (window.paypal?.Buttons ? resolve(window.paypal) : reject(new Error('PayPal failed to load.')));
      script.onerror = () => { paypalSdk = null; reject(new Error('Could not load PayPal. Check your connection or ad blocker.')); };
      document.head.append(script);
    });
  }
  return paypalSdk;
}

function validateTeam(form, t) {
  const values = formValues(form);
  const name = values.name.trim();
  const members = splitMembers(values.members);
  const errors = {};
  if (name.length < 2 || name.length > 40) errors.name = 'Team name must be 2–40 characters long.';
  if (!members.length) errors.members = 'Add at least one player.';
  else if (members.length > t.team_size) errors.members = `A team can have at most ${t.team_size} players.`;
  return { name, members, errors, ok: !Object.keys(errors).length };
}

export async function joinView({ params, profile, navigate }) {
  const id = Number(params.id);
  if (!profile) return { redirect: `/login?next=${encodeURIComponent(`/t/${id}/join`)}` };
  if (profile.role !== 'participant') return messagePage(403, 'Players only', 'Only player accounts can register teams.');
  const t = Number.isInteger(id) ? await api.getTournament(id) : null;
  if (!t) return notFound();
  const teams = await api.getTeams(id);
  if (teams.some((team) => team.captain_id === profile.id)) {
    toast('You have already registered a team for this tournament.', 'info');
    return { redirect: `/t/${id}` };
  }
  if (!isOpen(t)) {
    toast(t.status === 'registration' ? 'All slots are taken.' : 'Registration is closed.', 'warning');
    return { redirect: `/t/${id}` };
  }

  let paypalCfg = { enabled: false };
  let pending = [];
  if (t.is_paid) {
    const [cfg, payments] = await Promise.all([
      api.paypalConfig().catch(() => ({ enabled: false })),
      api.listPayments({ tournamentId: id }).catch(() => []),
    ]);
    paypalCfg = cfg;
    pending = payments.filter((p) => p.user_id === profile.id && p.status === 'created' && p.paypal_order_id);
  }
  const s = split(tournamentFinance(t).fee, t.prize_percent);
  const slotsLeft = t.max_teams - t.team_count;

  return {
    title: `Register a team · ${t.title}`,
    html: html`
      <section class="container narrow">
        <a class="back-link" href="#/t/${t.id}">${icon('back', 16)} ${t.title}</a>
        <div class="page-head">
          <div>
            <span class="eyebrow">${icon('swords', 14)} Team registration</span>
            <h1>${t.title}</h1>
            <p class="muted">${t.game} · ${formatDate(t.start_at, { time: true })} · ${plural(slotsLeft, 'slot', 'slots')} left</p>
          </div>
          ${gameTile(t, 'lg')}
        </div>

        ${pending.length ? html`
          <div class="card card-pad notice notice-warn">
            ${icon('hourglass', 20)}
            <div>
              <b>You have an unfinished PayPal payment</b>
              <p>If you already approved it in PayPal, verify it now — your team will be admitted right away.</p>
              ${pending.map((p) => html`
                <button class="btn btn-ghost btn-sm" type="button" data-verify="${p.paypal_order_id}">
                  ${icon('refresh', 15)} Verify payment for “${p.team_name}” · ${formatDate(p.created_at, { time: true, short: true })}
                </button>`)}
            </div>
          </div>` : ''}

        <form class="join-grid" novalidate data-join>
          <div class="card card-pad">
            <div class="step-title"><span class="step-n">1</span><h3>Your team</h3></div>
            <label class="field" data-field="name">
              <span class="label">Team name</span>
              <span class="input-icon">${icon('flag', 17)}<input class="input" name="name" maxlength="40" placeholder="Steppe Wolves" autocomplete="off" required autofocus></span>
            </label>
            <label class="field" data-field="members">
              <span class="label">Roster — up to ${plural(t.team_size, 'player', 'players')}, one per line</span>
              <textarea class="textarea" name="members" rows="${Math.max(t.team_size, 3)}" placeholder="Captain's nickname&#10;Player 2">${profile.full_name}</textarea>
            </label>
          </div>

          ${t.is_paid ? html`
            <div class="card card-pad">
              <div class="step-title"><span class="step-n">2</span><h3>Pay the entry fee</h3></div>
              <div class="pay-layout">
                <div class="paypal-panel">
                  <div class="paypal-amount"><small>Entry fee</small><b>${money(t.entry_fee)}</b><span>Secure checkout with PayPal</span></div>
                  ${paypalCfg.enabled ? html`
                    <div class="paypal-buttons" data-paypal><div class="paypal-loading"><span class="spinner"></span> Loading PayPal…</div></div>
                    <p class="muted small">${icon('shield', 14)} The payment is verified on our server and your team is admitted instantly.
                      ${paypalCfg.env === 'sandbox' ? html`<br><b>Sandbox mode:</b> use a PayPal sandbox test account — no real money is charged.` : ''}</p>`
                    : html`<div class="hint">${icon('info', 16)} <span>Online payments are being set up. Please check back soon.</span></div>`}
                  <div class="pay-status" data-pay-status hidden></div>
                </div>
                <div class="pay-split">
                  <small>Where your entry fee goes</small>
                  <div class="stack-bar">
                    <span class="seg-prize" style="flex: ${s.prizePercent}" title="Prize pool"></span>
                    <span class="seg-org" style="flex: ${s.organizerPercent}" title="Organizer"></span>
                    <span class="seg-platform" style="flex: ${s.platformPercent}" title="Platform"></span>
                  </div>
                  <ul class="legend legend-compact">
                    <li><i class="sw sw-prize"></i><span>Prize pool</span><em>${s.prizePercent}%</em><b>${centsToMoney(s.prize)}</b></li>
                    <li><i class="sw sw-org"></i><span>Organizer</span><em>${s.organizerPercent}%</em><b>${centsToMoney(s.organizer)}</b></li>
                    <li><i class="sw sw-platform"></i><span>Platform</span><em>${s.platformPercent}%</em><b>${centsToMoney(s.platform)}</b></li>
                  </ul>
                </div>
              </div>
            </div>` : html`
            <div class="join-submit">
              <button class="btn btn-primary btn-lg" type="submit">${icon('check', 18)} Register team</button>
              <a class="btn btn-ghost btn-lg" href="#/t/${t.id}">Cancel</a>
            </div>`}
        </form>
      </section>`,

    mount(root) {
      const form = root.querySelector('[data-join]');
      const status = root.querySelector('[data-pay-status]');
      const setStatus = (kind, message) => {
        if (!status) return;
        status.hidden = !message;
        status.className = `pay-status pay-status-${kind}`;
        status.innerHTML = message ? html`${icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'hourglass', 16)} <span>${message}</span>`.toString() : '';
      };
      const admitted = (teamName) => {
        toast(`Payment verified — “${teamName}” is in the tournament!`, 'success');
        navigate(`/t/${t.id}`);
      };

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (t.is_paid) return;
        const team = validateTeam(form, t);
        showFieldErrors(form, team.errors);
        if (!team.ok) return;
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            await api.joinFree(t.id, team.name, team.members);
            toast(`Team “${team.name}” is registered. Good luck!`, 'success');
            navigate(`/t/${t.id}`);
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      root.querySelectorAll('[data-verify]').forEach((button) => button.addEventListener('click', () => busy(button, async () => {
        try {
          const result = await api.paypalCapture(button.dataset.verify);
          if (result.status === 'completed') admitted('Your team');
          else toast(result.error || 'PayPal has not confirmed this payment yet.', 'warning');
        } catch (error) {
          toast(error.message, 'error');
        }
      })));

      const holder = root.querySelector('[data-paypal]');
      if (!holder) return;
      loadPayPal(paypalCfg.clientId).then((paypal) => {
        holder.innerHTML = '';
        let team = null;
        paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: 46 },
          onClick: (_data, actions) => {
            team = validateTeam(form, t);
            showFieldErrors(form, team.errors);
            setStatus('', '');
            return team.ok ? actions.resolve() : actions.reject();
          },
          createOrder: async () => {
            try {
              const order = await api.paypalCreateOrder(t.id, team.name, team.members);
              return order.orderId;
            } catch (error) {
              setStatus('error', error.message);
              throw error;
            }
          },
          onApprove: async (data, actions) => {
            setStatus('wait', 'Verifying your payment with PayPal…');
            try {
              const result = await api.paypalCapture(data.orderID);
              if (result.status === 'completed') {
                setStatus('ok', 'Payment verified! Your team is in.');
                admitted(team.name);
              } else {
                setStatus('wait', result.error || 'PayPal is still reviewing the payment.');
              }
            } catch (error) {
              if (error.data?.retry) {
                setStatus('error', error.message);
                return actions.restart();
              }
              setStatus('error', error.message);
            }
            return undefined;
          },
          onCancel: () => setStatus('wait', 'Payment cancelled — your team is not registered yet.'),
          onError: (error) => {
            console.error(error);
            if (!status || status.hidden) setStatus('error', 'PayPal could not process the payment. Please try again.');
          },
        }).render(holder);
      }).catch((error) => {
        holder.innerHTML = html`<div class="hint">${icon('alert', 16)} <span>${error.message}</span></div>`.toString();
      });
    },
  };
}
