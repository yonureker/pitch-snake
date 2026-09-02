# Pitch Snake mobile

Expo SDK 57 / RN 0.86 / expo-router 6 / React Compiler ON. Read the exact
versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code.

Conventions are ported from the False9 app (`~/Desktop/false9`), the
production reference this app clones. The linter enforces most of them -
run `npm run lint` and `npm run typecheck` before every commit (the root
pre-commit hook does both; install with `npm run install-hooks` at the root).

## The rules that are not negotiable

- **Gameplay lives in `@pitch-snake/engine` and nowhere else.** This app
  renders and shells; it never simulates. `Math.random` in app code is a lint
  error for exactly that reason - the engine owns all randomness (seeded), so
  every score stays replay-verifiable server-side.
- **React Compiler memoizes.** No `useMemo`, `useCallback`, `React.memo` -
  lint errors, with the reasoning in the message.
- **Server data goes through TanStack Query hooks in `hooks/queries/`; Zustand
  is for UI state only.** The lint bans `supabase.*` calls in components
  before supabase-js is even installed, so the discipline exists from day one.
- **`StyleSheet.create`, never inline styles.** Enforced.
- **Strict TS with False9's extra flags** (`noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, ...). Prettier owns
  formatting (printWidth 110, single quotes, experimentalTernaries).
- **Secrets never in source** (`no-secrets` at entropy 4.5; `service_role` is
  a banned literal). The Supabase publishable key belongs in app config.

## Code style specifics

The root `CLAUDE.md` carries the repo-wide conventions; these are the ones
that only bite here.

- **Server data goes through `hooks/queries/`.** A component never imports
  `lib/leaderboard.ts`. If you need a new read, the hook is the unit of work,
  not the fetch.
- **Query options are contract.** `useTopScores` disables
  `refetchOnWindowFocus` and `refetchOnReconnect` on purpose: the FULL TIME
  board is a snapshot of the moment the round ended, and it decides whether to
  ask for a name. A board that reshuffles under the player re-judges a round
  already decided and can take the entry form away mid-keystroke. Do not
  "fix" that by turning them back on.
- **Derive during render, do not latch in an effect.** `react-hooks/set-state-in-effect`
  will reject the latch, and it is right to: the fix is nearly always to make
  the query stop moving, not to freeze a copy of it. The top-ten verdict works
  this way.
- **`noUncheckedIndexedAccess` is on.** Every indexed read is possibly
  undefined; handle it rather than asserting past it. That flag is what makes
  `rows[BOARD_PLACES - 1]` honest.
- **Type guards, never casts.** `isCountry(v): v is string` and an `if`.
- **JSDoc `@module` at the top of every file**, and a doc comment on every
  export. 17 of 28 files have it today; new and touched files close the gap.
- **File ceilings** are in the root `CLAUDE.md`. Two files are already over:
  `src/app/index.tsx` (1126 against 400) and `src/game/renderer.ts` (761
  against 500). Refactor before adding to either.
- **The `no-secrets` lint rule fires on high-entropy strings.** The one
  standing exception is `FLAG_CODES`, a public ISO-3166 list whose shape IS
  the sprite layout. It carries an inline disable with the reason; do not add
  another without one.

## What lands next

The Skia renderer (imperative `canvas.drawAtlas` in a PictureRecorder - not
the declarative `<Atlas>`) with the sim advancing in a Reanimated worklet,
then the multi-finger d-pad, then auth + the global leaderboard through the
same RPCs the web page uses.
