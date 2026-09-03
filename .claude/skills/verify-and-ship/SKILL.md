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

Pitch Snake has no CI. This loop is the CI. Every step here exists because
skipping it once broke something in production.

## 1. Tests

```
npm test
```

The engine and netcode suites. The pre-commit hook runs these plus the mobile
lint and typecheck, so a commit cannot pass without them, but run them early
rather than discovering it at commit time.

## 2. Page syntax

`index.html` is buildless, so nothing type-checks it and a syntax error ships
a blank page. Extract the module body and check it:

```bash
python3 - <<'EOF'
import re
src = open('index.html').read()
m = re.findall(r'<script type="module">(.*?)</script>', src, re.S)
open('/tmp/page_body.mjs','w').write(max(m, key=len))
EOF
node --check /tmp/page_body.mjs && echo "SYNTAX OK"
```

## 3. Drive it headless

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

## 4. Mobile

If `packages/` or `apps/mobile/` changed:

```
cd apps/mobile && npm run lint && npm run typecheck && npx expo export --platform ios
```

## 5. Push

Commit and push to `main`. Message style: prose, present tense, explains WHY.
No double dashes anywhere (em, en, or ASCII).

## 6. Confirm it is live, properly

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

**Always** verify that `packages/engine/engine.js` serves 200 on the domain:
the page cannot boot without it. And never set GitHub Pages' own
custom-domain field: the Worker proxies github.io, and GitHub answering 301
would loop it.

The strongest confirmation is not a grep. The shasum triple above proves the
deployed bytes are the bytes you tested; alternatively load the shipped
module in the live page and read a constant back out of it.

## 7. Clean up

Kill Chrome and the http server, remove the profile dir and any scratch
scripts. Confirm `git status` shows nothing unintended.
