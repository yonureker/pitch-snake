-- Pitch Snake: identity.
--
-- Run this once in the SQL editor of the same project that carries
-- leaderboard.sql and rooms.sql (Dashboard -> SQL Editor -> New query ->
-- paste -> Run). Idempotent: the table is created if missing, the functions
-- are replaced in place. leaderboard.sql must have run first.
--
-- TWO DASHBOARD SWITCHES have to be flipped by hand, or none of this fires:
--   1. Authentication -> Sign In / Providers -> "Allow anonymous sign-ins": ON.
--      (Leave the anonymous rate limit at its default 30/hour per IP; if the
--      project ever sees abuse, add CAPTCHA there rather than raising it.)
--   2. Authentication -> Sign In / Providers -> "Allow manual linking": ON.
--      (This is what lets an anonymous player later attach Apple / Google /
--      email WITHOUT changing their user id, which is the whole design.)
-- And for the sign-in sheet, TWO EMAIL TEMPLATES have to be edited by hand
-- (Authentication -> Email Templates) to present {{ .Token }} and drop the
-- default {{ .ConfirmationURL }} magic link, so the mail carries a 6-digit
-- code the sheet verifies and no link at all:
--   "Magic Link"            (signing in to an existing account)
--   "Change Email Address"  (an anonymous player attaching their email)
-- This is a CODE flow (the sheet calls verifyOtp with the typed code, never a
-- link). Leaving the default link in the template sends a stray magic link
-- that redirects to the project Site URL, which confuses the player and breaks
-- if clicked. Which is the third setting: Authentication -> URL Configuration
-- -> Site URL must be https://pitchsnake.com, NOT the project default
-- http://localhost:3000, and Redirect URLs must allow both origins the page is
-- served from, https://pitchsnake.com/** and https://yonureker.github.io/**.
-- Nothing in the sign-in flow uses a redirect, but a wrong Site URL is exactly
-- where a stray link lands, and it is the sane default for every auth path.
-- Note the built-in mailer only delivers to the project's own team members
-- and only a couple of mails an hour; before real players sign in, set a
-- custom SMTP provider under Project Settings -> Authentication.
--
-- The design in one breath: every player is silently signed in anonymously
-- from first launch, so every write can carry auth.uid() from day one; nobody
-- ever sees a login screen to play. "Signing in" later means linking a real
-- identity onto the same user id, which is why nothing here ever keys on
-- email or provider: user id is the identity, full stop.
--
-- Same access shape as the boards: the table is never exposed to the Data
-- API (RLS on, no policies, no grants), and the SECURITY DEFINER functions
-- below are the only doors.

-- ------------------------------------------------------------- profiles ----
-- One row per auth user: the 5-character name the game has always used, and
-- the country for the flag beside it. The name is display, not identity:
-- deliberately NOT unique, because rows key on user_id and two kids named
-- MAX are two different players (which the old best-per-name boards got
-- wrong). Cascade with the auth user so account deletion is one delete.
create table if not exists public.pitch_snake_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text        not null,
  country    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Onboarding progress: the finished lesson IDS rather than a count, so
-- lessons can be reordered or inserted without wiping anyone. The reasoning
-- lives with pitch_snake_set_levels below; the column is declared up here
-- because the profile readers a few lines down select it, and on a database
-- that has never run this file those readers are created first.
alter table public.pitch_snake_profiles add column if not exists levels text[];

alter table public.pitch_snake_profiles enable row level security;

-- ------------------------------------------------- profile read / write ----
-- get returns the caller's row as one json object, or null: exactly what a
-- client wants to branch on, and a signed-out caller just gets null rather
-- than an error, so the page never has to care whether auth is up.
drop function if exists public.pitch_snake_get_profile();

create or replace function public.pitch_snake_get_profile()
returns json
language sql
security definer
set search_path = ''
as $$
  select to_json(p) from (
    select name, country, coalesce(levels, '{}') as levels
    from public.pitch_snake_profiles
    where user_id = auth.uid()
  ) p;
$$;

