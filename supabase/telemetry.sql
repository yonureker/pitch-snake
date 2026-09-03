-- Pitch Snake: net telemetry. The one thing the server cannot see.
--
-- Run this in the SQL editor after leaderboard.sql and auth.sql (idempotent).
--
-- Why this file exists. Multiplayer runs on Supabase Realtime Broadcast,
-- which is not logged per message: realtime_logs carries tenant lifecycle and
-- nothing about delivery or latency. And the two failures players actually
-- report die in the browser: vsDesync draws "CONNECTION LOST" and sends
-- nothing, a stall draws "WAITING" and sends nothing. So a lag report could
-- be neither confirmed nor measured, and a fix could not be told from a
-- coincidence. This table is the missing half of that loop.
--
-- What it deliberately does NOT hold: no message contents, no inputs, no
-- board state, no addresses, nothing typed by a player. A row is a shape of a
-- failure, not a recording of a session.
--
-- Same access shape as everything else here: RLS on, no policies, no grants,
-- and one SECURITY DEFINER function as the only door.

create table if not exists public.pitch_snake_net_events (
  id          bigint generated always as identity primary key,
  user_id     uuid,                    -- who saw it; null for a signed-out client
  kind        text        not null,    -- 'round' | 'desync'
  code        text,                    -- room code, so one bad room is visible as one room
  reason      text,                    -- desync only: 'behind' | 'hash' | ...
  peers       smallint,                -- seats in the room
  quanta      integer,                 -- how far the round had run
  stalled_ms  integer,                 -- total time frozen
  longest_ms  integer,                 -- worst single freeze: what a player feels
  giveups     smallint,                -- peers dropped from the leash for sustained lag
  rollbacks   integer,
  resends     integer,
  client      text,                    -- coarse class only: 'web-desktop' | 'web-mobile' | 'app'
  created_at  timestamptz not null default now()
);

-- the two questions this table exists to answer: what happened lately, and
-- does one room or one client account for it
create index if not exists pitch_snake_net_events_recent_idx
  on public.pitch_snake_net_events (created_at desc);
create index if not exists pitch_snake_net_events_code_idx
  on public.pitch_snake_net_events (code, created_at desc);

alter table public.pitch_snake_net_events enable row level security;
revoke all on table public.pitch_snake_net_events from anon, authenticated;

-- ------------------------------------------------------------- the door ----
-- Fire and forget from the client's side: it returns void and the page never
-- waits on it. Telemetry that can slow a game down is worse than no
-- telemetry, and this is a game.
--
-- Everything is clamped or discarded rather than trusted. A client that
-- reports nonsense should write a harmless row or none at all, never a row
-- that poisons the numbers the next fix is judged by.
--
-- Rate limited per user, because the failure being measured is exactly the
-- one that could loop: a client desyncing over and over must not be able to
-- write a thousand rows about it.
drop function if exists public.pitch_snake_log_net_event(text, text, text, integer, integer, integer, integer, integer, integer, integer, text);

