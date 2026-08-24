// The engine's contract, runnable anywhere node is: `node --test packages/engine`.
// These are the rules from CLAUDE.md as executable claims. The browser harness
// still covers rendering and page UI; everything about how the game BEHAVES
// lives here, plus the two guarantees the browser could never test well:
// determinism and replay.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  createGame, replay, ghostRenderPos, ENGINE_VERSION, MODES,
  GRID, START_LEN, SIM_DT, SPEEDS, FOOD_TTL, BONUS_EVERY,
  TNT_SCORES, GHOST_SCORES, GHOST_MS, MAX_PLAYERS,
  PORTAL_FIRST, PORTAL_EVERY, PORTAL_BONUS, PORTAL_MIN_GAP, portalMark,
  MIN_SPAWN_DIST, K, wrapDist,
} from './engine.js';

const FRAME = 1000 / 60;

// a game with the hazard timers parked, so tests drive them explicitly
function quietGame(cfg = {}) {
  const g = createGame({ seed: 7, ...cfg });
  g.wallPhaseEnd = 1e12;
  g.drainEvents();
  return g;
}

function setSnake(g, cells, dx, dy) {
  g.snake.length = 0;
  g.snakeSet.clear();
  for (const [x, y] of cells) { g.snake.push({ x, y }); g.snakeSet.add(K(x, y)); }
  g.tailFrom = null;
  g.dirQueue.length = 0;
  g.pendingGrowth = 0;
  g.progMs = 0;
  g.dir = { x: dx, y: dy };
  g.headFrom.x = cells[0][0]; g.headFrom.y = cells[0][1];
  g.headMajX = cells[0][0]; g.headMajY = cells[0][1];
}

const cellEq = (c, x, y) => !!c && c.x === x && c.y === y;
const PAIR = () => ({ ax: 5, ay: 5, bx: 15, by: 15, used: false });

// park the food away from a test's path
function foodFar(g) { g.food = { x: 19, y: 19, bonus: false, kind: 0 }; g.foodAge = 0; }

// ---------------------------------------------------------------- determinism
test('same seed and inputs give the identical round', () => {
  const run = () => {
    const g = createGame({ seed: 1234, tickMs: 130 });
    // steer a box early, then leave it to the seeded hazards
    const script = [[40, 0, -1], [90, -1, 0], [140, 0, 1], [400, 1, 0], [900, 0, -1]];
    let s = 0;
    for (let q = 0; q < 60000 && g.alive; q++) {
      while (s < script.length && script[s][0] === q) { g.setDir(script[s][1], script[s][2]); s++; }
      g.advanceQuanta(1);
    }
    return g;
  };
  const a = run(), b = run();
  assert.equal(a.alive, false, 'the unattended round ends (seeded walls or ghosts get it)');
  assert.equal(a.score, b.score);
  assert.equal(a.quanta, b.quanta, 'death lands on the same quantum');
  assert.equal(a.deadReason, b.deadReason);
  assert.deepEqual(a.snake, b.snake);
});

test('different seeds give different rounds', () => {
  const foods = new Set();
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame({ seed });
    foods.add(g.food.x * 1000 + g.food.y * 10 + g.food.kind);
  }
  assert.ok(foods.size >= 4, 'five seeds produce at least four distinct opening boards');
});

test('replay(log) reproduces a finished round exactly', () => {
  const g = createGame({ seed: 987654, tickMs: 100 });
  const script = [[25, 0, 1], [70, 1, 0], [130, 0, -1], [500, -1, 0], [501, 0, 1], [1500, 1, 0]];
  let s = 0;
  for (let q = 0; q < 90000 && g.alive; q++) {
    while (s < script.length && script[s][0] === q) { g.setDir(script[s][1], script[s][2]); s++; }
    g.advanceQuanta(1);
  }
  assert.equal(g.alive, false, 'the round ended');
  assert.ok(g.log.end > 0 && g.log.inputs.length > 0, 'the log recorded the round');
  const r = replay(g.log);
  assert.equal(r.score, g.score, 'the replay lands on the same score');
  assert.equal(r.alive, false);
  assert.equal(r.deadReason, g.deadReason);
  assert.deepEqual(r.snake, g.snake, 'and the same final body');
});

test('advance() with ragged frame times matches advanceQuanta exactly', () => {
  const a = createGame({ seed: 42 });
  const b = createGame({ seed: 42 });
  let fed = 0;
  const frames = [16.667, 8.3, 33.4, 16.667, 100, 3.2, 16.667, 55.5];
  for (let i = 0; i < 2000; i++) { const dt = frames[i % frames.length]; a.advance(dt); fed += dt; }
  b.advanceQuanta(Math.floor(fed / SIM_DT));
  assert.equal(a.quanta, b.quanta, 'quanta count depends only on total time');
  assert.equal(a.score, b.score);
  assert.deepEqual(a.snake, b.snake, 'frame cadence cannot change the simulation');
});

// ------------------------------------------------------------------- rule 14
test('the pace is constant at every speed, turn pending or not', () => {
  for (const tickMs of [SPEEDS.slow, SPEEDS.normal, SPEEDS.fast]) {
    assert.equal(tickMs % SIM_DT, 0, 'every speed is a whole number of quanta');
    for (const withTurn of [false, true]) {
      const g = quietGame({ tickMs });
      foodFar(g);
      setSnake(g, [[8, 10], [7, 10], [6, 10]], 1, 0);
      let steps = 0, prevCell = '8,10', prevProg = g.renderProg(), worst = 0, simMs = 0;
      for (let i = 0; i < 57; i++) {           // 950ms: no speed lands on a boundary
        if (withTurn && i === 20) g.setDir(0, -1);
        g.advance(FRAME); simMs += FRAME;
        // renderProg advances by exactly dt/tickMs every frame (mod the 0..1 wrap)
        const p = g.renderProg();
        const d = p >= prevProg ? p - prevProg : p + 1 - prevProg;
        worst = Math.max(worst, Math.abs(d - FRAME / tickMs));
        prevProg = p;
        const c = g.snake[0].x + ',' + g.snake[0].y;
        if (c !== prevCell) { steps++; prevCell = c; }
      }
      const expect = Math.floor(57 * FRAME / tickMs);
      assert.equal(steps, expect, `${expect} steps in 950ms at ${tickMs}ms (turn: ${withTurn})`);
      assert.ok(worst < 1e-9, `every frame advances the same fraction at ${tickMs}ms (worst ${worst})`);
    }
  }
});

