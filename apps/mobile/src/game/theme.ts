/**
 * The game's palette and field metrics, mirroring the web page's CSS custom
 * properties so both renderers read as the same game.
 * @module
 */
import { SNAKE_SHADES, shadeRgbFor, skinFor, type SkinArt } from '@pitch-snake/cosmetics/skin-art';

/**
 * Rival seat colours, the web's VS_COLORS: identity for tags, not clothing.
 *
 * Here rather than in the renderer because the header's seat strip paints the
 * same names in the same colours the pitch tags them with, and a UI component
 * should not have to import the whole Skia renderer to learn a colour. Two
 * lists would drift; this is the one.
 */
export const VS_COLORS = ['#f4ecd8', '#7ec8f5', '#9df57e', '#f5d67e', '#f57ea8'] as const;

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
  // The wall block: the game's danger red, with that red darkened for the
  // edge drawn inside each tile, so a block reads as one material. Shared
  // with the page, which draws the same two colours; they must not drift.
  // `wall` doubles as the danger red the TNT burst and a negative score
  // float have always worn, which is the same red on purpose.
  wall: '#e6402a',
  wallEdge: '#8c2417',
  tntBody: '#d8461f',
  tntBandLight: '#dadad8',
  tntBandDark: '#a9a9a7',
  portalA: '#2ad4ff',
  portalARim: '#7ce9ff',
  portalADeep: '#04202f',
  portalB: '#c561ff',
  portalBRim: '#e2a6ff',
  portalBDeep: '#1d0630',
  // the snake's own head ink, not the blue Pac-Man puts in its ghosts' eyes
  ghostEye: '#211e1a',
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

/**
 * The match officials' kit, value for value with the page's GHOST_COLORS.
 *
 * The pack used to wear Pac-Man's exact four over its dome-and-skirt
 * silhouette, and the look was the exposure rather than the rules. Pink went
 * to plum and cyan to teal, which clears the teleport window at the same
 * time. Index is the personality, not taste.
 *
 * The Chaser was BLACK until 2026-09-17, when players said they could not
 * see it: black measures 1.06:1 against this pitch, the same luminance as
 * the turf, on the one official that comes straight at you. Fluoro lime is
 * 10.35:1 and is a real referee kit worn for that exact reason. See the
 * page's GHOST_COLORS for why it beat lavender and orange.
 */
export const GhostColors = [
  { body: '#c8f04a', edge: '#7a9a17' }, // 0 the Chaser: fluoro lime, the high-vis kit
  { body: '#e8a317', edge: '#9c6c08' }, // 1 the Ambusher: amber
  { body: '#2f8ef0', edge: '#1a57ab' }, // 2 the Flanker: royal blue
  { body: '#c0397a', edge: '#7e2050' }, // 3 the Cutoff: plum
  { body: '#1fa8a0', edge: '#10635e' }, // 4 the Warden: teal
] as const;

// The skin table moved to the shared cosmetics package on 2026-09-16 (the
// hats' own move applied to the body): it lived here and again in the page's
// pitch-art.ts, kept value-for-value by hand, and the pattern drop would
// have doubled a duplicated table. These wrappers keep every import in the
// app working while the numbers live once, in shadeRgbFor.

export { SNAKE_SHADES };
export type { SkinArt };

/** The skin a wallet id resolves to; unknown ids and null wear classic. */
export function skinRamp(id: string | null): SkinArt {
  return skinFor(id);
}

/** rgb() string for body shade i of SNAKE_SHADES under one skin's ramp. */
export function snakeShadeFor(skin: string | null, i: number): string {
  const [r, g, b] = shadeRgbFor(skinFor(skin), i / (SNAKE_SHADES - 1));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}
