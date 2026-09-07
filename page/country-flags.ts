/**
 * Countries: the flag artwork and the list of places it can name.
 *
 * OWNS `FLAG_CODES`, the ISO-3166 alpha-2 order that IS the layout of
 * assets/flags.png, and therefore owns the only correct way to point at a
 * cell in that sprite. The same order is carried by the mobile app and by
 * the sprite generator, which makes the three of them ONE artefact in three
 * places: regenerate them together or every flag silently shifts to its
 * neighbour. The `flag-sprite` skill is that procedure.
 *
 * MUST NEVER decide anything about identity. A country is decoration beside
 * a name; nothing here reads or writes a profile, and an unknown code is
 * answered with no flag rather than an error.
 *
 * Both exports take the element they paint into, so this file holds no
 * reference to any part of the page and can serve the chip, the boards, a
 * roster and the profile sheet from the same code.
 *
 * @module
 */

// A regional-indicator pair is only a flag if the platform ships flag
// glyphs, and Windows never has: there the pair degrades to two letters,
// so the same board looked different depending on who was reading it. The
// flags are artwork now (assets/flags.png, 250 of them from flag-icons,
// MIT, see assets/flags.LICENSE.txt), which renders identically on every
// platform, including the ones that have no emoji at all: a television, a
// Steam machine, a phone with the emoji font stripped.
//
// The sprite is a 16-wide grid of 60x45 cells in alphabetical code order,
// so the index IS the position and no lookup table has to be shipped or
// kept in step with the art. FLAG_CODES is that order, two characters per
// country; a code that is not in it simply has no flag, which is the same
// answer as before for anything unknown.
// The secret scanner sees a long high-entropy string; it is a public
// ISO-3166 list whose ORDER is the sprite's layout, so it cannot be broken
// up or reordered without moving every flag. The app's copy carries the
// same disable for the same reason.
// eslint-disable-next-line no-secrets/no-secrets -- public ISO-3166 list, see above
const FLAG_CODES = 'ADAEAFAGAIALAMAOAQARASATAUAWAXAZBABBBDBEBFBGBHBIBJBLBMBNBOBQBRBSBTBVBWBYBZCACCCDCFCGCHCICKCLCMCNCOCRCUCVCWCXCYCZDEDJDKDMDODZECEEEGEHERESETFIFJFKFMFOFRGAGBGDGEGFGGGHGIGLGMGNGPGQGRGSGTGUGWGYHKHMHNHRHTHUIDIEILIMINIOIQIRISITJEJMJOJPKEKGKHKIKMKNKPKRKWKYKZLALBLCLILKLRLSLTLULVLYMAMCMDMEMFMGMHMKMLMMMNMOMPMQMRMSMTMUMVMWMXMYMZNANCNENFNGNINLNONPNRNUNZOMPAPEPFPGPHPKPLPMPNPRPSPTPWPYQARERORSRURWSASBSCSDSESGSHSISJSKSLSMSNSOSRSSSTSVSXSYSZTCTDTFTGTHTJTKTLTMTNTOTRTTTVTWTZUAUGUMUSUYUZVAVCVEVGVIVNVUWFWSXKYEYTZAZMZW';
const FLAG_COLS = 16, FLAG_W = 20, FLAG_H = 15;
// Read the pairs into a map once rather than searching the string. Not a
// micro-optimisation: indexOf finds the FIRST occurrence, and 98 of the 250
// codes also appear straddling two of their neighbours ('UG' sits inside
// 'GU'+'GW' long before Uganda's own slot), so a search would answer with
// somebody else's flag or, once guarded against that, with none at all.
const FLAG_AT = new Map<string, number>();
for (let i = 0; i < FLAG_CODES.length; i += 2) FLAG_AT.set(FLAG_CODES.slice(i, i + 2), i / 2);
// -1 for anything the sprite does not carry, which callers read as "no flag"
function flagIndex(code: string | null | undefined): number {
  const i = code ? FLAG_AT.get(code) : undefined;
  return i ?? -1;
}
/**
 * Paint one element as a single flag.
 *
 * Nothing is allocated per call and the sprite is one request for the whole
 * set, which is why every board and roster can afford to call this per row.
 *
 * @param element - the element to paint; it carries the `flag` class, whose
 *   CSS supplies the sprite as a background image.
 * @param code - an ISO-3166 alpha-2 code, uppercase.
 *   Anything the sprite does not carry hides the element instead.
 */
export function paintFlag(element: HTMLElement, code: string | null | undefined): void {
  const i = flagIndex(code);
  if (i < 0) { element.style.backgroundImage = ''; element.hidden = true; return; }
  element.hidden = false;
  element.style.backgroundPosition = `${-(i % FLAG_COLS) * FLAG_W}px ${-Math.trunc(i / FLAG_COLS) * FLAG_H}px`;
}

// The country list writes itself: probe every two-letter code against the
// browser's own region names and keep the ones that mean somewhere, minus
// CLDR's handful of non-countries. No 250-line list to hand-maintain, and
// new countries arrive with browser updates.
// The blocklist also drops deprecated ALIASES, which is a bug the flag work
// surfaced: CLDR still resolves DY, HV, NH, RH and VD to Benin, Burkina
// Faso, Vanuatu, Zimbabwe and Vietnam, and UK to the United Kingdom, so the
// picker was quietly offering six countries twice. CQ (Sark) goes too: it
// resolves, but no flag set carries it, and an entry that can never show a
// flag is worse than no entry.
const NOT_COUNTRIES = new Set<string>(['AC','AN','BU','CP','CQ','CS','DD','DG','DY','EA','EU','EZ','FX','HV','IC','NH','NT','QO','RH','SU','TA','TP','UK','UN','VD','XA','XB','YD','YU','ZR','ZZ']);
// keyed by element, not a single flag: more than one picker may exist
const BUILT = new WeakSet<HTMLSelectElement>();
/**
 * Fill a `<select>` with every country the browser can name, once.
 *
 * Idempotent per element: a second call for the same select does nothing, so
 * a sheet that opens repeatedly does not stack duplicates.
 *
 * @param select - the picker to append options to.
 */
export function buildCountries(select: HTMLSelectElement): void {
  if (BUILT.has(select)) return;
  BUILT.add(select);
  let dn;
  try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return; }
  const opts: [string, string][] = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCodePoint(a, b);
    if (NOT_COUNTRIES.has(code)) continue;
    let label: string | undefined;
    try { label = dn.of(code); } catch { continue; }
    if (!label || label === code) continue;
    opts.push([code, label]);
  }
  opts.sort((x, y) => x[1].localeCompare(y[1]));
  for (const [code, label] of opts) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = label;
    select.append(o);
  }
}
