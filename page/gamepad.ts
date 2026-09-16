/**
 * Gamepads: one more device, never a second set of rules.
 *
 * OWNS the polling of the Gamepad API, the stick's dead and release bands,
 * the menu repeat, and the mapping from this hardware's buttons to the
 * page's four verbs.
 *
 * MUST NEVER decide what a direction means, and must not own the focus ring
 * either. Everything this produces goes exactly where a key or a thumb goes:
 * a direction through the shell's one input gate (rule 12), a menu press
 * through the same `click()` the pointer fires. That is what makes a
 * DualShock on an iPhone, an Xbox pad on a Steam machine and a TV remote all
 * one input, and the ring that serves all three lives in `menu-nav.ts`.
 *
 * The point is not only the pad. It is that a screen you cannot reach
 * without a pointer is a screen that does not ship to a television or a
 * handheld, whose whole vocabulary is four directions and a button.
 *
 * `navigator.getGamepads()` builds its array on every call and there is no
 * evented alternative, so `pollGamepads` is the one sanctioned per-frame
 * allocation: rule 4 governs the DRAW path, and this runs before it, once,
 * over at most four slots.
 *
 * @module
 */
import { back, confirm, moveFocus, inRound, rehomeFocus, start, steerOrMove } from './menu-nav.js';

const PAD_DEAD = 0.55; // stick past this is a direction
const PAD_RELEASE = 0.3; // and back under this before it counts again
const PAD_REPEAT_FIRST = 380; // a held direction in a MENU waits this long
const PAD_REPEAT_MS = 140; // and then repeats at this rate

/** What the pad needs the shell to do; it reaches for none of it itself. */
export interface GamepadPorts {
  /**
   * Ask the shell to rebuild the canvas next frame.
   *
   * A pad takes the touch d-pad off the screen and gives the board that
   * height back. This shell is height-driven, so the canvas must be rebuilt
   * or it keeps the size it had under the old layout.
   */
  requestResize: () => void;
}

let ports: GamepadPorts | null = null;

let dpadPrevious = 0;
let buttonsPrevious = 0;
let stick = 0;
let repeatAt = 0;
// {0,0} is "nothing held": the repeat branch is only entered when one of
// the two is non-zero, so a sentinel says it as well as a null did and
// spares every reader a null check.
let held = { x: 0, y: 0 };

// Whether a pad has ever announced itself this page-load. Until one does, the
// frame loop's poll returns immediately: navigator.getGamepads() builds its
// array on EVERY call (see the module note above), which on a phone that will
// never see a pad was a per-frame allocation feeding the GC for nothing.
// Browsers refuse to surface a pad before it announces anyway (Chrome holds
// the event until a button is pressed), so the skip costs no press. Once seen,
// always polled: a disconnect that lapses is cheaper than a reconnect missed.
let padEverSeen = false;

/**
 * Read every connected pad once. Call from the frame loop, before the sim, so
 * a press lands on this frame rather than the next.
 *
 * @param now - the loop's clock, in milliseconds, for the menu repeat.
 */
