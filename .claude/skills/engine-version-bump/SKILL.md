---
name: engine-version-bump
description: >-
  The full procedure for changing an engine RULE: bump ENGINE_VERSION, re-pin
  the golden fixtures, move the validate-score function's jsDelivr pin to the
  new commit and redeploy it. Use whenever a change alters gameplay in
  packages/engine/ (contact, movement, ghosts, portals, doom, hazard ladders),
  and whenever CLAUDE.md's numbered rules say "bump ENGINE_VERSION".
---

# Bumping the engine version

Skip any step here and the world leaderboard dies silently for every player.
The order matters: the pin can only be set after the engine commit exists.

## Why the pin is dangerous

`supabase/functions/validate-score/index.ts` imports the engine from jsDelivr,
pinned to the commit that last touched `engine.js`. `replay()` refuses a log
whose `v` exceeds its own `ENGINE_VERSION`. So the instant the page ships v20
while the deployed validator still runs v19:

- every submission is refused as `log does not replay`
- every refusal burns the player's seed
- every page falls back to its device board

Degraded, never wrong, and completely invisible unless you go looking. This is
why the two ship together.

## Procedure

**1. Bump the constant.** In `packages/engine/engine.js`, extend the comment
rather than replacing it — the history of what each version changed is useful:

```js
export const ENGINE_VERSION = 20;  // 20: <what changed>; 19: ghosts hold at the line; ...
```

**2. Re-pin the golden fixtures.** `packages/engine/fixtures/v4.json` holds
recorded v4 logs pinned to what today's engine makes of them. A rules change
moves them, and that is expected: the test's own comment records every
re-pinning since v7.

First see what actually moved:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const { replay } = await import('./packages/engine/engine.js');
const fx = JSON.parse(readFileSync('./packages/engine/fixtures/v4.json','utf8'));
for (const name of Object.keys(fx)) {
  const f = fx[name], r = replay(f.log);
  console.log(name, 'pinned', f.score, f.deadReason, f.quanta, '-> now', r.score, r.deadReason, r.quanta);
}"
```

Then update **only** `score`, `deadReason`, `quanta` and `snake`, in place.
Never rewrite the file with `json.dump`: it is pretty-printed, and reserialising
collapses 460 lines into one and destroys the diff. Edit surgically, keep the
logs untouched, and add a line to the test's comment saying what moved and why.

**3. Verify, commit, push.** `npm test` must be green. Push, and note the
commit SHA: that is the pin.

**4. Wait for jsDelivr.** It serves from GitHub and needs the commit to exist:

```bash
curl -s "https://cdn.jsdelivr.net/gh/yonureker/pitch-snake@<SHA>/packages/engine/engine.js" \
  | grep -c "ENGINE_VERSION = 20"
```

**5. Move the pin and redeploy.** Update the import URL in
`supabase/functions/validate-score/index.ts` to the new SHA. Before deploying,
read the live function (`get_edge_function`) and confirm it matches git apart
from that one line, so a dashboard edit is never clobbered. Deploy with
`verify_jwt: true`. Commit the pin change as a follow-up.

**6. Prove it end to end, without writing a score.** Mint a real seed, build a
log that replays but has not ended, and submit it. The function checks
`game.alive` immediately after `replay()`, so:

- stale pin → `log does not replay`
- correct pin → `round never ended`

Either way nothing is inserted. Anything else means look closer.

## What does NOT need this

Changes to `index.html`, `packages/net/`, `apps/mobile/` or the SQL do not
touch the engine and need no bump and no redeploy. Only a change to the RULES
does. A comment, a rename or a test inside `engine.js` does not.
