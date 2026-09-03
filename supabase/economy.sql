-- Pitch Snake: the economy. Coins, the shop, the inventory, what is worn.
--
-- One sentence governs this file the way "the server decides every score"
-- governs leaderboard.sql: COINS ARE MINTED BY THE VALIDATOR AND NOWHERE
-- ELSE. A coin is currency, a client that can award itself currency can
-- print money, and the validator is the one place that already knows what a
-- round truthfully contained, because it replayed it. Clients read balances,
-- spend them through one function, and wear what they own. They never mint.
--
-- The ledger is append only and every row says why it exists. There is no
-- cached balance column to drift out of agreement with its own history:
-- the balance IS the sum, which is the "derive over store" rule from
-- CLAUDE.md applied to money, where it matters most. The unique constraint
-- on (user_id, reason, ref) is the idempotency: a validator retry, a double
-- click, a replayed request all collapse into the row that already exists.
--
-- Coins buy cosmetics and nothing else. Nothing in this file may ever gate
-- play, join a room, or touch the engine: a skin is paint. Prices live HERE
-- and never in the clients, for the same reason scores do; the ART lives in
-- the clients keyed by item id, and an id a client does not know renders as
-- the default skin, which is what lets the catalogue grow by SQL alone.
--
-- Tickets for competitive play are deliberately absent. There is nothing to
-- spend a ticket on yet, and a currency with no sink is a number that only
-- ever goes up. When gated events exist, tickets get their own reasons in
-- this same ledger rather than a second one.

-- ------------------------------------------------------------- the ledger ----
create table if not exists public.pitch_snake_coins (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null,
  delta      integer     not null check (delta <> 0 and delta between -100000 and 100000),
  reason     text        not null check (reason in ('achievement', 'round', 'buy', 'backfill')),
  ref        text        not null,
  created_at timestamptz not null default now(),
  -- one payment per cause, forever: 'achievement' pays per badge id, 'round'
  -- per seed, 'buy' per item. Retries and replays hit this and vanish.
  unique (user_id, reason, ref)
);

create index if not exists pitch_snake_coins_user_idx
  on public.pitch_snake_coins (user_id, created_at desc);

alter table public.pitch_snake_coins enable row level security;
revoke all on table public.pitch_snake_coins from anon, authenticated;

-- ---------------------------------------------------------- the catalogue ----
-- What is for sale, and for how much. The server's word on prices, seeded
-- below and changed by SQL, never by a client and never by the validator.
-- `kind` is the wearable slot; one of each may be worn at a time.
create table if not exists public.pitch_snake_items (
  id    text     primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  kind  text     not null check (kind in ('skin', 'hat')),
  name  text     not null,
  price integer  not null check (price > 0),
  sort  smallint not null default 0
);

alter table public.pitch_snake_items enable row level security;
revoke all on table public.pitch_snake_items from anon, authenticated;

insert into public.pitch_snake_items (id, kind, name, price, sort) values
  ('skin-away',  'skin', 'AWAY DAYS',   250, 1),
  ('skin-volt',  'skin', 'VOLT',        250, 2),
  ('skin-rosa',  'skin', 'ROSA',        250, 3),
  ('skin-night', 'skin', 'NIGHT MATCH', 400, 4),
  ('skin-gilt',  'skin', 'GILDED',      600, 5),
  ('hat-band',   'hat',  'SWEATBAND',   200, 6),
  ('hat-cap',    'hat',  'FLAT CAP',    300, 7),
  ('hat-crown',  'hat',  'CROWN',       500, 8)
on conflict (id) do update
  set kind = excluded.kind, name = excluded.name,
      price = excluded.price, sort = excluded.sort;

-- ---------------------------------------------------------- the inventory ----
create table if not exists public.pitch_snake_inventory (
  user_id     uuid        not null,
  item_id     text        not null references public.pitch_snake_items (id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)   -- owned once; cosmetics do not stack
);

alter table public.pitch_snake_inventory enable row level security;
revoke all on table public.pitch_snake_inventory from anon, authenticated;

-- What is worn rides the profile row, beside the name and the flag it will
-- be drawn with. Same null-keeps contract as set_profile's country: these
-- columns belong to the profile, this feature merely adds them.
alter table public.pitch_snake_profiles add column if not exists skin text;
alter table public.pitch_snake_profiles add column if not exists hat  text;

