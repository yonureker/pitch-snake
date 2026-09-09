# Room rules

How a multiplayer room is opened, filled, played and let go. The SQL in
`rooms.sql` is what runs, and the client half lives in `index.html` and
`apps/mobile/src/hooks/use-room.ts`; a disagreement between them and this file
is a bug in this file. Companion to `RATING_RULES.md`, which owns what happens
to a rating once a round has been played.

## 1. Two kinds of room, and only one of them is matchmaking

`origin` is stamped by the SERVER and never by a client.

- **`code`** — opened by `pitch_snake_room_create`. A private door: the code is
  the invitation, and quick match never offers one. Not rated.
- **`quick`** — opened by `pitch_snake_room_quickmatch`. The only pool a
  stranger is ever seated into, and the only one the ladder rates.

The split is not tidiness. Pairwise Elo against five accounts you picked is a
printing press, so the rated pool has to be the one nobody chooses. It also
stops a stranger being dropped into two friends' private room, which was the
behaviour before `origin` existed and was surprising on its own.

A code is five characters of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`: no `0/O` and
no `1/I`, because the code is read aloud and typed by someone else. `S` and `5`
both survive, which is worth knowing when a join fails.

## 2. What quick match actually does

`pitch_snake_room_quickmatch(p_region)` looks for one room:

```
status = 'waiting'  and  origin = 'quick'
player_count between 1 and 4
last_seen > now() - interval '25 seconds'
order by (region = mine) desc, player_count desc, created_at desc
limit 1 for update skip locked
```

and if it finds none, creates one and stamps it with the searcher's region.

Read the `order by` as three rules in priority order:

1. **Neighbours first.** Region is a PREFERENCE and never a filter, so a thin
   pool still seats you rather than stranding you. `coalesce` is what puts
   unknown regions last instead of first, which is what a bare `DESC` would do.
2. **Fullest first.** Filling one room to five beats starting five rooms of
   one. A game that exists beats a better-matched game that does not.
3. **Newest first**, as the tie-break, because an older room at the same count
   is more likely to be the one somebody has already given up on.

`skip locked` keeps two simultaneous searchers off the same row.

Region comes from the browser's own timezone (`vsRegion()`), bucketed to `am`,
`eu` or `as`. It is a hint about where somebody is, not a claim about who they
are, and nothing is refused on it.

## 3. When a second room opens

A room is only offered while it holds **1 to 4** players, so the sixth searcher
finds nothing joinable and opens a room of their own. That is the whole
mechanism: there is no lobby, no queue and no matchmaker process. Rooms are
created by demand and found by the next person to look.

Seats cap at five. A player who lands after the roster was taken is told **"This
round is full; you are in the next one"** and sits the round out in the room
rather than being ejected from it.

## 4. When a room takes new players

Whenever it is `waiting`, holds 1 to 4, and has been touched in the last 25
seconds. Three consequences worth stating:

- **A room emptied down to one player is refilled**, and this is deliberate: it
  is a live room with a person waiting in it, which is the best thing quick
  match can find. The host role migrates to whoever is first by arrival when
  the previous host leaves, so the last player standing keeps the room warm.
- **A room mid-round is never offered.** `room_start` flips it to `playing`,
  and `room_finish` flips it back to `waiting` for the rematch.
- **A room nobody is touching disappears from matchmaking in 25 seconds**, and
  is deleted 24 hours after it was created by the hourly sweep. Nothing ever
  "closes" a room: it simply stops being spoken for.

## 5. How a round starts

- **Quick rooms start themselves.** Once every present seat is ready and there
  are at least two, the lobby counts down from three and any client may call
  the kickoff; the server's row lock decides which one. In a room you did not
  choose, one stranger holding the whistle is a single point of failure, and a
  host who tabs away used to freeze four other people indefinitely.
- **Code rooms wait for their host.** There the host may be holding the room
  for a friend who has not arrived, and only a person can know that.

Either way the SERVER mints the seed and broadcasts one kickoff to everyone, so
no client picks the dice and two people racing REMATCH cannot fork the room.

## 6. Rating is not part of matchmaking, on purpose

**No Elo is read, written or considered when seating anybody.** Skill-based
matchmaking needs a population before it can do anything except strand people
in an empty queue, and a game that will not start is worse than a game that is
uneven. `RATING_RULES.md` owns what happens after the whistle; nothing there
reaches back into this file.

When there is a population to sort, the honest way in is a widening band: prefer
a room within N points, widen N with every second spent waiting, and never let
it refuse the only room there is. That is a change to the `order by` above and
nothing else, which is why it can wait.

## 7. The known weakness, so nobody rediscovers it

`player_count` is **host-reported**, pushed by `pitch_snake_room_touch` every
ten seconds, and browsers throttle timers in a backgrounded tab to about once a
minute. So:

- **a live room can go invisible.** Measured on 2026-09-08: a host with a
  backgrounded tab touched once in 78 seconds, so their occupied room aged past
  the 25-second window and quick match built the searcher a new room instead of
  seating them with the person who was already there. Two players, two rooms,
  neither able to find the other.
- **a full room can be over-offered**, because the count can be up to ten
  seconds stale. The client absorbs this: the sixth player is told the round is
  full and waits for the next one.

The fix is not a longer window, which would only advertise dead rooms for
longer. It is for the room's liveness to come from something a timer cannot
sleep through, presence being the obvious candidate, since it arrives on the
socket rather than on a clock. Nobody has done it yet.
