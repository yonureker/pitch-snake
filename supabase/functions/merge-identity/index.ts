// Pitch Snake: carrying a guest's earnings into the account they just signed
// into. The client sends the ANONYMOUS session's own access token; this
// verifies it, verifies the caller's new session, and only then asks the
// database to merge one into the other.
//
// Deploy: Dashboard -> Edge Functions -> Deploy a new function -> name it
// exactly `merge-identity`, paste this file, leave "Verify JWT" ON.
//
// WHY THIS EXISTS AT ALL. Identity here is anonymous-first: every player has a
// real user_id from the first frame and earns a name, a rating, coins and
// items under it. Signing in is supposed to KEEP that id, and it does when the
// email is new, because updateUser plus verifyOtp 'email_change' links the
// address onto the same user. An address that already has an account cannot be
// linked, so the client falls back to signing in, and signing in switches the
// device to a different user_id. Everything the guest earned is left behind
// with no door to it: the browser has replaced its token and that identity has
// no password, no email and no other session.
//
// It happened to the owner on 2026-09-07, live: the guest identity held the
// name ONUR, a 1274 rating over 35 rated rounds and two bought hats, and the
// account signed into was called YOU and had none of it.
//
// WHY THE PROOF IS A TOKEN AND NOT A UUID. The merge needs to know one person
// owns both identities. A uuid proves nothing: anyone could post a stranger's
// id and walk off with their rating, which would be the worst hole in the
// project. What DOES prove it is possession of the guest session's own access
// token, because that token is only ever held by the browser that was signed
// in as that guest. Postgres cannot check a JWT, so the check lives here and
// pitch_snake_merge_identity is service-role only. This function is the door;
// the RPC is the room behind it.
//
// THE THREE REFUSALS, each closing a different abuse:
//   the caller must be signed in and NOT anonymous, or a guest could hoover up
//     other guests;
//   the token in the body must belong to an ANONYMOUS user, so a stolen or
//     borrowed token for a real account cannot be used to empty it;
//   the two must differ, which is the ordinary no-op of a player who linked
//     rather than switched, and is answered rather than performed.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const reply = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const refuse = (error: string, status = 422) => reply({ error }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refuse('POST only', 405);
  const size = Number(req.headers.get('content-length') ?? 0);
  if (size > 8192) return refuse('body too large');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return refuse('bad json'); }
  const guestToken = body.guestToken;
  if (typeof guestToken !== 'string' || guestToken.length < 20 || guestToken.length > 4096) {
    return refuse('bad request');
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // WHO IS ASKING: the caller's own session, which is the account they have
  // just signed into. Anonymous callers are refused, because the only merge
  // worth doing is guest into account, and letting a guest be the destination
  // would turn this into a way to pool identities.
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: intoData, error: intoErr } = await service.auth.getUser(jwt);
  if (intoErr || !intoData?.user) return refuse('no session', 401);
  const into = intoData.user;
  if (into.is_anonymous) return refuse('sign in first');

  // WHAT THEY ARE CLAIMING: a session token they hold for the guest they were
  // a moment ago. Verifying it IS the proof of ownership; nothing else here
  // establishes any right to that identity's history.
  const { data: fromData, error: fromErr } = await service.auth.getUser(guestToken);
  if (fromErr || !fromData?.user) return refuse('that guest session is not valid', 403);
  const from = fromData.user;
  if (!from.is_anonymous) return refuse('only a guest identity can be merged', 403);
  // Linking (rather than switching) keeps the same id, so there is genuinely
  // nothing to move. Answered as success, because from the player's point of
  // view their things did arrive.
  if (from.id === into.id) return reply({ merged: false, reason: 'same identity' }, 200);

  // Everything above is the door. The move itself, its collision rules and its
  // idempotence live in supabase/merge.sql, where they can be read and tested
  // as data rather than as a request.
  const rpc = service.rpc.bind(service) as unknown as
    (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc('pitch_snake_merge_identity', {
    p_from: from.id,
    p_into: into.id,
  });
  if (error) return refuse('merge failed', 500);

  return reply({ merged: true, moved: data }, 200);
});
