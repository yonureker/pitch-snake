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
-- And for the sign-in sheet, TWO EMAIL TEMPLATES need {{ .Token }} in their
-- body (Authentication -> Email Templates), so the mails carry a 6-digit
-- code instead of a link:
--   "Magic Link"            (signing in to an existing account)
--   "Change Email Address"  (an anonymous player attaching their email)
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
    select name, country from public.pitch_snake_profiles
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
    select name, country from public.pitch_snake_profiles
    where user_id = auth.uid()
  ) p;
  return row_out;
end;
$$;

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
revoke all on function public.pitch_snake_set_profile(text, text)      from public;

grant execute on function public.pitch_snake_get_profile()             to anon, authenticated;
grant execute on function public.pitch_snake_set_profile(text, text)   to anon, authenticated;
