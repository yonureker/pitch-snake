// What a room says about its own comings and goings, tested against the BUILT
// module.
//
// WHY THE BUILD AND NOT THE SOURCE. Same reason kit.test.js gives:
// page/build/*.js is what index.html imports and what a browser runs, and it
// is committed for exactly that reason. Proving something about the .ts would
// prove it about a file nobody serves.
//
// WHY THIS IS WORTH A TEST. The subtraction runs on every presence sync, which
// is every join, every leave, every reconnect and every ready toggle that
// happens to land with one. The failure that matters is not a crash: it is a
// wire blip announcing that four people left a room they are still sitting in,
// which looks exactly like a bug in the room and cannot be reproduced from the
// screen that saw it.
//
// USAGE  node --test page/room-notices.test.js   (or npm test, which includes it)
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, noticeLine, rosterChange, NOTICE_MS } from './build/room-notices.js';

const seat = (ref, name = ref.toUpperCase()) => ({ ref, name });
const ME = 'me';
const room = (...refs) => [seat(ME, 'ONUR'), ...refs.map((r) => seat(r))];

test('a settled room reports nothing', () => {
  const now = room('alex', 'jo');
  const change = rosterChange(now, now, ME);
  assert.deepEqual(change, { joined: [], gone: [] });
});

test('one arrival and one departure, named', () => {
  const before = room('alex');
  assert.deepEqual(rosterChange(before, room('alex', 'jo'), ME).joined, [{ ref: 'jo', name: 'JO' }]);
  assert.deepEqual(rosterChange(before, room(), ME).gone, [{ ref: 'alex', name: 'ALEX' }]);
});

test('several moving at once come back in one list', () => {
  const change = rosterChange(room('alex', 'jo', 'sam'), room('jo'), ME);
  assert.deepEqual(change.gone.map((s) => s.name), ['ALEX', 'SAM'], 'in the order the room had them');
  assert.equal(change.joined.length, 0);
});

test('I am never news to myself', () => {
  // my own ref arriving (the first track) and leaving (an unsubscribe) are
  // both things the person reading the line already knows
  assert.deepEqual(rosterChange([seat('alex')], room('alex'), ME), { joined: [], gone: [] },
    'a snapshot without me is not trusted at all, let alone as my own arrival');
  assert.deepEqual(rosterChange(room('alex'), room('alex'), ME).joined, []);
});

test('a snapshot that has lost ME is a dead socket, not an empty room', () => {
  // the reconnect gap: our own presence goes with the old join, and for one
  // sync the state can be missing everybody
  assert.deepEqual(rosterChange(room('alex', 'jo'), [], ME), { joined: [], gone: [] });
  assert.deepEqual(rosterChange(room('alex', 'jo'), [seat('alex')], ME), { joined: [], gone: [] },
    'a partial snapshot without me cannot say jo left');
});

test('walking into a full room is not an arrival party', () => {
  // the first sync a client ever sees carries everybody already there
  assert.deepEqual(rosterChange([], room('alex', 'jo', 'sam'), ME), { joined: [], gone: [] });
});

test('a peer-typed name is washed to something a line can hold', () => {
  assert.equal(displayName('alex'), 'ALEX');
  assert.equal(displayName('A'.repeat(200)), 'AAAAA', 'five characters, like every other name here');
  assert.equal(displayName('<script>'), 'SCRIP', 'markup is just letters here, and only five of them');
  for (const bad of [null, undefined, 42, {}, [], '', '   ', '!!!']) {
    assert.equal(displayName(bad), 'YOU', `expected the un-name for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(rosterChange(room('alex'), [seat(ME, 'ONUR'), seat('x', '  ')], ME).joined,
    [{ ref: 'x', name: 'YOU' }], 'a nameless joiner still gets a line');
});

test('the line counts once the names stop fitting a glance', () => {
  assert.equal(noticeLine('LEFT', []), '');
  assert.equal(noticeLine('LEFT', ['ALEX']), 'ALEX LEFT');
  assert.equal(noticeLine('JOINED', ['ALEX', 'JO']), 'ALEX AND JO JOINED');
  assert.equal(noticeLine('DROPPED', ['ALEX', 'JO', 'SAM']), 'ALEX AND 2 OTHERS DROPPED');
  assert.equal(noticeLine('LEFT', ['ALEX', 'JO', 'SAM', 'KIM']), 'ALEX AND 3 OTHERS LEFT');
});

test('the notice outlives a glance and not much more', () => {
  assert.ok(NOTICE_MS >= 4000 && NOTICE_MS <= 10000, 'long enough to read once, short enough to go');
});
