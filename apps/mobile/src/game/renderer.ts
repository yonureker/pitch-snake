/**
 * The Skia renderer: records one SkPicture per frame from engine state.
 *
 * This is a pure consumer of `@pitch-snake/engine` - nothing here decides
 * gameplay. It is the mobile twin of the web page's draw(): same layering
 * (arena, walls, portals, food, TNT, snake, ghosts, particles), same
 * interpolation rules (renderProg for the glide, half-step snapping across a
 * teleport hop), same palette. Recording happens on the JS thread into a
 * picture that the Canvas replays natively; per-sprite work inside one
 * recording costs no JSI crossings, which is the pattern that benchmarks well
 * into the hundreds of sprites.
 * @module
 */
import {
  PaintStyle,
  Skia,
  StrokeCap,
  matchFont,
  type SkCanvas,
  type SkColor,
  type SkFont,
  type SkImage,
  type SkPicture,
} from '@shopify/react-native-skia';
import { Platform } from 'react-native';

import {
  GRID,
  FOOD_TTL,
  PORTAL_OPEN_MS,
  PORTAL_WARN_MS,
  ghostRenderPos,
  type Cell,
  type Game,
} from '@pitch-snake/engine';

import { GameColors, GhostColors, SNAKE_SHADES, snakeShade } from './theme';

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
}

const ATLAS_CELL = 128;
const ATLAS_COLS = 6;
const BONUS_KIND_OFFSET = 16;

// Renderer-local PRNG for particle jitter only. Deliberately NOT the engine's
// seeded stream: particles are paint, never simulation, and the app-side lint
// ban on Math.random exists to keep gameplay out of components, not to make
// confetti deterministic.
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
 * Emit a ring burst at a grid cell, matching the web emitter's shape:
 * count, angular jitter, speed range and a color picker per particle.
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

/** Advance and cull the particle pool by dt (ms), 60Hz-normalized like the web. */
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

// paints and fonts are module-level and reused; recording shares them safely
// because recording is single-threaded on the JS side
const fillPaint = Skia.Paint();
const layerPaint = Skia.Paint();
function saveLayerAlpha(canvas: SkCanvas, alpha: number): void {
  layerPaint.setAlphaf(alpha);
  canvas.saveLayer(layerPaint);
}
const strokePaint = Skia.Paint();
strokePaint.setStyle(PaintStyle.Stroke);

const snakeColors: SkColor[] = [];
for (let i = 0; i < SNAKE_SHADES; i++) snakeColors.push(Skia.Color(snakeShade(i)));

const tntFontFamily = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
let tntFont: SkFont | null = null;
let tntFontSize = 0;

