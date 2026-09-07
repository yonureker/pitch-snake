#!/usr/bin/env node
/**
 * Stamp a content version onto everything index.html loads.
 *
 * WHY THIS EXISTS. GitHub Pages serves index.html with max-age=600 and every
 * other file with max-age=14400. A returning player therefore picks up a fresh
 * page ten minutes after a deploy while keeping its modules and stylesheets for
 * up to four hours. Whenever a deploy changes a module's exports, that pairing
 * is fatal rather than merely stale: a fresh index.html importing a name the
 * cached module does not export fails the whole module graph with a
 * SyntaxError, and the game does not boot at all. A blank page, for hours, for
 * exactly the players who came back. This was not theoretical; it was caught by
 * a headless run on a warm cache one deploy after `creditPurse` was added.
 *
 * The same trap is worse for packages/engine/engine.js, where a cached old
 * engine against a fresh page is a version mismatch that quietly refuses room
 * kickoffs and score submissions.
 *
 * So every URL index.html asks for carries ?v=<token>, where the token is a
 * hash of the CONTENT of all of them. Change any one file and every URL moves,
 * which over-invalidates (a CSS edit re-fetches the modules too) and is the
 * right trade: these files are small, and the alternative is a matrix of
 * half-updated caches nobody can reason about.
 *
 * The modules are versioned through an IMPORT MAP rather than by rewriting the
 * import statements. Two reasons. It reaches the imports BETWEEN modules
 * (shop.js asks for './dom.js', and that resolved URL is remapped too), which
 * rewriting index.html alone cannot do. And it leaves page/build/*.js exactly
 * as tsc emitted it, so the pre-commit drift check still compares generated
 * output against a clean rebuild instead of fighting a post-processing step.
 *
 * Run with --check to verify without writing, which is what the hook and CI do.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { globSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const PAGE = ROOT + 'index.html';

/** Everything whose staleness can break or mis-render the page. */
function versioned() {
  return [
    ...globSync('styles/*.css', { cwd: ROOT }),
    ...globSync('page/build/*.js', { cwd: ROOT }),
    'packages/engine/engine.js',
    'packages/net/net.js',
  ].sort();
}

/**
 * One token for the whole set: a hash of each file's own hash, so it moves when
 * any byte of any of them moves and never otherwise.
 *
 * @param files Repo-relative paths.
 * @returns Ten hex characters, which is plenty to separate deploys.
 */
function token(files) {
  const sum = createHash('sha256');
  for (const f of files) {
    sum.update(f);
    sum.update(createHash('sha256').update(readFileSync(ROOT + f)).digest('hex'));
  }
  return sum.digest('hex').slice(0, 10);
}

const MAP_OPEN = '<script type="importmap">';
const MAP_MARK = '<!-- module versions: written by scripts/stamp-assets.mjs -->';

/**
 * Rewrite index.html's stylesheet links and its import map for this token.
 *
 * @param html The current file.
 * @param files Repo-relative paths of everything versioned.
 * @param v The token.
 * @returns The file as it should be.
 */
function stamp(html, files, v) {
  // stylesheets: replace any existing ?v= rather than stacking them
  let out = html.replace(
    /(<link rel="stylesheet" href="\.\/styles\/[a-z-]+\.css)(\?v=[0-9a-f]+)?"/g,
    `$1?v=${v}"`,
  );

  const imports = {};
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    imports[`./${f}`] = `./${f}?v=${v}`;
  }
  const block =
    `${MAP_MARK}\n${MAP_OPEN}\n` +
    JSON.stringify({ imports }, null, 2) +
    '\n</script>';

  const existing = new RegExp(`${MAP_MARK}\\n<script type="importmap">[\\s\\S]*?</script>`);
  if (existing.test(out)) return out.replace(existing, block);

  // first publish of the map: it must precede every module script
  const anchor = '<script type="module">';
  const at = out.indexOf(anchor);
  if (at < 0) throw new Error('no module script in index.html');
  return out.slice(0, at) + block + '\n' + out.slice(at);
}

const files = versioned();
const v = token(files);
const before = readFileSync(PAGE, 'utf8');
const after = stamp(before, files, v);

if (process.argv.includes('--check')) {
  if (before !== after) {
    console.error(
      `index.html asset versions are stale (expected ?v=${v}).\n` +
        'Run: npm run stamp',
    );
    process.exit(1);
  }
  console.log(`asset versions current (v=${v}, ${files.length} files)`);
} else {
  if (before !== after) writeFileSync(PAGE, after);
  console.log(`stamped v=${v} across ${files.length} files`);
}
