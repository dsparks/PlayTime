/**
 * Drives the whole app through a full match against a minimal DOM stub.
 *
 * This will not tell you whether it looks right — it tells you that every
 * screen, sheet and state transition actually builds without throwing,
 * which is the failure mode a rewrite is most likely to have.
 *
 * Run with:  node test/smoke.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

/* ---------------------------- the DOM stub -------------------------- */
function makeEl(tag) {
  const el = {
    nodeType: 1, tagName: String(tag).toUpperCase(),
    childNodes: [], parentNode: null,
    attrs: {}, style: {}, value: '', _text: '', _class: '',
    get className() { return el._class; },
    set className(v) { el._class = String(v); },
    get classList() {
      const list = () => el._class.split(/\s+/).filter(Boolean);
      return {
        contains: (c) => list().includes(c),
        add: (c) => { if (!list().includes(c)) el._class = (el._class + ' ' + c).trim(); },
        remove: (c) => { el._class = list().filter(x => x !== c).join(' '); },
        toggle: (c, force) => {
          const on = force === undefined ? !list().includes(c) : !!force;
          on ? el.classList.add(c) : el.classList.remove(c);
        },
      };
    },
    get textContent() { return el._text; },
    set textContent(v) { el._text = String(v); el.childNodes = []; },
    setAttribute: (k, v) => { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    removeAttribute: (k) => { delete el.attrs[k]; },
    appendChild: (c) => { c.parentNode = el; el.childNodes.push(c); return c; },
    append: (...kids) => {
      kids.filter(k => k != null && k !== false).forEach(k => {
        el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
      });
    },
    replaceChildren: (...kids) => {
      el.childNodes = [];
      kids.filter(Boolean).forEach(k => el.appendChild(k));
    },
    addEventListener: (type, fn) => { (el.handlers[type] || (el.handlers[type] = [])).push(fn); },
    removeEventListener: () => {},
    focus: () => {},
    matches: () => false,
    handlers: {},
    click() { (el.handlers.click || []).forEach(f => f({ target: el, preventDefault() {} })); },
  };
  return el;
}

const root = makeEl('body');
const appEl = makeEl('div'); appEl.setAttribute('id', 'app');
const layerEl = makeEl('div'); layerEl.setAttribute('id', 'layer');
root.appendChild(appEl); root.appendChild(layerEl);

function walk(node, fn) {
  fn(node);
  (node.childNodes || []).forEach(c => walk(c, fn));
}

const store = new Map();
const timers = [];

globalThis.document = {
  documentElement: makeEl('html'),
  visibilityState: 'visible',
  createElement: makeEl,
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t), childNodes: [] }),
  getElementById: (id) => { let found = null; walk(root, n => { if (n.id === id) found = n; }); return found; },
  querySelector: () => null,
  addEventListener: () => {},
};
globalThis.window = { addEventListener: () => {} };
Object.defineProperty(globalThis, 'navigator', {
  value: { vibrate: () => true }, configurable: true, writable: true,
});
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.setInterval = () => 0;             // do not keep node alive
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearTimeout = () => {};
globalThis.confirm = () => true;

/* --------------------------- load the app --------------------------- */
const open = html.lastIndexOf('<script>');
const shut = html.lastIndexOf('</' + 'script>');
const src = html.slice(open + '<script>'.length, shut);

const EXPORTS = [
  'S', 'render', 'tick', 'startClock', 'pauseClock', 'applySubs', 'startNextPeriod',
  'endMatch', 'swap', 'setAvailable', 'addGoal', 'undo', 'open', 'close', 'save',
  'newGame', 'computePending', 'syncClock', 'setClock', 'raiseDue', 'periodMs',
  'boundaryMs', 'stintsPerPeriod', 'onPitch', 'playedNow', 'uid',
];
const app = new Function(
  src + '\n;return {' +
  EXPORTS.map(n => (n === 'S' ? 'get S(){return S}, set S(v){S=v}' : n)).join(',') +
  '};'
)();