-- ------------------------------------------------------------ the readers ----
-- The shop is world readable, signed out included: a player deciding whether
-- coins are worth chasing is exactly who should be allowed to look.
drop function if exists public.pitch_snake_shop();

create or replace function public.pitch_snake_shop()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_agg(json_build_object(
           'id', i.id, 'kind', i.kind, 'name', i.name, 'price', i.price
         ) order by i.sort, i.id), '[]'::json)
  from public.pitch_snake_items i;
$$;

-- Everything the wallet UI needs in one round trip: balance, owned ids, and
-- what is worn. A signed-out caller gets the empty wallet rather than an
-- error, so the page never has to care whether auth is up.
drop function if exists public.pitch_snake_my_wallet();

create or replace function public.pitch_snake_my_wallet()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select json_build_object(
    'coins', coalesce((select sum(c.delta) from public.pitch_snake_coins c
                       where c.user_id = auth.uid()), 0),
    'items', coalesce((select json_agg(v.item_id order by v.acquired_at)
                       from public.pitch_snake_inventory v
                       where v.user_id = auth.uid()), '[]'::json),
    'skin',  (select p.skin from public.pitch_snake_profiles p where p.user_id = auth.uid()),
    'hat',   (select p.hat  from public.pitch_snake_profiles p where p.user_id = auth.uid())
  );
$$;

-- ------------------------------------------------------------- the spend ----
-- The one door out of a wallet. Balance is computed inside the same
-- transaction that spends it, under a per-user advisory lock, because two
-- purchases racing each other is the classic way a balance goes negative;
-- the unique ledger row makes buying the same item twice impossible even
-- without the lock. Returns the wallet it left behind, so the shop repaints
-- from the same answer.
drop function if exists public.pitch_snake_buy_item(text);

