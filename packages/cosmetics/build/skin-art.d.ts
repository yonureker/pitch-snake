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
 * THE FRONT TWO SQUARES ARE NOT THE SKIN'S (owner's rule, 2026-09-18). The
 * head is the face and the square behind it wears the shirt, so every shell
 * dresses a skin from the THIRD square back and keeps the classic coat on
 * the front two, previews included. Design motifs and ramps knowing their
 * first visible square is the third one.
 *
 * MUST NEVER paint anything itself: shade math and data only. Painting is
 * each client's own business (the page fills rounded rects and bakes sprites
 * for textured skins; the app bakes Skia sprites), and the texture painters
 * live in skin-texture.ts against the same surface dialect the hats draw on.
 *
 * @module skin-art
 */
/** How many shades a body ramp holds; renderers index their tables by it. */
export declare const SNAKE_SHADES = 64;
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
    pattern?: {
        colors: readonly (readonly number[])[];
        cycles: number;
        soft?: boolean;
    };
    /**
     * A 2D motif for each segment tile, drawn once at bake and free per frame.
     * `id` names a painter in skin-texture.ts; `ink` (and `ink2` where the
     * motif uses two) are its colours, alpha carried in the string.
     */
    texture?: {
        id: string;
        ink: string;
        ink2?: string;
    };
}
/**
 * The skins. `classic` is the bare snake and `viper` the blue curio that
 * ?skin=viper has always summoned; the `skin-` ids are what the shop sells.
 * Rival BODIES wear this clothing too, so these are not the local player's
 * alone. Crested skins stay page-only in effect (the app draws no spikes),
 * which is why every SOLD skin is crestless: a skin that looks different per
 * platform would lie in a room.
 */