/* ------------------------------ harness ----------------------------- */
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`${name}\n    ${e.stack.split('\n').slice(0, 3).join('\n    ')}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
/** Text of everything currently on screen. */
function screenText(node) {
  let out = '';
  walk(node || root, n => {
    if (n.nodeType === 3) out += n.textContent + ' ';
    else if (n._text) out += n._text + ' ';
  });
  return out;
}
const shows = (s) => screenText().includes(s);
/** Every button currently rendered, so we can prove they all survive a click. */
function buttons(node) {
  const found = [];
  walk(node || root, n => { if (n.tagName === 'BUTTON') found.push(n); });
  return found;
}

/* =========================== the walkthrough ======================== */

test('cold start renders the empty-team screen', () => {
  app.render();
  assert(shows('PlayTime'), 'wordmark missing');
  assert(shows('Add players'), 'no call to action for an empty roster');
});

test('a roster can be built and every player shows up', () => {
  const S = app.S;
  ['Maya', 'Jonah', 'Ellis', 'Priya', 'Rio', 'Sam', 'Ada', 'Theo'].forEach(name => {
    const p = { id: app.uid(), name, gk: false };
    S.roster.push(p);
    S.lastSquad.push(p.id);
  });
  app.render();
  eq(S.roster.length, 8);
  assert(shows('Maya') && shows('Theo'), 'roster tiles missing');
  assert(shows('8 of 8'), 'attendance count wrong: ' + screenText().slice(0, 200));
});

test('the team screen estimates minutes before kick-off', () => {
  app.render();
  assert(/on the bench at a time/.test(screenText()), 'no bench/minutes estimate');
});

test('starting a match shows a lineup with the right shape', () => {
  const S = app.S;
  S.game = app.newGame(S.lastSquad.slice());
  app.render();
  eq(S.game.pending.field.length, S.cfg.onField, 'starting XI size');
  assert(shows('Kick off'), 'no kick-off button');
  assert(shows('If it all goes to plan'), 'no projection');
});

test('kick-off puts the planned lineup on the pitch and starts the clock', () => {
  const S = app.S;
  const planned = S.game.pending.field.slice();
  app.startClock();
  eq(S.game.state, 'live');
  eq(S.game.running, true);
  eq(S.game.field.join(), planned.join(), 'a different XI took the field');
  assert(shows('Next swap in'), 'hero label missing');
  assert(shows('Coming off') || shows('Full squad on'), 'no substitution board');
});

test('the board names who is coming off and who is going on', () => {
  const p = app.S.game.pending;
  eq(p.out.length, p.in.length, 'the pitch must stay the same size');
  assert(p.out.length > 0, 'with 8 players and 4 on, somebody should be rotating');
  p.out.forEach(id => assert(shows(app.S.roster.find(x => x.id === id).name), 'name missing from board'));
});

/** Wind the clock forward without waiting for real time. */
function advance(ms) {
  const g = app.S.game;
  app.syncClock();
  g.clockMs = Math.min(app.periodMs(app.S.cfg), g.clockMs + ms);
  g.runBase = g.clockMs;
  g.runFrom = Date.now();
  app.tick();
}

test('the buzzer goes at the stint boundary and pauses the clock', () => {
  advance(4 * 60000);
  const g = app.S.game;
  eq(g.due, true, 'sub not flagged as due');
  eq(g.running, false, 'clock should stop at the swap by default');
  assert(shows('Swap them now'), 'no swap prompt: ' + screenText().slice(0, 300));
});

test('"done" applies exactly the lineup that was on screen', () => {
  const g = app.S.game;
  const promised = { out: g.pending.out.slice(), in: g.pending.in.slice() };
  const before = new Set(app.onPitch(g));
  app.applySubs();
  const after = new Set(app.onPitch(g));
  promised.out.forEach(id => assert(!after.has(id), 'a player who was named to come off is still on'));
  promised.in.forEach(id => assert(after.has(id), 'a player who was named to come on is not on'));
  eq(before.size, after.size, 'pitch changed size');
  eq(g.due, false);
  eq(g.running, true, 'clock should restart after the swap');
  eq(g.stint, 1);
});

test('minutes are credited from the real clock, not the plan', () => {
  const g = app.S.game;
  const played = Object.values(g.played).filter(v => v > 0);
  eq(played.length, 4, 'exactly the four who were on should have minutes');
  played.forEach(v => eq(Math.round(v / 1000), 240, 'each should have four minutes'));
});

test('a late sub credits the extra time to whoever was actually on', () => {
  const g = app.S.game;
  const onNow = app.onPitch(g).slice();
  advance(4 * 60000);        // buzzer
  advance(0);
  eq(g.due, true);
  // coach faffs about for 25 seconds before making the change
  g.clockMs += 25000; g.runBase = g.clockMs;
  app.applySubs();
  onNow.forEach(id => {
    eq(Math.round(g.played[id] / 1000) >= 265, true,
      'the player who stayed on for the extra 25s should be credited for it');
  });
});

test('goals are recorded, attributed and undoable', () => {
  const g = app.S.game;
  const scorer = app.onPitch(g)[0];
  app.addGoal(true, scorer);
  app.addGoal(false, null);
  eq(g.goals.length, 2);
  assert(shows('1 ') || shows('1'), 'score not rendered');
  app.undo();
  eq(app.S.game.goals.length, 1, 'undo should remove the last goal');
});

test('a manual swap moves both players and replans the rest', () => {
  const g = app.S.game;
  const onId = g.field[0];
  const benchId = g.squad.find(id => !app.onPitch(g).includes(id) && !g.out.includes(id));
  assert(benchId, 'expected somebody on the bench');
  app.swap(onId, benchId);
  const g2 = app.S.game;
  assert(g2.field.includes(benchId), 'bench player did not come on');
  assert(!g2.field.includes(onId), 'field player did not come off');
  eq(g2.field.length, app.S.cfg.onField, 'field size after a manual swap');
});

test('sending a player home backfills the shirt', () => {
  const g = app.S.game;
  const victim = g.field[0];
  app.setAvailable(victim, false);
  const g2 = app.S.game;
  assert(g2.out.includes(victim), 'not marked as gone');
  assert(!app.onPitch(g2).includes(victim), 'still on the pitch');
  eq(g2.field.length, app.S.cfg.onField, 'the field should be refilled');
  g2.pending.field.forEach(id => assert(id !== victim, 'planned back on after going home'));
});

test('every sheet builds without throwing', () => {
  for (const tab of ['minutes', 'goals', 'squad', 'clock']) {
    app.open('sheet', { tab });
    assert(layerEl.childNodes.length > 0, 'sheet ' + tab + ' rendered nothing');
  }
  app.open('goal');
  assert(shows('Who scored?'), 'goal sheet missing');
  app.open('settings');
  assert(shows('Settings'), 'settings sheet missing');
  app.open('roster');
  assert(shows('Your team'), 'roster sheet missing');
  app.close();
  assert(!screenText(layerEl).includes('Who scored?'), 'sheet did not close');
  walk(layerEl, n => assert(!/\bsheet\b/.test(n.className || ''), 'a sheet is still open'));
});

test('nudging the clock changes the timer and nothing else', () => {
  const g = app.S.game;
  const before = Object.fromEntries(g.squad.map(id => [id, app.playedNow(g, id)]));
  const t = g.clockMs;

  app.setClock(t - 30000);
  const g2 = app.S.game;
  assert(Math.abs(g2.clockMs - (t - 30000)) < 50, 'clock did not move');
  g2.squad.forEach(id => {
    const drift = Math.abs(app.playedNow(g2, id) - before[id]);
    assert(drift < 100, `${id}'s minutes moved by ${drift}ms when only the clock should have`);
  });

  app.setClock(t);   // put it back so later totals stay comparable
  assert(Math.abs(app.S.game.clockMs - t) < 100, 'clock did not return');
});

