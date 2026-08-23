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

## What lands next

The Skia renderer (imperative `canvas.drawAtlas` in a PictureRecorder - not
the declarative `<Atlas>`) with the sim advancing in a Reanimated worklet,
then the multi-finger d-pad, then auth + the global leaderboard through the
same RPCs the web page uses.
