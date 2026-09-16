// The skins and their textures, tested against the BUILT modules.
//
// WHY THE BUILD AND NOT THE SOURCE. Same reason kit.test.js gives: build/ is
// what both clients import and what actually ships; proving something about
// the .ts would prove it about files nobody serves.
//
// WHY THIS IS WORTH A TEST. The shop sells IDS, and three tables have to
// agree about them: the SQL catalogue, this skin table, and the texture
// painters the skins name. A skin naming a painter that does not exist would
// not crash anything anywhere - both clients fall back to "no texture" by
// design - so the first person to notice a silent mismatch would be the
// buyer of a 900-coin skin that arrives plain. That is a refund ticket, not
// a stack trace, which is exactly the kind of failure a test exists for.
//
// USAGE  node --test packages/cosmetics/skin-art.test.js  (or npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, skinFor, shadeRgbFor, SNAKE_SHADES } from './build/skin-art.js';
import { SKIN_TEXTURES, textureFor } from './build/skin-texture.js';

// A counting stub of the HatSurface dialect: enough canvas semantics for a
// painter to run headless, and a tally of what it actually painted.
function stubSurface() {
  const counts = { fills: 0, strokes: 0, rects: 0 };
  return {
    counts,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    closePath() {},
    fill() { counts.fills++; },
    stroke() { counts.strokes++; },
    fillRect() { counts.rects++; },
  };
}

const PATTERN_DROP = [
  'skin-spot', 'skin-pinstripe', 'skin-crosshatch', 'skin-zigzag', 'skin-chequer',
  'skin-roundel', 'skin-argyle',
  'skin-scale', 'skin-wave', 'skin-ocelli', 'skin-diamondback', 'skin-mosaic',
];

test('every skin of the pattern drop exists and resolves by id', () => {
  for (const id of PATTERN_DROP) {
    assert.ok(id in SKINS, `${id} missing from SKINS`);
    assert.notEqual(skinFor(id), SKINS.classic, `${id} fell back to classic`);
    assert.ok(skinFor(id).texture, `${id} carries no texture`);
  }
});

test('every texture a skin names has a painter behind it', () => {
  for (const [id, skin] of Object.entries(SKINS)) {
    if (skin.texture === undefined) continue;
    assert.ok(textureFor(skin.texture.id) !== null,
      `${id} names texture '${skin.texture.id}', which has no painter`);
  }
});

test('every painter runs headless and actually paints', () => {
  for (const [id, painter] of Object.entries(SKIN_TEXTURES)) {
    for (const size of [14, 28, 80]) {           // phone cell, desktop cell, preview
      const c = stubSurface();
      painter(c, size, '#123456', '#654321');
      const marks = c.counts.fills + c.counts.strokes + c.counts.rects;
      assert.ok(marks > 0, `'${id}' painted nothing at size ${size}`);
    }
    // a motif with a second colour must survive being handed only one
    const lone = stubSurface();
    painter(lone, 28, '#123456', null);
    assert.ok(lone.counts.fills + lone.counts.strokes + lone.counts.rects > 0,
      `'${id}' needs ink2 to paint at all`);
  }
});

test('an unknown id still wears classic, texture and all', () => {
  assert.equal(skinFor('skin-from-next-month'), SKINS.classic);
  assert.equal(skinFor(null), SKINS.classic);
  assert.equal(textureFor('a-motif-nobody-drew'), null);
  assert.equal(textureFor(null), null);
});

test('shadeRgbFor is deterministic, clamped, and rings still ring', () => {
  const cherry = skinFor('skin-cherry');
  assert.deepEqual(shadeRgbFor(cherry, 0.37), shadeRgbFor(cherry, 0.37));
  assert.deepEqual(shadeRgbFor(cherry, -5), shadeRgbFor(cherry, 0), 'clamped below');
  assert.deepEqual(shadeRgbFor(cherry, 5), shadeRgbFor(cherry, 1), 'clamped above');
  // a ringed skin changes colour along the body; a flat ramp shades smoothly
  const a = shadeRgbFor(cherry, 0.1).join(',');
  const b = shadeRgbFor(cherry, 0.35).join(',');
  assert.notEqual(a, b, 'the rings went flat');
  assert.ok(SNAKE_SHADES === 64, 'renderers size their tables by this');
});
