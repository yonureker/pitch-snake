/**
 * What a kit IS: two colours and a shirt number, and the rules that keep one
 * legal and a room's five distinct.
 *
 * OWNS the shape and the washing. A kit is free-form, unlike a skin or a hat:
 * there is no catalogue to check an id against, so validation is the only thing
 * standing between a peer's typed string and a paint. Every value that reaches
 * a painter or the network goes through `kitColor` and `kitNumber` first, and
 * both wash to null rather than throwing, because a kit is decoration and a bad
 * one must cost a default shirt and never a round. The DEFAULT colours are not
 * here: they are art and live with each painter, which is also the only place
 * that needs them. The wash is enforced a second time by check constraints in
 * supabase/auth.sql, so a disagreement costs a default shirt, never a corrupt
 * row.
 *
 * SHARED, NOT COPIED, since 2026-09-14: this was page/kit.ts and the app's
 * lib/kit.ts, two files whose header swore they would be "kept in step". One
 * wash for both clients is what actually keeps a shirt the same colour on
 * every screen. It still never enters packages/engine, because a cosmetic in
 * the engine would chain every colour to an ENGINE_VERSION bump and a
 * validator re-pin.
 *
 * MUST NEVER draw anything, read the DOM, or know which lane is mine. It is
 * told a list of choices and answers with a list of numbers; the pitch-art
 * painters paint, the shells decide who wears what. That split is what lets
 * the profile sheet, the pitch and the room all agree without any of them
 * importing each other.
 *
 * WHY FREE-FORM AT ALL. The owner's call on 2026-09-07, against a curated
 * palette: a player picks any two hexes. The cost is real and was flagged when
 * the choice was made, a kit can be painted pitch-green and nearly vanish, and
 * the answer is deliberately NOT a contrast clamp here (silently overriding a
 * colour somebody chose is worse than letting them choose it). The shirt's own
 * dark outline stroke in pitch-art is what keeps even a camouflaged kit
 * readable as a shape.
 *
 * @module kit
 */
/** The lowest legal shirt number. Zero is a real number, not "unset". */
export declare const KIT_NUM_MIN = 0;
/** The highest legal shirt number: two digits is what the shirt has room for. */
export declare const KIT_NUM_MAX = 99;
/** A kit as it is stored, sent and worn. Any field may be absent. */
export interface Kit {
    /** The left half, as `#rrggbb` lowercase, or null for the classic yellow. */
    left: string | null;
    /** The right half, as `#rrggbb` lowercase, or null for the classic red. */
    right: string | null;
    /** The shirt number 0..99, or null to keep the seat's default. */
    num: number | null;
}
/** A kit with nothing chosen: what every unset player wears. */
export declare const KIT_NONE: Kit;
/**
 * Wash one colour into `#rrggbb` lowercase, or null.
 *
 * Accepts `#rgb` shorthand and a bare hex without the hash, because both are
 * what people paste, and `<input type="color">` only ever emits the long form
 * anyway. Anything else is null, which the painter reads as "the classic
 * half": a peer's garbage costs them a default shirt and nothing else.
 *
 * @param value Anything at all, including what arrived over the network.
 * @returns `#rrggbb` in lowercase, or null when there is no colour in it.
 */
export declare function kitColor(value: unknown): string | null;
/**
 * Wash one shirt number into 0..99, or null.
 *
 * Strings are accepted because a text field and a JSON payload both hand over
 * strings; floats and out-of-range values wash to null rather than clamping,
 * since clamping 500 to 99 would put a number on a shirt nobody chose.
 *
 * @param value Anything at all, including what arrived over the network.
 * @returns An integer 0..99, or null when there is no number in it.
 */
export declare function kitNumber(value: unknown): number | null;
/**
 * Wash a whole kit, from a profile row, from localStorage or from a peer.
 *
 * @param value Anything shaped like a kit, or not.
 * @returns A kit whose every field is legal or null; never null itself, so
 *   callers can read `.num` without branching.
 */
export declare function kitOf(value: unknown): Kit;
/**
 * The key a renderer can compare to decide whether to rebake the shirt.
 *
 * @param kit The kit being worn.
 * @returns A string that changes exactly when the painted result would.
 */
export declare function kitKey(kit: Kit): string;
/**
 * Decide the number every seat in a room actually wears.
 *
 * A shirt number is now chosen rather than dealt, so two players can pick the
 * same one, and `VS_NUMS` exists precisely so a five-a-side never fields five
 * number tens. Clashes are settled by LANE ORDER: the lower lane keeps its
 * pick and the higher one falls back to the seat's dealt number, then to the
 * first free number on the board. Lane order is the server's roster order,
 * which is byte-identical on every peer, so every screen paints the same five
 * shirts without anybody negotiating.
 *
 * @param chosen Each lane's chosen number, or null where the player has none.
 * @param dealt The fallback number per lane (`VS_NUMS`).
 * @returns One number per lane, all distinct.
 */
export declare function kitNumbersFor(chosen: readonly (number | null)[], dealt: readonly number[]): number[];
