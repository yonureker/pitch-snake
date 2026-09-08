// The kit's rules, tested against the BUILT module.
//
// WHY THE BUILD AND NOT THE SOURCE. page/build/*.js is what index.html loads
// and what a browser actually runs, and it is committed for exactly that
// reason. Testing kit.ts through a compiler would prove something true about a
// file nobody serves; this proves it about the bytes that ship, and it fails
// if the emit ever stops matching its source.
//
// WHY THESE RULES ARE WORTH A TEST AT ALL. kitNumbersFor decides which number
// every seat in a room wears, and every peer runs it independently over the
// same roster. If two peers disagree, nobody sees a crash: they simply paint
// different shirts on the same snakes, which is the worst kind of bug this
// codebase has (silent, cosmetic-looking, and impossible to reproduce from one
// screen). Determinism here is the whole contract.
//
// USAGE  node --test page/kit.test.js   (or npm test, which includes it)
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitColor, kitNumber, kitOf, kitNumbersFor } from './build/kit.js';

const VS_NUMS = [10, 7, 9, 4, 8];

test('kitColor accepts the forms people actually produce', () => {
  assert.equal(kitColor('#F2C114'), '#f2c114');      // the colour well's own output
  assert.equal(kitColor('f2c114'), '#f2c114');       // pasted without the hash
  assert.equal(kitColor('  #ABC  '), '#aabbcc');     // shorthand, expanded
  assert.equal(kitColor('#abc'), '#aabbcc');
});

test('kitColor washes anything that is not a colour to null', () => {
  for (const bad of ['', 'red', '#12345', '#1234567', 'javascript:x', null, undefined, 42, {}, []]) {
    assert.equal(kitColor(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('kitNumber keeps 0 and 99 and rejects everything outside', () => {
  assert.equal(kitNumber(0), 0, 'zero is a real shirt number, not an empty one');
  assert.equal(kitNumber(99), 99);
  assert.equal(kitNumber('7'), 7, 'a text field hands over strings');
  assert.equal(kitNumber(' 23 '), 23);
  for (const bad of [-1, 100, 4.5, NaN, Infinity, '', 'x', null, undefined, {}]) {
    assert.equal(kitNumber(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('kitOf never throws and never returns null, whatever a peer sends', () => {
  for (const junk of [null, undefined, 7, 'kit', [], { left: {} }]) {
    const kit = kitOf(junk);
    assert.equal(typeof kit, 'object');
    assert.equal(kit.left, null);
    assert.equal(kit.right, null);
    assert.equal(kit.num, null);
  }
  assert.deepEqual(kitOf({ left: '#fff', right: 'd8231f', num: '7' }),
    { left: '#ffffff', right: '#d8231f', num: 7 });
});

test('nobody choosing anything leaves the dealt numbers exactly as they were', () => {
  assert.deepEqual(kitNumbersFor([null, null, null, null, null], VS_NUMS), VS_NUMS);
});

test('a choice is honoured, and the seats around it keep their dealt numbers', () => {
  assert.deepEqual(kitNumbersFor([null, 23, null, null, null], VS_NUMS),
    [10, 23, 9, 4, 8]);
});

test('the lower lane wins a clash and the higher one falls back', () => {
  // both picked 10; lane 0 keeps it, lane 3's own dealt 4 is free so it is not
  // disturbed, and lane 1 has to leave 10 alone
  const out = kitNumbersFor([10, 10, null, null, null], VS_NUMS);
  assert.equal(out[0], 10);
  assert.notEqual(out[1], 10);
  assert.equal(new Set(out).size, 5, 'five seats, five distinct numbers');
});

test('a choice that collides with someone else\'s DEALT number still wins it', () => {
  // lane 4 picks 7, which is lane 1's dealt number: the choice outranks the
  // deal, and lane 1 is moved off it
  const out = kitNumbersFor([null, null, null, null, 7], VS_NUMS);
  assert.equal(out[4], 7);
  assert.notEqual(out[1], 7);
  assert.equal(new Set(out).size, 5);
});

test('five identical choices still produce five distinct shirts', () => {
  const out = kitNumbersFor([1, 1, 1, 1, 1], VS_NUMS);
  assert.equal(out[0], 1, 'the first lane keeps what it asked for');
  assert.equal(new Set(out).size, 5);
  for (const n of out) assert.ok(n >= 0 && n <= 99, `${n} is off the shirt`);
});

test('the answer depends only on the inputs, which is what keeps peers agreeing', () => {
  const chosen = [null, 7, 7, 0, null];
  const first = kitNumbersFor(chosen, VS_NUMS);
  for (let i = 0; i < 20; i++) assert.deepEqual(kitNumbersFor(chosen, VS_NUMS), first);
  assert.equal(first[3], 0, 'zero is a choice like any other and is not read as "none"');
});

test('a room smaller than five is answered at its own size', () => {
  assert.deepEqual(kitNumbersFor([null, null], VS_NUMS), [10, 7]);
  assert.deepEqual(kitNumbersFor([7, null], VS_NUMS), [7, 0]);
});