create or replace function public.pitch_snake_buy_item(p_item text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_price integer;
  v_have  integer;
begin
  if v_uid is null then
    return json_build_object('error', 'no session');
  end if;
  select i.price into v_price from public.pitch_snake_items i where i.id = p_item;
  if v_price is null then
    return json_build_object('error', 'no such item');
  end if;
  if exists (select 1 from public.pitch_snake_inventory v
             where v.user_id = v_uid and v.item_id = p_item) then
    return json_build_object('error', 'already owned');
  end if;
  perform pg_advisory_xact_lock(hashtext('pitch_snake_coins'), hashtext(v_uid::text));
  select coalesce(sum(c.delta), 0) into v_have
  from public.pitch_snake_coins c where c.user_id = v_uid;
  if v_have < v_price then
    return json_build_object('error', 'not enough coins', 'coins', v_have);
  end if;
  insert into public.pitch_snake_coins (user_id, delta, reason, ref)
  values (v_uid, -v_price, 'buy', p_item);
  insert into public.pitch_snake_inventory (user_id, item_id)
  values (v_uid, p_item);
  return public.pitch_snake_my_wallet();
end;
$$;

-- --------------------------------------------------------------- the wear ----
-- The set_profile country contract, applied to the wardrobe: null keeps what
-- is worn, '' undresses the slot, an id wears it, and only owned items go on.
-- Wearing is free and reversible, which is why this validates ownership and
-- nothing else.
drop function if exists public.pitch_snake_equip(text, text);

create or replace function public.pitch_snake_equip(p_skin text, p_hat text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('error', 'no session');
  end if;
  if p_skin is not null and p_skin <> '' and not exists (
       select 1 from public.pitch_snake_inventory v
       join public.pitch_snake_items i on i.id = v.item_id and i.kind = 'skin'
       where v.user_id = v_uid and v.item_id = p_skin) then
    return json_build_object('error', 'skin not owned');
  end if;
  if p_hat is not null and p_hat <> '' and not exists (
       select 1 from public.pitch_snake_inventory v
       join public.pitch_snake_items i on i.id = v.item_id and i.kind = 'hat'
       where v.user_id = v_uid and v.item_id = p_hat) then
    return json_build_object('error', 'hat not owned');
  end if;
  -- Upsert, not update: set_levels' lesson verbatim. A profile row is only
  -- created when a name is set, and an anonymous player can buy a skin
  -- before ever typing one; a plain UPDATE matched nothing and the outfit
  -- went nowhere, silently, which is exactly how this shipped the first
  -- time and was caught by the rollback test.
  insert into public.pitch_snake_profiles (user_id, name, skin, hat)
  values (v_uid, 'YOU', nullif(p_skin, ''), nullif(p_hat, ''))
  on conflict (user_id) do update
    set skin = case when p_skin is null then public.pitch_snake_profiles.skin
                    when p_skin = ''    then null
                    else p_skin end,
        hat  = case when p_hat is null then public.pitch_snake_profiles.hat
                    when p_hat = ''    then null
                    else p_hat end,
        updated_at = now();
  return public.pitch_snake_my_wallet();
end;
$$;

-- ------------------------------------------------------------- the grants ----
-- The anon/authenticated lesson from leaderboard.sql applies verbatim:
-- revoke from PUBLIC does not touch the grants Supabase gives those two
-- roles in their own right, and a function that must not be client callable
-- has to revoke them BY NAME. Nothing here mints, so nothing here needs the
-- service-only treatment; the mint is the validator writing the ledger table
-- directly under its service role, which RLS with no policies already
-- reserves to it.
revoke all on function public.pitch_snake_shop()                 from public;
revoke all on function public.pitch_snake_my_wallet()            from public;
revoke all on function public.pitch_snake_buy_item(text)         from public;
revoke all on function public.pitch_snake_equip(text, text)      from public;
grant execute on function public.pitch_snake_shop()              to anon, authenticated;
grant execute on function public.pitch_snake_my_wallet()         to anon, authenticated;
grant execute on function public.pitch_snake_buy_item(text)      to anon, authenticated;
grant execute on function public.pitch_snake_equip(text, text)   to anon, authenticated;

-- The audit that caught record_round exposed once already. Run after ANY
-- change to this file; every row must read the way the comment above says.
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'pitch_snake_%';

-- ------------------------------------------------------------ the backfill ----
-- Players who earned badges before coins existed wake up paid, once. The
-- bounty values are the validator's catalogue as of 2026-09-03, copied here
-- because a one-time backfill cannot drift: it runs, it is history. The
-- unique constraint makes re-running this file a no-op.
insert into public.pitch_snake_coins (user_id, delta, reason, ref)
select a.user_id, b.coins, 'backfill', a.achievement
from public.pitch_snake_achievements a
join (values
  ('first-whistle', 25), ('ten-up', 30), ('last-ditch', 40),
  ('through-the-window', 40), ('struck', 50), ('hat-trick', 75),
  ('clean-sheet', 75), ('half-century', 100), ('the-full-ninety', 100)
) as b (id, coins) on b.id = a.achievement
on conflict (user_id, reason, ref) do nothing;

-- ------------------------------------------------------- catalogue bounty ----
-- The achievements shelf wants to show what a badge PAYS next to what it is.
-- Same mirror rule as the names and notes in telemetry.sql: the validator's
-- sync pushes it, display only, nothing here decides a payment.
alter table public.pitch_snake_achievement_catalogue
  add column if not exists coins integer not null default 0;

drop function if exists public.pitch_snake_sync_achievements(jsonb);

create or replace function public.pitch_snake_sync_achievements(p_list jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pitch_snake_achievement_catalogue (id, name, note, coins, sort)
  select e.value->>'id', e.value->>'name', e.value->>'note',
         coalesce((e.value->>'coins')::integer, 0), e.ordinality
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) with ordinality e
  where e.value->>'id' ~ '^[a-z0-9-]{1,40}$'
  on conflict (id) do update
    set name = excluded.name, note = excluded.note,
        coins = excluded.coins, sort = excluded.sort;
$$;

revoke all     on function public.pitch_snake_sync_achievements(jsonb) from public;
revoke execute on function public.pitch_snake_sync_achievements(jsonb) from anon, authenticated;
grant  execute on function public.pitch_snake_sync_achievements(jsonb) to service_role;

drop function if exists public.pitch_snake_my_achievements();

create or replace function public.pitch_snake_my_achievements()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'name', c.name, 'note', c.note, 'coins', c.coins,
           'at', a.earned_at
         ) order by c.sort, c.id), '[]'::json)
  from public.pitch_snake_achievement_catalogue c
  left join public.pitch_snake_achievements a
         on a.achievement = c.id and a.user_id = auth.uid() and auth.uid() is not null;
$$;

revoke all on function public.pitch_snake_my_achievements() from public;
grant execute on function public.pitch_snake_my_achievements() to anon, authenticated;
