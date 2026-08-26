# Pitch Snake

A monorepo (npm workspaces), deployed to GitHub Pages from `main` at the repo root; live at https://yonureker.github.io/pitch-snake/ .

- `packages/engine/` - **the only copy of the rules.** Pure, seeded, deterministic ES module: no DOM, no canvas, no fetch, no timers, no `Math.random`. Imported raw by the web page, by the mobile app, and by the server-side replay validator. Its tests run with `node --test packages/engine/engine.test.js`.
- `index.html` - the web game: renderer + app shell only, buildless, imports the engine as an ES module. Nothing in this file may decide gameplay.
- `apps/mobile/` - the Expo app (React Native + Skia planned), same engine import. Conventions follow the False9 app (`~/Desktop/false9`): TanStack Query for server data, Zustand for UI state only, strict TS.
- `supabase/` - schema and RPCs; git is the source of truth, never the dashboard.

## Determinism (the engine's reason to exist)

A round is a pure function of `(seed, config, inputs)`. The engine advances in fixed `SIM_DT` (10ms) quanta; every tick length and timing constant is a multiple of it, so steps land exactly on quanta. `setDir` records accepted inputs with their quantum into `game.log`; `replay(log)` re-runs a finished round to the identical score - that is the server-side score check, fair shared-seed multiplayer, and replays. A mode is a config and nothing else: `MODES` in the engine (classic; speedrun with `durationMs: 60000`; survival with `startGhosts: 5, startBombs: 9, bombFirstMs: SURVIVAL_TNT_FIRST`, all five personalities present at kickoff, each at least `SURVIVAL_CLEAR` of wrapped walk from the head, `bombsUnlocked` seeded so every wave including the first is nine, and the board left clear of TNT until `bombFirstMs`, because a wave standing there before the snake has moved is scenery) is spread into `createGame`, every knob rides in the log, and a timed round ends with `deadReason 'time'` at exactly `durationMs`, after everything else in that quantum, so replays whistle identically. Shells and tournaments pick a mode name; the engine owns what it means. Renderers add `accMs` (the sub-quantum remainder) for interpolation, so smoothness costs nothing. Rules for keeping it true: no host APIs in the engine, no floats fed in from outside (advance() quantizes), every random decision through the seeded PRNG, and any new timing constant a multiple of `SIM_DT`.

## Engine performance rules

The game must hold 60fps on a mid-range phone. Every change to the script keeps these rules.

### Simulation

1. Fixed timestep: gameplay state changes only inside `step()`, driven by the accumulator in `loop()`. `draw()` never mutates game state.
2. Clamp the per-frame delta before feeding the accumulator and the hazard clocks, so a backgrounded tab never fast-forwards the simulation when it wakes.
3. Animate by time, not by frame count, so 60Hz and 120Hz screens play identically: pulses, particles, and glides all advance by dt or read an absolute clock.

### Per-frame code (anything reached from `draw()`)

4. Zero allocations per frame in steady state: no new objects, arrays, closures, or strings in draw paths. Reuse scratch objects (see `_rp`).
5. No string building in hot loops: per-segment `rgb(...)` fill styles come from a precomputed lookup table, and cell keys are integers (`x * GRID + y`), not `"x,y"` strings.
6. Minimize canvas state churn: batch draws by style, set `font` only when the value actually changes, and never use `shadowBlur` or `shadowColor` inside a per-frame loop (shadowed fills are very slow on mobile).
7. Pre-render repeated or static art to an offscreen canvas once and `drawImage` it each frame (the arena works this way). Rebuild offscreen art only on resize.
8. Touch the DOM only on state change (score, wall banner). Never call `getComputedStyle` or `getBoundingClientRect`, and never write styles, inside the frame loop.

### Per-tick code (`step()` and spawners)

9. Collision lookups are O(1): occupancy is kept in Sets with integer keys, never checked by scanning the snake array with `some(...)` per cell.
10. Every loop is bounded: no rejection sampling that can spin when the board fills up. Enumerate the free cells and pick one (`spawnCell`).
11. Full-board scans are allowed only on spawn events (wall build, wave spawn, food placement), never per frame.

### Input

