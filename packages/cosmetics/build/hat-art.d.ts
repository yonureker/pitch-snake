import type { HatSurface } from './hat-surface.js';
/** One hat's art: its footprint, where it sits, and how to draw it. */
export interface HatArt {
    /** Width as a fraction of a cell. */
    wf: number;
    /** Height as a fraction of a cell. */
    hf: number;
    /** Where it sits relative to the head's centre. */
    dy: (cellPixels: number, height: number) => number;
    /** How to draw it into a canvas of the given size. */
    draw: (context: HatSurface, width: number, height: number) => void;
}
/**
 * The founding wardrobe. `classic` is the felt hat a bare hat slot has
 * always worn; the `hat-` ids are bought.
 */
export declare const HATS: {
    readonly classic: {
        readonly wf: 1.5;
        readonly hf: 0.95;
        readonly dy: (cellPixels: number, height: number) => number;
        readonly draw: (c: HatSurface, w: number, h: number) => void;
    };
    readonly 'hat-band': {
        readonly wf: 1.06;
        readonly hf: 0.3;
        readonly dy: (cellPixels: number) => number;
        readonly draw: (c: HatSurface, w: number, h: number) => void;
    };
    readonly 'hat-cap': {
        readonly wf: 1.35;
        readonly hf: 0.62;
        readonly dy: (cellPixels: number, height: number) => number;
        readonly draw: (c: HatSurface, w: number, h: number) => void;
    };
    readonly 'hat-crown': {
        readonly wf: 1.1;
        readonly hf: 0.72;
        readonly dy: (cellPixels: number, height: number) => number;
        readonly draw: (c: HatSurface, w: number, h: number) => void;
    };
};
/** Every id the catalogue can draw, for proofs and previews. */
export declare const HAT_IDS: readonly string[];
/**
 * The hat an id resolves to. Unknown, null and empty all wear classic.
 *
 * @param id A `pitch_snake_items` id, or null for "nothing equipped".
 * @returns Always a hat: an unknown id costing a default is the fallback\n *   rule every cosmetic follows.
 */
export declare function hatFor(id: string | null | undefined): HatArt;
