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
} as const satisfies Record<string, { head: number[]; tail: number[]; line: string }>;

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
  const r = ramp.head[0] + (ramp.tail[0] - ramp.head[0]) * t;
  const g = ramp.head[1] + (ramp.tail[1] - ramp.head[1]) * t;
  const b = ramp.head[2] + (ramp.tail[2] - ramp.head[2]) * t;
  return `rgb(${String(r | 0)}, ${String(g | 0)}, ${String(b | 0)})`;
}