test('reversals and repeats are filtered; two quick taps both land', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[8, 10], [7, 10], [6, 10]], 1, 0);
  g.setDir(-1, 0);                       // reversal: refused
  assert.equal(g.dirQueue.length, 0);
  g.setDir(1, 0);                        // repeat: refused
  assert.equal(g.dirQueue.length, 0);
  g.setDir(0, -1); g.setDir(-1, 0);      // up then left, the fast corner
  assert.equal(g.dirQueue.length, 2);
  g._step();
  assert.deepEqual(g.dir, { x: 0, y: -1 });
  g._step();
  assert.deepEqual(g.dir, { x: -1, y: 0 }, 'both taps landed on successive ticks');
});

// ---------------------------------------------------------------- the windows
test('a hop is one step out of the far end, both directions, no bounce', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[4, 5], [3, 5], [2, 5], [1, 5], [0, 5]], 1, 0);
  g.portal = PAIR();
  g._step();
  assert.ok(cellEq(g.snake[0], 5, 5), 'head steps into the blue window normally');
  g._step();
  assert.ok(cellEq(g.snake[0], 15, 15), 'and comes out of the violet one');
  assert.deepEqual(g.dir, { x: 1, y: 0 }, 'the heading survives the hop');
  assert.ok(g.warpedIn, 'flagged as having just arrived');
  g._step();
  assert.ok(cellEq(g.snake[0], 16, 15), 'a head a window just placed walks off it');
  assert.ok(!g.warpedIn, 'and the flag clears');

  const h = quietGame();
  foodFar(h);
  setSnake(h, [[14, 15], [13, 15], [12, 15]], 1, 0);
  h.portal = PAIR();
  h._step(); h._step();
  assert.ok(cellEq(h.snake[0], 5, 5), 'the violet end carries you to the blue one too');
});

test('every segment advances one cell per step, hop included', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[4, 5], [3, 5], [2, 5], [1, 5], [0, 5]], 1, 0);
  g.portal = PAIR();
  let hops = 0, pace = true;
  for (let n = 0; n < 12; n++) {
    const before = g.snake.map(c => ({ ...c }));
    g._step();
    for (let i = 1; i < g.snake.length; i++)
      if (g.snake[i].x !== before[i - 1].x || g.snake[i].y !== before[i - 1].y) pace = false;
    if (wrapDist(g.snake[0].x, g.snake[0].y, before[0].x, before[0].y) !== 1) hops++;
  }
  assert.ok(pace, 'the body pours through one cell per step');
  assert.equal(hops, 1, 'exactly one discontinuity, no ping-pong');
});

test('one trip a pair: it pays once, then it is spent and inert', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[4, 5], [3, 5], [2, 5]], 1, 0);
  g.portal = PAIR();
  g.score = 50;
  g._step();
  assert.equal(g.score, 50, 'stepping in pays nothing on its own');
  g._step();
  assert.equal(g.score, 50 + PORTAL_BONUS, 'surfacing pays the bonus');
  assert.ok(g.portal.used, 'and marks the pair spent');
  let carried = 0;
  for (let n = 0; n < 20; n++) {
    setSnake(g, [[14, 15], [13, 15], [12, 15]], 1, 0);
    g._step(); g._step();
    if (cellEq(g.snake[0], 5, 5)) carried++;
  }
  assert.equal(carried, 0, 'twenty attempts at a spent pair and none carries');
  assert.equal(g.score, 50 + PORTAL_BONUS, 'and none of them paid');
});

test('a fatal hop pays nothing', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[4, 5], [3, 5], [2, 5], [15, 15], [15, 14], [15, 13]], 1, 0);
  g.portal = PAIR();
  g.score = 70;
  g._step(); g._step();                       // surfaces onto its own body
  assert.equal(g.alive, false, 'surfacing onto the body ends the round');
  assert.equal(g.score, 70, 'and pays nothing');
});

test('ghosts take windows too: both ways, no bounce, never paid', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[1, 1], [0, 1], [19, 1]], 1, 0);
  g.portal = PAIR();
  g.score = 80;
  g.ghosts.push({ x: 5, y: 5, px: 5, py: 5, dir: { x: 1, y: 0 }, warped: false, moveAt: 0 });
  g._moveGhost(g.ghosts[0]);
  assert.ok(cellEq(g.ghosts[0], 15, 15), 'a ghost in the blue window comes out of the violet one');
  assert.equal(g.score, 80, 'and pays nobody');
  g._moveGhost(g.ghosts[0]);
  assert.ok(!cellEq(g.ghosts[0], 5, 5), 'and is not bounced straight back');
  g.portal.used = true;
  g.ghosts[0].x = 5; g.ghosts[0].y = 5; g.ghosts[0].warped = false;
  const before = { x: 5, y: 5 };
  g._moveGhost(g.ghosts[0]);
  assert.ok(!cellEq(g.ghosts[0], 15, 15), 'a spent pair carries no ghosts');
  assert.equal(wrapDist(g.ghosts[0].x, g.ghosts[0].y, before.x, before.y), 1, 'it just walks');
});

test('a committed head reserves the far end against ghosts', () => {
  function trials(headInWindow) {
    const g = quietGame();
    foodFar(g);
    setSnake(g, headInWindow ? [[5, 5], [4, 5], [3, 5]] : [[1, 10], [0, 10], [19, 10]], 1, 0);
    g.portal = PAIR();
    g.ghosts.push({ x: 14, y: 15, px: 14, py: 15, dir: { x: 0, y: 0 }, warped: false, moveAt: 0 });
    let landed = 0;
    for (let i = 0; i < 300; i++) {
      const gh = g.ghosts[0];
      gh.x = 14; gh.y = 15; gh.dir = { x: 0, y: 0 }; gh.warped = false;
      g._moveGhost(gh);
      if (gh.x === 15 && gh.y === 15) landed++;
    }
    return landed;
  }
  assert.equal(trials(true), 0, 'no ghost may take the far end while a head is committed');
  assert.ok(trials(false) > 0, 'otherwise a window is an ordinary cell to a ghost');
});

test('a used pair shuts only after the body is clear', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[4, 5], [3, 5], [2, 5], [1, 5], [0, 5]], 1, 0);
  g.portal = PAIR();
  g.portalExpireAt = 1e12;                    // only the trip can shut it
  g._step(); g._step();                       // through
  g._updatePortals();
  assert.ok(g.portal !== null, 'it does not vanish out from under the body');
  let ticks = 0, heldByBusy = true;
  while (g.portal !== null && ticks < 60) {
    if (!g.portalBusy()) heldByBusy = false;
    g._step(); g._updatePortals(); ticks++;
  }
  assert.equal(g.portal, null, 'and shuts the moment the tail is clear');
  assert.ok(heldByBusy, 'held open by the body on every step of the drain');
});

