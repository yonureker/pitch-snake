/* eslint-disable no-restricted-syntax --
 * Math.random is used throughout this file for AUDIO JITTER and nothing else:
 * the noise buffers, the surge interval, a tape's start offset, the scatter of
 * the boo's whistles. None of it is reachable from the simulation, which is
 * what the rule guards; this module decides no gameplay and is handed no game
 * state. Seeding it would make the crowd identical every round for no gain.
 */
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

/** The phases a round moves through; the crowd only sings through two. */
export type RoundPhase = 'ready' | 'countdown' | 'playing' | 'paused' | 'dead';

// Safari still only has the prefixed constructor, and some browsers have
// neither. The DOM lib types `window.AudioContext` as always present, which
// made both the fallback and the guard below look like dead code to the
// compiler; they are not dead at runtime, so the lookup is typed as what it
// actually is.
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

// ---- sound ----
// Synthesized at trigger time from oscillators and one shared noise buffer:
// no assets, no requests, nothing here touches gameplay. The context wakes
// on the first gesture (autoplay policy); until it runs, triggers drop
// silently. Everything routes through one master gain (the mute) into a
// limiter, so stacked booms never clip.

/**
 * The context and the two things every sound needs from it.
 *
 * They are one value because they are built together and are null together:
 * as three separate variables the compiler had to be told, at every single
 * use, that a master gain exists whenever a context does. Bundling them says
 * it once, truthfully.
 */
interface AudioRig {
  ctx: AudioContext;
  /** The mute, and everything's route to the limiter. */
  master: GainNode;
  /** One second of noise, shared by every boom, crash and breath. */
  noise: AudioBuffer;
}

let rig: AudioRig | null = null;
let pageSound = true;
try {
  pageSound = localStorage.getItem('snakeSound') !== 'off';
} catch {
  // a browser with storage walled off still gets sound
}

// A press must never pay an audio tax: the wake listeners exist only while
// the context is not running (removed the moment it runs, re-armed by
// statechange if it stops), and a resume is attempted at most once at a
// time. touchend and click are in the set because on iOS a pointerdown is
// not an unlock gesture, and a context that never unlocks must not turn
// every tap into a doomed resume call.
let audioResuming = false;
function audioResume(): void {
  if (audioResuming || rig === null || rig.ctx.state === 'running') return;
  audioResuming = true;
  const done = (): void => {
    audioResuming = false;
  };
  try {
    void rig.ctx.resume().then(done, done);
  } catch {
    done();
  }
}

function audioBuild(): void {
  // The DOM lib insists window.AudioContext always exists. It does not: old
  // Safari carries only the prefixed name, and a browser with Web Audio turned
  // off has neither. Both lines below are live at runtime and dead only to the
  // type system, which cannot know what this actually ships to.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- see above */
  const AudioContextCtor: typeof AudioContext | undefined =
    window.AudioContext ?? window.webkitAudioContext;
  if (AudioContextCtor === undefined) return;
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  const ctx = new AudioContextCtor();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -16;
  limiter.knee.value = 10;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(limiter);
  const noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  rig = { ctx, master, noise };
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'running') audioUnhook();
    else audioHook();
    // the context often unlocks AFTER the kickoff gesture's own sync ran
    // and saw it suspended; this is where the bed catches up
    crowdSync();
  });
  if (ctx.state === 'running') audioUnhook();
  else audioResume(); // some browsers hand it back suspended
}

const WAKE_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
let wakeHooked = false;

/** Try to start or resume the context; safe to call on any gesture. */
function audioWake(): void {
  if (!pageSound) return;
  if (rig === null) audioBuild();
  else audioResume();
}

/** Listen for the next gesture, so a suspended context can unlock. */
function audioHook(): void {
  if (wakeHooked) return;
  wakeHooked = true;
  for (const ev of WAKE_EVENTS) window.addEventListener(ev, audioWake, { passive: true });
}

function audioUnhook(): void {
  if (!wakeHooked) return;
  wakeHooked = false;
  for (const ev of WAKE_EVENTS) window.removeEventListener(ev, audioWake);
}
audioHook();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pageSound) audioResume();
});

