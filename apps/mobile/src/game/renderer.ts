/**
 * The Skia renderer: records one SkPicture per frame from engine state.
 *
 * A pure consumer of `@pitch-snake/engine`; nothing here decides gameplay. It
 * is the mobile twin of the web draw() in architecture as well as look: all
 * repeated art is pre-rendered ONCE into offscreen images (the web page's
 * rule 7), so a frame is a short run of drawImage calls whose count barely
 * changes when walls, portals or TNT waves arrive. That flatness is the
 * point: frame cost spikes come from drawing art out of primitives, and
 * primitives per frame are exactly what this file no longer does.
 *
 * Baked at cell-size change: the arena (fill + grid), 64 pre-tinted snake
 * body cells with the outline baked in, the five ghost bodies with eye
 * whites, the TNT block face, both portal ends. Baked on wall-phase events:
 * the whole wall layer (the web's rebuildWallLayer). Per frame the only
 * primitive draws left are the pupils, the bonus ring, and particles.
 * @module
 */
import {
  PaintStyle,
  Skia,
  StrokeCap,
  matchFont,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkPicture,
  type SkSurface,
} from '@shopify/react-native-skia';
import { PixelRatio, Platform } from 'react-native';

import {
  GRID,
  FOOD_TTL,
  PORTAL_OPEN_MS,
  PORTAL_WARN_MS,
  REDIRECT_MS,
  BOLT_LIFE_MS,
  ghostRenderPos,
  type Game,
} from '@pitch-snake/engine';

import { hatArt, paintBolt, paintJersey, paintPitch } from './pitch-art';
import { GameColors, GhostColors, SNAKE_SHADES, skinRamp, snakeShadeFor } from './theme';

/** Everything buildPicture needs besides the game itself. */
export interface RenderContext {
  /** Board edge length in device-independent pixels. */
  boardPx: number;
  /** The emoji atlas (6 columns of 128px cells; kinds 0-15 food, 16-20 bonus). */
  atlas: SkImage | null;
  /** Continuous animation clock in ms (drives pulses and spins). */
  pulseMs: number;
  /** True while the round is simulating (affects glide progress). */
  playing: boolean;
  /** What the snake wears; unknown or null ids dress classic. */
  worn: { skin: string | null; hat: string | null };
}

const ATLAS_CELL = 128;
const ATLAS_COLS = 6;
const BONUS_KIND_OFFSET = 16;

// Renderer-local PRNG for particle jitter only; particles are paint, never
// simulation, so the engine's seeded stream stays untouched.
let jitterState = 0x9e3779b9;
function jitter(): number {
  jitterState ^= jitterState << 13;
  jitterState ^= jitterState >>> 17;
  jitterState ^= jitterState << 5;
  return (jitterState >>> 0) / 4294967296;
}

/** One pooled burst particle. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const MAX_PARTICLES = 200;
const particles: Particle[] = [];

/** Clear the particle pool (new round). */
export function clearParticles(): void {
  particles.length = 0;
}

/**
 * Emit a ring burst at a grid cell: count, angular jitter, a speed range and
 * a color picker per particle, matching the web emitter's shape.
 */
export function spawnBurst(
  gx: number,
  gy: number,
  cellPx: number,
  count: number,
  angleJitter: number,
  speedMin: number,
  speedMax: number,
  colorOf: (i: number) => string,
): void {
  const cx = gx * cellPx + cellPx / 2;
  const cy = gy * cellPx + cellPx / 2;
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) return;
    const a = (Math.PI * 2 * i) / count + jitter() * angleJitter;
    const sp = speedMin + jitter() * (speedMax - speedMin);
    particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color: colorOf(i) });
  }
}

/** Advance and cull the particle pool by dt (ms), 60Hz-normalized. */
export function stepParticles(dtMs: number): void {
  const f = dtMs / 16.667;
  const damp = Math.pow(0.92, f);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p === undefined) continue;
    p.x += p.vx * f;
    p.y += p.vy * f;
    p.vx *= damp;
    p.vy *= damp;
    p.life -= 0.04 * f;
    if (p.life <= 0) {
      const last = particles[particles.length - 1];
      if (last !== undefined) particles[i] = last;
      particles.pop();
    }
  }
}

