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
// Multi-snake worlds are the same machine: `players: N` in the config puts N
// snakes on one board, sharing the food, the walls, the TNT, the ghosts and
// the windows. Snakes pass through each other (no snake-vs-snake contact of
// any kind); everything else treats each snake exactly as it treated the one.
// The hazard ladders read the LEADER's score, so the room escalates with the
// front-runner. All the singular fields (snake, dir, score, ...) remain as
// live aliases of player 0, which is what keeps every existing shell and test
// working untouched; new code should read game.players[i].
//
// snapshot()/restore() capture and reinstate the full simulation state,
// including the PRNG. They exist for rollback netcode: restore to an earlier
// quantum, apply a late remote input, re-advance. A rollback is a live replay.
//
// The engine never blocks and never allocates in steady state beyond what the
// old inline version did (snapshot/restore allocate, but they run on network
// events, never in the frame loop). Rendering concerns (particles, sprites,
// colours, interpolation) live with the renderers; the engine reports what
// happened through an events array the caller drains once per frame.

export const ENGINE_VERSION = 6;

export const GRID = 20;
export const START_LEN = 3;    // initial snake length; TNT can't shrink below this
export const SIM_DT = 10;      // ms per simulation quantum; everything is a multiple of it
export const MAX_PLAYERS = 5;  // one board holds at most five snakes

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

// Survival opens with the ghosts, not with the dynamite: a wave standing on
// the pitch before the snake has moved reads as scenery, blinks out a few
// seconds later, and teaches nothing. This is how long the board stays clear
// before the first full wave lands. A multiple of SIM_DT like every other
// timing constant.
export const SURVIVAL_TNT_FIRST = 8000;

// Round presets. A mode IS a config: the shells pass MODES[name] into
// createGame and decide nothing of their own, so a tournament, a replay and a
// local round all mean the same thing by construction. Every duration is a
// multiple of SIM_DT like any other timing constant. Multiplayer is not a
// mode: `players` is an orthogonal knob a room config sets alongside one.
export const MODES = {
  classic: {},                              // endless: the run ends when you do
  speedrun: { durationMs: 60_000 },         // one minute on the clock, then the whistle
  // the whole ghost pack from the kickoff whistle; the TNT waves are at
  // full size from the first one, but the first one lets you off the line
  survival: { startGhosts: 5, startBombs: 9, bombFirstMs: SURVIVAL_TNT_FIRST },
};

