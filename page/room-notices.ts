/**
 * Who came and who went: the difference between two presence snapshots, and
 * the one line a room says about it.
 *
 * OWNS the comparison and the phrasing. A room's membership arrives as a
 * presence snapshot, whole, every time it changes, so the news is never in the
 * snapshot itself: it is in what moved between this one and the last. This
 * owns that subtraction, the washing of a peer-typed name into something the
 * strip can hold, and the coalescing of several movers into one line.
 *
 * MUST NEVER touch the DOM, read the room, or know what a withdrawal is. It is
 * told two lists and a ref and answers with names; the shell decides where the
 * line goes and which verb the movement deserves, because that answer lives in
 * engine state this module has no business reading.
 *
 * THE GUARD THAT MATTERS is the reconnect one. Our own socket re-lands the
 * whole room's presence on every reconnect, and a snapshot caught inside that
 * gap can be missing everybody. Subtracting it naively reports the entire room
 * leaving at once, on a wire blip, to the one person who can see it is wrong.
 * We always know WE are here, so a snapshot that has lost us is a snapshot to
 * ignore rather than a room that emptied.
 *
 * @module room-notices
 */

/** How long a notice stays on screen, in ms. Long enough to read once. */
export const NOTICE_MS = 6000;

/** One member of a room, as presence describes them. */
export interface Seat {
  /** The presence key: the identity a room actually tracks. */
  ref: string;
  /** What to call them, already washed by `displayName`. */
  name: string;
}

/** What moved between two snapshots. Both lists exclude the local player. */
export interface RosterChange {
  /** Refs present now that were not present before. */
  joined: Seat[];
  /** Refs present before that are not present now. */
  gone: Seat[];
}

/**
 * Wash a peer-typed name into something a one-line notice can hold.
 *
 * The same five characters every other surface in this room allows, for the
 * same reason: presence carries whatever the sender put in it, and a name is
 * display rather than identity. Nothing here can inject markup (both callers
 * write through `textContent`), so this is about the LINE: an unwashed name is
 * free to be two hundred characters of punctuation, and the seat strip has
 * room for about twelve.
 *
 * @param value Anything at all, including what arrived over the network.
 * @returns One to five of A-Z0-9, or the shared un-name YOU.
 */
export function displayName(value: unknown): string {
  if (typeof value !== 'string') return 'YOU';
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/g, '').slice(0, 5) || 'YOU';
}

/**
 * Who arrived and who vanished between two presence snapshots.
 *
 * Order follows `next` for arrivals and `prev` for departures, so a line reads
 * in the order the room saw things happen. The local player is never reported:
 * nobody needs telling that they themselves just joined.
 *
 * @param prev The snapshot the screen was last drawn from.
 * @param next The snapshot that just arrived.
 * @param myRef The local player's own presence key.
 * @returns The two lists, both empty when nothing moved or the snapshot cannot
 *   be trusted (see the reconnect guard in the module note above).
 */
export function rosterChange(
  prev: readonly Seat[],
  next: readonly Seat[],
  myRef: string,
): RosterChange {
  const still: RosterChange = { joined: [], gone: [] };
  // A snapshot that has lost US has lost the socket, not the room.
  if (!next.some((s) => s.ref === myRef)) return still;
  // The first snapshot of a room is not an arrival party: joining a room of
  // four would otherwise announce all four to the person who just walked in,
  // who is looking at the roster that lists them anyway.
  if (prev.length === 0) return still;
  const before = new Set(prev.map((s) => s.ref));
  const after = new Set(next.map((s) => s.ref));
  return {
    joined: next.filter((s) => s.ref !== myRef && !before.has(s.ref))
      .map((s) => ({ ref: s.ref, name: displayName(s.name) })),
    gone: prev.filter((s) => s.ref !== myRef && !after.has(s.ref))
      .map((s) => ({ ref: s.ref, name: displayName(s.name) })),
  };
}

/**
 * The one line, however many moved.
 *
 * Names are listed while they still fit a glance and counted after that: two
 * names is a sentence, five is a list nobody reads in six seconds, and the
 * strip it sits in is one line beside the scoreboard.
 *
 * @param verb What they did, already in the room's voice: JOINED, LEFT, DROPPED.
 * @param names The washed names, in the order the room saw them move.
 * @returns The line, or '' when nobody moved.
 */
export function noticeLine(verb: string, names: readonly string[]): string {
  const first = names[0];
  if (first === undefined) return '';
  if (names.length === 1) return `${first} ${verb}`;
  const second = names[1];
  if (names.length === 2 && second !== undefined) return `${first} AND ${second} ${verb}`;
  return `${first} AND ${names.length - 1} OTHERS ${verb}`;
}
