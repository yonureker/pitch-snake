// Pitch Snake: the pitchsnake.com router.
//
// A Cloudflare Worker (the false9-router pattern) that serves the game at
// pitchsnake.com by proxying to the GitHub Pages origin. A proxy rather than
// GitHub's own custom-domain setting, ON PURPOSE and at least for the
// migration window: setting the custom domain makes github.io answer 301
// before any JavaScript runs, which would strand every existing player's
// localStorage, and that storage holds the anonymous session that owns
// their coins, badges and rating. With the proxy, BOTH origins serve; the
// page's exporter (see "the move to pitchsnake.com" in index.html) then
// carries each returning player's keys across exactly once.
//
// Deploy: Cloudflare dashboard -> Workers -> create "pitchsnake-router",
// paste this file, add routes pitchsnake.com/* and www.pitchsnake.com/*
// (the zone must be on Cloudflare nameservers first). Nothing here caches
// beyond what the edge does by default, and nothing rewrites content: the
// page's own references are all relative, so it serves at the new root
// untouched.
const UPSTREAM = 'https://yonureker.github.io/pitch-snake';

// The security headers, and the reason this worker is where they live: GitHub
// Pages serves whatever is in the repo and cannot set a header, so a static
// host has no way to say any of this for itself. The proxy can, which makes it
// the only place on this deployment that can.
//
// KNOW WHAT THIS DOES NOT COVER. These headers ride on pitchsnake.com alone.
// The github.io origin stays deliberately live as the migration exporter and
// is served bare, so it keeps none of this. That is another reason the move is
// worth finishing rather than leaving both doors open for ever.
//
// Every allowance below is something the page actually loads today. The two
// jsDelivr imports are auth-js and realtime-js; browser.sentry-cdn.com and the
// Sentry ingest hosts are for page/error-reporting.ts, which is inert while
// its DSN is empty and would otherwise be silently blocked the day it is set,
// which is exactly the sort of trap a CSP is famous for.
//
// 'unsafe-inline' is in script-src because the game IS an inline module in
// index.html; a hash would have to be recomputed on every commit and a nonce
// needs the body rewritten, and neither is worth it while the page has no HTML
// injection sink (every name on screen goes through textContent). The value
// here is the rest: a fixed list of origins that may run or receive anything,
// no eval, no plugins, no framing, and connect-src as a floor under how far a
// compromised dependency could ship what it found.
const SUPABASE_ORIGIN = 'https://vyqlwoqvsnxyziutmgqz.supabase.co';
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://browser.sentry-cdn.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  // The two Sentry ingest wildcards cover a DSN of the ordinary hosted shape,
  // https://<key>@o<org>.ingest.sentry.io/<project> and its de region twin,
  // because the SDK posts to the DSN's OWN host and that is where it lands. A
  // self-hosted or otherwise-shaped DSN will not match, and CSP fails silently
  // by design, so the report would simply never arrive and nothing would say
  // so. Check this line on the day a DSN is pasted into page/error-reporting.ts
  // rather than trying to guess the shape now.
  // wss://pitchsnake.com is spelled out rather than left to 'self'. CSP3 says
  // 'self' covers a ws/wss connection to the same host and Chrome and Firefox
  // agree, but Safari has not always, and this whole header fails silently by
  // design: the room socket would simply never open, on one browser, with
  // nothing logged. The cost of naming it is a line.
  `connect-src 'self' wss://pitchsnake.com ${SUPABASE_ORIGIN} wss://vyqlwoqvsnxyziutmgqz.supabase.co https://*.ingest.sentry.io https://*.ingest.de.sentry.io`,
  // Nothing here is ever framed, and the migration importer is the reason to
  // say so out loud: it writes localStorage on arrival, so an attacker who
  // cannot navigate a victim would otherwise embed this page and drive it.
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // No includeSubDomains and no preload on purpose: both are hard to walk back,
  // and neither is this worker's call to make on behalf of a subdomain it does
  // not serve. A year on the apex is the safe half of the header.
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()',
};

export { RoomWire } from './room-wire.js';

/**
 * Is this a room socket, and if so which room?
 *
 * `/room/<CODE>`, five characters of the room alphabet. Anything else is a
 * page request and goes to the proxy, so a typo cannot open a socket into an
 * object named after it and quietly bill for the privilege.
 *
 * @param {URL} url - the request URL.
 * @returns {string | null} the room code, or null if this is not a room path.
 */
function roomCode(url) {
  // The PATH is matched as it arrived and only the code is folded up. Matching
  // an upper-cased path against a lower-case literal is how this first shipped,
  // and every room request quietly fell through to the page proxy and 404ed.
  const m = /^\/room\/([A-Za-z0-9]{5})$/.exec(url.pathname);
  return m ? m[1].toUpperCase() : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // THE ROOM SOCKET COMES FIRST, ahead of both the www fold and the proxy,
    // and it has to. A WebSocket does not follow a 301, so the redirect below
    // would end an upgrade on www; and the proxy builds a fresh Response from
    // the Pages origin, which cannot carry a 101 even if Pages would speak it.
    // Every room code reaches the same object from anywhere in the world
    // because the id comes from the code by name; the object is created in the
    // data centre nearest whoever opens the room first. See room-wire.js.
    const code = roomCode(url);
    if (code !== null) {
      const id = env.ROOM_WIRE.idFromName(code);
      return env.ROOM_WIRE.get(id).fetch(request);
    }
    // one canonical host: www folds into the apex before anything serves
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    // A static site answers reads and nothing else. Forwarding every verb made
    // this worker a small general purpose relay to another origin, which is a
    // thing worth not being even when the origin is public.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const upstream = UPSTREAM + url.pathname + url.search;
    const res = await fetch(upstream, {
      method: request.method,
      // Range rides along because the page's own staleness check is a range
      // request for the first few KB of the engine (see checkBuild in
      // index.html); dropped, it silently reads the whole file instead.
      headers: {
        'User-Agent': request.headers.get('User-Agent') || 'pitchsnake-router',
        ...(request.headers.get('Range') ? { Range: request.headers.get('Range') } : {}),
      },
      redirect: 'follow',
    });
    // a fresh Response so the headers are ours to keep or drop; the body
    // streams through untouched
    const out = new Response(res.body, res);
    out.headers.delete('x-github-request-id');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
    return out;
  },
};
