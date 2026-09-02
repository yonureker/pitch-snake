---
name: flag-sprite
description: >-
  Regenerate assets/flags.png and the FLAG_CODES lists that index it. Use when
  adding or removing a country, when the picker and the sprite disagree, when a
  flag renders as the wrong country, or when updating the flag-icons artwork.
  The sprite and the two code lists are one artefact in three places.
---

# Regenerating the flag sprite

Flags are artwork, not emoji: a regional-indicator pair is only a flag where
the platform ships flag glyphs, and Windows never has. The sprite is the only
thing that looks the same on a phone, a television and a Steam machine.

## The contract

`assets/flags.png` is a **16-wide grid of 60x45 cells, alphabetical by ISO-3166
alpha-2**. A flag's grid position IS its index in that order, so no lookup
table ships. Three things encode that same order and must move together:

1. `assets/flags.png` (and the identical copy in `apps/mobile/assets/`)
2. `FLAG_CODES` in `index.html`
3. `FLAG_CODES` in `apps/mobile/src/lib/leaderboard.ts`

Change one alone and every flag after the edit point silently shifts to the
wrong country. Nothing errors.

## The trap that has already been hit

**Never look a code up with `indexOf` on the concatenated string.** It finds
the first occurrence, and 98 of the 250 codes also appear straddling two of
their neighbours: `UG` sits inside `GU` + `GW` long before Uganda's own slot.
Both clients build a `Map` once from even offsets. Keep it that way.

## Procedure

**1. Decide the code list.** It is `Intl.DisplayNames` over every AA-ZZ pair
minus `NOT_COUNTRIES` in `index.html`. That blocklist drops CLDR's
non-countries AND deprecated aliases that would otherwise appear twice (`DY`,
`HV`, `NH`, `RH`, `VD` resolve to countries already listed; `UK` duplicates
`GB`; `CQ` has no artwork anywhere).

```bash
node -e "
const NOT = new Set([/* paste NOT_COUNTRIES from index.html */]);
const dn = new Intl.DisplayNames(['en'], { type: 'region' });
const out = [];
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const c = String.fromCharCode(a, b);
  if (NOT.has(c)) continue;
  let l; try { l = dn.of(c); } catch (e) { continue; }
  if (l && l !== c) out.push(c);
}
require('fs').writeFileSync('/tmp/codes.json', JSON.stringify(out));
console.log(out.length, 'countries');"
```

**2. Fetch the artwork.** flag-icons 4x3, MIT:
`https://cdn.jsdelivr.net/npm/flag-icons@7/flags/4x3/<lowercase>.svg`. Fetch in
parallel and **list anything that 404s** — a code with no artwork must be added
to `NOT_COUNTRIES`, never left in the picker to render blank.

**3. Rasterise.** There is no ImageMagick or rsvg here; headless Chrome is the
rasteriser. Build an HTML page of absolutely-positioned `<img>` tags at exactly
60x45, each SVG inlined as a data URI, then screenshot at exactly the grid
size with `deviceScaleFactor: 1`. **Serve the page over http** — a ~2MB
`data:` URL fails to navigate and yields an empty screenshot.

**4. Quantise.** PIL is available. 256 adaptive colours takes ~215KB down to
~67KB with no visible loss; verify by cropping the hard ones (BR, ES, PT, MX,
NP, GB, IN, KH, BT) and comparing against full colour at 3x zoom.

**5. Write all three places.** Copy the PNG to `assets/` and
`apps/mobile/assets/`; update both `FLAG_CODES` strings.

**6. Verify by pulling cells back out.** Do not trust the build. Index a few
countries with the clients' own arithmetic, crop those cells, and LOOK at
them. Include a straddle-prone trio (`GU`, `GW`, `UG`) and confirm they land
on distinct slots.

Then in the browser, confirm every picker option has artwork:

```js
[...profCountry.options].slice(1).every(o => flagIndex(o.value) >= 0)
```

That single check is the one that proves the sprite and the picker agree.

**7. Attribution.** flag-icons is MIT and the notice must ship. Keep
`assets/flags.LICENSE.txt` (and the mobile copy) current with the version used.