const wrapf = (v: number): number => ((v % GRID) + GRID) % GRID;

// shared paints; recording is single-threaded on the JS side
const fillPaint = Skia.Paint();
const strokePaint = Skia.Paint();
strokePaint.setStyle(PaintStyle.Stroke);

const C = {
  arena: Skia.Color(GameColors.arena),
  gridLine: Skia.Color(GameColors.gridLine),
  wall: Skia.Color(GameColors.wall),
  wallBevel: Skia.Color(GameColors.wallBevel),
  goldBright: Skia.Color(GameColors.goldBright),
  tntBody: Skia.Color(GameColors.tntBody),
  tntBandLight: Skia.Color(GameColors.tntBandLight),
  tntBandDark: Skia.Color(GameColors.tntBandDark),
  tntInk: Skia.Color('#111111'),
  ink: Skia.Color(GameColors.ink),
  snakeOutline: Skia.Color(GameColors.snakeOutline),
  white: Skia.Color('#ffffff'),
  ghostEye: Skia.Color(GameColors.ghostEye),
} as const;
const particleColorCache = new Map<string, SkColor>();
function particleColor(hex: string): SkColor {
  let c = particleColorCache.get(hex);
  if (c === undefined) {
    c = Skia.Color(hex);
    particleColorCache.set(hex, c);
  }
  return c;
}

// ---- the sprite bakery -----------------------------------------------------
// Everything below draws once into offscreen surfaces at device resolution
// and snapshots to images; per frame each sprite is a single drawImageRect.

const DPR = PixelRatio.get();

interface Baked {
  image: SkImage;
  /** dp width/height the sprite is meant to be drawn at (scale 1). */
  w: number;
  h: number;
}

function bake(w: number, h: number, draw: (canvas: SkCanvas) => void): Baked | null {
  const surface: SkSurface | null = Skia.Surface.MakeOffscreen(Math.ceil(w * DPR), Math.ceil(h * DPR));
  if (surface === null) return null;
  const canvas = surface.getCanvas();
  canvas.scale(DPR, DPR);
  draw(canvas);
  surface.flush();
  // The snapshot is texture-backed on THIS thread's GPU context; the picture
  // replays on the render thread's context, where foreign textures draw as
  // nothing. makeNonTextureImage raster-backs it, valid on any thread.
  const textureImage = surface.makeImageSnapshot();
  const image = textureImage.makeNonTextureImage();
  textureImage.dispose();
  surface.dispose();
  if (image === null) return null;
  return { image, w, h };
}

function drawBaked(canvas: SkCanvas, b: Baked, x: number, y: number, w?: number, h?: number): void {
  canvas.drawImageRect(
    b.image,
    Skia.XYWHRect(0, 0, b.image.width(), b.image.height()),
    Skia.XYWHRect(x, y, w ?? b.w, h ?? b.h),
    fillPaint,
  );
}

let bakedCell = 0;
let bakedBoard = 0;
let arenaSprite: Baked | null = null;
let snakeSprites: (Baked | null)[] = [];
let ghostSprites: (Baked | null)[] = [];
let ghostSpriteOriginY = 0;
let tntSprite: Baked | null = null;
let boltSprite: Baked | null = null;
let hatSprite: Baked | null = null;
let jerseySprite: Baked | null = null;
let hatDy = 0;
let bakedSkin: string | null = null;
let bakedHatId: string | null = null;
let portalSpriteA: Baked | null = null;
let portalSpriteB: Baked | null = null;
let wallSprite: Baked | null = null;

const tntFontFamily = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });

function bakeArena(boardPx: number): void {
  // pitch-art owns the whole look: grass, bands, glow, grid and chalk
  arenaSprite = bake(boardPx, boardPx, (c) => {
    paintPitch(c, boardPx);
  });
}

function bakeBolt(cell: number): Baked | null {
  const s = Math.ceil(cell * 1.7);
  return bake(s, s, (c) => {
    paintBolt(c, s, cell);
  });
}

