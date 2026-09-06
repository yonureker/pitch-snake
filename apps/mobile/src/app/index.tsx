import { Canvas, Picture, useImage } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SPEEDS } from '@pitch-snake/engine';

import { Image } from 'expo-image';

import atlasSource from '@/assets/food-atlas.png';
import flagSheet from '@/assets/flags.png';
import skullIcon from '@/assets/icon-skull.png';
import { Dpad } from '@/components/dpad';
import { RoomPanel } from '@/components/room-panel';
import { ShopSheet } from '@/components/shop-sheet';
import { GameColors } from '@/game/theme';
import { useGameLoop } from '@/game/use-game-loop';
import { useCrowd } from '@/hooks/use-crowd';
import { useRoom } from '@/hooks/use-room';
import { useWallet } from '@/hooks/queries/use-wallet';
import { useCreateTournament } from '@/hooks/queries/use-create-tournament';
import { useJoinTournament } from '@/hooks/queries/use-join-tournament';
import { useSubmitScore } from '@/hooks/queries/use-submit-score';
import { useSubmitTournamentScore } from '@/hooks/queries/use-submit-tournament-score';
import { useTopScores } from '@/hooks/queries/use-top-scores';
import { useTournamentTop } from '@/hooks/queries/use-tournament-top';
import { BOARD_PLACES, FLAG_COLS, flagIndex, placesOnBoard, type TournamentRow } from '@/lib/leaderboard';
import { loadWorn, saveWorn } from '@/lib/economy';
import { loadModePrefs, saveModePrefs } from '@/lib/mode-prefs';
import type { RuleMode, UiMode } from '@/lib/modes';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

const SPEED_LABELS: { label: string; ms: number }[] = [
  { label: 'SLOW', ms: SPEEDS.slow },
  { label: 'NORMAL', ms: SPEEDS.normal },
  { label: 'FAST', ms: SPEEDS.fast },
];

const MODE_LABELS: { mode: UiMode; label: string }[] = [
  { mode: 'classic', label: 'CLASSIC' },
  { mode: 'speedrun', label: 'SPEED RUN' },
  { mode: 'survival', label: 'SURVIVAL' },
  { mode: 'versus', label: 'MULTIPLAYER' },
  { mode: 'tourney', label: 'TOURNAMENT' },
];
const RULE_LABEL: Record<RuleMode, string> = {
  classic: 'CLASSIC',
  speedrun: 'SPEED RUN',
  survival: 'SURVIVAL',
};
const DURATION_LABELS: { label: string; minutes: number }[] = [
  { label: '1 HOUR', minutes: 60 },
  { label: '24 HOURS', minutes: 1440 },
  { label: '7 DAYS', minutes: 10080 },
];

type TourneyStatus = 'none' | 'upcoming' | 'open' | 'ended';

// module scope: the compiler's purity rule keeps clock reads out of render;
// these run only from effects and handlers, and status becomes plain state
function statusOf(t: TournamentRow | null): TourneyStatus {
  if (t === null) return 'none';
  const now = Date.now();
  if (now < Date.parse(t.startsAt)) return 'upcoming';
  if (now > Date.parse(t.endsAt)) return 'ended';
  return 'open';
}
// the same squash the server applies, so the standings highlight can find
// the row the submit just made
function squashName(n: string): string {
  const clean = n
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 5);
  return clean === '' ? 'YOU' : clean;
}
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// drawn at a third of the sprite's 60x45 cells, so every cell lands whole
const FLAG_W = 20;
const FLAG_H = 15;

const ANTON = 'Anton_400Regular';
const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';

/** The football, cut from the food atlas the board itself draws (cell 0). */
function BallIcon({ size }: { size: number }) {
  const sheet = { width: (768 * size) / 128, height: (512 * size) / 128 };
  const box = { width: size, height: size };
  return (
    <View style={[styles.ballBox, box]}>
      <Image source={atlasSource} style={sheet} contentFit="fill" />
    </View>
  );
}

/**
 * One country flag, cut out of the shared sprite. A fixed-size window with
 * the sheet inside it, offset so the wanted cell lands in view: RN has no
 * background-position, so the crop is the overflow of a positioned child.
 * Renders a blank of the same width when the player has no flag, which is
 * what keeps names in a column.
 */
function Flag({ code }: { code: string | null }) {
  const i = flagIndex(code);
  if (i < 0) return <View style={styles.flag} />;
  return (
    <View style={styles.flag}>
      <Image
        source={flagSheet}
        style={[
          styles.flagSheet,
          { marginLeft: -(i % FLAG_COLS) * FLAG_W, marginTop: -Math.floor(i / FLAG_COLS) * FLAG_H },
        ]}
        contentFit="fill"
      />
    </View>
  );
}

