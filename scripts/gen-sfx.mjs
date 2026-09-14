/**
 * Offline synthesiser for the app's sound effects.
 *
 * Reproduces the web's Web Audio graph (page/sound-and-crowd.ts) sample by
 * sample and writes each effect to a small mono WAV under
 * apps/mobile/assets/sfx. React Native has no Web Audio API, so the app
 * cannot synthesise these at trigger time the way the page does; it plays
 * these pre-rendered clips through expo-audio instead. Same envelopes, same
 * frequencies, same oscillator shapes, so the two clients sound alike.
 *
 * Run: node scripts/gen-sfx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 32000; // 32 kHz mono is ample for short chiptune sfx and half the size
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/mobile/assets/sfx');
const MASTER = 0.35; // the web's master gain

// exponential interpolation, the shape Web Audio's exponentialRampToValueAtTime draws
const expAt = (t, t0, v0, t1, v1) => {
  if (t <= t0) return v0;
  if (t >= t1) return v1;
  const a = Math.max(1e-6, v0), b = Math.max(1e-6, v1);
  return a * Math.pow(b / a, (t - t0) / (t1 - t0));
};
const linAt = (t, t0, v0, t1, v1) =>
  t <= t0 ? v0 : t >= t1 ? v1 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0));

// naive band-limited-ish oscillators; game sfx, aliasing is character not fault
function osc(type, phase) {
  const p = phase % (2 * Math.PI);
  switch (type) {
    case 'sine': return Math.sin(p);
    case 'square': return Math.sin(p) >= 0 ? 1 : -1;
    case 'sawtooth': return p / Math.PI - 1;
    case 'triangle': return 2 * Math.abs(p / Math.PI - 1) - 1;
    default: return Math.sin(p);
  }
}

/** A buffer long enough for the whole effect plus a short tail. */
function makeBuf(seconds) {
  return new Float32Array(Math.ceil((seconds + 0.05) * SR));
}

// sfxTone: one oscillator, freq exp-ramp f0->f1 over dur, gain env
// 0.0001 ->(exp,+0.012) peak ->(exp,+dur) 0.0001
function tone(buf, type, f0, f1, at, dur, peak) {
  const n0 = Math.floor(at * SR);
  const n1 = Math.min(buf.length, Math.ceil((at + dur + 0.02) * SR));
  let phase = 0;
  for (let n = n0; n < n1; n++) {
    const t = n / SR;
    const f = f1 === f0 ? f0 : expAt(t, at, f0, at + dur, Math.max(1, f1));
    phase += (2 * Math.PI * f) / SR;
    let g;
    if (t < at + 0.012) g = expAt(t, at, 0.0001, at + 0.012, peak);
    else g = expAt(t, at + 0.012, peak, at + dur, 0.0001);
    buf[n] += osc(type, phase) * g;
  }
}

// a one-pole-ish RBJ lowpass, coefficients recomputed as the cutoff ramps;
// fed white noise. Models sfxBoom: noise through a falling lowpass.
function boom(buf, at, dur, peak, f0, f1) {
  const n0 = Math.floor(at * SR);
  const n1 = Math.min(buf.length, Math.ceil((at + dur + 0.02) * SR));
  const Q = 0.707;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = n0; n < n1; n++) {
    const t = n / SR;
    const fc = expAt(t, at, f0, at + dur, Math.max(40, f1));
    const w0 = (2 * Math.PI * fc) / SR;
    const cosw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
    const b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2;
    const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
    const x0 = Math.random() * 2 - 1;
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    let g;
    if (t < at + 0.01) g = expAt(t, at, 0.0001, at + 0.01, peak);
    else g = expAt(t, at + 0.01, peak, at + dur, 0.0001);
    buf[n] += y0 * g;
  }
}

// sfxPeep: square 2093->2160 (linear), AM by a 42Hz sine (0.1..1.0), env
function peep(buf, at, dur, vol) {
  const n0 = Math.floor(at * SR);
  const n1 = Math.min(buf.length, Math.ceil((at + dur + 0.02) * SR));
  let phase = 0, lfoPhase = 0;
  const hold = at + Math.max(0.03, dur - 0.03);
  for (let n = n0; n < n1; n++) {
    const t = n / SR;
    const f = linAt(t, at, 2093, at + dur, 2160);
    phase += (2 * Math.PI * f) / SR;
    lfoPhase += (2 * Math.PI * 42) / SR;
    const am = 0.55 + 0.45 * Math.sin(lfoPhase);
    let env;
    if (t < at + 0.02) env = expAt(t, at, 0.0001, at + 0.02, 0.4 * vol);
    else if (t < hold) env = 0.4 * vol;
    else env = expAt(t, hold, 0.4 * vol, at + dur, 0.0001);
    buf[n] += (Math.sin(phase) >= 0 ? 1 : -1) * am * env;
  }
}