// ---------------------------------------------------------------- the ladders
test('teleport marks come every twenty for ever and never re-arm', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(portalMark), [10, 30, 50, 70, 90, 110, 130]);
  assert.ok(PORTAL_EVERY > PORTAL_BONUS, 'a paid trip never covers the whole way to the next mark');

  const g = quietGame();
  g.clockMs = 1000;
  g.score = 130;
  g._updatePortals();
  assert.equal(g.portalsUnlocked, 7, 'a 130 point run has passed seven marks');
  g.score = 210;
  g._updatePortals();
  assert.equal(g.portalsUnlocked, 11, 'and a 210 point run eleven');

  const h = quietGame();
  h.clockMs = 1000;
  h.score = 31;
  h.portalsUnlocked = 2; h.portalsOpened = 2;
  h._updatePortals();
  assert.equal(h.portal, null, 'at 31 with both pairs spent, nothing is owed');
  h.score = 26;                               // a TNT takes five
  h._updatePortals();
  assert.equal(h.portalsUnlocked, 2, 'dropping under a mark owes nothing');
  h.score = 30;                               // eat back over it
  h._updatePortals();
  assert.ok(h.portal === null && h.portalsUnlocked === 2, 're-crossing a mark buys no second pair');
  h.score = 50;
  h._updatePortals();
  assert.ok(h.portal !== null, 'while the next mark up still works');
});

test('a wall refunds only a pair you never used', () => {
  // find a seed whose first wall pattern covers (0,0) - the frame patterns do
  let g = null;
  for (let seed = 1; seed < 60; seed++) {
    const t = createGame({ seed });
    t.clockMs = 100; t.wallPhaseEnd = 0;
    t._updateWalls();
    if (t.wallLookup.has(K(0, 0))) { g = createGame({ seed }); break; }
  }
  assert.ok(g, 'found a seed whose first pattern covers the corner');
  for (const used of [false, true]) {
    const t = createGame({ seed: g.seed });
    foodFar(t);
    t.clockMs = 100; t.wallPhaseEnd = 0;
    t.portal = { ax: 0, ay: 0, bx: 10, by: 10, used };
    t.portalsUnlocked = 1; t.portalsOpened = 1;
    t._updateWalls();
    assert.equal(t.portal, null, 'the buried pair closed');
    assert.equal(t.portalsOpened, used ? 1 : 0,
      used ? 'a pair already used refunds nothing' : 'a pair never used is owed again');
  }
});

test('the TNT ladder grows one block per mark, capped, never demoted, never stopping', () => {
  assert.deepEqual(TNT_SCORES, [15, 25, 35, 45, 55, 65, 75, 85, 95]);
  const g = quietGame();
  const sizes = [];
  for (const [sc, expect] of [[0, 0], [14, 0], [15, 1], [25, 2], [55, 5], [95, 9], [400, 9]]) {
    g.score = sc;
    g.bombs = []; g.bombPhase = 'gap'; g.bombNextAt = 0; g.clockMs = 1000 + sizes.length;
    g._updateBombs();
    sizes.push(g.bombs.length);
    assert.equal(g.bombs.length, expect, `wave of ${expect} at ${sc}`);
  }
  g.score = 20;                                // fell back under most marks
  g.bombs = []; g.bombPhase = 'gap'; g.bombNextAt = 0;
  g._updateBombs();
  assert.equal(g.bombs.length, 9, 'the wave never demotes when the score falls');

  // waves keep coming far past the last mark, every one exactly nine
  g.score = 200; g.bombs = []; g.bombPhase = 'gap'; g.bombNextAt = 0; g.clockMs = 0;
  const waves = [];
  let prev = 0;
  for (let i = 0; i < 400; i++) {
    g.clockMs += 500;
    g._updateBombs();
    if (prev === 0 && g.bombs.length > 0) waves.push(g.bombs.length);
    prev = g.bombs.length;
  }
  assert.ok(waves.length >= 8, `waves keep arriving at 200 points (${waves.length} in 200s)`);
  assert.ok(waves.every(n => n === 9), 'and every one of them is nine blocks');
});

test('the ghost ladder: one per mark from 10, five for ever', () => {
  assert.deepEqual(GHOST_SCORES, [10, 20, 30, 40, 50]);
  const g = quietGame();
  foodFar(g);
  for (const [sc, expect] of [[0, 0], [9, 0], [10, 1], [20, 2], [50, 5], [400, 5]]) {
    g.score = sc;
    for (let i = 0; i < 8; i++) g._updateGhosts();
    assert.equal(g.ghosts.length, expect, `${expect} ghosts at ${sc}`);
  }
  g.score = 0;
  for (let i = 0; i < 8; i++) g._updateGhosts();
  assert.equal(g.ghosts.length, 5, 'a ghost never leaves once it is on');
});

// ------------------------------------------------------------------- the TNT
test('eating a TNT: -5 points, -5 segments, floored, never fatal, streak untouched', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[4, 5], [3, 5], [2, 5], [1, 5], [0, 5], [19, 5], [18, 5], [17, 5], [16, 5], [15, 5]], 1, 0);
  g.score = 12; g.regularEaten = 3;
  g.bombs = [{ x: 5, y: 5 }]; g.bombPhase = 'active'; g.bombExpireAt = 1e12;
  g._step();
  assert.equal(g.snake.length, 5, 'five segments off a ten long snake');
  assert.equal(g.score, 7, 'and five points');
  assert.equal(g.regularEaten, 3, 'the bonus streak is untouched');
  assert.ok(!g.cellOccupied(15, 5), 'the occupancy set let go of the lost segments');
  assert.equal(g.bombs.length, 0, 'the block it ate is gone');

  const h = quietGame();
  foodFar(h);
  setSnake(h, [[4, 5], [3, 5], [2, 5]], 1, 0);
  h.score = 3;
  h.bombs = [{ x: 5, y: 5 }]; h.bombPhase = 'active'; h.bombExpireAt = 1e12;
  h._step();
  assert.equal(h.snake.length, START_LEN, 'never below the starting length');
  assert.equal(h.score, -2, 'the score may go negative');
  assert.equal(h.alive, true, 'and a TNT never kills');
});