/** One scoring legend row, matching the web overlay's list. */
function LegendRow({
  icon,
  text,
  value,
  valueTone,
}: {
  icon: React.ReactNode;
  text: string;
  value: string;
  valueTone: 'pos' | 'neg' | 'die';
}) {
  return (
    <View style={styles.lgRow}>
      <View style={styles.lgIcon}>{icon}</View>
      <Text style={styles.lgText}>{text}</Text>
      <Text
        style={[
          styles.lgValue,
          valueTone === 'pos' ? styles.lgPos
          : valueTone === 'neg' ? styles.lgNeg
          : styles.lgDie,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * The game screen: score header, the Skia field, the multi-touch d-pad, and
 * the round overlays (kick off, countdown, half time, full time). All
 * gameplay comes from the shared engine through useGameLoop; this component
 * only lays out and relays input.
 */
export default function Index() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const boardPx = Math.min(width - 24, height * 0.52);
  const atlas = useImage(atlasSource);
  const loop = useGameLoop(boardPx, atlas);

  const dead = loop.phase === 'dead';
  const [entryName, setEntryName] = useState('');
  const [submittedId, setSubmittedId] = useState<number | null>(null);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<UiMode>('classic');
  const [showModes, setShowModes] = useState(false);
  const [lastRunKey, setLastRunKey] = useState<string | null>(null);
  const [tScreen, setTScreen] = useState(false);
  const [vScreen, setVScreen] = useState(false);
  const [tourney, setTourney] = useState<TournamentRow | null>(null);
  const [tStatus, setTStatus] = useState<TourneyStatus>('none');
  const [tCreating, setTCreating] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [prevBest, setPrevBest] = useState(0);
  const [joinCode, setJoinCode] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createMode, setCreateMode] = useState<RuleMode>('classic');
  const [createMinutes, setCreateMinutes] = useState(1440);
  const ruleMode: RuleMode =
    uiMode === 'tourney' ? (tourney?.mode ?? 'classic')
    : uiMode === 'versus' ? 'classic'
    : uiMode;
  // the fixture identity: a REMATCH is only a rematch of this exact thing
  const runKey = (uiMode === 'tourney' && tourney !== null ? `T:${tourney.code}:` : '') + ruleMode;
  const topScores = useTopScores(dead && uiMode !== 'tourney' && SUPABASE_CONFIGURED, ruleMode);
  const tourneyTop = useTournamentTop(tourney?.code ?? null, dead && uiMode === 'tourney');
  const submit = useSubmitScore();
  const tSubmit = useSubmitTournamentScore();
  const join = useJoinTournament();
  const create = useCreateTournament();
  const tapTimes = useRef<number[]>([]);
  const loopSetMode = loop.setMode;
  const loopSetWorn = loop.setWorn;
  const wallet = useWallet();
  const { crowdOn, setCrowdOn } = useCrowd(loop.phase);
  const room = useRoom(loop, { skin: wallet.data?.skin ?? null, hat: wallet.data?.hat ?? null }, boardPx);

  // the cached outfit dresses the first frame; the wallet's answer is the
  // truth and re-dresses (and re-caches) when it lands
  useEffect(() => {
    void loadWorn().then((w) => {
      loopSetWorn(w.skin, w.hat);
    });
  }, [loopSetWorn]);
  const walletSkin = wallet.data?.skin ?? null;
  const walletHat = wallet.data?.hat ?? null;
  const walletReady = wallet.isSuccess;
  useEffect(() => {
    if (!walletReady) return;
    loopSetWorn(walletSkin, walletHat);
    void saveWorn(walletSkin, walletHat);
  }, [walletReady, walletSkin, walletHat, loopSetWorn]);

  // restore the saved mode and tournament once; the loop follows the choice
  useEffect(() => {
    void loadModePrefs().then((prefs) => {
      setUiMode(prefs.uiMode);
      setTourney(prefs.tourney);
      setTStatus(statusOf(prefs.tourney));
      loopSetMode(
        prefs.uiMode === 'tourney' ? (prefs.tourney?.mode ?? 'classic')
        : prefs.uiMode === 'versus' ? 'classic'
        : prefs.uiMode,
      );
    });
  }, [loopSetMode]);

  // A window can open or close while the app just sits on an overlay, so the
  // status re-reads on a slow tick (a subscription to the wall clock, which
  // is what it is); every deliberate transition also refreshes it directly
  // in its handler.
  useEffect(() => {
    const timer = setInterval(() => {
      setTStatus(statusOf(tourney));
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [tourney]);

  const pickMode = (m: UiMode): void => {
    if (loop.phase !== 'ready' && loop.phase !== 'dead') return;
    setUiMode(m);
    setTStatus(statusOf(tourney));
    loopSetMode(
      m === 'tourney' ? (tourney?.mode ?? 'classic')
      : m === 'versus' ? 'classic'
      : m,
    );
    void saveModePrefs({ uiMode: m, tourney });
  };

  const adoptTourney = (t: TournamentRow): void => {
    setTourney(t);
    setTCreating(false);
    setJoinCode('');
    setTStatus(statusOf(t));
    loopSetMode(t.mode);
    void saveModePrefs({ uiMode: 'tourney', tourney: t });
  };

  const joinGo = (): void => {
    if (join.isPending || joinCode.length !== 6) return;
    join.mutate(joinCode, {
      onSuccess: (t) => {
        if (t !== null) adoptTourney(t);
      },
    });
  };

  const createGo = (): void => {
    if (create.isPending) return;
    create.mutate(
      { title: createTitle, mode: createMode, durationMinutes: createMinutes },
      {
        onSuccess: (t) => {
          adoptTourney(t);
        },
      },
    );
  };

  const leaveGo = (): void => {
    setTourney(null);
    setTCreating(false);
    setTStatus('none');
    loopSetMode('classic');
    void saveModePrefs({ uiMode, tourney: null });
  };

  const startRound = (): void => {
    setLastRunKey(runKey);
    setShowModes(false);
    setShopOpen(false);
    setPrevBest(loop.best); // the number to beat, captured before the round moves it
    setEntryName('');
    setSubmittedId(null);
    setSubmittedName(null);
    submit.reset();
    tSubmit.reset();
    loop.start();
  };

  // picking a plain ruleset is a complete decision, so the chooser closes on
  // it; picking TOURNAMENT navigates to its own step, where the join/create
  // business fits without stretching the overlay past the board
  const pickFromList = (m: UiMode): void => {
    pickMode(m);
    if (m === 'tourney') setTScreen(true);
    else if (m === 'versus') setVScreen(true);
    else setShowModes(false);
  };

  const saveScore = (): void => {
    if (submit.isPending || tSubmit.isPending || submittedId !== null || submittedName !== null) return;
    // the validator wants the round itself, not our opinion of its score
    const round = loop.roundForSubmit();
    if (round === null) return;
    const name = entryName.trim() === '' ? 'YOU' : entryName;
    if (uiMode === 'tourney' && tourney !== null) {
      tSubmit.mutate(
        { code: tourney.code, mode: tourney.mode, name, seedId: round.seedId, log: round.log },
        {
          onSuccess: () => {
            setSubmittedName(squashName(name));
          },
        },
      );
      return;
    }
    submit.mutate(
      { name, mode: ruleMode, seedId: round.seedId, log: round.log },
      {
        onSuccess: (r) => {
          setSubmittedId(r.id);
        },
      },
    );
  };

  // DEV-only: triple-tap the score block to end the round and reach the
  // FULL TIME screen without having to die honestly
  const onScoreTap = (): void => {
    if (!__DEV__) return;
    const now = performance.now();
    tapTimes.current = tapTimes.current.filter((t) => now - t < 1200);
    tapTimes.current.push(now);
    if (tapTimes.current.length >= 3) {
      tapTimes.current = [];
      loop.debugDie();
    }
  };
  const showOverlay = loop.phase === 'ready' || loop.phase === 'paused' || dead;
  const deadLine =
    loop.deadReason === 'wall' ? 'The walls got you. '
    : loop.deadReason === 'ghost' ? 'The ghost got you. '
    : loop.deadReason === 'time' ? 'The final whistle. '
    : '';
  // a round can only enter a board when it was seeded by a server ticket
  const canEnterBoard = loop.canSubmit && (uiMode !== 'tourney' || tStatus === 'open');
  // A world board has ten places, so a round that cannot reach one has nowhere
  // to save into and is never asked for a name. The tenth row comes off the
  // standings this screen already fetches to draw them, so the gate costs no
  // extra call and no cached cutoff that could go stale, and a round is judged
  // against the board the player is looking at while it is judged. A
  // tournament is a small named field where every entry belongs, so it asks.
  const worldBoard = uiMode !== 'tourney';
  const wantsEntry =
    dead && loop.score > 0 && submittedId === null && submittedName === null && canEnterBoard;
  // The answer only counts once the fetch has SETTLED. TanStack hands back the
  // previous death's rows the instant this screen wants them and revalidates
  // behind them, so judging on `data` alone would decide from a stale board and
  // then change its mind, pulling the form out from under a player already
  // typing. Waiting on isFetching is what makes this the page's own "fetch the
  // standings at the whistle, decide once from that answer" (and why the hook
  // turns the background refetches off, so nothing re-judges a settled round).
  // A board that cannot be read asks: a round that might belong gets the
  // benefit of the doubt, and the validator has the last word regardless.
  const judged = worldBoard && topScores.isSuccess && !topScores.isFetching;
  const placed = !worldBoard || topScores.isError || (judged && placesOnBoard(topScores.data, loop.score));
  // what a miss would have had to beat, and null whenever there is nothing to
  // say; a board with room always places, so a miss always has a tenth
  const tenthScore =
    wantsEntry && judged && !placed ? (topScores.data[BOARD_PLACES - 1]?.score ?? null) : null;
  const saving = submit.isPending || tSubmit.isPending;
  const menuPhase = loop.phase === 'ready' || dead;
  const modeCaption =
    uiMode === 'tourney' ?
      tourney === null ?
        'TOURNAMENT \u00b7 NONE JOINED'
      : `${tourney.title} \u00b7 ${tourney.code}${
          tStatus === 'open' ? ''
          : tStatus === 'upcoming' ? ' \u00b7 NOT STARTED'
          : ' \u00b7 ENDED'
        }`
    : RULE_LABEL[ruleMode];
  // dynamic dimensions live in variables, not literals, so the inline-style
  // rule keeps its teeth for everything that CAN be a StyleSheet entry
  const screenPad = { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 6 };
  const frameSize = { width: boardPx + 8, height: boardPx + 8 };
  const canvasSize = { width: boardPx, height: boardPx };

  return (
    <View style={[styles.screen, screenPad]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>PITCH</Text>
          <Text style={styles.title}>SNAKE</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onScoreTap} style={styles.scores}>
          <Text style={styles.scoreLabel}>SCORE</Text>
          <Text style={styles.scoreValue}>{loop.score}</Text>
          <Text style={styles.bestValue}>BEST {loop.best}</Text>
          {loop.clockText !== '' && <Text style={styles.clockText}>{loop.clockText}</Text>}
        </Pressable>
      </View>

      {__DEV__ && loop.perfText !== '' && <Text style={styles.perf}>{loop.perfText}</Text>}
      {menuPhase && wallet.isSuccess && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setShopOpen(true);
          }}
          style={styles.purse}
        >
          <View style={styles.purseCoin} />
          <Text style={styles.purseText}>
            {wallet.data.coins} {'\u00b7'} SHOP
          </Text>
        </Pressable>
      )}
      <View style={styles.boardWrap}>
        {loop.wallBanner !== '' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{loop.wallBanner}</Text>
          </View>
        )}
        <View style={[styles.boardFrame, frameSize]}>
          <Canvas style={canvasSize} opaque>
            <Picture picture={loop.picture} />
          </Canvas>
          {loop.countText !== '' && (
            <View style={styles.countWrap} pointerEvents="none">
              <Text style={[styles.countText, loop.countText === 'START!' && styles.countGo]}>
                {loop.countText}
              </Text>
            </View>
          )}
          {showOverlay && (
            <View style={styles.overlay}>
              {showModes && menuPhase ?
                vScreen ?
                  <>
                    <Text style={styles.overlayTitle}>MULTIPLAYER</Text>
                    <RoomPanel
                      room={room}
                      phase={loop.phase}
                      initialName={entryName}
                      onBack={() => {
                        if (room.status === 'idle') setVScreen(false);
                      }}
                    />
                  </>
                : tScreen ?
                  <>
                    <Text style={styles.overlayTitle}>TOURNAMENT</Text>
                    <View style={styles.tPanel}>
                      {tourney !== null ?
                        <>
                          <Text style={styles.tTitle}>
                            {tourney.title} {'\u00b7'} {RULE_LABEL[tourney.mode]}
                          </Text>
                          <Text style={styles.tCode}>{tourney.code}</Text>
                          <Text style={styles.tMeta}>
                            {tStatus === 'upcoming' ?
                              `STARTS ${fmtWhen(tourney.startsAt)}`
                            : tStatus === 'open' ?
                              `ENDS ${fmtWhen(tourney.endsAt)}`
                            : `ENDED ${fmtWhen(tourney.endsAt)}`}
                          </Text>
                          <Pressable accessibilityRole="button" onPress={leaveGo} style={styles.tGhostBtn}>
                            <Text style={styles.tGhostText}>LEAVE</Text>
                          </Pressable>
                        </>
                      : tCreating ?
                        <>
                          <TextInput
                            style={styles.tTitleInput}
                            value={createTitle}
                            onChangeText={setCreateTitle}
                            placeholder="PITCH CUP"
                            placeholderTextColor="#9a917c"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            maxLength={24}
                          />
                          <View style={styles.speedRow}>
                            {(['classic', 'speedrun', 'survival'] as const).map((m) => (
                              <Pressable
                                accessibilityRole="button"
                                key={m}
                                onPress={() => {
                                  setCreateMode(m);
                                }}
                                style={[styles.speedBtn, createMode === m && styles.speedBtnOn]}
                              >
                                <Text style={styles.speedText}>{RULE_LABEL[m]}</Text>
                              </Pressable>
                            ))}
                          </View>
                          <View style={styles.speedRow}>
                            {DURATION_LABELS.map((d) => (
                              <Pressable
                                accessibilityRole="button"
                                key={d.minutes}
                                onPress={() => {
                                  setCreateMinutes(d.minutes);
                                }}
                                style={[styles.speedBtn, createMinutes === d.minutes && styles.speedBtnOn]}
                              >
                                <Text style={styles.speedText}>{d.label}</Text>
                              </Pressable>
                            ))}
                          </View>
                          <View style={styles.entryRow}>
                            <Pressable
                              accessibilityRole="button"
                              onPress={createGo}
                              disabled={create.isPending}
                              style={[styles.saveBtn, create.isPending && styles.saveBtnBusy]}
                            >
                              <Text style={styles.saveText}>CREATE</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                setTCreating(false);
                              }}
                              style={styles.tGhostBtn}
                            >
                              <Text style={styles.tGhostText}>BACK</Text>
                            </Pressable>
                          </View>
                          {create.isError && (
                            <Text style={styles.saveNote}>Could not create the tournament. Try again.</Text>
                          )}
                        </>
                      : <>
                          <View style={styles.entryRow}>
                            <TextInput
                              style={styles.tCodeInput}
                              value={joinCode}
                              onChangeText={(t) => {
                                setJoinCode(
                                  t
                                    .replace(/[^a-z0-9]/gi, '')
                                    .toUpperCase()
                                    .slice(0, 6),
                                );
                              }}
                              placeholder="CODE"
                              placeholderTextColor="#9a917c"
                              autoCapitalize="characters"
                              autoCorrect={false}
                              maxLength={6}
                            />
                            <Pressable
                              accessibilityRole="button"
                              onPress={joinGo}
                              disabled={join.isPending}
                              style={[styles.saveBtn, join.isPending && styles.saveBtnBusy]}
                            >
                              <Text style={styles.saveText}>JOIN</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                setTCreating(true);
                              }}
                              style={styles.tGhostBtn}
                            >
                              <Text style={styles.tGhostText}>CREATE</Text>
                            </Pressable>
                          </View>
                          {join.isError && (
                            <Text style={styles.saveNote}>Could not reach the tournament. Try again.</Text>
                          )}
                          {join.isSuccess && join.data === null && (
                            <Text style={styles.saveNote}>No tournament with that code.</Text>
                          )}
                        </>
                      }
                    </View>
                    <View style={styles.btnRow}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setTScreen(false);
                        }}
                        style={styles.tGhostBtn}
                      >
                        <Text style={styles.tGhostText}>BACK</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setTScreen(false);
                          setShowModes(false);
                        }}
                        style={styles.tGhostBtn}
                      >
                        <Text style={styles.tGhostText}>DONE</Text>
                      </Pressable>
                    </View>
                  </>
                : <>
                    <Text style={styles.overlayTitle}>MODES</Text>
                    <Text style={styles.overlayText}>Choose your game.</Text>
                    <View style={styles.modeList}>
                      {MODE_LABELS.map((m) => (
                        <Pressable
                          accessibilityRole="button"
                          key={m.mode}
                          onPress={() => {
                            pickFromList(m.mode);
                          }}
                          style={[styles.modeBtn, uiMode === m.mode && styles.modeBtnOn]}
                        >
                          <Text style={[styles.modeBtnText, uiMode === m.mode && styles.modeBtnTextOn]}>
                            {m.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setShowModes(false);
                      }}
                      style={styles.tGhostBtn}
                    >
                      <Text style={styles.tGhostText}>DONE</Text>
                    </Pressable>
                  </>

              : <>
                  <Text style={[styles.overlayTitle, dead && styles.overlayTitleDead]}>
                    {dead ?
                      'FULL TIME'
                    : loop.phase === 'paused' ?
                      'HALF TIME'
                    : 'KICK OFF'}
                  </Text>
                  {uiMode === 'versus' && room.status === 'lobby' && (
                    <RoomPanel
                      room={room}
                      phase={loop.phase}
                      initialName={entryName}
                      onBack={() => undefined}
                    />
                  )}
                  {dead && uiMode !== 'versus' ?
                    <Text style={styles.overlayText}>
                      {deadLine}You scored {loop.score}.
                    </Text>
                  : loop.phase === 'paused' ?
                    <Text style={styles.overlayText}>Take a breather.</Text>
                  : <Text style={styles.overlayText}>Eat to grow. Survive the pitch.</Text>}
                  {dead && uiMode !== 'versus' && loop.score > prevBest ?
                    <Text style={styles.stickerText}>
                      {prevBest > 0 ? 'New personal best.' : 'Your first best.'}
                    </Text>
                  : dead && uiMode !== 'versus' && prevBest > 0 ?
                    <Text style={styles.saveNoteSoft}>
                      {loop.score === prevBest ?
                        'Level with your best.'
                      : `${String(prevBest - loop.score)} off your best.`}
                    </Text>
                  : null}
                  {dead &&
                    uiMode !== 'versus' &&
                    submit.data !== undefined &&
                    submit.data.earned.length > 0 && (
                      <View style={styles.badgeWrap}>
                        {submit.data.earned.map((b) => (
                          <View key={b.id} style={styles.badgeChip}>
                            <Text style={styles.badgeName}>{b.name}</Text>
                            {b.coins > 0 && <Text style={styles.badgeCoins}>+{b.coins}</Text>}
                          </View>
                        ))}
                      </View>
                    )}
                  {dead && uiMode !== 'versus' && submit.data !== undefined && submit.data.coins > 0 && (
                    <Text style={styles.coinNote}>
                      +{submit.data.coins} COINS {'\u00b7'} one per five points
                    </Text>
                  )}
                  {wantsEntry && placed && (
                    <View style={styles.entryRow}>
                      <TextInput
                        style={styles.nameInput}
                        value={entryName}
                        onChangeText={(t) => {
                          setEntryName(
                            t
                              .replace(/[^a-z0-9]/gi, '')
                              .toUpperCase()
                              .slice(0, 5),
                          );
                        }}
                        placeholder="NAME"
                        placeholderTextColor="#9a917c"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={5}
                      />
                      <Pressable
                        accessibilityRole="button"
                        onPress={saveScore}
                        disabled={saving}
                        style={[styles.saveBtn, saving && styles.saveBtnBusy]}
                      >
                        <Text style={styles.saveText}>SAVE</Text>
                      </Pressable>
                    </View>
                  )}
                  {tenthScore !== null && (
                    <Text style={styles.saveNoteSoft}>Top 10 starts at {tenthScore}.</Text>
                  )}
                  {dead && (submit.isError || tSubmit.isError) && (
                    <Text style={styles.saveNote}>Could not reach the leaderboard. Try again.</Text>
                  )}
                  {dead && SUPABASE_CONFIGURED && uiMode === 'tourney' && tourney !== null && (
                    <View style={styles.standings}>
                      <Text style={styles.boardHead}>
                        {tourney.title} {'\u00b7'} {tourney.code}
                      </Text>
                      {tourneyTop.isPending ?
                        <Text style={styles.boardEmpty}>Loading…</Text>
                      : tourneyTop.isError ?
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            void tourneyTop.refetch();
                          }}
                        >
                          <Text style={styles.boardEmpty}>Could not reach the board. Tap to retry.</Text>
                        </Pressable>
                      : tourneyTop.data.length === 0 ?
                        <Text style={styles.boardEmpty}>No scores yet</Text>
                      : <ScrollView style={styles.boardList}>
                          {tourneyTop.data.map((row, i) => (
                            <View key={row.name} style={styles.boardRow}>
                              <Text
                                style={[styles.boardRank, row.name === submittedName && styles.boardMine]}
                              >
                                {i + 1}
                              </Text>
                              <Flag code={row.country} />
                              <Text
                                style={[styles.boardName, row.name === submittedName && styles.boardMine]}
                              >
                                {row.name}
                              </Text>
                              <Text
                                style={[styles.boardScore, row.name === submittedName && styles.boardMine]}
                              >
                                {row.score}
                              </Text>
                            </View>
                          ))}
                        </ScrollView>
                      }
                    </View>
                  )}
                  {dead && SUPABASE_CONFIGURED && uiMode !== 'tourney' && uiMode !== 'versus' && (
                    <View style={styles.standings}>
                      <Text style={styles.boardHead}>
                        TOP 10 WORLDWIDE{ruleMode === 'classic' ? '' : ` \u00b7 ${RULE_LABEL[ruleMode]}`}
                      </Text>
                      {topScores.isPending ?
                        <Text style={styles.boardEmpty}>Loading…</Text>
                      : topScores.isError ?
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            void topScores.refetch();
                          }}
                        >
                          <Text style={styles.boardEmpty}>Could not reach the board. Tap to retry.</Text>
                        </Pressable>
                      : topScores.data.length === 0 ?
                        <Text style={styles.boardEmpty}>No scores yet</Text>
                      : <ScrollView style={styles.boardList}>
                          {topScores.data.map((row, i) => (
                            <View key={row.id} style={styles.boardRow}>
                              <Text style={[styles.boardRank, row.id === submittedId && styles.boardMine]}>
                                {i + 1}
                              </Text>
                              <Flag code={row.country} />
                              <Text style={[styles.boardName, row.id === submittedId && styles.boardMine]}>
                                {row.name}
                              </Text>
                              <Text style={[styles.boardScore, row.id === submittedId && styles.boardMine]}>
                                {row.score}
                              </Text>
                            </View>
                          ))}
                        </ScrollView>
                      }
                    </View>
                  )}
                  {loop.phase === 'ready' && uiMode !== 'versus' && (
                    <View style={styles.legend}>
                      <LegendRow icon={<BallIcon size={22} />} text="Ball" value="+1" valueTone="pos" />
                      <LegendRow
                        icon={
                          <View style={styles.lgRing}>
                            <BallIcon size={15} />
                          </View>
                        }
                        text="Ball with a ring"
                        value="+5"
                        valueTone="pos"
                      />
                      <LegendRow
                        icon={
                          <View style={styles.lgTnt}>
                            <View style={styles.lgTntBand} />
                          </View>
                        }
                        text="TNT block, 5 shorter"
                        value="-5"
                        valueTone="neg"
                      />
                      <LegendRow
                        icon={
                          <View style={styles.lgPortal}>
                            <View style={styles.lgPortalCore} />
                          </View>
                        }
                        text="Teleport, one trip"
                        value="+5"
                        valueTone="pos"
                      />
                      <LegendRow
                        icon={<Image source={skullIcon} style={styles.lgImage} />}
                        text="Walls, ghosts or yourself"
                        value="DIE"
                        valueTone="die"
                      />
                    </View>
                  )}
                  {loop.phase === 'ready' && uiMode !== 'versus' && (
                    <View style={styles.speedRow}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setCrowdOn(!crowdOn);
                        }}
                        style={[styles.speedBtn, crowdOn && styles.speedBtnOn]}
                      >
                        <Text style={styles.speedText}>{crowdOn ? 'CROWD ON' : 'CROWD OFF'}</Text>
                      </Pressable>
                      {SPEED_LABELS.map((s) => (
                        <Pressable
                          accessibilityRole="button"
                          key={s.label}
                          onPress={() => {
                            loop.setTickMs(s.ms);
                          }}
                          style={[styles.speedBtn, loop.tickMs === s.ms && styles.speedBtnOn]}
                        >
                          <Text style={styles.speedText}>{s.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {menuPhase && uiMode === 'tourney' && !(dead && tourney !== null) && (
                    <Text style={styles.modeCaption}>{modeCaption}</Text>
                  )}
                  <View style={styles.btnRow}>
                    {uiMode !== 'versus' &&
                      (loop.phase === 'paused' || uiMode !== 'tourney' || tStatus === 'open') && (
                        <Pressable accessibilityRole="button" onPress={startRound} style={styles.startBtn}>
                          <Text style={styles.startText}>
                            {dead ?
                              runKey === lastRunKey ?
                                'REMATCH'
                              : 'START'
                            : loop.phase === 'paused' ?
                              'RESUME'
                            : 'START'}
                          </Text>
                          {loop.phase !== 'paused' && (
                            <Text style={styles.startSub}>{RULE_LABEL[ruleMode]}</Text>
                          )}
                        </Pressable>
                      )}
                    {menuPhase && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setTScreen(false);
                          setShowModes(true);
                        }}
                        style={styles.modesBtn}
                      >
                        <Text style={styles.modesText}>MODES</Text>
                      </Pressable>
                    )}
                  </View>
                </>
              }
            </View>
          )}
          <ShopSheet
            open={shopOpen && menuPhase}
            onClose={() => {
              setShopOpen(false);
            }}
            onWorn={(skin, hat) => {
              loopSetWorn(skin, hat);
              void saveWorn(skin, hat);
            }}
          />
          {loop.phase === 'playing' && (
            <Pressable accessibilityRole="button" onPress={loop.pause} style={styles.pauseBtn} hitSlop={10}>
              <Text style={styles.pauseText}>II</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.padWrap}>
        <Dpad onDir={loop.steer} heading={loop.effectiveHeading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GameColors.pageBg,
    paddingHorizontal: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  title: {
    fontFamily: ANTON,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: 1,
    color: GameColors.ink,
    textShadowColor: GameColors.gold,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
  },
  scores: { alignItems: 'flex-end' },
  scoreLabel: {
    fontFamily: BARLOW,
    fontSize: 10,
    letterSpacing: 2,
    color: GameColors.muted,
  },
  scoreValue: { fontFamily: ANTON, fontSize: 30, color: GameColors.ink, lineHeight: 32 },
  bestValue: { fontFamily: BARLOW_BOLD, fontSize: 12, color: GameColors.gold, letterSpacing: 1 },
  boardWrap: { alignItems: 'center' },
  perf: {
    position: 'absolute',
    top: 2,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: BARLOW,
    fontSize: 10,
    color: GameColors.muted,
    zIndex: 10,
  },
  banner: {
    position: 'absolute',
    top: -12,
    zIndex: 5,
    backgroundColor: 'rgba(230,64,42,0.92)',
    paddingHorizontal: 13,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bannerText: { fontFamily: ANTON, color: '#ffffff', fontSize: 11, letterSpacing: 1.5 },
  boardFrame: {
    borderRadius: 14,
    padding: 4,
    backgroundColor: GameColors.ink,
    borderWidth: 2,
    borderColor: GameColors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countWrap: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,40,30,0.42)',
  },
  countText: {
    fontFamily: ANTON,
    fontSize: 110,
    color: GameColors.panel,
    textShadowColor: GameColors.gold,
    textShadowOffset: { width: 5, height: 5 },
    textShadowRadius: 0,
  },
  countGo: { fontSize: 52, color: GameColors.panel, textShadowColor: GameColors.food },
  overlay: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    backgroundColor: 'rgba(26,40,30,0.82)',
  },
  overlayTitle: {
    fontFamily: ANTON,
    fontSize: 40,
    letterSpacing: 1,
    color: GameColors.panel,
    textShadowColor: GameColors.gold,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
  },
  overlayTitleDead: { textShadowColor: GameColors.food },
  overlayText: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: '#d8d0bd' },
  legend: { gap: 6, width: '78%', maxWidth: 300 },
  lgRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lgIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  lgImage: { width: 20, height: 20 },
  lgRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: GameColors.goldBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lgTnt: {
    width: 22,
    height: 22,
    borderRadius: 2,
    backgroundColor: GameColors.tntBody,
    justifyContent: 'center',
  },
  lgTntBand: { height: 7, backgroundColor: GameColors.tntBandLight },
  lgPortal: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: GameColors.portalA,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lgPortalCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: GameColors.portalB },
  lgText: { flex: 1, fontFamily: BARLOW, fontSize: 13, color: '#e9e0cd', letterSpacing: 0.3 },
  lgValue: { fontFamily: ANTON, fontSize: 16, minWidth: 34, textAlign: 'right' },
  lgPos: { color: GameColors.goldBright },
  lgNeg: { color: GameColors.food },
  lgDie: { color: GameColors.food, fontSize: 12, letterSpacing: 1 },
  speedRow: { flexDirection: 'row', gap: 8 },
  speedBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: GameColors.panel,
    borderWidth: 1.5,
    borderColor: 'rgba(33,30,26,0.18)',
  },
  speedBtnOn: { backgroundColor: GameColors.gold, borderColor: GameColors.gold },
  speedText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1, color: GameColors.ink },
  startBtn: {
    alignItems: 'center',
    backgroundColor: GameColors.food,
    paddingHorizontal: 38,
    paddingVertical: 9,
    borderRadius: 4,
    shadowColor: '#b32f1c',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  startText: { fontFamily: ANTON, color: '#ffffff', fontSize: 17, letterSpacing: 2 },
  startSub: { fontFamily: BARLOW_BOLD, color: 'rgba(255,255,255,0.85)', fontSize: 10, letterSpacing: 1.5 },
  pauseBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(33,30,26,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(194,162,90,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseText: { fontFamily: BARLOW_BOLD, color: GameColors.goldBright, fontSize: 12, letterSpacing: 1 },
  clockText: { fontFamily: ANTON, fontSize: 18, color: GameColors.ink, letterSpacing: 1 },
  modeList: { gap: 8, alignSelf: 'stretch', alignItems: 'center' },
  modeBtn: {
    minWidth: 220,
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(244,236,216,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(244,236,216,0.25)',
  },
  modeBtnOn: { backgroundColor: GameColors.gold, borderColor: GameColors.gold },
  modeBtnText: { fontFamily: BARLOW_BOLD, fontSize: 14, letterSpacing: 1.5, color: '#e9e0cd' },
  modeBtnTextOn: { color: GameColors.ink },
  btnRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  modeCaption: { fontFamily: BARLOW_BOLD, fontSize: 11, letterSpacing: 2, color: '#b7ac93' },
  modesBtn: {
    borderWidth: 2,
    borderColor: GameColors.gold,
    borderRadius: 4,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  modesText: { fontFamily: ANTON, fontSize: 17, letterSpacing: 2, color: GameColors.goldBright },
  tPanel: { gap: 8, alignItems: 'center' },
  tTitle: { fontFamily: BARLOW_BOLD, fontSize: 14, letterSpacing: 2, color: '#e9e0cd' },
  tCode: { fontFamily: ANTON, fontSize: 32, letterSpacing: 6, color: GameColors.goldBright },
  tMeta: { fontFamily: BARLOW, fontSize: 12, letterSpacing: 1, color: '#b7ac93' },
  tGhostBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(244,236,216,0.35)',
  },
  tGhostText: { fontFamily: BARLOW_BOLD, fontSize: 13, letterSpacing: 1, color: '#e9e0cd' },
  tCodeInput: {
    width: 110,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: GameColors.gold,
    color: '#f4ecd8',
    fontFamily: BARLOW_BOLD,
    fontSize: 16,
    letterSpacing: 3,
    textAlign: 'center',
  },
  tTitleInput: {
    width: 200,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: GameColors.gold,
    color: '#f4ecd8',
    fontFamily: BARLOW_BOLD,
    fontSize: 14,
    letterSpacing: 2,
    textAlign: 'center',
  },
  // full bleed: a left thumb striking at the screen edge must still land ON
  // the pad, so it cancels the screen's horizontal padding
  padWrap: { flex: 1, marginTop: 2, marginHorizontal: -12 },
  entryRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  nameInput: {
    width: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: GameColors.gold,
    backgroundColor: 'rgba(246,239,222,0.96)',
    color: GameColors.ink,
    fontFamily: ANTON,
    fontSize: 16,
    letterSpacing: 3,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: GameColors.food,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 4,
  },
  saveBtnBusy: { opacity: 0.5 },
  saveText: { fontFamily: ANTON, color: '#ffffff', fontSize: 14, letterSpacing: 1.5 },
  saveNote: { fontFamily: BARLOW, fontSize: 12, color: GameColors.food },
  // guidance is not failure: only a genuine error wears the red, same split
  // the page makes with .save-note.soft
  saveNoteSoft: { fontFamily: BARLOW, fontSize: 12, color: '#b7ac93' },
  standings: {
    width: '72%',
    maxWidth: 250,
    backgroundColor: 'rgba(33,30,26,0.5)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(194,162,90,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  boardHead: {
    fontFamily: BARLOW_BOLD,
    fontSize: 10,
    letterSpacing: 2,
    color: GameColors.gold,
    textAlign: 'center',
  },
  boardEmpty: { fontFamily: BARLOW, fontSize: 12, color: '#b9b09c', textAlign: 'center', paddingVertical: 4 },
  boardList: { maxHeight: 150 },
  boardRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 1 },
  boardRank: { fontFamily: BARLOW, fontSize: 12, color: GameColors.gold, width: 16, textAlign: 'right' },
  // a fixed column, not a prefix on the name: ten names start on one line
  // whether or not their players have picked a flag
  flag: { width: FLAG_W, height: FLAG_H, overflow: 'hidden', borderRadius: 2, alignSelf: 'center' },
  flagSheet: { width: FLAG_W * FLAG_COLS, height: FLAG_H * 16 },
  boardName: { flex: 1, fontFamily: BARLOW, fontSize: 13, color: '#e9e0cd', letterSpacing: 1 },
  boardScore: { fontFamily: ANTON, fontSize: 13, color: '#e9e0cd' },
  boardMine: { color: GameColors.goldBright },
  ballBox: { overflow: 'hidden', alignSelf: 'center' },
  stickerText: { fontFamily: BARLOW_BOLD, fontSize: 13, color: GameColors.goldBright, letterSpacing: 0.5 },
  badgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    maxWidth: 280,
  },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(194,162,90,0.5)',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeName: { fontFamily: BARLOW_BOLD, fontSize: 10, color: '#e9e0cd', letterSpacing: 1 },
  badgeCoins: { fontFamily: BARLOW_BOLD, fontSize: 10, color: GameColors.goldBright },
  coinNote: { fontFamily: BARLOW, fontSize: 11, color: GameColors.goldBright, letterSpacing: 0.5 },
  purse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginLeft: 4,
    borderWidth: 1,
    borderColor: GameColors.gold,
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  purseCoin: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GameColors.goldBright,
    borderWidth: 1,
    borderColor: GameColors.gold,
  },
  purseText: { fontFamily: BARLOW_BOLD, fontSize: 11, color: GameColors.ink, letterSpacing: 1 },
});