export function pollGamepads(now: number): void {
  if (!padEverSeen) return;
  // Nothing here watches for a screen change any more: menu-nav observes the
  // panels directly and re-homes the ring itself, which a remote needs (it
  // has no frame loop to ride) and which takes a layout read off this path.
  const pads = navigator.getGamepads();
  let pad: Gamepad | null = null;
  for (const candidate of pads) {
    if (candidate?.connected === true) {
      pad = candidate;
      break;
    }
  }
  if (pad === null) {
    dpadPrevious = 0;
    buttonsPrevious = 0;
    stick = 0;
    held = { x: 0, y: 0 };
    return;
  }
  const buttons = pad.buttons;
  const axes = pad.axes;
  const down = (i: number): boolean => {
    const button = buttons[i];
    return button !== undefined && (button.pressed || button.value > 0.5);
  };

  // the d-pad reads like a key: edge-triggered, one turn per press
  const dpad =
    (down(12) ? 1 : 0) | (down(13) ? 2 : 0) | (down(14) ? 4 : 0) | (down(15) ? 8 : 0);
  const fresh = dpad & ~dpadPrevious;
  dpadPrevious = dpad;
  if (fresh & 1) steerOrMove(0, -1);
  if (fresh & 2) steerOrMove(0, 1);
  if (fresh & 4) steerOrMove(-1, 0);
  if (fresh & 8) steerOrMove(1, 0);

  // the stick needs a release band, or a thumb resting on the rim fires for
  // ever; it engages past PAD_DEAD and only re-arms back under PAD_RELEASE
  const stickX = axes[0] ?? 0;
  const stickY = axes[1] ?? 0;
  let next = 0;
  if (Math.abs(stickX) > Math.abs(stickY)) {
    if (stickX <= -PAD_DEAD) next = 3;
    else if (stickX >= PAD_DEAD) next = 4;
  } else if (stickY <= -PAD_DEAD) next = 1;
  else if (stickY >= PAD_DEAD) next = 2;
  if (next === 0 && Math.max(Math.abs(stickX), Math.abs(stickY)) < PAD_RELEASE) stick = 0;
  else if (next !== 0 && next !== stick) {
    stick = next;
    steerOrMove(next === 3 ? -1 : next === 4 ? 1 : 0, next === 1 ? -1 : next === 2 ? 1 : 0);
  }

  // Menus repeat a held direction, because walking a list one press at a time
  // is miserable on a sofa. A ROUND never repeats: there, one press is one
  // turn, and setDir would filter the repeat anyway.
  const inMenu = !inRound();
  const heldX = ((dpad & 4 ? -1 : 0) + (dpad & 8 ? 1 : 0)) || (stick === 3 ? -1 : stick === 4 ? 1 : 0);
  const heldY = ((dpad & 1 ? -1 : 0) + (dpad & 2 ? 1 : 0)) || (stick === 1 ? -1 : stick === 2 ? 1 : 0);
  if (inMenu && (heldX !== 0 || heldY !== 0)) {
    if (held.x !== heldX || held.y !== heldY) {
      held = { x: heldX, y: heldY };
      repeatAt = now + PAD_REPEAT_FIRST;
    } else if (now >= repeatAt) {
      moveFocus(heldX, heldY);
      repeatAt = now + PAD_REPEAT_MS;
    }
  } else {
    held = { x: 0, y: 0 };
  }

  // A/cross confirms, B/circle backs out, Start starts and pauses. Those
  // three are in the same place on every pad worth supporting.
  const pressed = (down(0) ? 1 : 0) | (down(1) ? 2 : 0) | (down(9) ? 4 : 0);
  const pressedFresh = pressed & ~buttonsPrevious;
  buttonsPrevious = pressed;
  if (pressedFresh & 1) confirm();
  if (pressedFresh & 2) back();
  if (pressedFresh & 4) start();
}

// A pad announces itself, and the page says so: the hint line swaps to the
// pad's own verbs and the focus ring turns on, because until a pad is here a
// ring on every click would just be noise to a mouse.
function announce(present: boolean): void {
  document.documentElement.classList.toggle('padded', present);
  ports?.requestResize();
  if (present) rehomeFocus();
}

/**
 * Wire the pad to the page. Call once at boot, after `initMenuNav`.
 *
 * @param shellPorts - the one thing the pad needs the shell to do.
 */
export function initGamepads(shellPorts: GamepadPorts): void {
  ports = shellPorts;
  window.addEventListener('gamepadconnected', () => {
    padEverSeen = true;
    announce(true);
  });
  window.addEventListener('gamepaddisconnected', () => {
    for (const pad of navigator.getGamepads()) if (pad?.connected === true) return;
    announce(false);
  });
}