/**
 * The rig, but only when it can actually be heard.
 *
 * Every effect starts by asking for this and returning on null, which is how
 * a trigger drops silently while the context is asleep. It replaced a
 * boolean `sfxOn()`: a boolean cannot carry the context along with the
 * answer, so every caller then reached for a variable the compiler still
 * believed might be null.
 */
function liveRig(): AudioRig | null {
  if (!pageSound || rig?.ctx.state !== 'running') return null;
  return rig;
}

// one oscillator under a pluck envelope: the building block of most effects
function sfxTone(
  r: AudioRig,
  type: OscillatorType,
  f0: number,
  f1: number,
  at: number,
  dur: number,
  peak: number,
): void {
  const o = r.ctx.createOscillator();
  const gn = r.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  gn.gain.setValueAtTime(0.0001, at);
  gn.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(gn).connect(r.master);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// the shared noise buffer through a falling low-pass: booms and crashes
function sfxBoom(r: AudioRig, at: number, dur: number, peak: number, f0: number, f1: number): void {
  const src = r.ctx.createBufferSource();
  const fl = r.ctx.createBiquadFilter();
  const gn = r.ctx.createGain();
  src.buffer = r.noise;
  src.loop = true;
  fl.type = 'lowpass';
  fl.frequency.setValueAtTime(f0, at);
  fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur);
  gn.gain.setValueAtTime(0.0001, at);
  gn.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  gn.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(fl).connect(gn).connect(r.master);
  src.start(at);
  src.stop(at + dur + 0.02);
}

// a referee's pea whistle: a piercing note whose loudness flutters fast
function sfxPeep(r: AudioRig, at: number, dur: number, vol: number): void {
  const o = r.ctx.createOscillator();
  const am = r.ctx.createGain();
  const env = r.ctx.createGain();
  const lfo = r.ctx.createOscillator();
  const lfoG = r.ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(2093, at);
  o.frequency.linearRampToValueAtTime(2160, at + dur);
  am.gain.value = 0.55;
  lfo.type = 'sine';
  lfo.frequency.value = 42;
  lfoG.gain.value = 0.45;
  lfo.connect(lfoG).connect(am.gain);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.4 * vol, at + 0.02);
  env.gain.setValueAtTime(0.4 * vol, at + Math.max(0.03, dur - 0.03));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(am).connect(env).connect(r.master);
  o.start(at);
  lfo.start(at);
  o.stop(at + dur + 0.02);
  lfo.stop(at + dur + 0.02);
}

// The vocabulary. Rival events in a versus round pass a lower vol, so your
// own play sits in front of the room's.
const PENTA = [0, 2, 4, 7, 9]; // the eat ladder climbs these, then the bonus

/**
 * The food note, climbing the pentatonic ladder as a streak builds. *
 * @param step - how far up the pentatonic ladder this streak has climbed.
 * @param vol - loudness; a rival's events in a room pass a lower one.
 */
export function sfxEat(step: number, vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  const f = 523 * Math.pow(2, (PENTA[step] ?? 0) / 12);
  sfxTone(r, 'square', f, f, at, 0.09, 0.4 * vol);
  sfxTone(r, 'triangle', f * 2, f * 2, at, 0.07, 0.22 * vol);
}

/**
 * The bonus: the ladder's top three, arpeggiated. *
 * @param vol - loudness; rivals are quieter than you.
 */
export function sfxBonus(vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  for (const [i, f] of [659, 880, 1319].entries()) {
    sfxTone(r, 'square', f, f, at + i * 0.06, 0.14, 0.32 * vol);
    sfxTone(r, 'triangle', f * 2, f * 2, at + i * 0.06, 0.12, 0.16 * vol);
  }
}

/**
 * A teleport trip: a dive in and a surface out. *
 * @param vol - loudness; rivals are quieter than you.
 */
export function sfxHop(vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'sawtooth', 1500, 220, at, 0.16, 0.25 * vol); // dive in
  sfxTone(r, 'sine', 400, 1400, at + 0.1, 0.16, 0.3 * vol); // surface out
}