// ---------------------------------------------------------------- the streak
test('a ringed bonus lands on every sixth food, and a miss resets the count', () => {
  assert.equal(BONUS_EVERY, 5);
  const g = quietGame();
  const eatOnce = () => {
    const f = g.food;
    const was = f.bonus;
    setSnake(g, [[(f.x - 1 + GRID) % GRID, f.y], [(f.x - 2 + GRID) % GRID, f.y], [(f.x - 3 + GRID) % GRID, f.y]], 1, 0);
    g._step();
    return was ? 'B' : 'r';
  };
  let run = '';
  for (let n = 0; n < 12; n++) run += eatOnce();
  assert.equal(run, 'rrrrrBrrrrrB', 'a ringed one on every sixth food, without fail');

  // let the ringed one on the board time out on the real clock
  assert.ok(g.food.bonus === false && g.regularEaten === 0, 'the second bonus reset the count');
  for (let n = 0; n < 5; n++) eatOnce();
  assert.ok(g.food.bonus, 'the ringed one is out');
  g.foodAge = FOOD_TTL - SIM_DT;
  g.advance(SIM_DT);
  assert.ok(!g.food.bonus, 'a ringed one you did not reach is replaced by a plain one');
  assert.equal(g.regularEaten, 0, 'and the streak drops all the way back');
  run = '';
  for (let n = 0; n < 6; n++) run += eatOnce();
  assert.equal(run, 'rrrrrB', 'so the miss really cost five more plain ones');
});

// ------------------------------------------------------------------ placement
test('windows never open on anything, and the ends are a real jump apart', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[8, 10], [7, 10], [6, 10]], 1, 0);
  for (let i = 0; i < 300; i++) {
    g.portal = null;
    assert.ok(g._spawnPortal(), 'a pair finds room on an empty board');
    const p = g.portal;
    assert.ok(wrapDist(p.ax, p.ay, p.bx, p.by) >= PORTAL_MIN_GAP, 'ends a real jump apart');
    assert.ok(wrapDist(p.ax, p.ay, 8, 10) >= MIN_SPAWN_DIST, 'the blue end keeps its distance');
    for (const c of g.snake) {
      assert.ok(!(c.x === p.ax && c.y === p.ay) && !(c.x === p.bx && c.y === p.by), 'never on the snake');
    }
  }
  assert.ok(g.cellOccupied(g.portal.ax, g.portal.ay) && g.cellOccupied(g.portal.bx, g.portal.by),
    'nothing else may spawn on a window');
});

// ------------------------------------------------------------------ soak
test('a busy minute at full unlock: caps hold and the sim survives', () => {
  const g = createGame({ seed: 31337 });
  g.score = 95;
  let maxBombs = 0, maxGhosts = 0, opens = 0, deaths = 0;
  for (let i = 0; i < 3600; i++) {
    if (!g.alive) {
      deaths++;
      setSnake(g, [[8, 10], [7, 10], [6, 10]], 1, 0);
      g.alive = true; g.deadReason = null;
    }
    g.advance(FRAME);
    maxBombs = Math.max(maxBombs, g.bombs.length);
    maxGhosts = Math.max(maxGhosts, g.ghosts.length);
    // count openings from the events channel: a close-and-reopen can land
    // inside one frame, which edge-detecting the state would miss
    for (const e of g.drainEvents()) if (e.t === 'portal' && e.open) opens++;
  }
  assert.ok(maxBombs <= 9, `never more than nine blocks (saw ${maxBombs})`);
  assert.ok(maxGhosts <= 5, `never more than five ghosts (saw ${maxGhosts})`);
  assert.ok(opens >= 3, `owed pairs keep opening (${opens}) through a busy minute`);
});

// ------------------------------------------------------- ghost render helper
test('a hopping ghost renders in the window it left, then the far one', () => {
  const gh = { x: 15, y: 15, px: 5, py: 5, dir: { x: 1, y: 0 }, warped: true, moveAt: GHOST_MS };
  const early = ghostRenderPos(gh, GHOST_MS * 0.25);
  const late = ghostRenderPos(gh, GHOST_MS * 0.75);
  assert.deepEqual({ x: early.cx, y: early.cy }, { x: 5, y: 5 });
  assert.deepEqual({ x: late.cx, y: late.cy }, { x: 15, y: 15 });
});

// ---------------------------------------------------------------- purity
test('the engine source touches no host API', () => {
  // The engine must run identically in a browser module, a Reanimated
  // worklet, Node and Deno, and stay deterministic. Any of these tokens
  // appearing in the source is a portability or determinism leak. (The app
  // side enforces its half with ESLint; the engine is plain JS, so the test
  // IS its linter.)
  const raw = readFileSync(new URL('./engine.js', import.meta.url), 'utf8');
  // scan code, not commentary: the header is allowed to SAY "no Math.random"
  const src = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const banned of [
    'Math.random', 'Date.now', 'new Date', 'performance.',
    'setTimeout', 'setInterval', 'requestAnimationFrame',
    'document.', 'window.', 'navigator.', 'localStorage', 'fetch(',
    'console.',
  ]) {
    assert.ok(!src.includes(banned), `engine source must not contain "${banned}"`);
  }
});

test('the two-thumb drill: 20 alternating taps all land', () => {
  // down-left-down-left at 140ms per tap against a 130ms tick: consumption
  // keeps up, the queue never saturates, and every one of the 20 turns must
  // execute. This is the exact drill reported from device testing; if a turn
  // ever skips with this passing, the loss is in input delivery, not here.
  const g = quietGame({ tickMs: 130 });
  foodFar(g);
  setSnake(g, [[10, 3], [9, 3], [8, 3]], 1, 0);
  let taps = 0;
  let turns = 0;
  let lastDir = `${String(g.dir.x)},${String(g.dir.y)}`;
  for (let q = 0; q < 4000; q++) {
    if (q % 14 === 0 && taps < 20) {
      const d = taps % 2 === 0 ? [0, 1] : [-1, 0];   // down, left, down, left...
      g.setDir(d[0] ?? 0, d[1] ?? 0);
      taps++;
    }
    g.advanceQuanta(1);
    const dir = `${String(g.dir.x)},${String(g.dir.y)}`;
    if (dir !== lastDir) {
      turns++;
      lastDir = dir;
    }
    if (!g.alive) break;
  }
  assert.equal(g.alive, true, 'the staircase run survives');
  assert.equal(taps, 20, 'all twenty taps were issued');
  assert.equal(turns, 20, 'and every single one executed as a turn');
});

