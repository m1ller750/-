// TurniRUM business model. Every paid tournament's revenue is split three ways:
//   • PLATFORM_FEE % (10 %) goes to the platform creator's wallet,
//   • prize_percent % goes to the prize pool (the organizer picks 0–90 %), paid to the winners' PayPal,
//   • the rest goes to the organizer's wallet.
// Amounts are handled in cents so the parts always add up exactly; private.settlement_plan in the database
// uses the same rounding.
import { PLATFORM_FEE } from './config.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const toCents = (amount) => Math.round((Number(amount) || 0) * 100);

export function split(totalCents, prizePercent, platformPercent = PLATFORM_FEE) {
  const total = Math.max(0, Math.round(totalCents) || 0);
  const pp = clamp(Math.round(platformPercent), 0, 100);
  const pr = clamp(Math.round(prizePercent) || 0, 0, 100 - pp);
  const part = (percent) => Math.floor((total * percent + 50) / 100);
  const platform = part(pp);
  const prize = part(pr);
  return {
    total, prize, platform, organizer: total - platform - prize,
    prizePercent: pr, platformPercent: pp, organizerPercent: 100 - pp - pr,
  };
}

// Actual shares across several tournaments (each may use a different prize share).
export function sumSplits(splits) {
  const sum = { total: 0, prize: 0, platform: 0, organizer: 0 };
  for (const s of splits) {
    sum.total += s.total;
    sum.prize += s.prize;
    sum.platform += s.platform;
    sum.organizer += s.organizer;
  }
  if (!sum.total) return { ...sum, prizePercent: 0, platformPercent: 0, organizerPercent: 0 };
  const prizePercent = Math.round((sum.prize * 100) / sum.total);
  const platformPercent = Math.round((sum.platform * 100) / sum.total);
  return { ...sum, prizePercent, platformPercent, organizerPercent: 100 - prizePercent - platformPercent };
}

export function tournamentFinance(t) {
  const fee = t.is_paid ? toCents(t.entry_fee) : 0;
  return {
    fee,
    collected: split(t.is_paid ? toCents(t.collected) : 0, t.prize_percent),
    potential: split(fee * Math.max(t.max_teams, t.team_count), t.prize_percent),
  };
}

// Prize places are shares of the prize pool. Every place but the first is rounded down; the first place also
// gets the leftover cents.
export const PRIZE_PRESETS = { 1: [100], 2: [70, 30], 3: [50, 30, 20], 4: [40, 30, 20, 10], 5: [35, 25, 20, 12, 8] };

export const splitTotal = (prizeSplit) => prizeSplit.reduce((sum, pct) => sum + pct, 0);

export const splitOk = (prizeSplit) => prizeSplit.length >= 1 && prizeSplit.length <= 10
  && prizeSplit.every((pct) => Number.isInteger(pct) && pct >= 1 && pct <= 100) && splitTotal(prizeSplit) === 100;

export function prizeAmounts(prizeCents, prizeSplit) {
  const amounts = prizeSplit.map((pct, i) => (i ? Math.floor((prizeCents * pct) / 100) : 0));
  amounts[0] = prizeCents - amounts.reduce((sum, cents) => sum + cents, 0);
  return amounts;
}

// Money of tournaments that have not paid out yet: it reaches the wallets when the organizer finishes them.
export function heldShares(tournaments) {
  return sumSplits(tournaments.filter((t) => t.is_paid && !t.settled_at).map((t) => tournamentFinance(t).collected));
}
