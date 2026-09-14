/**
 * The jersey's shared half: what a shirt number IS, where its ink lands, and
 * the classic colours.
 *
 * OWNS the digit glyphs, the trim offsets, the default halves, the dealt
 * numbers and the layout arithmetic, because those are the parts where the
 * two clients drifting apart means the same player wearing two different
 * shirts. The mobile copy of the glyph table used to carry the warning that
 * it "is a character-for-character copy of page/pitch-art.ts's, because the
 * two clients must put the same shirt on the same player"; since 2026-09-14
 * that sentence is enforced by there being one table.
 *
 * MUST NEVER paint. Each client keeps its own ~25 lines of painting (Canvas2D
 * on the page, Skia in the app), because the shirt is clipped and stroked
 * with each canvas's own tools and that part cannot drift silently: a broken
 * painter is visible on its own screen. What this module hands out is
 * geometry, and geometry is where a one-character diff puts a 6 on one screen
 * and a 5 on the other.
 *
 * @module jersey
 */
/**
 * The numbers a room deals its five lanes when players choose none. Chosen
 * numbers win and clashes fall back through `kitNumbersFor` (see kit.ts).
 */
export const VS_NUMS = [10, 7, 9, 4, 8];
/**
 * The number a snake wears when its player has chosen none: the classic ten.
 * A room deals from `VS_NUMS` instead, so this is the solo answer and the one
 * every preview shows.
 */
export const JERSEY_SOLO_NUM = 10;
/** The classic shirt's left half, worn when a player has chosen no colour. */
export const JERSEY_LEFT_DEFAULT = '#f2c114';
/** The classic shirt's right half, worn when a player has chosen no colour. */
export const JERSEY_RIGHT_DEFAULT = '#d8231f';
/**
 * The eight offsets the number's dark trim is drawn at, so a digit is
 * outlined on every side rather than shadowed on one. A TRIM, not a drop
 * shadow, and this is the one place free-form kit colours forced a change to
 * the art: white digits over a one-sided shadow read perfectly on the classic
 * yellow-and-red and vanish on a white kit, which is one of the commonest
 * shirts there is. Every direction instead, the way a real shirt number is
 * trimmed, so it holds on any two colours a player picks without the art
 * overriding either of them. Eight passes at BAKE time, never per frame.
 */
export const JERSEY_TRIM = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];
/**
 * 3x5 pixel glyphs, 0-9, so a shirt can wear any number.
 *
 * Blocks rather than text on purpose: 8-bit at this size, and immune to which
 * fonts a device happens to ship, which is the same reason the flags are a
 * sprite rather than regional-indicator pairs.
 */
const JERSEY_GLYPH = {
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};
/**
 * Where a number's ink lands on a shirt: one square cell per lit glyph pixel,
 * centred, at the size the shirt's proportions dictate.
 *
 * Bake-time only: this allocates the cell list, which a frame loop must never
 * do (performance rule 4) and a sprite bake is welcome to.
 *
 * @param num The number on the back, 0..99.
 * @param s The shirt's size in pixels; it is square.
 * @returns The cell edge `px` and the top-left corner of every lit cell; a
 *   painter fills each at (x + dx, y + dy) for the trim pass it is on.
 */
export function jerseyDigitCells(num, s) {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- digits of a number, never text: there is nothing here for a code point to break.
    const digits = [...String(num)];
    const px = Math.max(1, Math.round(s * 0.11));
    const w = digits.length * 4 - 1; // 3px per glyph plus a 1px gap, less the trailing gap
    const x0 = Math.round((s - px * w) / 2), y0 = Math.round((s - px * 5) / 2);
    const cells = [];
    for (let d = 0; d < digits.length; d++) {
        const glyph = JERSEY_GLYPH[digits[d] ?? ''];
        if (!glyph)
            continue;
        for (let r = 0; r < 5; r++)
            for (let k = 0; k < 3; k++)
                if (glyph[r]?.[k] === '1')
                    cells.push([x0 + d * px * 4 + k * px, y0 + r * px]);
    }
    return { px, cells };
}
