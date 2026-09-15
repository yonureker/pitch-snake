-- Pitch Snake: the ladder.
--
-- Run this in the SQL editor AFTER leaderboard.sql, auth.sql and rooms.sql,
-- and BEFORE re-running the updated rooms.sql, which writes into the rounds
-- table this file creates. Idempotent.
--
-- The design in one breath: a rated round is one the SERVER set up, seated
-- and scored. The server mints the seed at kickoff (rooms.sql), records the
-- round before the first input, each player claims its own seat by
-- auth.uid() while nobody yet knows who will win, and the finishing order
-- comes from a replay of the log rather than from anyone's word for it.
--
-- WHAT IS RATED, AND WHY SO LITTLE
--
-- Quick-match rooms only. A code room is a room you chose the occupants of,
-- and pairwise Elo against five accounts you control is a printing press.
-- Quick match seats you by region and availability and never by name, so the
-- one attack that survives everything else here is priced out of it. Friend
-- rooms stay exactly as they are: unrated, and now genuinely private, since
-- quick match no longer offers them to strangers.
--
-- Two or more players must agree on the log. Every peer holds a byte-
-- identical copy of a deterministic round, so agreement is free to ask for
-- and it closes the one hole a single submission cannot: a player who
-- fabricates a different log against the same seed, in which they win. The
-- modal log takes the round; a room where nobody corroborates is not rated.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- Margin. Elo asks who beat whom and not by how much, and that is the right
-- question in this game specifically: the engine's clinch rule ends a round
-- the moment the last survivor's score passes every fallen rival, so a
-- dominant win STOPS EARLY and records a margin of one point. Margins are
-- compressed exactly when someone is winning big, which makes them the
-- opposite of a quality signal here.
--
-- Rating-based matchmaking. Quick match still seats by region and
-- availability. Seeding by rating needs a population before it can do
-- anything but strand people in an empty queue.

-- ------------------------------------------------------------- the round ----
-- Written by pitch_snake_room_start at kickoff, before a single input
-- exists, so the seed, the seat count and the room's provenance are all
-- settled facts by the time anybody plays.
--
-- mode, placings and log_hash are what the room was found to AGREE on, and
-- are written at SEALING rather than at the first submission. That
-- distinction is the whole defence: filled in by whoever reported first,
-- they would let the fastest submitter plant the finishing order the rest of
-- the room is then rated against.
create table if not exists public.pitch_snake_rounds (
  id         bigint generated always as identity primary key,
  code       text        not null,
  start_n    integer     not null,
  seed       bigint      not null,
  players    smallint    not null,
  origin     text        not null default 'code',   -- 'quick' rates, 'code' does not
  mode       text,                                  -- the agreed mode, at sealing
  placings   jsonb,                                 -- the agreed [{seat, score, diedAt}], at sealing
  log_hash   bigint,                                -- the log the room agreed on
  started_at timestamptz not null default now(),
  sealed_at  timestamptz,                           -- when the rating ran, or was declined
  unique (code, start_n)
);

create index if not exists pitch_snake_rounds_due_idx
  on public.pitch_snake_rounds (started_at) where sealed_at is null;

alter table public.pitch_snake_rounds enable row level security;
revoke all on table public.pitch_snake_rounds from anon, authenticated;

-- -------------------------------------------------------------- the seats ----
-- One row per player who is willing to be rated. Claimed at KICKOFF and not
-- at full time, which is the whole point: at full time a loser could claim
-- the winner's seat, and at kickoff nobody knows yet which seat that is. The
-- unique on (round_id, user_id) stops one account holding two seats; the
-- primary key stops two accounts holding one.
--
-- Each seat also carries what its occupant REPORTED: the log's fingerprint,
-- the mode its knobs describe, and the finishing order a replay of it
-- produced. One report is a claim, not a fact, so it is stored against the
-- player who made it and never against the round, until the room agrees.
create table if not exists public.pitch_snake_seats (
  round_id   bigint      not null references public.pitch_snake_rounds (id) on delete cascade,
  seat       smallint    not null,
  user_id    uuid        not null,
  name       text        not null default 'YOU',
  log_hash   bigint,                                -- filled at submission
  mode       text,                                  -- as this reporter's log describes it
  placings   jsonb,                                 -- as this reporter's log replays
  place      smallint,                              -- filled at sealing
  delta      integer,                               -- the rating move, filled at sealing
  claimed_at timestamptz not null default now(),
  primary key (round_id, seat),
  unique (round_id, user_id)
);

-- older installs carried the report on the round; move it to the seat
alter table public.pitch_snake_seats add column if not exists mode     text;
alter table public.pitch_snake_seats add column if not exists placings jsonb;

