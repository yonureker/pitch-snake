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
 * The art is passed in rather than imported, because the ART lives with the
 * pitch that draws it and the shop must show exactly what the money buys. An
 * id this page has never heard of falls back to classic, which is what lets
 * the catalogue grow by SQL alone without stranding old clients.
 *
 * @module
 */
import { mustGetElement, mustGetElementOfKind } from './dom.js';
import { supabaseConfigured, supabaseRpc } from './supabase-client.js';

/** One skin's colour ramp and outline, exactly as the pitch draws it. */
export interface SkinArt {
  /** The head's colour, as r/g/b in 0..255. */
  head: readonly number[];
  /** The tail's colour; every segment interpolates between the two. */
  tail: readonly number[];
  /** The outline that rides every segment. */
  line: string;
}

/** One hat's art, exactly as the pitch draws it. */
export interface HatArt {
  /** Width as a fraction of a cell. */
  wf: number;
  /** Height as a fraction of a cell. */
  hf: number;
  /** Where it sits relative to the head's centre. */
  dy: (cellPixels: number, height: number) => number;
  /** How to draw it into a canvas of the given size. */
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

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

let skinArt: Record<string, SkinArt> = {};
let hatArt: Record<string, HatArt> = {};
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
 * Has a wallet ever answered on this device?
 *
 * The purse stays hidden until one has, because an empty coin pill reads as
 * a bug rather than as a balance of zero.
 */
export function purseIsKnown(): boolean {
  return purseKnown;
}

// one channel of the head-to-tail ramp, at t along it
function rampChannel(skin: SkinArt, channel: number, t: number): number {
  const head = skin.head[channel] ?? 0;
  const tail = skin.tail[channel] ?? 0;
  return Math.trunc(head + (tail - head) * t);
}

// Previews are drawn with the very ramps and hat art the pitch uses, so a
// preview cannot lie about what the money buys.
function paintSkinPreview(canvas: HTMLCanvasElement, id: string): void {
  const skin = skinArt[id] ?? skinArt.classic;
  const context = canvas.getContext('2d');
  if (context === null || skin === undefined) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const count = 5;
  const radius = 9;
  const y = canvas.height / 2;
  context.lineWidth = 1.5;
  context.strokeStyle = skin.line;
  for (let i = count - 1; i >= 0; i--) {
    // tail first, the head over it
    const t = i / (count - 1);
    const cx = canvas.width - 11 - i * 10.5;
    context.fillStyle =
      `rgb(${rampChannel(skin, 0, t)}, ${rampChannel(skin, 1, t)}, ${rampChannel(skin, 2, t)})`;
    context.beginPath();
    context.arc(cx, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function paintHatPreview(canvas: HTMLCanvasElement, id: string): void {
  const hat = hatArt[id] ?? hatArt.classic;
  const context = canvas.getContext('2d');
  if (context === null || hat === undefined) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const cellPixels = 17;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + 5;
  context.fillStyle = 'rgb(244,236,216)';
  context.strokeStyle = 'rgba(194,162,90,0.65)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(cx, cy, 8.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  const width = Math.ceil(cellPixels * hat.wf);
  const height = Math.ceil(cellPixels * hat.hf);
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const scratchContext = scratch.getContext('2d');
  if (scratchContext === null) return;
  hat.draw(scratchContext, width, height);
  context.drawImage(scratch, Math.round(cx - width / 2), Math.round(cy + hat.dy(cellPixels, height)));
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
  for (const item of rows) {
    const row = document.createElement('li');
    const preview = document.createElement('canvas');
    preview.className = 'shop-prev';
    preview.width = 64;
    preview.height = 28;
    if (item.kind === 'skin') paintSkinPreview(preview, item.id);
    else paintHatPreview(preview, item.id);
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
 * @param art - the pitch's own art, so a preview shows exactly what the money
 *   buys rather than a drawing of it.
 * @param art.skins - skin colour ramps, keyed by pitch_snake_items id.
 * @param art.hats - hat art, keyed by pitch_snake_items id.
 * @param shellPorts - the three things the shop needs the shell to do.
 */
export function initShop(
  art: { skins: Record<string, SkinArt>; hats: Record<string, HatArt> },
  shellPorts: ShopPorts,
): void {
  skinArt = art.skins;
  hatArt = art.hats;
  ports = shellPorts;
  shopModal = mustGetElement('shopModal');
  shopList = mustGetElement('shopList');
  shopCoins = mustGetElement('shopCoins');
  shopNote = mustGetElement('shopNote');
  purseCoins = mustGetElement('purseCoins');
  const purseButton = mustGetElementOfKind('purseBtn', HTMLButtonElement);
  const closeButton = mustGetElementOfKind('shopClose', HTMLButtonElement);
  purseButton.addEventListener('click', () => {
    void open();
  });
  closeButton.addEventListener('click', () => {
    if (shopModal !== null) shopModal.hidden = true;
  });
}
