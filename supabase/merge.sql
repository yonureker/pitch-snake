-- =============================================================================
-- Carrying an anonymous player onto the account they just signed into.
-- =============================================================================
--
-- WHY THIS FILE EXISTS. Identity here is anonymous-first: everyone plays under
-- a real user_id from the first frame, and earns a name, a rating, coins and
-- items under it. Signing in is supposed to keep that id, and it does when the
-- address is new, because updateUser + verifyOtp 'email_change' LINKS the email
-- onto the same user. But an address that already has an account cannot be
-- linked, so the client falls back to signing in, and signing in switches the
-- device to a different user_id. Everything the guest earned stays behind,
-- reachable by nobody: the browser has replaced its token and the old identity
-- has no other door.
--
-- That is not theoretical. It happened to the owner on 2026-09-07, live: the
-- anonymous identity held the name ONUR, a 1274 rating over 35 rated rounds and
-- two bought hats, while the account being signed into was called YOU and had
-- none of it. It was repaired by hand. This file is that repair, written down.
--
-- THE PROOF PROBLEM, which is the whole design. A merge needs to know that one
-- person owns BOTH identities. A uuid passed to an RPC proves nothing: anyone
-- could pass any id and walk off with a stranger's rating, which would make
-- this the worst security hole in the project. Postgres cannot verify a second
-- JWT either. So the function below takes both ids and is callable ONLY by the
-- service role: the edge function is what verifies the anonymous session's own
-- access token before calling it, exactly as validate-score is what replays a
-- log before writing a score. The RPC is not the door here. The door is in
-- front of it.
--
-- THE GUARDS ARE STILL HERE, because defence in depth costs three lines: the
-- source must exist and must be ANONYMOUS, so no real account can ever be
-- merged away and emptied; the destination must exist; and the two must differ.
-- A caller with the service role that gets any of that wrong gets an exception
-- rather than a silent theft.
--
-- IT IS IDEMPOTENT. Everything is "move rows that are still there", so a retry
-- after a dropped connection moves nothing and reports zeroes rather than
-- doubling anything. Nothing is ever deleted except the source's profile ROW,
-- and only after its contents have been carried across.

