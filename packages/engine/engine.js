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

export const ENGINE_VERSION = 21;  // 21: the bolt blocks ghosts, and a walled-on ghost walks OFF the shape; 20: levels, and goalScore with them; 19: ghosts hold at the line; 18: the hook opening and windows that trim; 15..17: survival scores the clock, full spawn

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
// Absolute caps for time-laddered rounds (survival), where the clock keeps
// asking for more of everything for ever (rule 22: a gate scales, it never
// stops). The caps bound the sim, not the difficulty a human will ever meet:
// twenty ghosts arrive two and a half minutes in.
export const GHOST_MAX = 20;
export const BOMB_MAX = 15;

// The bolt: the one thing that changes a ghost's pace, and it is earned,
// temporary and never in the player's favour twice over (it does nothing at
// all to your own speed, per rule 14). Thirty five percent off their speed
// is a step of GHOST_MS / 0.65, quantized onto the grid every timing
// constant lives on, which lands at 770 and is a 35.1% cut in practice.
export const BOLT_EVERY = 10;      // food eaten, board-wide, between bolts
export const BOLT_LIFE_MS = 8000;  // how long one waits on the pitch to be taken
export const BOLT_SLOW_MS = 5000;  // how long the pack drags after it is taken
export const GHOST_SLOW_MS = 770;  // a slowed ghost's step
// A rival's step while a bolt drags them, at the same 35% off. Derived from
// the round's pace rather than fixed, so it means the same thing at every
// speed setting, and quantized onto the grid every timing constant lives on.
export const slowTick = ms => Math.round(ms / 0.65 / SIM_DT) * SIM_DT;

// The doom window (rule 25): walking into a wall or yourself is not final
// for this long. The head hangs mid-glide over the fatal cell; one safe
// perpendicular press inside the window converts the death into the turn
// that was meant, and silence lands the sentence exactly here. A multiple
// of SIM_DT, at most half the FASTEST tick (so a doomed head never crosses
// the rule 24 majority flip) and under every tick (so doom always resolves
// before the next boundary).
export const REDIRECT_MS = 50;

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
  // Survival proper: nothing scores but the clock. Seconds survived ARE the
  // score; food trims the snake by one (the ringed one by five), a window
  // trip trims five, TNT feeds it five, and the hazards ride the clock
  // instead of the points: one more ghost and one more block per wave every
  // ten seconds for ever, a bolt on the pitch every fifteen. The snake
  // stands thirty one long on the board from the first frame, the hook when
  // played solo (see layoutSnake), so the round looks like what it is
  // before the whistle, and eating is the relief, not the reward.
  survival: {
    startGhosts: 5, startBombs: 9, bombFirstMs: SURVIVAL_TNT_FIRST,
    scoreByTime: true, startLen: 31,
    eatGrowth: -1, bonusGrowth: -5, tntGrowth: 5, portalGrowth: -5,
    ghostEveryMs: 10_000, bombEveryMs: 10_000, boltEveryMs: 15_000,
  },
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
  // against the span of the step actually being taken, not the constant: a
  // slowed ghost's glide is longer, and measuring it against GHOST_MS would
  // read as a snap backwards followed by a stand still
  return Math.max(0, Math.min(1, 1 - (g.moveAt - nowMs) / (g.stepMs || GHOST_MS)));
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

// The opening body, all of it, from the first frame, nothing wrapping the
// screen edge. Up to nine cells is the classic straight line back along
// the lane from the head at (8, laneY). A longer SOLO opening (survival's
// thirty one) is the hook the mode is known by: the tail on the top left
// square, fifteen cells down the left wall, one right, ten back up the
// next column, and five right to the head at (6, 4), which leaves three of
// the four directions open at the whistle (straight on meets the snake's
// own wrapped body a lap out, and the doom window judges that press like
// any other wrong turn). A long opening in a ROOM cannot share the one
// corner, so it packs into the lane's own three rows instead: a weave of
// the lane row and its center-side neighbour column by column down to 0, a
// run back along the far row, and a hook up and back along the far column;
// the bands never collide at any player count, and the head keeps
// (9, laneY) and its center-side neighbour free. Both shapes hold n <= 31.
function layoutSnake(n, laneY, solo) {
  if (n <= 9) {
    const line = [[8, laneY]];
    for (let i = 1; i < n; i++) line.push([8 - i, laneY]);
    return line;
  }
  if (solo) {
    const cells = [];
    for (let x = 6; x >= 2; x--) cells.push([x, 4]);      // head first: the five along row 4
    for (let y = 4; y <= 13; y++) cells.push([1, y]);     // the ten of the doubled-back column
    cells.push([1, 14]);                                  // the one-cell elbow
    for (let y = 14; y >= 0; y--) cells.push([0, y]);     // the fifteen up the wall to the corner
    return cells.slice(0, n);
  }
  const m = laneY > GRID / 2 ? -1 : 1;
  const cells = [[8, laneY]];
  for (let x = 7; x >= 0; x--) {
    if ((7 - x) % 2 === 0) cells.push([x, laneY], [x, laneY + m]);
    else cells.push([x, laneY + m], [x, laneY]);
  }
  cells.push([0, laneY - m]);
  for (let x = 1; x <= 10; x++) cells.push([x, laneY - m]);
  cells.push([10, laneY], [10, laneY + m], [9, laneY + m]);
  return cells.slice(0, n);
}

// ---- levels: onboarding, not a campaign ----
// This game's loop is score chasing: one more run, beat your best, reach the
// board. A level campaign is a DIFFERENT loop, and pretending otherwise makes
// a worse version of both. So levels here do one job: teach the five things
// the pitch will otherwise kill you with, and hand the player to the endless
// modes competent rather than confused.
//
// A level is a config and nothing else, exactly like a mode, which is why
// this table is here and not in a shell. It is ordered, and the order IS the
// teaching order: each level introduces one hazard and nothing else, so a
// death always has one obvious cause. `id` is stable and is what progression
// is stored against, so levels may be reordered or inserted without wiping
// anybody's progress; never reuse an id for different content.
//
// Every level carries its own seed, so the board is the same for everyone and
// a hint about a level is true for the person reading it.
export const LEVELS = [
  {
    id: 'first-touch',
    name: 'FIRST TOUCH',
    teach: 'Steer with the arrows, WASD, a swipe, the pad or a controller.',
    goal: 'Eat 3.',
    cfg: { seed: 1101, wallsEnabled: false, goalScore: 3 },
  },
  {
    id: 'keep-your-shape',
    name: 'KEEP YOUR SHAPE',
    teach: 'You grow with every bite, and your own body is solid.',
    goal: 'Eat 4 without folding into yourself.',
    cfg: { seed: 1102, wallsEnabled: false, startLen: 14, goalScore: 4 },
  },
  {
    id: 'the-walls',
    name: 'THE WALLS COME UP',
    teach: 'Walls flash before they bite. Fly into one and you have a heartbeat to turn out.',
    // The food is a trap here and the wording says so: a greedy player grows,
    // boxes itself in and dies to its own tail rather than to the thing this
    // level is about. Verified both ways, a food-chasing policy dies at three
    // seconds and a survival one reaches the whistle.
    goal: 'Survive 25 seconds. Forget the food.',
    cfg: { seed: 1103, wallsEnabled: true, durationMs: 25_000 },
  },
  {
    id: 'man-marking',
    name: 'MAN MARKING',
    teach: 'A ghost hunts you, but it can never cross onto you: every ghost death is one you steered into.',
    goal: 'Eat 4 with a ghost on the pitch.',
    cfg: { seed: 1104, wallsEnabled: false, startGhosts: 1, goalScore: 4 },
  },
  {
    id: 'danger-on-the-pitch',
    name: 'DANGER ON THE PITCH',
    teach: 'TNT is not food. It costs you five points and five of your length.',
    goal: 'Eat 4 and leave the TNT alone.',
    cfg: { seed: 1105, wallsEnabled: false, startBombs: 3, bombFirstMs: 2500, goalScore: 4 },
  },
];