/** Play real time in small steps, making each substitution as it falls due. */
function playFor(ms) {
  const step = 15000;
  for (let i = 0; i < ms; i += step) {
    if (app.S.game.state !== 'live') return;
    advance(Math.min(step, ms - i));
    if (app.S.game.due && app.S.game.state === 'live') app.applySubs();
  }
}

test('the period ends on its own and raises the half-time curtain', () => {
  playFor(app.periodMs(app.S.cfg));
  const g2 = app.S.game;
  eq(g2.state, 'break', 'should be at the interval');
  eq(g2.running, false);
  assert(shows('Half time'), 'no half-time curtain: ' + screenText().slice(0, 200));
  assert(shows('Start the 2nd half'), 'no way to restart');
});

test('the second half starts fresh with a fair lineup', () => {
  app.startNextPeriod();
  const g = app.S.game;
  eq(g.period, 2);
  assert(g.clockMs < 1000, 'the second half should start from zero, got ' + g.clockMs + 'ms');
  eq(g.stint, 0);
  eq(g.state, 'live');
  eq(g.running, true);
  eq(g.field.length, app.S.cfg.onField);
});

test('full time raises the summary with everyone accounted for', () => {
  playFor(app.periodMs(app.S.cfg));
  const g = app.S.game;
  eq(g.state, 'ft');
  assert(shows('Full time'), 'no full-time curtain');
  assert(shows('Minutes played'), 'no minutes breakdown');
  // every second of the match should be on somebody's account, once
  const total = Object.values(g.played).reduce((a, b) => a + b, 0);
  const expected = app.S.cfg.onField * app.S.cfg.periods * app.S.cfg.periodMin * 60000;
  const drift = Math.abs(total - expected) / 60000;
  assert(drift < 0.5, `pitch time drifted by ${drift.toFixed(2)} minutes over the match`);
});

test('minutes came out close to even despite all the interference', () => {
  const g = app.S.game;
  const vals = g.squad.filter(id => !g.out.includes(id)).map(id => app.playedNow(g, id));
  const spread = (Math.max(...vals) - Math.min(...vals)) / 60000;
  assert(spread <= 5, `spread of ${spread.toFixed(1)} minutes is too wide`);
});

test('finishing up returns to the team screen with the roster intact', () => {
  app.S.game = null;
  app.render();
  eq(app.S.roster.length, 8, 'the team should survive the match');
  assert(shows('Who turned up'), 'not back at the team screen');
});

