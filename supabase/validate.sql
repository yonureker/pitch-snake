-- Pitch Snake: validated scoring. The server decides every score.
--
-- Run this in the SQL editor AFTER leaderboard.sql and auth.sql (idempotent,
-- any later re-run of any of the three converges on the same state). Then
-- create the edge function: Dashboard -> Edge Functions -> Deploy a new
-- function -> name it exactly `validate-score`, paste the contents of
-- supabase/functions/validate-score/index.ts, and leave "Verify JWT" ON.
--
-- The design: a round may only enter a board against a seed this server
-- minted. pitch_snake_issue_seed hands the client (any signed-in session,
-- anonymous included) a fresh 32-bit seed and remembers it; the finished
-- round comes back to the validate-score edge function as its input LOG,
-- never as a number. The function claims the seed (single use, two-hour
-- shelf life, atomically), replays the log with the very same engine the
-- page plays with, computes the score itself, checks that at least as much
-- real time passed as the round simulated, and inserts the row with the
-- service role. The browser's opinion of its score is not an input.
--
-- What this ends: fabricated submissions, edited memory, sped-up clients,
-- replayed or traded logs, seed shopping. What it cannot end: a bot playing
-- honestly well; that is a heuristics-and-review problem, and the stored
-- (seed, user_id) pair on every row is the evidence trail for it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- seeds ----
-- One row per issued seed. RLS on, no policies, no grants: the issue RPC
-- and the service-role validator are the only doors, like every other table.
create table if not exists public.pitch_snake_seeds (
  id        bigint generated always as identity primary key,
  seed      bigint not null,
  user_id   uuid   not null,
  issued_at timestamptz not null default now(),
  used_at   timestamptz
);

create index if not exists pitch_snake_seeds_user_idx
  on public.pitch_snake_seeds (user_id, issued_at desc);

alter table public.pitch_snake_seeds enable row level security;

-- tournament rows learn the seed column scores always had, so validated
-- tournament entries carry their evidence too
alter table public.pitch_snake_tournament_scores add column if not exists seed bigint;

-- ---------------------------------------------------------- issue a seed ----
-- Requires a session (every client silently has one; auth.sql). The rate
-- cap is generous play, not a wall: forty rounds in ten minutes is a round
-- every fifteen seconds.
drop function if exists public.pitch_snake_issue_seed();

create or replace function public.pitch_snake_issue_seed()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent   int;
  b        bytea;
  new_seed bigint;
  new_id   bigint;
begin
  if auth.uid() is null then
    raise exception 'no session';
  end if;

  select count(*) into recent from public.pitch_snake_seeds
  where user_id = auth.uid() and issued_at > now() - interval '10 minutes';
  if recent >= 40 then
    raise exception 'too many rounds';
  end if;

  b := extensions.gen_random_bytes(4);
  new_seed := (get_byte(b, 0)::bigint << 24) | (get_byte(b, 1)::bigint << 16)
            | (get_byte(b, 2)::bigint << 8) | get_byte(b, 3)::bigint;

  insert into public.pitch_snake_seeds (seed, user_id)
  values (new_seed, auth.uid())
  returning id into new_id;

  return json_build_object('id', new_id, 'seed', new_seed);
end;
$$;

revoke all on function public.pitch_snake_issue_seed() from public;
grant execute on function public.pitch_snake_issue_seed() to anon, authenticated;

-- ------------------------------------------------- retire the old doors ----
-- The client-score submit functions must stay gone no matter which of the
-- three files ran last; leaderboard.sql and auth.sql carry the same drops.
drop function if exists public.pitch_snake_submit_score(text, integer);
drop function if exists public.pitch_snake_submit_score(text, integer, text);
drop function if exists public.pitch_snake_tournament_submit(text, text, integer);

-- ------------------------------------------------------------- housekeeping ----
-- Seeds are cheap rows with a two-hour useful life; sweep them daily.
create extension if not exists pg_cron;
select cron.schedule(
  'pitch-snake-seed-sweep',
  '17 4 * * *',
  $$delete from public.pitch_snake_seeds where issued_at < now() - interval '2 days'$$
);
