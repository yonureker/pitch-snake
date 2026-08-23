// Pitch Snake engine: the rules and nothing else.
//
// This module is the only copy of the game. The web page, the mobile app and
// the server-side replay validator all import it, so it must stay free of every
// host API: no DOM, no canvas, no fetch, no storage, no timers, no
// Math.random. It runs as-is in a browser module, a Reanimated worklet, Node
// and Deno.
//
// Determinism is the point. A game is created with a seed, every random
// decision comes from that seed, and the simulation advances in fixed
// SIM_DT quanta rather than by raw frame time, so the whole round is a pure
// function of (seed, config, inputs). setDir records each accepted input with
// the quantum it arrived on, and replay() re-runs a finished log to the same
// score, which is what makes a submitted score checkable on the server.
// Every tick length (200 / 130 / 100) and every timing constant is a multiple
// of SIM_DT, so steps land exactly on quanta and nothing drifts.
//
// The engine never blocks and never allocates in steady state beyond what the
// old inline version did. Rendering concerns (particles, sprites, colours,
// interpolation) live with the renderers; the engine reports what happened
// through an events array the caller drains once per frame.

export const ENGINE_VERSION = 1;

export const GRID = 20;
export const START_LEN = 3;    // initial snake length; TNT can't shrink below this
export const SIM_DT = 10;      // ms per simulation quantum; everything is a multiple of it

// speeds, ms per grid cell: the snake never changes pace mid-round (rule 14).
// The tick length IS the reaction budget: a turn can only land at the next
// cell boundary. NORMAL is the reference pace for anything cross-machine.
export const SPEEDS = { slow: 200, normal: 130, fast: 100 };

export const FOOD_TTL = 5000;      // uneaten food relocates after this long
export const BONUS_EVERY = 5;      // a ringed +5 appears after this many regular emojis
export const REGULAR_KINDS = 16;   // how many regular food looks the renderer offers
export const BONUS_KINDS = 5;      // how many ringed looks

export const WARN_MS = 1800, SOLID_MS = 9000;   // walls: forming, then lethal

export const TNT_SCORES = [15, 25, 35, 45, 55, 65, 75, 85, 95];
export const BOMB_GAP_MIN = 6000, BOMB_GAP_MAX = 12000;
export const BOMB_LIFE_MIN = 3800, BOMB_LIFE_MAX = 5600;

export const GHOST_SCORES = [10, 20, 30, 40, 50];
export const GHOST_MS = 500;       // ms per ghost step, fixed at every speed setting
const GHOST_DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];

// teleport windows: a pair falls due every PORTAL_EVERY points from
// PORTAL_FIRST, for ever (rule 22: a score gate scales a hazard, it never
// switches one off). Each pair carries exactly one trip, which pays
// PORTAL_BONUS. Keep PORTAL_BONUS under PORTAL_EVERY or paid trips buy the
// next window outright and the pairs chain.
export const PORTAL_FIRST = 10, PORTAL_EVERY = 20;
export const PORTAL_BONUS = 5;
export const PORTAL_LIFE_MIN = 8000, PORTAL_LIFE_MAX = 12000;
export const PORTAL_OPEN_MS = 320;   // the windows scale open over this
export const PORTAL_WARN_MS = 1500;  // ...and blink this long before timing out
export const PORTAL_MIN_GAP = 6;     // min cells between the ends: a hop is a real jump
export const portalMark = n => PORTAL_FIRST + n * PORTAL_EVERY;

export const MIN_SPAWN_DIST = 3;   // hazards spawn at least this far from the head

export const K = (x, y) => x * GRID + y;              // integer cell key, no strings
export const wrap = v => ((v % GRID) + GRID) % GRID;  // toroidal wrap, fraction-safe

// toroidal Manhattan distance, since the edges wrap
export function wrapDist(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return Math.min(dx, GRID - dx) + Math.min(dy, GRID - dy);
}

// Mirror seed cells across both center axes so a pattern is symmetric no
// matter which quadrant the seeds sit in.
function sym4(cells) {
  const s = new Set();
  for (const [x, y] of cells)
    for (const xx of [x, GRID - 1 - x])
      for (const yy of [y, GRID - 1 - y]) s.add(K(xx, yy));
  return s;
}

