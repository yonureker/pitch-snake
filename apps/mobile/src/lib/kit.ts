/**
 * What a kit IS on the app side: two colours and a shirt number, and the wash
 * that keeps a typed or server-sent value out of a paint.
 *
 * OWNS the shape and the validation. This is page/kit.ts's sibling and is
 * deliberately a COPY rather than a shared package, for the reason
 * apps/mobile/src/game/pitch-art.ts is a copy of page/pitch-art.ts: only the
 * rules are shared in this repo, and a kit is not rules. It never enters
 * packages/engine, because a cosmetic in the engine would chain every colour
 * to an ENGINE_VERSION bump and a validator re-pin.
 *
 * If the wash changes here it changes there. The two files agree on exactly
 * one thing that matters, which hex forms are legal and which numbers are, and
 * both are enforced again by check constraints in supabase/auth.sql, so a
 * disagreement costs a default shirt rather than a corrupt row.
 *
 * The lane-order de-duplication in page/kit.ts has no counterpart here: the
 * app draws only the local snake's shirt, never a rival's.
 *
 * @module kit
 */

/** The lowest legal shirt number. Zero is a real number, not "unset". */
export const KIT_NUM_MIN = 0;

/** The highest legal shirt number: two digits is what the shirt has room for. */
export const KIT_NUM_MAX = 99;

/** A kit as it is stored, sent and worn. Any field may be absent. */
export interface Kit {
  /** The left half as `#rrggbb` lowercase, or null for the classic yellow. */
  left: string | null;
  /** The right half as `#rrggbb` lowercase, or null for the classic red. */
  right: string | null;
  /** The shirt number 0..99, or null for the classic ten. */
  num: number | null;
}

/** A kit with nothing chosen: what every unset player wears. */
export const KIT_NONE: Kit = { left: null, right: null, num: null };

/**
 * Wash one colour into `#rrggbb` lowercase, or null.
 *
 * Accepts `#rgb` shorthand and a bare hex without the hash, because both are
 * what people type into a text field. Anything else is null, which the painter
 * reads as "the classic half".
 *
 * @param value - anything at all, including what arrived from the server.
 * @returns `#rrggbb` in lowercase, or null when there is no colour in it.
 */
export function kitColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase().replace(/^#/, '');
  // #abc is #aabbcc: expand rather than reject, since it is a form people
  // type. Doubling each character beats indexing it, which under
  // noUncheckedIndexedAccess is six possibly-undefined reads for no gain.
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw.replaceAll(/./g, (ch) => ch + ch)}`;
  }
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

/**
 * Wash one shirt number into 0..99, or null.
 *
 * @param value - anything at all, including what arrived from the server.
 * @returns an integer 0..99, or null when there is no number in it.
 */
export function kitNumber(value: unknown): number | null {
  let n: unknown = value;
  if (typeof n === 'string') {
    const text = n.trim();
    // Number('') is 0, and so is Number(' '). An empty field means no choice
    // and must fall back to the classic ten; read as zero it would silently
    // put a 0 shirt on the player instead.
    n = text === '' ? Number.NaN : Number(text);
  }
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return n >= KIT_NUM_MIN && n <= KIT_NUM_MAX ? n : null;
}

/**
 * A guard rather than a cast, so the compiler is told something true about a
 * server payload instead of being lied to about it.
 *
 * @param value - anything.
 * @returns whether it can be read by key.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Wash a whole kit, from a profile row or from storage.
 *
 * @param value - anything shaped like a kit, or not.
 * @returns a kit whose every field is legal or null; never null itself.
 */
export function kitOf(value: unknown): Kit {
  const source = isRecord(value) ? value : {};
  return {
    left: kitColor(source.left),
    right: kitColor(source.right),
    num: kitNumber(source.num),
  };
}

/**
 * The key a renderer can compare to decide whether to rebake the shirt.
 *
 * @param kit - the kit being worn.
 * @returns a string that changes exactly when the painted result would.
 */
export function kitKey(kit: Kit): string {
  return `${kit.left ?? ''}|${kit.right ?? ''}|${kit.num ?? ''}`;
}