// ---------------------------------------------------------- ghost personalities
test('five personalities, five targets, speed untouched', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[10, 10], [9, 10], [8, 10]], 1, 0);   // head (10,10) heading right
  g.food = { x: 3, y: 16, bonus: false, kind: 0 };
  const mk = (role, x, y) => ({ x, y, px: x, py: y, dir: { x: 0, y: 0 }, warped: false, role, moveAt: 0 });

  assert.deepEqual(g._ghostTarget(mk(0, 2, 2)), { x: 10, y: 10 }, 'the chaser targets the head');
  assert.deepEqual(g._ghostTarget(mk(1, 2, 2)), { x: 14, y: 10 }, 'the ambusher targets four ahead of the heading');
  // wrap check: heading right from x=18 puts four-ahead at x=2
  setSnake(g, [[18, 5], [17, 5], [16, 5]], 1, 0);
  assert.deepEqual(g._ghostTarget(mk(1, 2, 2)), { x: 2, y: 5 }, 'and it wraps through the tunnel');
  setSnake(g, [[10, 10], [9, 10], [8, 10]], 1, 0);

  assert.deepEqual(g._ghostTarget(mk(2, 1, 19)), { x: 10, y: 10 }, 'the flanker far away chases the head');
  assert.deepEqual(g._ghostTarget(mk(2, 8, 10)), { x: 0, y: 19 }, 'and near the head swings to its post');

  // the cutoff doubles the vector from the chaser through two-ahead
  g.ghosts.length = 0;
  g.ghosts.push(mk(0, 8, 8));                          // the chaser
  // pivot = (12,10); delta from chaser = (+4,+2); target = (16,12)
  assert.deepEqual(g._ghostTarget(mk(3, 2, 2)), { x: 16, y: 12 }, 'the cutoff arrives on the far side');

  const wardenTarget = g._ghostTarget(mk(4, 2, 2));
  assert.equal(`${String(wardenTarget.x)},${String(wardenTarget.y)}`, '3,16', 'the warden camps the food');
});

test('the chaser closes distance and reaches lethal range, deterministically', () => {
  const g = quietGame({ seed: 99 });
  foodFar(g);
  setSnake(g, [[10, 3], [9, 3], [8, 3]], 1, 0);
  g.ghosts.push({ x: 10, y: 13, px: 10, py: 13, dir: { x: 0, y: 0 }, warped: false, role: 0, moveAt: 0 });
  const gh = g.ghosts[0];
  assert.ok(gh, 'ghost placed');
  const startDist = wrapDist(gh.x, gh.y, 10, 3);
  for (let n = 0; n < 12; n++) g._moveGhost(gh);
  const endDist = wrapDist(gh.x, gh.y, 10, 3);
  assert.ok(endDist < startDist - 4, `it closes hard on a still head (from ${String(startDist)} to ${String(endDist)})`);
});

test('personalities and contact survive the replay contract', () => {
  const g = createGame({ seed: 424242, tickMs: 130 });
  assert.equal(g.log.v, ENGINE_VERSION, 'rounds record as the current engine version');
  const script = [[40, 0, 1], [90, 1, 0], [200, 0, -1], [700, -1, 0]];
  let s = 0;
  for (let q = 0; q < 60000 && g.alive; q++) {
    while (s < script.length && script[s][0] === q) { g.setDir(script[s][1] ?? 0, script[s][2] ?? 0); s++; }
    g.advanceQuanta(1);
  }
  assert.equal(g.alive, false, 'the round ended');
  const r = replay(g.log);
  assert.equal(r.score, g.score, 'ghost decisions replay identically under seeded targeting');
  assert.deepEqual(r.snake, g.snake);
});

test('speed run: the whistle at exactly durationMs, and the log replays it', () => {
  // A short timed round on a quiet board: the snake runs straight and wraps,
  // nothing can kill it, so the only possible end is the clock. The whistle
  // must land on the exact final quantum, the reason must read 'time', and
  // the log must carry the duration so a replay ends the same way.
  const g = quietGame({ tickMs: 100, durationMs: 3000 });
  foodFar(g);
  g.advanceQuanta(299);
  assert.equal(g.alive, true, 'one quantum before the minute the round is live');
  g.advanceQuanta(1);
  assert.equal(g.alive, false, 'the whistle lands at exactly durationMs');
  assert.equal(g.deadReason, 'time');
  assert.equal(g.clockMs, 3000);
  assert.equal(g.log.durationMs, 3000, 'the duration is part of the record');
  const r = replay(g.log);
  assert.equal(r.deadReason, 'time', 'a replay ends on the same whistle');
  assert.equal(r.score, g.score);
  assert.equal(r.quanta, g.quanta);
  assert.equal(MODES.speedrun.durationMs, 60_000, 'the shipping mode is one minute');
  assert.equal(createGame({ seed: 1 }).durationMs, 0, 'classic stays endless');
  assert.throws(() => createGame({ seed: 1, durationMs: 1234 }), /multiple of SIM_DT/);
});

test('survival: the full ladder at the kickoff whistle, a clear five away', () => {
  const g = quietGame({ startGhosts: 5, startBombs: 9 });
  assert.equal(g.snake.length, START_LEN, 'minimum length');
  assert.equal(g.score, 0, 'zero points');
  assert.equal(g.ghosts.length, 5, 'all five personalities present');
  assert.deepEqual(g.ghosts.map((x) => x.role), [0, 1, 2, 3, 4]);
  assert.equal(g.bombs.length, 9, 'a full nine-block wave down');
  assert.equal(g.bombPhase, 'active');
  const h = g.snake[0];
  for (const gh of g.ghosts) assert.ok(wrapDist(gh.x, gh.y, h.x, h.y) >= 5, 'every ghost a clear five away');
  for (const b of g.bombs) assert.ok(wrapDist(b.x, b.y, h.x, h.y) >= 5, 'every TNT a clear five away');
  assert.equal(g.log.startGhosts, 5, 'the opening rides in the log');
  assert.equal(g.log.startBombs, 9);
  g.score = 200;                            // the ladder never grows a sixth ghost
  g._updateGhosts();
  assert.equal(g.ghosts.length, 5);
  assert.throws(() => createGame({ seed: 1, startBombs: 99 }), /out of range/);
});

test('survival: waves stay at nine for ever, even at zero points', () => {
  const g = quietGame({ startBombs: 9 });
  g.bombs.length = 0;                       // the opening wave expires
  g.bombPhase = 'gap';
  g.bombNextAt = g.clockMs;
  g._updateBombs();
  assert.equal(g.bombs.length, 9, 'the next wave is nine blocks at score 0');
  assert.equal(g.bombPhase, 'active');
});

test('survival: a full round replays exactly', () => {
  const g = createGame({ seed: 909, tickMs: 100, ...MODES.survival });
  const script = [[30, 0, 1], [80, -1, 0], [140, 0, -1], [200, 1, 0]];
  let i = 0;
  for (let q = 0; q < 60000 && g.alive; q++) {
    while (i < script.length && script[i][0] === q) { g.setDir(script[i][1], script[i][2]); i++; }
    g.advanceQuanta(1);
  }
  assert.equal(g.alive, false, 'five hunters from the whistle end the round inside a minute');
  const r = replay(g.log);
  assert.equal(r.score, g.score);
  assert.equal(r.deadReason, g.deadReason);
  assert.deepEqual(r.snake, g.snake);
});

