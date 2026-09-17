// The television has three keys, and nobody can test a television by hand.
//
// WHY THIS EXISTS. A TV remote is the one input this repo cannot look at: the
// harness has no TV, the owner's C4 is not in CI, and the failure mode is not
// a thrown error but a screen you cannot get off. Every assertion below is a
// way the remote has already been able to strand a player during development,
// or a rule that would stop meaning anything if it quietly broke.
//
// The sharpest one is the LAST pair. `page/tv-remote.ts` must claim the arrow
// keys in a menu and must NOT claim them during a round, because mid-round
// they are the shell's and there is exactly one gate to `setDir` (rule 12).
// That is invisible from the DOM, so it is measured the only honest way: a
// listener added on the BUBBLE phase after boot sees an arrow press only if
// the capture listener let it through. Seeing it in a round and not seeing it
// in a menu IS the rule.
//
// USAGE  node scripts/check-tv-remote.mjs
// Needs Chrome (set CHROME_PATH if it is somewhere unusual) and wants the
// machine to itself: see the note in scripts/browser-harness.mjs.
import { check, report, withPage } from './browser-harness.mjs';

const lines = [];

/** Press and release one key, as the browser's own input pipeline would. */
async function press(send, key, code, vk) {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
}

const down = (send) => press(send, 'ArrowDown', 'ArrowDown', 40);
const up = (send) => press(send, 'ArrowUp', 'ArrowUp', 38);
const ok = (send) => press(send, 'Enter', 'Enter', 13);

// webOS's BACK is keyCode 461, which no physical key on this machine produces,
// so it is the one press that has to be synthesised. The listener under test
// reads `keyCode` and nothing else about it, and a constructed event cannot
// carry one, hence the defineProperty.
const back = (evaluate) => evaluate(`(() => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { value: 461 });
  document.dispatchEvent(e);
})()`);

const focused = (evaluate) => evaluate(`document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'NONE'`);
const classes = (evaluate) => evaluate(`document.documentElement.className`);