/**
 * TNT, sized by how much length it cost. *
 * @param lost - how much length it cost, which sizes the blast.
 * @param vol - loudness; rivals are quieter than you.
 */
export function sfxTnt(lost: number, vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  const big = Math.min(1.5, 1 + lost * 0.08);
  sfxBoom(r, at, 0.3 * big, 0.8 * vol, 1100, 120);
  sfxTone(r, 'sine', 130, 38, at, 0.32 * big, 0.8 * vol);
}

/** A wall is about to go live: two klaxon pulses. */
export function sfxWallWarn(): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'sawtooth', 170, 150, at, 0.13, 0.3);
  sfxTone(r, 'sawtooth', 170, 150, at + 0.22, 0.13, 0.3);
}

/** The clunk of a wall going solid. */
export function sfxWallSolid(): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'sine', 100, 45, at, 0.16, 0.6);
  sfxBoom(r, at, 0.07, 0.25, 2500, 500);
}

/** A teleport pair falling due: a soft shimmer. */
export function sfxPortalOpen(): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'triangle', 1250, 1250, at, 0.3, 0.1);
  sfxTone(r, 'triangle', 1875, 1875, at + 0.05, 0.3, 0.08);
}

/** A ghost joining the pack: an eerie riser. */
export function sfxGhostIn(): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'sine', 170, 540, at, 0.5, 0.22);
  sfxTone(r, 'triangle', 255, 810, at + 0.06, 0.44, 0.1);
}

/**
 * The fall. *
 * @param vol - loudness; rivals are quieter than you.
 */
export function sfxCrash(vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'sawtooth', 240, 50, at, 0.55, 0.5 * vol);
  sfxBoom(r, at, 0.4, 0.5 * vol, 900, 100);
}

/** The clinch. */
export function sfxFlourish(): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  for (const [i, f] of [523, 659, 784, 1047].entries()) {
    sfxTone(r, 'square', f, f, at + i * 0.07, 0.14, 0.3);
  }
  sfxTone(r, 'square', 1047, 1047, at + 0.28, 0.4, 0.25);
  sfxTone(r, 'square', 1319, 1319, at + 0.28, 0.4, 0.2);
}

/** One countdown tick. */
export function sfxTick(): void {
  const r = liveRig();
  if (r === null) return;
  sfxTone(r, 'square', 1050, 1050, r.ctx.currentTime, 0.05, 0.22);
}

/**
 * The great escape: a doom window converted into a turn. *
 * @param vol - loudness; rivals are quieter than you.
 */
export function sfxSave(vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxTone(r, 'sine', 480, 1040, at, 0.13, 0.35 * vol);
  sfxTone(r, 'triangle', 960, 2080, at + 0.03, 0.11, 0.18 * vol);
}

/**
 * The bolt: a crack, then the drag. *
 * @param vol - loudness; rivals are quieter than you.
 */
export function sfxZap(vol: number): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxBoom(r, at, 0.16, 0.5 * vol, 6000, 900);
  sfxTone(r, 'square', 1750, 300, at, 0.22, 0.3 * vol);
  sfxTone(r, 'sine', 300, 120, at + 0.1, 0.4, 0.25 * vol);
}

/** The kickoff whistle. */
export function sfxKickoff(): void {
  const r = liveRig();
  if (r === null) return;
  sfxPeep(r, r.ctx.currentTime, 0.3, 1);
}

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
// the master gain, so the mute and the limiter own it like every other
// sound.
let crowdOn = true;
try {
  crowdOn = localStorage.getItem('snakeCrowd') !== 'off';
} catch {
  // same rule as the sound preference
}
let crowdBed: GainNode | null = null;
let crowdCheer: GainNode | null = null;
let crowdSynth: GainNode | null = null;
let crowdTapeAsked = false;
const CROWD_LEVEL = 0.17;

