/**
 * Countries: the ISO-3166 order that IS the flag sprite's layout.
 *
 * OWNS `FLAG_CODES` and the only correct way to point at a cell in
 * assets/flags.png. The sprite is a 16-wide grid of 60x45 cells in
 * alphabetical code order, so a flag's index IS its grid position and no
 * lookup table ships with the art. Until 2026-09-14 this list lived once per
 * client, and the flag-sprite skill's whole job was keeping the copies and
 * the artwork in step: the sprite and this module are still one artefact in
 * two places (regenerate them together, see the skill), but the list itself
 * can no longer disagree with itself.
 *
 * MUST NEVER decide anything about identity, and never paints: a country is
 * decoration beside a name, an unknown code is answered with -1 rather than
 * an error, and how a cell becomes pixels is each client's own business
 * (the page positions a CSS background, the app offsets an Image).
 *
 * @module flags
 */
/**
 * The sprite's order, two characters per country. The secret scanner sees
 * 500 opaque high-entropy characters, which is exactly what it is meant to
 * catch; this is the public ISO-3166 alpha-2 list, and its SHAPE is the
 * sprite's layout, so it cannot be broken up or reordered without moving
 * every flag. Disabled deliberately rather than disguised.
 */
export declare const FLAG_CODES = "ADAEAFAGAIALAMAOAQARASATAUAWAXAZBABBBDBEBFBGBHBIBJBLBMBNBOBQBRBSBTBVBWBYBZCACCCDCFCGCHCICKCLCMCNCOCRCUCVCWCXCYCZDEDJDKDMDODZECEEEGEHERESETFIFJFKFMFOFRGAGBGDGEGFGGGHGIGLGMGNGPGQGRGSGTGUGWGYHKHMHNHRHTHUIDIEILIMINIOIQIRISITJEJMJOJPKEKGKHKIKMKNKPKRKWKYKZLALBLCLILKLRLSLTLULVLYMAMCMDMEMFMGMHMKMLMMMNMOMPMQMRMSMTMUMVMWMXMYMZNANCNENFNGNINLNONPNRNUNZOMPAPEPFPGPHPKPLPMPNPRPSPTPWPYQARERORSRURWSASBSCSDSESGSHSISJSKSLSMSNSOSRSSSTSVSXSYSZTCTDTFTGTHTJTKTLTMTNTOTRTTTVTWTZUAUGUMUSUYUZVAVCVEVGVIVNVUWFWSXKYEYTZAZMZW";
/** Cells per row in the sprite; the grid is 16 wide by 16 tall. */
export declare const FLAG_COLS = 16;
/**
 * Grid position of a country in the sprite.
 *
 * @param code - an ISO-3166 alpha-2 code, uppercase, or nothing.
 * @returns the index, or -1 for anything the sprite does not carry, which
 *   callers read as "no flag".
 */
export declare function flagIndex(code: string | null | undefined): number;
/**
 * A country is a two-letter code or it is nothing; junk renders no flag.
 * The type guard both clients wash server-sent and typed values through.
 *
 * @param v - anything that arrived claiming to be a country.
 * @returns whether it is shaped like one (the sprite still gets the last
 *   word, through `flagIndex`).
 */
export declare function isCountry(v: unknown): v is string;
