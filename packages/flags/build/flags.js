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
// A regional-indicator pair is only a flag if the platform ships flag
// glyphs, and Windows never has: there the pair degrades to two letters,
// so the same board looked different depending on who was reading it. The
// flags are artwork instead (assets/flags.png, 250 of them from flag-icons,
// MIT, see assets/flags.LICENSE.txt), which renders identically on every
// platform, including the ones that have no emoji at all: a television, a
// Steam machine, a phone with the emoji font stripped.
/**
 * The sprite's order, two characters per country. The secret scanner sees
 * 500 opaque high-entropy characters, which is exactly what it is meant to
 * catch; this is the public ISO-3166 alpha-2 list, and its SHAPE is the
 * sprite's layout, so it cannot be broken up or reordered without moving
 * every flag. Disabled deliberately rather than disguised.
 */
export const FLAG_CODES = 
// eslint-disable-next-line no-secrets/no-secrets -- public ISO-3166 list, see above
'ADAEAFAGAIALAMAOAQARASATAUAWAXAZBABBBDBEBFBGBHBIBJBLBMBNBOBQBRBSBTBVBWBYBZCACCCDCFCGCHCICKCLCMCNCOCRCUCVCWCXCYCZDEDJDKDMDODZECEEEGEHERESETFIFJFKFMFOFRGAGBGDGEGFGGGHGIGLGMGNGPGQGRGSGTGUGWGYHKHMHNHRHTHUIDIEILIMINIOIQIRISITJEJMJOJPKEKGKHKIKMKNKPKRKWKYKZLALBLCLILKLRLSLTLULVLYMAMCMDMEMFMGMHMKMLMMMNMOMPMQMRMSMTMUMVMWMXMYMZNANCNENFNGNINLNONPNRNUNZOMPAPEPFPGPHPKPLPMPNPRPSPTPWPYQARERORSRURWSASBSCSDSESGSHSISJSKSLSMSNSOSRSSSTSVSXSYSZTCTDTFTGTHTJTKTLTMTNTOTRTTTVTWTZUAUGUMUSUYUZVAVCVEVGVIVNVUWFWSXKYEYTZAZMZW';
/** Cells per row in the sprite; the grid is 16 wide by 16 tall. */
export const FLAG_COLS = 16;
// Read the pairs into a map once rather than searching the string. Not a
// micro-optimisation: indexOf finds the FIRST occurrence, and 98 of the 250
// codes also appear straddling two of their neighbours ('UG' sits inside
// 'GU' + 'GW' long before Uganda's own slot), so a search would answer with
// somebody else's flag or, once guarded against that, with none at all.
const FLAG_AT = new Map();
for (let i = 0; i < FLAG_CODES.length; i += 2)
    FLAG_AT.set(FLAG_CODES.slice(i, i + 2), i / 2);
/**
 * Grid position of a country in the sprite.
 *
 * @param code - an ISO-3166 alpha-2 code, uppercase, or nothing.
 * @returns the index, or -1 for anything the sprite does not carry, which
 *   callers read as "no flag".
 */
export function flagIndex(code) {
    const i = code ? FLAG_AT.get(code) : undefined;
    return i ?? -1;
}
/**
 * A country is a two-letter code or it is nothing; junk renders no flag.
 * The type guard both clients wash server-sent and typed values through.
 *
 * @param v - anything that arrived claiming to be a country.
 * @returns whether it is shaped like one (the sprite still gets the last
 *   word, through `flagIndex`).
 */
export function isCountry(v) {
    return typeof v === 'string' && /^[a-z]{2}$/i.test(v);
}
