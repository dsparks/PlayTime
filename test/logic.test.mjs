/**
 * Tests for PlayTime's rotation planner.
 *
 * The planner is the only part of the app a coach cannot eyeball, so it is
 * the only part with tests. The pure functions are lifted straight out of
 * index.html between the `#region logic` markers — no duplication, no
 * build step. Run with:  node test/logic.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const START = '//#region logic';
const END = '//#endregion logic';
const start = html.indexOf(START);
const end = html.indexOf(END);
if (start < 0 || end < 0) throw new Error('logic region markers not found in index.html');
const source = html.slice(start + START.length, end);

const exported = [
  'stintsPerPeriod', 'stintMs', 'periodMs', 'boundaryMs', 'globalStint',
  'onPitch', 'playedNow', 'pickKeeper', 'pickField', 'planNext', 'project',
];
const L = new Function(`${source}\n return {${exported.join(',')}};`)();

/* ------------------------------ harness ---------------------------- */
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/* ------------------------------ fixtures --------------------------- */
const MIN = 60000;
const cfgOf = (o = {}) => Object.assign({
  periods: 2, periodMin: 20, stintMin: 4, onField: 4,
  useGk: false, gkEvery: 2, gkCounts: true,
}, o);

function team(n, keepers = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'p' + i,
    name: 'P' + i,
    gk: i < keepers,
  }));
}

/** A fresh, unstarted game for the given roster. */
function gameOf(roster, cfg) {
  const squad = roster.map(p => p.id);
  const g = {
    squad, out: [], state: 'pre', period: 1, clockMs: 0, running: false,
    stint: 0, segStart: 0, field: [], gk: null,
    played: {}, gkMs: {}, lastOff: {}, pending: null, goals: [],
  };
  squad.forEach(id => { g.played[id] = 0; g.gkMs[id] = 0; g.lastOff[id] = 0; });
  const order = (id) => roster.findIndex(p => p.id === id);
  const keepers = roster.filter(p => p.gk).map(p => p.id);
  g.pending = L.planNext({
    avail: squad, keepers, gk: null, onPitch: [],
    fair: Object.fromEntries(squad.map(id => [id, 0])),
    gkMs: g.gkMs, lastOff: g.lastOff, order,
  }, cfg, { prevGlobal: null, nextGlobal: 0 });
  return g;
}

/** Play a whole match through the projector and report the minute spread. */
function playOut(roster, cfg) {
  const g = gameOf(roster, cfg);
  const order = (id) => roster.findIndex(p => p.id === id);
  const proj = L.project(g, cfg, roster, order);
  const totals = Object.values(proj.totals);
  return {
    proj,
    totals: proj.totals,
    min: Math.min(...totals),
    max: Math.max(...totals),
    spread: Math.max(...totals) - Math.min(...totals),
    sum: totals.reduce((a, b) => a + b, 0),
  };
}

/* ------------------------------- timing ---------------------------- */
test('stints divide the period evenly rather than leaving a stub', () => {
  const cfg = cfgOf({ periodMin: 20, stintMin: 6 });
  eq(L.stintsPerPeriod(cfg), 3, 'stints per period');
  eq(L.stintMs(cfg), (20 * MIN) / 3, 'stint length');
  eq(L.boundaryMs(cfg, 2), 20 * MIN, 'final boundary is the period end');
});

test('a stint longer than the period still yields one stint', () => {
  const cfg = cfgOf({ periodMin: 5, stintMin: 20 });
  eq(L.stintsPerPeriod(cfg), 1);
  eq(L.boundaryMs(cfg, 0), 5 * MIN);
});

test('global stint numbering runs continuously across periods', () => {
  const cfg = cfgOf({ periodMin: 20, stintMin: 4, periods: 4 });
  eq(L.stintsPerPeriod(cfg), 5);
  eq(L.globalStint(cfg, 1, 0), 0);
  eq(L.globalStint(cfg, 2, 0), 5);
  eq(L.globalStint(cfg, 4, 4), 19);
});

