/**
 * The shop: the spend side of the economy.
 *
 * OWNS the shop sheet, the purse's number beside the player chip, the
 * two-tap buy, and the last wallet the server handed back. The catalogue and
 * its prices are the server's word, fetched once a session; the wallet is
 * fetched fresh on every open; and every purchase or change of clothes
 * repaints from the wallet the SERVER returns, so this screen can never
 * disagree with the ledger.
 *
 * MUST NEVER mint a coin or decide a price. Coins are minted by the
 * validator and nowhere else, prices live in `pitch_snake_items`, and a
 * client that could award itself currency could print money. This file only
 * reads balances and asks the server to spend them.
 *
 * MUST NEVER be reached from the frame loop. All of it is menu-time DOM
 * work: it builds lists, sets text and paints two small preview canvases.
 *
 * The art is IMPORTED from page/pitch-art.ts, the same module the pitch itself
 * draws from. That is what makes a preview honest: it is not a drawing of the
 * item, it is the item's own draw call at preview size, so it cannot drift from
 * what the snake wears. It would stop being true the moment this file kept a
 * copy of its own. An id this page has never heard of falls back to classic,
 * which is what lets the catalogue grow by SQL alone without stranding old
 * clients.
 *
 * @module
 */
import { mustGetElement, mustGetElementOfKind } from './dom.js';
import { buildLutFor, drawCrest, hatFor, roundRectOn, skinFor, SNAKE_SHADES } from './pitch-art.js';
import type { HatArt, SkinArt } from './pitch-art.js';
import { supabaseConfigured, supabaseRpc } from './supabase-client.js';

/**
 * What the shop needs the shell to do for it.
 *
 * It is given these rather than reaching for them, which is the rule for
 * every module in this directory: the shop knows nothing about the pitch, the
 * round, or the page's chrome beyond these three verbs.
 */
export interface ShopPorts {
  /** Put an outfit on the pitch. Either slot may be null for "nothing worn". */
  applyWorn: (skin: string | null, hat: string | null) => void;
  /** Repaint the page's chrome; the purse appears once there is a number. */
  refreshChrome: () => void;
  /**
   * Stop any coin count-up in flight.
   *
   * The reveal animation ticks the purse upward after a round pays. A wallet
   * straight from the server outranks it, so it is cancelled rather than
   * allowed to finish on a stale target.
   */
  stopCoinCountUp: () => void;
}

/** A wallet as the server returns it. */
interface Wallet {
  coins: number;
  items: string[];
  skin: string | null;
  hat: string | null;
}

/** One row of the catalogue as the server returns it. */
interface ShopItem {
  id: string;
  kind: string;
  name: string;
  price: number;
}

const SHOP_ERRORS: Record<string, string> = {
  'not enough coins': 'Not enough coins yet. Rounds and badges pay them.',
  'no such item': 'That item is no longer sold.',
  'already owned': 'Already yours.',
  'skin not owned': 'Not yours yet.',
  'hat not owned': 'Not yours yet.',
  'no session': 'Sign-in has not settled. Try again in a moment.',
};

// how long an armed BUY waits for its SURE? before disarming itself
const ARM_MS = 3500;

/**
 * What each kind is called on its pill.
 *
 * A map rather than a column, for the same reason the ART is not a column: the
 * server sells ids, prices and kinds, and the words belong to whoever draws the
 * screen. An unlisted kind falls back to its own id with an S, so a category
 * added by SQL alone appears here rather than being invisible until someone
 * ships a page.
 */
const KIND_LABELS: Record<string, string> = {
  hat: 'Hats',
  skin: 'Skins',
  pitch: 'Pitches',
  jersey: 'Jerseys',
  ball: 'Balls',
};

/** The shelf order: the known kinds first, in this order, then any newcomer. */
const KIND_ORDER = ['hat', 'skin', 'pitch', 'jersey', 'ball'];

/**
 * The kinds the catalogue actually contains, in shelf order.
 *
 * Derived rather than stored: an empty category cannot appear, and a category
 * the server stops selling disappears without a page change.
 *
 * @param rows - the catalogue as the server sent it.
 * @returns each kind once, known kinds first in KIND_ORDER, then newcomers.
 */
