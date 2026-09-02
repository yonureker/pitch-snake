-- Pitch Snake: the global boards and the tournaments.
--
-- Everything here is prefixed pitch_snake_ so it can sit in a project that
-- already has other things in public without colliding with them.
--
-- Run this once in the SQL editor of the project the boards live in
-- (Dashboard -> SQL Editor -> New query -> paste -> Run). It is idempotent
-- both for a fresh project and for one that already carries the v1 schema:
-- tables are created if missing, columns are added if missing, and functions
-- are dropped by their old signatures before the current ones are created.
--
-- The shape is deliberate: no table here is ever exposed to the Data API.
-- RLS is on with no policies and the anon role holds no grants, so a browser
-- cannot read, write, or page through any of them. The only doors are the
-- SECURITY DEFINER functions at the bottom, and each one stays boring: read
-- a board, insert one validated row, create or look up one tournament.

-- ------------------------------------------------------------- scores ----
-- One row per submitted run. mode partitions the boards ('classic',
-- 'speedrun', 'survival'); seed and user_id are recorded now so that server-side replay
-- validation and accounts arrive later without a migration. Ties go to
-- whoever got there first, which is why created_at is part of every order.

create table if not exists public.pitch_snake_scores (
  id          bigint generated always as identity primary key,
  name        text        not null,
  score       integer     not null,
  mode        text        not null default 'classic',
  seed        bigint,
  user_id     uuid,
  created_at  timestamptz not null default now()
);

alter table public.pitch_snake_scores add column if not exists mode    text not null default 'classic';
alter table public.pitch_snake_scores add column if not exists seed    bigint;
alter table public.pitch_snake_scores add column if not exists user_id uuid;

drop index if exists public.pitch_snake_scores_board_idx;
create index if not exists pitch_snake_scores_mode_board_idx
  on public.pitch_snake_scores (mode, score desc, created_at asc);

alter table public.pitch_snake_scores enable row level security;
revoke all on table public.pitch_snake_scores from anon, authenticated;

-- -------------------------------------------------------- tournaments ----
-- A tournament is a code, a window, and a mode; nothing else. It is created
-- by anyone, immutable once made, and simply expires. Its board is its own
-- table, and the standings read is best-per-name so one player hammering
-- entries fills one row of the table, not ten.

