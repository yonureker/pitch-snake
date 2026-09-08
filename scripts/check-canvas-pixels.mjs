// A pixel gate for the renderer.
//
// STATUS: NOT YET RELIABLE. Do not put this in CI and do not treat a failure
// as proof of a regression until it has been reproduced. Seven causes of
// nondeterminism have been found and fixed (below) and one remains.
//
// WHAT THE REMAINING ONE LOOKS LIKE, which is the useful part for whoever
// picks this up: every frame alternates between exactly TWO stable hashes.
// Not drift, not noise, not a spread of values: two states, and a frame lands
// in one or the other. classic-desk gives 607e3211 or 2ac128b5, viper-desk
// gives a14b3a31 or 0d412a68, and the pairs are stable across many runs. That
// is the signature of a race with two outcomes rather than of a clock, which
// is why fixing four separate clock problems never closed it.
//
// THE STRONGEST CLUE, and it points away from the page entirely. Captured in
// ISOLATION, a frame is perfectly stable: four runs of a script that opens one
// browser and captures classic at frames 499, 500 and 501 gave the same hash
// for all twelve captures. Not two states. One. The identical capture inside
// THIS script, which opens six browsers in a row, still alternates.
//
// So the fault is in running several captures in one process, not in what the
// page draws. One cause has already been found and fixed there: the browser
// used a fixed debug port, and Chrome does not release a port the moment it is
// killed, so the next launch failed to bind and the wait loop connected to the
// DYING previous browser instead, with the previous profile and none of this
// run's pre-load scripts. That is now port 0 with the real port read back from
// the profile, which reduced the failure rate and did not close it.
//
// Whoever picks this up: keep looking at what one capture leaves behind for
// the next, not at the page. The isolation result is the measurement to
// reproduce first, because it is the one that says where NOT to look. A useful
// next step is to run the six shots in six separate processes and see whether
// the flake survives; if it does not, the shared node process is the carrier.
//
// The failure direction matters and is the safer one. A PASS is a genuine
// byte-for-byte match of that capture and means what it says. A FAIL may be
// the remaining flake rather than a real change, so the procedure is: run it
// again, and only believe a failure that repeats. That asymmetry is why this
// is still worth having and still not worth blocking a commit on.
//
// WHY THIS EXISTS. Every other check in this repo measures DOM boxes, text,
// classes and status codes. All of them are blind to what the game actually
// DRAWS, so a change to the arena, the jersey, the crest, a hat or a ghost
// sprite passes them all. This hashes the canvas.
//
// WHAT IT COVERS. Only frames that do not depend on a seed, which means the
// board before kickoff, in classic and speed run, with the viper skin and
// with no hat: the body, the colour ramp, the outline, the crest, the hat and
// the arena.
//
// WHAT IT DELIBERATELY DOES NOT COVER: survival. It was the best frame here,
// standing all 31 segments and five ghosts on the pitch at once, and it is
// the ONE frame that will not settle. Captured three times from an unchanged
// tree it gave two results, and the two differ by 2633 pixels of 430,336
// spread across a 456x656 box covering most of the board, at a magnitude that
// reads as a phase difference rather than a moved object. Fixes 1 to 6 below
// each removed a cause and none removed this one. Rather than keep a frame
// that fails at random, it is out: a gate that cries wolf gets ignored, and
// then the five that DO hold get ignored with it. Winning it back is worth
// doing, and the place to start is what survival has that the others do not,
// which is five ghosts and nine bombs on the board before anything steps.
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
//   6. THE FONT. index.html rebuilds the TNT sprite when Barlow finishes
//      loading, and that arrival is a network event no clock stub reaches.
//      SURVIVAL is the only frame with TNT on the board at kickoff (nine
//      bombs from the first frame), which is why it alone kept alternating
//      between exactly two hashes long after the others settled: the capture
//      landed before or after the font depending on the run. So the virtual
//      clock does not start until document.fonts.ready resolves. The page
//      sees dt = 0 until then, advances nothing, and every run begins its
//      timeline from the same event.
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
    // Not zero. The page treats a timestamp of 0 as "unset" (it guards its
    // first frame with a falsy check), so a clock starting at zero would hand
    // it two zero-dt frames instead of one. The base is otherwise arbitrary.
    let t = 1000;
    // The timeline starts when the FONT does, not when the document does:
    // see cause 6. Until then the page is handed the same instant every
    // frame, so its dt is zero and it advances nothing.
    let started = false;
    try {
      document.fonts.ready.then(() => { started = true; });
    } catch (e) { started = true; }
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
      if (started) {
        t += STEP;
        window.__frames++;
      }
      // cb(t), NOT cb(ts). This was the last cause and the largest: the page's
      // loop(now) hands its argument straight to frame(now), which computes
      // dt from (now minus lastTick) and drives the countdown, the accumulator,
      // sim and every glide and pulse from it. Passing the browser's real
      // timestamp meant the simulation ran on WALL time no matter how
      // thoroughly performance.now, Date.now and the font were pinned, so
      // frame 500 was a different amount of simulated time in every run and
      // everything interpolating landed slightly differently. performance.now
      // is only read in that function for the FPS meter, which is off, which
      // is why stubbing it looked like it should have been enough.
      // Found by pitch-snake-7e.
      cb(t);
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
if (lines.some((line) => line.startsWith('FAIL'))) {
  lines.push('');
  lines.push('NOTE: this gate is not yet reliable (see the header). About one run in');
  lines.push('four fails against an unchanged tree. Run it again before believing this.');
}
report(lines);