-- set upserts the caller's row. The name goes through the exact wash every
-- score name has always gone through (upper, alphanumeric, five characters,
-- 'YOU' when nothing survives), so a profile name can never be a thing a
-- score name could not be. Country: null keeps whatever flag is already
-- chosen (every plain name commit passes null and must not strip one), an
-- empty string clears it (the sheet's NO FLAG choice), a code sets it.
drop function if exists public.pitch_snake_set_profile(text, text);

create or replace function public.pitch_snake_set_profile(p_name text, p_country text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name    text;
  clean_country text;
  row_out       json;
begin
  if auth.uid() is null then
    raise exception 'no session';
  end if;

  clean_name := left(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g')), 5);
  if clean_name = '' then
    clean_name := 'YOU';
  end if;

  clean_country := upper(trim(coalesce(p_country, '')));
  if clean_country !~ '^[A-Z]{2}$' then
    clean_country := null;
  end if;

  -- Names are unique since 2026-09-06, at the owner's call, except the
  -- un-name YOU that every unnamed player shares (equip and set_levels
  -- upsert rows under it, so it can never be scarce). Case-insensitive,
  -- the False9 team-name rule ported. This check exists for the friendly
  -- message; the partial unique index below is the source of truth and
  -- catches the race two saves can win together.
  if clean_name <> 'YOU' and exists (
    select 1 from public.pitch_snake_profiles
    where upper(name) = clean_name and user_id <> auth.uid()
  ) then
    raise exception 'That name is taken.';
  end if;

  insert into public.pitch_snake_profiles (user_id, name, country)
  values (auth.uid(), clean_name, clean_country)
  on conflict (user_id) do update
    set name       = excluded.name,
        -- null means the caller was not talking about the flag: keep it.
        -- Anything else (a code, or '' washed to null) is a decision.
        country    = case when p_country is null
                          then public.pitch_snake_profiles.country
                          else excluded.country end,
        updated_at = now();

  select to_json(p) into row_out from (
    select name, country, coalesce(levels, '{}') as levels
    from public.pitch_snake_profiles
    where user_id = auth.uid()
  ) p;
  return row_out;
end;
$$;

-- ------------------------------------------------------------ your bests ----
-- The sheet offers to save your scores, so the scores have to follow you.
-- Before this, they did not: BEST lived in one browser's localStorage and a
-- player signing in on a second device was met with a row of zeroes under a
-- promise that they would not be.
--
-- Nothing new is stored to make this true. A player's best in a mode is
-- already on the board: the highest score the VALIDATOR wrote against their
-- user id. Deriving it rather than keeping a second copy means the number can
-- never disagree with the board it came from, and means it cannot be written
-- by a client, which a stored personal best could have been.
--
-- Returns an object keyed by mode ({"classic": 77, ...}), modes with no rows
-- simply absent, and an empty object for a signed-out or brand-new caller, so
-- the page can merge without branching on nulls.
drop function if exists public.pitch_snake_my_bests();

create or replace function public.pitch_snake_my_bests()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_object_agg(t.mode, t.best), '{}'::json)
  from (
    select s.mode, max(s.score) as best
    from public.pitch_snake_scores s
    where s.user_id = auth.uid()
      and auth.uid() is not null
    group by s.mode
  ) t;
$$;

-- ---------------------------------------------------- onboarding progress ----
-- The account offer at the end of the lessons says it keeps your progress, so
-- it has to. It did not: progress lived in one browser's localStorage and an
-- account kept nothing, which is the same cheque the score sheet used to
-- write before pitch_snake_my_bests. The product moves, not the sentence.
--
-- Level IDS rather than a count, so lessons can be reordered or inserted
-- without wiping anyone. Deliberately NOT validated: a lesson pays nothing,
-- so there is nothing to forge. The moment a level awards coins this has to
-- move to the validator like everything else that pays. (The column itself is
-- declared with the table, because the profile readers select it.)
comment on column public.pitch_snake_profiles.levels is
  'Finished onboarding level ids. Client-reported on purpose: levels pay nothing, so there is nothing to forge. If a level ever awards coins this must move to the validator.';

drop function if exists public.pitch_snake_set_levels(text[]);

-- Merges rather than replaces, so two devices that each finished different
-- lessons end up with both instead of whichever one synced last.
create or replace function public.pitch_snake_set_levels(p_levels text[])
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  merged text[];
begin
  if auth.uid() is null then
    return '[]'::json;
  end if;
  select array(
    select distinct x from unnest(
      coalesce((select p.levels from public.pitch_snake_profiles p where p.user_id = auth.uid()), '{}')
      || coalesce(p_levels, '{}')
    ) as x
    where x ~ '^[a-z0-9-]{1,40}$'          -- an id, not an essay
    limit 200
  ) into merged;

  -- Upsert, not update. A profile row is only created when a name is set, and
  -- a player can finish the lessons before ever typing one: a plain UPDATE
  -- matched nothing and the progress went nowhere, silently.
  insert into public.pitch_snake_profiles (user_id, name, levels)
  values (auth.uid(), 'YOU', merged)
  on conflict (user_id) do update
    set levels = merged, updated_at = now();

  return coalesce(array_to_json(merged), '[]'::json);
end;
$$;

revoke all on function public.pitch_snake_set_levels(text[]) from public;
grant execute on function public.pitch_snake_set_levels(text[]) to anon, authenticated;

-- -------------------------------------- the boards learn whose score it is ----
-- RETIRED: this file used to redefine the two submit functions so rows
-- carried auth.uid(). Validated scoring (validate.sql + the validate-score
-- edge function) replaced them outright: the server replays the round's log
-- and writes the score AND the user id itself. The drops keep any file-run
-- order converging on gone; a function that accepts a score from the
-- browser must never come back.
drop function if exists public.pitch_snake_submit_score(text, integer, text);
drop function if exists public.pitch_snake_tournament_submit(text, text, integer);

-- Postgres grants EXECUTE to PUBLIC on every new function; take that back,
-- then hand it to exactly the two roles the publishable key can become.
revoke all on function public.pitch_snake_get_profile()                from public;
-- The uniqueness itself: a functional partial index, so ONUR and onur
-- cannot coexist while any number of players stay YOU. Existing duplicates
-- were folded to YOU (keeping each name's newest holder) in the 2026-09-06
-- migration before this index could exist.
create unique index if not exists pitch_snake_profiles_name_uniq
  on public.pitch_snake_profiles (upper(name)) where upper(name) <> 'YOU';

-- The pre-check the clients may ask before saving: is this name someone
-- else's? Washes exactly as set_profile does, and never counts the caller's
-- own row, so renaming yourself to yourself is never "taken".
create or replace function public.pitch_snake_name_taken(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pitch_snake_profiles
    where upper(name) = left(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g')), 5)
      and upper(name) <> 'YOU'
      and user_id is distinct from auth.uid()
  );
$$;

revoke all on function public.pitch_snake_name_taken(text)         from public;
grant execute on function public.pitch_snake_name_taken(text)      to anon, authenticated;

revoke all on function public.pitch_snake_set_profile(text, text)      from public;
revoke all on function public.pitch_snake_my_bests()                   from public;

grant execute on function public.pitch_snake_get_profile()             to anon, authenticated;
grant execute on function public.pitch_snake_set_profile(text, text)   to anon, authenticated;
grant execute on function public.pitch_snake_my_bests()                to anon, authenticated;