// A border seed builds the arena frame for one quadrant, leaving a centered
// gate; sym4 lines the gates up on opposite sides.
function borderSeeds(solidTo) {
  const c = [];
  for (let i = 0; i <= solidTo; i++) { c.push([i, 0]); c.push([0, i]); }
  return c;
}

const WALL_PATTERNS = [
  () => {                                   // thick plus / cross through center
    const c = [];
    for (let y = 5; y <= 9; y++) c.push([9, y]);
    for (let x = 5; x <= 9; x++) c.push([x, 9]);
    return sym4(c);
  },
  () => {                                   // four quadrant blocks
    const c = [];
    for (let x = 3; x <= 6; x++) for (let y = 4; y <= 6; y++) c.push([x, y]);
    return sym4(c);
  },
  () => {                                   // hollow center box, a door each side
    const c = [];
    for (let x = 6; x <= 8; x++) c.push([x, 6]);
    for (let y = 6; y <= 8; y++) c.push([6, y]);
    return sym4(c);
  },
  () => sym4(borderSeeds(6)),               // full frame, a gate mid each side
  () => sym4(borderSeeds(3)),               // corner brackets, wide gates
  () => {                                   // frame plus four inner pillars
    const c = borderSeeds(6);
    for (let x = 5; x <= 6; x++) for (let y = 5; y <= 6; y++) c.push([x, y]);
    return sym4(c);
  },
];

// mulberry32: small, fast, good-enough PRNG with a 32-bit seed. Not for
// crypto; for making a round reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 0..1 progress through a ghost's current glide between cells, at sim time now
export function ghostProgress(g, nowMs) {
  return Math.max(0, Math.min(1, 1 - (g.moveAt - nowMs) / GHOST_MS));
}

// Continuous cell coords of a ghost at time nowMs, following the shortest
// (wrapped) path. A hop through a window has nothing to interpolate across, so
// the ghost shows in the window it left for the first half of the glide and in
// the far one after that (rule 18). Pass a scratch object to stay
// allocation-free in render loops.
export function ghostRenderPos(g, nowMs, out) {
  out = out || { cx: 0, cy: 0 };
  let dx = g.x - g.px, dy = g.y - g.py;
  if (dx > 1) dx -= GRID; else if (dx < -1) dx += GRID;
  if (dy > 1) dy -= GRID; else if (dy < -1) dy += GRID;
  const p = ghostProgress(g, nowMs);
  if (dx > 1 || dx < -1 || dy > 1 || dy < -1) {
    out.cx = p < 0.5 ? g.px : g.x; out.cy = p < 0.5 ? g.py : g.y;
    return out;
  }
  out.cx = g.px + dx * p; out.cy = g.py + dy * p;
  return out;
}