// master gain + a soft limiter standing in for the web's DynamicsCompressor
function finish(buf) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] * MASTER;
    out[i] = Math.tanh(v * 1.4) / 1.1; // gentle knee, no hard clip
  }
  return out;
}

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
  let peak = 0; for (const s of samples) peak = Math.max(peak, Math.abs(s));
  console.log('  ' + name.padEnd(16), (buf.length / 1024).toFixed(1) + 'KB', 'peak', peak.toFixed(2));
}

// ---- the vocabulary, one WAV each (the web's functions, vol=1) ----
const effects = {
  eat() { const b = makeBuf(0.09); tone(b, 'square', 523, 523, 0, 0.09, 0.4); tone(b, 'triangle', 1046, 1046, 0, 0.07, 0.22); return b; },
  bonus() { const b = makeBuf(0.24); [659, 880, 1319].forEach((f, i) => { tone(b, 'square', f, f, i * 0.06, 0.14, 0.32); tone(b, 'triangle', f * 2, f * 2, i * 0.06, 0.12, 0.16); }); return b; },
  hop() { const b = makeBuf(0.26); tone(b, 'sawtooth', 1500, 220, 0, 0.16, 0.25); tone(b, 'sine', 400, 1400, 0.1, 0.16, 0.3); return b; },
  tnt() { const big = 1 + 5 * 0.08; const b = makeBuf(0.32 * big); boom(b, 0, 0.3 * big, 0.8, 1100, 120); tone(b, 'sine', 130, 38, 0, 0.32 * big, 0.8); return b; },
  wallwarn() { const b = makeBuf(0.35); tone(b, 'sawtooth', 170, 150, 0, 0.13, 0.3); tone(b, 'sawtooth', 170, 150, 0.22, 0.13, 0.3); return b; },
  wallsolid() { const b = makeBuf(0.16); tone(b, 'sine', 100, 45, 0, 0.16, 0.6); boom(b, 0, 0.07, 0.25, 2500, 500); return b; },
  portalopen() { const b = makeBuf(0.35); tone(b, 'triangle', 1250, 1250, 0, 0.3, 0.1); tone(b, 'triangle', 1875, 1875, 0.05, 0.3, 0.08); return b; },
  ghostin() { const b = makeBuf(0.5); tone(b, 'sine', 170, 540, 0, 0.5, 0.22); tone(b, 'triangle', 255, 810, 0.06, 0.44, 0.1); return b; },
  crash() { const b = makeBuf(0.55); tone(b, 'sawtooth', 240, 50, 0, 0.55, 0.5); boom(b, 0, 0.4, 0.5, 900, 100); return b; },
  flourish() { const b = makeBuf(0.68); [523, 659, 784, 1047].forEach((f, i) => tone(b, 'square', f, f, i * 0.07, 0.14, 0.3)); tone(b, 'square', 1047, 1047, 0.28, 0.4, 0.25); tone(b, 'square', 1319, 1319, 0.28, 0.4, 0.2); return b; },
  tick() { const b = makeBuf(0.05); tone(b, 'square', 1050, 1050, 0, 0.05, 0.22); return b; },
  save() { const b = makeBuf(0.14); tone(b, 'sine', 480, 1040, 0, 0.13, 0.35); tone(b, 'triangle', 960, 2080, 0.03, 0.11, 0.18); return b; },
  zap() { const b = makeBuf(0.5); boom(b, 0, 0.16, 0.5, 6000, 900); tone(b, 'square', 1750, 300, 0, 0.22, 0.3); tone(b, 'sine', 300, 120, 0.1, 0.4, 0.25); return b; },
  kickoff() { const b = makeBuf(0.3); peep(b, 0, 0.3, 1); return b; },
  fulltime() { const b = makeBuf(0.9); peep(b, 0, 0.15, 1); peep(b, 0.28, 0.6, 1); return b; },
};

fs.mkdirSync(OUT, { recursive: true });
console.log('rendering sfx at ' + SR + ' Hz mono into ' + OUT);
let total = 0;
for (const [name, fn] of Object.entries(effects)) {
  const wav = finish(fn());
  writeWav(name + '.wav', wav);
  total += 44 + wav.length * 2;
}
console.log('total', (total / 1024).toFixed(1) + 'KB across ' + Object.keys(effects).length + ' files');