create table if not exists public.pitch_snake_tournaments (
  id          bigint generated always as identity primary key,
  code        text        not null unique,
  title       text        not null,
  mode        text        not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.pitch_snake_tournament_scores (
  id             bigint generated always as identity primary key,
  tournament_id  bigint      not null references public.pitch_snake_tournaments (id) on delete cascade,
  name           text        not null,
  score          integer     not null,
  user_id        uuid,
  created_at     timestamptz not null default now()
);

create index if not exists pitch_snake_tournament_scores_board_idx
  on public.pitch_snake_tournament_scores (tournament_id, score desc, created_at asc);

alter table public.pitch_snake_tournaments enable row level security;
alter table public.pitch_snake_tournament_scores enable row level security;
revoke all on table public.pitch_snake_tournaments from anon, authenticated;
revoke all on table public.pitch_snake_tournament_scores from anon, authenticated;

-- ---------------------------------------------------------------- read ----
-- The board carries the flag as well as the name. Country is JOINED from the
-- player's profile rather than stamped onto the score row, which is the
-- difference between a flag that describes the row and one that describes
-- the PLAYER: set your flag today and every score you have ever set shows
-- it, change countries and they all follow. Stamping would have frozen each
-- row at the moment it was written and needed a column to do it.
--
-- Left join on purpose. Rows from before identity existed carry a null
-- user_id, and a player who never picked a flag has a null country; both
-- come back as null and simply render without one. A missing flag is never
-- a missing row.
--
-- The return type changes, so the old signature has to go first: Postgres
-- will not replace a function with one that returns a different shape.
drop function if exists public.pitch_snake_top_scores(integer);
drop function if exists public.pitch_snake_top_scores(integer, text);

create or replace function public.pitch_snake_top_scores(limit_count integer default 10, p_mode text default 'classic')
returns table (id bigint, name text, score integer, country text, created_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, s.name, s.score, p.country, s.created_at
  from public.pitch_snake_scores s
  left join public.pitch_snake_profiles p on p.user_id = s.user_id
  where s.mode = coalesce(p_mode, 'classic')
  order by s.score desc, s.created_at asc
  limit least(greatest(coalesce(limit_count, 10), 1), 100);
$$;

-- --------------------------------------------------------------- write ----
-- RETIRED: the client-score submit lived here until validated scoring
-- (validate.sql + the validate-score edge function) took over. The client
-- now submits its round LOG and the server replays it to compute the score
-- itself; a function that accepts a number from the browser must never
-- come back. The drops below keep any file-run order converging on gone.
drop function if exists public.pitch_snake_submit_score(text, integer);
drop function if exists public.pitch_snake_submit_score(text, integer, text);

-- --------------------------------------------------- tournament: create ----
-- The code is six characters from an alphabet with no 0/O or 1/I, 32^6 of
-- them, generated server-side and retried on the (astronomical) collision.
-- Times are computed here from now(): the client sends offsets, never
-- timestamps, so nobody's wrong clock can schedule anything.
drop function if exists public.pitch_snake_tournament_create(text, text, integer, integer);

create or replace function public.pitch_snake_tournament_create(
  p_title text,
  p_mode text default 'classic',
  p_starts_in_minutes integer default 0,
  p_duration_minutes integer default 1440
)
returns table (code text, title text, mode text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet    constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  clean_title text;
  new_code    text;
  t_start     timestamptz;
  t_end       timestamptz;
  i           integer;
begin
  if p_mode is null or p_mode not in ('classic', 'speedrun', 'survival') then
    raise exception 'unknown mode';
  end if;
  if p_starts_in_minutes is null or p_starts_in_minutes < 0 or p_starts_in_minutes > 43200 then
    raise exception 'start must be between now and 30 days out';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 10 or p_duration_minutes > 10080 then
    raise exception 'duration must be between 10 minutes and 7 days';
  end if;

  clean_title := left(regexp_replace(trim(upper(regexp_replace(coalesce(p_title, ''), '[^A-Za-z0-9 ]', '', 'g'))), ' +', ' ', 'g'), 24);
  if clean_title = '' then
    clean_title := 'PITCH CUP';
  end if;

  t_start := now() + make_interval(mins => p_starts_in_minutes);
  t_end   := t_start + make_interval(mins => p_duration_minutes);

  for attempt in 1..20 loop
    new_code := '';
    for i in 1..6 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * 32)::integer, 1);
    end loop;
    begin
      insert into public.pitch_snake_tournaments (code, title, mode, starts_at, ends_at)
      values (new_code, clean_title, p_mode, t_start, t_end);
      return query select new_code, clean_title, p_mode, t_start, t_end;
      return;
    exception when unique_violation then
      -- roll the dice again
    end;
  end loop;
  raise exception 'could not allocate a code';
end;
$$;

-- ----------------------------------------------------- tournament: look up ----
drop function if exists public.pitch_snake_tournament_get(text);

create or replace function public.pitch_snake_tournament_get(p_code text)
returns table (code text, title text, mode text, starts_at timestamptz, ends_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select t.code, t.title, t.mode, t.starts_at, t.ends_at
  from public.pitch_snake_tournaments t
  where t.code = upper(trim(coalesce(p_code, '')));
$$;

-- --------------------------------------------------- tournament: standings ----
-- Best score per name, then ranked. distinct on picks each name's best
-- (earliest on a tie), and the outer order ranks those bests.
drop function if exists public.pitch_snake_tournament_top(text, integer);

-- The flag here belongs to whoever set that particular best, which is the
-- only honest answer on a board keyed by NAME rather than by user: two
-- players called MAX share a row, and the row shows the flag of the one who
-- actually holds it.
create or replace function public.pitch_snake_tournament_top(p_code text, limit_count integer default 10)
returns table (name text, score integer, country text, created_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select b.name, b.score, p.country, b.created_at
  from (
    select distinct on (s.name) s.name, s.score, s.created_at, s.user_id
    from public.pitch_snake_tournament_scores s
    join public.pitch_snake_tournaments t on t.id = s.tournament_id
    where t.code = upper(trim(coalesce(p_code, '')))
    order by s.name, s.score desc, s.created_at asc
  ) b
  left join public.pitch_snake_profiles p on p.user_id = b.user_id
  order by b.score desc, b.created_at asc
  limit least(greatest(coalesce(limit_count, 10), 1), 100);
$$;

-- ------------------------------------------------------ tournament: submit ----
-- RETIRED like pitch_snake_submit_score above: tournament submissions go
-- through the validator now (same edge function, with the room code); the
-- window check moved there and still reads the server's clock.
drop function if exists public.pitch_snake_tournament_submit(text, text, integer);

-- Postgres grants EXECUTE to PUBLIC on every new function, which would make
-- these callable by roles we never considered. Take that back, then hand it
-- out deliberately. EXECUTE is also all it takes to publish a function at
-- /rest/v1/rpc/<name>; tables need far more, which is exactly why we use these.
revoke all on function public.pitch_snake_top_scores(integer, text)                       from public;
revoke all on function public.pitch_snake_tournament_create(text, text, integer, integer) from public;
revoke all on function public.pitch_snake_tournament_get(text)                            from public;
revoke all on function public.pitch_snake_tournament_top(text, integer)                   from public;
grant execute on function public.pitch_snake_top_scores(integer, text)                       to anon, authenticated;
grant execute on function public.pitch_snake_tournament_create(text, text, integer, integer) to anon, authenticated;
grant execute on function public.pitch_snake_tournament_get(text)                            to anon, authenticated;
grant execute on function public.pitch_snake_tournament_top(text, integer)                   to anon, authenticated;

-- `supabase db advisors` will flag every function above as a SECURITY DEFINER
-- routine executable by anon. That is this design working, not a finding: the
-- tables are shut and these are the doors. Do not "fix" it by switching them
-- to SECURITY INVOKER or revoking anon, which turns the boards off.
--
-- Scores land through the validator only (validate.sql + the validate-score
-- edge function): the client submits its round LOG against a server-issued
-- seed, the server replays it with the same engine and writes the score it
-- computed. The browser's opinion of its score no longer exists here.