function crowdVoice(
  r: AudioRig,
  buf: AudioBuffer,
  rate: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
  level: number,
  dest: AudioNode,
): GainNode {
  const src = r.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  const filt = r.ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const gn = r.ctx.createGain();
  gn.gain.value = level;
  src.connect(filt);
  filt.connect(gn);
  gn.connect(dest);
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
let crowdRoarBuf: AudioBuffer | null = null; // the real goal roar, for the full-time verdict

function crowdFetch(r: AudioRig, path: string, then: (buf: AudioBuffer) => void): void {
  const ctl = new AbortController();
  const timer = setTimeout(() => {
    ctl.abort();
  }, 12000);
  void fetch(path, { signal: ctl.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`http ${res.status}`);
      return res.arrayBuffer();
    })
    .then(async (b) => r.ctx.decodeAudioData(b))
    .then((buf) => {
      clearTimeout(timer);
      then(buf);
    })
    .catch(() => {
      clearTimeout(timer);
    }); // the synth simply keeps singing
}

function crowdTapeLoad(r: AudioRig): void {
  if (crowdTapeAsked) return;
  crowdTapeAsked = true;
  crowdFetch(r, 'assets/crowd.m4a', (buf) => {
    const bed = crowdBed;
    const synth = crowdSynth;
    if (bed === null || synth === null) return;
    // a local, not module state: every use of the tape gain is in this
    // callback, and the audio graph is what keeps the node alive
    const tape = r.ctx.createGain();
    tape.gain.value = 0;
    tape.connect(bed);
    const src = r.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(tape);
    src.start(0, Math.random() * buf.duration); // not every kickoff on the same roar
    const t = r.ctx.currentTime;
    tape.gain.setTargetAtTime(1, t, 1.2);
    synth.gain.setTargetAtTime(0.1, t, 1.2);
  });
  crowdFetch(r, 'assets/cheer.m4a', (buf) => {
    crowdRoarBuf = buf;
  });
}

// ---- the full-time verdict ----
// A room's whistle gets a crowd opinion: the winner hears the real goal
// roar (the recording's own biggest moment, shipped as assets/cheer.m4a),
// everyone else hears the stand turn on them, a booed chorus with
// falling whistles, synthesized because no boo material could be
// verified in the tape by ear. Versus only: a solo FULL TIME is your own
// round, and the crash and whistle already speak there. One-shots into
// the master gain directly, since the bed itself is already fading out by
// the time the verdict lands.

/**
 * The stand's opinion of a room's result.
 *
 * @param won - true for the winner, who gets the real roar.
 */
export function crowdVerdict(won: boolean): void {
  const r = liveRig();
  if (!crowdOn || r === null) return;
  const t = r.ctx.currentTime;
  if (won) {
    const gn = r.ctx.createGain();
    gn.gain.value = 0.55;
    gn.connect(r.master);
    if (crowdRoarBuf) {
      const src = r.ctx.createBufferSource();
      src.buffer = crowdRoarBuf;
      src.connect(gn);
      src.start();
    } else {
      // no tape came: a synthesized roar, noise swelling through the
      // cheer band and dying away
      const src = r.ctx.createBufferSource();
      src.buffer = r.noise;
      src.loop = true;
      const bp = r.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      gn.gain.value = 0;
      gn.gain.setTargetAtTime(0.5, t, 0.15);
      gn.gain.setTargetAtTime(0, t + 1.2, 0.8);
      src.connect(bp);
      bp.connect(gn);
      src.start();
      src.stop(t + 5);
    }
  } else {
    // the boo: a low chorus of detuned saws under a lowpass, swelling in
    // and dying, with three whistles falling in pitch over it, which is
    // a stadium's grammar for "referee!"
    const boo = r.ctx.createGain();
    boo.gain.value = 0;
    boo.gain.setTargetAtTime(0.34, t, 0.22);
    boo.gain.setTargetAtTime(0, t + 1.6, 0.7);
    const lp = r.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    lp.Q.value = 0.7;
    lp.connect(boo);
    boo.connect(r.master);
    for (const det of [0.96, 0.985, 1, 1.02, 1.05]) {
      const o = r.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 170 * det;
      o.frequency.setTargetAtTime(140 * det, t + 0.4, 1.2); // the chorus sags
      const og = r.ctx.createGain();
      og.gain.value = 0.25;
      o.connect(og);
      og.connect(lp);
      o.start(t);
      o.stop(t + 4.5);
    }
    const breath = r.ctx.createBufferSource();
    breath.buffer = r.noise;
    breath.loop = true;
    const bbp = r.ctx.createBiquadFilter();
    bbp.type = 'bandpass';
    bbp.frequency.value = 420;
    bbp.Q.value = 1.6;
    const bg = r.ctx.createGain();
    bg.gain.value = 0.5;
    breath.connect(bbp);
    bbp.connect(bg);
    bg.connect(lp);
    breath.start(t);
    breath.stop(t + 4.5);
    for (let i = 0; i < 3; i++) {
      const at = t + 0.25 + i * 0.5 + Math.random() * 0.2;
      const wg = r.ctx.createGain();
      wg.gain.value = 0;
      wg.gain.setTargetAtTime(0.16, at, 0.03);
      wg.gain.setTargetAtTime(0, at + 0.28, 0.09);
      wg.connect(r.master);
      const o = r.ctx.createOscillator();
      o.frequency.value = 3100 + Math.random() * 500;
      o.frequency.setTargetAtTime(2300, at + 0.1, 0.25); // the fall is the scorn
      o.connect(wg);
      o.start(at);
      o.stop(at + 1);
    }
  }
}