export function createGame(cfg = {}) {
  const seed = (cfg.seed ?? 1) >>> 0;
  const tickMs = cfg.tickMs ?? SPEEDS.normal;
  const wallsEnabled = cfg.wallsEnabled ?? true;
  if (tickMs % SIM_DT !== 0) throw new Error('tickMs must be a multiple of SIM_DT');

  const random = mulberry32(seed);
  const rand = (a, b) => a + random() * (b - a);

  // S is both the internal state and the public surface: renderers read these
  // fields every frame, tests may poke them. Methods below close over S.
  const S = {
    seed, tickMs, wallsEnabled,
    alive: true,
    deadReason: null,
    quanta: 0,          // sim quanta elapsed; the replay clock
    clockMs: 0,         // one hazard clock (the old wall/bomb/ghost/portal clocks were identical)
    progMs: 0,          // ms into the current cell; renderProg() adds the sub-quantum remainder
    accMs: 0,           // dt not yet turned into quanta (always < SIM_DT after advance)

    snake: [], snakeSet: new Set(), tailFrom: null,
    dir: { x: 1, y: 0 }, dirQueue: [],
    score: 0, pendingGrowth: 0,

    food: null,         // {x, y, bonus, kind} — kind indexes the renderer's emoji list
    foodAge: 0, regularEaten: 0,

    wallState: 'off', wallPhaseEnd: 0, wallCells: [], wallLookup: new Set(),

    bombs: [], bombsUnlocked: 0, bombPhase: 'gap', bombNextAt: 0, bombExpireAt: 0,

    ghosts: [],         // {x, y, px, py, dir, warped, moveAt}

    portal: null,       // {ax, ay, bx, by, used}: the blue end, then the violet end
    warpedIn: false,
    portalsUnlocked: 0, portalsOpened: 0, portalRetryAt: 0,
    portalExpireAt: 0, portalOpenedAt: 0,

    // what happened since the caller last drained; renderers turn these into
    // bursts, sprites and DOM updates. Sim state never depends on it.
    events: [],
    // the round's replayable record. end/finalScore are stamped on death.
    log: { v: ENGINE_VERSION, seed, tickMs, wallsEnabled, inputs: [], end: 0, finalScore: 0 },
  };

  const emit = e => S.events.push(e);

  // ---- shared placement ----
  // a cell nothing new may spawn onto: snake, wall, food, a TNT, a window, a ghost
  function cellOccupied(x, y) {
    const k = K(x, y);
    return S.snakeSet.has(k) || S.wallLookup.has(k) ||
           (S.food && S.food.x === x && S.food.y === y) ||
           (S.portal !== null && ((S.portal.ax === x && S.portal.ay === y) || (S.portal.bx === x && S.portal.by === y))) ||
           S.bombs.some(b => b.x === x && b.y === y) ||
           S.ghosts.some(g => g.x === x && g.y === y);
  }

  // pick a random empty cell, preferring cells at least minDist (toroidal
  // Manhattan) from the head. One bounded scan, never rejection sampling.
  function spawnCell(minDist) {
    const head = S.snake[0];
    const far = [], any = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (cellOccupied(x, y)) continue;
        any.push(x, y);
        if (wrapDist(x, y, head.x, head.y) >= minDist) far.push(x, y);
      }
    }
    const pool = far.length ? far : any;
    if (!pool.length) return null;            // board completely full
    const i = ((random() * (pool.length / 2)) | 0) * 2;
    return { x: pool[i], y: pool[i + 1] };
  }

  function placeFood() {
    const c = spawnCell(0);
    if (!c) { S.foodAge = 0; return; }        // board full: keep the current food
    c.bonus = S.regularEaten >= BONUS_EVERY;  // ringed +5 only after a full streak
    c.kind = (random() * (c.bonus ? BONUS_KINDS : REGULAR_KINDS)) | 0;
    S.food = c;
    S.foodAge = 0;
    emit({ t: 'food' });
  }

  // ---- walls ----
  function buildWalls() {
    const set = WALL_PATTERNS[(random() * WALL_PATTERNS.length) | 0]();
    S.wallLookup = set;
    S.wallCells = [...set].map(k => ({ x: (k / GRID) | 0, y: k % GRID }));
  }

  function clearWalls() { S.wallCells = []; S.wallLookup = new Set(); }

  function updateWalls() {
    if (!S.wallsEnabled) {
      if (S.wallState !== 'off') { S.wallState = 'off'; clearWalls(); emit({ t: 'wall', phase: 'off' }); }
      return;
    }
    if (S.clockMs < S.wallPhaseEnd) return;
    if (S.wallState === 'off') {
      buildWalls();                 // shape appears and flashes before it bites
      S.wallState = 'warning';
      S.wallPhaseEnd = S.clockMs + WARN_MS;
      // never leave food, a TNT, or a ghost buried under a fresh wall
      if (S.food && S.wallLookup.has(K(S.food.x, S.food.y))) placeFood();
      for (let i = S.bombs.length - 1; i >= 0; i--) {
        const b = S.bombs[i];
        if (!S.wallLookup.has(K(b.x, b.y))) continue;
        const c = spawnCell(MIN_SPAWN_DIST);
        if (c) { b.x = c.x; b.y = c.y; }
        else S.bombs.splice(i, 1);   // nowhere safe: drop it rather than bury it in a wall
      }
      for (const g of S.ghosts) if (S.wallLookup.has(K(g.x, g.y))) nudgeGhost(g);
      // a window under a fresh wall would be a trap the moment the wall goes
      // live, so the pair closes; only a pair never used is owed again (rule 20)
      if (S.portal && (S.wallLookup.has(K(S.portal.ax, S.portal.ay)) || S.wallLookup.has(K(S.portal.bx, S.portal.by))))
        closePortal(!S.portal.used);
      emit({ t: 'wall', phase: 'warning' });
    } else if (S.wallState === 'warning') {
      S.wallState = 'solid';
      S.wallPhaseEnd = S.clockMs + SOLID_MS;
      emit({ t: 'wall', phase: 'solid' });
    } else {                        // solid -> open, re-arm later
      S.wallState = 'off';
      clearWalls();
      S.wallPhaseEnd = S.clockMs + rand(6000, 14000);
      emit({ t: 'wall', phase: 'off' });
    }
  }

  // ---- TNT ----
  function spawnBomb() {
    const c = spawnCell(MIN_SPAWN_DIST);
    if (c) S.bombs.push(c);
  }

  function updateBombs() {
    // The score only ever sets the SIZE of a wave, never whether one comes
    // (rule 22). Past the last mark the size pins at TNT_SCORES.length and the
    // cycle carries on for ever. Do not add a score check below this line:
    // that is what would make waves stop. Monotonic, so the five points a TNT
    // takes can never shrink the wave.
    while (S.bombsUnlocked < TNT_SCORES.length && S.score >= TNT_SCORES[S.bombsUnlocked]) S.bombsUnlocked++;
    if (S.bombsUnlocked === 0) return;
    if (S.bombPhase === 'active') {
      if (S.clockMs >= S.bombExpireAt) {         // the whole wave vanishes together
        S.bombs = [];
        S.bombPhase = 'gap';
        S.bombNextAt = S.clockMs + rand(BOMB_GAP_MIN, BOMB_GAP_MAX);
      }
    } else if (S.clockMs >= S.bombNextAt) {      // gap over: blink in a fresh wave of N
      for (let i = 0; i < S.bombsUnlocked; i++) spawnBomb();
      if (S.bombs.length) { S.bombPhase = 'active'; S.bombExpireAt = S.clockMs + rand(BOMB_LIFE_MIN, BOMB_LIFE_MAX); }
      else S.bombNextAt = S.clockMs + 1000;      // couldn't place any; retry soon
    }
  }

  // ---- ghosts ----
  // a cell a ghost may not enter (self excluded so a ghost never blocks itself)
  function ghostBlocked(x, y, self) {
    // while a head is committed in a window the far end is spoken for: a ghost
    // there would be a death the player could not have seen coming (rule 21)
    if (!S.warpedIn && S.portal !== null && !S.portal.used) {
      const hw = portalEndAt(S.snake[0].x, S.snake[0].y);
      if (hw === 1 && x === S.portal.bx && y === S.portal.by) return true;
      if (hw === 2 && x === S.portal.ax && y === S.portal.ay) return true;
    }
    const k = K(x, y);
    return S.snakeSet.has(k) || S.wallLookup.has(k) ||
           (S.food && S.food.x === x && S.food.y === y) ||
           S.bombs.some(b => b.x === x && b.y === y) ||
           S.ghosts.some(g => g !== self && g.x === x && g.y === y);
  }

  function spawnGhost() {
    const c = spawnCell(MIN_SPAWN_DIST);
    if (!c) return;                          // board too full; try again later
    S.ghosts.push({ x: c.x, y: c.y, px: c.x, py: c.y, dir: { x: 0, y: 0 }, warped: false, moveAt: S.clockMs + GHOST_MS });
  }

  // if a wall forms on a ghost, slide it to the nearest open cell
  function nudgeGhost(g) {
    for (let r = 1; r < GRID; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring edge only
        const nx = wrap(g.x + dx), ny = wrap(g.y + dy);
        if (!ghostBlocked(nx, ny, g)) { g.x = g.px = nx; g.y = g.py = ny; return; }
      }
    }
  }

  function moveGhost(g) {
    g.px = g.x; g.py = g.y;                    // remember where we came from (smooth render)
    // a ghost in either window spends this move coming out of the other,
    // keeping its heading, but only when the far side is clear, and never
    // straight back out of the window that has just put it down
    const win = (g.warped || S.portal === null || S.portal.used) ? 0 : portalEndAt(g.x, g.y);
    if (win) {
      const tx = win === 1 ? S.portal.bx : S.portal.ax;
      const ty = win === 1 ? S.portal.by : S.portal.ay;
      if (!ghostBlocked(tx, ty, g)) { g.x = tx; g.y = ty; g.warped = true; return; }
    }
    g.warped = false;
    const opts = [];
    for (const d of GHOST_DIRS) {
      if (g.dir.x === -d.x && g.dir.y === -d.y) continue; // no reversing
      const nx = wrap(g.x + d.x), ny = wrap(g.y + d.y);
      if (!ghostBlocked(nx, ny, g)) opts.push({ d, nx, ny });
    }
    let pick;
    if (opts.length) {
      const head = S.snake[0];
      if (random() < 0.55) {                 // gentle chase: drift toward the head
        opts.sort((a, b) => wrapDist(a.nx, a.ny, head.x, head.y) - wrapDist(b.nx, b.ny, head.x, head.y));
        pick = opts[0];
      } else {
        pick = opts[(random() * opts.length) | 0];
      }
    } else {                                 // boxed in: reverse if we can, else wait
      const rx = wrap(g.x - g.dir.x), ry = wrap(g.y - g.dir.y);
      if ((g.dir.x || g.dir.y) && !ghostBlocked(rx, ry, g)) {
        pick = { d: { x: -g.dir.x, y: -g.dir.y }, nx: rx, ny: ry };
      } else return;
    }
    g.x = pick.nx; g.y = pick.ny; g.dir = pick.d;
  }

  function updateGhosts() {
    if (S.ghosts.length < GHOST_SCORES.length && S.score >= GHOST_SCORES[S.ghosts.length]) spawnGhost();
    for (const g of S.ghosts) {
      if (S.clockMs >= g.moveAt) { moveGhost(g); g.moveAt = S.clockMs + GHOST_MS; }
    }
  }

  // the cell a ghost visually occupies right now, used for collision so you
  // only die when you actually touch the ghost you can see
  const _ga = { cx: 0, cy: 0 };
  function ghostAt(g) {
    const r = ghostRenderPos(g, S.clockMs, _ga);
    return { x: wrap(Math.round(r.cx)), y: wrap(Math.round(r.cy)) };
  }

  // ---- teleport windows ----
  // which end of the open pair a cell is: 1 the blue one, 2 the violet, 0 neither
  function portalEndAt(x, y) {
    if (S.portal === null) return 0;
    if (x === S.portal.ax && y === S.portal.ay) return 1;
    if (x === S.portal.bx && y === S.portal.by) return 2;
    return 0;
  }

  // Both ends placed by enumerating free cells; the exit at least
  // PORTAL_MIN_GAP away so a hop is never an ordinary-looking step.
  function spawnPortal() {
    const a = spawnCell(MIN_SPAWN_DIST);
    if (!a) return false;
    const far = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (cellOccupied(x, y)) continue;
        if (wrapDist(x, y, a.x, a.y) >= PORTAL_MIN_GAP) far.push(x, y);
      }
    }
    if (!far.length) return false;
    const i = ((random() * (far.length / 2)) | 0) * 2;
    S.portal = { ax: a.x, ay: a.y, bx: far[i], by: far[i + 1], used: false };
    S.portalOpenedAt = S.clockMs;
    emit({ t: 'portal', open: true });
    return true;
  }

  // the windows never close on someone still coming through (rule 20)
  function portalBusy() {
    if (S.portal === null) return false;
    if (S.snakeSet.has(K(S.portal.ax, S.portal.ay)) || S.snakeSet.has(K(S.portal.bx, S.portal.by))) return true;
    if (S.tailFrom && portalEndAt(S.tailFrom.x, S.tailFrom.y)) return true;
    for (const g of S.ghosts) if (portalEndAt(g.x, g.y)) return true;
    return false;
  }

  // A pair cut short rather than expired is owed again: a wall landing on a
  // window you never got to use re-opens somewhere clear a moment later.
  function closePortal(refund) {
    S.portal = null;
    emit({ t: 'portal', open: false });
    if (refund && S.portalsOpened > 0) { S.portalsOpened--; S.portalRetryAt = S.clockMs + 2000; }
  }

  function updatePortals() {
    // How many marks the score has ever passed: closed form so a big jump
    // cannot spin, raised only so falling under a mark and climbing back over
    // it never buys a second pair (that would be farming windows, rule 18).
    const due = S.score >= PORTAL_FIRST ? ((S.score - PORTAL_FIRST) / PORTAL_EVERY | 0) + 1 : 0;
    if (due > S.portalsUnlocked) S.portalsUnlocked = due;
    if (S.portal !== null) {
      // a used pair is finished but cannot vanish mid-body: portalBusy holds
      // it open until the tail is clear, then it snaps shut
      if ((S.portal.used || S.clockMs >= S.portalExpireAt) && !portalBusy()) closePortal(false);
      return;
    }
    if (S.portalsOpened >= S.portalsUnlocked || S.clockMs < S.portalRetryAt) return;
    if (spawnPortal()) {
      S.portalsOpened++;
      S.portalExpireAt = S.clockMs + rand(PORTAL_LIFE_MIN, PORTAL_LIFE_MAX);
    } else {
      S.portalRetryAt = S.clockMs + 1000;      // board too full right now; look again shortly
    }
  }

  // ---- the step ----
  function die(reason) {
    S.alive = false;
    S.deadReason = reason || 'self';
    S.log.end = S.quanta;
    S.log.finalScore = S.score;
    emit({ t: 'die', reason: S.deadReason });
  }

  function step() {
    if (S.dirQueue.length) S.dir = S.dirQueue.shift();
    // A head standing in a window spends this step coming out of the far one:
    // still exactly one step, heading untouched, pace unchanged (rules 16/17).
    // Only a head that walked in is carried, never one a window just put down.
    const win = (S.warpedIn || S.portal === null || S.portal.used) ? 0
              : portalEndAt(S.snake[0].x, S.snake[0].y);
    const nx = win === 1 ? S.portal.bx : win === 2 ? S.portal.ax : wrap(S.snake[0].x + S.dir.x);
    const ny = win === 1 ? S.portal.by : win === 2 ? S.portal.ay : wrap(S.snake[0].y + S.dir.y);
    const nk = K(nx, ny);

    // interior walls are lethal only once they're live
    if (S.wallState === 'solid' && S.wallLookup.has(nk)) return die('wall');

    // whether this tick grows decides the tail rule below, so settle it first
    const ate = nx === S.food.x && ny === S.food.y;
    const grows = S.pendingGrowth + (ate ? (S.food.bonus ? 5 : 1) : 0) > 0;

    // self collision, O(1); the tail cell is exempt when it glides out this tick
    const tail = S.snake[S.snake.length - 1];
    if (S.snakeSet.has(nk) && (grows || nk !== K(tail.x, tail.y))) return die('self');

    // running into any ghost ends the run (the cell each visually occupies)
    for (const gh of S.ghosts) { const g = ghostAt(gh); if (nx === g.x && ny === g.y) return die('ghost'); }

    // move: pop the vacated tail first so the set stays exact, then add the head
    if (grows) S.tailFrom = null;
    else { S.tailFrom = S.snake.pop(); S.snakeSet.delete(K(S.tailFrom.x, S.tailFrom.y)); }
    S.snake.unshift({ x: nx, y: ny });
    S.snakeSet.add(nk);
    S.warpedIn = win !== 0;
    if (win) {
      // one trip a pair, paid on surfacing, after every fatal test above
      const fromA = win === 1;
      S.portal.used = true;
      S.score += PORTAL_BONUS;
      emit({ t: 'hop', fromA,
             fx: fromA ? S.portal.ax : S.portal.bx, fy: fromA ? S.portal.ay : S.portal.by,
             tx: nx, ty: ny });
    }

    if (ate) {
      const bonus = S.food.bonus;
      if (bonus) {
        S.score += 5; S.pendingGrowth += 5;
        S.regularEaten = 0;          // bonus taken: restart the streak
      } else {
        S.score += 1; S.pendingGrowth += 1;
        S.regularEaten++;
      }
      emit({ t: 'eat', bonus, x: nx, y: ny });
      placeFood();
    }
    if (grows) S.pendingGrowth--;

    // TNT never kills: -5 points (may go negative), up to 5 segments off,
    // floored at START_LEN. Queued growth is cancelled so the shrink sticks.
    const hitBomb = S.bombs.findIndex(b => nx === b.x && ny === b.y);
    if (hitBomb !== -1) {
      S.score -= 5;
      S.pendingGrowth = 0;
      const lost = [];
      const target = Math.max(START_LEN, S.snake.length - 5);
      while (S.snake.length > target) {
        const t = S.snake.pop();
        S.snakeSet.delete(K(t.x, t.y));
        lost.push(t);
      }
      S.tailFrom = null;   // the old glide anchor is far from the new tail; snap
      S.bombs.splice(hitBomb, 1);
      emit({ t: 'tnt', x: nx, y: ny, lost });
      if (!S.bombs.length) {
        S.bombPhase = 'gap';
        S.bombNextAt = S.clockMs + rand(BOMB_GAP_MIN, BOMB_GAP_MAX);
      }
    }
  }

  // one fixed quantum of simulation
  function quantum() {
    S.quanta++;
    S.clockMs += SIM_DT;
    S.progMs += SIM_DT;
    updateWalls();
    updateBombs();
    updateGhosts();
    updatePortals();
    S.foodAge += SIM_DT;
    if (S.foodAge >= FOOD_TTL) {
      if (S.food.bonus) S.regularEaten = 0;   // missed the bonus in time: lose the streak
      placeFood();
    }
    // the alive guard stops the drain the moment a step dies: no zombie steps
    while (S.alive && S.progMs >= S.tickMs) { S.progMs -= S.tickMs; step(); }
  }

  // ---- the public surface ----

  // Queue turns instead of overwriting one slot, so two quick taps both land.
  // Reversals and repeats are filtered against the last queued/active
  // direction. Callers gate on their own round state (countdown buffering is
  // the caller's choice); the engine only refuses input after death.
  function setDir(x, y) {
    if (!S.alive) return;
    const ref = S.dirQueue.length ? S.dirQueue[S.dirQueue.length - 1] : S.dir;
    if (x === -ref.x && y === -ref.y) return; // no 180° reversal
    if (x === ref.x && y === ref.y) return;   // ignore repeats
    if (S.dirQueue.length < 3) {
      S.dirQueue.push({ x, y });
      S.log.inputs.push([S.quanta, x, y]);
    }
  }

  // a turn queued before a pause must not fire on resume
  function clearQueue() { S.dirQueue.length = 0; }

  // Advance by real milliseconds. Whole quanta simulate; the remainder stays
  // in accMs for the renderers' interpolation. Clamp dt at the call site
  // (MAX_DT) so a woken tab never fast-forwards the round.
  function advance(dtMs) {
    S.accMs += dtMs;
    while (S.alive && S.accMs >= SIM_DT) { S.accMs -= SIM_DT; quantum(); }
    if (!S.alive) S.accMs = 0;
  }

  // exact replay clock, for the validator: run whole quanta with no remainder
  function advanceQuanta(n) {
    for (let i = 0; i < n && S.alive; i++) quantum();
  }

  // ---- render helpers (pure reads; safe from any thread) ----
  // continuous 0..1 progress through the current cell, including the
  // not-yet-simulated remainder, so every frame advances by exactly dt/tickMs
  function renderProg() { return Math.min(1, (S.progMs + S.accMs) / S.tickMs); }
  // the continuous clock renderers should use for glides, pulses and blinks
  function renderNow() { return S.clockMs + S.accMs; }

  function drainEvents() {
    const e = S.events;
    S.events = [];
    return e;
  }

  // ---- boot ----
  for (let i = 0; i < START_LEN; i++) { S.snake.push({ x: 8 - i, y: 10 }); S.snakeSet.add(K(8 - i, 10)); }
  S.wallPhaseEnd = rand(4000, 9000);
  placeFood();

  return Object.assign(S, {
    setDir, clearQueue, advance, advanceQuanta,
    renderProg, renderNow, drainEvents,
    ghostAt, portalEndAt, cellOccupied, portalBusy,
    // exposed for tests and the validator; not for renderers
    _step: step, _updateWalls: updateWalls, _updateBombs: updateBombs,
    _updateGhosts: updateGhosts, _updatePortals: updatePortals,
    _moveGhost: moveGhost, _spawnPortal: spawnPortal, _closePortal: closePortal,
    _placeFood: placeFood, _spawnCell: spawnCell,
  });
}

// Re-run a finished round from its log. Returns the game in its final state;
// the validator compares game.score against the submitted score. The inputs
// are (quantum, x, y) triples recorded by setDir, so the reproduction is
// exact by construction.
export function replay(log) {
  if (!log || log.v !== ENGINE_VERSION) throw new Error('unsupported log version');
  const game = createGame({ seed: log.seed, tickMs: log.tickMs, wallsEnabled: log.wallsEnabled });
  const inputs = log.inputs;
  let i = 0;
  for (let q = 0; q < log.end && game.alive; q++) {
    while (i < inputs.length && inputs[i][0] === q) { game.setDir(inputs[i][1], inputs[i][2]); i++; }
    game.advanceQuanta(1);
  }
  return game;
}
