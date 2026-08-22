-- Pitch Snake: the global top ten.
--
-- Everything here is prefixed pitch_snake_ so it can sit in a project that
-- already has other things in public without colliding with them.
--
-- Run this once in the SQL editor of the project you want the board to live in
-- (Dashboard -> SQL Editor -> New query -> paste -> Run). It is idempotent, so
-- running it twice is harmless.
--
-- The shape here is deliberate: the table is never exposed to the Data API at
-- all. RLS is on with no policies, and the anon role holds no grants on
-- it, so a browser cannot read it, write it, or page through it. The only way
-- in is the two functions at the bottom, which are SECURITY DEFINER precisely
-- because of that. Keep them boring: one reads the top N, one inserts a single
-- validated row, and neither takes anything else from the caller.

create table if not exists public.pitch_snake_scores (
  id          bigint generated always as identity primary key,
  name        text        not null,
  score       integer     not null,
  created_at  timestamptz not null default now()
);

-- the whole leaderboard read is one index scan; ties go to whoever got there first
create index if not exists pitch_snake_scores_board_idx
  on public.pitch_snake_scores (score desc, created_at asc);

alter table public.pitch_snake_scores enable row level security;
revoke all on table public.pitch_snake_scores from anon, authenticated;

-- ---------------------------------------------------------------- read ----
create or replace function public.pitch_snake_top_scores(limit_count integer default 10)
returns table (id bigint, name text, score integer, created_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, s.name, s.score, s.created_at
  from public.pitch_snake_scores s
  order by s.score desc, s.created_at asc
  limit least(greatest(coalesce(limit_count, 10), 1), 100);
$$;

-- --------------------------------------------------------------- write ----
-- Names are squashed to at most five A-Z0-9 characters, so the board cannot be
-- used as a message channel, and the score has to be inside a believable range.
-- Neither check makes this authoritative: see the note at the bottom.
create or replace function public.pitch_snake_submit_score(p_name text, p_score integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text;
  new_id     bigint;
begin
  if p_score is null or p_score < -999 or p_score > 9999 then
    raise exception 'score out of range';
  end if;

  clean_name := left(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g')), 5);
  if clean_name = '' then
    clean_name := 'YOU';
  end if;

  insert into public.pitch_snake_scores (name, score)
  values (clean_name, p_score)
  returning id into new_id;

  return new_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, which would make
-- these callable by roles we never considered. Take that back, then hand it out
-- deliberately. EXECUTE is also all it takes to publish a function at
-- /rest/v1/rpc/<name>; tables need far more, which is exactly why we use these.
revoke all on function public.pitch_snake_top_scores(integer)      from public;
revoke all on function public.pitch_snake_submit_score(text, integer) from public;
grant execute on function public.pitch_snake_top_scores(integer)      to anon, authenticated;
grant execute on function public.pitch_snake_submit_score(text, integer) to anon, authenticated;

-- `supabase db advisors` will flag both functions as SECURITY DEFINER routines
-- executable by anon. That is this design working, not a finding: the table is
-- shut and these two are the door. Do not "fix" it by switching them to
-- SECURITY INVOKER or revoking anon, which turns the leaderboard off.
--
-- ---------------------------------------------------------------------------
-- What this does NOT do, stated plainly: the browser reports its own score, so
-- anyone who opens devtools can call submit_score with whatever number they
-- like. The range check only stops the board being taken over by 999999999.
-- Making the score trustworthy means the server has to be the one that decides
-- it: either an Edge Function that hands out a signed round token and validates
-- the run against it, or replaying the input log server side. Neither is worth
-- building until someone actually cheats.