function kindsInCatalogue(rows: ShopItem[]): string[] {
  const present = new Set(rows.map(item => item.kind));
  // Known kinds in their shelf order, then anything the server has invented
  // since this file was written, in the order the catalogue lists it.
  return [
    ...KIND_ORDER.filter(kind => present.has(kind)),
    ...[...present].filter(kind => !KIND_ORDER.includes(kind)),
  ];
}

let ports: ShopPorts | null = null;

let shopModal: HTMLElement | null = null;
let shopList: HTMLElement | null = null;
let shopCoins: HTMLElement | null = null;
let shopNote: HTMLElement | null = null;
let purseCoins: HTMLElement | null = null;

let purseKnown = false; // the purse waits until a wallet has answered
let catalog: ShopItem[] | null = null; // the server's word, once a session
let wallet: Wallet | null = null; // the last wallet the server handed back
let busy = false;
let armedBuy: string | null = null; // the item whose BUY waits for its SURE?
let shopPills: HTMLElement | null = null;
/**
 * Which shelf is open. Hats first because it is the cheapest thing to want and
 * the easiest to see on your own snake, so it is the shelf most likely to turn
 * a browser into a buyer.
 */
let activeKind = 'hat';
let armTimer = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asWallet(value: unknown): Wallet | null {
  if (!isRecord(value) || typeof value.coins !== 'number') return null;
  const items = Array.isArray(value.items) ? value.items.filter((v) => typeof v === 'string') : [];
  return {
    coins: value.coins,
    items,
    skin: typeof value.skin === 'string' ? value.skin : null,
    hat: typeof value.hat === 'string' ? value.hat : null,
  };
}

function errorOf(value: unknown): string | null {
  return isRecord(value) && typeof value.error === 'string' ? value.error : null;
}

function asCatalog(value: unknown): ShopItem[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ShopItem[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const { id, kind, name, price } = row;
    if (
      typeof id === 'string' &&
      typeof kind === 'string' &&
      typeof name === 'string' &&
      typeof price === 'number'
    ) {
      rows.push({ id, kind, name, price });
    }
  }
  return rows.length > 0 ? rows : null;
}

/**
 * Take a wallet the server handed back and repaint everything from it.
 *
 * One wallet, every reader: the shop's number, the purse beside the player
 * chip, and the snake's clothes all come from the same answer, which is why
 * they can never disagree.
 *
 * @param value - the raw RPC result; anything that is not a wallet is ignored.
 */
export function applyWallet(value: unknown): void {
  const next = asWallet(value);
  if (next === null || ports === null) return;
  wallet = next;
  ports.stopCoinCountUp(); // the server's number outranks a count-up mid-flight
  if (shopCoins !== null) shopCoins.textContent = String(next.coins);
  if (purseCoins !== null) purseCoins.textContent = String(next.coins);
  purseKnown = true;
  ports.refreshChrome(); // the purse shows once there is a number to show
  ports.applyWorn(next.skin, next.hat);
}

/**
 * Credit the wallet with what a round just paid, and repaint the shop's number.
 *
 * The validator's answer is the authority on what a round paid and the ledger
 * is idempotent, so crediting here and re-fetching the wallet later agree by
 * construction; the boot-time fetch stays the reconciler either way.
 *
 * This exists because the page used to do it by hand, assigning to a
 * `shopWallet` binding that is not in its scope and never was: the wallet is
 * private to this module. That threw a ReferenceError on every round that
 * actually PAID (a round earning no coins returns before reaching it, which is
 * why it looked fine), and the throw was swallowed by the save path's catch and
 * shown to the player as "Could not reach the leaderboard" on a score that had
 * in fact saved. It also aborted the rest of that path, so the board never
 * rendered. One undeclared name, two bugs, and no error anywhere on screen.
 *
 * The purse's own count-up stays with the page, which owns that animation; this
 * only moves the number the shop shelf reads.
 *
 * @param paid - coins the round paid; anything not positive is ignored.
 * @returns the new balance, or null if no wallet has answered on this device yet.
 */
