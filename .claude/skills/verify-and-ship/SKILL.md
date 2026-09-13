---
name: verify-and-ship
description: >-
  The full verify-then-ship loop for Pitch Snake: engine tests, page syntax
  check, headless browser drive with a temporary ?vtest hook, mobile bundle,
  then push and confirm the change is actually live on GitHub Pages. Use before
  and during any commit that touches index.html, packages/, apps/mobile/ or
  supabase/, and whenever asked to ship, deploy, or push.
---

# Verify and ship

Every step here exists because skipping it once broke something in production.

**CI exists and does not replace this loop.** `.github/workflows/ci.yml` runs
on every push and pull request, and it covers exactly what a machine can check
from a checkout: the engine and netcode suites, the page lint, that
`page/build` still matches `page/*.ts`, that the asset stamps match their
content, and the mobile lint and typecheck. That is the pre-commit hook's set,
run somewhere a missing `install-hooks` and a `--no-verify` cannot skip it.

What CI cannot do is the half of this loop that matters most here: it never
opens the page in a browser, never bundles the app, and never looks at what
the two origins are actually serving after a push. A green tick means the
tree is consistent with itself, not that the site works. Read the run rather
than assuming it (`gh run list --workflow=CI --limit 5`): the mobile lint job
sat red for twelve commits on 2026-09-12 while every local check passed,
because ESLint dies on this machine with `EPERM scandir '/Users/<you>/Desktop'`
inside `import/no-unresolved`, and the habit of working around that locally
with `--no-verify` is exactly what hid a real failure.

## 1. Tests

```
npm test
```

The engine and netcode suites. The pre-commit hook runs these plus the mobile
lint and typecheck, so a commit cannot pass without them, but run them early
rather than discovering it at commit time.

## 2. The page's TypeScript

`page/*.ts` compiles to `page/build/*.js`, and that output is COMMITTED
because a push to `main` is the whole deploy. Build it, and stage the result:

```
npm run build:page && git add page/build
```

The pre-commit hook does this too and refuses a commit whose `page/build` has
drifted, but discovering it there costs a round trip. A stale `page/build` is
the worst kind of bug this repo can ship: the site keeps working and simply
does not match its own source.

## 3. Page syntax

The script still inlined in `index.html` has no compiler, so a syntax error
there ships a blank page. Extract the module body and check it:

```bash
python3 - <<'EOF'
import re
src = open('index.html').read()
m = re.findall(r'<script type="module">(.*?)</script>', src, re.S)
open('/tmp/page_body.mjs','w').write(max(m, key=len))
EOF
node --check /tmp/page_body.mjs && echo "SYNTAX OK"
```

## 4. Drive it headless

For anything behavioural, drive the real page rather than reasoning about it.

Add a temporary hook at the end of the module, exposing only what the test
needs:

```js
if (new URLSearchParams(location.search).has('vtest')) {
  window.__t = { /* ... */ };
}
```

Then serve and drive over CDP. `ws` is in `node_modules`; there is no
puppeteer. Two things that will otherwise waste time:

- `/json/new` needs `method: 'PUT'`.
- Give Chrome ~7 seconds to bind the debug port before connecting, and expect
  the first launch after a `rm -rf` of the profile dir to be slower.

```bash
(python3 -m http.server 8777 &) ; sleep 1
rm -rf /tmp/cprof
("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir=/tmp/cprof --no-first-run \
  --disable-gpu about:blank &) ; sleep 7
```

**Module scope is not global scope.** `Runtime.evaluate` with
`savedThisRound = true` creates a global and does not touch the module's
variable. Every manipulation must go through the `__t` hook. This has produced
false test results before.

Emulating a phone needs the media query too, not just the metrics:
`Emulation.setEmulatedMedia` with `pointer: coarse`, or the touch layout never
applies.

**Remove the hook before committing.** `grep -c vtest index.html` must be `0`.

## 5. Mobile

If `packages/` or `apps/mobile/` changed:

```
cd apps/mobile && npm run lint && npm run typecheck && npx expo export --platform ios
```

## 6. Push

Commit and push to `main`. Message style: prose, present tense, explains WHY.
No double dashes anywhere (em, en, or ASCII).

## 7. Confirm it is live, properly

This is the step most often done wrong. **Do not poll the URL with a
cache-busting query string** — the Pages CDN ignores it and you will watch a
stale edge for five minutes while the deploy has already succeeded.

Poll the build by commit SHA:

```bash
gh api repos/yonureker/pitch-snake/pages/builds --jq '.[0] | .status + " " + .commit[0:7]'
```

Then confirm content with a no-cache header, on BOTH origins. The game lives
at https://pitchsnake.com (a Cloudflare Worker proxying Pages); the Pages
origin stays live on purpose as the migration exporter, so one push must land
on both:

```bash
curl -s -H 'Cache-Control: no-cache' https://yonureker.github.io/pitch-snake/index.html | shasum
curl -s -H 'Cache-Control: no-cache' https://pitchsnake.com/index.html | shasum
shasum index.html   # all three identical, or the deploy is not done
```

If the domain will not resolve from this machine (a stale negative DNS cache
from the migration day), pin an edge IP:
`--resolve pitchsnake.com:443:$(dig +short pitchsnake.com @1.1.1.1 | head -1)`.

**Always** verify that `packages/engine/engine.js` AND every file under
`page/build/` serve 200 on the domain: the page imports them at boot, so one
404 there is a blank game even though `index.html` itself is perfect. Verify
that `packages/engine/engine.js` serves 200 on the domain:
the page cannot boot without it. And never set GitHub Pages' own
custom-domain field: the Worker proxies github.io, and GitHub answering 301
would loop it.

The strongest confirmation is not a grep. The shasum triple above proves the
deployed bytes are the bytes you tested; alternatively load the shipped
module in the live page and read a constant back out of it.

## 8. Clean up

Kill Chrome and the http server, remove the profile dir and any scratch
scripts. Confirm `git status` shows nothing unintended.
