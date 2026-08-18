# Pitch Snake

One file: `index.html` (inline CSS plus one script IIFE). Deployed to GitHub Pages from `main` at the repo root; live at https://yonureker.github.io/pitch-snake/ .

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

12. Every input source (keyboard, swipe, d-pad) goes through `setDir`, which owns the playing-state gate and the reversal/repeat filter. Do not add per-source gating.
13. Track d-pad fingers independently. A press is a turn request even while another finger is down, because overlapping presses are how fast combos are played and the keyboard has always accepted them. Never gate the pad on a single owning pointer.

## Verify before shipping

1. Syntax-check the script body with `new vm.Script(...)` via `node -e`.
2. Drive the game headless with a temporary `?vtest` hook and a headless Chrome screenshot; remove the hook before committing (zero `vtest` references may remain).
3. Push to `main`, then poll the live URL for a marker string unique to the change.