export function creditPurse(paid: number): number | null {
  if (!(paid > 0) || wallet === null) return null;
  wallet = { ...wallet, coins: wallet.coins + paid };
  if (shopCoins !== null) shopCoins.textContent = String(wallet.coins);
  return wallet.coins;
}

/**
 * Has a wallet ever answered on this device?
 *
 * The purse stays hidden until one has, because an empty coin pill reads as
 * a bug rather than as a balance of zero.
 */
export function purseIsKnown(): boolean {
  return purseKnown;
}

// The preview is a real snake, not a drawing of one.
//
// It used to be a flat circle with the hat floating over it, on a canvas sized
// in CSS pixels only, so on any screen with a device pixel ratio above one the
// browser upscaled it and every preview looked soft. Both halves of that are
// fixed here: the canvas is sized in DEVICE pixels, and what it draws is the
// pitch's own body cell, ramp, outline, crest, eyes and hat.
//
// Two segments rather than one, because a snake is a body and a head and a
// single square reads as a token. The head is the right-hand square, facing
// right, which is the direction a round opens in.

// The box is taller than the old 64x28 because a hat is worn ABOVE the head:
// the wide-brim classic reaches about a cell above the crown, and at the old
// height its brim was cut off by the top edge. The snake sits low in the box
// and the space above it is the hat's.
/** The cell size the preview's two squares are drawn at. */
const PREVIEW_CELL = 20;
const PREVIEW_WIDTH = 72;
const PREVIEW_HEIGHT = 44;