function bakeSnakeCells(cell: number, skin: string | null): void {
  const r = cell * 0.42;
  const rad = cell * 0.32;
  const lw = Math.max(1, cell * 0.05);
  const s = r * 2 + lw + 2;
  const outline = Skia.Color(skinRamp(skin).line);
  for (const old of snakeSprites) old?.image.dispose();
  snakeSprites = [];
  for (let i = 0; i < SNAKE_SHADES; i++) {
    const color = Skia.Color(snakeShadeFor(skin, i));
    snakeSprites.push(
      bake(s, s, (c) => {
        const rect = Skia.RRectXY(Skia.XYWHRect(s / 2 - r, s / 2 - r, r * 2, r * 2), rad, rad);
        fillPaint.setColor(color);
        c.drawRRect(rect, fillPaint);
        strokePaint.setColor(outline);
        strokePaint.setStrokeWidth(lw);
        c.drawRRect(rect, strokePaint);
      }),
    );
  }
}

function bakeOutfit(cell: number, hatId: string | null): void {
  const art = hatArt(hatId);
  const w = Math.ceil(cell * art.wf);
  const h = Math.ceil(cell * art.hf);
  hatSprite?.image.dispose();
  hatSprite = bake(w, h, (c) => {
    art.draw(c, w, h);
  });
  hatDy = art.dy(cell, h);
  const js = Math.ceil(cell * 0.84);
  jerseySprite?.image.dispose();
  jerseySprite = bake(js, js, (c) => {
    paintJersey(c, js);
  });
}

function bakeGhosts(cell: number): void {
  const r = cell * 0.4;
  const lw = Math.max(1, cell * 0.045);
  const w = 2 * r + lw + 4;
  const h = 2.16 * r + lw + 4;
  ghostSpriteOriginY = 1.16 * r + lw / 2 + 2;
  for (const old of ghostSprites) old?.image.dispose();
  ghostSprites = GhostColors.map((col) =>
    bake(w, h, (c) => {
      const gx = w / 2;
      const gy = ghostSpriteOriginY;
      const domeY = -r * 0.16;
      const path = Skia.Path.Make();
      path.addArc(Skia.XYWHRect(gx - r, gy + domeY - r, r * 2, r * 2), 180, 180);
      path.lineTo(gx + r, gy + r);
      const n = 4;
      const step = (2 * r) / n;
      let x = gx + r;
      for (let i = 0; i < n; i++) {
        path.lineTo(x - step / 2, gy + r - r * 0.42);
        path.lineTo(x - step, gy + r);
        x -= step;
      }
      path.lineTo(gx - r, gy + domeY);
      path.close();
      fillPaint.setColor(Skia.Color(col.body));
      c.drawPath(path, fillPaint);
      strokePaint.setColor(Skia.Color(col.edge));
      strokePaint.setStrokeWidth(lw);
      c.drawPath(path, strokePaint);
      // eye whites are direction-independent, so they bake in; pupils stay live
      const eyeDX = r * 0.42;
      const eyeY = gy + domeY - r * 0.03;
      const ewx = r * 0.28;
      const ewy = r * 0.36;
      fillPaint.setColor(C.white);
      for (let sx = -1; sx <= 1; sx += 2) {
        c.drawOval(Skia.XYWHRect(gx + sx * eyeDX - ewx, eyeY - ewy, ewx * 2, ewy * 2), fillPaint);
      }
    }),
  );
}

function bakeTnt(cell: number): void {
  const B = cell * 0.9;
  const fontSize = Math.round(cell * 0.27);
  const font = matchFont({ fontFamily: tntFontFamily, fontSize, fontWeight: 'bold' });
  const labelWidth = font.measureText('TNT').width;
  tntSprite?.image.dispose();
  tntSprite = bake(B, B, (c) => {
    fillPaint.setColor(C.tntBody);
    c.drawRect(Skia.XYWHRect(0, 0, B, B), fillPaint);
    fillPaint.setColor(C.tntBandLight);
    c.drawRect(Skia.XYWHRect(0, B * 0.32, B, B * 0.26), fillPaint);
    fillPaint.setColor(C.tntBandDark);
    c.drawRect(Skia.XYWHRect(0, B * 0.58, B, B * 0.08), fillPaint);
    fillPaint.setColor(C.tntInk);
    c.drawText('TNT', (B - labelWidth) / 2, B * 0.45 + fontSize * 0.36, fillPaint, font);
  });
}

