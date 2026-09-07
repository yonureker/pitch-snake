/**
 * Noticing that something went wrong in a player's browser, and getting exactly
 * one useful copy of it off their machine.
 *
 * Owns error reporting whole. It never gates play and never throws, because a
 * crash reporter that can crash the game is worse than no crash reporter: every
 * path here is wrapped, and if the CDN is blocked, the DSN is empty, or the SDK
 * fails to load, the game plays exactly as it does today and nobody notices.
 * That is the same law identity and the boards already follow in this project.
 *
 * It never reaches back into the page for state either (see page/README.md):
 * the shell TELLS it what happened through `reportIssue`.
 *
 * Why it exists: before it, an exception anywhere in the frame loop left the
 * game frozen and silent, because `requestAnimationFrame(loop)` was the last
 * statement in the loop and a throw above it meant the next frame was never
 * scheduled. The tab simply stopped, with nothing logged and nothing sent. At a
 * few thousand players that is a bug you only hear about if somebody writes in.
 *
 * @module error-reporting
 */
/**
 * Paste the Sentry DSN here to turn reporting on. Empty means OFF, and off is a
 * complete, supported state: nothing loads and nothing is sent. A DSN is not a
 * secret (it is a public ingest endpoint, like the publishable key next door in
 * supabase-client.ts) but it is per-project, so it is written here rather than
 * discovered at runtime. Held on an object because a bare `const DSN = ''`
 * narrows to the empty literal, at which point the compiler calls the check in
 * initErrorReporting dead code; an object literal's property widens to string.
 */
const reporting = { dsn: '' };
/** Pinned like every other CDN import here: a version that moves under us is a bug that arrives without a commit. */
const SENTRY_CDN = 'https://browser.sentry-cdn.com/8.47.0/bundle.min.js';
/**
 * The budget, which exists BECAUSE of the loop fix rather than in spite of it.
 * Now that a thrown frame no longer stops the game, a recurring error repeats at
 * the refresh rate: 60 to 120 events per second from a single tab. Unbudgeted,
 * one player on a broken device would drain a launch's Sentry quota in minutes
 * and say nothing the first copy had not already said.
 */
const MAX_PER_SESSION = 25;
const MIN_GAP_MS = 2000;
let sentry = null;
let sent = 0;
let lastSentAt = -1e15;
const seen = new Set();
/**
 * Read one property off a value that may be anything, without asserting a shape
 * onto it. The SDK hands `beforeSend` an event whose type we do not control, and
 * a cast there would be a promise to the compiler we cannot keep.
 *
 * @param source Any value; anything that is not an object reads as undefined.
 * @param key The property to read.
 * @returns The property's value, or undefined.
 */
function read(source, key) {
    return typeof source === 'object' && source !== null ? Reflect.get(source, key) : undefined;
}
/**
 * A stable fingerprint for an event, built only from strings we actually found.
 *
 * @param event The event object handed to `beforeSend`.
 * @returns A signature used to drop repeats.
 */
function signatureOf(event) {
    const values = read(read(event, 'exception'), 'values');
    const head = Array.isArray(values) ? values[0] : undefined;
    const parts = [read(head, 'type'), read(head, 'value'), read(event, 'message')];
    return parts.map((p) => (typeof p === 'string' ? p : '')).join(':');
}
/**
 * Whether this event is worth the postage: never more than one every
 * MIN_GAP_MS, never more than MAX_PER_SESSION in a session, and never the same
 * signature twice. Sentry dedupes server side as well; the point here is to not
 * SEND it.
 *
 * @param signature The event's fingerprint.
 * @returns True if it should go.
 */
function allow(signature) {
    const now = Date.now();
    if (sent >= MAX_PER_SESSION)
        return false;
    if (now - lastSentAt < MIN_GAP_MS)
        return false;
    if (seen.has(signature))
        return false;
    seen.add(signature);
    lastSentAt = now;
    sent += 1;
    return true;
}
/** Install the SDK once it has loaded. Silent on any failure, by design. */
function attach() {
    try {
        const loaded = window.Sentry;
        if (!loaded)
            return;
        loaded.init({
            dsn: reporting.dsn,
            // No performance tracing. It is a large share of a Sentry bill, and this
            // game's performance questions are answered by the FPS meter and by
            // pitch_snake_net_events, not by spans.
            tracesSampleRate: 0,
            // Browser noise we can neither fix nor act on.
            ignoreErrors: [
                'ResizeObserver loop limit exceeded',
                'ResizeObserver loop completed with undelivered notifications',
            ],
            beforeSend: (event) => (allow(signatureOf(event)) ? event : null),
        });
        sentry = loaded;
    }
    catch {
        /* reporting stays off */
    }
}
/**
 * Start reporting. Call once at boot. Loads the SDK asynchronously and installs
 * the two global listeners the browser offers. If anything fails the caller
 * never learns about it, which is the intended behaviour.
 */
export function initErrorReporting() {
    if (!reporting.dsn)
        return; // off, deliberately and completely
    try {
        const script = document.createElement('script');
        script.src = SENTRY_CDN;
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.addEventListener('load', attach);
        document.head.append(script);
        // These fire whether or not the SDK ever arrives, so an error raised before
        // it loads is simply not reported rather than queued. The SDK installs its
        // own handlers too, and the budget above is what keeps the pair honest.
        window.addEventListener('error', (e) => {
            try {
                sentry?.captureException(e.error ?? new Error(e.message));
            }
            catch {
                /* never throw from a handler */
            }
        });
        window.addEventListener('unhandledrejection', (e) => {
            try {
                sentry?.captureException(e.reason);
            }
            catch {
                /* never throw from a handler */
            }
        });
    }
    catch {
        /* reporting stays off */
    }
}
/**
 * Report something the game itself judged to be wrong: a multiplayer desync, a
 * frame that threw, a room that could not be reached. The shell decides what
 * counts; this module only decides whether to send it.
 *
 * @param kind Short stable label, e.g. 'frame-threw' or 'versus-desync'.
 * @param detail Counters and reason strings only. No personal data: the same
 *   line pitch_snake_net_events already draws, which is never message contents,
 *   never inputs, never board state, never anything a player typed.
 */
export function reportIssue(kind, detail) {
    try {
        sentry?.captureMessage(kind, { level: 'error', extra: detail ?? {} });
    }
    catch {
        /* a game never fails because a report did */
    }
}
//# sourceMappingURL=error-reporting.js.map