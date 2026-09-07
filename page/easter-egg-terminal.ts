/**
 * The hidden brief: the easter egg behind the "P" in PITCH.
 *
 * OWNS the little terminal that types the game's own design brief out one
 * character at a time, its open and close doors, and the Escape key while it
 * is up. Nothing else in the page knows it exists.
 *
 * MUST NEVER touch the round. It is reachable only from the menu chrome, it
 * simulates nothing, and its typing timer is an interval rather than the
 * game loop precisely because it has no business inside the frame budget.
 *
 * The body below keeps the page's own indentation on purpose: TERM_TEXT is a
 * template literal, so every line of it is text the reader sees, and
 * re-indenting the block would silently reformat the brief.
 *
 * @module
 */
import { mustGetElement } from './dom.js';

/**
 * Wire the easter egg to its own markup. Call once at boot.
 *
 * Everything it needs is already in the page; nothing is returned, because
 * nothing outside this file opens or closes the terminal but the reader.
 *
 */
export function initEasterEggTerminal(): void {
  const pEgg = mustGetElement('pEgg');
  const terminal = mustGetElement('terminal');
  const termBody = mustGetElement('termBody');
  const termClose = mustGetElement('termClose');
  const TERM_TEXT =
`$ cat interview/top-10-at-scale.md

TOP 10 HIGH SCORES AT SCALE

Hundreds of thousands of players are playing concurrently. Every round ends with a score, and there is one global Top 10.

At the end of a round:

- If the score makes the Top 10, ask the player for their name. After they submit it, show them the Top 10 with their entry in it.

- If it does not make the Top 10, still show them the Top 10, and tell them how many points short of 10th place they were.

Design how you would store the scores and serve all of this.

$ `;
  // the browser's timer id, not node's: this only ever runs in a page
  let termTimer: number | undefined;
  function openTerminal() {
    terminal.hidden = false;
    clearInterval(termTimer);
    termBody.textContent = '';
    let i = 0;
    termTimer = setInterval(() => {
      i += 3;
      if (i < TERM_TEXT.length) {
        termBody.textContent = TERM_TEXT.slice(0, i);
        termBody.scrollTop = termBody.scrollHeight;
      } else {
        termBody.textContent = TERM_TEXT;
        clearInterval(termTimer);
        const cur = document.createElement('span');
        cur.className = 'term-cursor';
        termBody.appendChild(cur);
      }
    }, 14);
  }
  function closeTerminal() { clearInterval(termTimer); terminal.hidden = true; }
  pEgg.addEventListener('click', () => { if (terminal.hidden) openTerminal(); else closeTerminal(); });
  termClose.addEventListener('click', closeTerminal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !terminal.hidden) closeTerminal(); });
}
