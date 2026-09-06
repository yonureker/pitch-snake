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

import cheerTape from '@/assets/cheer.m4a';
import crowdTape from '@/assets/crowd.m4a';

const CROWD_KEY = 'pitchSnakeCrowd';
const CROWD_VOLUME = 0.55;

/** What the game reads and calls from the crowd. */
export interface Crowd {
  crowdOn: boolean;
  setCrowdOn: (on: boolean) => void;
  /** A one-shot at a room's full time: the real goal roar on a win. */
  playVerdict: (won: boolean) => void;
}

/** Drive the crowd from the round phase; returns the toggle and the verdict. */
export function useCrowd(phase: string): Crowd {
  const player = useAudioPlayer(crowdTape);
  const cheer = useAudioPlayer(cheerTape);
  // expo-audio's contract is mutation (loop, volume, play/pause), which the
  // compiler forbids on a hook's render value; refs are the sanctioned door
  const playerRef = useRef(player);
  const cheerRef = useRef(cheer);
  useEffect(() => {
    playerRef.current = player;
    cheerRef.current = cheer;
  }, [player, cheer]);
  const [crowdOn, setCrowdOnState] = useState(true);
  const crowdOnRef = useRef(crowdOn);
  useEffect(() => {
    crowdOnRef.current = crowdOn;
  }, [crowdOn]);

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

  // The stand's verdict at a room's full time. The win gets the real goal
  // roar (the same CC0 cut the web plays); the loss is the web's synth boo,
  // which the app has no audio for, so it stays silent here rather than
  // shipping a wrong sound. The bed has already faded out on the whistle,
  // which reads as deflation on its own.
  const playVerdict = (won: boolean): void => {
    if (!won || !crowdOnRef.current) return;
    const c = cheerRef.current;
    c.volume = 0.75;
    void c.seekTo(0);
    c.play();
  };

  return { crowdOn, setCrowdOn, playVerdict };
}
