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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // one canonical host: www folds into the apex before anything serves
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    const upstream = UPSTREAM + url.pathname + url.search;
    const res = await fetch(upstream, {
      method: request.method,
      headers: { 'User-Agent': request.headers.get('User-Agent') || 'pitchsnake-router' },
      redirect: 'follow',
    });
    // a fresh Response so the headers are ours to keep or drop; the body
    // streams through untouched
    const out = new Response(res.body, res);
    out.headers.delete('x-github-request-id');
    return out;
  },
};
