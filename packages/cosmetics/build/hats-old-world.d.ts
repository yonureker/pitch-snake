/**
 * The hats of Europe and Africa: the world tour, western old world.
 *
 * One of the hat catalogue's three regional collections (see hat-art.ts for
 * the contract and the rule that a worn hat covers the head). Splitting by
 * hemisphere follows the infographic the tour was picked from, and keeps
 * each file inside the 500-line ceiling so a stray deletion stays visible
 * in a diff.
 *
 * @module
 */
import type { HatArt } from './hat-art.js';
/** The collection, merged into the catalogue by hat-art.ts. */
export declare const OLD_WORLD_HATS: Record<string, HatArt>;