12. Every input source (keyboard, swipe, d-pad) goes through `setDir`, which owns the playing-state gate and the reversal/repeat filter. Do not add per-source gating. A shell may advance the sim to the press instant before calling `setDir` (the mobile loop does), so the log stamps the true press time and a turn can catch a cell boundary that falls between frames; `advance()` quantizes, so this carries no determinism risk.
13. Track d-pad fingers independently. A press is a turn request even while another finger is down, because overlapping presses are how fast combos are played and the keyboard has always accepted them. Never gate the pad on a single owning pointer.
14. The snake's pace is constant: `prog` advances by `dt / tickMs` and is rendered as is. Do not make the step duration variable in order to cut input latency. That was tried and reverted twice: shortening the step a turn lands in does halve latency, but it also doubles the snake's speed for that cell, so a two-turn corner lurches for two cells and then drops back to normal, which reads as the snake jumping. On a grid, turn latency is bounded by the time to the next cell boundary, so the only lurch-free lever is a shorter tick, meaning the speed setting. Any change to movement needs a test asserting both that a pending turn does not alter the rate and that every frame advances the snake by the same distance through a corner, not just that the constants are right. The doom save (rule 25) is the one sanctioned discontinuity in the drawn path: it re-aims a step mid-glide, and never re-times it.

### Round states

15. The states are `ready`, `countdown`, `playing`, `paused`, `dead`. Anything gating on `playing` has to decide what `countdown` does: the field is on screen and drawn, input buffers into the queue, but nothing simulates. Timed sequences run off the loop clock with the shared dt clamp, never `setTimeout` or `setInterval`.

### Teleport windows

16. A hop is one step, never a change of pace. The head spends a step standing in the window it entered and the next step lands it on the far one; the body still advances one cell and the heading is untouched. Do not "cover" the jump by shortening or lengthening the step, which is the rule 14 mistake in a new costume.
17. Both ends work both ways, so anything a window has just put down has to be free to walk off it. `warpedIn` for the head and `g.warped` for each ghost mark an arrival and suppress exactly one hop; without them the pair bounces whatever enters back and forth for ever. The flag clears on the very next move, so leaving a window and stepping back into it hops you again.
18. A pair falls due every `PORTAL_EVERY` points from `PORTAL_FIRST`, for ever, and the count of marks passed is derived in closed form and only ever raised. Never lowered: falling under a mark and climbing back over it must not buy a second pair, or eating a TNT to drop below one is a way to farm windows. Keep `PORTAL_BONUS` under `PORTAL_EVERY` too, or a paid trip buys the next window outright and the pairs chain.
19. The two ends are always at least `PORTAL_MIN_GAP` apart, so any segment whose two cells are non-adjacent after the tunnel wrap correction is mid hop. `segRenderPos` and `ghostRender` both snap such a segment to one end or the other at the half-way point of the step. Interpolating across the gap streaks a segment right across the board.
20. A pair carries **one trip**. The first head through sets `portal.used`, which pays `PORTAL_BONUS` and makes the pair inert for snake and ghosts alike; both ends work both ways, so anything less than this is a four step loop run for free travel. A used pair cannot vanish on the spot, though: the body is still coming through a cell at a time, and windows disappearing from under it would leave segments jumping across nothing, so `portalBusy` holds them open until the tail is clear. The award sits after the wall, self, ghost and TNT tests in `step()`, so a trip that kills you pays nothing; nothing else can share a landing cell, so it is the only score change that tick. A wall closing a pair refunds its mark only when the pair was never used.
21. Nothing else may spawn on a window (`cellOccupied` covers both ends), a wall forming over one closes the pair rather than leave a trap, a pair does not close while a body is still coming through (`portalBusy`), and no ghost may take the far end while a head is committed in a window.

### Contact

24. A mover is exactly where it is drawn. The head's one occupied cell is the cell it left until its glide passes half, then the cell it is entering (`headFrom` plus `progMs`); a ghost's is `ghostAt`, its render position rounded, which flips mid-glide and snaps a hop at the same halfway. Head-ghost contact is those two cells coinciding, or the two swapping cells inside one quantum (paths crossed), and it is tested every quantum in `quantum()` and nowhere else, never by cell entry in `step()`. Static things (walls, TNT, food, self) stay step-entry tests on the head's state cell: there the head is the actor walking into something with a face, and entry is the touch, though for walls and self the touch opens a doom window (rule 25) rather than killing outright. Consequences: a ghost sliding majority-onto a resting head kills between snake steps, and slipping through a cell a ghost is less than half into is a survivable near miss. Any change here is an engine-rules change: bump `ENGINE_VERSION`.

### The doom window

