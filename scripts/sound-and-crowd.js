/**
 * Sound and the crowd: every noise the page makes.
 *
 * OWNS the single AudioContext, the synthesised effects (each one built from
 * oscillators rather than a sample, so the page carries no audio files it
 * does not need), the stadium crowd bed with its CC0 tape and synth
 * fallback, and the full-time verdict (a real goal roar on a win, a
 * synthesised boo on a loss).
 *
 * MUST NEVER decide anything about gameplay, and must never let a failure
 * reach the round: a browser that refuses audio, a tape that will not fetch
 * and a context stuck suspended all end with a quiet game, never a broken
 * one. Nothing here throws outward.
 *
 * The one thing it needs from the shell is WHICH PHASE the round is in, and
 * it is told rather than reaching for it: `crowdSync(phase)` takes it. The
 * module keeps no other page state, which is what let it move out of
 * index.html first.
 *
 * @module
 */
// ---- sound ----
// Synthesized at trigger time from oscillators and one shared noise buffer:
// no assets, no requests, nothing here touches gameplay. The context wakes
// on the first gesture (autoplay policy); until it runs, triggers drop
// silently. Everything routes through one master gain (the mute) into a
// limiter, so stacked booms never clip.
let audio = null, audioMaster = null, audioNoise = null;
let pageSound = true;
try { pageSound = localStorage.getItem('snakeSound') !== 'off'; } catch (e) {}

// A press must never pay an audio tax: the wake listeners exist only while
// the context is not running (removed the moment it runs, re-armed by
// statechange if it stops), and a resume is attempted at most once at a
// time. touchend and click are in the set because on iOS a pointerdown is
// not an unlock gesture, and a context that never unlocks must not turn
// every tap into a doomed resume call.
let audioResuming = false;
function audioResume() {
  if (audioResuming || !audio || audio.state === 'running') return;
  audioResuming = true;
  const done = () => { audioResuming = false; };
  try { audio.resume().then(done, done); } catch (e) { done(); }
}

function audioBuild() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio = new AC();
  const limiter = audio.createDynamicsCompressor();
  limiter.threshold.value = -16; limiter.knee.value = 10; limiter.ratio.value = 10;
  limiter.attack.value = 0.002; limiter.release.value = 0.1;
  limiter.connect(audio.destination);
  audioMaster = audio.createGain();
  audioMaster.gain.value = 0.35;
  audioMaster.connect(limiter);
  audioNoise = audio.createBuffer(1, audio.sampleRate / 2, audio.sampleRate);
  const d = audioNoise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  audio.onstatechange = () => {
    if (audio.state === 'running') audioUnhook(); else audioHook();
    // the context often unlocks AFTER the kickoff gesture's own sync ran
    // and saw it suspended; this is where the bed catches up
    crowdSync();
  };
  if (audio.state !== 'running') audioResume();   // some browsers hand it back suspended
  else audioUnhook();
}

const WAKE_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'];
let wakeHooked = false;
function audioWake() {
  if (!pageSound) return;
  if (!audio) audioBuild();
  else audioResume();
}
function audioHook() {
  if (wakeHooked) return;
  wakeHooked = true;
  for (const ev of WAKE_EVENTS) window.addEventListener(ev, audioWake, { passive: true });
}
function audioUnhook() {
  if (!wakeHooked) return;
  wakeHooked = false;
  for (const ev of WAKE_EVENTS) window.removeEventListener(ev, audioWake);
}
audioHook();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pageSound) audioResume();
});

const sfxOn = () => pageSound && audio !== null && audio.state === 'running';

// one oscillator under a pluck envelope: the building block of most effects
function sfxTone(type, f0, f1, at, dur, peak) {
  const o = audio.createOscillator(), gn = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  gn.gain.setValueAtTime(0.0001, at);
  gn.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(gn).connect(audioMaster);
  o.start(at); o.stop(at + dur + 0.02);
}

// the shared noise buffer through a falling low-pass: booms and crashes
function sfxBoom(at, dur, peak, f0, f1) {
  const src = audio.createBufferSource(), fl = audio.createBiquadFilter(), gn = audio.createGain();
  src.buffer = audioNoise; src.loop = true;
  fl.type = 'lowpass';
  fl.frequency.setValueAtTime(f0, at);
  fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur);
  gn.gain.setValueAtTime(0.0001, at);
  gn.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(fl).connect(gn).connect(audioMaster);
  src.start(at); src.stop(at + dur + 0.02);
}

