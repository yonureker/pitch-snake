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
import { hatFor, skinFor } from './pitch-art.js';
import { paintSnakePreview } from './snake-preview.js';
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