/** How many device pixels there are per CSS pixel, clamped to something sane. */
function pixelRatio(): number {
  return Math.min(4, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * Size a canvas for the screen it is on rather than for CSS, and hand back a
 * context already scaled so callers keep drawing in CSS pixels.
 *
 * This is the whole of the blurriness fix: a 64x28 canvas on a 2x screen was
 * being stretched to 128x56 by the browser.
 *
 * @param canvas - the canvas to resize; its style keeps the CSS size.
 * @param width - the CSS width to present.
 * @param height - the CSS height to present.
 */
function crispContext(
  canvas: HTMLCanvasElement, width: number, height: number,
): CanvasRenderingContext2D | null {
  const ratio = pixelRatio();
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

/**
 * Draw the snake the way the pitch draws it: two body cells, head on the right.
 *
 * @param canvas - the preview canvas; it is resized to suit the screen.
 * @param skin - the skin to wear, which decides the ramp, the outline and the
 *   crest.
 * @param hat - the hat to wear, or null for a bare head.
 */
function paintSnakePreview(canvas: HTMLCanvasElement, skin: SkinArt, hat: HatArt | null): void {
  const context = crispContext(canvas, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  if (context === null) return;

  const cell = PREVIEW_CELL;
  // the pitch's own proportions: half-width 0.42 of a cell, corner radius 0.32
  const half = cell * 0.42;
  const radius = cell * 0.32;
  const ramp = buildLutFor(skin);
  // low in the box, so everything above the head belongs to the hat
  const centreY = PREVIEW_HEIGHT - cell * 0.62;
  // the pair centred, rather than shoved against the right edge
  const headX = PREVIEW_WIDTH / 2 + cell * 0.46;
  const bodyX = headX - cell * 0.92;

  context.lineWidth = Math.max(1, cell * 0.05);
  context.strokeStyle = skin.line;
  // tail first, so the head sits over it exactly as it does on the pitch
  const cells: [number, number][] = [[bodyX, SNAKE_SHADES - 1], [headX, 0]];
  for (const [x, shade] of cells) {
    context.fillStyle = ramp[shade] ?? '#f4ecd8';
    roundRectOn(context, x - half, centreY - half, half * 2, half * 2, radius);
    context.fill();
    context.stroke();
  }

  // the crest belongs to the SKIN, so one without a crest draws nothing
  context.save();
  context.translate(headX - half, centreY - half);
  drawCrest(context, half * 2, half * 2, skin);
  context.restore();

  // Eyes side by side and low on the head, which is how the pitch draws them
  // whenever the snake is heading up or down. Facing RIGHT the pitch stacks
  // them vertically instead, and every hat here sits low enough to cover the
  // upper one, so a faithful right-facing head previewed as one-eyed. The hat
  // is what the money buys and it has not moved; this only picks the heading
  // that leaves a face under it.
  const eye = cell * 0.16;
  context.fillStyle = '#211e1a';
  context.beginPath();
  context.arc(headX - eye * 0.72, centreY + eye * 0.66, cell * 0.08, 0, Math.PI * 2);
  context.arc(headX + eye * 0.72, centreY + eye * 0.66, cell * 0.08, 0, Math.PI * 2);
  context.fill();

  if (hat === null) return;
  // baked and blitted the way the pitch bakes and blits it, so a preview and a
  // round go through the same draw call and cannot disagree
  const hatWidth = Math.ceil(cell * hat.wf);
  const hatHeight = Math.ceil(cell * hat.hf);
  const scratch = document.createElement('canvas');
  const ratio = pixelRatio();
  scratch.width = Math.round(hatWidth * ratio);
  scratch.height = Math.round(hatHeight * ratio);
  const scratchContext = scratch.getContext('2d');
  if (scratchContext === null) return;
  scratchContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  hat.draw(scratchContext, hatWidth, hatHeight);
  context.drawImage(
    scratch, headX - hatWidth / 2, centreY + hat.dy(cell, hatHeight), hatWidth, hatHeight,
  );
}

function renderShop(): void {
  if (shopCoins === null || shopList === null) return;
  shopCoins.textContent = wallet === null ? '—' : String(wallet.coins);
  shopList.innerHTML = '';
  const rows = catalog ?? [];
  if (rows.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Fetching the catalogue…';
    shopList.append(empty);
    return;
  }
  const owned = new Set(wallet?.items);

  // The pills. Rebuilt with the list because ownership changes what each shelf
  // is worth looking at, and the count is the cheapest way to say so.
  const kinds = kindsInCatalogue(rows);
  if (!kinds.includes(activeKind)) activeKind = kinds[0] ?? activeKind;
  if (shopPills !== null) {
    shopPills.innerHTML = '';
    for (const kind of kinds) {
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.type = 'button';
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', String(kind === activeKind));
      pill.textContent = KIND_LABELS[kind] ?? kind.toUpperCase() + 'S';
      const count = document.createElement('span');
      count.className = 'n';
      const mine = rows.filter(r => r.kind === kind && owned.has(r.id)).length;
      const all = rows.filter(r => r.kind === kind).length;
      count.textContent = `${mine}/${all}`;
      pill.append(count);
      pill.addEventListener('click', () => {
        if (kind === activeKind) return;
        activeKind = kind;
        armedBuy = null;              // an armed BUY does not survive leaving its shelf
        renderShop();
      });
      shopPills.append(pill);
    }
  }

  for (const item of rows.filter(r => r.kind === activeKind)) {
    const row = document.createElement('li');
    const preview = document.createElement('canvas');
    preview.className = 'shop-prev';
    // The item is previewed ON the snake, wearing whatever else you already
    // own: a hat over your skin, a skin under your hat. That is what the money
    // actually buys, and it is why the preview takes both.
    if (item.kind === 'skin') paintSnakePreview(preview, skinFor(item.id), hatFor(wallet?.hat));
    else paintSnakePreview(preview, skinFor(wallet?.skin), hatFor(item.id));
    const text = document.createElement('span');
    text.className = 'shop-txt';
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = item.name;
    const status = document.createElement('span');
    status.className = 'st';
    const isWorn = wallet !== null && (wallet.skin === item.id || wallet.hat === item.id);
    status.textContent = isWorn ? 'On the pitch now.'
      : owned.has(item.id) ? 'Yours.'
      : `${item.price} coins`;
    text.append(name, status);
    const button = document.createElement('button');
    button.className = 'btn small';
    if (isWorn) {
      button.textContent = 'WEARING';
      button.classList.add('worn-btn');
      row.classList.add('worn');
    } else if (owned.has(item.id)) {
      button.textContent = 'WEAR';
    } else if (armedBuy === item.id) {
      button.textContent = 'SURE?';
    } else {
      button.textContent = `BUY ${item.price}`;
      button.disabled = wallet !== null && wallet.coins < item.price;
    }
    if (wallet === null || busy) button.disabled = true; // browse-only until the wallet answers
    button.addEventListener('click', () => {
      void act(item);
    });
    row.append(preview, text, button);
    shopList.append(row);
  }
}

async function act(item: ShopItem): Promise<void> {
  if (busy || wallet === null || shopNote === null) return;
  const owned = new Set(wallet.items).has(item.id);
  const isWorn = wallet.skin === item.id || wallet.hat === item.id;
  // the two-tap buy: arming is free and disarms itself
  if (!owned && armedBuy !== item.id) {
    armedBuy = item.id;
    clearTimeout(armTimer);
    armTimer = window.setTimeout(() => {
      armedBuy = null;
      renderShop();
    }, ARM_MS);
    renderShop();
    return;
  }
  armedBuy = null;
  clearTimeout(armTimer);
  busy = true;
  shopNote.hidden = true;
  renderShop();
  try {
    let answer: unknown;
    if (!owned) {
      answer = await supabaseRpc('pitch_snake_buy_item', { p_item: item.id });
      // owned and paid is real the moment the buy answers, even if the wear
      // below has a bad day
      if (errorOf(answer) === null) applyWallet(answer);
    }
    if (answer === undefined || errorOf(answer) === null) {
      // wearing: a fresh buy goes straight on; a WEARING tap comes off
      const id = owned && isWorn ? '' : item.id;
      answer = await supabaseRpc(
        'pitch_snake_equip',
        item.kind === 'skin' ? { p_skin: id, p_hat: null } : { p_skin: null, p_hat: id },
      );
    }
    const failure = errorOf(answer);
    if (failure === null) {
      applyWallet(answer);
    } else {
      shopNote.textContent = SHOP_ERRORS[failure] ?? `The shop said no: ${failure}`;
      shopNote.hidden = false;
    }
  } catch {
    shopNote.textContent = 'Could not reach the shop. Check the wallet before retrying.';
    shopNote.hidden = false;
  }
  busy = false;
  renderShop();
}

async function open(): Promise<void> {
  if (shopModal === null || shopNote === null) return;
  shopModal.hidden = false;
  shopNote.hidden = true;
  armedBuy = null;
  renderShop();
  if (!supabaseConfigured()) {
    shopNote.textContent = 'The shop needs the world board configured.';
    shopNote.hidden = false;
    return;
  }
  try {
    const [rows, purse] = await Promise.all([
      catalog === null ? supabaseRpc('pitch_snake_shop', {}) : Promise.resolve(catalog),
      supabaseRpc('pitch_snake_my_wallet', {}),
    ]);
    catalog = asCatalog(rows) ?? catalog;
    applyWallet(purse);
  } catch {
    shopNote.textContent = 'Could not reach the shop.';
    shopNote.hidden = false;
  }
  renderShop();
}

/**
 * Wire the shop to its markup. Call once at boot.
 *
 * @param shellPorts - the three things the shop needs the shell to do. The art
 *   is not among them: it is imported, from the same module the pitch draws
 *   from.
 */
export function initShop(shellPorts: ShopPorts): void {
  ports = shellPorts;
  shopModal = mustGetElement('shopModal');
  shopList = mustGetElement('shopList');
  shopCoins = mustGetElement('shopCoins');
  shopNote = mustGetElement('shopNote');
  purseCoins = mustGetElement('purseCoins');
  shopPills = mustGetElement('shopPills');
  const purseButton = mustGetElementOfKind('purseBtn', HTMLButtonElement);
  const closeButton = mustGetElementOfKind('shopClose', HTMLButtonElement);
  purseButton.addEventListener('click', () => {
    void open();
  });
  closeButton.addEventListener('click', () => {
    if (shopModal !== null) shopModal.hidden = true;
  });
}
