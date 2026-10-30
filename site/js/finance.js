// TurniRUM business model. Every paid tournament's revenue is split three ways:
//   • PLATFORM_FEE % (10 %) goes to the platform creator,
//   • prize_percent % goes to the prize pool (the organizer picks 0–90 %),
//   • the rest is the organizer's income.
// Amounts are handled in cents so the parts always add up exactly.
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
