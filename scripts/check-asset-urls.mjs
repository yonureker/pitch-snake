// Every URL the page loads must resolve. Nothing here needs a browser.
//
// WHY THIS EXISTS. The inline <style> block was split into styles/*.css and
// proven safe by concatenating the files back and checking they were
// byte-identical to the original. That is the right proof for the CASCADE,
// which was the risk being guarded against, and it is blind to exactly one
// thing: a url() is the one thing in CSS whose meaning depends on which file
// it sits in. A relative url() resolves against the STYLESHEET, not the
// document, so `url(assets/flags.png)` was correct while inline and became
// `styles/assets/flags.png` the moment it moved. Every flag on the site was a
// 404 for hours. Nothing threw, nothing logged, and the page's own flag test
// reported a pass throughout, because it asserted background-POSITION
// arithmetic and never that the picture arrived. Arithmetic is perfectly
// happy pointing at a 404.
//
// A missing image is not an error. For that whole class, assert on status
// codes, never on "did it throw".
//
// USAGE
//   node scripts/check-asset-urls.mjs                  serves the checkout itself
//   node scripts/check-asset-urls.mjs --origin <url>   checks a deployed origin
//
// In CI, run it WITHOUT --origin. A job that fetches the live site fails on a
// CDN hiccup, on a deploy racing the run, and on any fork PR, and a gate that
// cries wolf gets switched off within a fortnight. Point it at the checkout,
// where a red means the repo is wrong. Keep the live run manual or scheduled,
// where a red means the DEPLOY is wrong, which is a different question worth
// asking separately.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_TIMEOUT_MS = 10_000;

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain',
};

/** Serve the checkout on an ephemeral port, so the check needs no setup. */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // no traversal: a path that escapes the checkout is a 403, not a read
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); } });
    });
  });
}

/** Every relative url() in every stylesheet, resolved as a browser would. */
function stylesheetRefs(origin) {
  const out = [];
  const dir = path.join(ROOT, 'styles');
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    // comments stripped first: this repo documents its own past bugs by
    // quoting the broken URL, and a scanner that reads comments reports the
    // fix as the bug
    const css = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const ref = match[1].trim();
      if (ref.startsWith('data:') || ref.startsWith('http')) continue;
      // resolved against the STYLESHEET, which is the whole point
      out.push({ url: new URL(ref, `${origin}/styles/${file}`).toString(), from: `styles/${file}` });
    }
  }
  return out;
}

/** Everything index.html pulls in: stylesheets, modules, images. */
function pageRefs(origin) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/from\s+'(\.\/[^']+)'/g)) refs.add(m[1]);
  const out = [];
  for (const ref of refs) {
    if (ref.startsWith('data:') || ref.startsWith('http') || ref.startsWith('#')) continue;
    out.push({ url: new URL(ref, `${origin}/index.html`).toString(), from: 'index.html' });
  }
  return out;
}

const originArg = process.argv.indexOf('--origin');
const live = originArg !== -1 ? process.argv[originArg + 1] : null;
const server = live === null ? await serve() : null;
const origin = live ?? server.origin;

// Checked concurrently, not one after another. Sequentially, a slow origin
// costs 23 timeouts back to back; in parallel the whole check costs one.
async function checkOne(ref) {
  // every call carries an abort timer, for the same reason every call in the
  // page does: a request that never answers must not hang the thing waiting on
  // it. A live origin behind a bad network is exactly where this bites.
  const abort = new AbortController();
  const timer = setTimeout(() => { abort.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ref.url, { headers: { 'Cache-Control': 'no-cache' }, signal: abort.signal });
    const type = res.headers.get('content-type') ?? '';
    // A 200 that is really the host's own HTML is a miss dressed as a hit, and
    // it is how the flags 404 actually presented.
    const htmlFallback = type.includes('text/html') && !ref.url.endsWith('.html');
    if (res.ok && !htmlFallback) return { ok: true, line: `ok   ${res.status}  ${ref.url.replace(origin, '')}` };
    return { ok: false, line: `FAIL ${res.status}${htmlFallback ? ' (html fallback)' : ''}  ${ref.url}\n       referenced by ${ref.from}` };
  } catch (e) {
    const why = e.name === 'AbortError' ? `no answer in ${REQUEST_TIMEOUT_MS}ms` : String(e.message);
    return { ok: false, line: `FAIL unreachable  ${ref.url}\n       referenced by ${ref.from}: ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all([...stylesheetRefs(origin), ...pageRefs(origin)].map(checkOne));
const lines = results.map((r) => r.line);
const bad = results.filter((r) => !r.ok).length;
server?.close();

console.log(lines.sort().join('\n'));
console.log(`\nchecked ${lines.length} references against ${live ?? 'the checkout'}`);
if (bad > 0) {
  console.log(`FAILURES: ${bad} did not resolve`);
  process.exit(1);
}
console.log('ALL PASS');