test('state survives a reload', () => {
  const S = app.S;
  S.game = app.newGame(S.lastSquad.slice());
  app.startClock();
  app.save(true);
  const raw = globalThis.localStorage.getItem('playtime.v3');
  assert(raw, 'nothing was saved');
  const parsed = JSON.parse(raw);
  eq(parsed.roster.length, 8);
  eq(parsed.game.state, 'live');
  assert(parsed.savedAt > 0, 'no save timestamp for clock recovery');
});

test('a keeper match runs end to end', () => {
  const S = app.S;
  S.cfg.useGk = true;
  S.cfg.onField = 5;
  S.roster.slice(0, 3).forEach(p => { p.gk = true; });
  S.game = app.newGame(S.lastSquad.slice());
  app.render();
  assert(S.game.pending.gk, 'no keeper chosen');
  app.startClock();
  const g = app.S.game;
  assert(g.gk, 'no keeper on the pitch');
  eq(g.field.length, S.cfg.onField - 1, 'outfield count with a keeper');
  assert(!g.field.includes(g.gk), 'the keeper is double-counted');
  playFor(app.periodMs(app.S.cfg));
  assert(app.S.game.gkMs[Object.keys(app.S.game.gkMs).find(k => app.S.game.gkMs[k] > 0)] > 0,
    'nobody accrued time in goal');
});

/* -------------------- click absolutely everything -------------------- */
/* Every button on every screen, each from a fresh state so one click
   cannot mask the next. This is the net that catches a typo in a render
   path that only runs at half time. */

const SCENES = {
  'team screen': () => { app.S.game = null; },
  'lineup': () => { app.S.game = app.newGame(app.S.lastSquad.slice()); },
  'match, clock running': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice());
    app.startClock();
    advance(60000);
  },
  'match, clock paused': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice());
    app.startClock(); advance(60000); app.pauseClock();
  },
  'match, swap due': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice());
    app.startClock();
    advance(app.boundaryMs(app.S.cfg, 0));
  },
  'half time': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice());
    app.startClock();
    playFor(app.periodMs(app.S.cfg));
  },
  'full time': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice());
    app.startClock();
    playFor(app.periodMs(app.S.cfg));
    app.endMatch();
  },
  'a player has gone home': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice());
    app.startClock(); advance(30000);
    app.setAvailable(app.S.game.field[0], false);
  },
  'short squad, nobody to rotate': () => {
    app.S.game = app.newGame(app.S.lastSquad.slice(0, app.S.cfg.onField));
    app.startClock(); advance(30000);
  },
};

const SHEETS = [
  ['minutes tab', () => app.open('sheet', { tab: 'minutes' })],
  ['goals tab', () => app.open('sheet', { tab: 'goals' })],
  ['squad tab', () => app.open('sheet', { tab: 'squad' })],
  ['clock tab', () => app.open('sheet', { tab: 'clock' })],
  ['goal picker', () => app.open('goal')],
  ['settings', () => app.open('settings')],
  ['team editor', () => app.open('roster')],
];

for (const [scene, setup] of Object.entries(SCENES)) {
  test(`every button works: ${scene}`, () => {
    setup(); app.close(); app.render();
    const n = buttons(root).length;
    assert(n > 0, 'no buttons rendered at all');
    for (let i = 0; i < n; i++) {
      setup(); app.close(); app.render();
      const all = buttons(root);
      if (i >= all.length) break;            // the scene got shorter; fine
      const label = screenText(all[i]).trim().slice(0, 30) || all[i].getAttribute('aria-label') || '#' + i;
      try { all[i].click(); }
      catch (e) { throw new Error(`"${label}" threw: ${e.message}`); }
      try { app.render(); }
      catch (e) { throw new Error(`re-render after "${label}" threw: ${e.message}`); }
    }
  });
}

for (const [name, opener] of SHEETS) {
  test(`every button works: ${name}`, () => {
    const build = () => {
      app.S.game = app.newGame(app.S.lastSquad.slice());
      app.startClock(); advance(30000);
      opener();
    };
    build();
    const n = buttons(layerEl).length;
    assert(n > 0, `${name} rendered no buttons`);
    for (let i = 0; i < n; i++) {
      build();
      const all = buttons(layerEl);
      if (i >= all.length) break;
      const label = screenText(all[i]).trim().slice(0, 30) || all[i].getAttribute('aria-label') || '#' + i;
      try { all[i].click(); }
      catch (e) { throw new Error(`"${label}" threw: ${e.message}`); }
      try { app.render(); }
      catch (e) { throw new Error(`re-render after "${label}" threw: ${e.message}`); }
    }
    app.close();
  });
}

/* ------------------------------- report ---------------------------- */
console.log(`\n  ${pass} passing, ${fail} failing\n`);
if (fail) {
  failures.forEach(f => console.log('  ✗ ' + f + '\n'));
  process.exit(1);
}
