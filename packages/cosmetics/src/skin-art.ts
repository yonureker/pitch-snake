/**
 * The skins: every body a snake can wear, on either client.
 *
 * SHARED, NOT COPIED, since 2026-09-16, the hats' own move applied to the
 * body: this table lived twice (page/pitch-art.ts and the app's theme.ts),
 * kept value-for-value by hand, and the pattern drop would have doubled a
 * duplicated table. The server sells ids and prices, this package owns what
 * an id LOOKS like, and an id a build has never heard of falls back to
 * classic, which is what lets the shop grow by SQL alone.
 *
 * A skin is a TEMPLATE, not a recolour (the owner's call, 2026-09-10), and
 * since 2026-09-16 a template has two axes:
 *
 *   `pattern` - colour stops cycled along the body FRACTION, head to tail:
 *   rings. Growing stretches them, it never mints more, which is what a real
 *   snake's rings do. Hard-edged unless `soft`, which cross-fades.
 *
 *   `texture` - a 2D motif drawn INTO each segment tile at bake time (dots,
 *   stripes, scales; see skin-texture.ts). Named by id so both clients bake
 *   the identical art, and priced above the ring skins in the shop because
 *   it is more drawing per square: geometric motifs are the cheap tier,
 *   ornamental ones the prestige tier.
 *
 * MUST NEVER paint anything itself: shade math and data only. Painting is
 * each client's own business (the page fills rounded rects and bakes sprites
 * for textured skins; the app bakes Skia sprites), and the texture painters
 * live in skin-texture.ts against the same surface dialect the hats draw on.
 *
 * @module skin-art
 */

/** How many shades a body ramp holds; renderers index their tables by it. */
export const SNAKE_SHADES = 64;

/** An rgb triple, 0-255 per channel. */
export type Rgb = readonly [number, number, number];

/** One skin's art: the ramp, the outline, the crest, and the two pattern axes. */
export interface SkinArt {
  /** Head colour of the body ramp. */
  head: readonly number[];
  /** Tail colour of the body ramp. */
  tail: readonly number[];
  /** The outline that rides every segment. */
  line: string;
  /** The crest's colour, or null for a skin that wears none (page only). */
  spikes: string | null;
  /** The crest's second colour, alternating tooth by tooth. */
  spikesAlt: string | null;
  /**
   * Rings: colour stops cycled head to tail instead of the plain two-colour
   * ramp. `cycles` is how many times the stop sequence repeats along the
   * body, hard rings unless `soft`, which cross-fades between stops.
   */
  pattern?: { colors: readonly (readonly number[])[]; cycles: number; soft?: boolean };
  /**
   * A 2D motif for each segment tile, drawn once at bake and free per frame.
   * `id` names a painter in skin-texture.ts; `ink` (and `ink2` where the
   * motif uses two) are its colours, alpha carried in the string.
   */
  texture?: { id: string; ink: string; ink2?: string };
}

/**
 * The skins. `classic` is the bare snake and `viper` the blue curio that
 * ?skin=viper has always summoned; the `skin-` ids are what the shop sells.
 * Rival BODIES wear this clothing too, so these are not the local player's
 * alone. Crested skins stay page-only in effect (the app draws no spikes),
 * which is why every SOLD skin is crestless: a skin that looks different per
 * platform would lie in a room.
 */
