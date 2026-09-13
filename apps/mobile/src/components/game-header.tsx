/**
 * The game screen's header band, and the only thing that owns it.
 *
 * It is the web page's room header ported whole (styles/pitch-and-room-bar.css,
 * 2026-09-12), because the two surfaces are meant to be one layout at
 * different widths rather than two designs that happen to share a logo. The
 * shape either side of the divide:
 *
 *   solo   logo | chrome chips | SCORE / BEST
 *   room   logo | chrome chips + exit
 *          logo | the live seat strip
 *
 * The logo spans both lines and hangs from the BOTTOM, so SNAKE's baseline
 * and the seat strip's bottom edge are one line. Aligning the boxes is not
 * enough: a text box ends half a leading plus the font's descent below its
 * baseline, which is what LOGO_SLACK takes back.
 *
 * In a room the seat strip IS the scoreboard, so SCORE and BEST go: your
 * number is in the strip with your name underlined, and BEST is a solo
 * statistic that has nothing to say about this room.
 *
 * Must never: own game state (it is told, never asks), decide when a round
 * may be conceded (the loop answers that), or grow a third row. Every pixel
 * of chrome here comes out of the d-pad, which is whatever the board and this
 * band leave behind.
 *
 * @module
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import flagSheet from '@/assets/flags.png';
import { DarkShell, GameColors, VS_COLORS } from '@/game/theme';

import type { SeatRow } from '@/game/use-game-loop';
import { FLAG_COLS, flagIndex } from '@/lib/leaderboard';

const ANTON = 'Anton_400Regular';
const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';

const FLAG_W = 21;
const FLAG_H = 15;

/**
 * The logo's type, kept as numbers because the slack below is derived from
 * them. LEADING matches the web's touch header (0.92) rather than the 1.05
 * this screen used to carry, which is most of why the two logos read
 * differently at the same size.
 */
const LOGO_SIZE = 21;
const LOGO_LEADING = 0.92;
/**
 * How far the logo's box falls below SNAKE's baseline, in pixels.
 *
 * (lineHeight - ascent + descent) / 2, with Anton's own metrics measured off
 * the live font: ascent 1.173em, descent 0.327em. Pulling the logo down by
 * exactly this puts its BASELINE on the band's floor instead of its box, so
 * the strip's bottom edge and the bottom of the letters are one line by
 * construction. The gold drop shadow still falls below both, which is what a
 * shadow is for.
 */
const LOGO_SLACK = ((LOGO_LEADING - 1.173 + 0.327) / 2) * LOGO_SIZE;

/** How long FORFEIT stays armed before it forgets it was pressed. */
const ARM_MS = 2600;

/** One country flag, cut from the shared 16-wide sprite. */
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

/** Everything the band shows and everything it can call. */
export interface GameHeaderProps {
  dark: boolean;
  /** between rounds: the chrome chips are awake and the menus reachable */
  menuPhase: boolean;
  profileName: string | null;
  country: string | null;
  /** null hides the purse entirely, which is what a wallet that has not
   *  answered yet should do rather than showing a confident zero */
  coins: number | null;
  onProfile: () => void;
  onShop: () => void;
  onSettings: () => void;
  score: number;
  best: number;
  clockText: string;
  onScoreTap: () => void;
  /** a live room round: the strip replaces the score block and the exit appears */
  inRoom: boolean;
  seats: SeatRow[];
  seatNote: string;
  canForfeit: boolean;
  onForfeit: () => void;
  onLeave: () => void;
}

/**
 * Draw the header band.
 *
 * @param props - everything it shows and everything it can call; this
 *   component holds no game state of its own beyond whether FORFEIT is armed.
 */
