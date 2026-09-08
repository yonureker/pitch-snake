// What does one message actually cost on the wire?
//
// The room's feel is decided by ONE number: how long an input takes to reach a
// rival. That is `me -> relay` plus `relay -> peer`, so a client can measure
// its own half by bouncing a message off the relay and back (self-echo), which
// is exactly two of its own leg. This measures that half, for whichever wire
// is asked for, so a change of transport can be argued with numbers instead of
// impressions.
//
//   node scripts/wire-latency.mjs                     # today's wire, Supabase Broadcast
//   node scripts/wire-latency.mjs --wire=do           # the room object, through pitchsnake.com
//   node scripts/wire-latency.mjs --wire=do --origin=http://127.0.0.1:8787
//
// It reports the median and the 95th, because the median is what a round feels
// like and the tail is what a player remembers. Sends are paced so the numbers
// measure the wire rather than a queue this script built itself.
//
// @module
import WebSocket from 'ws';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const WIRE = args.get('wire') ?? 'broadcast';
const SAMPLES = Number(args.get('n') ?? 40);
const GAP_MS = Number(args.get('gap') ?? 120);
const ORIGIN = args.get('origin') ?? 'https://pitchsnake.com';
const CODE = (args.get('code') ?? 'PROBE').toUpperCase();

const SUPABASE_URL = 'https://vyqlwoqvsnxyziutmgqz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tbNA8JWlc3V9twrk2knWtg__g6-K8lj';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Median and 95th of a sample, in ms, rounded to one decimal. */
function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    n: sorted.length,
    min: +sorted[0].toFixed(1),
    p50: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
    mean: +mean.toFixed(1),
  };
}

/**
 * Bounce `SAMPLES` pings off Supabase Broadcast with self-delivery on, which
 * is one round trip to the relay and back.
 */
async function probeBroadcast() {
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const client = new RealtimeClient(SUPABASE_URL.replace(/^https/, 'wss') + '/realtime/v1', {
    params: { apikey: SUPABASE_KEY },
    // realtime-js reaches for a global WebSocket; node has one, but ws keeps
    // this identical to what the browser build does under the hood.
    transport: WebSocket,
  });
  const channel = client.channel('ps-probe-' + CODE, {
    config: { broadcast: { self: true, ack: false } },
  });
  const pending = new Map();
  const samples = [];
  channel.on('broadcast', { event: 'm' }, ({ payload }) => {
    const sentAt = pending.get(payload.i);
    if (sentAt === undefined) return;
    pending.delete(payload.i);
    samples.push(Number(process.hrtime.bigint() - sentAt) / 1e6);
  });
  const connectedAt = process.hrtime.bigint();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscribe timed out')), 15000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer); reject(new Error('subscribe: ' + status));
      }
    });
  });
  const joinMs = Number(process.hrtime.bigint() - connectedAt) / 1e6;
  for (let i = 0; i < SAMPLES; i++) {
    pending.set(i, process.hrtime.bigint());
    void channel.send({ type: 'broadcast', event: 'm', payload: { i, pad: 'x'.repeat(48) } });
    await sleep(GAP_MS);
  }
  await sleep(1500);
  channel.unsubscribe();
  client.disconnect();
  return { samples, joinMs, lost: SAMPLES - samples.length };
}

/**
 * Bounce pings off the room object. The relay never echoes to the sender (a
 * room has no use for its own messages), so this opens TWO sockets to the same
 * room: one sends, the other answers. That is the real path an input takes.
 */
async function probeRoomObject() {
  const url = ORIGIN.replace(/^http/, 'ws') + '/room/' + CODE;
  const open = (label) => new Promise((resolve, reject) => {
    // No Origin header on purpose: this is not a browser, and neither is the
    // app. The relay treats a missing Origin as honest and checks it only when
    // a browser sends one, which is the only thing the header can be worth.
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error(label + ': open timed out')), 15000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  const connectedAt = process.hrtime.bigint();
  const [a, b] = await Promise.all([open('a'), open('b')]);
  const joinMs = Number(process.hrtime.bigint() - connectedAt) / 1e6;
  // the far end answers every ping with the same id, so a is timing a full
  // send -> relay -> peer -> relay -> receive circuit: two relay legs each way
  b.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'ping') b.send(JSON.stringify({ t: 'pong', i: m.i }));
  });
  const pending = new Map();
  const samples = [];
  a.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t !== 'pong') return;
    const sentAt = pending.get(m.i);
    if (sentAt === undefined) return;
    pending.delete(m.i);
    samples.push(Number(process.hrtime.bigint() - sentAt) / 1e6);
  });
  for (let i = 0; i < SAMPLES; i++) {
    pending.set(i, process.hrtime.bigint());
    a.send(JSON.stringify({ t: 'ping', i, pad: 'x'.repeat(48) }));
    await sleep(GAP_MS);
  }
  await sleep(1500);
  a.close(); b.close();
  return { samples, joinMs, lost: SAMPLES - samples.length };
}

const started = new Date().toISOString();
const { samples, joinMs, lost } = WIRE === 'do' ? await probeRoomObject() : await probeBroadcast();
// HOW MANY LEGS EACH PROBE CROSSES, which is the whole of making the two
// comparable. A broadcast self-echo is me -> relay -> me: two legs. The object
// probe has no self-echo (a relay has no reason to send a room's own message
// back to it), so it goes a -> relay -> b -> relay -> a: four. Both ends are
// this same machine either way, so every leg is the same leg and the division
// is exact. What a ROUND actually pays is two legs, one input reaching one
// rival, and that is the number the two wires are judged on.
const LEGS = WIRE === 'do' ? 4 : 2;
if (samples.length === 0) {
  console.error('no samples came back: the wire never answered');
  process.exitCode = 1;
} else {
  const s = summarise(samples);
  console.log(JSON.stringify({
    wire: WIRE, at: started, origin: WIRE === 'do' ? ORIGIN : SUPABASE_URL,
    joinMs: +joinMs.toFixed(1), lost, legsMeasured: LEGS,
    circuitMs: s,
    oneLegMs: { p50: +(s.p50 / LEGS).toFixed(1), p95: +(s.p95 / LEGS).toFixed(1) },
    peerDeliveryMs: {
      p50: +((s.p50 / LEGS) * 2).toFixed(1),
      p95: +((s.p95 / LEGS) * 2).toFixed(1),
    },
  }, null, 2));
}