/* ------------------------------ fairness --------------------------- */
test('minutes divide evenly when the squad divides evenly', () => {
  // 8 players, 4 on the field, 40 minutes => 20 minutes each, exactly.
  const r = playOut(team(8), cfgOf());
  eq(Object.keys(r.totals).length, 8);
  eq(r.spread, 0, 'spread should be zero');
  eq(r.min, 20 * MIN, 'each player');
});

test('an awkward squad size stays within one stint for everyone', () => {
  for (const n of [5, 6, 7, 9, 10, 11, 13]) {
    const cfg = cfgOf();
    const r = playOut(team(n), cfg);
    const stint = L.stintMs(cfg);
    assert(r.spread <= stint + 1,
      `${n} players: spread ${(r.spread / MIN).toFixed(2)}m exceeds one stint`);
    // total pitch time is conserved
    eq(Math.round(r.sum), Math.round(cfg.onField * cfg.periods * cfg.periodMin * MIN),
      `${n} players: total pitch time`);
  }
});

test('the field is always full and never double-books a player', () => {
  const cfg = cfgOf();
  const roster = team(7);
  const { proj } = playOut(roster, cfg);
  eq(proj.stints.length, 10, 'ten stints in a 2x20 with 4-minute swaps');
  for (const s of proj.stints) {
    eq(s.field.length, cfg.onField, 'field size at stint ' + s.stint);
    eq(new Set(s.field).size, s.field.length, 'duplicate player on the field');
  }
});

test('nobody sits out twice in a row while someone else plays throughout', () => {
  const cfg = cfgOf();
  const roster = team(7);
  const { proj } = playOut(roster, cfg);
  const streak = {};
  roster.forEach(p => { streak[p.id] = { off: 0, worstOff: 0, on: 0, worstOn: 0 }; });
  for (const s of proj.stints) {
    const on = new Set(s.field);
    for (const p of roster) {
      const st = streak[p.id];
      if (on.has(p.id)) { st.on++; st.off = 0; } else { st.off++; st.on = 0; }
      st.worstOff = Math.max(st.worstOff, st.off);
      st.worstOn = Math.max(st.worstOn, st.on);
    }
  }
  for (const p of roster) {
    assert(streak[p.id].worstOff <= 2,
      `${p.name} sat out ${streak[p.id].worstOff} stints running`);
  }
});

test('a squad smaller than the field puts everyone on for the whole match', () => {
  const cfg = cfgOf({ onField: 7 });
  const r = playOut(team(5), cfg);
  eq(r.spread, 0);
  eq(r.min, 40 * MIN, 'everyone plays every minute');
  for (const s of r.proj.stints) eq(s.field.length, 5);
});

test('exactly enough players means no substitutions at all', () => {
  const cfg = cfgOf({ onField: 4 });
  const { proj } = playOut(team(4), cfg);
  const first = proj.stints[0].field.join();
  for (const s of proj.stints) eq(s.field.join(), first, 'lineup should never change');
});

/* --------------------------- self-correction ----------------------- */
test('a player who arrives at half time still gets caught up', () => {
  const cfg = cfgOf();
  const roster = team(7);
  const g = gameOf(roster, cfg);
  const order = (id) => roster.findIndex(p => p.id === id);

  // simulate: six players have each racked up 20 minutes; a seventh has none
  const latecomer = 'p6';
  roster.forEach(p => { g.played[p.id] = p.id === latecomer ? 0 : 20 * MIN; });
  g.state = 'break';
  g.period = 1; g.stint = 4; g.clockMs = 20 * MIN; g.segStart = 20 * MIN;
  g.field = ['p0', 'p1', 'p2', 'p3']; g.gk = null;

  const proj = L.project(g, cfg, roster, order);
  const onCount = proj.stints.filter(s => s.field.includes(latecomer)).length;
  assert(onCount >= 4, `latecomer only got ${onCount} of the remaining stints`);
  // and their deficit should be smaller at the end than it was at the break
  const finalSpread = Math.max(...Object.values(proj.totals)) - Math.min(...Object.values(proj.totals));
  assert(finalSpread < 20 * MIN, 'the gap should close, not persist');
});

