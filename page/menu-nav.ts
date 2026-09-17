/**
 * Four directions and a button, which is the whole vocabulary of a sofa.
 *
 * OWNS the focus ring: which surface is on top, which controls are reachable
 * on it, where the ring lands when a screen changes, and what "move",
 * "confirm" and "back" mean when there is no pointer in the room.
 *
 * MUST NEVER decide what a direction means during a ROUND. A direction goes
 * to the shell's one input gate (rule 12) exactly as a key or a thumb does;
 * this module only chooses whether the press is a turn or a step across a
 * menu, and hands it on either way.
 *
 * It exists as its own file because it was written inside `gamepad.ts` and is
 * not about gamepads. A TV remote has four directions and a button and no
 * stick, no axes and no `navigator.getGamepads()`; extracting this is what
 * let the remote be forty lines instead of a second copy of the hard part.
 * Everything here is driven BY a source and polls nothing itself.
 *
 * Layout reads (`getBoundingClientRect`) happen here, which rule 8 forbids in
 * the frame loop. They are legal because nothing in this file runs per frame:
 * every entry point is a press or a screen change.
 *
 * @module
 */
import { mustGetElement } from './dom.js';

/** What the focus ring needs the shell to do; it reaches for none of it. */
export interface MenuNavPorts {
  /**
   * Turn the snake. Rule 12: every input source goes through the one gate,
   * which owns the playing-state check and the reversal filter.
   */
  steer: (dx: number, dy: number) => void;
  /** The round's phase right now, read fresh on every press. */
  phase: () => string;
  /** Half time, or back from it. */
  togglePause: () => void;
}

let ports: MenuNavPorts | null = null;
let overlay: HTMLElement | null = null;
/**
 * The page's own header: the player chip, the purse, the boards, the gear and
 * the help mark.
 *
 * It is a SIBLING of the overlay, not a child, so a scope that returned one
 * root could never see it, and on a television that meant the entire top row
 * of the game was unreachable: no account, no settings, no boards, no shop,
 * with a pointer the only way in. It joins the overlay's controls and never a
 * modal's, because a modal is modal.
 */
let header: HTMLElement | null = null;
/**
 * Every modal, and the order the ring prefers them in.
 *
 * Only one is ever open at a time, so this is a tiebreak rather than a stack.
 * It is a LIST because it was two named variables and the three modals nobody
 * had added (boards, how-to, shop) were therefore unreachable without a
 * pointer: the ring fell through to the overlay behind them and walked
 * buttons the player could not see. A list makes the next modal one string.
 */
const MODAL_IDS = ['settingsModal', 'profileModal', 'shopModal', 'boardsModal', 'howModal'];
let modals: HTMLElement[] = [];
/** Each modal's own way out, in the same order, for `back()`. */
const MODAL_CLOSE_IDS = ['settingsClose', 'profileClose', 'shopClose', 'boardsClose', 'howClose'];
let modalCloses: HTMLElement[] = [];
/** Tried in order for the primary of whatever screen is up. */
let primaries: HTMLElement[] = [];
/** Tried in order when back steps out of a screen. */
let backButtons: HTMLElement[] = [];
/**
 * The ways out of a LIVE round, for a controller with no pointer.
 *
 * A solo round has half time, so back pauses and these are never reached. A
 * ROOM has none (it keeps its seats), and its FORFEIT and LEAVE live in the
 * chrome rather than in any overlay, so without this a remote could enter a
 * room and never leave one. They are focused rather than clicked: conceding a
 * rated round on a single stray press is exactly the accident the button's
 * own arm-then-confirm exists to prevent, and this adds a third press.
 */
let roundExits: HTMLElement[] = [];

function isDisabled(element: HTMLElement): boolean {
  return (
    (element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement) &&
    element.disabled
  );
}