await withPage({ path: '/index.html?tv=1' }, async ({ evaluate, send, sleep, goto, thrown }) => {
  // A headless window is not the focused window, and Chrome will not match
  // `:focus` in one. Without this the ring assertion below passes on
  // activeElement while the player would see no ring at all, which is the
  // single thing a remote cannot do without.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await goto();
  await sleep(3000);

  // ---- the page knows it is on a television ----
  const cls = await classes(evaluate);
  lines.push(check('the page reads ?tv=1 as a television', /\btv\b/.test(cls), true));
  lines.push(check('a television is a pointerless controller (padded)', /\bpadded\b/.test(cls), true));
  lines.push(check('and takes the height-driven column (touchless)', /\btouchless\b/.test(cls), true));
  lines.push(check('the touch d-pad is off the screen',
    await evaluate(`getComputedStyle(document.querySelector('.dpad')).display`), 'none'));
  lines.push(check('the hint line talks about OK and BACK',
    await evaluate(`getComputedStyle(document.querySelector('.tv-only')).display !== 'none'`), true));
  lines.push(check('and not about a stick it does not have',
    await evaluate(`getComputedStyle(document.querySelector('.pad-only')).display`), 'none'));

  // ---- the ring lands somewhere real, with no press at all ----
  const home = await focused(evaluate);
  lines.push(check('the focus ring starts on a real control', home !== 'NONE' && home !== 'BODY', true));
  // and is actually DRAWN. On a television the ring is the cursor: a page
  // that tracks focus perfectly and paints nothing is a page nobody can use
  // from a sofa.
  lines.push(check('and the ring is visibly drawn, not merely tracked',
    await evaluate(`(() => {
      const s = getComputedStyle(document.activeElement);
      return s.outlineStyle === 'solid' && parseFloat(s.outlineWidth) >= 3;
    })()`), true));

  // ---- a direction walks the menu ----
  // UP rather than down: the ring starts on GO, and BACK sits beside it on
  // the same row, so "down" from there correctly has nowhere to go. The mode
  // tiles are above, which is what a direction should reach.
  await up(send);
  await sleep(120);
  const moved = await focused(evaluate);
  lines.push(check('a direction moves the ring in a menu', moved !== home, true));

  // ---- the header is part of the screen, which it was not ----
  // The player chip, the purse, the boards, the gear and the help mark are
  // siblings of the overlay, not children, so a scope that returned one root
  // could not see them and a television could not reach a single one. Found by
  // playing it on an actual C4.
  let reachedHeader = 'NONE';
  for (let i = 0; i < 8; i++) {
    await up(send);
    await sleep(100);
    if (await evaluate(`document.getElementById('pageHeader').contains(document.activeElement)`)) {
      reachedHeader = await focused(evaluate);
      break;
    }
  }
  lines.push(check('the ring can walk UP into the header', reachedHeader !== 'NONE', true));

  // ---- and BACK brings it down again rather than quitting ----
  // The header was briefly the one place in the page where the back key left
  // the application, which is a trap laid exactly where a new player explores.
  await back(evaluate);
  await sleep(200);
  lines.push(check('BACK out of the header returns to the panel, never the door',
    await evaluate(`!document.getElementById('pageHeader').contains(document.activeElement)
      && document.getElementById('overlay').contains(document.activeElement)`), true));

  // ---- every modal is reachable, which is the bug this found ----
  // scope() knew two of the five, so boards, how-to and shop handed the ring
  // to the overlay BEHIND them and walked buttons nobody could see.
  for (const [opener, modal] of [['boardsBtn', 'boardsModal'], ['helpBtn', 'howModal'], ['gearBtn', 'settingsModal']]) {
    await evaluate(`document.getElementById('${opener}').click()`);
    await sleep(250);
    const openNow = await evaluate(`!document.getElementById('${modal}').hidden`);
    const inside = await evaluate(`(() => {
      const m = document.getElementById('${modal}');
      return m.contains(document.activeElement);
    })()`);
    lines.push(check(`${modal} opens`, openNow, true));
    lines.push(check(`the ring is INSIDE ${modal}, not on the screen behind it`, inside, true));

    // ---- BACK is the only way out, and it has to work ----
    await back(evaluate);
    await sleep(250);
    lines.push(check(`BACK closes ${modal}`, await evaluate(`document.getElementById('${modal}').hidden`), true));
  }

  // ---- OK presses what the ring is on ----
  await evaluate(`document.getElementById('startBtn').focus()`);
  await ok(send);
  await sleep(2600);   // the countdown, then play
  const phase = await evaluate(`document.getElementById('overlay').classList.contains('hidden')`);
  lines.push(check('OK on the start button starts the round', phase, true));

  // ---- OK is also pause, because a remote has no second button ----
  await ok(send);
  await sleep(250);
  lines.push(check('OK pauses a running round',
    await evaluate(`document.getElementById('overlayTitle').textContent`), 'HALF TIME'));
  await ok(send);
  await sleep(2600);
  lines.push(check('and OK again resumes it',
    await evaluate(`document.getElementById('overlay').classList.contains('hidden')`), true));

  // ---- the one gate: who owns the arrow keys, and when ----
  // A bubble listener added AFTER boot sees a press only if the capture
  // listener in page/tv-remote.ts let it through.
  await evaluate(`(() => {
    window.__sawArrow = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') window.__sawArrow++; });
  })()`);
  await up(send);
  await sleep(120);
  lines.push(check('MID-ROUND the shell keeps its arrow keys (one gate, rule 12)',
    await evaluate(`window.__sawArrow`), 1));
  const ringInRound = await focused(evaluate);
  await down(send);
  await sleep(120);
  lines.push(check('and a direction mid-round steers rather than moving the ring',
    await focused(evaluate), ringInRound));

  await evaluate(`window.__sawArrow = 0`);
  await ok(send);                        // pause, so we are in a menu again
  await sleep(250);
  await up(send);
  await sleep(120);
  lines.push(check('IN A MENU the remote claims them instead',
    await evaluate(`window.__sawArrow`), 0));

  lines.push(check('nothing threw', thrown.length, 0));
});

// ---- and none of it happens to anyone who is not on a television ----
await withPage({ path: '/index.html' }, async ({ evaluate, send, sleep, goto, thrown }) => {
  await goto();
  await sleep(3000);
  const cls = await classes(evaluate);
  lines.push(check('a plain desktop page is not a television', /\btv\b/.test(cls), false));
  lines.push(check('and keeps its keyboard hints', /\bpadded\b/.test(cls), false));
  await evaluate(`(() => {
    window.__sawEnter = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__sawEnter++; });
  })()`);
  await ok(send);
  await sleep(150);
  lines.push(check('Enter is nobody else’s business off a television',
    await evaluate(`window.__sawEnter`), 1));
  lines.push(check('nothing threw', thrown.length, 0));
});

report(lines);
