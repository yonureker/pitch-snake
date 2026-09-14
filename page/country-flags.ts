/**
 * Countries: how the page paints a flag, and the picker of places.
 *
 * The ISO-3166 order that IS the sprite's layout lives in the shared
 * `packages/flags`, so the two clients cannot disagree about which cell is
 * whose (see the flag-sprite skill for regenerating the sprite and that list
 * together). This module owns only what is the PAGE's: the CSS background
 * positioning that turns an index into pixels, and the country picker.
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

import { FLAG_COLS, flagIndex } from '@pitch-snake/flags';

// How large one cell paints HERE: the page's stylesheet scales the sprite to
// 20x15 per flag, which is a display choice and not part of the shared order.
const FLAG_W = 20, FLAG_H = 15;
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
