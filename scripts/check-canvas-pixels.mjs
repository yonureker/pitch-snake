// A pixel gate for the renderer.
//
// WHY THIS EXISTS. Every other check in this repo measures DOM boxes, text,
// classes and status codes. All of them are blind to what the game actually
// DRAWS, so a change to the arena, the jersey, the crest, a hat or a ghost
// sprite passes them all. This hashes the canvas.
//
// WHAT IT COVERS. Only frames that do not depend on a seed, which means the
// board before kickoff. That is not a small target: survival stands all 31
// segments on the pitch from the first frame, so the body, the colour ramp,
// the outline, the crest and the hat are all on screen, over the arena.
//
// CALIBRATION, so the gate is trustable rather than merely present. Changing
// the classic skin's head colour by ONE unit in the red channel fails five of
// the six frames, and correctly leaves the viper frame alone because that skin
// does not use the classic ramp. So it is sensitive to a single channel of a
// single colour, and it discriminates rather than just noticing churn.
//
// GETTING IT DETERMINISTIC took four fixes, each found by it failing. Anyone
// extending this will hit the same ones:
//
//   1. A CAPTURED START TIMESTAMP. Pinning the clock at capture time is not
//      enough: anything that stored a timestamp at load animates from
//      (now - start), and start varies per load. Frames were stable WITHIN a
//      page and different ACROSS pages. Hence a virtual clock installed
//      before any page script. This only works at all because engine rule 3
//      forbids animating by frame count.
//   2. THE PREVIEW BOARD'S SEED. The board behind the menu is a real
//      createGame, and its constructor places the first food. Its seed comes
//      from crypto.getRandomValues, so the food moved every load: 0.2% of
//      pixels, in one box, at full colour delta.
//   3. THE NETWORK. The wallet decides which skin is worn, so a wallet that
//      landed before the capture changed the pixels. Blocking the backend
//      also means this exercises the offline path, which is supported.
//   4. THE CAPTURE POINT. Polling from OUTSIDE for "frames >= N" lands on N,
//      N+3 or N+6 depending on when the poll fired, and a few frames of drift
//      moves every interpolated segment by a fraction of a pixel: 0.6% of
//      pixels, spread across the whole board, at antialiasing magnitude. The
//      shot is taken inside the rAF wrapper at an exact frame instead.
//   5. THE OTHER CLOCK. Stubbing performance.now is not stubbing time.
//      index.html reads Date.now in twenty places (the engine reads it in
//      none), so under machine load the wall clock and the frame clock drift
//      apart and anything phased off Date.now lands differently at frame 500.
//      This survived fixes 1 to 4 and showed up as two of the six frames
//      hashing differently across runs of identical code: the survival frame
//      differed from ITSELF by 48 pixels of 430,336, the same 48 that
//      separated it from the baseline. Both clocks are stubbed now, and they
//      advance together off the same counter.
//
// The mode comes from localStorage before load, never from clicking the
// chooser, because a click fires newRound() at an arbitrary frame and puts
// fix 4 straight back.
//
// USAGE
//   node scripts/check-canvas-pixels.mjs            compare against the baseline
//   node scripts/check-canvas-pixels.mjs --bless    accept what is drawn now
//
// Bless only when you MEANT to change what the game looks like, and say so in
// the commit. Needs Chrome (set CHROME_PATH if it is somewhere unusual).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { report, withPage } from './browser-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'canvas-baseline.json');
const bless = process.argv.includes('--bless');
const CAPTURE_AT_FRAME = 500;

const SHOTS = [
  { name: 'classic-desk', query: '', width: 1512, height: 900, mode: 'classic' },
  { name: 'classic-phone', query: '', width: 390, height: 844, mode: 'classic' },
  { name: 'survival-desk', query: '', width: 1512, height: 900, mode: 'survival' },
  { name: 'speedrun-desk', query: '', width: 1512, height: 900, mode: 'speedrun' },
  { name: 'viper-desk', query: '?skin=viper', width: 1512, height: 900, mode: 'classic' },
  { name: 'nohat-desk', query: '?hat=off', width: 1512, height: 900, mode: 'classic' },
];