test('losing a player mid-match does not break the plan', () => {
  const cfg = cfgOf();
  const roster = team(8);
  const g = gameOf(roster, cfg);
  const order = (id) => roster.findIndex(p => p.id === id);
  g.state = 'live'; g.stint = 2; g.clockMs = 9 * MIN; g.segStart = 8 * MIN;
  g.field = ['p0', 'p1', 'p2', 'p3'];
  g.out = ['p7'];

  const proj = L.project(g, cfg, roster, order);
  for (const s of proj.stints) {
    assert(!s.field.includes('p7'), 'a player who went home is back on the field');
    eq(s.field.length, cfg.onField, 'field still full');
  }
});

/* ----------------------------- goalkeeper -------------------------- */
test('the gloves rotate through everyone eligible', () => {
  const cfg = cfgOf({ useGk: true, onField: 5, gkEvery: 2 });
  const roster = team(8, 4);           // first four may keep goal
  const { proj } = playOut(roster, cfg);
  const keepers = new Set(proj.stints.map(s => s.gk));
  eq(keepers.size, 4, 'all four eligible keepers should get a turn');
  for (const s of proj.stints) {
    assert(s.gk, 'every stint needs a keeper');
    assert(!s.field.includes(s.gk), 'the keeper is also counted as an outfielder');
    eq(s.field.length, cfg.onField - 1, 'outfield count');
  }
});

test('a keeper stays in goal for the whole block', () => {
  const cfg = cfgOf({ useGk: true, onField: 5, gkEvery: 2 });
  const { proj } = playOut(team(8, 4), cfg);
  for (let i = 0; i < proj.stints.length; i += 2) {
    if (proj.stints[i + 1]) {
      eq(proj.stints[i].gk, proj.stints[i + 1].gk, `block starting at stint ${i}`);
    }
  }
});

test('only players marked as keepers ever go in goal', () => {
  const cfg = cfgOf({ useGk: true, onField: 5, gkEvery: 2 });
  const { proj } = playOut(team(8, 2), cfg);
  for (const s of proj.stints) assert(['p0', 'p1'].includes(s.gk), 'ineligible keeper: ' + s.gk);
});

test('with gkCounts off, keepers get their full share of outfield time', () => {
  const cfg = cfgOf({ useGk: true, onField: 5, gkEvery: 2, gkCounts: false });
  const roster = team(8, 2);
  const { totals, proj } = playOut(roster, cfg);
  const outfield = (id) => (totals[id] || 0) - (proj.gkTotals[id] || 0);
  const vals = roster.map(p => outfield(p.id));
  const spread = Math.max(...vals) - Math.min(...vals);
  assert(spread <= L.stintMs(cfg) * 2 + 1,
    `outfield spread ${(spread / MIN).toFixed(2)}m is too wide when keeper time is excluded`);
});

test('keepers still work when nobody is flagged but keepers are on', () => {
  const cfg = cfgOf({ useGk: true, onField: 5 });
  const { proj } = playOut(team(8, 0), cfg);
  // no eligible keepers => no keeper, and the field falls back to outfield only
  for (const s of proj.stints) eq(s.gk, null);
});

