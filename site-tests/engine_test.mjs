// Property tests for supabase/functions/api/engine.js: random tournaments of every format and size are played to
// the end and checked. Run with: node site-tests/engine_test.mjs
import {
  buildBracket, bracketStandings, formatsFor, moveMatch, reportResult, rescheduleOptions,
} from '../supabase/functions/api/engine.js';

let checks = 0;
const fail = (msg, extra) => { console.error('FAIL', msg, extra ?? ''); process.exit(1); };
const ok = (cond, msg, extra) => { checks += 1; if (!cond) fail(msg, extra); };

function rng(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

const START = '2030-05-01T15:00:00.000Z';
for (let n = 2; n <= 33; n++) {
  const ids = Array.from({ length: n }, (_, i) => 100 + i);
  const teams = ids.map((id) => ({ id, name: `Team ${id}` }));
  for (const format of formatsFor(n)) {
    for (let run = 0; run < 6; run++) {
      const rand = rng(n * 1000 + run * 17 + format.length);
      const settings = { parallel: 1 + Math.floor(rand() * 4), rounds_per_day: run % 2 ? 2 : 0, groups: 2 + Math.floor(rand() * 3), advance: 1 + Math.floor(rand() * 3) };
      const { matches, settings: s } = buildBracket(format, ids, settings, START, teams);
      const tag = `${format} n=${n} run=${run}`;

      // Nobody plays twice at the same time, and every match is after the ones it waits for.
      const slot = (s.match_minutes + s.break_minutes) * 60000;
      const timed = matches.filter((m) => m.status !== 'bye');
      ok(timed.every((m) => m.scheduled_at), `${tag}: every playable match has a time`);
      for (const m of timed) {
        for (const src of [m.source_a, m.source_b]) {
          const from = matches.find((x) => x.match_key === (src.winner ?? src.loser));
          if (from && from.status !== 'bye') ok(Date.parse(from.scheduled_at) + slot <= Date.parse(m.scheduled_at), `${tag}: ${m.match_key} after ${from.match_key}`);
        }
      }

      // Play everything with random scores.
      let guard = 0;
      while (matches.some((m) => m.status === 'scheduled')) {
        ok(guard++ < 2000, `${tag}: terminates`);
        const byPhase = new Map();
        for (const m of matches.filter((x) => x.status === 'scheduled')) {
          for (const id of [m.team_a, m.team_b]) {
            const key = `${m.phase}:${id}`;
            ok(!byPhase.has(key), `${tag}: team ${id} plays twice in phase ${m.phase}`);
            byPhase.set(key, true);
          }
        }
        const m = matches.filter((x) => x.status === 'scheduled').sort((a, b) => a.phase - b.phase)[0];
        let a = Math.floor(rand() * 4);
        let b = Math.floor(rand() * 4);
        if (a === b && m.stage !== 'league' && m.stage !== 'group') b = a + 1;
        reportResult(matches, m.match_key, a, b, teams);
      }
      ok(matches.every((m) => m.status === 'finished' || m.status === 'bye'), `${tag}: all matches done`, matches.filter((m) => m.status === 'pending').map((m) => m.match_key));

      const table = bracketStandings(matches, ids, s.places);
      const placed = table.filter((t) => t.final_place != null).map((t) => t.final_place).sort();
      if (format !== 'round_robin') {
        ok(placed.includes(1) && placed.includes(2), `${tag}: champion and runner-up known`, placed);
        ok(new Set(placed).size === placed.length, `${tag}: places are unique`, placed);
        const knockoutTeams = format === 'groups_playoffs' ? s.groups * s.advance : n;
        if (knockoutTeams >= 4 && (format === 'double_elimination' || s.third_place)) ok(placed.includes(3) && placed.includes(4), `${tag}: 3rd and 4th known`, placed);
      }
      if (format === 'double_elimination') {
        const champion = table.find((t) => t.final_place === 1);
        for (const t of table) ok(t.losses <= 2, `${tag}: nobody loses more than twice`, t);
        ok(champion.losses <= 1, `${tag}: champion lost at most once`, champion);
        for (const t of table) if (t !== champion && t.final_place !== 2) ok(t.losses === 2, `${tag}: eliminated teams lost twice`, t);
      }
      if (format === 'round_robin') {
        for (const t of table) ok(t.wins + t.draws + t.losses === n - 1, `${tag}: everyone plays everyone`, t);
      }
    }
  }
}

// Rescheduling keeps the order of the bracket.
{
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const { matches, settings: s } = buildBracket('single_elimination', ids, { parallel: 4 }, START);
  const first = matches.find((m) => m.match_key === 'W1-1');
  const options = rescheduleOptions(matches, 'W1-1', s, '2030-05-01T10:00:00.000Z');
  ok(options.length > 0, 'reschedule: options exist');
  ok(options.every((o) => Date.parse(o.scheduled_at) > Date.parse(first.scheduled_at)), 'reschedule: options are later');
  const late = options.find((o) => o.shifts) ?? options[options.length - 1];
  moveMatch(matches, 'W1-1', late.scheduled_at, s);
  const slot = (s.match_minutes + s.break_minutes) * 60000;
  for (const m of matches) {
    for (const src of [m.source_a, m.source_b]) {
      const from = matches.find((x) => x.match_key === (src.winner ?? src.loser));
      if (from && from.scheduled_at && m.scheduled_at) ok(Date.parse(from.scheduled_at) + slot <= Date.parse(m.scheduled_at), `reschedule keeps ${from.match_key} before ${m.match_key}`);
    }
  }
  // A result cannot change after later matches were played.
  reportResult(matches, 'W1-1', 2, 1); reportResult(matches, 'W1-2', 2, 1); reportResult(matches, 'W2-1', 2, 1);
  let threw = false;
  try { reportResult(matches, 'W1-1', 0, 3); } catch { threw = true; }
  ok(threw, 'locked results cannot change');
  threw = false;
  try { reportResult(matches, 'W1-3', 1, 1); } catch { threw = true; }
  ok(threw, 'knockout draws are refused');
}
console.log(`engine: ${checks} checks passed`);
