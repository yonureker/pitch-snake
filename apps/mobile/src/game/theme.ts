/**
 * The game's palette and field metrics, mirroring the web page's CSS custom
 * properties so both renderers read as the same game.
 * @module
 */

/** Field and chrome colors, hex, straight from the web version. */
export const GameColors = {
  pageBg: '#efe6d0',
  panel: '#f6efde',
  ink: '#211e1a',
  muted: '#6b6553',
  gold: '#c2a25a',
  goldBright: '#d8b35e',
  food: '#e6402a',
  arena: '#24321b',
  arenaEdge: '#1b2614',
  gridLine: 'rgba(244,236,216,0.06)',
  wall: '#e6402a',
  wallBevel: '#ffd9d0',
  tntBody: '#d8461f',
  tntBandLight: '#dadad8',
  tntBandDark: '#a9a9a7',
  portalA: '#2ad4ff',
  portalARim: '#7ce9ff',
  portalADeep: '#04202f',
  portalB: '#c561ff',
  portalBRim: '#e2a6ff',
  portalBDeep: '#1d0630',
  ghostEye: '#12379e',
  snakeOutline: 'rgba(194,162,90,0.65)',
} as const;

/**
 * The shell's theme, the web's THEME chips ported (styles/theme-colors.css):
 * what swaps is the table the pitch sits on and the ink written straight
 * onto it, plus the pad and the sheets. The pitch itself, the overlay card
 * and everything drawn on the board keep their own colors in both themes,
 * exactly as the page does. Values are copied from the CSS custom
 * properties, never eyeballed, so the two clients read as one game.
 */
export interface ShellTheme {
  /** the table: the screen behind the board */
  bg: string;
  /** ink written straight onto the table */
  ink: string;
  muted: string;
  gold: string;
  /** the touch pad's clothes */
  padBg: string;
  padRing: string;
  padInk: string;
  padLine: string;
  /** the sheets (settings, profile, shop) */
  sheet: string;
  sheetInk: string;
  sheetMuted: string;
  sheetGold: string;
  sheetLine: string;
  sheetFieldInk: string;
}

/** The cream table, the default. */
export const LightShell: ShellTheme = {
  bg: '#efe6d0',
  ink: '#211e1a',
  muted: '#6b6553',
  gold: '#8a6f33',
  padBg: '#f6efde',
  padRing: 'rgba(33,30,26,0.28)',
  padInk: '#211e1a',
  padLine: 'rgba(33,30,26,0.18)',
  sheet: '#f6efde',
  sheetInk: '#211e1a',
  sheetMuted: '#6b6553',
  sheetGold: '#8a6f33',
  sheetLine: 'rgba(33,30,26,0.18)',
  sheetFieldInk: '#211e1a',
};

/** The dark table (html.theme-dark on the web, value for value). */
export const DarkShell: ShellTheme = {
  bg: '#12160e',
  ink: '#f6efde',
  muted: '#b7ac93',
  gold: '#d8b35e',
  padBg: '#232d1f',
  padRing: 'rgba(194,162,90,0.5)',
  padInk: '#f6efde',
  padLine: 'rgba(244,236,216,0.12)',
  sheet: '#1f2a1d',
  sheetInk: '#e9e0cd',
  sheetMuted: '#b7ac93',
  sheetGold: '#d8b35e',
  sheetLine: 'rgba(244,236,216,0.22)',
  sheetFieldInk: '#f6efde',
};

/** Ghost body/edge colors in spawn order, matching the web sprites. */
export const GhostColors = [
  { body: '#ec1f27', edge: '#a5121a' },
  { body: '#2f8ef0', edge: '#1a57ab' },
  { body: '#f5901e', edge: '#b3641a' },
  { body: '#f57ec3', edge: '#c74e97' },
  { body: '#25c7d9', edge: '#1592a0' },
] as const;

/** Head-to-tail body shades, precomputed like the web LUT (64 steps). */
export const SNAKE_SHADES = 64;

/**
 * The purchasable skins, ramps straight from the web page's SKINS table:
 * head colour, tail colour, and the outline that rides every segment. Keyed
 * by pitch_snake_items ids like the web, so the server sells ids and this
 * client owns the art; an id this table has never heard of renders classic,
 * which is what lets the catalogue grow by SQL without stranding old builds.
 */
