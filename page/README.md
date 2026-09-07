# `page/` — the browser modules `index.html` imports

**Sources here are TypeScript.** The `.ts` files in this directory are what
you edit. `tsc` compiles them to `page/build/*.js`, and that is what
`index.html` imports and what the browser loads.

```
page/*.ts        edit these
page/build/*.js  generated, committed, never edited by hand
```

| Command | What it does |
|---|---|
| `npm run typecheck:page` | type-check without writing anything |
| `npm run build:page` | compile to `page/build/` |

## Why the output is committed

GitHub Pages serves this repository exactly as it stands: a push is the
deploy, and nothing runs in between. So the compiled JavaScript has to be in
the repo, or the live page imports files that do not exist.

Committed build output can drift from its source, and that drift is invisible
— the site keeps working, just not the way the source says. The pre-commit
hook closes that: it rebuilds, and refuses the commit if anything in
`page/build/` moved. **If it stops you, run `git add page/build` and commit
again.** Never hand-edit a file under `build/`; the next commit erases it.

## What earns a file here

A piece of the page comes out of `index.html` when it is a **leaf**: it owns
something whole, and the shell needs little or nothing back from it. Measure
that before moving anything. The interface is the deciding fact, not the line
count, and a block that needs a dozen names from the shell is not ready to
leave, however big it is.

Each file opens with a doc block saying what it **owns** and what it must
**never** do, and every export carries a doc comment. That is the repo style
(see the root `CLAUDE.md`), and TypeScript does not replace it: the types say
what the shapes are, the comments say why the code is the way it is.

## The one rule about the shell

A module here must not reach back into the page for state. If it needs to
know something the shell knows, it is **told**: `sound-and-crowd.ts` takes the
round's phase as an argument to `crowdSync(phase)` rather than reading a
`state` variable, and that single inversion is what let it move out at all.
Reaching backwards is how a "module" ends up welded to `index.html` again.

The compiler settings match `apps/mobile/tsconfig.json` — `strict`,
`noUncheckedIndexedAccess`, `noUnusedLocals`, and the rest — so a bug the
app's compiler would catch is caught here too. Two rules follow from that and
are worth knowing before you fight the compiler:

- **`document.getElementById` returns `HTMLElement | null`.** The answer is
  `mustGetElement` from `dom.ts`, which throws with the id in the message, not
  a `!` that silences the check. Every id these modules ask for is markup the
  page ships, so a miss is a rename somebody has to hear about.
- **Do not widen a type to make an error go away.** The audio module's
  `AudioRig` exists because a context, its master gain and its noise buffer
  are created together and are absent together; as three nullable variables
  the compiler had to be lied to at every use. Bundling them said it once,
  truthfully, and the compiler then found dead state nobody had noticed.

## What this directory is not

| Directory | Runs where | Loaded by |
|---|---|---|
| `page/` | the browser | `import` in `index.html` (via `page/build/`) |
| `styles/` | the browser | `<link>` in `index.html` |
| `scripts/` | node and the shell, on a developer's machine | `npm run`, git hooks |
| `packages/engine/` | everywhere (browser, app, server) | imported by all three clients |

Gameplay is not negotiable and does not live here: the rules are
`packages/engine/`, the only copy, and nothing in this directory may decide
anything the engine decides.
