import * as api from '../api.js';
import { PLATFORM_FEE } from '../config.js';
import { heldShares, toCents } from '../finance.js';
import {
  busy, centsToMoney, emptyState, formValues, formatDate, html, icon, kpi, money, showFieldErrors, toast,
} from '../ui.js';
import { bindResend, payoutsTable, withFreshPayouts } from './organizer.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INCOME = new Set(['platform_fee', 'organizer_income', 'unpaid_prize', 'prize_returned']);
const ENTRY_LABELS = {
  platform_fee: 'Platform fee', organizer_income: 'Tournament income', unpaid_prize: 'Prize to pay yourself',
  prize_returned: 'Prize came back', withdrawal: 'Withdrawal', withdrawal_returned: 'Withdrawal came back',
};

// The organizer's wallet, or the platform wallet for the creator: income from finished tournaments,
// withdrawals to PayPal and their history.
export async function walletView({ profile, reload }) {
  const platform = profile.role === 'creator';
  const wallet = platform ? 'platform' : 'organizer';
  const [payouts, tournaments, accountEmail] = await Promise.all([
    withFreshPayouts(() => api.listPayouts({ kind: 'withdrawal', wallet })),
    api.listTournaments(),
    api.currentUserEmail(),
  ]);
  const entries = await api.walletEntries(wallet);
  const balance = entries.reduce((sum, e) => sum + toCents(e.amount), 0);
  const held = heldShares(platform ? tournaments : tournaments.filter((t) => t.organizer_id === profile.id));
  const heldCents = platform ? held.platform : held.organizer;
  const earned = entries.filter((e) => INCOME.has(e.kind)).reduce((sum, e) => sum + toCents(e.amount), 0);
  const withdrawn = payouts.filter((p) => p.status !== 'failed').reduce((sum, p) => sum + toCents(p.amount), 0);
  const email = payouts[0]?.receiver_email ?? accountEmail;

  return {
    title: platform ? 'Platform wallet' : 'My wallet',
    html: html`
      <section class="container">
        <div class="page-head">
          <div>
            <span class="eyebrow ${platform ? 'eyebrow-gold' : ''}">${icon('wallet', 14)} Wallet</span>
            <h1>${platform ? 'Platform wallet' : 'My wallet'}</h1>
            <p class="muted">${platform
              ? `${PLATFORM_FEE}% of the entry fees of every finished paid tournament lands here.`
              : 'Your share of the entry fees lands here when you finish a paid tournament.'}</p>
          </div>
          ${platform ? '' : html`<a class="btn btn-ghost" href="#/organizer/business">${icon('pie', 16)} Business model</a>`}
        </div>

        <div class="card wallet-hero reveal">
          <div class="wallet-balance">
            <small>Available</small>
            <b>${centsToMoney(balance)}</b>
            <span>${icon('hourglass', 15)} ${centsToMoney(heldCents)} more when running tournaments finish</span>
          </div>
          <form class="wallet-form" novalidate data-withdraw>
            <h3>${icon('bank', 18)} Withdraw to PayPal</h3>
            <div class="form-row">
              <label class="field" data-field="amount">
                <span class="label">Amount, USD</span>
                <span class="input-icon">${icon('coins', 17)}<input class="input" type="number" name="amount" min="1" step="0.01" max="${(balance / 100).toFixed(2)}" value="${balance >= 100 ? (balance / 100).toFixed(2) : ''}" placeholder="0.00"></span>
              </label>
              <label class="field" data-field="email">
                <span class="label">PayPal email</span>
                <span class="input-icon">${icon('mail', 17)}<input class="input" type="email" name="email" maxlength="254" value="${email}" autocomplete="email"></span>
              </label>
            </div>
            <button class="btn btn-primary btn-block" type="submit" ${balance < 100 ? 'disabled' : ''}>${icon('arrow', 16)} Withdraw</button>
            <p class="muted small">${icon('info', 14)} The money arrives on this PayPal account within minutes. From PayPal you can move it to your bank card.</p>
          </form>
        </div>

        <div class="kpis kpis-4">
          ${kpi('wallet', 'Available', centsToMoney(balance), 'ready to withdraw', 'green')}
          ${kpi('hourglass', 'Held', centsToMoney(heldCents), 'in tournaments that are still running', 'amber')}
          ${kpi('coins', 'Earned', centsToMoney(earned), 'from finished tournaments', 'violet')}
          ${kpi('bank', 'Withdrawn', centsToMoney(withdrawn), 'sent to PayPal', 'cyan')}
        </div>

        <div class="card card-pad reveal">
          <div class="card-head"><h3 class="card-title">${icon('receipt', 18)} Withdrawals</h3></div>
          ${payouts.length ? payoutsTable(payouts, { resend: true })
            : emptyState('bank', 'No withdrawals yet', 'Withdraw your balance to PayPal with the form above.')}
        </div>

        <div class="card card-pad reveal">
          <div class="card-head"><h3 class="card-title">${icon('table', 18)} History</h3><span class="muted small">every change of the balance</span></div>
          ${entries.length ? html`
            <div class="table-wrap">
              <table class="standings">
                <thead><tr><th>Date</th><th>What</th><th>Details</th><th class="num">Amount</th></tr></thead>
                <tbody>
                  ${entries.map((e) => html`
                    <tr>
                      <td class="nowrap muted">${formatDate(e.created_at, { time: true, short: true })}</td>
                      <td><b>${ENTRY_LABELS[e.kind] ?? e.kind}</b>${e.tournament_title ? html`<small class="pay-note">${e.tournament_id ? html`<a class="link-plain" href="#/t/${e.tournament_id}">${e.tournament_title}</a>` : e.tournament_title}</small>` : ''}</td>
                      <td class="muted">${e.note}</td>
                      <td class="num nowrap"><b class="${toCents(e.amount) >= 0 ? 'money-in' : 'money-out'}">${toCents(e.amount) >= 0 ? '+' : '−'}${money(Math.abs(Number(e.amount)))}</b></td>
                    </tr>`)}
                </tbody>
              </table>
            </div>` : emptyState('wallet', 'The wallet is empty', platform
            ? 'The platform fee arrives when organizers finish their paid tournaments.'
            : 'Finish a paid tournament: prizes go to the winners and the rest of the entry fees comes here.')}
        </div>
      </section>`,

    mount(root) {
      bindResend(root, reload);
      const form = root.querySelector('[data-withdraw]');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = formValues(form);
        const cents = toCents(values.amount);
        const errors = {};
        if (cents < 100) errors.amount = 'The minimum withdrawal is $1.';
        else if (cents > balance) errors.amount = `You can withdraw at most ${centsToMoney(balance)}.`;
        if (!EMAIL_RE.test(values.email.trim())) errors.email = 'Enter the PayPal email that should receive the money.';
        showFieldErrors(form, errors);
        if (Object.keys(errors).length) return;
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            const { payout } = await api.withdraw(wallet, cents / 100, values.email.trim());
            toast(payout.status === 'queued'
              ? 'PayPal did not answer yet. Use “Send again” in the list below.'
              : `${money(payout.amount)} is on its way to ${payout.receiver_email}.`, payout.status === 'queued' ? 'warning' : 'success');
            reload();
          } catch (error) {
            toast(error.message, 'error');
            if (error.data?.payout) reload();
          }
        });
      });
    },
  };
}