export const SKINS = {
  classic:      { head: [244, 236, 216], tail: [214, 196, 158], line: 'rgba(194,162,90,0.65)',
                  spikes: null, spikesAlt: null },
  viper:        { head: [ 88, 168, 246], tail: [ 24,  74, 150], line: 'rgba(150,110,235,0.75)',
                  spikes: '#9a5cf0', spikesAlt: '#7b3fd6' },
  'skin-away':  { head: [248, 248, 252], tail: [172, 194, 222], line: 'rgba(70,110,180,0.65)',
                  spikes: null, spikesAlt: null },
  'skin-volt':  { head: [250, 240, 104], tail: [172, 142, 24],  line: 'rgba(64,60,36,0.6)',
                  spikes: null, spikesAlt: null },
  'skin-rosa':  { head: [252, 186, 208], tail: [212, 106, 148], line: 'rgba(214,80,130,0.6)',
                  spikes: null, spikesAlt: null },
  'skin-night': { head: [226, 231, 241], tail: [ 36,  42,  56], line: 'rgba(122,132,160,0.55)',
                  spikes: null, spikesAlt: null },
  'skin-gilt':  { head: [252, 232, 152], tail: [194, 150, 56],  line: 'rgba(140,100,30,0.7)',
                  spikes: null, spikesAlt: null },
  // The template drop, 2026-09-10: seven ring-patterned bodies.
  'skin-ocean':   { head: [223, 238, 244], tail: [ 23,  57,  74], line: 'rgba(90,190,210,0.6)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[223, 238, 244], [23, 57, 74]], cycles: 5 } },
  'skin-copper':  { head: [217, 154,  94], tail: [ 94,  58,  28], line: 'rgba(150,92,44,0.65)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[217, 154, 94], [94, 58, 28]], cycles: 6 } },
  'skin-frost':   { head: [235, 248, 255], tail: [122, 168, 204], line: 'rgba(150,200,235,0.6)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[235, 248, 255], [122, 168, 204]], cycles: 5, soft: true } },
  'skin-cherry':  { head: [212,  58,  47], tail: [ 38,  35,  43], line: 'rgba(200,60,70,0.6)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[212, 58, 47], [242, 197, 61], [38, 35, 43], [242, 197, 61]], cycles: 2 } },
  'skin-violet':  { head: [201, 162, 255], tail: [ 91,  42, 168], line: 'rgba(160,110,240,0.6)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[201, 162, 255], [91, 42, 168]], cycles: 4 } },
  'skin-royal':   { head: [125, 162, 255], tail: [240, 244, 252], line: 'rgba(120,150,240,0.65)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[125, 162, 255], [240, 244, 252]], cycles: 6 } },
  'skin-inferno': { head: [255, 170,  80], tail: [179,  32,  19], line: 'rgba(230,120,50,0.6)',
                    spikes: null, spikesAlt: null,
                    pattern: { colors: [[255, 170, 80], [179, 32, 19]], cycles: 4, soft: true } },
  // The pattern drop, 2026-09-16: real 2D textures, the owner's call after
  // the ring skins still read as recolours. Seven geometric (the cheap
  // tier), five ornamental (the prestige tier); every ink chosen to read at
  // a 16px phone cell and to hold contrast against the pitch green.
  'skin-spot':       { head: [246, 245, 240], tail: [206, 200, 186], line: 'rgba(120,120,120,0.55)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'dots', ink: '#d43a2f' } },
  'skin-pinstripe':  { head: [ 52,  68, 120], tail: [ 24,  32,  64], line: 'rgba(255,255,255,0.3)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'pinstripe', ink: 'rgba(255,255,255,0.85)' } },
  'skin-crosshatch': { head: [232, 214, 170], tail: [190, 164, 110], line: 'rgba(110,86,40,0.6)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'crosshatch', ink: 'rgba(84,60,28,0.75)' } },
  'skin-zigzag':     { head: [242, 197,  61], tail: [196, 148,  32], line: 'rgba(60,50,20,0.6)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'zigzag', ink: '#26232b' } },
  'skin-chequer':    { head: [248, 246, 242], tail: [216, 210, 200], line: 'rgba(150,60,54,0.6)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'chequer', ink: '#c8322b' } },
  'skin-roundel':    { head: [122, 178, 232], tail: [ 60, 110, 170], line: 'rgba(40,70,120,0.6)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'roundel', ink: '#f4ecd8', ink2: '#d43a2f' } },
  'skin-argyle':     { head: [126,  40,  52], tail: [ 72,  20,  30], line: 'rgba(240,220,180,0.4)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'argyle', ink: '#f2e2c4', ink2: '#e0b34c' } },
  'skin-scale':      { head: [ 64, 168, 178], tail: [ 14,  70,  84], line: 'rgba(10,50,60,0.65)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'scales', ink: 'rgba(6,34,44,0.7)' } },
  'skin-wave':       { head: [ 58, 120, 200], tail: [ 16,  44,  96], line: 'rgba(200,230,255,0.35)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'waves', ink: 'rgba(240,248,255,0.85)' } },
  'skin-ocelli':     { head: [ 64,  52, 140], tail: [ 28,  20,  70], line: 'rgba(224,179,76,0.5)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'ocelli', ink: '#e0b34c', ink2: '#3ec6b8' } },
  'skin-diamondback': { head: [214, 178, 122], tail: [130,  94,  52], line: 'rgba(70,44,20,0.65)',
                        spikes: null, spikesAlt: null,
                        // both axes at once: the rattler's ring banding under
                        // a diamond chain, which is what a diamondback IS
                        pattern: { colors: [[214, 178, 122], [166, 128, 76]], cycles: 6 },
                        texture: { id: 'diamondback', ink: 'rgba(60,36,16,0.85)' } },
  'skin-mosaic':     { head: [ 70,  66,  74], tail: [ 34,  32,  40], line: 'rgba(224,179,76,0.45)',
                       spikes: null, spikesAlt: null,
                       texture: { id: 'mosaic', ink: '#e0b34c', ink2: '#c86a3a' } },
} as const satisfies Record<string, SkinArt>;

// Authored as a literal so the keys stay literal, read through a widened view
// so a server id (or a rival's presence payload, or a URL) can be looked up
// without a cast; under noUncheckedIndexedAccess an unknown id reads as
// undefined, which is exactly the fallback the economy asks for.
const SKIN_BY_ID: Record<string, SkinArt> = SKINS;

/**
 * The skin an id resolves to. Unknown, null and empty all wear classic.
 *
 * @param id A `pitch_snake_items` id, or null for "nothing equipped".
 * @returns Always a skin: a client that has not heard of next month's item
 *   still has to draw a snake.
 */
export function skinFor(id: string | null | undefined): SkinArt {
  return (id ? SKIN_BY_ID[id] : undefined) ?? SKINS.classic;
}

/**
 * The body colour at fraction `t` of the ramp, rings applied.
 *
 * The ONE copy of the shade math: the page's LUT of CSS strings and the
 * app's Skia colours are both built from these numbers, which is what keeps
 * a skin identical across a room of mixed clients.
 *
 * @param skin The skin to sample.
 * @param t Body fraction, 0 at the head, 1 at the tail; clamped.
 * @returns The rgb triple at that fraction.
 */
export function shadeRgbFor(skin: SkinArt, t: number): Rgb {
  const f = Math.min(1, Math.max(0, t));
  const p = skin.pattern;
  if (p) {
    // the template: the stop sequence cycled along the body, hard rings by
    // default, cross-faded when soft. Same table, same zero frame cost.
    const u = f * p.cycles * p.colors.length;
    const a = p.colors[Math.trunc(u) % p.colors.length] ?? skin.head;
    const b = p.colors[(Math.trunc(u) + 1) % p.colors.length] ?? skin.tail;
    const mix = p.soft ? u - Math.trunc(u) : 0;
    return [
      Math.trunc((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * mix),
      Math.trunc((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * mix),
      Math.trunc((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * mix),
    ];
  }
  const h = skin.head;
  const l = skin.tail;
  return [
    Math.trunc((h[0] ?? 0) + ((l[0] ?? 0) - (h[0] ?? 0)) * f),
    Math.trunc((h[1] ?? 0) + ((l[1] ?? 0) - (h[1] ?? 0)) * f),
    Math.trunc((h[2] ?? 0) + ((l[2] ?? 0) - (h[2] ?? 0)) * f),
  ];
}