export function GameHeader({
  dark,
  menuPhase,
  profileName,
  country,
  coins,
  onProfile,
  onShop,
  onSettings,
  score,
  best,
  clockText,
  onScoreTap,
  inRoom,
  seats,
  seatNote,
  canForfeit,
  onForfeit,
  onLeave,
}: GameHeaderProps) {
  const [armed, setArmed] = useState(false);

  // ONE exit at a time, the page's rule verbatim: FORFEIT owns the corner in
  // the one window it is offered (dead, and still ahead of everyone alive),
  // LEAVE owns it the rest of the round. Both on screen together read as two
  // ways out competing for the same glance, which is what they were.
  const exit =
    !inRoom ? null
    : canForfeit ?
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (armed) {
            onForfeit();
            setArmed(false);
          } else {
            setArmed(true);
            setTimeout(() => {
              setArmed(false);
            }, ARM_MS);
          }
        }}
        style={[styles.exit, armed && styles.exitArmed]}
      >
        <Text style={[styles.exitText, armed && styles.exitTextArmed]}>{armed ? 'GIVE UP?' : 'FORFEIT'}</Text>
      </Pressable>
    : <Pressable accessibilityRole="button" onPress={onLeave} style={styles.exit}>
        <Text style={styles.exitText}>{'✕'} LEAVE</Text>
      </Pressable>;

  return (
    <View style={styles.header}>
      {/* the logo spans both lines and hangs from the bottom; see LOGO_SLACK */}
      <View style={styles.logo}>
        <Text style={[styles.title, dark && darkStyles.title]}>PITCH</Text>
        <Text style={[styles.title, dark && darkStyles.title]}>SNAKE</Text>
      </View>

      <View style={styles.column}>
        <View style={styles.chromeRow}>
          <View style={styles.chips}>
            {menuPhase && (
              <>
                {/* the player chip, the page's twin: the door to the name, the
                    flag and the account, and the only place identity is edited */}
                <Pressable accessibilityRole="button" onPress={onProfile} style={styles.whoChip}>
                  <Flag code={country} />
                  <Text style={[styles.whoText, dark && darkStyles.whoText]}>{profileName ?? 'PLAYER'}</Text>
                </Pressable>
                {coins !== null && (
                  <Pressable accessibilityRole="button" onPress={onShop} style={styles.purse}>
                    <View style={styles.purseCoin} />
                    <Text style={[styles.purseText, dark && darkStyles.purseText]}>
                      {coins} {'·'} SHOP
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Settings"
                  onPress={onSettings}
                  style={styles.gearBtn}
                >
                  <Text style={[styles.gearText, dark && darkStyles.gearText]}>{'⚙︎'}</Text>
                </Pressable>
              </>
            )}
          </View>
          {exit}
        </View>

        {inRoom && seats.length > 0 && (
          <View style={styles.seatRow}>
            <View style={styles.pill}>
              {seats.map((s, k) => (
                <View
                  key={s.idx}
                  style={[styles.cell, k > 0 && styles.cellDivided, !s.alive && styles.cellDead]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.seatName,
                      { color: s.me ? GameColors.goldBright : (VS_COLORS[s.idx] ?? '#f4ecd8') },
                      !s.alive && styles.struck,
                    ]}
                  >
                    {s.leader ? '\u{1F451} ' : ''}
                    {s.name}
                  </Text>
                  <Text style={[styles.seatScore, !s.alive && styles.struck]}>{s.score}</Text>
                  {/* my own seat wears the gold bar the page draws under it */}
                  {s.me && s.alive && <View style={styles.mine} />}
                </View>
              ))}
            </View>
            {/* Status lives BESIDE the strip, never inside it. Packed in with
                the seat cells it stretched the pill into a distorted bar that
                read as a rendering fault: the pill is for seats, and a note is
                a different kind of thing. */}
            {seatNote !== '' && (
              <View style={styles.note}>
                <Text style={styles.noteText} numberOfLines={1}>
                  {seatNote}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {!inRoom && (
        <Pressable accessibilityRole="button" onPress={onScoreTap} style={styles.scores}>
          <Text style={[styles.scoreLabel, dark && darkStyles.scoreLabel]}>SCORE</Text>
          <Text style={[styles.scoreValue, dark && darkStyles.scoreValue]}>{score}</Text>
          <Text style={styles.bestValue}>BEST {best}</Text>
          {clockText !== '' && (
            <Text style={[styles.clockText, dark && darkStyles.clockText]}>{clockText}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
    gap: 8,
  },
  logo: { marginBottom: -LOGO_SLACK },
  title: {
    fontFamily: ANTON,
    fontSize: LOGO_SIZE,
    lineHeight: LOGO_SIZE * LOGO_LEADING,
    letterSpacing: 1,
    color: GameColors.ink,
    textShadowColor: GameColors.gold,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  /** the two lines to the logo's right: chrome above, the room below */
  column: { flex: 1, gap: 4 },
  chromeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chips: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { fontSize: 13, color: GameColors.ink },
  whoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  whoText: { fontFamily: BARLOW_BOLD, fontSize: 11, letterSpacing: 1.4, color: GameColors.ink },
  purse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  purseCoin: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  purseText: { fontFamily: BARLOW_BOLD, fontSize: 11, letterSpacing: 1, color: GameColors.ink },
  flag: { width: FLAG_W, height: FLAG_H, overflow: 'hidden', borderRadius: 2, alignSelf: 'center' },
  flagSheet: { width: FLAG_W * FLAG_COLS, height: FLAG_H * 16 },

  /* The strip stays DARK in both themes on purpose: the seat colours were
     picked against the pitch and wash out on the cream table. */
  pill: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 27,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    backgroundColor: '#24321b',
    overflow: 'hidden',
    flexShrink: 1,
  },
  /* THE NOTE GIVES WAY FIRST, not the seats. Five named seats and a status
     chip together want more than a 420px phone has, and the first attempt let
     the seat cells shrink: every name collapsed to a single letter and the
     strip stopped saying who anyone was, which is most of its job. The note
     is one word and survives being clipped; a name is an identity and does
     not. So the cells hold their size, the note absorbs the squeeze, and the
     pill's own overflow stays the last resort. */
  cell: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, flexShrink: 0 },
  cellDivided: { borderLeftWidth: 1, borderLeftColor: 'rgba(244,236,216,0.14)' },
  cellDead: { opacity: 0.5 },
  seatName: { fontFamily: BARLOW_BOLD, fontSize: 9.5, letterSpacing: 0.9 },
  /** the number never shrinks: it is the thing the strip exists to show */
  seatScore: { fontFamily: ANTON, fontSize: 13, color: '#f4ecd8', flexShrink: 0 },
  struck: { textDecorationLine: 'line-through' },
  mine: {
    position: 'absolute',
    left: 9,
    right: 9,
    bottom: 3,
    height: 2,
    borderRadius: 2,
    backgroundColor: GameColors.goldBright,
  },
  note: {
    height: 27,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(194,162,90,0.55)',
    backgroundColor: '#24321b',
    flexShrink: 1,
    minWidth: 34,
  },
  noteText: {
    fontFamily: BARLOW_BOLD,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: GameColors.goldBright,
  },

  /* the exit dressed as the strip's twin: same height, same radius, same dark
     green, same gold edge, so the row reads as one object and not as a button
     that happens to be adjacent */
  exit: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    backgroundColor: '#24321b',
  },
  exitArmed: { backgroundColor: GameColors.food, borderColor: GameColors.food },
  exitText: {
    fontFamily: BARLOW_BOLD,
    fontSize: 10.5,
    letterSpacing: 1,
    color: GameColors.goldBright,
  },
  exitTextArmed: { color: '#ffffff' },

  scores: { alignItems: 'flex-end' },
  scoreLabel: { fontFamily: BARLOW, fontSize: 10, letterSpacing: 2, color: GameColors.muted },
  scoreValue: { fontFamily: ANTON, fontSize: 24, color: GameColors.ink, lineHeight: 26 },
  bestValue: { fontFamily: BARLOW_BOLD, fontSize: 12, color: GameColors.gold, letterSpacing: 1 },
  clockText: { fontFamily: ANTON, fontSize: 15, color: GameColors.ink, letterSpacing: 1 },
});

/* the shell's own dark tokens, not literals: these sit on the table and must
   flip with the theme exactly as the rest of the screen does */
const darkStyles = StyleSheet.create({
  title: { color: DarkShell.ink, textShadowColor: GameColors.gold },
  whoText: { color: DarkShell.ink },
  purseText: { color: DarkShell.ink },
  gearText: { color: DarkShell.ink },
  scoreLabel: { color: DarkShell.muted },
  scoreValue: { color: DarkShell.ink },
  clockText: { color: DarkShell.ink },
});
