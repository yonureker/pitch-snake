/**
 * The typed way to reach the page's own markup.
 *
 * OWNS nothing but two lookups. It exists because `document.getElementById`
 * answers `HTMLElement | null`, and the honest response to that null is not
 * a `!` that silences the compiler: it is a loud failure. Every id these
 * modules ask for is written in `index.html` a few hundred lines away, so a
 * miss means somebody renamed or deleted the markup, and the useful moment
 * to find that out is at boot with the id in the message, not three
 * interactions later on a line that reads `x.hidden = true`.
 *
 * MUST NEVER be used to reach for something that is legitimately absent. An
 * element that may or may not be there is a real `| null` and the caller
 * should branch on it; these helpers are for the markup the page ships.
 *
 * @module
 */

/**
 * The element with this id, or a thrown error naming the id.
 *
 * @param id - the id as written in index.html.
 * @returns the element, never null.
 * @throws {Error} when no element carries that id.
 */
export function mustGetElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`index.html has no element with id "${id}"`);
  return element;
}

/**
 * The element with this id, checked to be the kind you expect.
 *
 * Use it wherever the code needs more than `HTMLElement`: a `<select>` whose
 * options are appended, an `<input>` whose value is read. The check is a real
 * `instanceof`, so it catches an id that has been moved onto a different tag
 * as well as one that has gone.
 *
 * @param id - the id as written in index.html.
 * @param kind - the constructor it must be an instance of, e.g.
 *   `HTMLSelectElement`.
 * @returns the element, typed.
 * @throws {Error} when the element is missing or is a different kind.
 */
export function mustGetElementOfKind<T extends HTMLElement>(
  id: string,
  kind: new () => T,
): T {
  const element = mustGetElement(id);
  if (!(element instanceof kind)) {
    throw new TypeError(`element "${id}" is a ${element.tagName}, not a ${kind.name}`);
  }
  return element;
}