export function createGame(cfg = {}) {
  const seed = (cfg.seed ?? 1) >>> 0;
  const tickMs = cfg.tickMs ?? SPEEDS.normal;
  const wallsEnabled = cfg.wallsEnabled ?? true;
  const durationMs = cfg.durationMs ?? 0;   // 0 = endless
  // A round that can be WON rather than merely survived. 0 means there is no
  // goal, which is every mode the game shipped with; a level sets it and the
  // round ends the moment the score reaches it. Levels are the only caller,
  // and 'survive N seconds' needs nothing new at all: durationMs already ends
  // a round, and for a level that whistle IS the win.
  const goalScore = cfg.goalScore ?? 0;
  const startGhosts = cfg.startGhosts ?? 0; // survival: personalities present at kickoff
  const startBombs = cfg.startBombs ?? 0;   // survival: TNT wave size floored here for ever
  const bombFirstMs = cfg.bombFirstMs ?? 0; // how long the board stays clear of that first wave
  const playerCount = cfg.players ?? 1;
  // ---- the survival knobs ----
  // scoreByTime makes seconds survived the score and the ONLY score: eating,
  // TNT and teleport trips all pay nothing in such a round. The growth knobs
  // say what entering food or TNT does to the body (survival inverts both),
  // startLen how long the snake stands at the first frame, in full, folded
  // when it outgrows the classic straight line (layoutSnake). The everyMs
  // knobs move a ladder off the score and onto the clock.
  const scoreByTime = cfg.scoreByTime ?? false;
  const startLen = cfg.startLen ?? START_LEN;
  const eatGrowth = cfg.eatGrowth ?? 1;
  const bonusGrowth = cfg.bonusGrowth ?? 5;
  const tntGrowth = cfg.tntGrowth ?? -5;
  const portalGrowth = cfg.portalGrowth ?? 0;   // survival: a trip trims five
  const ghostEveryMs = cfg.ghostEveryMs ?? 0;
  const bombEveryMs = cfg.bombEveryMs ?? 0;
  const boltEveryMs = cfg.boltEveryMs ?? 0;
  if (tickMs % SIM_DT !== 0) throw new Error('tickMs must be a multiple of SIM_DT');
  if (durationMs % SIM_DT !== 0 || durationMs < 0) throw new Error('durationMs must be a non-negative multiple of SIM_DT');
  if (!Number.isInteger(startGhosts) || startGhosts < 0 || startGhosts > (ghostEveryMs ? GHOST_MAX : GHOST_SCORES.length)) throw new Error('startGhosts out of range');
  if (!Number.isInteger(startBombs) || startBombs < 0 || startBombs > (bombEveryMs ? BOMB_MAX : TNT_SCORES.length)) throw new Error('startBombs out of range');
  if (bombFirstMs % SIM_DT !== 0 || bombFirstMs < 0) throw new Error('bombFirstMs must be a non-negative multiple of SIM_DT');
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) throw new Error('players out of range');
  if (!Number.isInteger(startLen) || startLen < START_LEN || startLen > 31) throw new Error('startLen out of range');
  if (!Number.isInteger(eatGrowth) || !Number.isInteger(bonusGrowth) || !Number.isInteger(tntGrowth) || !Number.isInteger(portalGrowth)) throw new Error('growth knobs must be integers');
  for (const v of [ghostEveryMs, bombEveryMs, boltEveryMs])
    if (v % SIM_DT !== 0 || v < 0) throw new Error('everyMs knobs must be non-negative multiples of SIM_DT');

  // mulberry32: small, fast, good-enough PRNG with a 32-bit seed. Not for
  // crypto; for making a round reproducible. The state lives in rngState so
  // snapshot()/restore() can carry it: a rollback must re-roll the same dice.
  let rngState = seed >>> 0;
  function random() {
    rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rand = (a, b) => a + random() * (b - a);

  // One snake. Everything singular the old engine kept at the top level now
  // lives here once per player; the world stays shared. _majX/_majY/_m are
  // per-quantum contact scratch (rule 24), never persisted.
  function makePlayer(idx, laneY) {
    const cells = layoutSnake(startLen, laneY, playerCount === 1);
    const [hx, hy] = cells[0];
    const p = {
      idx,
      snake: [], snakeSet: new Set(), tailFrom: null,
      headFrom: { x: hx, y: hy },
      headMajX: hx, headMajY: hy,
      dir: { x: 1, y: 0 }, dirQueue: [],
      score: 0, pendingGrowth: 0,
      warpedIn: false,
      // This snake's own pace. Every snake used to share one clock, which is
      // why they crossed cell boundaries together; a bolt taken in a room
      // slows the rivals and not the taker, so the pace had to become each
      // snake's own. progMs is progress toward THIS snake's next step.
      tickMs, progMs: 0, slowUntil: 0,
      doom: null,              // {tx, ty, until, reason} while a fatal move hangs (rule 25)
      doomSave: null,          // a press taken during that window, applied by the next quantum
      alive: true, deadReason: null, diedAt: 0,
      _majX: 0, _majY: 0,          // this quantum's majority cell (rule 24 scratch)
    };
    for (const [x, y] of cells) { p.snake.push({ x, y }); p.snakeSet.add(K(x, y)); }
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
    scoreByTime, startLen, eatGrowth, bonusGrowth, tntGrowth, portalGrowth,
    ghostEveryMs, bombEveryMs, boltEveryMs,
    players,
    quanta: 0,          // sim quanta elapsed; the replay clock
    clockMs: 0,         // one hazard clock (the old wall/bomb/ghost/portal clocks were identical)
    // progMs is not a field here: the singular alias below makes S.progMs read
    // players[0].progMs, which is where a snake's per-cell progress really lives
    accMs: 0,           // dt not yet turned into quanta (always < SIM_DT after advance)

    food: null,         // {x, y, bonus, kind} - kind indexes the renderer's emoji list
    foodAge: 0, bonusStreak: 0,    // the bonus streak is the board's, not a snake's
    // The bolt is the board's too: one counter of everything eaten by anyone
    // (a ringed bonus is one item like any other, a teleport trip is not an
    // item at all), a mark every BOLT_EVERY that is only ever raised, and one
    // clock saying how long the pack is dragging.
    itemsEaten: 0, bolt: null, boltsSpawned: 0, slowUntil: 0,

    wallState: 'off', wallPhaseEnd: 0, wallCells: [], wallLookup: new Set(),

    bombs: [], bombsUnlocked: 0, bombPhase: 'gap', bombNextAt: 0, bombExpireAt: 0,

    ghosts: [],         // {x, y, px, py, dir, warped, moveAt}

    portal: null,       // {ax, ay, bx, by, used}: the blue end, then the violet end
    portalsUnlocked: 0, portalMarksSpent: 0, portalRetryAt: 0,
    portalExpireAt: 0, portalOpenedAt: 0,

    // what happened since the caller last drained; renderers turn these into
    // bursts, sprites and DOM updates. Sim state never depends on it.
    events: [],
    // the round's replayable record. end/finalScore are stamped when the last
    // snake goes down; a multi-snake log carries every score and death time.
    log: { v: ENGINE_VERSION, seed, tickMs, wallsEnabled, durationMs, startGhosts, startBombs, bombFirstMs,
           scoreByTime, startLen, eatGrowth, bonusGrowth, tntGrowth, portalGrowth,
           ghostEveryMs, bombEveryMs, boltEveryMs, goalScore,
           players: playerCount, inputs: [], end: 0, finalScore: 0 },
  };

  // The singular surface: player 0 under the old names, reads AND writes, so
  // the web page, the mobile shell and the whole one-snake test suite work
  // unchanged. Engine code below never goes through these.
  for (const f of ['snake', 'snakeSet', 'tailFrom', 'headFrom', 'headMajX', 'headMajY',
                   'dir', 'dirQueue', 'score', 'pendingGrowth', 'warpedIn', 'deadReason',
                   'doom', 'doomSave', 'progMs']) {
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
    if (S.bolt !== null && S.bolt.x === x && S.bolt.y === y) return true;
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
    c.bonus = S.bonusStreak >= BONUS_EVERY;  // ringed +5 only after a full streak
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
      // never leave food or a TNT buried under a fresh wall
      if (S.food && S.wallLookup.has(K(S.food.x, S.food.y))) placeFood();
      for (let i = S.bombs.length - 1; i >= 0; i--) {
        const b = S.bombs[i];
        if (!S.wallLookup.has(K(b.x, b.y))) continue;
        const c = spawnCell(MIN_SPAWN_DIST);
        if (c) { b.x = c.x; b.y = c.y; }
        else S.bombs.splice(i, 1);   // nowhere safe: drop it rather than bury it in a wall
      }
      // A ghost the shape lands on is NOT moved: relocating it teleported it,
      // sometimes straight into a player's path. It keeps its feet and walks
      // out through the shape instead (the ghostBlocked exception).
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

  // ---- pace ----
  // A snake's tick is constant between events and changes only when a bolt
  // starts or stops dragging it (rule 14 is about never re-timing the step in
  // flight to shave latency, which this does not do). The change would still
  // jump the drawn snake, because progress is read as progMs / tickMs: at the
  // instant the tick grows, the same progMs suddenly means less of a step. So
  // progress is rescaled into the new tick, which keeps the head exactly where
  // it was drawn and only re-times what is still to come.
  function setPace(p, tickMs) {
    if (p.tickMs === tickMs) return;
    p.progMs = p.progMs * tickMs / p.tickMs;
    p.tickMs = tickMs;
  }

  function expirePace(p) {
    if (p.slowUntil && S.clockMs >= p.slowUntil) {
      p.slowUntil = 0;
      setPace(p, tickMs);
    }
  }

  // ---- the bolt ----
  // One falls due every BOLT_EVERY items eaten, by anyone, for ever: a count
  // of appetite rather than of score, so it never rides the hazard ladders
  // and a TNT costing points cannot buy one. The mark is derived and only
  // ever raised, so a bolt left to expire spends its mark exactly as a bolt
  // taken does; the next one comes with the next ten.
  function updateBolt() {
    if (S.bolt !== null) {
      if (S.clockMs - S.bolt.bornAt >= BOLT_LIFE_MS) {
        emit({ t: 'bolt', gone: true, x: S.bolt.x, y: S.bolt.y });
        S.bolt = null;
      }
      return;
    }
    // a time-laddered round (survival) drops one on the clock instead of on
    // appetite; the mark stays derived and only ever raised either way
    const due = boltEveryMs ? (S.clockMs / boltEveryMs) | 0 : (S.itemsEaten / BOLT_EVERY) | 0;
    if (due <= S.boltsSpawned) return;
    const c = spawnCell(MIN_SPAWN_DIST);
    if (!c) return;                    // no room this quantum; ask again next
    S.bolt = { x: c.x, y: c.y, bornAt: S.clockMs };
    S.boltsSpawned = due;
    emit({ t: 'bolt', gone: false, x: c.x, y: c.y });
  }

  // ---- TNT ----
  function spawnBomb(minDist = MIN_SPAWN_DIST) {
    const c = spawnCell(minDist);
    if (c) S.bombs.push(c);
  }

  function updateBombs() {
    // The ladder only ever sets the SIZE of a wave, never whether one comes
    // (rule 22). On the clock (survival): one more block per wave every
    // bombEveryMs from the kickoff size, pinned at BOMB_MAX, for ever. On
    // the score: the classic marks, pinned at TNT_SCORES.length. Do not add
    // a gate check below this line: that is what would make waves stop.
    // Monotonic either way, so nothing ever shrinks the wave.
    if (bombEveryMs) {
      const target = Math.min(BOMB_MAX, startBombs + ((S.clockMs / bombEveryMs) | 0));
      if (target > S.bombsUnlocked) S.bombsUnlocked = target;
    } else {
      const lead = leaderScore();
      while (S.bombsUnlocked < TNT_SCORES.length && lead >= TNT_SCORES[S.bombsUnlocked]) S.bombsUnlocked++;
    }
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
        const headEnd = portalEndAt(p.snake[0].x, p.snake[0].y);
        if (headEnd === 1 && x === S.portal.bx && y === S.portal.by) return true;
        if (headEnd === 2 && x === S.portal.ax && y === S.portal.ay) return true;
      }
    }
    const k = K(x, y);
    for (let i = 0; i < players.length; i++) if (players[i].snakeSet.has(k)) return true;
    // The one wall exception: a ghost standing on a wall cell (a shape just
    // formed on it) may cross walls, phasing out on its own legs instead of
    // teleporting to open ground. Ghosts never walk INTO a wall otherwise, so
    // standing clear closes the pass behind it: one way, out.
    if (S.wallLookup.has(k) && !S.wallLookup.has(K(self.x, self.y))) return true;
    if (S.food !== null && S.food.x === x && S.food.y === y) return true;
    // the bolt is the players' relief and blocks like food does: a ghost
    // parked on it was hiding the one thing you needed to reach (v21)
    if (S.bolt !== null && S.bolt.x === x && S.bolt.y === y) return true;
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
    // flanks, pink cuts off, cyan wardens the food. A pack past five (the
    // survival clock keeps hiring) starts the cycle again.
    S.ghosts.push({
      x: c.x, y: c.y, px: c.x, py: c.y,
      dir: { x: 0, y: 0 }, warped: false,
      role: S.ghosts.length % 5,
      moveAt: S.clockMs + GHOST_MS, stepMs: GHOST_MS,
      majX: c.x, majY: c.y,        // majority cell one quantum ago (rule 24)
      crossed: true,               // standing where it is: nothing in flight to hold
    });
  }

  // The straight-line (portal-aware) distance the ghosts USED to steer by,
  // before ghostField/fieldDist replaced it with the true walk (rule 23). No
  // engine code calls it any more; it is kept, and exported as _airDist, as
  // the test suite's contrast baseline: the tests assert the walk knows about
  // walls the crow-flight is blind to. It still folds an open, unused teleport
  // pair into the reckoning (to an end, one hop, out the far side), and prices
  // a step landing ON an end as the far side plus that hop.
  function airDist(x, y, tx, ty) {
    let d = wrapDist(x, y, tx, ty);
    const pair = S.portal;
    if (pair !== null && !pair.used) {
      const viaA = wrapDist(x, y, pair.ax, pair.ay) + 1 + wrapDist(pair.bx, pair.by, tx, ty);
      if (viaA < d) d = viaA;
      const viaB = wrapDist(x, y, pair.bx, pair.by) + 1 + wrapDist(pair.ax, pair.ay, tx, ty);
      if (viaB < d) d = viaB;
    }
    return d;
  }

  // ---- the ghosts' map (rule 23) ----
  // A ghost's real sense of distance: the shortest WALK to a cell, over the
  // board it may actually cross. The old metric flew straight (through walls,
  // through bodies) and a third of every ghost's steps went nowhere as a
  // result: it would press against the wrong side of a shape with the head
  // three cells away and no route to it. This is one breadth-first sweep from
  // the target, and every candidate step then reads its own true distance out
  // of the field.
  //
  // Cheap by construction: a ghost steps twice a second, so a full pack asks
  // for ten sweeps of 400 cells a second, and the arrays are allocated once.
  // Deterministic by construction: fixed neighbour order, one queue, no dice.
  const _walkField = new Int16Array(GRID * GRID);   // steps from the target, -1 unreached
  const _impassable = new Uint8Array(GRID * GRID); // terrain a ghost cannot walk
  const _sweepQueue = new Int32Array(GRID * GRID);
  const NO_ROUTE_BASE = 4000;                      // worse than any real walk on this board

  // Terrain, painted once per sweep by walking what is on the board rather
  // than asking every cell what is on it. Ghosts are left OUT: they move, and
  // a route that a passing ghost happens to sit on is not a route that is
  // shut. A ghost a wall has formed on top of crosses walls (rule 23's one
  // exception), so it gets a map with the walls left off.
  function paintTerrain(g) {
    _impassable.fill(0);
    // a shape stops a ghost from its first flash, not from the moment it
    // turns lethal, so the map matches ghostBlocked and not the wall phase
    if (!S.wallLookup.has(K(g.x, g.y))) {
      for (const k of S.wallLookup) _impassable[k] = 1;
    }
    for (let i = 0; i < players.length; i++) {
      if (!players[i].alive) continue;
      for (const k of players[i].snakeSet) _impassable[k] = 1;
    }
    if (S.food !== null) _impassable[K(S.food.x, S.food.y)] = 1;
    if (S.bolt !== null) _impassable[K(S.bolt.x, S.bolt.y)] = 1;
    for (let i = 0; i < S.bombs.length; i++) _impassable[K(S.bombs[i].x, S.bombs[i].y)] = 1;
  }

  // Fill _walkField with the walk length from (tx, ty) to every cell. The target
  // itself is seeded whatever stands on it, because a ghost hunts the cell a
  // head or a piece of food occupies and wants the ring around it.
  function ghostField(g, tx, ty) {
    paintTerrain(g);
    _walkField.fill(-1);
    const pair = S.portal;
    const aK = (pair !== null && !pair.used) ? K(pair.ax, pair.ay) : -1;
    const bK = (pair !== null && !pair.used) ? K(pair.bx, pair.by) : -1;
    let qRead = 0, qWrite = 0;
    const startCell = K(tx, ty);
    _walkField[startCell] = 0;
    _sweepQueue[qWrite++] = startCell;
    while (qRead < qWrite) {
      const k = _sweepQueue[qRead++];
      const d = _walkField[k] + 1;
      const cx = (k / GRID) | 0, cy = k % GRID;
      for (let i = 0; i < GHOST_DIRS.length; i++) {
        const nk = K(wrap(cx + GHOST_DIRS[i].x), wrap(cy + GHOST_DIRS[i].y));
        if (_walkField[nk] !== -1 || _impassable[nk]) continue;
        _walkField[nk] = d;
        _sweepQueue[qWrite++] = nk;
      }
      // an open unused pair is one edge between its two ends, priced like any
      // other step, which is exactly what the forced hop will cost
      const far = k === aK ? bK : k === bK ? aK : -1;
      if (far >= 0 && _walkField[far] === -1 && !_impassable[far]) {
        _walkField[far] = d;
        _sweepQueue[qWrite++] = far;
      }
    }
  }

  // A cell's distance after a sweep. Somewhere genuinely walled off still
  // needs an ordering, or a boxed-in ghost would pick at random among cells
  // it cannot reach: those fall back to the straight line, all of them ranked
  // below anywhere it can actually walk to.
  function fieldDist(x, y, tx, ty) {
    const d = _walkField[K(x, y)];
    return d >= 0 ? d : NO_ROUTE_BASE + wrapDist(x, y, tx, ty);
  }

  // Which snake a ghost is hunting: the nearest living head by its own
  // wormhole metric, ties to the lower index. One snake is just the
  // degenerate case (the loop, or the fallback once it is dead, both name
  // it); five means pressure follows proximity and the last snake standing
  // collects the whole pack. Pure arithmetic: no PRNG draw, so a one-snake
  // round rolls exactly the dice it always rolled.
  function victimOf(g) {
    // one snake on the board is the whole answer, and asking the map for it
    // would be a sweep spent to learn nothing
    let living = null, count = 0;
    for (const p of players) if (p.alive) { living = p; count++; }
    if (count <= 1) return living ?? players[0];
    // otherwise the nearest head by the walk, not by the crow: a rival three
    // cells away through a wall is not the one to hunt. The sweep is rooted
    // at the ghost so one pass prices every head; moveGhost roots its own at
    // the target afterwards, and the two never overlap.
    ghostField(g, g.x, g.y);
    let best = null, bestD = Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      const d = fieldDist(p.snake[0].x, p.snake[0].y, g.x, g.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ?? players[0];
  }

  // Where a ghost is trying to be, by personality, relative to its victim.
  // Pure targeting: the legs (GHOST_MS, the no-reverse rule, blocked cells)
  // are identical for all five.
  function ghostTarget(g) {
    // the one override before personality (v21): a ghost a wall has formed
    // on is not hunting, it is leaving, and every role leaves the same way.
    // Inside ghostTarget so intelligence keeps living here and nowhere else.
    if (S.wallLookup.has(K(g.x, g.y))) return wallExit(g);
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

  // A ghost a wall has formed on has one job: off the shape, by the
  // shortest walk (v21). Its personality resumes on clear ground. Before
  // this the target stayed the hunt, which dragged a phasing ghost back and
  // forth ALONG the shape whenever its victim moved, lingering on cells it
  // was only ever passing through. The sweep is rooted at the ghost (its
  // map has the walls off while it stands on one), and the nearest cell
  // not under the shape wins; ties fall to scan order, which is fixed, so
  // replays agree. A ghost boxed in on the shape keeps its own cell and
  // falls back to the ordinary shuffle.
  function wallExit(g) {
    ghostField(g, g.x, g.y);
    let bx = g.x, by = g.y, bd = Infinity;
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const k = K(x, y);
        if (S.wallLookup.has(k)) continue;
        const d = _walkField[k];
        if (d >= 0 && d < bd) { bd = d; bx = x; by = y; }
      }
    }
    return { x: bx, y: by };
  }

  // One deep copy of a ghost, used by both ends of a rollback. A ghost field
  // added in one copy and missed in the other would not fail at the edit
  // site: it would surface much later as a netcode desync, so there is one
  // copy. The key order here is also the hashed key order, identically on
  // every peer.
  const cloneGhost = g => ({
    x: g.x, y: g.y, px: g.px, py: g.py, dir: { x: g.dir.x, y: g.dir.y },
    warped: g.warped, role: g.role, moveAt: g.moveAt, stepMs: g.stepMs, majX: g.majX, majY: g.majY,
    crossed: g.crossed,
  });

  // one ghost moves at a time, so the step search shares this scratch
  const _optDir = new Array(4), _optDist = new Int32Array(4);
  const _optX = new Int32Array(4), _optY = new Int32Array(4);

  function moveGhost(g) {
    g.px = g.x; g.py = g.y;                    // remember where we came from (smooth render)
    g.crossed = false;                         // a fresh step has not passed the line yet
    // a ghost in either window spends this move coming out of the other,
    // keeping its heading, but only when the far side is clear, and never
    // straight back out of the window that has just put it down
    const portalEnd = (g.warped || S.portal === null || S.portal.used) ? 0 : portalEndAt(g.x, g.y);
    if (portalEnd) {
      const tx = portalEnd === 1 ? S.portal.bx : S.portal.ax;
      const ty = portalEnd === 1 ? S.portal.by : S.portal.ay;
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
    let pickX, pickY, pickDir;
    if (n) {
      if (random() < GHOST_FOCUS) {          // take a step toward the personality's target
        const target = ghostTarget(g);
        ghostField(g, target.x, target.y);       // one sweep, then every option is a lookup
        let bestDist = Infinity;
        for (let i = 0; i < n; i++) {
          const d = fieldDist(_optX[i], _optY[i], target.x, target.y);
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
        pickDir = _optDir[at]; pickX = _optX[at]; pickY = _optY[at];
      } else {
        const i = (random() * n) | 0;
        pickDir = _optDir[i]; pickX = _optX[i]; pickY = _optY[i];
      }
    } else {                                 // boxed in: reverse if we can, else wait
      const rx = wrap(g.x - g.dir.x), ry = wrap(g.y - g.dir.y);
      if (!(g.dir.x || g.dir.y) || ghostBlocked(rx, ry, g)) return;
      pickDir = { x: -g.dir.x, y: -g.dir.y }; pickX = rx; pickY = ry;
    }
    g.x = pickX; g.y = pickY; g.dir = pickDir;
  }

  function updateGhosts() {
    // The arrival emit lives here, not in spawnGhost, so the survival
    // kickoff pack stays silent: standing there at the whistle is scenery,
    // joining mid-round is a moment. Events are not part of the log.
    // On the clock (survival): one joins every ghostEveryMs for ever, one
    // spawn attempt per quantum, pinned at GHOST_MAX. On the score: the
    // classic five marks.
    const ghostsDue = ghostEveryMs
      ? Math.min(GHOST_MAX, startGhosts + ((S.clockMs / ghostEveryMs) | 0)) > S.ghosts.length
      : S.ghosts.length < GHOST_SCORES.length && leaderScore() >= GHOST_SCORES[S.ghosts.length];
    if (ghostsDue) {
      const before = S.ghosts.length;
      spawnGhost();
      if (S.ghosts.length > before) emit({ t: 'ghost', n: S.ghosts.length });
    }
    // The one thing that ever changes a ghost's pace, and it is earned and it
    // runs out (rule 23). The span is stamped on the ghost as it steps, so
    // the renderers interpolate the glide they are actually watching.
    const stepMs = S.clockMs < S.slowUntil ? GHOST_SLOW_MS : GHOST_MS;
    for (const g of S.ghosts) {
      if (S.clockMs >= g.moveAt) { moveGhost(g); g.stepMs = stepMs; g.moveAt = S.clockMs + stepMs; }
    }
  }

  // Whether any living head is standing in this cell: the one it is entering
  // (held from the first quantum of the glide, not from the halfway flip) or
  // the one it is still leaving. The two cells a head is drawn across.
  function headHolds(x, y) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.alive) continue;
      if (p.snake[0].x === x && p.snake[0].y === y) return true;
      if (p.headFrom.x === x && p.headFrom.y === y) return true;
    }
    return false;
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
    if (refund && S.portalMarksSpent > 0) { S.portalMarksSpent--; S.portalRetryAt = S.clockMs + 2000; }
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
    if (S.portalMarksSpent >= S.portalsUnlocked || S.clockMs < S.portalRetryAt) return;
    if (spawnPortal()) {
      S.portalMarksSpent++;
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
    // A hanging move belongs to the death it was hanging toward and to no
    // other: a ghost taking a doomed head, or the whistle, must not leave the
    // renderers drawing a corpse lunging into a cell it never entered. The
    // sentence itself puts the record back, because there the pose is true.
    p.doom = null;
    p.doomSave = null;
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

  // Whether THIS move keeps the tail: growth already owed plus what the food
  // on the entered cell would add, which the growth knobs make negative in
  // survival, where eating trims. One formula shared by the fatal judgment
  // and the move itself, so the tail exemption and the actual tail always
  // agree.
  const stepGrows = (p, ate) => p.pendingGrowth + (ate ? (S.food.bonus ? bonusGrowth : eatGrowth) : 0) > 0;

  // What entering (nx, ny) would cost this snake its life to: 'wall', 'self',
  // or null. The one shared judgment for the step, the doom save, and the
  // doom sentence, so all three always agree.
  function moveDeadly(p, nx, ny) {
    const nk = K(nx, ny);
    // interior walls are lethal only once they're live
    if (S.wallState === 'solid' && S.wallLookup.has(nk)) return 'wall';
    // SELF collision only, O(1): another snake's body is thin air (snakes
    // race, they never fence). The tail cell is exempt when it glides out
    // this tick; whether this tick grows decides that, so settle it first.
    const ate = nx === S.food.x && ny === S.food.y;
    const grows = stepGrows(p, ate);
    const tail = p.snake[p.snake.length - 1];
    if (p.snakeSet.has(nk) && (grows || nk !== K(tail.x, tail.y))) return 'self';
    // ghosts are NOT tested here: contact with a mover is decided by the
    // majority-cell rule in quantum() (rule 24), never by cell entry
    return null;
  }

  function stepPlayer(p) {
    // A hanging move has not been taken yet, so there is no step to take on
    // top of it. Without this the window re-arms itself at every boundary
    // once a tick is no longer than REDIRECT_MS, and the snake is immortal.
    if (p.doom) return;
    // Take the next press the heading can still accept. setDir chains the
    // queue against the heading at push time, but a doom save changes the
    // heading out of band, which can leave a press behind that is now a
    // reversal or a repeat: it is stale, not an instruction, so it is dropped.
    while (p.dirQueue.length) {
      const d = p.dirQueue.shift();
      if (d.x === -p.dir.x && d.y === -p.dir.y) continue;
      if (d.x === p.dir.x && d.y === p.dir.y) continue;
      p.dir = { x: d.x, y: d.y };   // copy out x/y only: the queue entry carries a log index (li)
      break;
    }
    // A head standing in a window spends this step coming out of the far one:
    // still exactly one step, heading untouched, pace unchanged (rules 16/17).
    // Only a head that walked in is carried, never one a window just put down.
    const portalEnd = (p.warpedIn || S.portal === null || S.portal.used) ? 0
              : portalEndAt(p.snake[0].x, p.snake[0].y);
    const nx = portalEnd === 1 ? S.portal.bx : portalEnd === 2 ? S.portal.ax : wrap(p.snake[0].x + p.dir.x);
    const ny = portalEnd === 1 ? S.portal.by : portalEnd === 2 ? S.portal.ay : wrap(p.snake[0].y + p.dir.y);
    const reason = moveDeadly(p, nx, ny);
    if (reason) {
      // A hop is forced, so its one fatal case (a body on the far end) stays
      // entry-tested; there was never a choice to un-make.
      if (portalEnd) return die(p, reason);
      // The doom window (rule 25): the move hangs instead of killing. The
      // state stays put, the glide anchor snaps to the cell the head owns so
      // the rule 24 majority holds still, and the renderers draw the head
      // reaching into the fatal cell while the body waits.
      p.headFrom.x = p.snake[0].x; p.headFrom.y = p.snake[0].y;
      p.doom = { tx: nx, ty: ny, until: S.clockMs + REDIRECT_MS, reason };
      // a combo press already queued is an instant save when it works
      if (p.dirQueue.length && tryRedirect(p, p.dirQueue[0].x, p.dirQueue[0].y)) p.dirQueue.shift();
      return;
    }
    commitMove(p, nx, ny, portalEnd);
  }

  // The move itself, past every fatal test: state, tail, growth, rewards.
  // Runs at the boundary normally, mid-glide for a doom save, and at window
  // end for a pardoned doom (the drawn glide can't tell the difference).
  function commitMove(p, nx, ny, portalEnd) {
    const nk = K(nx, ny);
    const ate = nx === S.food.x && ny === S.food.y;
    const grows = stepGrows(p, ate);

    // move: pop the vacated tail first so the set stays exact, then add the head
    p.headFrom.x = p.snake[0].x; p.headFrom.y = p.snake[0].y;
    if (grows) p.tailFrom = null;
    else { p.tailFrom = p.snake.pop(); p.snakeSet.delete(K(p.tailFrom.x, p.tailFrom.y)); }
    p.snake.unshift({ x: nx, y: ny });
    p.snakeSet.add(nk);
    p.warpedIn = portalEnd !== 0;
    if (portalEnd) {
      // one trip a pair, paid on surfacing, after every fatal test above;
      // with several snakes racing, the first head through takes the prize
      const fromA = portalEnd === 1;
      S.portal.used = true;
      // in a time-scored round the trip is free travel: the score is the
      // clock and nothing else may touch it. Survival pays in its own coin
      // instead: portalGrowth trims segments (drained below, floored).
      if (!scoreByTime) p.score += PORTAL_BONUS;
      p.pendingGrowth += portalGrowth;
      emit({ t: 'hop', player: p.idx, fromA,
             fx: fromA ? S.portal.ax : S.portal.bx, fy: fromA ? S.portal.ay : S.portal.by,
             tx: nx, ty: ny });
    }

    if (ate) {
      const bonus = S.food.bonus;
      // a time-scored round pays nothing for food: eating is body management
      if (!scoreByTime) p.score += bonus ? 5 : 1;
      p.pendingGrowth += bonus ? bonusGrowth : eatGrowth;
      if (bonus) S.bonusStreak = 0;   // bonus taken: restart the board's streak
      else S.bonusStreak++;
      S.itemsEaten++;          // appetite, board-wide: a ringed bonus is one item
      emit({ t: 'eat', player: p.idx, bonus, x: nx, y: ny });
      placeFood();
    }

    // The bolt binds at entry and locks, like every other consuming move
    // (rule 25). It scores nothing and grows nothing: all it buys is time.
    if (S.bolt !== null && nx === S.bolt.x && ny === S.bolt.y) {
      S.slowUntil = S.clockMs + BOLT_SLOW_MS;
      // In a room it drags the rivals too, and never the snake that took it:
      // the ghosts slowing helps everyone equally, so without this a bolt
      // would be worth no more to the player who went and got it.
      for (const other of players) {
        if (other === p || !other.alive) continue;
        other.slowUntil = S.slowUntil;
        setPace(other, slowTick(tickMs));
      }
      emit({ t: 'zap', player: p.idx, x: nx, y: ny, untilMs: S.slowUntil });
      S.bolt = null;
    }
    if (grows) p.pendingGrowth--;

    // TNT never kills, in either direction of the knob. Classic (negative):
    // -5 points (may go negative), up to five segments off, floored at
    // START_LEN, queued growth cancelled so the shrink sticks. Survival
    // (positive): it pays nothing and instead feeds the snake, which on a
    // board where small is safe IS the punishment.
    let bombIndex = -1;
    for (let i = 0; i < S.bombs.length; i++) {
      if (nx === S.bombs[i].x && ny === S.bombs[i].y) { bombIndex = i; break; }
    }
    if (bombIndex !== -1) {
      if (!scoreByTime) p.score -= 5;
      const lost = [];
      if (tntGrowth < 0) {
        p.pendingGrowth = 0;
        const target = Math.max(START_LEN, p.snake.length + tntGrowth);
        while (p.snake.length > target) {
          const t = p.snake.pop();
          p.snakeSet.delete(K(t.x, t.y));
          lost.push(t);
        }
        p.tailFrom = null;   // the old glide anchor is far from the new tail; snap
      } else {
        p.pendingGrowth += tntGrowth;
      }
      S.bombs.splice(bombIndex, 1);
      emit({ t: 'tnt', player: p.idx, x: nx, y: ny, lost });
      if (!S.bombs.length) {
        S.bombPhase = 'gap';
        S.bombNextAt = S.clockMs + rand(BOMB_GAP_MIN, BOMB_GAP_MAX);
      }
    }

    // Negative growth owed (survival's eating) comes off the tail right
    // here, floored at START_LEN like the TNT cut: shrinking is relief in
    // that mode, never a death.
    if (p.pendingGrowth < 0) {
      while (p.pendingGrowth < 0 && p.snake.length > START_LEN) {
        const t = p.snake.pop();
        p.snakeSet.delete(K(t.x, t.y));
        p.pendingGrowth++;
      }
      if (p.pendingGrowth < 0) p.pendingGrowth = 0;   // the floor forgives the rest
      p.tailFrom = null;   // the anchor is far from the new tail; snap
    }
  }

  // The doom save (rule 25): one perpendicular press to a survivable cell,
  // taken mid-glide. The reversal ban holds against the doomed heading, a
  // press into another fatal cell saves nothing (it falls to the queue as
  // any press would), and a save consumes the window: the move it makes is
  // final. The body catches up in the same glide, which reads as the lunge
  // it is.
  // Whether a press would save this hanging move, judged and nothing more:
  // setDir asks before recording, the quantum asks again before taking it,
  // because the board can change between the press and the tick that lands it.
  function saveable(p, x, y) {
    if (!p.doom) return false;
    if (x === -p.dir.x && y === -p.dir.y) return false;
    if (x === p.dir.x && y === p.dir.y) return false;
    return !moveDeadly(p, wrap(p.snake[0].x + x), wrap(p.snake[0].y + y));
  }

  function tryRedirect(p, x, y) {
    if (!saveable(p, x, y)) return false;
    const nx = wrap(p.snake[0].x + x), ny = wrap(p.snake[0].y + y);
    p.doom = null;
    p.doomSave = null;
    p.dir = { x, y };
    commitMove(p, nx, ny, 0);
    emit({ t: 'save', player: p.idx, x: nx, y: ny });
    return true;
  }

  // one fixed quantum of simulation
  function quantum() {
    S.quanta++;
    S.clockMs += SIM_DT;
    // Time-scored rounds: the score IS the clock in whole seconds, stamped
    // per living snake so a fallen rival's count freezes where it fell. The
    // one thing allowed to move a score in such a round; it feeds the same
    // ladders (portals) and the same clinch that points feed elsewhere.
    if (scoreByTime) {
      const sec = (S.clockMs / 1000) | 0;
      for (const p of players) if (p.alive) p.score = sec;
    }
    updateWalls();
    updateBombs();
    updateGhosts();
    updatePortals();
    updateBolt();
    S.foodAge += SIM_DT;
    if (S.foodAge >= FOOD_TTL) {
      if (S.food.bonus) S.bonusStreak = 0;   // missed the bonus in time: lose the streak
      placeFood();
    }
    // Every living snake advances on its own clock, in index order. They used
    // to share one, which made them cross cell boundaries together; a bolt
    // slows the rivals and not the taker, so each snake keeps its own now.
    // Index order still stands as the deterministic tie-break when two heads
    // want the same food, because a snake's tick is never shorter than ten
    // quanta and so no snake can take two steps in one. The alive guard stops
    // the drain the moment the LAST snake dies: no zombie steps.
    for (const p of players) {
      if (!anyAlive()) break;
      if (!p.alive) continue;
      expirePace(p);
      p.progMs += SIM_DT;
      while (p.alive && p.progMs >= p.tickMs) {
        p.progMs -= p.tickMs;
        stepPlayer(p);
      }
    }
    // ---- saves taken, then the doom window closes (rule 25) ----
    // A press recorded during the window is applied here, inside the sim,
    // where every other state change lives. It is judged again on the way in:
    // the board moves while a window is open (a wall can go live, a ghost can
    // take the cell), so consent to a save is not consent to a fatal one.
    if (anyAlive()) {
      for (const p of players) {
        if (p.alive && p.doom && p.doomSave) {
          if (!tryRedirect(p, p.doomSave.x, p.doomSave.y)) p.doomSave = null;
        }
      }
    }
    // A doomed head not saved by now takes its sentence exactly REDIRECT_MS
    // after the boundary, re-judged first: a wall phase ending inside the
    // window is a pardon, and the move then completes as if it had committed
    // on time (the state lands late; the drawn glide never knows). A pardon
    // lands even on the whistle's own quantum, exactly as a point scored on
    // the final tick counts; only the SENTENCE yields there, and the snake
    // ends as 'time' a moment later. A sentence puts the record back after
    // die() clears it, because there the lunge into the cell is the truth.
    if (anyAlive()) {
      const whistle = S.durationMs && S.clockMs >= S.durationMs;
      for (const p of players) {
        if (!p.alive || !p.doom || S.clockMs < p.doom.until) continue;
        const d = p.doom;
        const reason = moveDeadly(p, d.tx, d.ty);
        if (!reason) { p.doom = null; commitMove(p, d.tx, d.ty, 0); }
        else if (!whistle) { die(p, reason); p.doom = d; }
      }
    }
    // ---- the hold (rule 24) ----
    // A ghost never crosses into a cell a head is standing in. ghostBlocked
    // already stops one CHOOSING such a cell, but a step is committed up to a
    // whole GHOST_MS before it lands and a head crosses two to five cells in
    // that time, so the cell can fill up under a glide already in flight.
    // That glide stops just short of the majority line and its clock is held
    // there: the ghost is drawn nosing into the cell without ever occupying
    // it, and when the head moves on the step finishes on the time it had
    // left. Rule 24 stays exactly true throughout, because short of the line
    // the cell the ghost is drawn in really is still the one it came from.
    //
    // A head holds BOTH cells it is drawn across: the one it is entering,
    // from the very first quantum of the glide rather than from the halfway
    // flip, and the one it is still leaving. That is what makes every ghost
    // death one the player steered into. It is the same principle rule 21
    // already applies to a window's far end, now applied to ordinary steps.
    //
    // Only a glide that has not yet passed the line can be held: once a ghost
    // is legitimately majority-in a cell it owns it, and a head walking in
    // there dies, which is the whole remaining way a ghost kills. A ghost
    // that did not move (boxed in) has nothing in flight and is skipped.
    //
    // The hold runs here, after every head has taken its step and after the
    // doom window has resolved, so it reads this quantum's final positions
    // and lands immediately before contact is judged on them.
    if (anyAlive()) {
      for (const gh of S.ghosts) {
        if (gh.crossed) continue;
        if (gh.x === gh.px && gh.y === gh.py) continue;
        const span = gh.stepMs || GHOST_MS;
        if ((gh.moveAt - S.clockMs) * 2 > span) continue;   // still short of the line
        if (headHolds(gh.x, gh.y)) {
          // the largest gap that still leaves it short, on the quantum grid so
          // every peer computes the identical number
          gh.moveAt = S.clockMs + Math.ceil(span / 2 / SIM_DT) * SIM_DT + SIM_DT;
        } else {
          gh.crossed = true;                                // the cell was free: it is in
        }
      }
    }
    // ---- contact (rule 24) ----
    // Every mover is exactly where it is drawn. A head's one cell is the
    // cell it left until its glide passes half, then the cell it is entering;
    // a ghost's is ghostAt (render position rounded, hops snap at the same
    // half). Contact is those cells coinciding, tested every quantum. The
    // hold above means the ghost can no longer be the one that closes that
    // gap, so what remains is a head moving onto a ghost already standing
    // there, and a near-miss that never overlaps majorities stays survivable.
    // Two movers exchanging cells inside one quantum crossed paths: that is
    // contact too. Snakes are tested against ghosts only: two heads sharing a
    // cell is a race, not a wreck.
    if (anyAlive()) {
      for (const p of players) {
        if (!p.alive) continue;
        // each snake's own half, since each is its own way through its step
        const half = p.progMs * 2 >= p.tickMs;
        p._majX = half ? p.snake[0].x : p.headFrom.x;
        p._majY = half ? p.snake[0].y : p.headFrom.y;
      }
      for (const gh of S.ghosts) {
        const g = ghostAt(gh);
        for (const p of players) {
          if (!p.alive) continue;     // includes anyone this ghost pass just took
          const met = g.x === p._majX && g.y === p._majY;
          const crossed = g.x === p.headMajX && g.y === p.headMajY && gh.majX === p._majX && gh.majY === p._majY;
          if (met || crossed) die(p, 'ghost');
        }
        gh.majX = g.x; gh.majY = g.y;
      }
      // the majority cell only matters to the next quantum's crossing test,
      // which skips the dead, so a snake taken above needs no final write
      for (const p of players) if (p.alive) { p.headMajX = p._majX; p.headMajY = p._majY; }
    }
    // ---- the goal ----
    // A level is won by reaching a score, and that is judged here rather than
    // where the point is awarded, for the whistle's reason: after everything
    // else in the quantum, so the apple that wins it counts. It sits AFTER
    // contact deliberately, so a ghost taking the head on the same quantum
    // still takes it. Death outranks reward everywhere else in this engine
    // (rule 20: a trip that kills you pays nothing) and a goal is a reward.
    //
    // Before the whistle, so a round that is both timed and winnable is won
    // rather than merely finished.
    if (goalScore && anyAlive()) {
      for (const p of players) {
        if (!p.alive || p.score < goalScore) continue;
        p.alive = false;
        p.deadReason = 'won';
        p.diedAt = S.quanta;
        emit({ t: 'die', player: p.idx, reason: 'won' });
      }
      if (!anyAlive()) stampEnd();
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
    // A snake hanging in a doom window is neither standing nor fallen: it has
    // flown into a wall and may yet turn out of it. Awarding it the room
    // crowned a crash; counting it out would crown a rival who has not won
    // yet. The room simply waits the window out, fifty milliseconds at most.
    let hanging = false;
    for (const p of players) if (p.alive && p.doom) { hanging = true; break; }
    if (players.length > 1 && !hanging) {
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
    // Exactly one unit step, or nothing. A non-unit vector (a stride, a
    // diagonal, a fraction) would move the head more than one cell in a step
    // while collision is only entry-tested on the cell it LANDS on, so a
    // crafted log could otherwise walk the head over a wall line or its own
    // body two cells at a time. No honest input source ever sends one, so
    // every real log replays byte-identically and no ENGINE_VERSION bump is
    // owed; the wire already enforces it (net.js) and the validator re-checks.
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) + Math.abs(y) !== 1) return;
    // A press during a doom window is RECORDED, never executed: setDir is
    // input, and the engine's contract is that the world only ever changes
    // inside a quantum. Committing here let a press land while the clock was
    // frozen (a pause, a countdown), moving the snake and scoring points on
    // a round that was not running. The next quantum takes it, ten
    // milliseconds later at the outside. Logged like any accepted input, so
    // replays re-save.
    if (p.doom && saveable(p, x, y)) {
      S.log.inputs.push(players.length === 1 ? [S.quanta, x, y] : [S.quanta, x, y, player]);
      // li ties this held save to the log row it just wrote, so clearQueue (a
      // pause) can un-record a save that never played. One corner it does NOT
      // cover: a second saveable press in the same <=REDIRECT_MS window
      // overwrites this and orphans the first row, so a pause landing inside
      // that window leaves the orphan behind, and the submitted round then
      // replays (and, since the validator scores the replay, scores) as if the
      // orphan had played rather than as it went live. Humanly unreachable
      // (two saves within one 10ms quantum, then a pause before it runs) and
      // pointless to craft, so it is left as is.
      p.doomSave = { x, y, li: S.log.inputs.length - 1 };
      return;
    }
    // a press that saves nothing is not thrown away: it queues like any other,
    // and stands if the window turns out to be a pardon
    const ref = p.dirQueue.length ? p.dirQueue[p.dirQueue.length - 1] : p.dir;
    if (x === -ref.x && y === -ref.y) return; // no 180° reversal
    if (x === ref.x && y === ref.y) return;   // ignore repeats
    if (p.dirQueue.length < 3) {
      // a one-snake log keeps the classic triple shape; more snakes append
      // the player index as a fourth column
      S.log.inputs.push(players.length === 1 ? [S.quanta, x, y] : [S.quanta, x, y, player]);
      // li ties this queued turn to its log row (see clearQueue)
      p.dirQueue.push({ x, y, li: S.log.inputs.length - 1 });
    }
  }

  // A turn queued before a pause, or a save held against a window whose clock
  // stopped, must not fire on resume. Dropping them from the runtime is not
  // enough: setDir LOGGED each at press time, so the log rows have to go too
  // or the round stops matching its own replay (a pause would silently fork
  // the two). Every pending press carries the index of the row it wrote (li);
  // pull those rows, highest index first so the earlier ones keep their place
  // as the array shrinks. Solo-shell only (the pause path): the netcode never
  // pauses, and a rollback rebuilds the queue and doomSave without li, which
  // the guards below simply skip.
  function clearQueue() {
    const drop = [];
    for (const p of players) {
      for (const d of p.dirQueue) if (d.li !== undefined) drop.push(d.li);
      if (p.doomSave && p.doomSave.li !== undefined) drop.push(p.doomSave.li);
      p.dirQueue.length = 0;
      p.doomSave = null;
    }
    drop.sort((a, b) => b - a);
    for (let i = 0; i < drop.length; i++) S.log.inputs.splice(drop[i], 1);
  }

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
      quanta: S.quanta, clockMs: S.clockMs, rng: rngState,
      foodAge: S.foodAge, bonusStreak: S.bonusStreak,
      itemsEaten: S.itemsEaten, boltsSpawned: S.boltsSpawned, slowUntil: S.slowUntil,
      bolt: S.bolt ? { x: S.bolt.x, y: S.bolt.y, bornAt: S.bolt.bornAt } : null,
      food: S.food ? { x: S.food.x, y: S.food.y, bonus: S.food.bonus, kind: S.food.kind } : null,
      wallState: S.wallState, wallPhaseEnd: S.wallPhaseEnd, walls: [...S.wallLookup],
      bombs: S.bombs.map(b => ({ x: b.x, y: b.y })),
      bombsUnlocked: S.bombsUnlocked, bombPhase: S.bombPhase,
      bombNextAt: S.bombNextAt, bombExpireAt: S.bombExpireAt,
      ghosts: S.ghosts.map(cloneGhost),
      portal: S.portal ? { ...S.portal } : null,
      portalsUnlocked: S.portalsUnlocked, portalMarksSpent: S.portalMarksSpent,
      portalRetryAt: S.portalRetryAt, portalExpireAt: S.portalExpireAt, portalOpenedAt: S.portalOpenedAt,
      players: players.map(p => ({
        snake: p.snake.map(c => ({ x: c.x, y: c.y })),
        tailFrom: p.tailFrom ? { x: p.tailFrom.x, y: p.tailFrom.y } : null,
        headFrom: { x: p.headFrom.x, y: p.headFrom.y },
        headMajX: p.headMajX, headMajY: p.headMajY,
        dir: { x: p.dir.x, y: p.dir.y },
        dirQueue: p.dirQueue.map(d => ({ x: d.x, y: d.y })),
        score: p.score, pendingGrowth: p.pendingGrowth, warpedIn: p.warpedIn,
        tickMs: p.tickMs, progMs: p.progMs, slowUntil: p.slowUntil,
        doom: p.doom ? { tx: p.doom.tx, ty: p.doom.ty, until: p.doom.until, reason: p.doom.reason } : null,
        doomSave: p.doomSave ? { x: p.doomSave.x, y: p.doomSave.y } : null,
        alive: p.alive, deadReason: p.deadReason, diedAt: p.diedAt,
      })),
      // log.finalScores/diedAt are deliberately not captured: they are stamped
      // only by stampEnd, and any rollback that rewinds past an ending re-runs
      // stampEnd on the way back, so they cannot leak a stale ending.
      logLen: S.log.inputs.length, logEnd: S.log.end, logFinal: S.log.finalScore,
    };
  }

  function restore(s) {
    S.quanta = s.quanta; S.clockMs = s.clockMs; rngState = s.rng | 0;
    S.accMs = 0;
    S.foodAge = s.foodAge; S.bonusStreak = s.bonusStreak;
    S.itemsEaten = s.itemsEaten; S.boltsSpawned = s.boltsSpawned; S.slowUntil = s.slowUntil;
    S.bolt = s.bolt ? { x: s.bolt.x, y: s.bolt.y, bornAt: s.bolt.bornAt } : null;
    S.food = s.food ? { x: s.food.x, y: s.food.y, bonus: s.food.bonus, kind: s.food.kind } : null;
    S.wallState = s.wallState; S.wallPhaseEnd = s.wallPhaseEnd;
    S.wallLookup = new Set(s.walls);
    S.wallCells = wallCellsFrom(s.walls);
    S.bombs = s.bombs.map(b => ({ x: b.x, y: b.y }));
    S.bombsUnlocked = s.bombsUnlocked; S.bombPhase = s.bombPhase;
    S.bombNextAt = s.bombNextAt; S.bombExpireAt = s.bombExpireAt;
    S.ghosts = s.ghosts.map(cloneGhost);
    S.portal = s.portal ? { ...s.portal } : null;
    S.portalsUnlocked = s.portalsUnlocked; S.portalMarksSpent = s.portalMarksSpent;
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
      p.tickMs = q.tickMs; p.progMs = q.progMs; p.slowUntil = q.slowUntil;
      p.doom = q.doom ? { tx: q.doom.tx, ty: q.doom.ty, until: q.doom.until, reason: q.doom.reason } : null;
      p.doomSave = q.doomSave ? { x: q.doomSave.x, y: q.doomSave.y } : null;
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
  // Per snake, because a dragged rival is a different way through a longer
  // step than you are through yours. The shells pass the index they are
  // about to draw; the classic no-argument call is player 0, as ever.
  function renderProg(player = 0) {
    const p = players[player] ?? players[0];
    return Math.min(1, (p.progMs + S.accMs) / p.tickMs);
  }
  // the continuous clock renderers should use for glides, pulses and blinks
  function renderNow() { return S.clockMs + S.accMs; }

  // Double-buffered: callers consume the returned array before the next
  // drain (every renderer does), so the two buffers swap instead of
  // allocating one per frame.
  let _eventsSpare = [];
  function drainEvents() {
    const e = S.events;
    _eventsSpare.length = 0;
    S.events = _eventsSpare;
    _eventsSpare = e;
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
    _updateGhosts: updateGhosts, _updatePortals: updatePortals, _updateBolt: updateBolt,
    _moveGhost: moveGhost, _ghostTarget: ghostTarget, _spawnPortal: spawnPortal, _closePortal: closePortal,
    // the walk a ghost standing at (x, y) sees to (tx, ty): sweep, then read
    _ghostDist: (x, y, tx, ty) => { ghostField({ x, y }, tx, ty); return fieldDist(x, y, tx, ty); },
    _airDist: airDist,
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
  // v4 was the single-snake era, v5 multi-snake before the clinch rule, v6
  // before a wall forming on a ghost buried it in place, v7 before the doom
  // window, v14 before survival scored the clock, v15 before the opening
  // body stood in full, v16 and v17 while the solo opening found its shape
  // and before windows trimmed. All these shapes replay here under today's
  // rules;
  // the survival knobs default to the classic values, so a pre-15 log
  // (which cannot carry them) replays under the exact rules it was played
  // by. No log of any era was ever persisted, so a rule changing an old
  // round's course rewrites nobody's record.
  if (!log || !(log.v >= 4 && log.v <= ENGINE_VERSION)) throw new Error('unsupported log version');
  const game = createGame({
    seed: log.seed, tickMs: log.tickMs, wallsEnabled: log.wallsEnabled,
    durationMs: log.durationMs ?? 0, startGhosts: log.startGhosts ?? 0, startBombs: log.startBombs ?? 0,
    bombFirstMs: log.bombFirstMs ?? 0,
    scoreByTime: log.scoreByTime ?? false, startLen: log.startLen ?? START_LEN,
    eatGrowth: log.eatGrowth ?? 1, bonusGrowth: log.bonusGrowth ?? 5, tntGrowth: log.tntGrowth ?? -5,
    portalGrowth: log.portalGrowth ?? 0,
    ghostEveryMs: log.ghostEveryMs ?? 0, bombEveryMs: log.bombEveryMs ?? 0, boltEveryMs: log.boltEveryMs ?? 0,
    // a level's goal, absent in every log written before levels existed
    goalScore: log.goalScore ?? 0,
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