// a referee's pea whistle: a piercing note whose loudness flutters fast
function sfxPeep(at, dur, vol) {
  const o = audio.createOscillator(), am = audio.createGain(), env = audio.createGain();
  const lfo = audio.createOscillator(), lfoG = audio.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(2093, at);
  o.frequency.linearRampToValueAtTime(2160, at + dur);
  am.gain.value = 0.55;
  lfo.type = 'sine'; lfo.frequency.value = 42;
  lfoG.gain.value = 0.45;
  lfo.connect(lfoG).connect(am.gain);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.4 * vol, at + 0.02);
  env.gain.setValueAtTime(0.4 * vol, at + Math.max(0.03, dur - 0.03));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(am).connect(env).connect(audioMaster);
  o.start(at); lfo.start(at);
  o.stop(at + dur + 0.02); lfo.stop(at + dur + 0.02);
}

// The vocabulary. Rival events in a versus round pass a lower vol, so your
// own play sits in front of the room's.
const PENTA = [0, 2, 4, 7, 9];   // the eat ladder climbs these, then the bonus
function sfxEat(step, vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime, f = 523 * Math.pow(2, PENTA[step] / 12);
  sfxTone('square', f, f, at, 0.09, 0.4 * vol);
  sfxTone('triangle', f * 2, f * 2, at, 0.07, 0.22 * vol);
}
function sfxBonus(vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime;
  [659, 880, 1319].forEach((f, i) => {
    sfxTone('square', f, f, at + i * 0.06, 0.14, 0.32 * vol);
    sfxTone('triangle', f * 2, f * 2, at + i * 0.06, 0.12, 0.16 * vol);
  });
}
function sfxHop(vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime;
  sfxTone('sawtooth', 1500, 220, at, 0.16, 0.25 * vol);      // dive in
  sfxTone('sine', 400, 1400, at + 0.1, 0.16, 0.3 * vol);     // surface out
}
function sfxTnt(lost, vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime, big = Math.min(1.5, 1 + lost * 0.08);
  sfxBoom(at, 0.3 * big, 0.8 * vol, 1100, 120);
  sfxTone('sine', 130, 38, at, 0.32 * big, 0.8 * vol);
}
function sfxWallWarn() {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // two klaxon pulses
  sfxTone('sawtooth', 170, 150, at, 0.13, 0.3);
  sfxTone('sawtooth', 170, 150, at + 0.22, 0.13, 0.3);
}
function sfxWallSolid() {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // the clunk of going live
  sfxTone('sine', 100, 45, at, 0.16, 0.6);
  sfxBoom(at, 0.07, 0.25, 2500, 500);
}
function sfxPortalOpen() {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // a soft shimmer
  sfxTone('triangle', 1250, 1250, at, 0.3, 0.1);
  sfxTone('triangle', 1875, 1875, at + 0.05, 0.3, 0.08);
}
function sfxGhostIn() {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // an eerie riser
  sfxTone('sine', 170, 540, at, 0.5, 0.22);
  sfxTone('triangle', 255, 810, at + 0.06, 0.44, 0.1);
}
function sfxCrash(vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // the fall
  sfxTone('sawtooth', 240, 50, at, 0.55, 0.5 * vol);
  sfxBoom(at, 0.4, 0.5 * vol, 900, 100);
}
function sfxFlourish() {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // the clinch
  [523, 659, 784, 1047].forEach((f, i) => sfxTone('square', f, f, at + i * 0.07, 0.14, 0.3));
  sfxTone('square', 1047, 1047, at + 0.28, 0.4, 0.25);
  sfxTone('square', 1319, 1319, at + 0.28, 0.4, 0.2);
}
function sfxTick() {
  if (!sfxOn()) return;
  sfxTone('square', 1050, 1050, audio.currentTime, 0.05, 0.22);
}
function sfxSave(vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // the great escape
  sfxTone('sine', 480, 1040, at, 0.13, 0.35 * vol);
  sfxTone('triangle', 960, 2080, at + 0.03, 0.11, 0.18 * vol);
}
function sfxZap(vol) {
  if (!sfxOn()) return;
  const at = audio.currentTime;                              // the bolt: a crack, then the drag
  sfxBoom(at, 0.16, 0.5 * vol, 6000, 900);
  sfxTone('square', 1750, 300, at, 0.22, 0.3 * vol);
  sfxTone('sine', 300, 120, at + 0.1, 0.4, 0.25 * vol);
}
function sfxKickoff() { if (sfxOn()) sfxPeep(audio.currentTime, 0.3, 1); }