25. Walking into a wall or your own body is not final for `REDIRECT_MS` (50ms): the move hangs instead of killing. The state stays put with the glide anchor snapped to the head's own cell, so the rule 24 majority holds still and the body waits, while the renderers draw the head reaching into the fatal cell. One safe perpendicular press inside the window (the reversal ban holds against the doomed heading) converts the death into that turn, committed mid-glide on the unchanged boundary schedule; the body catches up within the same glide, the sanctioned bend of rule 14. A press into another fatal cell saves nothing and falls to the queue; a combo press already queued saves on the spot; the saving press is logged like any input, so replays re-save. Silence lands the sentence exactly at the window's close, re-judged first: a wall phase ending inside the window is a pardon and the move completes late, invisibly. A doom death keeps its `doom` record so both shells draw the head where it reached. Hops are forced and lock (their one fatal case, a body on the far end, stays entry-tested), and consuming moves (food, TNT, portal pay) bind at entry and lock. The whistle outranks the sentence on a shared quantum, and ghost contact still applies to a hanging head. `REDIRECT_MS` stays a multiple of `SIM_DT`, at most half the fastest tick (a doomed head never crosses the majority flip) and under every tick (doom resolves before the next boundary). Any change here is an engine-rules change: bump `ENGINE_VERSION`.

### Hazard ladders

22. A score threshold sets how much of a hazard there is, never whether it comes at all. TNT waves cycle for ever once past the first mark and only the wave size is capped; ghosts never leave once they join; teleport marks have no last one. The only thing a score gate is allowed to do is scale.
23. Ghost intelligence lives in `ghostTarget` and nowhere else: the five personalities (chaser, ambusher, flanker, cutoff, warden, by spawn order = color) differ only in the cell they steer toward. The legs are shared and fixed: `GHOST_MS` stays 500 at every speed setting, the no-reverse rule, blocked cells and boxed-in behavior are identical for all five, and `GHOST_FOCUS` is the single dial for how sharply they pursue, and their sense of distance is `ghostDist`, a wormhole metric that prices routes through an open unused teleport pair, so portal use is deliberate and spent pairs are invisible to them. Making a ghost smarter means changing its target, never its speed. The one exception to walls blocking ghosts: a wall forming on a ghost's cell does not relocate it (that teleported it, sometimes straight into a player's path); the ghost keeps its feet and walks out through the shape, wall cells passable to it only while it stands on one, blocking again the moment it is clear, so the pass is one way and never re-enterable. Any targeting change is an engine-rules change: bump `ENGINE_VERSION`, since replays of old logs no longer reproduce.

## Leaderboard

The board is global when `SB_URL` and `SB_KEY` are set in `index.html`, and local when they are not. Schema and RPCs live in `supabase/leaderboard.sql`.

1. The key in the page is the **publishable** key and it is meant to be public. What makes that safe is that every `pitch_snake_` table has RLS on with no policies and no grants, so the key reaches exactly the `pitch_snake_` functions and nothing else. Never put a secret key in the page, and never add a policy to those tables to "fix" an access error: the RPCs are the access.
2. Boards are partitioned by `mode` ('classic', 'speedrun', 'survival'), each with its own believable score range in `pitch_snake_submit_score` (a minute bounds speed run at 300; the endless modes share 9999). A tournament is a code, a window, and a mode, created by anyone and immutable: the server generates the 6-character code and computes both timestamps from its own `now()` (clients send offsets, never times), `pitch_snake_tournament_submit` refuses anything outside the window, and the standings are best-per-name. `seed` and `user_id` columns exist now, empty, so replay validation and accounts arrive without a migration.
3. Every path falls back to the local board. Unconfigured, offline, or a Data API having a bad day all end up on the browser's own list rather than an empty screen or a hang, and the board says which one you are looking at. Every call carries an abort timer for the same reason.
4. BEST is the player's own best per mode in `localStorage`, not the top of the standings. Those were the same thing while the board was local and are not once it is global.
5. The browser reports its own score, so every board is only as honest as the client. The range check in `pitch_snake_submit_score` stops the board being taken over by one absurd number, nothing more. Making it authoritative means the server has to decide the score.

## Verify before shipping

1. `npm test` (the engine suite, `node --test`) must pass - behaviour lives there now.
2. Page/module syntax: extract the script body to a `.mjs` and `node --check` it.
3. Drive the page headless with a temporary `?vtest` hook (scratchpad `hook.py on/off`) plus the browser harness for render/UI, and a headless Chrome screenshot; remove the hook before committing (zero `vtest` references may remain).
4. If the engine changed and mobile exists, `npx expo export` in `apps/mobile` must still bundle.
5. Push to `main`, then poll the live URL for a marker unique to the change - including that `packages/engine/engine.js` itself serves 200 from Pages, since the page cannot boot without it.