export const SKIN_RAMPS = {
  classic: { head: [244, 236, 216], tail: [214, 196, 158], line: 'rgba(194,162,90,0.65)' },
  viper: { head: [88, 168, 246], tail: [24, 74, 150], line: 'rgba(150,110,235,0.75)' },
  'skin-away': { head: [248, 248, 252], tail: [172, 194, 222], line: 'rgba(70,110,180,0.65)' },
  'skin-volt': { head: [250, 240, 104], tail: [172, 142, 24], line: 'rgba(64,60,36,0.6)' },
  'skin-rosa': { head: [252, 186, 208], tail: [212, 106, 148], line: 'rgba(214,80,130,0.6)' },
  'skin-night': { head: [226, 231, 241], tail: [36, 42, 56], line: 'rgba(122,132,160,0.55)' },
  'skin-gilt': { head: [252, 232, 152], tail: [194, 150, 56], line: 'rgba(140,100,30,0.7)' },
  // the template drop, 2026-09-10, value for value with the page's SKINS:
  // a pattern is the stop sequence cycled along the body fraction, hard
  // rings unless soft (a cross-fade). See the page's buildLutFor.
  'skin-ocean': {
    head: [223, 238, 244],
    tail: [23, 57, 74],
    line: 'rgba(90,190,210,0.6)',
    pattern: {
      colors: [
        [223, 238, 244],
        [23, 57, 74],
      ],
      cycles: 5,
    },
  },
  'skin-copper': {
    head: [217, 154, 94],
    tail: [94, 58, 28],
    line: 'rgba(150,92,44,0.65)',
    pattern: {
      colors: [
        [217, 154, 94],
        [94, 58, 28],
      ],
      cycles: 6,
    },
  },
  'skin-frost': {
    head: [235, 248, 255],
    tail: [122, 168, 204],
    line: 'rgba(150,200,235,0.6)',
    pattern: {
      colors: [
        [235, 248, 255],
        [122, 168, 204],
      ],
      cycles: 5,
      soft: true,
    },
  },
  'skin-cherry': {
    head: [212, 58, 47],
    tail: [38, 35, 43],
    line: 'rgba(200,60,70,0.6)',
    pattern: {
      colors: [
        [212, 58, 47],
        [242, 197, 61],
        [38, 35, 43],
        [242, 197, 61],
      ],
      cycles: 2,
    },
  },
  'skin-violet': {
    head: [201, 162, 255],
    tail: [91, 42, 168],
    line: 'rgba(160,110,240,0.6)',
    pattern: {
      colors: [
        [201, 162, 255],
        [91, 42, 168],
      ],
      cycles: 4,
    },
  },
  'skin-royal': {
    head: [125, 162, 255],
    tail: [240, 244, 252],
    line: 'rgba(120,150,240,0.65)',
    pattern: {
      colors: [
        [125, 162, 255],
        [240, 244, 252],
      ],
      cycles: 6,
    },
  },
  'skin-inferno': {
    head: [255, 170, 80],
    tail: [179, 32, 19],
    line: 'rgba(230,120,50,0.6)',
    pattern: {
      colors: [
        [255, 170, 80],
        [179, 32, 19],
      ],
      cycles: 4,
      soft: true,
    },
  },
} as const satisfies Record<
  string,
  {
    head: number[];
    tail: number[];
    line: string;
    pattern?: { colors: number[][]; cycles: number; soft?: boolean };
  }
>;

function isSkinId(v: string): v is keyof typeof SKIN_RAMPS {
  return Object.hasOwn(SKIN_RAMPS, v);
}

/** The skin a wallet id resolves to; unknown ids and null wear classic. */
export function skinRamp(id: string | null): (typeof SKIN_RAMPS)[keyof typeof SKIN_RAMPS] {
  return id !== null && isSkinId(id) ? SKIN_RAMPS[id] : SKIN_RAMPS.classic;
}

/** rgb() string for body shade i of SNAKE_SHADES under one skin's ramp. */
export function snakeShadeFor(skin: string | null, i: number): string {
  const ramp = skinRamp(skin);
  const t = i / (SNAKE_SHADES - 1);
  // widened on assignment (never a cast): the literal tuples would make
  // every fallback below read as unnecessary, and the fallbacks are the
  // contract under noUncheckedIndexedAccess
  const p: { colors: readonly (readonly number[])[]; cycles: number; soft?: boolean } | undefined =
    'pattern' in ramp ? ramp.pattern : undefined;
  if (p !== undefined) {
    // a template: the stop sequence cycled along the body, hard rings by
    // default, cross-faded when soft (the page's buildLutFor, ported)
    const u = t * p.cycles * p.colors.length;
    const a = p.colors[Math.trunc(u) % p.colors.length] ?? ramp.head;
    const next = p.colors[(Math.trunc(u) + 1) % p.colors.length] ?? ramp.tail;
    const f = p.soft === true ? u - Math.trunc(u) : 0;
    const pr = (a[0] ?? 0) + ((next[0] ?? 0) - (a[0] ?? 0)) * f;
    const pg = (a[1] ?? 0) + ((next[1] ?? 0) - (a[1] ?? 0)) * f;
    const pb = (a[2] ?? 0) + ((next[2] ?? 0) - (a[2] ?? 0)) * f;
    return `rgb(${String(Math.trunc(pr))}, ${String(Math.trunc(pg))}, ${String(Math.trunc(pb))})`;
  }
  const r = ramp.head[0] + (ramp.tail[0] - ramp.head[0]) * t;
  const g = ramp.head[1] + (ramp.tail[1] - ramp.head[1]) * t;
  const b = ramp.head[2] + (ramp.tail[2] - ramp.head[2]) * t;
  return `rgb(${String(r | 0)}, ${String(g | 0)}, ${String(b | 0)})`;
}