-- ---------------------------------------------------------------- merge ----
create or replace function public.pitch_snake_merge_identity(
  p_from uuid,
  p_into uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  src        record;
  dst        record;
  moved      jsonb := '{}'::jsonb;
  n_scores   integer := 0;
  n_coins    integer := 0;
  n_items    integer := 0;
  n_ratings  integer := 0;
  n_seats    integer := 0;
  n_achieve  integer := 0;
begin
  if p_from is null or p_into is null then
    raise exception 'merge needs two identities';
  end if;
  if p_from = p_into then
    raise exception 'cannot merge an identity into itself';
  end if;

  -- The source must be a GUEST. Merging a real account into another would let
  -- a stolen session empty somebody's history into an attacker's, and there is
  -- no legitimate flow that needs it: a person with two real accounts has two
  -- passwords and no claim that one owns the other.
  if not exists (select 1 from auth.users u where u.id = p_from and u.is_anonymous) then
    raise exception 'the identity being merged from must exist and be anonymous';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_into) then
    raise exception 'the identity being merged into does not exist';
  end if;

  -- Value that belongs to the person rather than to the session that earned it.
  update public.pitch_snake_scores set user_id = p_into where user_id = p_from;
  get diagnostics n_scores = row_count;

  -- The ledger is unique on (user_id, reason, ref), so a row the destination
  -- already has for the same reason and ref is the same paid thing and is left
  -- where it is rather than colliding.
  update public.pitch_snake_coins c set user_id = p_into
   where c.user_id = p_from
     and not exists (select 1 from public.pitch_snake_coins d
                      where d.user_id = p_into and d.reason = c.reason
                        and d.ref is not distinct from c.ref);
  get diagnostics n_coins = row_count;
  delete from public.pitch_snake_coins where user_id = p_from;   -- what is left is a duplicate of something already owned

  update public.pitch_snake_inventory i set user_id = p_into
   where i.user_id = p_from
     and not exists (select 1 from public.pitch_snake_inventory d
                      where d.user_id = p_into and d.item_id = i.item_id);
  get diagnostics n_items = row_count;
  delete from public.pitch_snake_inventory where user_id = p_from;

  -- A RATING IS NOT ADDITIVE. Two Elo numbers cannot be averaged into a
  -- truthful third, so when both identities have played a mode the longer
  -- history wins outright: rounds is the amount of evidence behind the number,
  -- and the better-evidenced estimate is the one worth keeping. When the
  -- destination has never played that mode there is nothing to weigh and the
  -- row simply moves.
  delete from public.pitch_snake_ratings d
   using public.pitch_snake_ratings s
   where d.user_id = p_into and s.user_id = p_from and s.mode = d.mode
     and s.rounds > d.rounds;
  update public.pitch_snake_ratings s set user_id = p_into
   where s.user_id = p_from
     and not exists (select 1 from public.pitch_snake_ratings d
                      where d.user_id = p_into and d.mode = s.mode);
  get diagnostics n_ratings = row_count;
  delete from public.pitch_snake_ratings where user_id = p_from;

  -- Seats are the ladder's evidence: a rating with no seats behind it is a
  -- number nobody can check, so they follow it. Unique on (round_id, user_id),
  -- and one human holding two seats in one round is not a thing that happens.
  update public.pitch_snake_seats s set user_id = p_into
   where s.user_id = p_from
     and not exists (select 1 from public.pitch_snake_seats d
                      where d.user_id = p_into and d.round_id = s.round_id);
  get diagnostics n_seats = row_count;

  -- Withdrawn feature, kept because what it paid was real: only what the
  -- destination does not already hold.
  update public.pitch_snake_achievements a set user_id = p_into
   where a.user_id = p_from
     and not exists (select 1 from public.pitch_snake_achievements d
                      where d.user_id = p_into and d.achievement = a.achievement);
  get diagnostics n_achieve = row_count;
  delete from public.pitch_snake_achievements where user_id = p_from;

  -- ---- the profile ----
  select * into src from public.pitch_snake_profiles where user_id = p_from;
  select * into dst from public.pitch_snake_profiles where user_id = p_into;

  if src.user_id is not null then
    -- The name is a unique index, so the source's row goes before the
    -- destination can take its name.
    delete from public.pitch_snake_profiles where user_id = p_from;

    if dst.user_id is null then
      -- No profile on the account at all: the guest's becomes it wholesale.
      insert into public.pitch_snake_profiles (user_id, name, country, skin, hat, levels)
      values (p_into, src.name, src.country, src.skin, src.hat, src.levels);
    else
      update public.pitch_snake_profiles d set
        -- THE ACCOUNT'S OWN NAME OUTRANKS THE DEVICE'S, which is the rule the
        -- page has always followed: signing in should show you the player you
        -- signed in as. The exception is the shared un-name YOU, which is not a
        -- choice anybody made, so a guest who picked ONUR keeps ONUR rather
        -- than being renamed to nothing by an account that never chose.
        name    = case when d.name is null or d.name = 'YOU' then src.name else d.name end,
        country = coalesce(d.country, src.country),
        -- Clothing follows the same "keep what was chosen" rule.
        skin    = coalesce(d.skin, src.skin),
        hat     = coalesce(d.hat, src.hat),
        -- Progress MERGES rather than replaces, the rule set_levels already
        -- follows: finishing a lesson on one identity and another elsewhere
        -- means both are finished.
        levels  = (select array_agg(distinct l)
                     from unnest(coalesce(d.levels, '{}') || coalesce(src.levels, '{}')) l),
        updated_at = now()
      where d.user_id = p_into;
    end if;
  end if;

  moved := jsonb_build_object(
    'from', p_from, 'into', p_into,
    'scores', n_scores, 'coins', n_coins, 'items', n_items,
    'ratings', n_ratings, 'seats', n_seats, 'achievements', n_achieve,
    'name_carried', (src.user_id is not null and (dst.user_id is null or dst.name is null or dst.name = 'YOU'))
  );
  return moved;
end $$;

-- SERVICE ROLE ONLY. This is the half of the design that makes it safe, and
-- leaderboard.sql rule 1 is why it is spelled out by name: revoking from PUBLIC
-- does NOT take it away from anon and authenticated, who hold their grants in
-- their own right. A browser that could call this could pass any two uuids and
-- take a stranger's rating.
revoke all on function public.pitch_snake_merge_identity(uuid, uuid) from public;
revoke all on function public.pitch_snake_merge_identity(uuid, uuid) from anon, authenticated;

-- The audit from leaderboard.sql rule 1, run after any change to this file:
--   select proname, has_function_privilege('anon', oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth
--     from pg_proc where proname = 'pitch_snake_merge_identity';
-- Both columns must read false.
