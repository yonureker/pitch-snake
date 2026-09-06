/**
 * The economy data layer: wallet, shop, purchases, what is worn, and the
 * badge shelf, over the same pitch_snake_ RPCs the web page calls. Coins are
 * minted by the validator and nowhere else; this file only reads balances
 * and spends them. Components never call this directly; the TanStack Query
 * hooks in hooks/queries/ are the sanctioned wrappers.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { rpc } from './leaderboard';

/** Balance, owned item ids, and what is worn, in one round trip. */
export interface Wallet {
  coins: number;
  items: string[];
  skin: string | null;
  hat: string | null;
}

/** One shop row; prices live on the server, art lives in the clients. */
export interface ShopItem {
  id: string;
  kind: string;
  name: string;
  price: number;
}

/** One badge from the catalogue; `at` is null until it is earned. */
export interface Badge {
  id: string;
  name: string;
  note: string;
  coins: number;
  at: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 32;

/** The signed-in wallet, or the empty one for a caller with no session. */
export async function fetchWallet(): Promise<Wallet> {
  const r = await rpc('pitch_snake_my_wallet', {});
  if (!isRecord(r)) return { coins: 0, items: [], skin: null, hat: null };
  const items = Array.isArray(r.items) ? r.items.filter(isId) : [];
  return {
    coins: typeof r.coins === 'number' ? r.coins : 0,
    items,
    skin: isId(r.skin) ? r.skin : null,
    hat: isId(r.hat) ? r.hat : null,
  };
}

/** Every item on sale, server-ordered. */
export async function fetchShop(): Promise<ShopItem[]> {
  const rows = await rpc('pitch_snake_shop', {});
  if (!Array.isArray(rows)) return [];
  const out: ShopItem[] = [];
  for (const r of rows as unknown[]) {
    if (!isRecord(r)) continue;
    const { id, kind, name, price } = r;
    if (isId(id) && typeof kind === 'string' && typeof name === 'string' && typeof price === 'number') {
      out.push({ id, kind, name, price });
    }
  }
  return out;
}

/** Spend coins on one item; the server computes the balance under a lock. */
export async function buyItem(id: string): Promise<{ ok: boolean; error: string | null }> {
  const r = await rpc('pitch_snake_buy_item', { p_item: id });
  if (isRecord(r) && typeof r.error === 'string') return { ok: false, error: r.error };
  return { ok: true, error: null };
}

/**
 * Wear an outfit. The server contract is set_profile's: null keeps a slot,
 * '' clears it, an id sets it; this app always sends both slots explicitly.
 */
export async function equipOutfit(skin: string | null, hat: string | null): Promise<void> {
  await rpc('pitch_snake_equip', { p_skin: skin ?? '', p_hat: hat ?? '' });
}

/** The whole badge catalogue with this player's earned marks. */
export async function fetchBadges(): Promise<Badge[]> {
  const rows = await rpc('pitch_snake_my_achievements', {});
  if (!Array.isArray(rows)) return [];
  const out: Badge[] = [];
  for (const r of rows as unknown[]) {
    if (!isRecord(r)) continue;
    const { id, name, note, coins, at } = r;
    if (isId(id) && typeof name === 'string' && typeof note === 'string') {
      out.push({
        id,
        name,
        note,
        coins: typeof coins === 'number' ? coins : 0,
        at: typeof at === 'string' ? at : null,
      });
    }
  }
  return out;
}

// ---- what is worn, cached ----
// The profile row is the truth and the wallet fetch carries it; this cache
// only makes the outfit appear on the very first frame of the next launch
// instead of after the network answers.

const WORN_KEY = 'pitchSnakeWorn';

/** The outfit as of last save; classic/classic when unset or unreadable. */
export async function loadWorn(): Promise<{ skin: string | null; hat: string | null }> {
  try {
    const raw = await AsyncStorage.getItem(WORN_KEY);
    if (raw === null) return { skin: null, hat: null };
    const v: unknown = JSON.parse(raw);
    if (isRecord(v)) return { skin: isId(v.skin) ? v.skin : null, hat: isId(v.hat) ? v.hat : null };
  } catch {
    // storage being unavailable must not surface into the game
  }
  return { skin: null, hat: null };
}

/** Persist the outfit; failures are swallowed like the personal best's. */
export async function saveWorn(skin: string | null, hat: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(WORN_KEY, JSON.stringify({ skin, hat }));
  } catch {
    // same rule as loadWorn
  }
}
