/**
 * The television remote: four directions, OK, and BACK.
 *
 * OWNS the decision that this page is running on a TV, and the translation of
 * the three keys a remote actually has into the page's existing verbs.
 *
 * MUST NEVER grow a navigation model of its own. Everything here hands off to
 * `menu-nav.ts`, which the gamepad uses too; a remote is a gamepad with fewer
 * buttons and no stick, and the day this file starts deciding where focus
 * goes is the day the TV and the pad drift apart.
 *
 * It must also never touch a ROUND's arrow keys. While a round is running the
 * page's own keyboard handler already steers on ArrowUp and its kin, and a
 * remote's directional keys ARE those keys: webOS delivers them as ordinary
 * `keydown` events with the ordinary key names. So this file stands aside
 * mid-round and only claims the arrows in a menu, where they mean something
 * the keyboard handler has no opinion about. Two paths to `setDir` would be a
 * second input gate, which rule 12 exists to forbid.
 *
 * What a remote does NOT have is a second button, so OK is both confirm and
 * pause (`okPress`), and BACK is the only way out of anything. The platform
 * requires BACK at the root to leave the app, which is why `back()` reports
 * whether it found something to close.
 *
 * @module
 */
import { back, inRound, okPress, steerOrMove } from './menu-nav.js';

declare global {
  interface Window {
    /**
     * webOS injects this into every packaged app. `platformBack` itself comes
     * from webOSTV.js, which this page does not carry, so it is optional on
     * an optional object and both have to be checked before either is called.
     */
    webOS?: { platformBack?: () => void };
  }
}

// webOS TVs identify themselves in the user agent as "Web0S" (with a zero) in
// the browser and in a packaged app alike, and every webOS APP additionally
// has window.PalmSystem injected. Either is proof enough; both are checked
// because the wrapper .ipk is a redirect, so the page can legitimately be
// running in the app OR in the TV's own browser and should behave the same.
const TV_AGENT = /web0s|webos/i;

// One permanent override, because a TV is the one target that cannot be
// driven by the headless harness or looked at on a laptop. `?tv=1` puts a
// desktop browser into remote mode, where the arrow keys and Enter stand in
// for the remote's own. It is not a test hook to be removed before
// committing: it is how anyone reviews this screen without a television.
function forcedOn(): boolean {
  return new URLSearchParams(location.search).get('tv') === '1';
}

let television = false;

/**
 * Whether the page is being driven by a TV remote.
 *
 * The shell asks this when it decides the pointer dialect: a television has
 * no touch d-pad and wants the height-driven column, whatever the
 * `(pointer: coarse)` media query happens to say about a Magic Remote.
 */
export function isTelevision(): boolean {
  return television;
}

// BACK at the root of an app has to leave it; the platform's users expect it
// and LG's app review checks it. webOSTV.js would supply platformBack(), but
// this page does not carry that library for one call, and closing the window
// is what platformBack does.
function leaveApp(): void {
  const platformBack = window.webOS?.platformBack;
  if (typeof platformBack === 'function') platformBack();
  else window.close();
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

  // BACK first, and even while typing: it is the only way off a screen, so it
  // can never be something a focused field swallows.
  // webOS's BACK key is 461 and carries no standard `key` name, so the
  // deprecated numeric code is the only thing that identifies it. The two
  // names are checked beside it because other TV platforms do name it.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
  if (event.keyCode === 461 || event.key === 'GoBack' || event.key === 'BrowserBack') {
    event.preventDefault();
    event.stopPropagation();
    if (!back()) leaveApp();
    return;
  }
  if (typing) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    okPress();
    return;
  }

  const x = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  const y = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  if (x === 0 && y === 0) return;
  // Mid-round these are the shell's, untouched. See the module note: one gate.
  if (inRound()) return;
  event.preventDefault();
  event.stopPropagation();
  steerOrMove(x, y);
}

/**
 * Detect a television and, on one, put the page into remote mode.
 *
 * Call once at boot, after `initMenuNav` and BEFORE the shell first sizes the
 * canvas: this decides whether the touch d-pad is on screen, and the column's
 * width is measured from what is left.
 *
 * @returns Whether this is a television, so the shell can skip the rest of
 *   its pointer guessing.
 */
export function initTvRemote(): boolean {
  television = TV_AGENT.test(navigator.userAgent) || 'PalmSystem' in window || forcedOn();
  if (!television) return false;
  const root = document.documentElement;
  // `padded` is not a lie here and is not named for the hardware: it is the
  // page's word for "a pointerless controller is driving this", and it is
  // what turns the focus ring on and takes the touch d-pad off. `tv` only
  // changes which words the hint line uses.
  root.classList.add('tv', 'padded', 'touchless');
  // Capture, so a menu direction is claimed before the shell's own document
  // handler sees it; mid-round this listener stands aside and that same
  // handler steers.
  document.addEventListener('keydown', onKeyDown, true);
  return true;
}