const beforeLoad = (mode) => `
  try { localStorage.setItem('snakeMode', ${JSON.stringify(mode)}); } catch (e) {}
  (() => {
    const STEP = 1000 / 60;
    // a fixed epoch so Date.now is reproducible across runs as well as
    // monotonic with the frame clock; the value itself is arbitrary
    const EPOCH = 1_767_225_600_000;
    let t = 0;
    window.__frames = 0;
    const realRaf = window.requestAnimationFrame.bind(window);
    performance.now = () => t;
    // BOTH clocks, advancing off the same counter. Stubbing only
    // performance.now leaves everything phased off the wall clock free to
    // drift under load, which is cause 5 above.
    Date.now = () => EPOCH + t;
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(EPOCH + t);
        else super(...args);
      }
      static now() { return EPOCH + t; }
    };
    window.requestAnimationFrame = (cb) => realRaf((ts) => {
      t += STEP;
      window.__frames++;
      cb(ts);
      if (window.__frames === ${CAPTURE_AT_FRAME} && !window.__shot) {
        const canvas = document.getElementById('game');
        if (canvas) window.__shot = canvas.toDataURL('image/png');
      }
    });
    crypto.getRandomValues = (array) => {
      for (let i = 0; i < array.length; i++) array[i] = (0x5EED + i * 2654435761) >>> 0 & 0xff;
      return array;
    };
    let r = 1;
    Math.random = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  })();`;

async function capture(shot) {
  return withPage({
    path: '/index.html' + shot.query,
    width: shot.width,
    height: shot.height,
    beforeLoad: beforeLoad(shot.mode),
    // the wallet decides which skin is worn, so the backend must not answer
    block: ['*supabase.co*', '*jsdelivr.net*'],
  }, async ({ evaluate, sleep, goto }) => {
    // navigated twice on purpose: the first load has no stored mode to read,
    // the second starts in the mode the first one wrote
    await goto();
    await sleep(1200);
    await goto();
    await sleep(2000);
    const mode = await evaluate(`(() => { try { return localStorage.getItem('snakeMode'); } catch (e) { return null; } })()`);
    if (mode !== shot.mode) throw new Error(`wanted mode ${shot.mode}, page is in ${String(mode)}`);
    let png = null;
    for (let i = 0; i < 400; i++) {
      png = await evaluate(`window.__shot || null`);
      if (png) break;
      await sleep(100);
    }
    if (!png) throw new Error(`never reached frame ${CAPTURE_AT_FRAME} (got to ${await evaluate('window.__frames')})`);
    const size = await evaluate(`(() => { const c = document.getElementById('game'); return c.width + 'x' + c.height; })()`);
    return { png, size };
  });
}

const before = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const now = {};
const lines = [];
for (const shot of SHOTS) {
  const { png, size } = await capture(shot);
  const hash = createHash('sha256').update(png).digest('hex').slice(0, 16);
  now[shot.name] = { hash, size };
  const label = `${shot.name.padEnd(15)} ${size.padEnd(8)} ${hash}`;
  const was = before?.[shot.name];
  if (bless || !was) {
    lines.push(`ok   ${label}${was ? '' : ' (new)'}`);
  } else if (was.hash === hash && was.size === size) {
    lines.push(`ok   ${label}`);
  } else {
    const file = path.join(process.env.TMPDIR ?? '/tmp', `canvas-${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    lines.push(`FAIL ${shot.name.padEnd(15)} ${was.size} ${was.hash} -> ${size} ${hash}`);
    lines.push(`       what it draws now: ${file}`);
  }
}
if (bless || !before) {
  fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  lines.push(`baseline written: ${path.relative(path.join(HERE, '..'), BASELINE)}`);
}
report(lines);