function bakePortalEnd(cell: number, rim: string, hot: string, deep: string, core: string): Baked | null {
  const R = cell * 0.48;
  const s = cell * 1.9; // room for the halo
  return bake(s, s, (c) => {
    const m = s / 2;
    fillPaint.setColor(Skia.Color(hot));
    fillPaint.setAlphaf(0.18);
    c.drawCircle(m, m, R * 1.55, fillPaint);
    fillPaint.setAlphaf(1);
    fillPaint.setColor(Skia.Color(deep));
    c.drawCircle(m, m, R, fillPaint);
    strokePaint.setColor(Skia.Color(rim));
    strokePaint.setStrokeWidth(Math.max(2, cell * 0.12));
    strokePaint.setStrokeCap(StrokeCap.Round);
    const box = Skia.XYWHRect(m - R, m - R, R * 2, R * 2);
    for (let i = 0; i < 4; i++) c.drawArc(box, i * 90 + 14, 62, false, strokePaint);
    strokePaint.setStrokeWidth(Math.max(1, cell * 0.05));
    strokePaint.setAlphaf(0.7);
    const box2 = Skia.XYWHRect(m - R * 0.66, m - R * 0.66, R * 1.32, R * 1.32);
    for (let i = 0; i < 4; i++) c.drawArc(box2, i * 90 + 62, 55, false, strokePaint);
    strokePaint.setAlphaf(1);
    fillPaint.setColor(Skia.Color(deep));
    c.drawCircle(m, m, R * 0.36, fillPaint);
    fillPaint.setColor(Skia.Color(core));
    c.drawCircle(m, m, R * 0.28, fillPaint);
  });
}

function ensureSprites(boardPx: number, worn?: RenderContext['worn']): void {
  const cell = boardPx / GRID;
  const skin = worn?.skin ?? bakedSkin;
  const hatId = worn?.hat ?? bakedHatId;
  if (boardPx !== bakedBoard) {
    bakedBoard = boardPx;
    arenaSprite?.image.dispose();
    bakeArena(boardPx);
  }
  // the outfit rebakes on its own key: an equip at menu time swaps the
  // sprites without waiting for a resize, exactly like the web's applyWorn
  if (cell === bakedCell && skin !== bakedSkin) {
    bakedSkin = skin;
    bakeSnakeCells(cell, skin);
  }
  if (cell === bakedCell && hatId !== bakedHatId) {
    bakedHatId = hatId;
    bakeOutfit(cell, hatId);
  }
  if (cell !== bakedCell) {
    bakedCell = cell;
    bakedSkin = skin;
    bakedHatId = hatId;
    bakeSnakeCells(cell, skin);
    bakeOutfit(cell, hatId);
    bakeGhosts(cell);
    bakeTnt(cell);
    boltSprite?.image.dispose();
    boltSprite = bakeBolt(cell);
    portalSpriteA?.image.dispose();
    portalSpriteB?.image.dispose();
    portalSpriteA = bakePortalEnd(
      cell,
      GameColors.portalARim,
      GameColors.portalA,
      GameColors.portalADeep,
      GameColors.portalB,
    );
    portalSpriteB = bakePortalEnd(
      cell,
      GameColors.portalBRim,
      GameColors.portalB,
      GameColors.portalBDeep,
      GameColors.portalA,
    );
    // shape-dependent; rebaked from the wall event with the live game
    wallSprite?.image.dispose();
    wallSprite = null;
  }
}

/**
 * Bake the current wall shape into a single layer image (the web page's
 * rebuildWallLayer). Call on 'wall' events: bevel=false when the shape
 * forms, bevel=true when it turns solid. Nothing draws when the state is
 * 'off', so clearing is implicit.
 */
export function bakeWallLayer(game: Game, boardPx: number, bevel: boolean): void {
  ensureSprites(boardPx);
  const cell = boardPx / GRID;
  wallSprite?.image.dispose();
  wallSprite = bake(boardPx, boardPx, (c) => {
    const pad = cell * 0.05;
    const rad = cell * 0.3;
    fillPaint.setColor(C.wall);
    for (const w of game.wallCells) {
      c.drawRRect(
        Skia.RRectXY(
          Skia.XYWHRect(w.x * cell + pad, w.y * cell + pad, cell - pad * 2, cell - pad * 2),
          rad,
          rad,
        ),
        fillPaint,
      );
    }
    if (bevel) {
      const ip = cell * 0.28;
      fillPaint.setColor(C.wallBevel);
      fillPaint.setAlphaf(0.22);
      for (const w of game.wallCells) {
        c.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(w.x * cell + ip, w.y * cell + ip, cell - ip * 2, cell - ip * 2),
            cell * 0.14,
            cell * 0.14,
          ),
          fillPaint,
        );
      }
      fillPaint.setAlphaf(1);
    }
  });
}

