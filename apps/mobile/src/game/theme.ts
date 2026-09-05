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

/** rgb() string for body shade i of SNAKE_SHADES. */
export function snakeShade(i: number): string {
  const t = i / (SNAKE_SHADES - 1);
  const r = (244 - t * 30) | 0;
  const g = (236 - t * 40) | 0;
  const b = (216 - t * 58) | 0;
  return `rgb(${r}, ${g}, ${b})`;
}
