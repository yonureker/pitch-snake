/**
 * The stadium crowd, the app edition of the web page's bed: the same CC0
 * field recording (assets/crowd.LICENSE.txt at the repo root), looped with
 * its baked crossfade seam, faded up while a round runs and down on the
 * whistle, the pause and the menus. The toggle is remembered. No synth
 * fallback here: the tape ships in the bundle, so there is no network to
 * degrade over.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';

import crowdTape from '@/assets/crowd.m4a';

const CROWD_KEY = 'pitchSnakeCrowd';
const CROWD_VOLUME = 0.55;

/** Drive the crowd from the round phase; returns the toggle state and setter. */
export function useCrowd(phase: string): { crowdOn: boolean; setCrowdOn: (on: boolean) => void } {
  const player = useAudioPlayer(crowdTape);
  // expo-audio's contract is mutation (loop, volume, play/pause), which the
  // compiler forbids on a hook's render value; a ref is the sanctioned door
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
  const [crowdOn, setCrowdOnState] = useState(true);

  // the stored preference arrives once, async, like the personal best
  useEffect(() => {
    void AsyncStorage.getItem(CROWD_KEY).then((raw) => {
      if (raw === 'off') setCrowdOnState(false);
    });
  }, []);

  const wanted = crowdOn && (phase === 'playing' || phase === 'countdown');
  useEffect(() => {
    const pl = playerRef.current;
    pl.loop = true;
    pl.volume = CROWD_VOLUME;
    if (wanted) {
      // not every kickoff on the same roar: land somewhere in the loop.
      // The wall clock, not Math.random: this is paint for the ears, and
      // the app-code ban on random exists to protect gameplay.
      void pl.seekTo((Date.now() % 45_000) / 1000);
      pl.play();
    } else {
      pl.pause();
    }
  }, [player, wanted]);

  const setCrowdOn = (on: boolean): void => {
    setCrowdOnState(on);
    void AsyncStorage.setItem(CROWD_KEY, on ? 'on' : 'off').catch(() => undefined);
  };
  return { crowdOn, setCrowdOn };
}