// segment glide, ported from the web segRenderPos: interpolate from the cell
// behind, shortest way through tunnels, and snap ends across a teleport hop
// at the half-way point of the step (engine rule 18)
const _rp = { cx: 0, cy: 0 };
function segRenderPos(game: Game, i: number, p: number): { cx: number; cy: number } {
  const s = game.snake[i];
  if (s === undefined) return _rp;
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

function drawRoundCellAt(
  canvas: SkCanvas,
  cxCell: number,
  cyCell: number,
  cell: number,
  r: number,
  rad: number,
): void {
  const x = cxCell * cell + cell / 2;
  const y = cyCell * cell + cell / 2;
  const rect = Skia.RRectXY(Skia.XYWHRect(x - r, y - r, r * 2, r * 2), rad, rad);
  canvas.drawRRect(rect, fillPaint);
  canvas.drawRRect(rect, strokePaint);
}

function drawBodyCell(canvas: SkCanvas, cx: number, cy: number, cell: number, r: number, rad: number): void {
  drawRoundCellAt(canvas, cx, cy, cell, r, rad);
  const wx =
    cx < 0 ? cx + GRID
    : cx > GRID - 1 ? cx - GRID
    : null;
  const wy =
    cy < 0 ? cy + GRID
    : cy > GRID - 1 ? cy - GRID
    : null;
  if (wx !== null) drawRoundCellAt(canvas, wx, cy, cell, r, rad);
  if (wy !== null) drawRoundCellAt(canvas, cx, wy, cell, r, rad);
  if (wx !== null && wy !== null) drawRoundCellAt(canvas, wx, wy, cell, r, rad);
}

function ghostPath(cell: number): ReturnType<typeof Skia.Path.Make> {
  // the classic dome + zig-zag skirt, in cell-local coords centered on (0, 0)
  const r = cell * 0.4;
  const domeY = -r * 0.16;
  const path = Skia.Path.Make();
  path.addArc(Skia.XYWHRect(-r, domeY - r, r * 2, r * 2), 180, 180);
  path.lineTo(r, r);
  const n = 4;
  const step = (2 * r) / n;
  let x = r;
  for (let i = 0; i < n; i++) {
    path.lineTo(x - step / 2, r - r * 0.42);
    path.lineTo(x - step, r);
    x -= step;
  }
  path.lineTo(-r, domeY);
  path.close();
  return path;
}

let ghostPathCache: ReturnType<typeof Skia.Path.Make> | null = null;
let ghostPathCell = 0;

function drawGhostBody(
  canvas: SkCanvas,
  cxCell: number,
  cyCell: number,
  look: Cell,
  colorIndex: number,
  bob: number,
  cell: number,
): void {
  const color = GhostColors[colorIndex % GhostColors.length] ?? GhostColors[0];
  const r = cell * 0.4;
  const gx = cxCell * cell + cell / 2;
  const gy = cyCell * cell + cell / 2 + bob;
  if (ghostPathCache === null || ghostPathCell !== cell) {
    ghostPathCache = ghostPath(cell);
    ghostPathCell = cell;
  }
  canvas.save();
  canvas.translate(gx, gy);
  fillPaint.setColor(Skia.Color(color.body));
  canvas.drawPath(ghostPathCache, fillPaint);
  strokePaint.setColor(Skia.Color(color.edge));
  strokePaint.setStrokeWidth(Math.max(1, cell * 0.045));
  canvas.drawPath(ghostPathCache, strokePaint);
  // eyes: whites plus pupils tracking the travel direction
  const eyeDX = r * 0.42;
  const eyeY = -r * 0.16 - r * 0.03;
  const ewx = r * 0.28;
  const ewy = r * 0.36;
  fillPaint.setColor(Skia.Color('#ffffff'));
  for (let sx = -1; sx <= 1; sx += 2) {
    canvas.drawOval(Skia.XYWHRect(sx * eyeDX - ewx, eyeY - ewy, ewx * 2, ewy * 2), fillPaint);
  }
  fillPaint.setColor(Skia.Color(GameColors.ghostEye));
  for (let sx = -1; sx <= 1; sx += 2) {
    canvas.drawCircle(sx * eyeDX + look.x * ewx * 0.55, eyeY + look.y * ewy * 0.5, r * 0.16, fillPaint);
  }
  canvas.restore();
}

function drawPortalEnd(
  canvas: SkCanvas,
  gx: number,
  gy: number,
  cell: number,
  scale: number,
  angle: number,
  rim: string,
  hot: string,
  deep: string,
  core: string,
): void {
  const R = cell * 0.48 * scale;
  if (R <= 0) return;
  const cx = gx * cell + cell / 2;
  const cy = gy * cell + cell / 2;
  canvas.save();
  canvas.translate(cx, cy);
  canvas.rotate((angle * 180) / Math.PI, 0, 0);
  // soft halo
  fillPaint.setColor(Skia.Color(hot));
  fillPaint.setAlphaf(0.18);
  canvas.drawCircle(0, 0, R * 1.55, fillPaint);
  fillPaint.setAlphaf(1);
  // the well
  fillPaint.setColor(Skia.Color(deep));
  canvas.drawCircle(0, 0, R, fillPaint);
  // segmented rim arcs
  strokePaint.setColor(Skia.Color(rim));
  strokePaint.setStrokeWidth(Math.max(2, cell * 0.12));
  strokePaint.setStrokeCap(StrokeCap.Round);
  const box = Skia.XYWHRect(-R, -R, R * 2, R * 2);
  for (let i = 0; i < 4; i++) {
    const a0 = i * 90 + 14;
    canvas.drawArc(box, a0, 62, false, strokePaint);
  }
  // inner offset ring
  strokePaint.setStrokeWidth(Math.max(1, cell * 0.05));
  strokePaint.setAlphaf(0.7);
  const box2 = Skia.XYWHRect(-R * 0.66, -R * 0.66, R * 1.32, R * 1.32);
  for (let i = 0; i < 4; i++) {
    const a0 = i * 90 + 62;
    canvas.drawArc(box2, a0, 55, false, strokePaint);
  }
  strokePaint.setAlphaf(1);
  // the partner-colored core: where this end lands you
  fillPaint.setColor(Skia.Color(deep));
  canvas.drawCircle(0, 0, R * 0.36, fillPaint);
  fillPaint.setColor(Skia.Color(core));
  canvas.drawCircle(0, 0, R * 0.28, fillPaint);
  canvas.restore();
}

/**
 * Record one frame of the field as an SkPicture. Pure read of the game plus
 * the particle pool; never mutates gameplay state.
 */
export function buildPicture(game: Game, rc: RenderContext): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, rc.boardPx, rc.boardPx));
  const cell = rc.boardPx / GRID;
  const now = game.renderNow();

  // arena: flat fill plus the faint grid
  fillPaint.setColor(Skia.Color(GameColors.arena));
  canvas.drawRect(Skia.XYWHRect(0, 0, rc.boardPx, rc.boardPx), fillPaint);
  strokePaint.setColor(Skia.Color(GameColors.gridLine));
  strokePaint.setStrokeWidth(1);
  strokePaint.setStrokeCap(StrokeCap.Butt);
  for (let i = 1; i < GRID; i++) {
    canvas.drawLine(i * cell, 0, i * cell, rc.boardPx, strokePaint);
    canvas.drawLine(0, i * cell, rc.boardPx, i * cell, strokePaint);
  }

  // interior walls: ghostly blink while forming, solid pulse when live
  if (game.wallState !== 'off' && game.wallCells.length > 0) {
    const warning = game.wallState === 'warning';
    const blinkOn = ((now / 150) | 0) % 2 === 0;
    const alpha =
      warning ?
        blinkOn ? 0.5
        : 0.12
      : 0.94 + Math.sin(now / 120) * 0.06;
    const pad = cell * 0.05;
    const rad = cell * 0.3;
    fillPaint.setColor(Skia.Color(GameColors.wall));
    fillPaint.setAlphaf(alpha);
    for (const w of game.wallCells) {
      canvas.drawRRect(
        Skia.RRectXY(
          Skia.XYWHRect(w.x * cell + pad, w.y * cell + pad, cell - pad * 2, cell - pad * 2),
          rad,
          rad,
        ),
        fillPaint,
      );
    }
    if (!warning) {
      const ip = cell * 0.28;
      fillPaint.setColor(Skia.Color(GameColors.wallBevel));
      fillPaint.setAlphaf(0.22 * alpha);
      for (const w of game.wallCells) {
        canvas.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(w.x * cell + ip, w.y * cell + ip, cell - ip * 2, cell - ip * 2),
            cell * 0.14,
            cell * 0.14,
          ),
          fillPaint,
        );
      }
    }
    fillPaint.setAlphaf(1);
  }

  // teleport windows: scale open, spin, dim once spent, blink before timeout
  if (game.portal !== null) {
    const age = now - game.portalOpenedAt;
    const t = age < PORTAL_OPEN_MS ? age / PORTAL_OPEN_MS : 1;
    const open = 1 - (1 - t) * (1 - t) * (1 - t);
    const near = now > game.portalExpireAt - PORTAL_WARN_MS;
    const dim =
      game.portal.used ? 0.42
      : near && ((now / 130) | 0) % 2 !== 0 ? 0.3
      : 1;
    const sc = open * (1 + Math.sin(rc.pulseMs * 0.0048 * 1.3) * 0.05);
    const spin = rc.pulseMs * 0.0048 * 0.5;
    saveLayerAlpha(canvas, dim);
    drawPortalEnd(
      canvas,
      game.portal.ax,
      game.portal.ay,
      cell,
      sc,
      spin,
      GameColors.portalARim,
      GameColors.portalA,
      GameColors.portalADeep,
      GameColors.portalB,
    );
    drawPortalEnd(
      canvas,
      game.portal.bx,
      game.portal.by,
      cell,
      sc,
      -spin,
      GameColors.portalBRim,
      GameColors.portalB,
      GameColors.portalBDeep,
      GameColors.portalA,
    );
    canvas.restore();
  }

  // food: atlas sprite with the breathing pulse; gold ring on a bonus
  const pulse = 1 + Math.sin(rc.pulseMs * 0.0048) * 0.12;
  const food = game.food;
  const fx = food.x * cell + cell / 2;
  const fy = food.y * cell + cell / 2;
  const foodDim = food.bonus && game.foodAge > FOOD_TTL - 1500 && ((game.foodAge / 130) | 0) % 2 !== 0;
  saveLayerAlpha(canvas, foodDim ? 0.28 : 1);
  if (food.bonus) {
    strokePaint.setColor(Skia.Color(GameColors.goldBright));
    strokePaint.setStrokeWidth(Math.max(2, cell * 0.08));
    canvas.drawCircle(fx, fy, cell * 0.5 * pulse, strokePaint);
  }
  if (rc.atlas !== null) {
    const kind = food.kind + (food.bonus ? BONUS_KIND_OFFSET : 0);
    const sx = (kind % ATLAS_COLS) * ATLAS_CELL;
    const sy = ((kind / ATLAS_COLS) | 0) * ATLAS_CELL;
    const d = cell * 1.02 * pulse;
    canvas.drawImageRect(
      rc.atlas,
      Skia.XYWHRect(sx, sy, ATLAS_CELL, ATLAS_CELL),
      Skia.XYWHRect(fx - d / 2, fy - d / 2, d, d),
      fillPaint,
    );
  }
  canvas.restore();

  // TNT blocks: red block, grey band, label; whole wave blinks before it goes
  if (game.bombs.length > 0) {
    const tntPulse = 1 + Math.sin(rc.pulseMs * 0.0048 * 1.15) * 0.09;
    const nearGone = game.bombPhase === 'active' && now > game.bombExpireAt - 1200;
    const blinkOn = nearGone ? ((now / 120) | 0) % 2 === 0 : true;
    const B = cell * 0.9 * tntPulse;
    if (tntFont === null || tntFontSize !== Math.round(B * 0.3)) {
      tntFontSize = Math.round(B * 0.3);
      tntFont = matchFont({ fontFamily: tntFontFamily, fontSize: tntFontSize, fontWeight: 'bold' });
    }
    saveLayerAlpha(canvas, blinkOn ? 1 : 0.4);
    for (const b of game.bombs) {
      const x0 = b.x * cell + (cell - B) / 2;
      const y0 = b.y * cell + (cell - B) / 2;
      fillPaint.setColor(Skia.Color(GameColors.tntBody));
      canvas.drawRect(Skia.XYWHRect(x0, y0, B, B), fillPaint);
      fillPaint.setColor(Skia.Color(GameColors.tntBandLight));
      canvas.drawRect(Skia.XYWHRect(x0, y0 + B * 0.32, B, B * 0.26), fillPaint);
      fillPaint.setColor(Skia.Color(GameColors.tntBandDark));
      canvas.drawRect(Skia.XYWHRect(x0, y0 + B * 0.58, B, B * 0.08), fillPaint);
      fillPaint.setColor(Skia.Color('#111111'));
      const label = 'TNT';
      const w = tntFont.measureText(label).width;
      canvas.drawText(label, x0 + (B - w) / 2, y0 + B * 0.45 + tntFontSize * 0.36, fillPaint, tntFont);
    }
    canvas.restore();
  }

  // the snake: shaded RRects gliding by renderProg, wrapped copies in tunnels
  const r = cell * 0.42;
  const rad = cell * 0.32;
  const denom = Math.max(1, game.snake.length - 1);
  const p = rc.playing ? game.renderProg() : 1;
  strokePaint.setColor(Skia.Color(GameColors.snakeOutline));
  strokePaint.setStrokeWidth(Math.max(1, cell * 0.05));
  let lastShade = -1;
  for (let i = game.snake.length - 1; i >= 0; i--) {
    const shade = ((i * (SNAKE_SHADES - 1)) / denom) | 0;
    if (shade !== lastShade) {
      const c = snakeColors[shade];
      if (c !== undefined) fillPaint.setColor(c);
      lastShade = shade;
    }
    const rp = segRenderPos(game, i, p);
    drawBodyCell(canvas, rp.cx, rp.cy, cell, r, rad);
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
    fillPaint.setColor(Skia.Color(GameColors.ink));
    canvas.drawCircle(hx + ex * off + px * off, hy + ey * off + py * off, cell * 0.08, fillPaint);
    canvas.drawCircle(hx + ex * off - px * off, hy + ey * off - py * off, cell * 0.08, fillPaint);
  }

  // ghosts: glide by the shared helper, tunnel copies like the web
  const bob = Math.sin(rc.pulseMs * 0.0048 * 1.1) * cell * 0.03;
  const gnow = now;
  const scratch = { cx: 0, cy: 0 };
  for (let i = 0; i < game.ghosts.length; i++) {
    const gh = game.ghosts[i];
    if (gh === undefined) continue;
    const pos = ghostRenderPos(gh, gnow, scratch);
    const wx =
      pos.cx < 0 ? pos.cx + GRID
      : pos.cx > GRID - 1 ? pos.cx - GRID
      : null;
    const wy =
      pos.cy < 0 ? pos.cy + GRID
      : pos.cy > GRID - 1 ? pos.cy - GRID
      : null;
    drawGhostBody(canvas, pos.cx, pos.cy, gh.dir, i, bob, cell);
    if (wx !== null) drawGhostBody(canvas, wx, pos.cy, gh.dir, i, bob, cell);
    if (wy !== null) drawGhostBody(canvas, pos.cx, wy, gh.dir, i, bob, cell);
    if (wx !== null && wy !== null) drawGhostBody(canvas, wx, wy, gh.dir, i, bob, cell);
  }

  // particles, already stepped by the loop
  for (const pt of particles) {
    fillPaint.setColor(Skia.Color(pt.color));
    fillPaint.setAlphaf(Math.max(0, pt.life));
    canvas.drawCircle(pt.x, pt.y, cell * 0.1 * pt.life, fillPaint);
  }
  fillPaint.setAlphaf(1);

  return recorder.finishRecordingAsPicture();
}