// Visible, enabled and actually laid out; the wedges are the snake's, never
// the menu's, and a hidden panel's buttons are not on this screen. It takes
// `undefined` as well as `null` because under noUncheckedIndexedAccess every
// indexed read into these parallel lists is optional, and the question "is
// this a control I can put the ring on" has the same answer for both.
function usable(element: Element | null | undefined): element is HTMLElement {
  if (element === null || element === undefined || !(element instanceof HTMLElement)) return false;
  if (isDisabled(element) || element.hidden || element.classList.contains('wedge')) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

// whatever surface is on top owns the focus ring: a modal, else the overlay
function scope(): HTMLElement | null {
  for (const modal of modals) if (!modal.hidden) return modal;
  if (overlay === null || overlay.classList.contains('hidden')) return null;
  return overlay;
}

function controls(): HTMLElement[] {
  const root = scope();
  if (root === null) return [];
  const out: HTMLElement[] = [];
  const gather = (from: HTMLElement): void => {
    // [tabindex] as well as the tags: focusable non-controls (list rows and
    // their kin) must stay reachable, or the pointer-free work on a TV or a
    // handheld quietly loses screens
    for (const element of from.querySelectorAll('button, input, [tabindex]')) {
      if (usable(element)) out.push(element);
    }
  };
  // The header before the panel, so the list reads down the screen the way
  // the screen does; moveFocus is geometric and does not care, but a caller
  // taking controls()[0] as a last resort should land at the top.
  if (root === overlay && header !== null) gather(header);
  gather(root);
  return out;
}

/** Whether the ring is currently parked up in the header rather than on the panel. */
function inHeader(): boolean {
  const active = document.activeElement;
  return header !== null && active instanceof HTMLElement && header.contains(active);
}

// The primary of whatever screen is up, so a press always has somewhere to
// land.
//
// Every candidate is tested for being INSIDE the current scope, not merely
// usable, and that is the whole point of the function. A panel opening on top
// does not hide what is underneath it: the overlay's buttons are still
// visible and still measure, so a bare usability test handed the ring to
// `modeGoBtn` sitting BEHIND the settings modal, where no direction could
// reach anything on the panel the player had just opened. Mid-round is the
// same trap in the other direction, which is why the scope is asked first:
// there the overlay is only visually hidden and its buttons still measure.
function primary(): HTMLElement | null {
  const root = scope();
  if (root === null) return null;
  for (const button of primaries) if (root.contains(button) && usable(button)) return button;
  // a modal nobody listed a primary for still has a way out, and DONE is a
  // better landing than whatever happens to be first in the markup
  for (let i = 0; i < modals.length; i++) {
    if (modals[i] === root) {
      const close = modalCloses[i];
      if (usable(close)) return close;
    }
  }
  return controls()[0] ?? null;
}

/** Whether a round is running, and so whether a direction is a turn. */
export function inRound(): boolean {
  const phase = ports?.phase();
  return phase === 'playing' || phase === 'countdown';
}

/**
 * Put the focus ring somewhere real.
 *
 * Opening a panel hides whatever held the ring and focus falls to `<body>`,
 * which no direction can move off, so every UI change re-homes it. Safe to
 * call from anywhere: the class it gates on is only ever set once a
 * pointerless controller has actually announced itself.
 */
export function rehomeFocus(): void {
  if (!document.documentElement.classList.contains('padded')) return;
  const list = controls();
  if (list.length === 0) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && list.includes(active)) return;
  primary()?.focus();
}

/**
 * Step the focus ring one control in a direction.
 *
 * Spatial, not tab order: score every candidate by how far it lies in the
 * pressed direction plus a heavy penalty for drifting off that axis, so
 * straight ahead beats diagonally near. Reads layout, but only on a press.
 *
 * @param dx - -1, 0 or 1 across.
 * @param dy - -1, 0 or 1 down.
 */
export function moveFocus(dx: number, dy: number): void {
  const list = controls();
  if (list.length === 0) return;
  const active = document.activeElement;
  // nothing focused yet: the first press spends itself landing on the
  // primary, which is where the player wanted to be anyway
  if (!(active instanceof HTMLElement) || !list.includes(active)) {
    (primary() ?? list[0])?.focus();
    return;
  }
  const from = active.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const element of list) {
    if (element === active) continue;
    const box = element.getBoundingClientRect();
    const toX = box.left + box.width / 2 - fromX;
    const toY = box.top + box.height / 2 - fromY;
    const along = dx === 0 ? toY * dy : toX * dx;
    if (along <= 1) continue; // not the way we are going
    const off = dx === 0 ? Math.abs(toX) : Math.abs(toY);
    const score = along + off * 3;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }
  best?.focus();
}

/**
 * A round takes turns; anything else takes focus. One funnel, one gate.
 *
 * @param x - -1, 0 or 1 across.
 * @param y - -1, 0 or 1 down.
 */
export function steerOrMove(x: number, y: number): void {
  if (inRound()) ports?.steer(x, y);
  else moveFocus(x, y);
}