/** Drop the baked wall layer (round reset). */
export function clearWallLayer(): void {
  wallSprite?.image.dispose();
  wallSprite = null;
}

// ---- the frame -------------------------------------------------------------

// segment glide, ported from the web segRenderPos: interpolate from the cell
// behind, shortest way through tunnels, snap ends across a teleport hop
const _rp = { cx: 0, cy: 0 };
function segRenderPos(game: Game, i: number, p: number): { cx: number; cy: number } {
  const s = game.snake[i];
  if (s === undefined) return _rp;
  // rule 25: a hanging move is drawn as if it had committed: every segment
  // glides toward the one ahead (the head toward the fatal cell), so no gap
  // opens behind the head. A save or a pardon commits onto this exact
  // geometry (no seam), and a death freezes the whole body mid-stride.
  if (game.doom !== null) {
    // a hanging move only ever gets REDIRECT_MS of the tick, so its glide
    // stops there: past that the head would be drawn a whole cell inside the
    // wall the moment the round stops being 'playing' and p arrives as 1
    const cap = REDIRECT_MS / (game.players[0]?.tickMs ?? game.tickMs);
    if (p > cap) p = cap;
    if (i === game.snake.length - 1 && game.pendingGrowth > 0) {
      _rp.cx = s.x;
      _rp.cy = s.y; // a growing tail would have stayed
      return _rp;
    }
    const aheadSeg = i === 0 ? null : game.snake[i - 1];
    const ax = aheadSeg === null || aheadSeg === undefined ? game.doom.tx : aheadSeg.x;
    const ay = aheadSeg === null || aheadSeg === undefined ? game.doom.ty : aheadSeg.y;
    let dx = ax - s.x;
    let dy = ay - s.y;
    if (dx > 1) dx -= GRID;
    else if (dx < -1) dx += GRID;
    if (dy > 1) dy -= GRID;
    else if (dy < -1) dy += GRID;
    if (dx > 1 || dx < -1 || dy > 1 || dy < -1) {
      // mid-hop pair: snap (rule 19)
      _rp.cx = p < 0.5 ? s.x : ax;
      _rp.cy = p < 0.5 ? s.y : ay;
      return _rp;
    }
    _rp.cx = s.x + dx * p;
    _rp.cy = s.y + dy * p;
    return _rp;
  }
  const behind = game.snake[i + 1];
  const prev = behind ?? game.tailFrom ?? s;
  let dx = s.x - prev.x;
  let dy = s.y - prev.y;
  if (dx > 1) dx -= GRID;
  else if (dx < -1) dx += GRID;
  if (dy > 1) dy -= GRID;
  else if (dy < -1) dy += GRID;
  if (dx > 1 || dx < -1 || dy > 1 || dy < -1) {
    const at = p < 0.5 ? prev : s;
    _rp.cx = at.x;
    _rp.cy = at.y;
    return _rp;
  }
  _rp.cx = prev.x + dx * p;
  _rp.cy = prev.y + dy * p;
  return _rp;
}

function drawSegmentSprite(canvas: SkCanvas, sprite: Baked, cx: number, cy: number, cell: number): void {
  const x = cx * cell + cell / 2 - sprite.w / 2;
  const y = cy * cell + cell / 2 - sprite.h / 2;
  drawBaked(canvas, sprite, x, y);
  const wx =
    cx < 0 ? cx + GRID
    : cx > GRID - 1 ? cx - GRID
    : null;
  const wy =
    cy < 0 ? cy + GRID
    : cy > GRID - 1 ? cy - GRID
    : null;
  if (wx !== null) drawBaked(canvas, sprite, wx * cell + cell / 2 - sprite.w / 2, y);
  if (wy !== null) drawBaked(canvas, sprite, x, wy * cell + cell / 2 - sprite.h / 2);
  if (wx !== null && wy !== null)
    drawBaked(canvas, sprite, wx * cell + cell / 2 - sprite.w / 2, wy * cell + cell / 2 - sprite.h / 2);
}

