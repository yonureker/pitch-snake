#!/usr/bin/env node
/**
 * Minify the page's modules into page/build, the second half of `build:page`.
 *
 * WHAT SHIPS IS NOT WHAT IS EDITED. tsc emits readable JavaScript with every
 * doc comment intact, and it emits a .js.map beside each file, which devtools
 * follows to reconstruct the original TypeScript, comments and all. So moving
 * a block out of index.html and into page/ used to make it MORE legible to
 * whoever opened the Sources panel, not less. This stage is what makes an
 * extraction a reduction in what the page hands out.
 *
 * BE HONEST ABOUT WHAT THIS IS NOT. It is not concealment and cannot be: this
 * repo is public, a push is the deploy, and the validator imports the engine
 * from jsDelivr by commit, so the .ts sitting next door is a click away for
 * anyone who wants it. Nothing in the page is a secret by design either (see
 * leaderboard.sql rule 1, and the validator that recomputes every score). This
 * stage decides what the SHIPPED ARTEFACT is, and the shipped artefact has no
 * business being an annotated tour of the game's internals.
 *
 * TWO STAGES, NEVER ONE. tsc writes page/.tsc (gitignored) and this writes
 * page/build from it. Minifying page/build in place would feed the build its
 * own output, and page/build is committed and drift-checked against a clean
 * rebuild by both the hook and CI: an artefact built from itself cannot be
 * compared with one built from source. Every byte in page/build therefore comes
 * from a .ts file every time.
 *
 * TERSER, NOT ESBUILD. CI installs with `npm ci --ignore-scripts`, so a
 * minifier that unpacks a native binary in a postinstall script would simply
 * not be there. terser is pure JavaScript, it was already in the tree under
 * Expo, and it is pinned in package.json rather than borrowed from a transitive
 * dependency that an Expo upgrade could drop.
 *
 * THE SOURCE MAP IS WRITTEN AND NOT SHIPPED. It lands in the staging directory
 * with no sourceMappingURL pointing at it, so nothing serves it and devtools
 * cannot find it. It exists for the day error-reporting.ts is given a DSN:
 * Sentry wants the map uploaded to Sentry, which is not the same thing as
 * publishing it beside the code.
 */
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { minify } from 'terser';

const ROOT = new URL('..', import.meta.url).pathname;
const STAGE = ROOT + 'page/.tsc/';
const OUT = ROOT + 'page/build/';

/**
 * Terser's settings, which are part of the contract rather than taste.
 *
 * `module` tells it these are ES modules, which is what lets `toplevel`
 * mangling rename module-private names while leaving every EXPORTED name
 * alone: `index.html` imports `initShop` by name through an import map, and a
 * renamed export would be a page that does not boot. `ecma: 2022` matches the
 * tsconfig target, so nothing is down-levelled behind the compiler's back.
 */
const TERSER = {
  ecma: 2022,
  module: true,
  compress: { passes: 2 },
  mangle: { toplevel: true },
  format: { comments: false },
};

/**
 * Minify one staged module into page/build.
 *
 * @param {string} file Bare filename, e.g. `shop.js`.
 * @returns {Promise<void>}
 */
async function build(file) {
  const code = readFileSync(STAGE + file, 'utf8');
  let content;
  try {
    content = readFileSync(STAGE + file + '.map', 'utf8');
  } catch {
    content = undefined;                      // maps are a convenience, never a requirement
  }
  const result = await minify(
    { [file]: code },
    // No `url`, so terser appends no sourceMappingURL: the map is produced for
    // an upload, not for the browser to follow.
    { ...TERSER, sourceMap: content ? { content } : false },
  );
  if (typeof result.code !== 'string') throw new Error(`terser produced nothing for ${file}`);
  writeFileSync(OUT + file, result.code + '\n');
  if (typeof result.map === 'string') writeFileSync(STAGE + file + '.min.map', result.map);
}

const staged = globSync('*.js', { cwd: STAGE }).sort();
if (staged.length === 0) throw new Error('page/.tsc is empty: did tsc run?');
mkdirSync(OUT, { recursive: true });
await Promise.all(staged.map(build));

// Sweep what no longer has a source. A deleted page/*.ts used to leave its
// build/*.js behind for ever, and a ghost module is worse than a missing one:
// the stamper still hashes it into the version token and the import map still
// offers it.
const wanted = new Set(staged);
for (const stale of globSync('*.js*', { cwd: OUT })) {
  if (!wanted.has(basename(stale))) rmSync(OUT + stale);
}

console.log(`minified ${staged.length} page modules into page/build`);