export declare const SKINS: {
    readonly classic: {
        readonly head: readonly [244, 236, 216];
        readonly tail: readonly [214, 196, 158];
        readonly line: "rgba(194,162,90,0.65)";
        readonly spikes: null;
        readonly spikesAlt: null;
    };
    readonly viper: {
        readonly head: readonly [88, 168, 246];
        readonly tail: readonly [24, 74, 150];
        readonly line: "rgba(150,110,235,0.75)";
        readonly spikes: "#9a5cf0";
        readonly spikesAlt: "#7b3fd6";
    };
    readonly 'skin-away': {
        readonly head: readonly [248, 248, 252];
        readonly tail: readonly [172, 194, 222];
        readonly line: "rgba(70,110,180,0.65)";
        readonly spikes: null;
        readonly spikesAlt: null;
    };
    readonly 'skin-volt': {
        readonly head: readonly [250, 240, 104];
        readonly tail: readonly [172, 142, 24];
        readonly line: "rgba(64,60,36,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
    };
    readonly 'skin-rosa': {
        readonly head: readonly [252, 186, 208];
        readonly tail: readonly [212, 106, 148];
        readonly line: "rgba(214,80,130,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
    };
    readonly 'skin-night': {
        readonly head: readonly [226, 231, 241];
        readonly tail: readonly [36, 42, 56];
        readonly line: "rgba(122,132,160,0.55)";
        readonly spikes: null;
        readonly spikesAlt: null;
    };
    readonly 'skin-gilt': {
        readonly head: readonly [252, 232, 152];
        readonly tail: readonly [194, 150, 56];
        readonly line: "rgba(140,100,30,0.7)";
        readonly spikes: null;
        readonly spikesAlt: null;
    };
    readonly 'skin-ocean': {
        readonly head: readonly [223, 238, 244];
        readonly tail: readonly [23, 57, 74];
        readonly line: "rgba(90,190,210,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [223, 238, 244], readonly [23, 57, 74]];
            readonly cycles: 5;
        };
    };
    readonly 'skin-copper': {
        readonly head: readonly [217, 154, 94];
        readonly tail: readonly [94, 58, 28];
        readonly line: "rgba(150,92,44,0.65)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [217, 154, 94], readonly [94, 58, 28]];
            readonly cycles: 6;
        };
    };
    readonly 'skin-frost': {
        readonly head: readonly [235, 248, 255];
        readonly tail: readonly [122, 168, 204];
        readonly line: "rgba(150,200,235,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [235, 248, 255], readonly [122, 168, 204]];
            readonly cycles: 5;
            readonly soft: true;
        };
    };
    readonly 'skin-cherry': {
        readonly head: readonly [212, 58, 47];
        readonly tail: readonly [38, 35, 43];
        readonly line: "rgba(200,60,70,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [212, 58, 47], readonly [242, 197, 61], readonly [38, 35, 43], readonly [242, 197, 61]];
            readonly cycles: 2;
        };
    };
    readonly 'skin-violet': {
        readonly head: readonly [201, 162, 255];
        readonly tail: readonly [91, 42, 168];
        readonly line: "rgba(160,110,240,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [201, 162, 255], readonly [91, 42, 168]];
            readonly cycles: 4;
        };
    };
    readonly 'skin-royal': {
        readonly head: readonly [125, 162, 255];
        readonly tail: readonly [240, 244, 252];
        readonly line: "rgba(120,150,240,0.65)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [125, 162, 255], readonly [240, 244, 252]];
            readonly cycles: 6;
        };
    };
    readonly 'skin-inferno': {
        readonly head: readonly [255, 170, 80];
        readonly tail: readonly [179, 32, 19];
        readonly line: "rgba(230,120,50,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [255, 170, 80], readonly [179, 32, 19]];
            readonly cycles: 4;
            readonly soft: true;
        };
    };
    readonly 'skin-spot': {
        readonly head: readonly [246, 245, 240];
        readonly tail: readonly [206, 200, 186];
        readonly line: "rgba(120,120,120,0.55)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "dots";
            readonly ink: "#d43a2f";
        };
    };
    readonly 'skin-pinstripe': {
        readonly head: readonly [52, 68, 120];
        readonly tail: readonly [24, 32, 64];
        readonly line: "rgba(255,255,255,0.3)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "pinstripe";
            readonly ink: "rgba(255,255,255,0.85)";
        };
    };
    readonly 'skin-crosshatch': {
        readonly head: readonly [232, 214, 170];
        readonly tail: readonly [190, 164, 110];
        readonly line: "rgba(110,86,40,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "crosshatch";
            readonly ink: "rgba(84,60,28,0.75)";
        };
    };
    readonly 'skin-zigzag': {
        readonly head: readonly [242, 197, 61];
        readonly tail: readonly [196, 148, 32];
        readonly line: "rgba(60,50,20,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "zigzag";
            readonly ink: "#26232b";
        };
    };
    readonly 'skin-chequer': {
        readonly head: readonly [248, 246, 242];
        readonly tail: readonly [216, 210, 200];
        readonly line: "rgba(150,60,54,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "chequer";
            readonly ink: "#c8322b";
        };
    };
    readonly 'skin-roundel': {
        readonly head: readonly [122, 178, 232];
        readonly tail: readonly [60, 110, 170];
        readonly line: "rgba(40,70,120,0.6)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "roundel";
            readonly ink: "#f4ecd8";
            readonly ink2: "#d43a2f";
        };
    };
    readonly 'skin-argyle': {
        readonly head: readonly [126, 40, 52];
        readonly tail: readonly [72, 20, 30];
        readonly line: "rgba(240,220,180,0.4)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "argyle";
            readonly ink: "#f2e2c4";
            readonly ink2: "#e0b34c";
        };
    };
    readonly 'skin-scale': {
        readonly head: readonly [64, 168, 178];
        readonly tail: readonly [14, 70, 84];
        readonly line: "rgba(10,50,60,0.65)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "scales";
            readonly ink: "rgba(6,34,44,0.7)";
        };
    };
    readonly 'skin-wave': {
        readonly head: readonly [58, 120, 200];
        readonly tail: readonly [16, 44, 96];
        readonly line: "rgba(200,230,255,0.35)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "waves";
            readonly ink: "rgba(240,248,255,0.85)";
        };
    };
    readonly 'skin-ocelli': {
        readonly head: readonly [64, 52, 140];
        readonly tail: readonly [28, 20, 70];
        readonly line: "rgba(224,179,76,0.5)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "ocelli";
            readonly ink: "#e0b34c";
            readonly ink2: "#3ec6b8";
        };
    };
    readonly 'skin-diamondback': {
        readonly head: readonly [214, 178, 122];
        readonly tail: readonly [130, 94, 52];
        readonly line: "rgba(70,44,20,0.65)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly pattern: {
            readonly colors: readonly [readonly [214, 178, 122], readonly [166, 128, 76]];
            readonly cycles: 6;
        };
        readonly texture: {
            readonly id: "diamondback";
            readonly ink: "rgba(60,36,16,0.85)";
        };
    };
    readonly 'skin-mosaic': {
        readonly head: readonly [70, 66, 74];
        readonly tail: readonly [34, 32, 40];
        readonly line: "rgba(224,179,76,0.45)";
        readonly spikes: null;
        readonly spikesAlt: null;
        readonly texture: {
            readonly id: "mosaic";
            readonly ink: "#e0b34c";
            readonly ink2: "#c86a3a";
        };
    };
};
/**
 * The skin an id resolves to. Unknown, null and empty all wear classic.
 *
 * @param id A `pitch_snake_items` id, or null for "nothing equipped".
 * @returns Always a skin: a client that has not heard of next month's item
 *   still has to draw a snake.
 */
export declare function skinFor(id: string | null | undefined): SkinArt;
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
export declare function shadeRgbFor(skin: SkinArt, t: number): Rgb;
