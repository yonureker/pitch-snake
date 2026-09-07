# `page/` — the browser modules `index.html` imports

Everything in this directory is an **ES module that runs in the browser**,
imported directly by `index.html` with a relative path. There is no build
step: what is written here is what ships, so it must be valid in a browser
exactly as typed. No bundler syntax, no bare specifiers, no TypeScript.

Do not confuse this with the two directories either side of it:

| Directory | Runs where | Loaded by |
|---|---|---|
| `page/` | the browser | `import` in `index.html` |
| `styles/` | the browser | `<link>` in `index.html` |
| `scripts/` | node and the shell, on a developer's machine | `npm run`, git hooks |
| `packages/engine/` | everywhere (browser, app, server) | imported by all three clients |

## What earns a file here

A piece of the page comes out of `index.html` when it is a **leaf**: it owns
something whole, and the shell needs little or nothing back from it. Before
moving anything, measure that. The interface is the deciding fact, not the
line count, and a block that needs a dozen names from the shell is not ready
to leave, however big it is.

Each file opens with a doc block saying what it **owns** and what it must
**never** do, and every export carries a doc comment. That is the repo style
(see the root `CLAUDE.md`), and it matters more here than anywhere: these
files have no types and no compiler, so the comment is the contract.

## The one rule about the shell

A module here must not reach back into the page for state. If it needs to
know something the shell knows, it is **told**: `sound-and-crowd.js` takes
the round's phase as an argument to `crowdSync(phase)` rather than reading a
`state` variable, and that single inversion is what let it move out at all.
Reaching backwards is how a "module" ends up welded to `index.html` again.

Gameplay is not negotiable and does not live here: the rules are
`packages/engine/`, the only copy, and nothing in this directory may decide
anything the engine decides.