function drawGhost(
  canvas: SkCanvas,
  index: number,
  cx: number,
  cy: number,
  look: { x: number; y: number },
  bob: number,
  cell: number,
  /** Phase of this ghost's stagger while a bolt is in effect; null when sober. */
  ph: number | null,
): void {
  const sprite = ghostSprites[index % ghostSprites.length];
  if (sprite === null || sprite === undefined) return;
  const sway = ph === null ? 0 : Math.sin(ph) * cell * 0.09;
  const gx = cx * cell + cell / 2 + sway;
  const gy = cy * cell + cell / 2 + bob;
  const r = cell * 0.4;
  if (ph !== null) {
    // the dizzy halo, riding clear above the head with two sparks going round
    const ringY = gy - r * 1.35;
    const rx = r * 0.72;
    const ry = r * 0.26;
    strokePaint.setColor(Skia.Color('#eaf6ff'));
    strokePaint.setStrokeWidth(Math.max(1.5, cell * 0.055));
    strokePaint.setAlphaf(0.75 + Math.sin(ph * 1.3) * 0.2);
    canvas.drawOval(Skia.XYWHRect(gx - rx, ringY - ry, rx * 2, ry * 2), strokePaint);
    strokePaint.setAlphaf(1);
    fillPaint.setColor(Skia.Color('#fff6c9'));
    for (let k = 0; k < 2; k++) {
      const a = ph * 2.1 + k * Math.PI;
      fillPaint.setAlphaf(0.55 + Math.sin(a) * 0.4);
      canvas.drawCircle(gx + Math.cos(a) * rx, ringY + Math.sin(a) * ry, cell * 0.06, fillPaint);
    }
    fillPaint.setAlphaf(1);
  }
  drawBaked(canvas, sprite, gx - sprite.w / 2, gy - ghostSpriteOriginY);
  const eyeDX = r * 0.42;
  const eyeY = gy - r * 0.16 - r * 0.03;
  const ewx = r * 0.28;
  const ewy = r * 0.36;
  fillPaint.setColor(C.ghostEye);
  for (let sx = -1; sx <= 1; sx += 2) {
    if (ph !== null) {
      // pupils roll on their own orbits, out of step with each other, and
      // drift inward so they cross
      const a = ph * (sx > 0 ? 1.4 : -1.1) + (sx > 0 ? 0 : 2.2);
      canvas.drawCircle(
        gx + sx * eyeDX + Math.cos(a) * ewx * 0.5 - sx * ewx * 0.35,
        eyeY + Math.sin(a * 1.3) * ewy * 0.45,
        r * 0.15,
        fillPaint,
      );
      continue;
    }
    canvas.drawCircle(gx + sx * eyeDX + look.x * ewx * 0.55, eyeY + look.y * ewy * 0.5, r * 0.16, fillPaint);
  }
}

/**
 * Record one frame of the field. Pure read of the game and the particle
 * pool; the only per-frame primitives are pupils, the bonus ring and
 * particles - everything else is a baked image.
 */