-- The seat cap in pitch_snake_take_seat counts a user's recent claims, and the
-- unique on (round_id, user_id) cannot serve that: its leading column is the
-- round. Without this the cap would sequentially scan every seat ever claimed,
-- on a call that happens at every kickoff.
create index if not exists pitch_snake_seats_user_recent_idx
  on public.pitch_snake_seats (user_id, claimed_at desc);

alter table public.pitch_snake_seats enable row level security;
revoke all on table public.pitch_snake_seats from anon, authenticated;

-- ----------------------------------------------------------- the ratings ----
-- Per mode, because the boards already are: survival skill must not launder
-- into classic. Nothing here is ever written by a client.
create table if not exists public.pitch_snake_ratings (
  user_id    uuid        not null,
  mode       text        not null,
  rating     integer     not null default 1000,
  rounds     integer     not null default 0,
  wins       integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create index if not exists pitch_snake_ratings_board_idx
  on public.pitch_snake_ratings (mode, rating desc);

alter table public.pitch_snake_ratings enable row level security;

-- The SEASON ladder, the same Elo run again on a clock that resets. A season
-- is a UTC calendar month ('YYYY-MM'); a round in a new month simply writes to
-- rows that do not exist yet and so default to base, which is the whole reset:
-- no cron rolls anything over, the season key does. Kept forever (a row is
-- tiny) so past seasons and season stats stay answerable. This ladder is
-- INDEPENDENT of the lifetime one above: its expectations come from the
-- season's own before-round ratings, computed alongside the lifetime move in
-- seal_round, never derived from it. Base and floor match the lifetime ladder.
create table if not exists public.pitch_snake_ratings_season (
  user_id    uuid        not null,
  mode       text        not null,
  season     text        not null,               -- 'YYYY-MM', UTC
  rating     integer     not null default 1000,
  rounds     integer     not null default 0,
  wins       integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode, season)
);

create index if not exists pitch_snake_ratings_season_board_idx
  on public.pitch_snake_ratings_season (mode, season, rating desc);

alter table public.pitch_snake_ratings_season enable row level security;
-- BOTH halves of leaderboard.sql rule 1: RLS on with no policies AND no grants.
-- Enabling RLS alone leaves Supabase's default grants in place, so the table
-- answers the Data API (an empty array, not a 401) and anon keeps a TRUNCATE
-- that RLS does not filter at all. Shipped wrong once here, on 2026-09-14.
revoke all on table public.pitch_snake_ratings_season from anon, authenticated;