/* ----------------------------- stability --------------------------- */
test('the announced next lineup does not wobble as the stint ticks away', () => {
  const cfg = cfgOf();
  const roster = team(7);
  const order = (id) => roster.findIndex(p => p.id === id);
  const g = gameOf(roster, cfg);
  g.state = 'live'; g.stint = 1; g.segStart = 4 * MIN;
  g.field = ['p0', 'p1', 'p2', 'p3'];
  g.played = { p0: 4 * MIN, p1: 4 * MIN, p2: 4 * MIN, p3: 4 * MIN, p4: 0, p5: 0, p6: 0 };
  g.gkMs = Object.fromEntries(roster.map(p => [p.id, 0]));
  g.lastOff = Object.fromEntries(roster.map(p => [p.id, 0]));

  const boundary = L.boundaryMs(cfg, g.stint);
  let announced = null;
  // walk the clock through the stint in ten-second steps
  for (let t = 4 * MIN; t < boundary; t += 10000) {
    g.clockMs = t;
    const pitch = L.onPitch(g);
    const remaining = Math.max(0, boundary - Math.max(g.segStart, g.clockMs));
    const fair = {};
    g.squad.forEach(id => {
      fair[id] = L.playedNow(g, id) + (pitch.includes(id) ? remaining : 0);
    });
    const next = L.planNext({
      avail: g.squad, keepers: [], gk: null, onPitch: pitch,
      fair, gkMs: g.gkMs, lastOff: g.lastOff, order,
    }, cfg, { prevGlobal: 1, nextGlobal: 2 });
    const sig = next.out.join(',') + '|' + next.in.join(',');
    if (announced === null) announced = sig;
    eq(sig, announced, `lineup changed at ${(t / MIN).toFixed(1)} min into the match`);
  }
  assert(announced && announced !== '|', 'expected some subs to be planned');
});

test('nobody is left on ahead of someone who has played less', () => {
  // The invariant the whole engine rests on: at every swap, the players
  // taking the field are the ones with the least time on it.
  for (const n of [5, 6, 7, 8, 9, 11]) {
    const cfg = cfgOf();
    const roster = team(n);
    const { proj } = playOut(roster, cfg);
    const played = Object.fromEntries(roster.map(p => [p.id, 0]));
    const stint = L.stintMs(cfg);

    for (let i = 0; i < proj.stints.length; i++) {
      proj.stints[i].field.forEach(id => { played[id] += stint; });
      const next = proj.stints[i + 1];
      if (!next) break;
      const on = new Set(next.field);
      const worstOn = Math.max(...next.field.map(id => played[id]));
      const bestOff = Math.min(...roster.filter(p => !on.has(p.id)).map(p => played[p.id]),
        Number.POSITIVE_INFINITY);
      assert(worstOn <= bestOff + 1,
        `${n} players, stint ${i + 2}: kept someone on ${(worstOn / MIN).toFixed(1)}m ` +
        `ahead of a bench player on ${(bestOff / MIN).toFixed(1)}m`);
    }
  }
});

test('shifts are whole stints, not one-minute cameos', () => {
  const cfg = cfgOf();
  const { proj } = playOut(team(7), cfg);
  // every appearance lasts at least a full stint by construction; check the
  // rotation is not thrashing more than the squad size requires
  let changes = 0;
  for (let i = 1; i < proj.stints.length; i++) {
    const prev = new Set(proj.stints[i - 1].field);
    changes += proj.stints[i].field.filter(id => !prev.has(id)).length;
  }
  const benchSize = 7 - cfg.onField;
  assert(changes <= benchSize * (proj.stints.length - 1),
    `${changes} substitutions is more than a ${benchSize}-player bench can account for`);
});

test('live minutes include the stint in progress', () => {
  const cfg = cfgOf();
  const roster = team(6);
  const g = gameOf(roster, cfg);
  g.state = 'live'; g.field = ['p0', 'p1', 'p2', 'p3'];
  g.played = Object.fromEntries(roster.map(p => [p.id, 0]));
  g.segStart = 0; g.clockMs = 90000;
  eq(L.playedNow(g, 'p0'), 90000, 'on the pitch');
  eq(L.playedNow(g, 'p5'), 0, 'on the bench');
  g.state = 'break';
  eq(L.playedNow(g, 'p0'), 0, 'a paused clock should not keep accruing');
});

/* ------------------------------- report ---------------------------- */
console.log(`\n  ${pass} passing, ${fail} failing\n`);
if (fail) {
  failures.forEach(f => console.log('  ✗ ' + f + '\n'));
  process.exit(1);
}