test('contact: a ghost sliding majority-onto the head kills between snake steps', () => {
  // SLOW tick (200): head at (5,5) heading right steps at 200ms. A ghost is
  // mid-glide from (5,4) into (5,5); its majority cell flips there at 250ms,
  // when the head has ALREADY stepped to (6,5) in state but is still drawn
  // majority-in (5,5) (its trailing half). The old cell-entry check saw
  // nothing; the majority rule is a hit at exactly that quantum.
  const g = quietGame({ tickMs: 200 });
  foodFar(g);
  setSnake(g, [[5, 5], [4, 5], [3, 5]], 1, 0);
  g.ghosts.push({ x: 5, y: 5, px: 5, py: 4, dir: { x: 0, y: 1 }, warped: false, role: 0,
                  moveAt: g.clockMs + 500 });
  g.advanceQuanta(24);
  assert.equal(g.alive, true, 'at 240ms the ghost is still minority in the cell: no contact');
  g.advanceQuanta(1);
  assert.equal(g.alive, false, 'at 250ms both majorities sit in (5,5)');
  assert.equal(g.deadReason, 'ghost');
});

test('contact: brushing past ahead of the flip is a survivable near miss', () => {
  // NORMAL-ish tick (100): the same encroaching ghost, but the head clears
  // the contested cell (majority moves on at 150ms) before the ghost's
  // majority arrives at 250ms. Their sprites brushed; majorities never met.
  const g = quietGame({ tickMs: 100 });
  foodFar(g);
  setSnake(g, [[5, 5], [4, 5], [3, 5]], 1, 0);
  g.ghosts.push({ x: 5, y: 5, px: 5, py: 4, dir: { x: 0, y: 1 }, warped: false, role: 0,
                  moveAt: g.clockMs + 500 });
  g.advanceQuanta(40);
  assert.equal(g.alive, true, 'the head outran the flip: no contact at any quantum');
});

test('contact: exchanging cells inside one quantum is a crossing, and lethal', () => {
  // Head (6,5) heading left; ghost gliding (5,5) -> (6,5). Tick 100 puts the
  // head majority flip into (5,5) at 150ms; moveAt 400 puts the ghost flip
  // into (6,5) at the same 150ms quantum. Neither majority ever equals the
  // other AT a quantum boundary: they swap. The crossing clause catches it.
  const g = quietGame({ tickMs: 100 });
  foodFar(g);
  setSnake(g, [[6, 5], [7, 5], [8, 5]], -1, 0);
  g.ghosts.push({ x: 6, y: 5, px: 5, py: 5, dir: { x: 1, y: 0 }, warped: false, role: 0,
                  moveAt: g.clockMs + 400 });
  g.advanceQuanta(14);
  assert.equal(g.alive, true, 'at 140ms they are approaching, not touching');
  g.advanceQuanta(1);
  assert.equal(g.alive, false, 'at 150ms the two majorities swap cells: paths crossed');
  assert.equal(g.deadReason, 'ghost');
});

test('ghosts route through portals on purpose, and never through spent ones', () => {
  // metric first: with an open pair the wormhole route must price in
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[17, 17], [16, 17], [15, 17]], 1, 0);
  g.portal = { ax: 3, ay: 2, bx: 16, by: 16, used: false };
  const direct = wrapDist(2, 2, 17, 17);
  const via = g._ghostDist(2, 2, 17, 17);
  assert.ok(via < direct, `the wormhole route is shorter (${String(via)} vs direct ${String(direct)})`);
  assert.equal(via, 1 + 1 + wrapDist(16, 16, 17, 17), 'priced as walk to the end, one hop, walk out');
  g.portal.used = true;
  assert.equal(g._ghostDist(2, 2, 17, 17), direct, 'a spent pair prices as if it were not there');

  // behavior second: a chaser far from the head, with a window at its feet
  // whose far side opens next to the head, dives through
  const h = quietGame({ seed: 11 });
  foodFar(h);
  setSnake(h, [[17, 17], [16, 17], [15, 17]], 1, 0);
  h.portal = { ax: 3, ay: 2, bx: 16, by: 15, used: false };
  h.portalExpireAt = 1e12;
  h.ghosts.push({ x: 2, y: 2, px: 2, py: 2, dir: { x: 0, y: 0 }, warped: false, role: 0, moveAt: 0 });
  const gh = h.ghosts[0];
  assert.ok(gh, 'ghost placed');
  let hopped = false;
  for (let n = 0; n < 8 && !hopped; n++) {
    h._moveGhost(gh);
    if (gh.x === h.portal.bx && gh.y === h.portal.by) hopped = true;
  }
  assert.ok(hopped, 'the chaser walked into the window and surfaced beside the head');
});

// ------------------------------------------------------------ golden fixtures
// Rounds recorded by the v4 (single-snake) engine, committed as JSON. The
// multi-snake refactor must replay them to the identical final state: this is
// the proof that one snake on the new machine IS the old machine.
test('v4 golden rounds replay bit-identically on the multi-snake engine', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/v4.json', import.meta.url), 'utf8'));
  const names = Object.keys(fx);
  assert.deepEqual(names, ['classic', 'survival', 'speedrun'], 'all three modes are pinned');
  for (const name of names) {
    const f = fx[name];
    assert.equal(f.log.v, 4, `${name}: the fixture really is a v4 log`);
    const r = replay(f.log);
    assert.equal(r.score, f.score, `${name}: same final score`);
    assert.equal(r.deadReason, f.deadReason, `${name}: same end`);
    assert.equal(r.quanta, f.quanta, `${name}: same length`);
    assert.deepEqual(r.snake, f.snake, `${name}: same final body`);
  }
});

// ------------------------------------------------------------- multi-snake
function setPlayerSnake(g, i, cells, dx, dy) {
  const p = g.players[i];
  p.snake.length = 0;
  p.snakeSet.clear();
  for (const [x, y] of cells) { p.snake.push({ x, y }); p.snakeSet.add(K(x, y)); }
  p.tailFrom = null;
  p.dirQueue.length = 0;
  p.pendingGrowth = 0;
  p.dir = { x: dx, y: dy };
  p.headFrom.x = cells[0][0]; p.headFrom.y = cells[0][1];
  p.headMajX = cells[0][0]; p.headMajY = cells[0][1];
}

