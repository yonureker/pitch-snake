# Pitch Snake

A football-flavoured snake game that plays up to five people in a shared room
over rollback netcode, and scores every round on a server that re-simulates it
rather than believing the client.

Live at **https://pitchsnake.com**.

```bash
npm install
npm test                 # the rules and the netcode: 136 tests, about half a second
npm run build:page       # page/*.ts -> page/build/*.js, which the browser loads
python3 -m http.server 8777   # then open http://localhost:8777
```

That is the whole setup: a static file server, and one `tsc` pass over the
handful of TypeScript modules in `page/`. There is no bundler and no dev server
to learn, and the browser loads the same files the server does. Its output is
**committed** to the repo, for the reason in point 2 below, so a fresh clone can
be served straight from disk without building anything at all.

---

## The five minutes that matter

Three facts explain most of the decisions in this repo. If you read nothing
else, read these.

**1. The engine is the only copy of the rules, and it is deterministic.**
`packages/engine/engine.js` is a pure ES module: no DOM, no canvas, no fetch, no
timers, no `Math.random`. A round is a pure function of `(seed, config, inputs)`.
The same file is imported by the web page, by the mobile app, and by the
server-side validator, so all three agree by construction rather than by
discipline. `replay(log)` re-runs a finished round to the identical score, and
that one property is what makes server-side scoring, fair shared-seed
multiplayer, and rollback netcode possible at all.

Anything that breaks determinism breaks all three at once, silently.

**2. A push to `main` is the deploy.** GitHub Pages serves this repository as it
stands. There is no CI build between your commit and the live site, which is why
`page/build/` (TypeScript output) is **committed**, and why the pre-commit hook
refuses a commit whose build has drifted from its source. Treat every push as a
production deploy, because it is one.

**3. The server decides every score.** The client submits the round's input
**log**, never a number. `supabase/functions/validate-score/` replays it with the
very same engine and writes the score it computed itself. That function pins the
engine to a specific commit, so changing the rules is a sequence, not an edit
(see *Changing the rules* below).

---

## Where things live

| Path | What it is |
|---|---|
| `packages/engine/` | The rules. Deterministic, host-free, one file on purpose so they cannot drift apart. |
| `packages/net/` | Rollback netcode over any message pipe: sequencing, gap repair, snapshots, rollback, pacing, desync detection. Transport-agnostic; Supabase Realtime is just one adapter. |
| `index.html` | The web client's shell and renderer. Nothing here may decide gameplay. |
| `page/` | The page's browser modules, in TypeScript. `page/*.ts` is source; `page/build/*.js` is committed output that the browser loads. See `page/README.md`. |
| `styles/` | The stylesheet, split by concern and linked **in order** from the head. The order is the contract. |
| `apps/mobile/` | Expo app, same engine import. |
| `supabase/` | Schema and RPCs. **Git is the source of truth, never the dashboard.** |
| `.claude/` | Agents and skills that encode the repo's procedures. |

## Running the checks

```bash
npm test              # engine + netcode
npm run lint:page     # page lint
npm run build:page    # page TypeScript -> page/build (must be committed)
npm run install-hooks # pre-commit: runs all of the above plus mobile lint/typecheck
```

`.github/workflows/ci.yml` runs the same set on every push and pull request, so
a clone that never installed the hook is still covered.

## Changing the rules

Editing gameplay in `packages/engine/` is the one change with a required
procedure, because the deployed validator pins the engine to a commit hash. Ship
half of it and every submitted score is refused as `log does not replay`, every
refusal burns the player's seed, and every board silently falls back to the
device's local list. Degraded, never wrong, and invisible unless you look.

The sequence lives in `.claude/skills/engine-version-bump/`. In short: bump
`ENGINE_VERSION`, re-pin the golden fixtures, push, wait for jsDelivr, move the
validator's pin, redeploy it, and prove it end to end. Do not improvise it.

Changes to `index.html`, `page/`, `packages/net/`, `apps/mobile/` or the SQL need
none of that.

## The invariants worth knowing before you touch anything

- **No host APIs in the engine**, no floats fed in from outside, every random
  decision through the seeded PRNG, and any new timing constant a multiple of
  `SIM_DT`.
- **Nothing may gate play on the network.** Identity, seeds, boards and the
  ladder are all bonus tiers: signed out, offline, or with the API having a bad
  day, the game still plays and still saves locally.
- **The RPCs are the access.** Every `pitch_snake_` table has RLS on with no
  policies and no grants; the publishable key in the page reaches the functions
  and nothing else. Never "fix" a permission error by adding a policy.
- **The renderer never decides gameplay**, and the draw path allocates nothing
  per frame.

The numbered rules behind these, with the reasoning and the bugs that produced
them, are in `CLAUDE.md`. It is long because it is a record of what was already
tried; the comments in `engine.js` and `net.js` are the same idea at close
range. When a comment explains why something is *not* done a simpler way,
believe it: most of those sentences were paid for.

## Conventions

Comments explain **why**, not what. A comment restating the code is noise; one
recording a decision, a rejected alternative, or a bug already hit once is the
most valuable thing in the file. When you fix something subtle, leave the reason
behind.