// ---- the crowd ----
// Stadium ambience in the Football Manager spirit, in two layers. The
// bed proper is a real stand: a CC0 field recording shipped as
// assets/crowd.m4a (the one runtime audio asset, provenance in
// assets/crowd.LICENSE.txt), looped seamlessly and fetched lazily. Under
// it lives the synthesized stand: noise through filters with formant
// bands, babble flutter and slow swells, which starts INSTANTLY, carries
// the whole sound if the tape cannot load, and stays ducked underneath
// once it has, so the surges keep breathing. A cheer voice lifts when
// something scores. Only gain targets ever move after build, all on the
// audio thread: the frame loop never touches any of this. It hangs off
// audioMaster, so the mute and the limiter own it like every other
// sound.
let crowdOn = true;
try { crowdOn = localStorage.getItem('snakeCrowd') !== 'off'; } catch (e) {}
let crowdBed = null, crowdCheer = null, crowdSynth = null, crowdTape = null;
let crowdTapeAsked = false;
const CROWD_LEVEL = 0.17;
function crowdVoice(buf, rate, type, freq, q, level, dest) {
  const src = audio.createBufferSource();
  src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
  const filt = audio.createBiquadFilter();
  filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
  const gn = audio.createGain(); gn.gain.value = level;
  src.connect(filt); filt.connect(gn); gn.connect(dest);
  src.start();
  return gn;
}
// The real stand: a CC0 field recording (assets/crowd.LICENSE.txt), cut
// to a fifty second loop with the seam crossfaded away, fetched lazily
// the first time the crowd is wanted. The synthesized bed is the
// instant-on sound while the tape loads and the whole sound if the fetch
// or decode fails, because a dead network degrades the ambience, never
// the game; once the tape lands the synth ducks under it rather than
// vanishing, so the babble and swells keep working the room.
let crowdRoarBuf = null;   // the real goal roar, for the full-time verdict
function crowdFetch(path, then) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  fetch(path, { signal: ctl.signal })
    .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
    .then(b => audio.decodeAudioData(b))
    .then(buf => { clearTimeout(timer); then(buf); })
    .catch(() => { clearTimeout(timer); });         // the synth simply keeps singing
}
function crowdTapeLoad() {
  if (crowdTapeAsked) return;
  crowdTapeAsked = true;
  crowdFetch('assets/crowd.m4a', buf => {
    if (!crowdBed) return;
    crowdTape = audio.createGain();
    crowdTape.gain.value = 0;
    crowdTape.connect(crowdBed);
    const src = audio.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(crowdTape);
    src.start(0, Math.random() * buf.duration);   // not every kickoff on the same roar
    const t = audio.currentTime;
    crowdTape.gain.setTargetAtTime(1, t, 1.2);
    crowdSynth.gain.setTargetAtTime(0.1, t, 1.2);
  });
  crowdFetch('assets/cheer.m4a', buf => { crowdRoarBuf = buf; });
}