test('multi-snake: lanes, validation, and the solo row unchanged', () => {
  assert.equal(MAX_PLAYERS, 5);
  const g = createGame({ seed: 5, players: 5 });
  assert.equal(g.players.length, 5);
  assert.deepEqual(g.players.map(p => p.snake[0].y), [2, 6, 10, 14, 18], 'five evenly spaced lanes');
  for (const p of g.players) {
    assert.equal(p.snake.length, START_LEN);
    assert.equal(p.snake[0].x, 8, 'everyone starts at the classic column');
    assert.deepEqual(p.dir, { x: 1, y: 0 });
  }
  assert.equal(createGame({ seed: 5 }).players[0].snake[0].y, 10, 'one snake starts on the classic row');
  assert.throws(() => createGame({ seed: 1, players: 0 }), /players out of range/);
  assert.throws(() => createGame({ seed: 1, players: 6 }), /players out of range/);
  assert.throws(() => createGame({ seed: 1, players: 2.5 }), /players out of range/);
});

test('a one-snake log keeps the classic triple shape', () => {
  const g = quietGame();
  foodFar(g);
  setSnake(g, [[8, 10], [7, 10], [6, 10]], 1, 0);
  g.setDir(0, 1);
  assert.deepEqual(g.log.inputs[0], [0, 0, 1], 'no player column on a solo log');
  assert.equal(g.log.players, 1);
});

test('multi-snake: same seed and inputs give the identical round, and the log replays it', () => {
  const script = [[40, 0, -1, 0], [45, 0, 1, 1], [90, -1, 0, 2], [140, 0, 1, 3],
                  [200, 1, 0, 4], [400, 0, -1, 2], [900, -1, 0, 0]];
  const run = () => {
    const g = createGame({ seed: 4242, tickMs: 100, players: 5, ...MODES.survival });
    let s = 0;
    for (let q = 0; q < 120000 && g.alive; q++) {
      while (s < script.length && script[s][0] === q) { g.setDir(script[s][1], script[s][2], script[s][3]); s++; }
      g.advanceQuanta(1);
    }
    return g;
  };
  const a = run(), b = run();
  assert.equal(a.alive, false, 'five unattended snakes among five hunters all fall');
  assert.deepEqual(a.players.map(p => p.score), b.players.map(p => p.score));
  assert.deepEqual(a.players.map(p => p.diedAt), b.players.map(p => p.diedAt));
  assert.equal(a.quanta, b.quanta);
  assert.equal(a.log.players, 5);
  assert.ok(a.log.inputs.every(e => e.length === 4), 'a multi-snake log carries the player column');
  assert.deepEqual(a.log.finalScores, a.players.map(p => p.score), 'the record carries every score');
  assert.deepEqual(a.log.diedAt, a.players.map(p => p.diedAt), 'and every death time');
  const r = replay(a.log);
  assert.deepEqual(r.players.map(p => p.score), a.players.map(p => p.score));
  assert.deepEqual(r.players.map(p => p.deadReason), a.players.map(p => p.deadReason));
  assert.equal(r.quanta, a.quanta);
});

test('multi-snake: one food, first index wins the same-quantum race', () => {
  const g = quietGame({ players: 2 });
  g.food = { x: 6, y: 5, bonus: false, kind: 0 };
  g.foodAge = 0;
  setPlayerSnake(g, 0, [[5, 5], [4, 5], [3, 5]], 1, 0);
  setPlayerSnake(g, 1, [[7, 5], [8, 5], [9, 5]], -1, 0);
  g._stepPlayer(0); g._stepPlayer(1);
  assert.equal(g.players[0].score, 1, 'the lower index takes the contested bite');
  assert.equal(g.players[1].score, 0, 'the other head goes hungry');
  assert.ok(!(g.food.x === 6 && g.food.y === 5), 'the food moved the instant it was eaten');
  assert.ok(g.players[0].alive && g.players[1].alive, 'two heads on one cell is a race, not a wreck');
});

test('multi-snake: snakes pass through each other; ghosts still kill their own', () => {
  const g = quietGame({ players: 2 });
  foodFar(g);
  setPlayerSnake(g, 0, [[5, 5], [4, 5], [3, 5]], 1, 0);
  setPlayerSnake(g, 1, [[7, 5], [8, 5], [9, 5]], -1, 0);
  for (let n = 0; n < 6; n++) { g._stepPlayer(0); g._stepPlayer(1); }
  assert.ok(g.players[0].alive && g.players[1].alive, 'straight through each other, both alive');

  const h = quietGame({ players: 2, tickMs: 200 });
  foodFar(h);
  setPlayerSnake(h, 0, [[2, 15], [1, 15], [0, 15]], 1, 0);
  setPlayerSnake(h, 1, [[5, 5], [4, 5], [3, 5]], 1, 0);
  h.ghosts.push({ x: 5, y: 5, px: 5, py: 4, dir: { x: 0, y: 1 }, warped: false, role: 0,
                  moveAt: h.clockMs + 500 });
  h.advanceQuanta(25);
  assert.equal(h.players[1].alive, false, 'the ghost took the snake it was on');
  assert.equal(h.players[1].deadReason, 'ghost');
  assert.equal(h.players[0].alive, true, 'and nobody else');
  assert.equal(h.alive, true, 'the round goes on without the fallen');
  assert.equal(h.players[1].snake.length, 0, 'the fallen snake left the board');
  assert.ok(!h.cellOccupied(4, 5) || h.players[0].snakeSet.has(K(4, 5)),
    'its cells are free ground again');
});

test('multi-snake: the hazard ladder follows the leader, not you', () => {
  const g = quietGame({ players: 3 });
  foodFar(g);
  g.players[2].score = 15;                       // the leader is another snake
  g.clockMs = 1000; g.bombs = []; g.bombPhase = 'gap'; g.bombNextAt = 0;
  g._updateBombs();
  assert.equal(g.bombs.length, 1, "TNT arrives on the leader's 15, player 0 still at zero");
  g.players[1].score = 20;
  for (let i = 0; i < 8; i++) g._updateGhosts();
  assert.equal(g.ghosts.length, 2, 'two ghosts at a leader score of 20');
  g.players[1].score = 25;                       // a new leader crosses the next mark
  g._updateBombs();
  assert.equal(g.bombsUnlocked, 2, 'the wave size follows whoever is ahead');
  g.players[1].score = 4;                        // a TNT knocked the leader down
  g.players[2].score = 3;
  g._updateBombs();
  assert.equal(g.bombsUnlocked, 2, 'and nothing de-escalates');
});

