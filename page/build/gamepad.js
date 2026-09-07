/**
 * Gamepads: one more device, never a second set of rules.
 *
 * OWNS the polling of the Gamepad API, the stick's dead and release bands,
 * the menu repeat, and the spatial focus ring that lets the whole page be
 * driven with four directions and a button.
 *
 * MUST NEVER decide what a direction means. Everything this produces goes
 * exactly where a key or a thumb goes: a direction through the shell's one
 * input gate (rule 12), a menu press through the same `click()` the pointer
 * fires. That is what makes a DualShock on an iPhone, an Xbox pad on a Steam
 * machine and a TV remote all one input.
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
import { mustGetElement } from './dom.js';
const PAD_DEAD = 0.55; // stick past this is a direction
const PAD_RELEASE = 0.3; // and back under this before it counts again
const PAD_REPEAT_FIRST = 380; // a held direction in a MENU waits this long
const PAD_REPEAT_MS = 140; // and then repeats at this rate
let ports = null;
let overlay = null;
let settingsModal = null;
let profileModal = null;
let settingsClose = null;
/** Tried in order for the primary of whatever screen is up. */
let primaries = [];
/** Tried in order when B backs out of a screen. */
let backButtons = [];
let dpadPrevious = 0;
let buttonsPrevious = 0;
let stick = 0;
let repeatAt = 0;
// {0,0} is "nothing held": the repeat branch is only entered when one of
// the two is non-zero, so a sentinel says it as well as a null did and
// spares every reader a null check.
let held = { x: 0, y: 0 };
let menuWasUp = false;
function inRound() {
    const phase = ports?.phase();
    return phase === 'playing' || phase === 'countdown';
}
function isDisabled(element) {
    return ((element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement) &&
        element.disabled);
}
// visible, enabled and actually laid out; the wedges are the snake's, never
// the menu's, and a hidden panel's buttons are not on this screen
function usable(element) {
    if (element === null || !(element instanceof HTMLElement))
        return false;
    if (isDisabled(element) || element.hidden || element.classList.contains('wedge'))
        return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
}
// whatever surface is on top owns the focus ring: a modal, else the overlay
function scope() {
    if (settingsModal !== null && !settingsModal.hidden)
        return settingsModal;
    if (profileModal !== null && !profileModal.hidden)
        return profileModal;
    if (overlay === null || overlay.classList.contains('hidden'))
        return null;
    return overlay;
}
function controls() {
    const root = scope();
    if (root === null)
        return [];
    const out = [];
    // [tabindex] as well as the tags: focusable non-controls (list rows and
    // their kin) must stay reachable to a pad, or the pointer-free work on a TV
    // or a handheld quietly loses screens
    for (const element of root.querySelectorAll('button, input, [tabindex]')) {
        if (usable(element))
            out.push(element);
    }
    return out;
}
// The primary of whatever screen is up, so a pad always has somewhere to
// land. Scope first: mid-round the overlay is only visually hidden, so its
// buttons still measure and would otherwise look like live targets.
function primary() {
    if (scope() === null)
        return null;
    for (const button of primaries)
        if (usable(button))
            return button;
    return controls()[0] ?? null;
}
/**
 * Put the focus ring somewhere real.
 *
 * Opening a panel hides whatever held the ring and focus falls to `<body>`,
 * which no direction can move off, so every UI change re-homes it. Safe to
 * call from anywhere: the class it gates on is only ever set once a pad has
 * actually announced itself.
 */
export function rehomeFocus() {
    if (!document.documentElement.classList.contains('padded'))
        return;
    const list = controls();
    if (list.length === 0)
        return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && list.includes(active))
        return;
    primary()?.focus();
}
// Spatial, not tab order: score every candidate by how far it lies in the
// pressed direction plus a heavy penalty for drifting off that axis, so
// straight ahead beats diagonally near. Reads layout, but only on a press.
function moveFocus(dx, dy) {
    const list = controls();
    if (list.length === 0)
        return;
    const active = document.activeElement;
    // nothing focused yet: the first press spends itself landing on the
    // primary, which is where a pad user wanted to be anyway
    if (!(active instanceof HTMLElement) || !list.includes(active)) {
        (primary() ?? list[0])?.focus();
        return;
    }
    const from = active.getBoundingClientRect();
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const element of list) {
        if (element === active)
            continue;
        const box = element.getBoundingClientRect();
        const toX = box.left + box.width / 2 - fromX;
        const toY = box.top + box.height / 2 - fromY;
        const along = dx === 0 ? toY * dy : toX * dx;
        if (along <= 1)
            continue; // not the way we are going
        const off = dx === 0 ? Math.abs(toX) : Math.abs(toY);
        const score = along + off * 3;
        if (score < bestScore) {
            bestScore = score;
            best = element;
        }
    }
    best?.focus();
}
// A round takes turns; anything else takes focus. One funnel, one gate.
function steerOrMove(x, y) {
    if (inRound())
        ports?.steer(x, y);
    else
        moveFocus(x, y);
}
function confirm() {
    if (inRound())
        return;
    const active = document.activeElement;
    if (usable(active) && controls().includes(active)) {
        if (active instanceof HTMLInputElement)
            active.focus();
        else
            active.click();
        return;
    }
    primary()?.focus();
}
function back() {
    if (ports?.phase() === 'playing') {
        ports.togglePause();
        return;
    }
    if (settingsModal !== null && !settingsModal.hidden) {
        settingsClose?.click();
        return;
    }
    for (const button of backButtons) {
        if (usable(button)) {
            button.click();
            return;
        }
    }
}
function start() {
    const phase = ports?.phase();
    if (phase === 'playing' || phase === 'paused') {
        ports?.togglePause();
        return;
    }
    primary()?.click();
}
/**
 * Read every connected pad once. Call from the frame loop, before the sim, so
 * a press lands on this frame rather than the next.
 *
 * @param now - the loop's clock, in milliseconds, for the menu repeat.
 */