-- The season registry: one row per season that has ever hosted a rated round,
-- keyed by the same 'YYYY-MM' string every season-scoped column already joins
-- on, so it is an ADDRESSABLE season rather than a bare string. Populated
-- lazily by seal_round the first time a round seals in a season (no cron rolls
-- a season over; the key does), and the place season metadata lands when it
-- exists: rewards, a display label, an explicit close. starts_at/ends_at are
-- the UTC month bounds, stored so a client need not recompute them. No hard FK
-- from ratings_season, deliberately: a rating write must never fail because a
-- registry row was missing, exactly as a room must never fail because the
-- ladder is down.
create table if not exists public.pitch_snake_seasons (
  season     text        primary key,            -- 'YYYY-MM', UTC
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.pitch_snake_seasons enable row level security;
revoke all on table public.pitch_snake_seasons from anon, authenticated;
revoke all on table public.pitch_snake_ratings from anon, authenticated;

-- ------------------------------------------------------- take your seat ----
-- Called by every peer as the kickoff arrives, for itself and nobody else:
-- the user id comes from auth.uid() and is not a parameter, so this door
-- cannot seat someone else. Silent about everything. A seat already taken,
-- an unknown round, a signed-out caller and a code room all return the same
-- nothing, because none of them is a reason to interrupt a game.
drop function if exists public.pitch_snake_take_seat(text, integer, integer, text);

create or replace function public.pitch_snake_take_seat(
  p_code text, p_start_n integer, p_seat integer, p_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  recent integer;
begin
  if auth.uid() is null then return; end if;
  -- A CAP, for the one thing this door cannot check. It verifies the round
  -- exists and that the caller is claiming a seat that round has, but nothing
  -- here can prove the caller actually sat in the room: the roster is gathered
  -- from presence and its refs are public in the kickoff, so there is no
  -- membership fact on this server to test against. A caller who learns a code
  -- (quick match hands them out) could therefore walk the free seats of live
  -- rounds, which both denies real players their own seat, since the insert
  -- below does nothing on conflict, and puts the squatter in the rating the
  -- agreed placings hand that seat. The cap does not make that impossible; it
  -- prices it at an account per hundred seats, which is what every other abuse
  -- here costs.
  --
  -- THE NUMBER IS SET BY THE HONEST PLAYER, NOT BY THE ABUSER, because the two
  -- failures are not the same size. A squatter slowed down is an inconvenience
  -- to a squatter. An honest player refused here is silently unrated for a
  -- round they actually played, with nothing on screen to explain it, and this
  -- door is already deliberately silent about every refusal. So the cap sits
  -- far above any rate a person can produce rather than close to it.
  --
  -- One claim per kickoff (vsTakeSeat runs once from vsBegin, and the insert
  -- below does nothing on conflict, so retries never count twice). A hundred in
  -- ten minutes is a round every six seconds, sustained. A room round cannot go
  -- near that: 2400ms of countdown (COUNT_TOTAL, 650 * 3 + 450), then the
  -- round, then a results screen somebody has to click REMATCH on. Even the
  -- pathological case, a player rematching instantly into rounds that end at
  -- once, is about 4.5 seconds a round and only reaches this cap after some
  -- seven minutes of doing nothing else. Forty was the first number here
  -- and it was too tight, at one round every fifteen seconds; a two-player
  -- classic room where both snakes die early genuinely lands in that range.
  -- The reasoning offered for forty was also simply wrong, that a player
  -- cannot be in more rounds than they have seeds for: room rounds are seeded
  -- by pitch_snake_room_start and spend no issue_seed ticket at all, so the
  -- two limits are independent and there was never any symmetry to borrow.
  select count(*) into recent from public.pitch_snake_seats
  where user_id = auth.uid() and claimed_at > now() - interval '10 minutes';
  if recent >= 100 then return; end if;

  select id, players into r
  from public.pitch_snake_rounds
  where code = upper(trim(coalesce(p_code, ''))) and start_n = p_start_n
    and started_at > now() - interval '15 minutes';
  if not found then return; end if;
  if p_seat is null or p_seat < 0 or p_seat >= r.players then return; end if;

  insert into public.pitch_snake_seats (round_id, seat, user_id, name)
  values (r.id, p_seat, auth.uid(),
          coalesce(nullif(left(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g')), 5), ''), 'YOU'))
  on conflict do nothing;
end;
$$;

-- ------------------------------------------------------------ reporting ----
-- The validator's door, and the service role's alone: it takes a user id as
-- a parameter, which is exactly what no client may ever do.
--
-- A report goes on the REPORTER'S seat and never on the round. This looks
-- like bookkeeping and is not: writing the first report to the round would
-- let whoever submits fastest plant the finishing order the rest of the room
-- is then rated against, and a fabricated log against a real seed replays
-- perfectly well. Nothing becomes the round's until the room agrees on it,
-- which is pitch_snake_seal_round's job.
drop function if exists public.pitch_snake_record_round(bigint, uuid, text, jsonb, bigint);

create or replace function public.pitch_snake_record_round(
  p_round bigint, p_user uuid, p_mode text, p_placings jsonb, p_hash bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from public.pitch_snake_rounds where id = p_round for update;
  if not found then return 'no such round'; end if;
  if r.sealed_at is not null then return 'round already sealed'; end if;

  update public.pitch_snake_seats
  set log_hash = p_hash, mode = p_mode, placings = p_placings
  where round_id = p_round and user_id = p_user;
  if not found then return 'no seat'; end if;   -- never took one at kickoff

  -- Seal the moment the room is complete instead of waiting out the sweep.
  -- Every seat has reported, so there is nothing left to wait FOR, and the
  -- players are still sitting on the results screen where the number means
  -- something. A rating that lands ninety seconds after everyone has clicked
  -- REMATCH is a rating nobody ever sees. The sweep stays as the fallback for
  -- the round somebody closed the tab on.
  if not exists (
    select 1 from public.pitch_snake_seats sh
    where sh.round_id = p_round and sh.log_hash is null
  ) then
    perform public.pitch_snake_seal_round(p_round);
  end if;
  return 'ok';
end;
$$;

-- --------------------------------------------------------------- the Elo ----
-- A five-player free-for-all is ten duels. Each pair is ordinary Elo against
-- the finishing order, and the sum is divided by (N-1) so a five-player
-- round moves a rating about as far as one duel does, which is what lets
-- rooms of two and rooms of five share a single pool. Splitting the pool by
-- room size would be more correct and would fragment matchmaking, which at
-- this game's size is the worse error.
--
-- Every expectation is computed from the ratings as they stood BEFORE the
-- round, so the result does not depend on the order the players are visited.
--
-- Disconnects need no special case, and that is worth saying out loud
-- because it is where most ladders leak. dropPeer only stops WAITING for a
-- peer's input: their snake stays in the simulation on its last heading and
-- crashes on its own, so a quitter still places, and places badly. Quitting
-- is not cheaper than losing. A peer dropped for lag and one who closed the
-- tab are indistinguishable to the engine and are treated identically here;
-- making lag unrated would be an invitation to fake it. Watch
-- pitch_snake_net_events instead.
drop function if exists public.pitch_snake_seal_round(bigint);

create or replace function public.pitch_snake_seal_round(p_round bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  s         record;
  agreed    bigint;
  agree_n   integer;
  sent_n    integer;
  n         integer;
  i         integer;
  j         integer;
  seats     integer[] := '{}';
  uids      uuid[]    := '{}';
  places    integer[] := '{}';
  before    numeric[] := '{}';
  kfac      numeric[] := '{}';
  adj       numeric;
  agreed_mode     text;
  agreed_placings jsonb;
  expect    numeric;
  actual    numeric;
  cur_rat   integer;
  cur_n     integer;
  -- the SEASON ladder, run alongside the lifetime one on its own snapshot
  v_season    text;
  before_s    numeric[] := '{}';
  kfac_s      numeric[] := '{}';
  adj_s       numeric;
  cur_rat_s   integer;
  cur_n_s     integer;
begin
  -- the current season key, UTC calendar month; a round always seals into the
  -- season it is sealed in, which is the season it was played in bar the rare
  -- round straddling midnight on the 1st, close enough for a monthly ladder
  v_season := to_char((now() at time zone 'utc'), 'YYYY-MM');
  select * into r from public.pitch_snake_rounds where id = p_round for update;
  if not found or r.sealed_at is not null then return 0; end if;

  -- Not every round is a rated one, and the ones that are not are sealed
  -- rather than left to be reconsidered every minute for ever.
  if r.origin <> 'quick' then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- The log the room agrees on. Two witnesses minimum: one peer reporting a
  -- round it also played is not corroboration, and a fabricated log against
  -- a real seed replays perfectly well.
  select sh.log_hash, count(*) into agreed, agree_n
  from public.pitch_snake_seats sh
  where sh.round_id = p_round and sh.log_hash is not null
  group by sh.log_hash
  order by count(*) desc, sh.log_hash
  limit 1;
  -- how many seats reported AT ALL, which is a different question from how
  -- many agreed, and the difference is what tells a no-show from a dispute
  select count(*) into sent_n
  from public.pitch_snake_seats sh
  where sh.round_id = p_round and sh.log_hash is not null;

  if agreed is null then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;
  if sent_n >= 2 and agree_n < 2 then
    -- two or more reports and no majority: a forgery or a genuine desync.
    -- Nobody's word wins that argument, so the round is sealed unrated.
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- What that log says happened. Taken from a seat holding the agreed hash
  -- and NOT from whoever reported first, which is the difference between a
  -- majority deciding the round and the fastest submitter deciding it. Every
  -- agreeing seat replayed the same log, so any of them will do.
  select sh.mode, sh.placings into agreed_mode, agreed_placings
  from public.pitch_snake_seats sh
  where sh.round_id = p_round and sh.log_hash = agreed
    and sh.mode is not null and sh.placings is not null
  order by sh.seat
  limit 1;
  if agreed_mode is null then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;
  if sent_n >= 2 and agreed_placings is null then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- THE NO-SHOW RULE. A seat that never reports is not a seat that escapes:
  -- it is the disconnect the ladder always said it rated, and leaving the
  -- room while losing must not be cheaper than playing the round out. With a
  -- single witness the log's own placings cannot be trusted (its author is
  -- the only one who saw it), so they are not used: the only fact taken is
  -- the one the SERVER can check for itself, that this seat submitted a log
  -- which replayed against the round's own seed and the others did not.
  -- Everyone who reported places ahead of everyone who did not, and the
  -- absentees tie with each other, which is the 0.5 branch below.
  if sent_n = 1 then
    -- nothing was agreed, so the round records no agreed placings: what it
    -- keeps is the hash of the only log anyone sent and the order above
    agreed_placings := null;
    for s in
      select sh.seat, sh.user_id,
             (case when sh.log_hash is not null then 1 else 2 end) as place
      from public.pitch_snake_seats sh
      where sh.round_id = p_round
      order by sh.seat
    loop
      seats  := seats  || s.seat;
      uids   := uids   || s.user_id;
      places := places || s.place;
    end loop;
  else
    -- The validator carries `place` on each entry rather than leaving it to
    -- be read off the array position, because two snakes can finish level and
    -- a draw has to rate as one; ordinality is the fallback for a placings
    -- blob written before that was true. Equal places take the 0.5 branch.
    for s in
      select sh.seat, sh.user_id,
             (select coalesce((pl.v->>'place')::integer, pl.ord::integer)
              from jsonb_array_elements(agreed_placings) with ordinality pl(v, ord)
              where (pl.v->>'seat')::integer = sh.seat) as place
      from public.pitch_snake_seats sh
      where sh.round_id = p_round and sh.log_hash = agreed
      order by sh.seat
    loop
      if s.place is null then continue; end if;    -- a seat the round never had
      seats  := seats  || s.seat;
      uids   := uids   || s.user_id;
      places := places || s.place;
    end loop;
  end if;

  n := coalesce(array_length(uids, 1), 0);
  if n < 2 then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- the standings as they stood before this round: a snapshot, so nothing
  -- below depends on the order these players are visited
  for i in 1..n loop
    select rt.rating, rt.rounds into cur_rat, cur_n
    from public.pitch_snake_ratings rt
    where rt.user_id = uids[i] and rt.mode = agreed_mode;
    if not found then cur_rat := 1000; cur_n := 0; end if;
    before := before || cur_rat::numeric;
    -- provisional players move fast and settle: K decays once a rating has
    -- something behind it
    kfac := kfac || (case when cur_n < 10 then 40 else 20 end)::numeric;

    -- the same snapshot for the season ladder, from THIS season's rows, which
    -- default to base each month so the reset needs no sweep; provisional is
    -- judged per season, so everyone is provisional early in a new month
    select rt.rating, rt.rounds into cur_rat_s, cur_n_s
    from public.pitch_snake_ratings_season rt
    where rt.user_id = uids[i] and rt.mode = agreed_mode and rt.season = v_season;
    if not found then cur_rat_s := 1000; cur_n_s := 0; end if;
    before_s := before_s || cur_rat_s::numeric;
    kfac_s := kfac_s || (case when cur_n_s < 10 then 40 else 20 end)::numeric;
  end loop;

  -- register the season the first time a round seals in it (the UTC month
  -- bounds are stored so clients need not recompute them); no FK depends on
  -- this, so a failure here could never cost a rating
  insert into public.pitch_snake_seasons (season, starts_at, ends_at)
  values (v_season,
          (v_season || '-01')::timestamp at time zone 'utc',
          ((v_season || '-01')::timestamp at time zone 'utc') + interval '1 month')
  on conflict (season) do nothing;

  for i in 1..n loop
    adj := 0;
    for j in 1..n loop
      if i = j then continue; end if;
      expect := 1.0 / (1.0 + power(10.0, (before[j] - before[i]) / 400.0));
      actual := case when places[i] < places[j] then 1.0
                     when places[i] > places[j] then 0.0
                     else 0.5 end;
      adj := adj + (actual - expect);
    end loop;
    adj := round(kfac[i] * adj / (n - 1));

    -- Added to the STORED rating rather than to the snapshot, so two rounds
    -- sealing at once compose instead of clobbering. A floor at 100 keeps a
    -- long losing run from running off the bottom of the scale.
    insert into public.pitch_snake_ratings (user_id, mode, rating, rounds, wins)
    values (uids[i], agreed_mode, greatest(100, (before[i] + adj)::integer), 1,
            case when places[i] = 1 then 1 else 0 end)
    on conflict (user_id, mode) do update
      set rating     = greatest(100, public.pitch_snake_ratings.rating + adj::integer),
          rounds     = public.pitch_snake_ratings.rounds + 1,
          wins       = public.pitch_snake_ratings.wins + case when places[i] = 1 then 1 else 0 end,
          updated_at = now();

    -- the SEASON move: the identical maths on the season snapshot. Independent
    -- of the lifetime adj above (different before-ratings, different K when a
    -- player is provisional this season but settled all-time), so it is summed
    -- from scratch rather than reused. seats.delta stays the LIFETIME move;
    -- the season standing is read straight off this table (rating - base is the
    -- net season gain), so no season delta needs storing per seat.
    adj_s := 0;
    for j in 1..n loop
      if i = j then continue; end if;
      expect := 1.0 / (1.0 + power(10.0, (before_s[j] - before_s[i]) / 400.0));
      actual := case when places[i] < places[j] then 1.0
                     when places[i] > places[j] then 0.0
                     else 0.5 end;
      adj_s := adj_s + (actual - expect);
    end loop;
    adj_s := round(kfac_s[i] * adj_s / (n - 1));

    insert into public.pitch_snake_ratings_season (user_id, mode, season, rating, rounds, wins)
    values (uids[i], agreed_mode, v_season, greatest(100, (before_s[i] + adj_s)::integer), 1,
            case when places[i] = 1 then 1 else 0 end)
    on conflict (user_id, mode, season) do update
      set rating     = greatest(100, public.pitch_snake_ratings_season.rating + adj_s::integer),
          rounds     = public.pitch_snake_ratings_season.rounds + 1,
          wins       = public.pitch_snake_ratings_season.wins + case when places[i] = 1 then 1 else 0 end,
          updated_at = now();

    update public.pitch_snake_seats
    set place = places[i], delta = adj::integer
    where round_id = p_round and seat = seats[i];
  end loop;

  -- what the room was found to agree on becomes the round's own record
  update public.pitch_snake_rounds
  set sealed_at = now(), log_hash = agreed, mode = agreed_mode, placings = agreed_placings
  where id = p_round;
  return n;
end;
$$;

-- ------------------------------------------------------------- the sweep ----
-- Rounds seal on a delay rather than on the last submission, because there
-- is no way to know a submission is the last one: a player can close the tab
-- at full time and never send. Ninety seconds is far longer than the round
-- needs to report and short enough that a rating means something while the
-- room is still together.
--
-- BUT NINETY SECONDS FROM WHAT. It was ninety from `started_at`, which is the
-- start of the round and not the end of it, so the sweep could rule on a round
-- that was still being PLAYED: a classic room has no clock, and past ninety
-- seconds the players were racing the sweeper for their own rating. Whoever
-- lost that race reported into a sealed round, `record_round` answered
-- 'round already sealed', and the round was unrated with nobody told. Measured
-- on 2026-09-08 before the fix: 86 rated quick rounds sealed between 11 and
-- 149 seconds after their start, so the race was already being run and simply
-- had not been lost yet, because every round so far had been short.
--
-- The delay is a straggler window, and a straggler is only a straggler once
-- somebody has arrived. So the ninety seconds now apply from the moment the
-- room STARTS REPORTING, and a round nobody has reported at all is left alone
-- until the abandonment horizon, because it may still be in play. A complete
-- room is unaffected either way: record_round seals it the instant the last
-- seat reports, and that is the path almost every round takes.
drop function if exists public.pitch_snake_seal_due();

create or replace function public.pitch_snake_seal_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  done integer := 0;
begin
  for due in
    select r.id from public.pitch_snake_rounds r
    where r.sealed_at is null
      and (
        -- the room has begun reporting: wait out the stragglers, then rule
        (r.started_at < now() - interval '90 seconds'
         and exists (select 1 from public.pitch_snake_seats s
                     where s.round_id = r.id and s.log_hash is not null))
        -- nobody has said anything, so this may be a long round still being
        -- played. Fifteen minutes is what room_start already treats as an
        -- abandoned room; twenty leaves that judgment to the room itself.
        or r.started_at < now() - interval '20 minutes'
      )
    order by r.started_at
    limit 500
  loop
    perform public.pitch_snake_seal_round(due.id);
    done := done + 1;
  end loop;
  return done;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule(
  'pitch-snake-seal-rounds',
  '* * * * *',
  $$select public.pitch_snake_seal_due()$$
);

-- Rounds are evidence for as long as a rating dispute could be about them,
-- and litter after that. The seats cascade with them.
select cron.schedule(
  'pitch-snake-rounds-sweep',
  '41 4 * * *',
  $$delete from public.pitch_snake_rounds where started_at < now() - interval '90 days'$$
);

-- --------------------------------------------------------------- reading ----
-- Your own standing, per mode, and provisional until it means something: a
-- rating that has moved three times is noise, and showing it invites a
-- player to read a number that cannot yet be read.
drop function if exists public.pitch_snake_my_rating();

create or replace function public.pitch_snake_my_rating()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_object_agg(t.mode, json_build_object(
           'rating', t.rating, 'rounds', t.rounds, 'wins', t.wins,
           'provisional', t.rounds < 10)), '{}'::json)
  from (
    select rt.mode, rt.rating, rt.rounds, rt.wins
    from public.pitch_snake_ratings rt
    where rt.user_id = auth.uid() and auth.uid() is not null
  ) t;
$$;

-- The ladder itself. Provisional players are LISTED AND MARKED rather than
-- withheld, which is the convention chess settled on long ago and the right
-- one for a board starting from nobody: hiding everyone under ten rounds
-- means an empty box for weeks, and an empty box on a competitive screen
-- reads as broken rather than as new. The P is the honesty; the absence
-- would just have been silence.
drop function if exists public.pitch_snake_top_rated(text, integer);

create or replace function public.pitch_snake_top_rated(p_mode text, p_limit integer default 10)
returns table (name text, country text, rating integer, rounds integer, wins integer, provisional boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(p.name, 'YOU'), p.country, rt.rating, rt.rounds, rt.wins, rt.rounds < 10
  from public.pitch_snake_ratings rt
  left join public.pitch_snake_profiles p on p.user_id = rt.user_id
  where rt.mode = p_mode
  order by rt.rating desc, rt.rounds desc, rt.updated_at
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- What one room's round did to everybody's rating, for the results screen
-- that round produced. Only ever answers for a SEALED round and only for
-- seats that were actually rated, so a code room, an uncorroborated round
-- and a room of signed-out players all return nothing and the screen simply
-- shows no ratings rather than an explanation.
drop function if exists public.pitch_snake_round_ratings(text, integer);

create or replace function public.pitch_snake_round_ratings(p_code text, p_start_n integer)
returns table (seat smallint, name text, place smallint, delta integer,
               rating integer, rounds integer, provisional boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select s.seat, s.name, s.place, s.delta, rt.rating, rt.rounds, rt.rounds < 10
  from public.pitch_snake_seats s
  join public.pitch_snake_rounds r on r.id = s.round_id
  left join public.pitch_snake_ratings rt
         on rt.user_id = s.user_id and rt.mode = r.mode
  where r.code = upper(trim(coalesce(p_code, ''))) and r.start_n = p_start_n
    and r.sealed_at is not null and s.delta is not null
  order by s.place, s.seat;
$$;

-- ------------------------------------------------------- season + stats ----
-- All read-only and scoped to the CALLER (auth.uid()) or to public game
-- facts (a season board, an opponent you actually played), so all safe for
-- anon and authenticated. Every monthly window is keyed the same way seasons
-- are: to_char(ts at time zone 'utc','YYYY-MM'), so the board, the ladder and
-- the stats all agree on where a month begins.

-- The season ladder: the lifetime top_rated pointed at the season table.
drop function if exists public.pitch_snake_top_rated_season(text, text, integer);
create or replace function public.pitch_snake_top_rated_season(
  p_mode text, p_season text, p_limit integer default 10)
returns table (name text, country text, rating integer, rounds integer, wins integer, provisional boolean)
language sql security definer set search_path = '' stable
as $$
  select coalesce(p.name, 'YOU'), p.country, rt.rating, rt.rounds, rt.wins, rt.rounds < 10
  from public.pitch_snake_ratings_season rt
  left join public.pitch_snake_profiles p on p.user_id = rt.user_id
  where rt.mode = p_mode and rt.season = p_season
  order by rt.rating desc, rt.rounds desc, rt.updated_at
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- My season standing, my_rating's json shape for one season (default current).
-- 'gain' is rating - base, the net move this season, which is the monthly
-- ELO gain/loss the stats screen wants without a per-seat season delta.
drop function if exists public.pitch_snake_my_rating_season(text);
create or replace function public.pitch_snake_my_rating_season(p_season text default null)
returns json language sql security definer set search_path = '' stable
as $$
  select coalesce(json_object_agg(t.mode, json_build_object(
           'rating', t.rating, 'rounds', t.rounds, 'wins', t.wins,
           'provisional', t.rounds < 10, 'season', t.season,
           'gain', t.rating - 1000)), '{}'::json)
  from (
    select rt.mode, rt.rating, rt.rounds, rt.wins, rt.season
    from public.pitch_snake_ratings_season rt
    where rt.user_id = auth.uid() and auth.uid() is not null
      and rt.season = coalesce(p_season, to_char((now() at time zone 'utc'), 'YYYY-MM'))
  ) t;
$$;

-- My multiplayer record, lifetime or one season. Only RATED seats count
-- (place is filled at sealing), so an unrated or unsealed round never does.
drop function if exists public.pitch_snake_my_mp_stats(text);
create or replace function public.pitch_snake_my_mp_stats(p_season text default null)
returns json language sql security definer set search_path = '' stable
as $$
  select case when p_season is null then
    -- LIFETIME comes from the ratings row, never from seats. Rounds are swept
    -- at 90 days (the cron below) and seats CASCADE with them, so counting
    -- seats would quietly turn a lifetime record into "the last 90 days" while
    -- still calling itself lifetime. The ladder already keeps the lifetime
    -- totals and they never expire; the net move is rating - base.
    coalesce((
      select json_build_object(
        'played', rt.rounds,
        'won',    rt.wins,
        'lost',   greatest(rt.rounds - rt.wins, 0),
        'delta',  rt.rating - 1000)
      from public.pitch_snake_ratings rt
      where rt.user_id = auth.uid() and auth.uid() is not null and rt.mode = 'classic'
    ), json_build_object('played', 0, 'won', 0, 'lost', 0, 'delta', 0))
  else
    -- A SEASON is at most a month, comfortably inside the sweep, so the seats
    -- ledger is the right (and only) source for a windowed record.
    coalesce((
      select json_build_object(
        'played', count(*),
        'won',    count(*) filter (where s.place = 1),
        'lost',   count(*) filter (where s.place > 1),
        'delta',  coalesce(sum(s.delta), 0))
      from public.pitch_snake_seats s
      where s.user_id = auth.uid() and auth.uid() is not null and s.place is not null
        and to_char(s.claimed_at at time zone 'utc', 'YYYY-MM') = p_season
    ), json_build_object('played', 0, 'won', 0, 'lost', 0, 'delta', 0))
  end;
$$;

-- Head to head against one opponent: rated rounds you both played, and who
-- finished ahead. Both sides come from seats, so it needs no new storage.
drop function if exists public.pitch_snake_h2h(uuid);
create or replace function public.pitch_snake_h2h(p_opponent uuid)
returns json language sql security definer set search_path = '' stable
as $$
  select json_build_object(
    'games',      count(*),
    'my_wins',    count(*) filter (where me.place < opp.place),
    'their_wins', count(*) filter (where me.place > opp.place),
    'draws',      count(*) filter (where me.place = opp.place))
  from public.pitch_snake_seats me
  join public.pitch_snake_seats opp
    on opp.round_id = me.round_id and opp.user_id = p_opponent
  where me.user_id = auth.uid() and auth.uid() is not null
    and me.place is not null and opp.place is not null;
$$;

-- Who you have played, most recent first, with the record against each. This
-- is how a client offers an opponent to inspect, since names are display and
-- the identity is the user_id.
drop function if exists public.pitch_snake_recent_opponents(integer);
create or replace function public.pitch_snake_recent_opponents(p_limit integer default 20)
returns table (opponent uuid, name text, country text, games bigint,
               my_wins bigint, their_wins bigint, last_played timestamptz)
language sql security definer set search_path = '' stable
as $$
  with mine as (
    select round_id, place, claimed_at
    from public.pitch_snake_seats
    where user_id = auth.uid() and auth.uid() is not null and place is not null
  ),
  paired as (
    select opp.user_id as opponent, m.place as my_place, opp.place as opp_place, m.claimed_at
    from mine m
    join public.pitch_snake_seats opp
      on opp.round_id = m.round_id and opp.user_id <> auth.uid() and opp.place is not null
  )
  select pr.opponent, coalesce(p.name, 'YOU'), p.country,
         count(*),
         count(*) filter (where pr.my_place < pr.opp_place),
         count(*) filter (where pr.my_place > pr.opp_place),
         max(pr.claimed_at)
  from paired pr
  left join public.pitch_snake_profiles p on p.user_id = pr.opponent
  group by pr.opponent, p.name, p.country
  order by max(pr.claimed_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; take it back, then
-- hand it out deliberately. Note what is NOT handed out: record_round and
-- seal_round take a user id or decide a rating, so they belong to the service
-- role and to cron, never to a browser.
--
-- REVOKING FROM PUBLIC IS NOT ENOUGH, and this was shipped wrong once.
-- Supabase grants EXECUTE to anon and authenticated in their own right, so a
-- function revoked only from PUBLIC stays callable with the publishable key
-- that sits in the page. record_round takes p_user, which means any browser
-- could have written a seat for ANY player and then sealed the round at a
-- moment of its choosing. Name the two roles explicitly, every time.
revoke all on function public.pitch_snake_take_seat(text, integer, integer, text)     from public;
revoke all on function public.pitch_snake_record_round(bigint, uuid, text, jsonb, bigint) from public;
revoke all on function public.pitch_snake_seal_round(bigint)                          from public;
revoke all on function public.pitch_snake_seal_due()                                  from public;
revoke execute on function public.pitch_snake_record_round(bigint, uuid, text, jsonb, bigint) from anon, authenticated;
revoke execute on function public.pitch_snake_seal_round(bigint)  from anon, authenticated;
revoke execute on function public.pitch_snake_seal_due()          from anon, authenticated;
grant execute on function public.pitch_snake_record_round(bigint, uuid, text, jsonb, bigint) to service_role;
grant execute on function public.pitch_snake_seal_round(bigint) to service_role, postgres;
grant execute on function public.pitch_snake_seal_due()         to service_role, postgres;
revoke all on function public.pitch_snake_my_rating()                                 from public;
revoke all on function public.pitch_snake_top_rated(text, integer)                    from public;
revoke all on function public.pitch_snake_round_ratings(text, integer)                from public;

grant execute on function public.pitch_snake_take_seat(text, integer, integer, text)  to anon, authenticated;
grant execute on function public.pitch_snake_my_rating()                              to anon, authenticated;
grant execute on function public.pitch_snake_top_rated(text, integer)                 to anon, authenticated;
grant execute on function public.pitch_snake_round_ratings(text, integer)             to anon, authenticated;

-- season + stats reads: all caller-scoped or public game facts, so anon + auth
revoke all on function public.pitch_snake_top_rated_season(text, text, integer)       from public;
revoke all on function public.pitch_snake_my_rating_season(text)                      from public;
revoke all on function public.pitch_snake_my_mp_stats(text)                           from public;
revoke all on function public.pitch_snake_h2h(uuid)                                   from public;
revoke all on function public.pitch_snake_recent_opponents(integer)                   from public;
grant execute on function public.pitch_snake_top_rated_season(text, text, integer)    to anon, authenticated;
grant execute on function public.pitch_snake_my_rating_season(text)                   to anon, authenticated;
grant execute on function public.pitch_snake_my_mp_stats(text)                        to anon, authenticated;
grant execute on function public.pitch_snake_h2h(uuid)                                to anon, authenticated;
grant execute on function public.pitch_snake_recent_opponents(integer)               to anon, authenticated;