test('multi-snake: the whistle drops everyone at once, bodies in place', () => {
  const g = quietGame({ players: 3, tickMs: 100, durationMs: 1000 });
  foodFar(g);
  g.advanceQuanta(100);
  assert.equal(g.alive, false, 'the whistle ends the round for the room');
  for (const p of g.players) {
    assert.equal(p.deadReason, 'time');
    assert.equal(p.diedAt, 100);
    assert.equal(p.snake.length, START_LEN, 'a whistle leaves the bodies on the field');
  }
  assert.deepEqual(g.log.diedAt, [100, 100, 100]);
});

test('multi-snake: a ghost hunts the nearest head, and inherits the survivors', () => {
  const g = quietGame({ players: 2 });
  foodFar(g);
  setPlayerSnake(g, 0, [[2, 2], [1, 2], [0, 2]], 1, 0);
  setPlayerSnake(g, 1, [[15, 15], [14, 15], [13, 15]], 1, 0);
  const mk = (role, x, y) => ({ x, y, px: x, py: y, dir: { x: 0, y: 0 }, warped: false, role, moveAt: 0 });
  assert.deepEqual(g._ghostTarget(mk(0, 14, 14)), { x: 15, y: 15 }, 'the chaser hunts the nearer head');
  assert.deepEqual(g._ghostTarget(mk(0, 3, 3)), { x: 2, y: 2 }, 'each ghost picks its own victim');
  g.players[1].alive = false; g.players[1].snake.length = 0; g.players[1].snakeSet.clear();
  assert.deepEqual(g._ghostTarget(mk(0, 14, 14)), { x: 2, y: 2 }, 'the fallen are no longer hunted');
});

test('multi-snake: one trip a pair, even with two heads committed', () => {
  const g = quietGame({ players: 2 });
  foodFar(g);
  g.portal = PAIR();
  setPlayerSnake(g, 0, [[5, 5], [4, 5], [3, 5]], 1, 0);      // committed in the blue end
  setPlayerSnake(g, 1, [[15, 15], [15, 16], [15, 17]], 0, -1); // committed in the violet end
  g._stepPlayer(0); g._stepPlayer(1);
  assert.ok(cellEq(g.players[0].snake[0], 15, 15), 'the first index takes the trip');
  assert.equal(g.players[0].score, PORTAL_BONUS, 'and the prize');
  assert.ok(g.portal.used, 'the pair is spent');
  assert.ok(cellEq(g.players[1].snake[0], 15, 14), 'the other head just walks on');
  assert.equal(g.players[1].score, 0);
  assert.ok(g.players[0].alive && g.players[1].alive, 'sharing the landing cell is fine: snakes pass through');
});

test('multi-snake: the last snake standing clinches by passing the field, not by outliving it', () => {
  const g = quietGame({ players: 2 });
  foodFar(g);
  setPlayerSnake(g, 0, [[5, 5], [4, 5], [3, 5]], 1, 0);
  const p1 = g.players[1];
  p1.alive = false; p1.deadReason = 'wall'; p1.diedAt = 10;
  p1.snake.length = 0; p1.snakeSet.clear();
  p1.score = 3;
  g.players[0].score = 3;
  g.advanceQuanta(1);
  assert.equal(g.alive, true, 'level on points is not past them: the round goes on');
  g.food = { x: 8, y: 5, bonus: false, kind: 0 };
  g.foodAge = 0;
  let guard = 600;
  while (g.alive && guard-- > 0) g.advanceQuanta(1);
  assert.equal(g.alive, false, 'the survivor ate past the field and the round ended');
  assert.equal(g.players[0].deadReason, 'won', 'the end is a win, not a death');
  assert.equal(g.players[0].score, 4);
  assert.equal(g.log.finalScore, 4);
  assert.ok(g.players[0].snake.length >= START_LEN, 'the champion keeps their body on the field');
});

test('multi-snake: a leader outliving the last rival clinches on the same quantum', () => {
  const g = quietGame({ players: 2 });
  foodFar(g);
  setPlayerSnake(g, 0, [[5, 15], [4, 15], [3, 15]], 1, 0);
  setPlayerSnake(g, 1, [[5, 5], [4, 5], [3, 5]], 1, 0);
  g.players[0].score = 5;
  g.players[1].score = 3;
  g.wallState = 'solid';
  g.wallLookup = new Set([K(6, 5)]);       // the next cell of snake 1's path
  g.advanceQuanta(13);                     // one full tick at the default pace
  assert.equal(g.players[1].deadReason, 'wall', 'the trailing snake hit the wall');
  assert.equal(g.players[0].deadReason, 'won', 'and the leader clinched instantly');
  assert.equal(g.players[0].diedAt, g.players[1].diedAt, 'both stamped on the same quantum');
  assert.equal(g.alive, false);
  const solo = quietGame();
  solo.score = 500;
  solo.advanceQuanta(50);
  assert.equal(solo.alive, true, 'a solo round never clinches');
});

// ------------------------------------------------------------- rollback
test('snapshot/restore: a rollback resim reproduces the straight run exactly', () => {
  const mk = () => createGame({ seed: 777, tickMs: 100, players: 2, ...MODES.survival });
  const inputs = [[120, 0, -1, 0], [180, -1, 0, 1], [260, 0, 1, 0], [400, 1, 0, 1]];
  const drive = (g, list, from, to) => {
    for (let q = from; q < to && g.alive; q++) {
      for (const e of list) if (e[0] === q) g.setDir(e[1], e[2], e[3]);
      g.advanceQuanta(1);
    }
  };
  // straight run: every input known on time
  const a = mk();
  drive(a, inputs, 0, 600);
  // laggy run: the quantum-260 input arrives late; roll back and repair
  const late = inputs.filter(e => e[0] !== 260);
  const b = mk();
  drive(b, late, 0, 200);
  const snap = b.snapshot();
  drive(b, late, 200, 320);                 // sailed past 260 without it
  b.restore(snap);
  drive(b, inputs, 200, 600);               // resim with the full record
  assert.deepEqual(b.snapshot(), a.snapshot(), 'the repaired timeline IS the straight one, PRNG and log included');
});

test('snapshot/restore round-trips a solo game too', () => {
  const g = createGame({ seed: 2024 });
  g.advanceQuanta(500);
  const snap = g.snapshot();
  const before = JSON.stringify(snap);
  g.setDir(0, 1);
  g.advanceQuanta(700);
  g.restore(JSON.parse(before));
  assert.equal(JSON.stringify(g.snapshot()), before, 'restore reinstates the exact machine');
  g.setDir(0, 1);
  g.advanceQuanta(700);
  const h = createGame({ seed: 2024 });
  h.advanceQuanta(500);
  h.setDir(0, 1);
  h.advanceQuanta(700);
  assert.deepEqual(g.snapshot(), h.snapshot(), 'and the resimulated future matches a straight run');
});