// ---- the full-time verdict ----
// A room's whistle gets a crowd opinion: the winner hears the real goal
// roar (the recording's own biggest moment, shipped as assets/cheer.m4a),
// everyone else hears the stand turn on them, a booed chorus with
// falling whistles, synthesized because no boo material could be
// verified in the tape by ear. Versus only: a solo FULL TIME is your own
// round, and the crash and whistle already speak there. One-shots into
// audioMaster directly, since the bed itself is already fading out by
// the time the verdict lands.
function crowdVerdict(won) {
  if (!crowdOn || !sfxOn()) return;
  const t = audio.currentTime;
  if (won) {
    const gn = audio.createGain();
    gn.gain.value = 0.55;
    gn.connect(audioMaster);
    if (crowdRoarBuf) {
      const src = audio.createBufferSource();
      src.buffer = crowdRoarBuf;
      src.connect(gn);
      src.start();
    } else {
      // no tape came: a synthesized roar, noise swelling through the
      // cheer band and dying away
      const src = audio.createBufferSource();
      src.buffer = audioNoise; src.loop = true;
      const bp = audio.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
      gn.gain.value = 0;
      gn.gain.setTargetAtTime(0.5, t, 0.15);
      gn.gain.setTargetAtTime(0, t + 1.2, 0.8);
      src.connect(bp); bp.connect(gn);
      src.start(); src.stop(t + 5);
    }
  } else {
    // the boo: a low chorus of detuned saws under a lowpass, swelling in
    // and dying, with three whistles falling in pitch over it, which is
    // a stadium's grammar for "referee!"
    const boo = audio.createGain();
    boo.gain.value = 0;
    boo.gain.setTargetAtTime(0.34, t, 0.22);
    boo.gain.setTargetAtTime(0, t + 1.6, 0.7);
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.7;
    lp.connect(boo); boo.connect(audioMaster);
    for (const det of [0.96, 0.985, 1, 1.02, 1.05]) {
      const o = audio.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 170 * det;
      o.frequency.setTargetAtTime(140 * det, t + 0.4, 1.2);   // the chorus sags
      const og = audio.createGain(); og.gain.value = 0.25;
      o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + 4.5);
    }
    const breath = audio.createBufferSource();
    breath.buffer = audioNoise; breath.loop = true;
    const bbp = audio.createBiquadFilter();
    bbp.type = 'bandpass'; bbp.frequency.value = 420; bbp.Q.value = 1.6;
    const bg = audio.createGain(); bg.gain.value = 0.5;
    breath.connect(bbp); bbp.connect(bg); bg.connect(lp);
    breath.start(t); breath.stop(t + 4.5);
    for (let i = 0; i < 3; i++) {
      const at = t + 0.25 + i * 0.5 + Math.random() * 0.2;
      const wg = audio.createGain();
      wg.gain.value = 0;
      wg.gain.setTargetAtTime(0.16, at, 0.03);
      wg.gain.setTargetAtTime(0, at + 0.28, 0.09);
      wg.connect(audioMaster);
      const o = audio.createOscillator();
      o.frequency.value = 3100 + Math.random() * 500;
      o.frequency.setTargetAtTime(2300, at + 0.1, 0.25);       // the fall is the scorn
      o.connect(wg);
      o.start(at); o.stop(at + 1);
    }
  }
}
function crowdBuild() {
  crowdBed = audio.createGain();
  crowdBed.gain.value = 0;
  crowdBed.connect(audioMaster);
  crowdSynth = audio.createGain();
  crowdSynth.gain.value = 1;
  crowdSynth.connect(crowdBed);
  const buf = audio.createBuffer(1, audio.sampleRate * 4, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  crowdVoice(buf, 0.82, 'lowpass', 240, 0.7, 0.65, crowdSynth);
  // two vowel-ish bands rather than one: a formant pair is what makes
  // filtered noise read as thousands of voices instead of rainfall
  const voxA = crowdVoice(buf, 1.0, 'bandpass', 620, 1.2, 0.38, crowdSynth);
  const voxB = crowdVoice(buf, 0.93, 'bandpass', 1150, 1.4, 0.22, crowdSynth);
  crowdVoice(buf, 1.31, 'bandpass', 2600, 0.8, 0.06, crowdSynth);
  // the cheer sits beside the synth bed, not inside it: it must stay full
  // even once the tape has ducked the synth away
  crowdCheer = crowdVoice(buf, 1.12, 'bandpass', 920, 1.1, 0, crowdBed);
  // the breath and the babble: sub-0.1Hz swells so the stand heaves, and
  // a syllable-rate flutter of a few Hz so the wash chatters like speech.
  // All additive around each band's base, so no sum ever goes negative.
  for (const [freq, depth, to] of [[0.11, 0.11, voxA], [0.037, 0.13, voxA], [0.083, 0.08, voxB],
                                   [4.7, 0.09, voxA], [3.9, 0.05, voxB]]) {
    const o = audio.createOscillator(), gn = audio.createGain();
    o.frequency.value = freq; gn.gain.value = depth;
    o.connect(gn); gn.connect(to.gain); o.start();
  }
}
// The surge: every quarter minute or so the whole bed leans in for a
// couple of seconds and settles back, the far end reacting to play you
// cannot see. A timer rather than an LFO because irregularity is the
// whole point; it is audio texture, not gameplay, so it does not ride
// the loop clock, and crowdSync arms and disarms it with the bed.
let crowdSurgeTimer = 0;
function crowdArm() {
  if (!crowdSurgeTimer) crowdSurgeTimer = setTimeout(crowdSurge, 12000 + Math.random() * 20000);
}
function crowdSurge() {
  crowdSurgeTimer = 0;
  if (!crowdWanted()) return;
  const t = audio.currentTime;
  crowdBed.gain.cancelScheduledValues(t);
  crowdBed.gain.setTargetAtTime(CROWD_LEVEL * 1.8, t, 0.7);
  crowdBed.gain.setTargetAtTime(CROWD_LEVEL, t + 2.2, 1.1);
  crowdArm();
}
// One door for every transition, called wherever state or sound changes.
// Idempotent, so no caller reasons about what the bed was already doing:
// it fades in through the countdown and out on death, pause and menus.
// The round's phase, as the shell last reported it. The module is TOLD
// rather than reaching into the page for it: that one dependency was the
// only thing tying this file to index.html, and inverting it is what let
// the file leave.
let roundPhase = 'ready';
const crowdWanted = () => crowdOn && pageSound && audio !== null && audio.state === 'running'
  && (roundPhase === 'playing' || roundPhase === 'countdown');

/**
 * Bring the crowd into line with the round. Idempotent, so no caller has to
 * reason about what the bed was already doing.
 *
 * @param {string} [phase] - the round's phase ('ready', 'countdown',
 *   'playing', 'paused', 'dead'). Omit to re-apply the phase last given,
 *   which is what a settings change or a context wake wants.
 */
function crowdSync(phase) {
  if (phase !== undefined) roundPhase = phase;
  const want = crowdWanted();
  if (want && !crowdBed) crowdBuild();
  if (!crowdBed) return;
  if (want) crowdTapeLoad();
  crowdBed.gain.cancelScheduledValues(audio.currentTime);
  crowdBed.gain.setTargetAtTime(want ? CROWD_LEVEL : 0, audio.currentTime, want ? 0.8 : 0.4);
  if (want) crowdArm();
  else if (crowdSurgeTimer) { clearTimeout(crowdSurgeTimer); crowdSurgeTimer = 0; }
}
// the stand lifts for a beat; k is loudness against the bed's own level
function crowdPulse(k) {
  if (!crowdCheer || !crowdOn || !sfxOn()) return;
  const t = audio.currentTime;
  crowdCheer.gain.cancelScheduledValues(t);
  crowdCheer.gain.setTargetAtTime(k, t, 0.06);
  crowdCheer.gain.setTargetAtTime(0, t + 0.3, 0.5);
}
function sfxFullTime() {
  if (!sfxOn()) return;
  const at = audio.currentTime;
  sfxPeep(at, 0.15, 1); sfxPeep(at + 0.28, 0.6, 1);
}

/**
 * Turn the page's sound on or off.
 *
 * A toggle press IS a user gesture, which is the only moment a browser will
 * let an AudioContext start, so turning it on wakes the context here rather
 * than waiting for the next tap. Turning it off suspends the context, which
 * parks the DSP and the audio session instead of leaving silence running.
 *
 * @param {boolean} on - whether the page may make noise.
 */
export function setPageSound(on) {
  pageSound = on;
  if (on) { audioHook(); audioWake(); }
  else if (audio && audio.state === 'running') void audio.suspend();
}

/**
 * Turn the stadium crowd on or off, independently of the effects.
 *
 * @param {boolean} on - whether the crowd may be heard.
 */
export function setCrowdOn(on) {
  crowdOn = on;
  if (on) { audioHook(); audioWake(); }
  crowdSync();
}

/** @returns {boolean} whether the page is allowed to make noise. */
export function isPageSoundOn() { return pageSound; }

/** @returns {boolean} whether the crowd is allowed to be heard. */
export function isCrowdOn() { return crowdOn; }

export {
  audioHook, audioWake, crowdPulse, crowdSync, crowdVerdict,
  sfxBonus, sfxCrash, sfxEat, sfxFlourish, sfxFullTime, sfxGhostIn, sfxHop,
  sfxKickoff, sfxPortalOpen, sfxSave, sfxTick, sfxTnt, sfxWallSolid,
  sfxWallWarn, sfxZap,
};
