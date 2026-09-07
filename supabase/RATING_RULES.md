# The ladder: what counts, who counts, and what it costs

The rules a rating obeys, in one place. `rating.sql` is the implementation and
this file is the contract; if they ever disagree, the SQL is what runs and this
file is the bug. Every rule here exists because leaving it out creates a way to
farm a number, and a rating nobody believes is worse than no rating.

## 1. What a rated round is

**A rated round is one the server set up, seated and scored.** Nothing a client
says can conjure one.

- `pitch_snake_room_start` mints the seed AND writes the round of record into
  `pitch_snake_rounds` before a single input exists, so the seed, the seat
  count and the room's provenance are settled before anybody plays.
- `origin` is stamped by the server, never sent: `room_create` is a public door
  and always writes `'code'`; only `room_quickmatch` writes `'quick'`.
- **Only `'quick'` rounds are rated.** Pairwise Elo against five accounts you
  chose is a printing press, and quick match is the one seating a player does
  not pick. A private CODE room plays the identical round and is simply not
  rated.
- Solo boards and tournaments are a different system entirely and never touch a
  rating.

## 2. Who counts as having played

**A seat, and only a seat.** `pitch_snake_take_seat` reads `auth.uid()` and
takes no user id as a parameter, so it can seat nobody but its caller.

- **Seats are claimed at KICKOFF, never at full time.** At full time the loser
  could claim the winner's seat; at kickoff nobody yet knows which seat that is,
  so there is nothing to gain by lying.
- **A player who never readies is never in a round.** The host's START is only
  offered when every present player is ready (`ready === seatList.length`), so a
  room cannot begin around someone who has not consented to play. There is no
  case where an idle spectator is rated.
- **A player who joins after kickoff has no seat.** The roster is snapshot when
  the round starts; a later arrival is in the room, not in the round, and waits
  for the next one.
- **A player who is signed out has no seat.** `record_round` answers `'no seat'`
  and the round is simply not rated for them. The round still happened; it just
  does not count towards a ladder nobody entered. Nothing gates PLAY on this.
- A round with fewer than two seated players is never rated: a duel needs two.

## 3. The maths

- A five-player result is **ten duels**: ordinary Elo per pair against the
  finishing order, summed and divided by `N - 1`, so a five-player round moves a
  rating about as far as one duel and rooms of two and five share a pool.
- Expectations come from a **snapshot of the ratings before the round**, so the
  result never depends on the order players are visited.
- **K is 40** until ten rounds are behind a player, then **20**. The floor is
  **100**. Ratings are per mode, like the boards, and hidden until ten rounds
  (marked `P`, the chess convention, rather than withheld).
- Equal score on the same quantum is a **draw**, worth 0.5 to each side.
  Competition ranking, so a shared first is followed by third.
- **Margin is deliberately ignored**, and not only because Elo usually does: the
  clinch rule ends a round the moment the last survivor passes every fallen
  rival, so a dominant win STOPS EARLY and records a margin of one point.
  Margins are compressed exactly when somebody is winning big.

## 4. Sealing: whose word decides the round

A round seals on a **90-second delay** rather than on the last submission,
because there is no way to know a submission is the last one.

Every peer holds a byte-identical copy of a deterministic round, so
corroboration is free to ask for, and it closes the one hole a single
submission cannot: **a fabricated log against a real seed replays perfectly
well.** So a report is written to the REPORTER'S seat and never to the round,
and `seal_round` reads the modal `log_hash`.

Reporting and agreeing are different questions, and the answer depends on how
many seats reported at all:

| Seats that reported | Outcome |
|---|---|
| none | unrated |
| one | **the no-show rule**, below |
| two or more, a majority agrees | rated on the agreed log's placings |
| two or more, no majority | unrated: a forgery or a desync, and nobody's word wins that argument |

The finishing order is taken from a seat holding the agreed hash, **not from
whoever reported first**, which is the difference between a majority deciding
the round and the fastest submitter deciding it. The fingerprint covers the
KNOBS as well as the inputs, or the same presses under a different ruleset
would corroborate the real round while being rated in another pool.

## 5. The no-show rule

**A seat that never reports is not a seat that escapes.**

A two-player room whose opponent closes the tab mid-round used to seal
*unrated*, because sealing demanded two agreeing witnesses. That quietly made
leaving while losing **cheaper than playing the round out**, which is the exact
exploit this ladder's own notes say a disconnect must never become.

So when exactly one seat reports, the round is rated on the only fact the
SERVER can check for itself, and not on the lone log's word:

> who submitted a log that replayed against this round's own seed, and who
> did not.

Submitters place ahead of absentees; absentees tie with each other. The lone
log's own `placings` are **ignored**, because its author is the only person who
saw it, and the round records no agreed placings.

This is safe against the obvious attack. A player who loses and then forges a
winning log does not reach this path: their opponent's honest report makes two
reports with no majority, which is unrated. Reaching the no-show path requires
the opponent to have genuinely never reported, which is the disconnect this
rule exists to rate.

## 6. Quitting

**FORFEIT concedes the round and keeps your seat. LEAVE concedes the room.
Disconnecting concedes both by accident. All three are rated identically to
playing the round out badly.**

- Mechanically a forfeit just **stops the seat sending inputs**: the snake runs
  on its last heading in the shared simulation and crashes on its own, which is
  precisely what a dropped peer already does. Every peer sees the identical
  round, so the log still corroborates and the round still seals. No engine
  rule changes and nothing is special-cased.
- **Unrated would be an exploit**: quit whenever you are losing and never lose a
  point.
- **Costlier than a crash would also be wrong**: it would push players towards
  the dishonest exit of pulling the plug, and a lag drop and a rage quit are
  indistinguishable to the engine on purpose. Making lag unrated would be an
  invitation to fake it; `pitch_snake_net_events` is where that gets watched
  instead.
- The UI follows the rule: while your seat is alive the only way out of a live
  round is FORFEIT (there is no mid-round LEAVE to press by accident, because
  walking out of a round IS conceding it), and once you are out, crashed or
  conceded, the score block hands its corner to LEAVE.

## 7. What the player sees

- The room's own results board carries **both** the series trophy and the
  rating: they answer different questions, the trophy being this room's running
  tally and the rating being the ladder. The rating arrives a moment later,
  when the round seals, and lands beside the trophy rather than replacing it.
- A seat with no rating (nobody signed in there) gets no line, rather than a
  zero.
- The LADDER screen is the third panel on the multiplayer step.

## 8. What is deliberately absent

- **Rating-based matchmaking.** Seeding by rating needs a population before it
  can do anything but strand people in an empty queue.
- **Decay, seasons, placement matches.** Not until there is enough play to say
  what they should do.
- **Any gate on play.** A room that cannot reach the ladder plays the identical
  round and simply is not rated, exactly like identity. Nothing here may ever
  stop somebody playing.
