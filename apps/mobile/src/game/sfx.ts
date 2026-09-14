/**
 * The game's sound effects, the page's synth vocabulary as bundled clips.
 *
 * The page (page/sound-and-crowd.ts) synthesises every effect from
 * oscillators at trigger time. React Native has no Web Audio API, so the app
 * cannot; instead scripts/gen-sfx.mjs renders each of those effects to a WAV
 * offline, sample for sample, and this module plays them through expo-audio.
 * The two clients therefore make the same noises from the same events.
 *
 * One player per effect, created on first use and reused: a retrigger seeks
 * to zero and plays again, so the newest of a rapid run wins rather than the
 * app spawning a player per tap. That is the one deliberate difference from
 * the page, where identical sfx stack; on a phone a single retriggered clip
 * is cheaper and reads the same.
 *
 * MUST NEVER decide anything about gameplay, throw outward, or touch the
 * frame budget beyond a play() call. A device that refuses audio ends with a
 * quiet game, never a broken one: every call is wrapped, and the whole layer
 * is gated by a boolean the settings sheet owns.
 *
 * @module
 */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import bonus from '@/assets/sfx/bonus.wav';
import crash from '@/assets/sfx/crash.wav';
import eat from '@/assets/sfx/eat.wav';
import flourish from '@/assets/sfx/flourish.wav';
import fulltime from '@/assets/sfx/fulltime.wav';
import ghostin from '@/assets/sfx/ghostin.wav';
import hop from '@/assets/sfx/hop.wav';
import kickoff from '@/assets/sfx/kickoff.wav';
import portalopen from '@/assets/sfx/portalopen.wav';
import save from '@/assets/sfx/save.wav';
import tick from '@/assets/sfx/tick.wav';
import tnt from '@/assets/sfx/tnt.wav';
import wallsolid from '@/assets/sfx/wallsolid.wav';
import wallwarn from '@/assets/sfx/wallwarn.wav';
import zap from '@/assets/sfx/zap.wav';

/** The vocabulary, matching the page's exported sfx names. */
export type SfxName =
  | 'eat'
  | 'bonus'
  | 'hop'
  | 'tnt'
  | 'wallwarn'
  | 'wallsolid'
  | 'portalopen'
  | 'ghostin'
  | 'crash'
  | 'flourish'
  | 'tick'
  | 'save'
  | 'zap'
  | 'kickoff'
  | 'fulltime';

const SOURCES: Record<SfxName, number> = {
  eat,
  bonus,
  hop,
  tnt,
  wallwarn,
  wallsolid,
  portalopen,
  ghostin,
  crash,
  flourish,
  tick,
  save,
  zap,
  kickoff,
  fulltime,
};

/**
 * The pentatonic ladder the eat note climbs as a streak builds, the page's
 * PENTA. Each step is a semitone offset; a clip plays back at 2^(n/12) so the
 * one baked eat clip covers the whole ladder without five files.
 */
const EAT_LADDER = [0, 2, 4, 7, 9];

const players = new Map<SfxName, AudioPlayer>();
let enabled = true;

/** Turn the whole sfx layer on or off; the SOUND row calls this. */
export function setSfxEnabled(on: boolean): void {
  enabled = on;
}

/** Every effect name, listed once so priming needs no cast over SOURCES. */
const ALL_SFX: SfxName[] = [
  'eat',
  'bonus',
  'hop',
  'tnt',
  'wallwarn',
  'wallsolid',
  'portalopen',
  'ghostin',
  'crash',
  'flourish',
  'tick',
  'save',
  'zap',
  'kickoff',
  'fulltime',
];
/**
 * Create every player once, up front, OFF the gameplay hot path.
 *
 * This is not just a warm cache: creating a player is synchronous native
 * work (allocation, and the source decode), and doing it lazily meant the
 * FIRST use of each effect paid that cost inside the frame that fired it. On
 * the first bonus that frame already does the most work of any (thirty
 * particles, the +5 float), and the added stall was enough to desync the JS
 * and render threads, at which point the loop's two-frames-late SkPicture
 * dispose could free a picture the render thread was still replaying, which
 * is the native-only "Attempted to access a disposed object" crash reported
 * on eating a five-point emoji. Priming at mount moves all of that off the
 * round entirely; a trigger then only seeks and plays.
 *
 * Idempotent and swallowed: a device that will not build a player simply has
 * no sound for it, never a crash.
 */
export function primeSfx(): void {
  for (const name of ALL_SFX) playerFor(name);
}

function playerFor(name: SfxName): AudioPlayer | null {
  const existing = players.get(name);
  if (existing) return existing;
  try {
    const p = createAudioPlayer(SOURCES[name]);
    // pitch shifting is used for the eat ladder; let the pitch move with rate
    p.shouldCorrectPitch = false;
    players.set(name, p);
    return p;
  } catch {
    return null;
  }
}

/**
 * Play one effect.
 *
 * @param name - which effect.
 * @param vol - loudness 0..1; a rival's events in a room pass a lower one,
 *   exactly as the page dims them behind your own.
 * @param rate - playback rate, used only to pitch the eat note up the ladder.
 */
export function playSfx(name: SfxName, vol = 1, rate = 1): void {
  if (!enabled) return;
  const p = playerFor(name);
  if (p === null) return;
  try {
    p.volume = Math.max(0, Math.min(1, vol));
    if (rate !== 1) p.playbackRate = rate;
    void p.seekTo(0);
    p.play();
  } catch {
    // a device that will not play this one still plays the game
  }
}

/** The eat note at its streak position, the page's sfxEat(step). */
export function playEat(streak: number, vol = 1): void {
  const step = ((streak % 5) + 5) % 5;
  const semis = EAT_LADDER[step] ?? 0;
  playSfx('eat', vol, Math.pow(2, semis / 12));
}