// how much room the opening hazards of a survival round leave the head,
// in the game's own wrapped-walk metric (wrapDist)
export const SURVIVAL_CLEAR = 5;
const GHOST_DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
// How often a ghost takes the step that closes on its target rather than a
// random open one. The noise that remains keeps five ghosts from collapsing
// into single file and walks them around walls they cannot path through.
const GHOST_FOCUS = 0.85;
// the Flanker's post: it breaks off toward this corner once within this range
const FLANKER_POST = { x: 0, y: 19 };
const FLANKER_RANGE = 8;
// shortest wrapped delta between two coordinates, in [-GRID/2, GRID/2)
const wrapDelta = (a, b) => ((a - b + GRID * 1.5) % GRID) - GRID / 2;

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
  const durationMs = cfg.durationMs ?? 0;   // 0 = endless
  const startGhosts = cfg.startGhosts ?? 0; // survival: personalities present at kickoff
  const startBombs = cfg.startBombs ?? 0;   // survival: TNT wave size floored here for ever
  const bombFirstMs = cfg.bombFirstMs ?? 0; // how long the board stays clear of that first wave
  const playerCount = cfg.players ?? 1;
  if (tickMs % SIM_DT !== 0) throw new Error('tickMs must be a multiple of SIM_DT');
  if (durationMs % SIM_DT !== 0 || durationMs < 0) throw new Error('durationMs must be a non-negative multiple of SIM_DT');
  if (!Number.isInteger(startGhosts) || startGhosts < 0 || startGhosts > GHOST_SCORES.length) throw new Error('startGhosts out of range');
  if (!Number.isInteger(startBombs) || startBombs < 0 || startBombs > TNT_SCORES.length) throw new Error('startBombs out of range');
  if (bombFirstMs % SIM_DT !== 0 || bombFirstMs < 0) throw new Error('bombFirstMs must be a non-negative multiple of SIM_DT');
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) throw new Error('players out of range');

  // mulberry32: small, fast, good-enough PRNG with a 32-bit seed. Not for
  // crypto; for making a round reproducible. The state lives in rngA so
  // snapshot()/restore() can carry it: a rollback must re-roll the same dice.
  let rngA = seed >>> 0;
  function random() {
    rngA |= 0; rngA = (rngA + 0x6d2b79f5) | 0;
    let t = Math.imul(rngA ^ (rngA >>> 15), 1 | rngA);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rand = (a, b) => a + random() * (b - a);

  // One snake. Everything singular the old engine kept at the top level now
  // lives here once per player; the world stays shared. _mx/_my/_m are
  // per-quantum contact scratch (rule 24), never persisted.
  function makePlayer(idx, laneY) {
    const p = {
      idx,
      snake: [], snakeSet: new Set(), tailFrom: null,
      headFrom: { x: 8, y: laneY },
      headMajX: 8, headMajY: laneY,
      dir: { x: 1, y: 0 }, dirQueue: [],
      score: 0, pendingGrowth: 0,
      warpedIn: false,
      alive: true, deadReason: null, diedAt: 0,
      _mx: 0, _my: 0,          // this quantum's majority cell (rule 24 scratch)
    };
    for (let i = 0; i < START_LEN; i++) { p.snake.push({ x: 8 - i, y: laneY }); p.snakeSet.add(K(8 - i, laneY)); }
    return p;
  }

  // Start lanes: evenly spaced rows, everyone heading right from x=8. One
  // player lands on the classic row 10, so a solo round starts where it
  // always did.
  const players = [];
  for (let i = 0; i < playerCount; i++)
    players.push(makePlayer(i, Math.floor(GRID * (2 * i + 1) / (2 * playerCount))));

  // S is both the internal state and the public surface: renderers read these
  // fields every frame, tests may poke them. Methods below close over S.
  // The singular fields (snake, dir, score, ...) are defined further down as
  // live aliases of players[0], so one-snake callers never notice the array.
  const S = {
    seed, tickMs, wallsEnabled, durationMs, startGhosts, startBombs, bombFirstMs,
    players,
    quanta: 0,          // sim quanta elapsed; the replay clock
    clockMs: 0,         // one hazard clock (the old wall/bomb/ghost/portal clocks were identical)
    progMs: 0,          // ms into the current cell; renderProg() adds the sub-quantum remainder
    accMs: 0,           // dt not yet turned into quanta (always < SIM_DT after advance)

    food: null,         // {x, y, bonus, kind} - kind indexes the renderer's emoji list
    foodAge: 0, regularEaten: 0,   // the bonus streak is the board's, not a snake's

    wallState: 'off', wallPhaseEnd: 0, wallCells: [], wallLookup: new Set(),

    bombs: [], bombsUnlocked: 0, bombPhase: 'gap', bombNextAt: 0, bombExpireAt: 0,

    ghosts: [],         // {x, y, px, py, dir, warped, moveAt}

    portal: null,       // {ax, ay, bx, by, used}: the blue end, then the violet end
    portalsUnlocked: 0, portalsOpened: 0, portalRetryAt: 0,
    portalExpireAt: 0, portalOpenedAt: 0,

    // what happened since the caller last drained; renderers turn these into
    // bursts, sprites and DOM updates. Sim state never depends on it.
    events: [],
    // the round's replayable record. end/finalScore are stamped when the last
    // snake goes down; a multi-snake log carries every score and death time.
    log: { v: ENGINE_VERSION, seed, tickMs, wallsEnabled, durationMs, startGhosts, startBombs, bombFirstMs,
           players: playerCount, inputs: [], end: 0, finalScore: 0 },
  };

  // The singular surface: player 0 under the old names, reads AND writes, so
  // the web page, the mobile shell and the whole one-snake test suite work
  // unchanged. Engine code below never goes through these.
  for (const f of ['snake', 'snakeSet', 'tailFrom', 'headFrom', 'headMajX', 'headMajY',
                   'dir', 'dirQueue', 'score', 'pendingGrowth', 'warpedIn', 'deadReason']) {
    Object.defineProperty(S, f, {
      get() { return players[0][f]; },
      set(v) { players[0][f] = v; },
      enumerable: false, configurable: true,
    });
  }
  // `alive` is the round: any snake still up. Writing it revives player 0,
  // which is what the soak test's resurrection hook has always meant.
  Object.defineProperty(S, 'alive', {
    get() { for (const p of players) if (p.alive) return true; return false; },
    set(v) { players[0].alive = v; },
    enumerable: false, configurable: true,
  });

  // every event carries the quantum it happened on, so a renderer replaying
  // re-simulated quanta (rollback netcode) can tell an already-shown effect
  // from a genuinely new one
  const emit = e => { e.q = S.quanta; S.events.push(e); };
  const anyAlive = () => { for (const p of players) if (p.alive) return true; return false; };
  // the hazard ladders read the front-runner (rule 22 generalized): the room
  // escalates with the leader, and the unlock counters stay monotonic so a
  // TNT knocking the leader down never de-escalates anything
  const leaderScore = () => { let m = players[0].score; for (const p of players) if (p.score > m) m = p.score; return m; };

  // ---- shared placement ----
  // A cell nothing new may spawn onto: any snake, wall, food, a TNT, a
  // window, a ghost. Plain loops rather than .some(): a full-board scan asks
  // this 400 times, and a closure per bomb per cell is 3,600 allocations a
  // spawn on a full survival board (rule 4).
  function cellOccupied(x, y) {
    const k = K(x, y);
    for (let i = 0; i < players.length; i++) if (players[i].snakeSet.has(k)) return true;
    if (S.wallLookup.has(k)) return true;
    if (S.food !== null && S.food.x === x && S.food.y === y) return true;
    if (S.portal !== null && ((S.portal.ax === x && S.portal.ay === y) ||
                              (S.portal.bx === x && S.portal.by === y))) return true;
    for (let i = 0; i < S.bombs.length; i++) if (S.bombs[i].x === x && S.bombs[i].y === y) return true;
    for (let i = 0; i < S.ghosts.length; i++) if (S.ghosts[i].x === x && S.ghosts[i].y === y) return true;
    return false;
  }

  // pick a random empty cell, preferring cells at least minDist (toroidal
  // Manhattan) from every living head. One bounded scan, never rejection
  // sampling.
  function spawnCell(minDist) {
    const far = [], any = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (cellOccupied(x, y)) continue;
        any.push(x, y);
        let clear = true;
        for (const p of players) {
          if (!p.alive) continue;
          if (wrapDist(x, y, p.snake[0].x, p.snake[0].y) < minDist) { clear = false; break; }
        }
        if (clear) far.push(x, y);
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
  // one derivation of the drawable cell list from the lookup keys, shared by
  // the builder and by restore(), so the two can never disagree
  const wallCellsFrom = keys => keys.map(k => ({ x: (k / GRID) | 0, y: k % GRID }));

  function buildWalls() {
    const set = WALL_PATTERNS[(random() * WALL_PATTERNS.length) | 0]();
    S.wallLookup = set;
    S.wallCells = wallCellsFrom([...set]);
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
  function spawnBomb(minDist = MIN_SPAWN_DIST) {
    const c = spawnCell(minDist);
    if (c) S.bombs.push(c);
  }

  function updateBombs() {
    // The leader's score only ever sets the SIZE of a wave, never whether one
    // comes (rule 22). Past the last mark the size pins at TNT_SCORES.length
    // and the cycle carries on for ever. Do not add a score check below this
    // line: that is what would make waves stop. Monotonic, so the five points
    // a TNT takes can never shrink the wave.
    const lead = leaderScore();
    while (S.bombsUnlocked < TNT_SCORES.length && lead >= TNT_SCORES[S.bombsUnlocked]) S.bombsUnlocked++;
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
    if (S.portal !== null && !S.portal.used) {
      for (const p of players) {
        if (!p.alive || p.warpedIn) continue;
        const hw = portalEndAt(p.snake[0].x, p.snake[0].y);
        if (hw === 1 && x === S.portal.bx && y === S.portal.by) return true;
        if (hw === 2 && x === S.portal.ax && y === S.portal.ay) return true;
      }
    }
    const k = K(x, y);
    for (let i = 0; i < players.length; i++) if (players[i].snakeSet.has(k)) return true;
    if (S.wallLookup.has(k)) return true;
    if (S.food !== null && S.food.x === x && S.food.y === y) return true;
    for (let i = 0; i < S.bombs.length; i++) if (S.bombs[i].x === x && S.bombs[i].y === y) return true;
    for (let i = 0; i < S.ghosts.length; i++) {
      const g = S.ghosts[i];
      if (g !== self && g.x === x && g.y === y) return true;
    }
    return false;
  }

  function spawnGhost(minDist = MIN_SPAWN_DIST) {
    const c = spawnCell(minDist);
    if (!c) return;                          // board too full; try again later
    // the personality is the spawn position in the ladder, and since ghosts
    // never leave, it is also the color: red chases, blue ambushes, orange
    // flanks, pink cuts off, cyan wardens the food
    S.ghosts.push({
      x: c.x, y: c.y, px: c.x, py: c.y,
      dir: { x: 0, y: 0 }, warped: false,
      role: S.ghosts.length,
      moveAt: S.clockMs + GHOST_MS,
      majX: c.x, majY: c.y,        // majority cell one quantum ago (rule 24)
    });
  }

  // A ghost's sense of distance: the shortest wrapped walk OR the route
  // through an open, unused teleport pair (to an end, one hop, out the far
  // side). One formula makes portal use deliberate and personality-dependent
  // at once: whichever cell a ghost wants, it will dive through a window when
  // the window genuinely gets it there sooner - and never when the pair is
  // spent. A step landing ON an end is priced as the far side plus the hop,
  // which is exactly what the forced hop next move will do to it.
  function ghostDist(x, y, tx, ty) {
    let d = wrapDist(x, y, tx, ty);
    const p = S.portal;
    if (p !== null && !p.used) {
      const viaA = wrapDist(x, y, p.ax, p.ay) + 1 + wrapDist(p.bx, p.by, tx, ty);
      if (viaA < d) d = viaA;
      const viaB = wrapDist(x, y, p.bx, p.by) + 1 + wrapDist(p.ax, p.ay, tx, ty);
      if (viaB < d) d = viaB;
    }
    return d;
  }

  // Which snake a ghost is hunting: the nearest living head by its own
  // wormhole metric, ties to the lower index. One snake is just the
  // degenerate case (the loop, or the fallback once it is dead, both name
  // it); five means pressure follows proximity and the last snake standing
  // collects the whole pack. Pure arithmetic: no PRNG draw, so a one-snake
  // round rolls exactly the dice it always rolled.
  function victimOf(g) {
    let best = null, bestD = Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      const d = ghostDist(g.x, g.y, p.snake[0].x, p.snake[0].y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ?? players[0];
  }

  // Where a ghost is trying to be, by personality, relative to its victim.
  // Pure targeting: the legs (GHOST_MS, the no-reverse rule, blocked cells)
  // are identical for all five.
  function ghostTarget(g) {
    const v = victimOf(g);
    const head = v.snake[0];
    switch (g.role ?? 0) {
      case 1: {  // the Ambusher: four cells ahead of the victim's heading
        return { x: wrap(head.x + v.dir.x * 4), y: wrap(head.y + v.dir.y * 4) };
      }
      case 2: {  // the Flanker: chase from afar, swing to the post up close
        return wrapDist(g.x, g.y, head.x, head.y) > FLANKER_RANGE ? head : FLANKER_POST;
      }
      case 3: {  // the Cutoff: double the vector from the Chaser through the
                 // point two ahead, arriving on the victim's far side
        const px = wrap(head.x + v.dir.x * 2);
        const py = wrap(head.y + v.dir.y * 2);
        const chaser = S.ghosts[0];
        if (!chaser) return { x: px, y: py };
        return {
          x: wrap(px + wrapDelta(px, chaser.x)),
          y: wrap(py + wrapDelta(py, chaser.y)),
        };
      }
      case 4: {  // the Warden: camp the food. It cannot stand on it (food
                 // blocks ghosts), so it orbits the thing you must approach.
        return S.food ?? head;
      }
      default:   // the Chaser: the victim's head, plainly
        return head;
    }
  }

  // One deep copy of a ghost, used by both ends of a rollback. A ghost field
  // added in one copy and missed in the other would not fail at the edit
  // site: it would surface much later as a netcode desync, so there is one
  // copy. The key order here is also the hashed key order, identically on
  // every peer.
  const cloneGhost = g => ({
    x: g.x, y: g.y, px: g.px, py: g.py, dir: { x: g.dir.x, y: g.dir.y },
    warped: g.warped, role: g.role, moveAt: g.moveAt, majX: g.majX, majY: g.majY,
  });

  // one ghost moves at a time, so the step search shares this scratch
  const _optDir = new Array(4), _optDist = new Int32Array(4);
  const _optX = new Int32Array(4), _optY = new Int32Array(4);

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
    // The open steps go into scratch parallel to GHOST_DIRS rather than an
    // array of fresh objects: this runs for every ghost twice a second, and
    // the old form allocated an options array, an object per option and a
    // filtered array per move. The dice are untouched: one draw for focus,
    // then one draw over the same tie count, walked in the same order.
    let n = 0;
    for (let i = 0; i < GHOST_DIRS.length; i++) {
      const d = GHOST_DIRS[i];
      if (g.dir.x === -d.x && g.dir.y === -d.y) continue; // no reversing
      const nx = wrap(g.x + d.x), ny = wrap(g.y + d.y);
      if (ghostBlocked(nx, ny, g)) continue;
      _optDir[n] = d; _optX[n] = nx; _optY[n] = ny; n++;
    }
    let px, py, pd;
    if (n) {
      if (random() < GHOST_FOCUS) {          // take a step toward the personality's target
        const target = ghostTarget(g);
        let bestDist = Infinity;
        for (let i = 0; i < n; i++) {
          const d = ghostDist(_optX[i], _optY[i], target.x, target.y);
          _optDist[i] = d;
          if (d < bestDist) bestDist = d;
        }
        let ties = 0;
        for (let i = 0; i < n; i++) if (_optDist[i] === bestDist) ties++;
        const nth = (random() * ties) | 0;   // ties break by the seeded PRNG
        let seen = 0, at = 0;
        for (let i = 0; i < n; i++) {
          if (_optDist[i] !== bestDist) continue;
          if (seen++ === nth) { at = i; break; }
        }
        pd = _optDir[at]; px = _optX[at]; py = _optY[at];
      } else {
        const i = (random() * n) | 0;
        pd = _optDir[i]; px = _optX[i]; py = _optY[i];
      }
    } else {                                 // boxed in: reverse if we can, else wait
      const rx = wrap(g.x - g.dir.x), ry = wrap(g.y - g.dir.y);
      if (!(g.dir.x || g.dir.y) || ghostBlocked(rx, ry, g)) return;
      pd = { x: -g.dir.x, y: -g.dir.y }; px = rx; py = ry;
    }
    g.x = px; g.y = py; g.dir = pd;
  }

  function updateGhosts() {
    if (S.ghosts.length < GHOST_SCORES.length && leaderScore() >= GHOST_SCORES[S.ghosts.length]) spawnGhost();
    for (const g of S.ghosts) {
      if (S.clockMs >= g.moveAt) { moveGhost(g); g.moveAt = S.clockMs + GHOST_MS; }
    }
  }

  // The cell a ghost visually occupies right now: its render position
  // rounded, which flips at the halfway point of a glide, the same halfway a
  // hop snaps at. This is the ghost's one lethal cell (rule 24). Called every
  // quantum, so it returns a shared scratch; read it before the next call.
  const _ga = { cx: 0, cy: 0 };
  const _gb = { x: 0, y: 0 };
  function ghostAt(g) {
    const r = ghostRenderPos(g, S.clockMs, _ga);
    _gb.x = wrap(Math.round(r.cx)); _gb.y = wrap(Math.round(r.cy));
    return _gb;
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
    const ka = K(S.portal.ax, S.portal.ay), kb = K(S.portal.bx, S.portal.by);
    for (const p of players) {
      if (p.snakeSet.has(ka) || p.snakeSet.has(kb)) return true;
      if (p.tailFrom && portalEndAt(p.tailFrom.x, p.tailFrom.y)) return true;
    }
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
    // How many marks the leader has ever passed: closed form so a big jump
    // cannot spin, raised only so falling under a mark and climbing back over
    // it never buys a second pair (that would be farming windows, rule 18).
    const lead = leaderScore();
    const due = lead >= PORTAL_FIRST ? ((lead - PORTAL_FIRST) / PORTAL_EVERY | 0) + 1 : 0;
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
  // The round's record is stamped once, when the last snake goes down.
  function stampEnd() {
    S.log.end = S.quanta;
    S.log.finalScore = leaderScore();
    if (players.length > 1) {
      S.log.finalScores = players.map(p => p.score);
      S.log.diedAt = players.map(p => p.diedAt);
    }
  }

  function die(p, reason) {
    p.alive = false;
    p.deadReason = reason || 'self';
    p.diedAt = S.quanta;
    if (anyAlive()) {
      // the round goes on: the fallen snake leaves the board (snakes never
      // block each other, so only spawns and ghosts ever noticed it), and the
      // renderer gets the segments for whatever farewell it wants to draw
      emit({ t: 'die', player: p.idx, reason: p.deadReason, segments: p.snake.map(c => ({ x: c.x, y: c.y })) });
      p.snake.length = 0;
      p.snakeSet.clear();
      p.tailFrom = null;
    } else {
      stampEnd();
      emit({ t: 'die', player: p.idx, reason: p.deadReason });
    }
  }

  function stepPlayer(p) {
    if (p.dirQueue.length) p.dir = p.dirQueue.shift();
    // A head standing in a window spends this step coming out of the far one:
    // still exactly one step, heading untouched, pace unchanged (rules 16/17).
    // Only a head that walked in is carried, never one a window just put down.
    const win = (p.warpedIn || S.portal === null || S.portal.used) ? 0
              : portalEndAt(p.snake[0].x, p.snake[0].y);
    const nx = win === 1 ? S.portal.bx : win === 2 ? S.portal.ax : wrap(p.snake[0].x + p.dir.x);
    const ny = win === 1 ? S.portal.by : win === 2 ? S.portal.ay : wrap(p.snake[0].y + p.dir.y);
    const nk = K(nx, ny);

    // interior walls are lethal only once they're live
    if (S.wallState === 'solid' && S.wallLookup.has(nk)) return die(p, 'wall');

    // whether this tick grows decides the tail rule below, so settle it first
    const ate = nx === S.food.x && ny === S.food.y;
    const grows = p.pendingGrowth + (ate ? (S.food.bonus ? 5 : 1) : 0) > 0;

    // SELF collision only, O(1): another snake's body is thin air (snakes
    // race, they never fence). The tail cell is exempt when it glides out
    // this tick.
    const tail = p.snake[p.snake.length - 1];
    if (p.snakeSet.has(nk) && (grows || nk !== K(tail.x, tail.y))) return die(p, 'self');

    // ghosts are NOT tested here: contact with a mover is decided by the
    // majority-cell rule in quantum() (rule 24), never by cell entry

    // move: pop the vacated tail first so the set stays exact, then add the head
    p.headFrom.x = p.snake[0].x; p.headFrom.y = p.snake[0].y;
    if (grows) p.tailFrom = null;
    else { p.tailFrom = p.snake.pop(); p.snakeSet.delete(K(p.tailFrom.x, p.tailFrom.y)); }
    p.snake.unshift({ x: nx, y: ny });
    p.snakeSet.add(nk);
    p.warpedIn = win !== 0;
    if (win) {
      // one trip a pair, paid on surfacing, after every fatal test above;
      // with several snakes racing, the first head through takes the prize
      const fromA = win === 1;
      S.portal.used = true;
      p.score += PORTAL_BONUS;
      emit({ t: 'hop', player: p.idx, fromA,
             fx: fromA ? S.portal.ax : S.portal.bx, fy: fromA ? S.portal.ay : S.portal.by,
             tx: nx, ty: ny });
    }

    if (ate) {
      const bonus = S.food.bonus;
      if (bonus) {
        p.score += 5; p.pendingGrowth += 5;
        S.regularEaten = 0;          // bonus taken: restart the board's streak
      } else {
        p.score += 1; p.pendingGrowth += 1;
        S.regularEaten++;
      }
      emit({ t: 'eat', player: p.idx, bonus, x: nx, y: ny });
      placeFood();
    }
    if (grows) p.pendingGrowth--;

    // TNT never kills: -5 points (may go negative), up to 5 segments off,
    // floored at START_LEN. Queued growth is cancelled so the shrink sticks.
    const hitBomb = S.bombs.findIndex(b => nx === b.x && ny === b.y);
    if (hitBomb !== -1) {
      p.score -= 5;
      p.pendingGrowth = 0;
      const lost = [];
      const target = Math.max(START_LEN, p.snake.length - 5);
      while (p.snake.length > target) {
        const t = p.snake.pop();
        p.snakeSet.delete(K(t.x, t.y));
        lost.push(t);
      }
      p.tailFrom = null;   // the old glide anchor is far from the new tail; snap
      S.bombs.splice(hitBomb, 1);
      emit({ t: 'tnt', player: p.idx, x: nx, y: ny, lost });
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
    // every living snake steps in the same drain, in index order: one shared
    // tickMs means they all cross cell boundaries together, and index order
    // is the deterministic tie-break when two heads want the same food. The
    // alive guard stops the drain the moment the LAST snake dies: no zombie
    // steps.
    while (anyAlive() && S.progMs >= S.tickMs) {
      S.progMs -= S.tickMs;
      for (const p of players) if (p.alive) stepPlayer(p);
    }
    // ---- contact (rule 24) ----
    // Every mover is exactly where it is drawn. A head's one cell is the
    // cell it left until its glide passes half, then the cell it is entering;
    // a ghost's is ghostAt (render position rounded, hops snap at the same
    // half). Contact is those cells coinciding, tested every quantum, so a
    // ghost sliding majority-onto a head kills between snake steps and a
    // near-miss that never overlaps majorities is survivable. Two movers
    // exchanging cells inside one quantum crossed paths: that is contact too.
    // Snakes are tested against ghosts only: two heads sharing a cell is a
    // race, not a wreck.
    if (anyAlive()) {
      const half = S.progMs * 2 >= S.tickMs;
      for (const p of players) {
        if (!p.alive) continue;
        p._mx = half ? p.snake[0].x : p.headFrom.x;
        p._my = half ? p.snake[0].y : p.headFrom.y;
      }
      for (const gh of S.ghosts) {
        const g = ghostAt(gh);
        for (const p of players) {
          if (!p.alive) continue;     // includes anyone this ghost pass just took
          const met = g.x === p._mx && g.y === p._my;
          const crossed = g.x === p.headMajX && g.y === p.headMajY && gh.majX === p._mx && gh.majY === p._my;
          if (met || crossed) die(p, 'ghost');
        }
        gh.majX = g.x; gh.majY = g.y;
      }
      // the majority cell only matters to the next quantum's crossing test,
      // which skips the dead, so a snake taken above needs no final write
      for (const p of players) if (p.alive) { p.headMajX = p._mx; p.headMajY = p._my; }
    }
    // ---- the whistle ----
    // A timed round ends at exactly durationMs, after everything else in the
    // quantum, so a point scored on the final tick counts. 'time' is an end,
    // not a death: the shells show FULL TIME rather than a cause. Every snake
    // still up goes down together, bodies left where they stood.
    if (S.durationMs && S.clockMs >= S.durationMs && anyAlive()) {
      for (const p of players) {
        if (!p.alive) continue;
        p.alive = false;
        p.deadReason = 'time';
        p.diedAt = S.quanta;
        emit({ t: 'die', player: p.idx, reason: 'time' });
      }
      stampEnd();
    }
    // ---- the clinch ----
    // With rivals on the board, the last snake standing wins the moment its
    // score strictly passes every fallen rival's: nothing left on the pitch
    // can change the order (the dead can no longer score, the survivor can
    // only grow), so the round ends there instead of making the room watch a
    // victory lap. Behind on points, the survivor plays on: pass or die. The
    // test runs the same quantum a rival falls, so a leader outliving the
    // field clinches on the spot. 'won' is an end, not a death.
    if (players.length > 1) {
      let last = null, up = 0;
      for (const p of players) if (p.alive) { last = p; up++; }
      if (up === 1) {
        let bestOther = -Infinity;
        for (const p of players) if (p !== last && p.score > bestOther) bestOther = p.score;
        if (last.score > bestOther) die(last, 'won');
      }
    }
  }

  // ---- the public surface ----

  // Queue turns instead of overwriting one slot, so two quick taps both land.
  // Reversals and repeats are filtered against the last queued/active
  // direction. Callers gate on their own round state (countdown buffering is
  // the caller's choice); the engine only refuses input after death. The
  // third argument names the snake; the shells that know one snake never pass
  // it.
  function setDir(x, y, player = 0) {
    const p = players[player];
    if (!p || !p.alive) return;
    const ref = p.dirQueue.length ? p.dirQueue[p.dirQueue.length - 1] : p.dir;
    if (x === -ref.x && y === -ref.y) return; // no 180° reversal
    if (x === ref.x && y === ref.y) return;   // ignore repeats
    if (p.dirQueue.length < 3) {
      p.dirQueue.push({ x, y });
      // a one-snake log keeps the classic triple shape; more snakes append
      // the player index as a fourth column
      S.log.inputs.push(players.length === 1 ? [S.quanta, x, y] : [S.quanta, x, y, player]);
    }
  }

  // a turn queued before a pause must not fire on resume
  function clearQueue() { for (const p of players) p.dirQueue.length = 0; }

  // Advance by real milliseconds. Whole quanta simulate; the remainder stays
  // in accMs for the renderers' interpolation. Clamp dt at the call site
  // (MAX_DT) so a woken tab never fast-forwards the round.
  function advance(dtMs) {
    S.accMs += dtMs;
    while (anyAlive() && S.accMs >= SIM_DT) { S.accMs -= SIM_DT; quantum(); }
    if (!anyAlive()) S.accMs = 0;
  }

  // exact replay clock, for the validator: run whole quanta with no remainder
  function advanceQuanta(n) {
    for (let i = 0; i < n && anyAlive(); i++) quantum();
  }

  // ---- rollback (netcode) ----
  // A full copy of the simulation at this instant: every snake, the shared
  // world, the PRNG, and how much of the log existed. Restoring one rewinds
  // the machine so late remote inputs can be applied and the quanta re-run;
  // determinism does the rest. Allocation is fine here: snapshots happen on
  // network cadence, never per frame. The events array is transient render
  // fodder and deliberately not part of a snapshot.
  function snapshot() {
    return {
      quanta: S.quanta, clockMs: S.clockMs, progMs: S.progMs, rng: rngA,
      foodAge: S.foodAge, regularEaten: S.regularEaten,
      food: S.food ? { x: S.food.x, y: S.food.y, bonus: S.food.bonus, kind: S.food.kind } : null,
      wallState: S.wallState, wallPhaseEnd: S.wallPhaseEnd, walls: [...S.wallLookup],
      bombs: S.bombs.map(b => ({ x: b.x, y: b.y })),
      bombsUnlocked: S.bombsUnlocked, bombPhase: S.bombPhase,
      bombNextAt: S.bombNextAt, bombExpireAt: S.bombExpireAt,
      ghosts: S.ghosts.map(cloneGhost),
      portal: S.portal ? { ...S.portal } : null,
      portalsUnlocked: S.portalsUnlocked, portalsOpened: S.portalsOpened,
      portalRetryAt: S.portalRetryAt, portalExpireAt: S.portalExpireAt, portalOpenedAt: S.portalOpenedAt,
      players: players.map(p => ({
        snake: p.snake.map(c => ({ x: c.x, y: c.y })),
        tailFrom: p.tailFrom ? { x: p.tailFrom.x, y: p.tailFrom.y } : null,
        headFrom: { x: p.headFrom.x, y: p.headFrom.y },
        headMajX: p.headMajX, headMajY: p.headMajY,
        dir: { x: p.dir.x, y: p.dir.y },
        dirQueue: p.dirQueue.map(d => ({ x: d.x, y: d.y })),
        score: p.score, pendingGrowth: p.pendingGrowth, warpedIn: p.warpedIn,
        alive: p.alive, deadReason: p.deadReason, diedAt: p.diedAt,
      })),
      logLen: S.log.inputs.length, logEnd: S.log.end, logFinal: S.log.finalScore,
    };
  }

  function restore(s) {
    S.quanta = s.quanta; S.clockMs = s.clockMs; S.progMs = s.progMs; rngA = s.rng | 0;
    S.accMs = 0;
    S.foodAge = s.foodAge; S.regularEaten = s.regularEaten;
    S.food = s.food ? { x: s.food.x, y: s.food.y, bonus: s.food.bonus, kind: s.food.kind } : null;
    S.wallState = s.wallState; S.wallPhaseEnd = s.wallPhaseEnd;
    S.wallLookup = new Set(s.walls);
    S.wallCells = wallCellsFrom(s.walls);
    S.bombs = s.bombs.map(b => ({ x: b.x, y: b.y }));
    S.bombsUnlocked = s.bombsUnlocked; S.bombPhase = s.bombPhase;
    S.bombNextAt = s.bombNextAt; S.bombExpireAt = s.bombExpireAt;
    S.ghosts = s.ghosts.map(cloneGhost);
    S.portal = s.portal ? { ...s.portal } : null;
    S.portalsUnlocked = s.portalsUnlocked; S.portalsOpened = s.portalsOpened;
    S.portalRetryAt = s.portalRetryAt; S.portalExpireAt = s.portalExpireAt; S.portalOpenedAt = s.portalOpenedAt;
    for (let i = 0; i < players.length; i++) {
      const p = players[i], q = s.players[i];
      p.snake.length = 0;
      p.snakeSet.clear();
      for (const c of q.snake) { p.snake.push({ x: c.x, y: c.y }); p.snakeSet.add(K(c.x, c.y)); }
      p.tailFrom = q.tailFrom ? { x: q.tailFrom.x, y: q.tailFrom.y } : null;
      p.headFrom.x = q.headFrom.x; p.headFrom.y = q.headFrom.y;
      p.headMajX = q.headMajX; p.headMajY = q.headMajY;
      p.dir = { x: q.dir.x, y: q.dir.y };
      p.dirQueue = q.dirQueue.map(d => ({ x: d.x, y: d.y }));
      p.score = q.score; p.pendingGrowth = q.pendingGrowth; p.warpedIn = q.warpedIn;
      p.alive = q.alive; p.deadReason = q.deadReason; p.diedAt = q.diedAt;
    }
    // the log is append-only: rewinding forgets the inputs recorded after the
    // snapshot, and the resim re-records them at the same quanta
    S.log.inputs.length = s.logLen;
    S.log.end = s.logEnd; S.log.finalScore = s.logFinal;
    S.events.length = 0;
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
  S.wallPhaseEnd = rand(4000, 9000);
  placeFood();
  // Survival: the whole hazard ladder is present at the kickoff whistle, and
  // the opening spawns keep SURVIVAL_CLEAR of walking room from every head.
  // bombsUnlocked doubles as the wave size and is monotonic (rule 22), so
  // seeding it here floors every future wave at startBombs with no new
  // machinery; the ghost ladder never spawns past what already exists.
  for (let i = 0; i < startGhosts; i++) spawnGhost(SURVIVAL_CLEAR);
  if (startBombs > 0) {
    S.bombsUnlocked = startBombs;
    if (bombFirstMs > 0) {
      // the size is seeded, the arrival is not: the board opens clear and
      // the first full wave lands on the normal cycle from there
      S.bombPhase = 'gap';
      S.bombNextAt = bombFirstMs;
    } else {
      for (let i = 0; i < startBombs; i++) spawnBomb(SURVIVAL_CLEAR);
      S.bombPhase = 'active';
      S.bombExpireAt = rand(BOMB_LIFE_MIN, BOMB_LIFE_MAX);
    }
  }

  return Object.assign(S, {
    setDir, clearQueue, advance, advanceQuanta,
    snapshot, restore,
    renderProg, renderNow, drainEvents,
    ghostAt, portalEndAt, cellOccupied, portalBusy,
    // exposed for tests and the validator; not for renderers
    _step: () => stepPlayer(players[0]), _stepPlayer: i => stepPlayer(players[i]),
    _updateWalls: updateWalls, _updateBombs: updateBombs,
    _updateGhosts: updateGhosts, _updatePortals: updatePortals,
    _moveGhost: moveGhost, _ghostTarget: ghostTarget, _ghostDist: ghostDist, _spawnPortal: spawnPortal, _closePortal: closePortal,
    _placeFood: placeFood, _spawnCell: spawnCell,
  });
}

// Re-run a finished round from its log. Returns the game in its final state;
// the validator compares game.score against the submitted score. The inputs
// are (quantum, x, y) triples recorded by setDir, with a player index as the
// fourth column once a board holds more than one snake, so the reproduction
// is exact by construction. v4 logs (the single-snake era) replay under the
// same rules: one snake on a board behaves exactly as it always did.
export function replay(log) {
  // v4 was the single-snake era, v5 multi-snake before the clinch rule; both
  // shapes replay here (no v5 log was ever persisted, so the clinch changing
  // multi-snake endings rewrites nobody's record)
  if (!log || (log.v !== 4 && log.v !== 5 && log.v !== ENGINE_VERSION)) throw new Error('unsupported log version');
  const game = createGame({
    seed: log.seed, tickMs: log.tickMs, wallsEnabled: log.wallsEnabled,
    durationMs: log.durationMs ?? 0, startGhosts: log.startGhosts ?? 0, startBombs: log.startBombs ?? 0,
    bombFirstMs: log.bombFirstMs ?? 0,
    players: log.players ?? 1,
  });
  const inputs = log.inputs;
  let i = 0;
  for (let q = 0; q < log.end && game.alive; q++) {
    while (i < inputs.length && inputs[i][0] === q) { game.setDir(inputs[i][1], inputs[i][2], inputs[i][3] ?? 0); i++; }
    game.advanceQuanta(1);
  }
  return game;
}