/** Press whatever the ring is on; if the ring is nowhere, land it first. */
export function confirm(): void {
  if (inRound()) return;
  const active = document.activeElement;
  if (usable(active) && controls().includes(active)) {
    if (active instanceof HTMLInputElement) active.focus();
    else active.click();
    return;
  }
  primary()?.focus();
}

/**
 * The one-button press, for a controller that has only one.
 *
 * A gamepad separates confirm from pause across two buttons; a TV remote has
 * OK and nothing else, so OK has to be both. Which it is depends entirely on
 * whether a round is running, and that is never ambiguous: mid-round there is
 * nothing on screen to confirm, and in a menu there is nothing to pause.
 * `countdown` is deliberately inert, because rule 15 ignores input there.
 */
export function okPress(): void {
  const phase = ports?.phase();
  if (phase === 'countdown') return;
  // a round exit already holding the ring outranks pause: the player put it
  // there with a deliberate press and OK is the only way to press it
  const active = document.activeElement;
  if (usable(active) && roundExits.includes(active)) {
    active.click();
    return;
  }
  if (phase === 'playing' || phase === 'paused') {
    ports?.togglePause();
    return;
  }
  confirm();
}

/**
 * Step out of whatever is on screen.
 *
 * @returns Whether anything was actually stepped out of. A caller with
 *   somewhere further to go (a TV remote, whose platform expects BACK at the
 *   root to leave the app) needs to know that this did nothing.
 */
export function back(): boolean {
  if (ports?.phase() === 'playing') {
    // putting it back down again is the same key that picked it up
    const active = document.activeElement;
    if (active instanceof HTMLElement && roundExits.includes(active)) {
      active.blur();
      return true;
    }
    ports.togglePause();
    // Still playing means the shell refused half time, which is the room
    // rule and the shell's to own, not a copy of it kept here. Then the only
    // way out of this round is the chrome's, so put the ring on it.
    if (ports.phase() === 'playing') {
      for (const exit of roundExits) {
        if (usable(exit)) {
          exit.focus();
          return true;
        }
      }
    }
    return true;
  }
  for (let i = 0; i < modals.length; i++) {
    const modal = modals[i];
    if (modal !== undefined && !modal.hidden) {
      modalCloses[i]?.click();
      return true;
    }
  }
  // Coming back down out of the header is a step BACK, and a real one. Without
  // this the top row of the page became the one place where the back key quit
  // the application, which is a trap laid exactly where a new player explores.
  if (inHeader()) {
    primary()?.focus();
    return true;
  }
  for (const button of backButtons) {
    if (usable(button)) {
      button.click();
      return true;
    }
  }
  return false;
}

/** The dedicated start/pause button: pauses a round, else presses the primary. */
export function start(): void {
  const phase = ports?.phase();
  if (phase === 'playing' || phase === 'paused') {
    ports?.togglePause();
    return;
  }
  primary()?.click();
}

/**
 * Wire the focus ring to the page's own screens. Call once at boot, before
 * any input source that uses it.
 *
 * @param shellPorts - the three things the ring needs the shell to do.
 */
export function initMenuNav(shellPorts: MenuNavPorts): void {
  ports = shellPorts;
  overlay = mustGetElement('overlay');
  header = mustGetElement('pageHeader');
  modals = MODAL_IDS.map((id) => mustGetElement(id));
  modalCloses = MODAL_CLOSE_IDS.map((id) => mustGetElement(id));
  primaries = ['modeGoBtn', 'vsCreateBtn', 'settingsClose', 'startBtn'].map((id) => mustGetElement(id));
  backButtons = ['modeBackBtn', 'vsBackBtn', 'tBackBtn'].map((id) => mustGetElement(id));
  roundExits = ['mpGiveBtn', 'mpQuitBtn'].map((id) => mustGetElement(id));

  // A screen arriving with nothing focused strands a pointerless controller:
  // the ring is left on a button behind the panel that just opened, no
  // direction can reach anything, and the player's first press is spent
  // landing it. Rather than chase every place that opens a panel, watch the
  // two attributes that OPEN one: `hidden` on a modal, the `hidden` class on
  // the overlay.
  //
  // This used to be a per-frame check inside the pad's poll, which worked
  // only for as long as a controller had a frame loop to ride. A remote has
  // none, and the panels it could not reach were the proof. Evented is also
  // simply the right shape: these eight transitions are round starts and
  // panel opens, never a frame.
  const rehome = new MutationObserver(() => {
    rehomeFocus();
  });
  for (const surface of [overlay, ...modals]) {
    rehome.observe(surface, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }
}
