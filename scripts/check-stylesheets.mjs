// Every rule you wrote must survive the browser's parser.
//
// WHY THIS EXISTS. The stylesheet lives in styles/*.css, split by concern.
// Adding a doc block to the top of one of those files absorbed the first two
// lines of the comment underneath it and left the third line stranded outside
// any comment, ending in a stray comment-close. That is not a no-op: CSS
// error recovery skips forward to the end of the next block, so the very next
// rule was silently discarded. The rule it ate was
// `.modal.boards { max-height: 86vh; }`, so the world board grew from a
// contained sheet to 4113 pixels in a 900 pixel viewport, and the rule AFTER
// it survived, which is why it read as a layout bug rather than a parse
// error.
//
// Nothing in this repo could catch that. The stylesheet split was proven by
// byte-identical concatenation, which is the right proof for the cascade and
// says nothing about a later edit. The page still rendered, so nothing threw.
// The asset check found every url() resolving perfectly well. A CSS parse
// error is silent by design: that is what error recovery IS.
//
// TWO CHECKS, one lexical and one from the browser itself.
//
//   1. No stray comment-close, no unterminated comment, balanced braces. This
//      is the exact shape of the bug above and it needs no browser.
//   2. The browser parsed as many blocks as the source declares. This is the
//      general form: whatever the malformation, a dropped rule shows up as
//      the CSSOM holding fewer rules than the file was written with.
//
// USAGE  node scripts/check-stylesheets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { report, withPage } from './browser-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'styles');

/**
 * Walk a stylesheet character by character, tracking comment and string
 * state, and report anything that would make a parser recover rather than
 * read. Also returns the number of `{` blocks the source actually declares.
 *
 * @param {string} css the stylesheet source.
 * @returns {{ faults: string[], blocks: number }}
 */
function lex(css) {
  const faults = [];
  let blocks = 0;
  let depth = 0;
  let line = 1;
  let inComment = false;
  let commentStartedAt = 0;
  let quote = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    const next = css[i + 1];
    if (ch === '\n') line++;
    if (inComment) {
      if (ch === '*' && next === '/') { inComment = false; i++; }
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '*') { inComment = true; commentStartedAt = line; i++; continue; }
    // a comment-close outside a comment is the bug this file was written for
    if (ch === '*' && next === '/') {
      faults.push(`line ${line}: a comment-close outside any comment. Everything up to the end of the next block is discarded by the parser.`);
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') { blocks++; depth++; }
    if (ch === '}') {
      depth--;
      if (depth < 0) { faults.push(`line ${line}: a closing brace with nothing open.`); depth = 0; }
    }
  }
  if (inComment) faults.push(`line ${commentStartedAt}: a comment is opened and never closed, so the rest of the file is invisible to the browser.`);
  if (quote !== null) faults.push(`a string is opened and never closed.`);
  if (depth > 0) faults.push(`${depth} block${depth === 1 ? '' : 's'} left open at end of file.`);
  return { faults, blocks };
}

const files = fs.readdirSync(STYLES).filter((f) => f.endsWith('.css')).sort();
const lines = [];
const expected = {};
for (const file of files) {
  const { faults, blocks } = lex(fs.readFileSync(path.join(STYLES, file), 'utf8'));
  expected[file] = blocks;
  if (faults.length === 0) {
    lines.push(`ok   ${file.padEnd(30)} ${String(blocks).padStart(3)} blocks`);
  } else {
    for (const fault of faults) lines.push(`FAIL ${file}: ${fault}`);
  }
}

// And the browser's own verdict: it must have kept every block the source
// declares. A rule the parser threw away shows up here as a shortfall.
await withPage({}, async ({ evaluate, sleep, goto }) => {
  await goto();
  await sleep(2500);
  const parsed = await evaluate(`(() => {
    const count = (rules) => {
      let n = 0;
      for (const rule of rules) {
        if (rule.cssRules) { n += 1 + count(rule.cssRules); }
        else n += 1;
      }
      return n;
    };
    const out = {};
    for (const sheet of document.styleSheets) {
      if (!sheet.href) continue;
      const name = sheet.href.split('/').pop().split('?')[0];
      try { out[name] = count(sheet.cssRules); } catch (e) { out[name] = -1; }
    }
    return out;
  })()`);
  for (const file of files) {
    const got = parsed[file];
    if (got === undefined) { lines.push(`FAIL ${file}: the page never loaded this stylesheet`); continue; }
    if (got === -1) { lines.push(`FAIL ${file}: its rules could not be read`); continue; }
    // @charset and @import carry no braces, so the browser can legitimately
    // hold a rule the brace count did not see; a SHORTFALL is the fault.
    if (got < expected[file]) {
      lines.push(`FAIL ${file}: source declares ${expected[file]} blocks, the browser kept ${got}. A rule was discarded.`);
    } else {
      lines.push(`ok   ${file.padEnd(30)} browser kept ${got}`);
    }
  }
});

// AFTER the browser is shut, never inside the body: report() ends the
// process, and a process that ends inside withPage never runs its cleanup.
report(lines);