function crowdBuild(r: AudioRig): void {
  const bed = r.ctx.createGain();
  crowdBed = bed;
  bed.gain.value = 0;
  bed.connect(r.master);
  const synth = r.ctx.createGain();
  crowdSynth = synth;
  synth.gain.value = 1;
  synth.connect(bed);
  const buf = r.ctx.createBuffer(1, r.ctx.sampleRate * 4, r.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  crowdVoice(r, buf, 0.82, 'lowpass', 240, 0.7, 0.65, synth);
  // two vowel-ish bands rather than one: a formant pair is what makes
  // filtered noise read as thousands of voices instead of rainfall
  const voxA = crowdVoice(r, buf, 1, 'bandpass', 620, 1.2, 0.38, synth);
  const voxB = crowdVoice(r, buf, 0.93, 'bandpass', 1150, 1.4, 0.22, synth);
  crowdVoice(r, buf, 1.31, 'bandpass', 2600, 0.8, 0.06, synth);
  // the cheer sits beside the synth bed, not inside it: it must stay full
  // even once the tape has ducked the synth away
  crowdCheer = crowdVoice(r, buf, 1.12, 'bandpass', 920, 1.1, 0, bed);
  // the breath and the babble: sub-0.1Hz swells so the stand heaves, and
  // a syllable-rate flutter of a few Hz so the wash chatters like speech.
  // All additive around each band's base, so no sum ever goes negative.
  const swells: [number, number, GainNode][] = [
    [0.11, 0.11, voxA],
    [0.037, 0.13, voxA],
    [0.083, 0.08, voxB],
    [4.7, 0.09, voxA],
    [3.9, 0.05, voxB],
  ];
  for (const [freq, depth, to] of swells) {
    const o = r.ctx.createOscillator();
    const gn = r.ctx.createGain();
    o.frequency.value = freq;
    gn.gain.value = depth;
    o.connect(gn);
    gn.connect(to.gain);
    o.start();
  }
}

// The surge: every quarter minute or so the whole bed leans in for a
// couple of seconds and settles back, the far end reacting to play you
// cannot see. A timer rather than an LFO because irregularity is the
// whole point; it is audio texture, not gameplay, so it does not ride
// the loop clock, and crowdSync arms and disarms it with the bed.
let crowdSurgeTimer = 0;
function crowdArm(): void {
  if (!crowdSurgeTimer) crowdSurgeTimer = window.setTimeout(crowdSurge, 12000 + Math.random() * 20000);
}
function crowdSurge(): void {
  crowdSurgeTimer = 0;
  const r = crowdRig();
  const bed = crowdBed;
  if (r === null || bed === null) return;
  const t = r.ctx.currentTime;
  bed.gain.cancelScheduledValues(t);
  bed.gain.setTargetAtTime(CROWD_LEVEL * 1.8, t, 0.7);
  bed.gain.setTargetAtTime(CROWD_LEVEL, t + 2.2, 1.1);
  crowdArm();
}

// The round's phase, as the shell last reported it. The module is TOLD
// rather than reaching into the page for it: that one dependency was the
// only thing tying this file to index.html, and inverting it is what let
// the file leave.
let roundPhase: RoundPhase = 'ready';

/** The rig, but only when the crowd should actually be singing. */
function crowdRig(): AudioRig | null {
  if (!crowdOn) return null;
  if (roundPhase !== 'playing' && roundPhase !== 'countdown') return null;
  return liveRig();
}

/**
 * Bring the crowd into line with the round. Idempotent, so no caller has to
 * reason about what the bed was already doing: it fades in through the
 * countdown and out on death, pause and menus.
 *
 * @param phase - the round's phase. Omit to re-apply the phase last given,
 *   which is what a settings change or a context wake wants.
 */
export function crowdSync(phase?: RoundPhase): void {
  if (phase !== undefined) roundPhase = phase;
  const wanted = crowdRig();
  // the bed is built on first want, but an existing bed must still be faded
  // DOWN when the crowd is no longer wanted, so fall back to the plain rig
  const r = wanted ?? liveRig();
  if (r === null) return;
  if (wanted !== null && crowdBed === null) crowdBuild(r);
  const bed = crowdBed;
  if (bed === null) return;
  if (wanted !== null) crowdTapeLoad(r);
  bed.gain.cancelScheduledValues(r.ctx.currentTime);
  bed.gain.setTargetAtTime(wanted === null ? 0 : CROWD_LEVEL, r.ctx.currentTime, wanted === null ? 0.4 : 0.8);
  if (wanted !== null) crowdArm();
  else if (crowdSurgeTimer) {
    clearTimeout(crowdSurgeTimer);
    crowdSurgeTimer = 0;
  }
}

/**
 * Lift the stand for a beat.
 *
 * @param k - loudness against the bed's own level.
 */
export function crowdPulse(k: number): void {
  const r = liveRig();
  const cheer = crowdCheer;
  if (cheer === null || !crowdOn || r === null) return;
  const t = r.ctx.currentTime;
  cheer.gain.cancelScheduledValues(t);
  cheer.gain.setTargetAtTime(k, t, 0.06);
  cheer.gain.setTargetAtTime(0, t + 0.3, 0.5);
}

/** The full-time whistle: one short, one long. */
export function sfxFullTime(): void {
  const r = liveRig();
  if (r === null) return;
  const at = r.ctx.currentTime;
  sfxPeep(r, at, 0.15, 1);
  sfxPeep(r, at + 0.28, 0.6, 1);
}

/**
 * Turn the page's sound on or off.
 *
 * A toggle press IS a user gesture, which is the only moment a browser will
 * let an AudioContext start, so turning it on wakes the context here rather
 * than waiting for the next tap. Turning it off suspends the context, which
 * parks the DSP and the audio session instead of leaving silence running.
 *
 * @param on - whether the page may make noise.
 */
export function setPageSound(on: boolean): void {
  pageSound = on;
  if (on) {
    audioHook();
    audioWake();
  } else if (rig !== null && rig.ctx.state === 'running') {
    void rig.ctx.suspend();
  }
}

/**
 * Turn the stadium crowd on or off, independently of the effects.
 *
 * @param on - whether the crowd may be heard.
 */
export function setCrowdOn(on: boolean): void {
  crowdOn = on;
  if (on) {
    audioHook();
    audioWake();
  }
  crowdSync();
}

/** Whether the page is allowed to make noise. */
export function isPageSoundOn(): boolean {
  return pageSound;
}

/** Whether the crowd is allowed to be heard. */
export function isCrowdOn(): boolean {
  return crowdOn;
}

export { audioHook, audioWake };
