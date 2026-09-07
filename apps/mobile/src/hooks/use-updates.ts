/**
 * Staying on the live build, the app's half.
 *
 * A room refuses peers whose ENGINE_VERSION differs, because a round is only
 * fair if every peer simulates identically. The page can fix that by
 * reloading; an installed app could not, because it bundles the engine at
 * build time, so every engine bump stranded the app until somebody shipped a
 * whole new binary. `expo-updates` closes that: the engine is pure JavaScript,
 * so a bump rides over the air, and only a NATIVE change (which the
 * fingerprint runtime version detects) still demands a real build.
 *
 * The check runs on launch and whenever the app comes back to the foreground,
 * which are the moments staleness matters, and never during a round. A ready
 * update is offered rather than forced: reloading mid-game would be worse than
 * the staleness it cures.
 *
 * @module
 */
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** What the shell reads to offer a reload. */
export interface UpdateState {
  /** A newer build is downloaded and one reload away. */
  ready: boolean;
  /** Apply it. Restarts the app; call it only when nothing is in flight. */
  apply: () => void;
}

/**
 * Watch for a newer published build.
 *
 * @returns whether one is waiting, and the door to apply it.
 */
export function useUpdates(): UpdateState {
  const [ready, setReady] = useState(false);
  // one check at a time: a foreground flurry must not stack fetches
  const busy = useRef(false);

  useEffect(() => {
    // Updates are disabled in Expo Go and in a dev client, where the packager
    // is the source of truth. Asking anyway throws, so do not ask.
    if (!Updates.isEnabled) return;

    const look = (): void => {
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        try {
          const found = await Updates.checkForUpdateAsync();
          if (found.isAvailable) {
            await Updates.fetchUpdateAsync();
            setReady(true);
          }
        } catch {
          // offline, or the update server having a day: the game plays on
          // exactly as it did, which is the whole point of never gating play
        } finally {
          busy.current = false;
        }
      })();
    };

    look();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') look();
    });
    return () => {
      sub.remove();
    };
  }, []);

  const apply = (): void => {
    void Updates.reloadAsync().catch(() => undefined);
  };

  return { ready, apply };
}