create or replace function public.pitch_snake_log_net_event(
  p_kind       text,
  p_code       text default null,
  p_reason     text default null,
  p_peers      integer default null,
  p_quanta     integer default null,
  p_stalled_ms integer default null,
  p_longest_ms integer default null,
  p_giveups    integer default null,
  p_rollbacks  integer default null,
  p_resends    integer default null,
  p_client     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent int;
begin
  if p_kind is null or p_kind not in ('round', 'desync') then
    return;                            -- unknown shape: drop it, do not raise
  end if;

  -- Sixty rows in ten minutes is far more than honest play produces (a room
  -- writes one row per round) and far less than a desync loop would.
  if auth.uid() is not null then
    select count(*) into recent from public.pitch_snake_net_events
    where user_id = auth.uid() and created_at > now() - interval '10 minutes';
    if recent >= 60 then
      return;
    end if;
  end if;

  insert into public.pitch_snake_net_events (
    user_id, kind, code, reason, peers, quanta,
    stalled_ms, longest_ms, giveups, rollbacks, resends, client
  ) values (
    auth.uid(),
    p_kind,
    -- a room code is six characters from a known alphabet or it is nothing
    case when p_code ~ '^[A-Z0-9]{6}$' then p_code else null end,
    left(regexp_replace(coalesce(p_reason, ''), '[^a-z]', '', 'g'), 16),
    least(greatest(coalesce(p_peers, 0), 0), 8),
    least(greatest(coalesce(p_quanta, 0), 0), 2000000),
    least(greatest(coalesce(p_stalled_ms, 0), 0), 3600000),
    least(greatest(coalesce(p_longest_ms, 0), 0), 3600000),
    least(greatest(coalesce(p_giveups, 0), 0), 8),
    least(greatest(coalesce(p_rollbacks, 0), 0), 1000000),
    least(greatest(coalesce(p_resends, 0), 0), 1000000),
    case when p_client in ('web-desktop', 'web-mobile', 'app') then p_client else null end
  );
end;
$$;

revoke all on function public.pitch_snake_log_net_event(text, text, text, integer, integer, integer, integer, integer, integer, integer, text) from public;
grant execute on function public.pitch_snake_log_net_event(text, text, text, integer, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------- housekeeping ----
-- These rows answer "what is happening lately"; they are not a record worth
-- keeping. Thirty days is long enough to see a pattern and to tell a fix from
-- a coincidence.
create extension if not exists pg_cron;
select cron.schedule(
  'pitch-snake-net-events-sweep',
  '23 4 * * *',
  $$delete from public.pitch_snake_net_events where created_at < now() - interval '30 days'$$
);

-- ---------------------------------------------------------- achievements ----
-- Granted by the validator and nowhere else, because they are about to carry
-- coins and competitive tickets: a client that can award itself currency is a
-- client that can print money. The catalogue (what each one IS) lives in the
-- validator rather than here or in the engine, so adding one is a redeploy
-- rather than an ENGINE_VERSION bump and a re-pin.
create table if not exists public.pitch_snake_achievements (
  user_id     uuid        not null,
  achievement text        not null,
  score_id    bigint,
  earned_at   timestamptz not null default now(),
  primary key (user_id, achievement)   -- earned once, and once only
);

create index if not exists pitch_snake_achievements_user_idx
  on public.pitch_snake_achievements (user_id, earned_at desc);

alter table public.pitch_snake_achievements enable row level security;
revoke all on table public.pitch_snake_achievements from anon, authenticated;

drop function if exists public.pitch_snake_my_achievements();

create or replace function public.pitch_snake_my_achievements()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_agg(json_build_object(
           'id', a.achievement, 'at', a.earned_at) order by a.earned_at), '[]'::json)
  from public.pitch_snake_achievements a
  where a.user_id = auth.uid() and auth.uid() is not null;
$$;

-- ------------------------------------------------- the catalogue mirror ----
-- What each badge IS, so a player can see the ones they have NOT earned:
-- a shelf that shows only what you already have tells you nothing about what
-- the game rewards, which is most of the point of having badges at all.
--
-- The validator owns the real catalogue and this table is its MIRROR, pushed
-- on every grant pass. That is deliberate: a second hand-maintained copy is
-- the flag-sprite mistake (one artefact in three places, silently drifting),
-- whereas a copy the authoritative source refreshes cannot drift for longer
-- than one validated round. Display only; nothing here decides a grant.
create table if not exists public.pitch_snake_achievement_catalogue (
  id   text     primary key,
  name text     not null,
  note text     not null,
  sort smallint not null default 0
);

alter table public.pitch_snake_achievement_catalogue enable row level security;
revoke all on table public.pitch_snake_achievement_catalogue from anon, authenticated;

drop function if exists public.pitch_snake_sync_achievements(jsonb);

create or replace function public.pitch_snake_sync_achievements(p_list jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pitch_snake_achievement_catalogue (id, name, note, sort)
  select e.value->>'id', e.value->>'name', e.value->>'note', e.ordinality
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) with ordinality e
  where e.value->>'id' ~ '^[a-z0-9-]{1,40}$'
  on conflict (id) do update
    set name = excluded.name, note = excluded.note, sort = excluded.sort;
$$;

-- Every badge, with the date on the ones this player has. Ordered by the
-- catalogue's own order so the shelf reads the way the validator lists them.
drop function if exists public.pitch_snake_my_achievements();

create or replace function public.pitch_snake_my_achievements()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'name', c.name, 'note', c.note, 'at', a.earned_at
         ) order by c.sort, c.id), '[]'::json)
  from public.pitch_snake_achievement_catalogue c
  left join public.pitch_snake_achievements a
         on a.achievement = c.id and a.user_id = auth.uid() and auth.uid() is not null;
$$;

revoke all on function public.pitch_snake_my_achievements()      from public;
revoke all on function public.pitch_snake_sync_achievements(jsonb) from public;
grant execute on function public.pitch_snake_my_achievements()   to anon, authenticated;
-- Sync belongs to the validator's service role and to nobody else. Revoking
-- from PUBLIC does not achieve that on its own: Supabase grants anon and
-- authenticated separately, so a browser holding the publishable key could
-- otherwise rewrite every badge's name and note.
revoke execute on function public.pitch_snake_sync_achievements(jsonb) from anon, authenticated;
grant  execute on function public.pitch_snake_sync_achievements(jsonb) to service_role;
