// A thrown frame must cost a frame, not the session.
//
// WHY THIS EXISTS. `loop()` used to re-schedule with requestAnimationFrame as
// its LAST statement, so anything above it that threw escaped the callback and
// the next frame was never asked for. The game stopped dead: frozen board, no
// error on screen, nothing logged, nothing sent anywhere, and no way back but
// a manual reload. The fix is a `finally`.
//
// It is worth a permanent check because the failure is invisible to every
// other gate in this repo. Nothing throws to the console, nothing fails a
// request, no assertion trips. The page simply stops, and only a person
// looking at it can tell. Measured while the bug was live: 0 frames observed
// over 1.5 seconds, while an independent rAF chain in the same page ticked 90
// times. After the fix, 89.
//
// The throw is injected through navigator.getGamepads, which pollGamepads
// calls early in the frame. That is a real call site inside the try, not a
// synthetic one bolted on for the test.
//
// USAGE  node scripts/check-loop-survives.mjs
// Needs Chrome (set CHROME_PATH if it is somewhere unusual) and wants the
// machine to itself: see the note in scripts/browser-harness.mjs.
import { check, report, withPage } from './browser-harness.mjs';

const lines = [];

await withPage({}, async ({ evaluate, sleep, goto, thrown }) => {
  await goto();
  await sleep(3000);

  // count the page's own frames from outside, by wrapping the rAF it uses
  await evaluate(`(() => {
    window.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((ts) => { window.__frames++; cb(ts); });
  })()`);
  await sleep(1000);
  const before = await evaluate(`window.__frames`);
  lines.push(before > 20 ? `ok   the loop runs at all (${before} frames in 1s)` : `FAIL the loop is not running (${before} frames in 1s)`);

  // make a real call site inside the frame throw, every single frame
  await evaluate(`(() => {
    window.__throws = 0;
    navigator.getGamepads = () => { window.__throws++; throw new Error('injected: a frame threw'); };
  })()`);
  await sleep(1500);
  const during = await evaluate(`window.__frames`);
  const throws = await evaluate(`window.__throws`);
  lines.push(throws > 20 ? `ok   the injected fault is really being hit (${throws} throws)` : `FAIL the fault never fired (${throws} throws), so this proves nothing`);
  lines.push(during - before > 20
    ? `ok   the loop SURVIVES a throw every frame (${during - before} frames while throwing)`
    : `FAIL the loop died on a thrown frame (${during - before} frames while throwing)`);

  // and recovers cleanly once the fault clears
  await evaluate(`navigator.getGamepads = () => []`);
  await sleep(1000);
  const after = await evaluate(`window.__frames`);
  lines.push(after - during > 20
    ? `ok   it keeps running after the fault clears (${after - during} frames)`
    : `FAIL it did not recover after the fault cleared (${after - during} frames)`);

  // the round itself must still be playable afterwards
  await evaluate(`document.getElementById('startBtn').click()`);
  await sleep(3000);
  lines.push(check('a round still kicks off after all that', await evaluate(`document.getElementById('overlay').classList.contains('hidden')`), true));

  // the reporter is expected to hear about the injected throws; anything else
  // is a real fault and worth failing on
  const unexpected = thrown.filter((t) => !String(t).includes('injected'));
  lines.push(check('no unexpected exceptions', unexpected.length, 0));
  if (unexpected.length) lines.push('       ' + unexpected[0]);

});

// AFTER the browser is shut, never inside the body: report() ends the
// process, and a process that ends inside withPage never runs its cleanup.
report(lines);
