// The shared plumbing for the checks that need a real browser.
//
// This repo has no browser test framework and does not want one: there is no
// build step, and a driver is a dependency the page does not carry. What it
// needs instead is a way to open the real index.html, drive it, and read
// something back. That is CDP over a websocket, which `ws` already provides
// because the netcode tests use it.
//
// THREE THINGS THAT ARE NOT OPTIONAL, each learned by getting them wrong:
//
//   --mute-audio        the page really does play crowd noise and whistles,
//                       and whoever is running this is usually listening to
//                       something else.
//   a UNIQUE profile    launching Chrome against a --user-data-dir that a live
//                       process already holds does not start a second browser:
//                       it forwards the command line to the running one, which
//                       opens a REAL window on the desktop and steals focus.
//                       That is what a stray window during a test run always
//                       is, not headless mode misbehaving.
//   run EXCLUSIVELY     a second tab makes the first one hidden, which stops
//                       its rAF and trips the page's own hidden-tab pause. The
//                       round freezes and the failure reads like a page bug.
//
// @module
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Chrome picks the debug port, and we read back the one it chose.
//
// This used to be a fixed 9412, which is fine for one browser and a trap for
// a run that opens several in a row. Chrome does not release the port the
// instant it is killed, so the NEXT launch failed to bind, and the wait loop
// then connected happily to the DYING previous browser: same port, different
// process, previous profile, and none of the pre-load scripts this run had
// installed. It presented as a page that rendered two different pictures at
// random, and cost most of an afternoon being mistaken for a clock problem in
// the page. With port 0 every browser is unambiguously its own.

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain',
};

const CHROME = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serve the checkout on a fixed local port for the duration of a run. */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(ROOT, rel === '/' ? '/index.html' : rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); } });
    });
  });
}

async function launchChrome() {
  if (!CHROME) {
    throw new Error('no Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pitch-snake-check-'));
  const child = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--noerrdialogs', '--disable-gpu', '--disable-extensions',
    '--no-default-browser-check',
    // the toggles the page's audio path needs, and the mute that makes it bearable
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    // if a window ever does appear, it appears where nobody has to see it
    '--window-position=-32000,-32000',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
  // Chrome writes the port it actually took into its own profile directory,
  // which is the only way to know it without guessing.
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    try {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) return { child, profile, port };
      }
    } catch { /* not listening yet; that is what the loop is for */ }
  }
  child.kill();
  throw new Error('Chrome did not open a debug port within 24s');
}

/**
 * Open one page, hand it to `body`, and clean everything up afterwards.
 *
 * @param {object} options
 * @param {string} [options.path] page to open, relative to the checkout.
 * @param {number} [options.width] viewport width.
 * @param {number} [options.height] viewport height.
 * @param {string} [options.beforeLoad] script to run before ANY page script.
 * @param {string[]} [options.block] URL patterns to refuse.
 * @param {(api: object) => Promise<unknown>} body what to do with the page.
 * @returns {Promise<unknown>} whatever `body` returned.
 */
export async function withPage(options, body) {
  const { path: page = '/index.html', width = 1512, height = 900, beforeLoad, block } = options;
  const server = await serve();
  const chrome = await launchChrome();
  const target = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const thrown = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      thrown.push(details.exception?.description ?? details.text);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  if (block) await send('Network.setBlockedURLs', { urls: block });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: height > width });
  if (height > width) await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
  if (beforeLoad) await send('Page.addScriptToEvaluateOnNewDocument', { source: beforeLoad });

  /** Evaluate an expression in the page; throws what the page throws. */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  try {
    const url = server.origin + page;
    return await body({ evaluate, send, sleep, thrown, url, goto: async () => send('Page.navigate', { url }) });
  } finally {
    ws.close();
    try { await fetch(`http://127.0.0.1:${chrome.port}/json/close/${target.id}`); } catch { /* closing anyway */ }
    server.close();
    // wait for Chrome to actually exit before removing its profile: it is
    // still writing when kill() returns, and a half-written profile makes
    // rmSync throw ENOTEMPTY. A leftover directory in the OS temp dir is not
    // worth failing a check over either, so the removal is best-effort.
    await new Promise((resolve) => {
      chrome.child.once('exit', resolve);
      chrome.child.kill();
      setTimeout(resolve, 3000);
    });
    try {
      fs.rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { /* tmp gets swept anyway */ }
  }
}

/** Print results and exit non-zero if any line failed. */
export function report(lines) {
  console.log(lines.join('\n'));
  const failed = lines.some((line) => line.startsWith('FAIL'));
  console.log(failed ? 'FAILURES' : 'ALL PASS');
  process.exit(failed ? 1 : 0);
}

/** A pass/fail line, so every check prints the same shape. */
export function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  return `${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`;
}