export function buildPicture(game: Game, rc: RenderContext): SkPicture {
  ensureSprites(rc.boardPx, rc.worn);
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, rc.boardPx, rc.boardPx));
  const cell = rc.boardPx / GRID;
  const now = game.renderNow();

  if (arenaSprite !== null) drawBaked(canvas, arenaSprite, 0, 0);

  // walls: one image, alpha animated per frame
  if (game.wallState !== 'off' && wallSprite !== null) {
    const warning = game.wallState === 'warning';
    const blinkOn = ((now / 150) | 0) % 2 === 0;
    fillPaint.setAlphaf(
      warning ?
        blinkOn ? 0.5
        : 0.12
      : 0.94 + Math.sin(now / 120) * 0.06,
    );
    drawBaked(canvas, wallSprite, 0, 0);
    fillPaint.setAlphaf(1);
  }

  // portals: one image per end, scaled open, spun, dimmed once spent
  if (game.portal !== null && portalSpriteA !== null && portalSpriteB !== null) {
    const age = now - game.portalOpenedAt;
    const t = age < PORTAL_OPEN_MS ? age / PORTAL_OPEN_MS : 1;
    const open = 1 - (1 - t) * (1 - t) * (1 - t);
    const near = now > game.portalExpireAt - PORTAL_WARN_MS;
    const dim =
      game.portal.used ? 0.42
      : near && ((now / 130) | 0) % 2 !== 0 ? 0.3
      : 1;
    const sc = open * (1 + Math.sin(rc.pulseMs * 0.0048 * 1.3) * 0.05);
    const spin = ((rc.pulseMs * 0.0048 * 0.5 * 180) / Math.PI) % 360;
    const ends: [Baked, number, number, number][] = [
      [portalSpriteA, game.portal.ax, game.portal.ay, spin],
      [portalSpriteB, game.portal.bx, game.portal.by, -spin],
    ];
    fillPaint.setAlphaf(dim);
    for (const [sprite, gx, gy, angle] of ends) {
      const px = gx * cell + cell / 2;
      const py = gy * cell + cell / 2;
      const d = sprite.w * sc;
      canvas.save();
      canvas.translate(px, py);
      canvas.rotate(angle, 0, 0);
      drawBaked(canvas, sprite, -d / 2, -d / 2, d, d);
      canvas.restore();
    }
    fillPaint.setAlphaf(1);
  }

  // food: atlas sprite with the pulse; gold ring on a bonus
  const pulse = 1 + Math.sin(rc.pulseMs * 0.0048) * 0.12;
  const food = game.food;
  const fx = food.x * cell + cell / 2;
  const fy = food.y * cell + cell / 2;
  const foodDim = food.bonus && game.foodAge > FOOD_TTL - 1500 && ((game.foodAge / 130) | 0) % 2 !== 0;
  const foodAlpha = foodDim ? 0.28 : 1;
  if (food.bonus) {
    strokePaint.setColor(C.goldBright);
    strokePaint.setStrokeWidth(Math.max(2, cell * 0.08));
    strokePaint.setAlphaf(foodAlpha);
    canvas.drawCircle(fx, fy, cell * 0.5 * pulse, strokePaint);
    strokePaint.setAlphaf(1);
  }
  if (rc.atlas !== null) {
    const kind = food.kind + (food.bonus ? BONUS_KIND_OFFSET : 0);
    const sx = (kind % ATLAS_COLS) * ATLAS_CELL;
    const sy = ((kind / ATLAS_COLS) | 0) * ATLAS_CELL;
    const d = cell * 1.02 * pulse;
    fillPaint.setAlphaf(foodAlpha);
    canvas.drawImageRect(
      rc.atlas,
      Skia.XYWHRect(sx, sy, ATLAS_CELL, ATLAS_CELL),
      Skia.XYWHRect(fx - d / 2, fy - d / 2, d, d),
      fillPaint,
    );
    fillPaint.setAlphaf(1);
  }

  // The bolt, baked in pitch-art with its halo: bake-time work, so the
  // frame only blits it on its own heartbeat, blinking as its life runs
  // out like the web.
  const bolt = game.bolt;
  if (bolt !== null && boltSprite !== null) {
    const bx = bolt.x * cell + cell / 2;
    const by = bolt.y * cell + cell / 2;
    const left = bolt.bornAt + BOLT_LIFE_MS - game.clockMs;
    const blink = left < 1500 && ((game.clockMs / 110) | 0) % 2 !== 0;
    const beat = 1 + Math.sin(game.clockMs / 150) * 0.12;
    const d = boltSprite.w * beat;
    fillPaint.setAlphaf(blink ? 0.35 : 1);
    drawBaked(canvas, boltSprite, bx - d / 2, by - d / 2, d, d);
    fillPaint.setAlphaf(1);
  }

  // TNT: one image per block; wave blink via alpha, pulse via dst size
  if (game.bombs.length > 0 && tntSprite !== null) {
    const tntPulse = 1 + Math.sin(rc.pulseMs * 0.0048 * 1.15) * 0.09;
    const nearGone = game.bombPhase === 'active' && now > game.bombExpireAt - 1200;
    const blinkOn = nearGone ? ((now / 120) | 0) % 2 === 0 : true;
    const d = tntSprite.w * tntPulse;
    fillPaint.setAlphaf(blinkOn ? 1 : 0.4);
    for (const b of game.bombs) {
      drawBaked(canvas, tntSprite, b.x * cell + (cell - d) / 2, b.y * cell + (cell - d) / 2, d, d);
    }
    fillPaint.setAlphaf(1);
  }

  // the snake: one pre-tinted image per segment (outline baked in)
  const denom = Math.max(1, game.snake.length - 1);
  // per snake: a rival dragged by a bolt is on a longer step than you are
  const p = rc.playing ? game.renderProg() : 1;
  for (let i = game.snake.length - 1; i >= 0; i--) {
    const shade = ((i * (SNAKE_SHADES - 1)) / denom) | 0;
    const sprite = snakeSprites[shade];
    if (sprite === null || sprite === undefined) continue;
    const rp = segRenderPos(game, i, p);
    drawSegmentSprite(canvas, sprite, rp.cx, rp.cy, cell);
  }

  // the shirt on the square behind the head, upright like the hat
  if (jerseySprite !== null && game.snake.length > 1) {
    const rp1 = segRenderPos(game, 1, p);
    const jx = wrapf(rp1.cx) * cell + cell / 2;
    const jy = wrapf(rp1.cy) * cell + cell / 2;
    drawBaked(canvas, jerseySprite, Math.round(jx - jerseySprite.w / 2), Math.round(jy - jerseySprite.h / 2));
  }

  // eyes on the head, at its interpolated position
  if (game.snake.length > 0) {
    const rp = segRenderPos(game, 0, p);
    const hx = wrapf(rp.cx) * cell + cell / 2;
    const hy = wrapf(rp.cy) * cell + cell / 2;
    const off = cell * 0.16;
    const ex = game.dir.x;
    const ey = game.dir.y;
    const px = ey;
    const py = ex;
    fillPaint.setColor(C.ink);
    canvas.drawCircle(hx + ex * off + px * off, hy + ey * off + py * off, cell * 0.08, fillPaint);
    canvas.drawCircle(hx + ex * off - px * off, hy + ey * off - py * off, cell * 0.08, fillPaint);
    // the hat rides the head, upright whichever way the snake is going
    if (hatSprite !== null) {
      drawBaked(canvas, hatSprite, Math.round(hx - hatSprite.w / 2), Math.round(hy + hatDy));
    }
  }

  // ghosts: baked body + live pupils, tunnel copies like the web
  const bob = Math.sin(rc.pulseMs * 0.0048 * 1.1) * cell * 0.03;
  const scratch = { cx: 0, cy: 0 };
  for (let i = 0; i < game.ghosts.length; i++) {
    const gh = game.ghosts[i];
    if (gh === undefined) continue;
    const pos = ghostRenderPos(gh, now, scratch);
    const wx =
      pos.cx < 0 ? pos.cx + GRID
      : pos.cx > GRID - 1 ? pos.cx - GRID
      : null;
    const wy =
      pos.cy < 0 ? pos.cy + GRID
      : pos.cy > GRID - 1 ? pos.cy - GRID
      : null;
    // a ghost that has taken a bolt to the face lurches on its own phase,
    // or the whole pack sways like a chorus line
    const ph = game.slowUntil > now ? now / 260 + i * 1.9 : null;
    const lurch = ph === null ? bob : bob + Math.sin(ph * 1.7) * cell * 0.05;
    drawGhost(canvas, i, pos.cx, pos.cy, gh.dir, lurch, cell, ph);
    if (wx !== null) drawGhost(canvas, i, wx, pos.cy, gh.dir, lurch, cell, ph);
    if (wy !== null) drawGhost(canvas, i, pos.cx, wy, gh.dir, lurch, cell, ph);
    if (wx !== null && wy !== null) drawGhost(canvas, i, wx, wy, gh.dir, lurch, cell, ph);
  }

  // particles
  for (const pt of particles) {
    fillPaint.setColor(particleColor(pt.color));
    fillPaint.setAlphaf(Math.max(0, pt.life));
    canvas.drawCircle(pt.x, pt.y, cell * 0.1 * pt.life, fillPaint);
  }
  fillPaint.setAlphaf(1);

  return recorder.finishRecordingAsPicture();
}