export function pollGamepads(now) {
    // A screen arriving with nothing focused strands a pad: no direction can
    // move off <body>. Rather than chase every place that shows the overlay,
    // watch the transition here. Both reads are properties, not layout, so the
    // steady-state cost is nil and the measuring only happens on the edge.
    const menuUp = (overlay !== null && !overlay.classList.contains('hidden')) ||
        (settingsModal !== null && !settingsModal.hidden) ||
        (profileModal !== null && !profileModal.hidden);
    if (menuUp !== menuWasUp) {
        menuWasUp = menuUp;
        if (menuUp)
            rehomeFocus();
    }
    const pads = navigator.getGamepads();
    let pad = null;
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
    const down = (i) => {
        const button = buttons[i];
        return button !== undefined && (button.pressed || button.value > 0.5);
    };
    // the d-pad reads like a key: edge-triggered, one turn per press
    const dpad = (down(12) ? 1 : 0) | (down(13) ? 2 : 0) | (down(14) ? 4 : 0) | (down(15) ? 8 : 0);
    const fresh = dpad & ~dpadPrevious;
    dpadPrevious = dpad;
    if (fresh & 1)
        steerOrMove(0, -1);
    if (fresh & 2)
        steerOrMove(0, 1);
    if (fresh & 4)
        steerOrMove(-1, 0);
    if (fresh & 8)
        steerOrMove(1, 0);
    // the stick needs a release band, or a thumb resting on the rim fires for
    // ever; it engages past PAD_DEAD and only re-arms back under PAD_RELEASE
    const stickX = axes[0] ?? 0;
    const stickY = axes[1] ?? 0;
    let next = 0;
    if (Math.abs(stickX) > Math.abs(stickY)) {
        if (stickX <= -PAD_DEAD)
            next = 3;
        else if (stickX >= PAD_DEAD)
            next = 4;
    }
    else if (stickY <= -PAD_DEAD)
        next = 1;
    else if (stickY >= PAD_DEAD)
        next = 2;
    if (next === 0 && Math.max(Math.abs(stickX), Math.abs(stickY)) < PAD_RELEASE)
        stick = 0;
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
        }
        else if (now >= repeatAt) {
            moveFocus(heldX, heldY);
            repeatAt = now + PAD_REPEAT_MS;
        }
    }
    else {
        held = { x: 0, y: 0 };
    }
    // A/cross confirms, B/circle backs out, Start starts and pauses. Those
    // three are in the same place on every pad worth supporting.
    const pressed = (down(0) ? 1 : 0) | (down(1) ? 2 : 0) | (down(9) ? 4 : 0);
    const pressedFresh = pressed & ~buttonsPrevious;
    buttonsPrevious = pressed;
    if (pressedFresh & 1)
        confirm();
    if (pressedFresh & 2)
        back();
    if (pressedFresh & 4)
        start();
}
// A pad announces itself, and the page says so: the hint line swaps to the
// pad's own verbs and the focus ring turns on, because until a pad is here a
// ring on every click would just be noise to a mouse.
function announce(present) {
    document.documentElement.classList.toggle('padded', present);
    ports?.requestResize();
    // membership, not usability: with nothing focused the active element is
    // <body>, which is perfectly usable and not a control, so testing usability
    // alone would decide the ring already had a home and skip this
    const active = document.activeElement;
    if (!present || (active instanceof HTMLElement && controls().includes(active)))
        return;
    primary()?.focus();
}
/**
 * Wire the pad to the page's own screens. Call once at boot.
 *
 * @param shellPorts - the four things the pad needs the shell to do.
 */
export function initGamepads(shellPorts) {
    ports = shellPorts;
    overlay = mustGetElement('overlay');
    settingsModal = mustGetElement('settingsModal');
    profileModal = mustGetElement('profileModal');
    settingsClose = mustGetElement('settingsClose');
    primaries = ['modeGoBtn', 'vsCreateBtn', 'settingsClose', 'startBtn'].map((id) => mustGetElement(id));
    backButtons = ['modeBackBtn', 'vsBackBtn', 'tBackBtn'].map((id) => mustGetElement(id));
    window.addEventListener('gamepadconnected', () => {
        announce(true);
    });
    window.addEventListener('gamepaddisconnected', () => {
        for (const pad of navigator.getGamepads())
            if (pad?.connected === true)
                return;
        announce(false);
    });
}
//# sourceMappingURL=gamepad.js.map