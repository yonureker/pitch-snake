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
import { FLAG_COLS, flagIndex } from '@pitch-snake/flags';
import { CupIcon, GearIcon } from '@/components/tray-icons';

const ANTON_FONT = 'Anton_400Regular';
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
/**
 * THE HEADER'S VERTICAL CONTRACT, the page's, stated once and then derived.
 *
 *   - PITCH's cap line is the band's top; the pills and SCORE start on it.
 *   - SNAKE's baseline is the band's floor; BEST ends on it, and in a room
 *     the seat strip's bottom edge sits on it.
 *
 * The page does this with measured pixel nudges and says so in its own CSS.
 * Here every offset is derived from the two fonts' measured metrics instead,
 * because iOS also CLIPS anything whose line box is smaller than ascent plus
 * descent, so the boxes must be full-size and the layout must claw the air
 * back with margins. A margin moves the box and never touches the ink, which
 * makes it the one safe tool for this on a platform that clips.
 *
 * Anton: ascent 1.18, descent 0.33, caps 0.867 of the em.
 * Barlow: ascent 1.00, descent 0.20, caps 0.708.
 * Both measured off the loaded fonts, not read from a spec sheet.
 */
const ANTON = { asc: 1.18, desc: 0.33, cap: 0.867 };
const BARLOW_M = { asc: 1.0, desc: 0.2, cap: 0.708 };
type FontMetrics = typeof ANTON;

/** the smallest line box iOS will not clip, plus a pixel of air */
const box = (f: FontMetrics, size: number): number => Math.ceil(size * (f.asc + f.desc) + 1);
/** air between a line box's top and the capitals' ink */
const airAboveCap = (f: FontMetrics, size: number, line: number): number =>
  (line - size * (f.asc + f.desc)) / 2 + size * (f.asc - f.cap);
/** air between the baseline and the line box's bottom */
const airBelowBase = (f: FontMetrics, size: number, line: number): number =>
  line - ((line - size * (f.asc + f.desc)) / 2 + size * f.asc);

/** 24, which is what the page's own clamp serves a 420px phone */
const LOGO_SIZE = 24;
const LOGO_LINE = box(ANTON, LOGO_SIZE);
/** the page's tight 0.92 leading, restored by pulling SNAKE up */
const LOGO_TIGHTEN = LOGO_SIZE * 0.92 - LOGO_LINE;
/** trims that make the logo's margin box exactly its INK, cap to baseline,
 *  so the whole band can align to it with plain flexbox */
const LOGO_TRIM_TOP = -airAboveCap(ANTON, LOGO_SIZE, LOGO_LINE);
const LOGO_TRIM_BOTTOM = -airBelowBase(ANTON, LOGO_SIZE, LOGO_LINE);

/** the score column, in the page's own mobile proportions (8 / 21 / 9 under
 *  a 24px logo), each with a full box and a metric trim */
const LABEL_SIZE = 8;
const LABEL_LINE = box(BARLOW_M, LABEL_SIZE);
const LABEL_TRIM = -airAboveCap(BARLOW_M, LABEL_SIZE, LABEL_LINE);
const SCORE_SIZE = 21;
const SCORE_LINE = box(ANTON, SCORE_SIZE);
const SCORE_SQUEEZE = -(SCORE_LINE - SCORE_SIZE) / 2;
const BEST_SIZE = 9;
const BEST_LINE = box(BARLOW_M, BEST_SIZE);
const BEST_TRIM = -airBelowBase(BARLOW_M, BEST_SIZE, BEST_LINE);

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
  /** the world boards, behind the trophy: the page's third tray button */
  onBoards: () => void;
  onSettings: () => void;
  score: number;
  best: number;
  /** this UTC month's best, the HUD's SEASON line above the all-time one */
  bestSeason: number;
  /** SECONDS in survival, SCORE elsewhere: in survival the clock IS the score */
  scoreLabel: string;
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
  onBoards,
  onSettings,
  score,
  best,
  bestSeason,
  scoreLabel,
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
      <View style={[styles.logo, inRoom && styles.logoRoom]}>
        <Text style={[styles.title, dark && darkStyles.title]}>PITCH</Text>
        <Text style={[styles.title, styles.titleSecond, dark && darkStyles.title]}>SNAKE</Text>
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
                {/* ONE TRAY, not three chips. The page joins the purse, the
                    boards and the gear into a single pill divided by hairlines,
                    and reads as one object because it is one: three doors to
                    the same drawer of chrome. The app had them loose and the
                    two headers stopped looking like the same game. */}
                <View style={[styles.tray, dark && darkStyles.tray]}>
                  {coins !== null && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={onShop}
                      style={[styles.trayBtn, styles.trayPurse]}
                    >
                      <View style={styles.purseCoin} />
                      <Text style={[styles.purseText, dark && darkStyles.purseText]}>{coins}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Top ten boards"
                    onPress={onBoards}
                    style={[styles.trayBtn, coins !== null && styles.trayDivided]}
                  >
                    <CupIcon size={14} color={dark ? DarkShell.ink : GameColors.ink} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Settings"
                    onPress={onSettings}
                    style={[styles.trayBtn, styles.trayDivided]}
                  >
                    <GearIcon size={14} color={dark ? DarkShell.ink : GameColors.ink} />
                  </Pressable>
                </View>
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
          <Text style={[styles.scoreLabel, dark && darkStyles.scoreLabel]}>{scoreLabel}</Text>
          <Text style={[styles.scoreValue, dark && darkStyles.scoreValue]}>{score}</Text>
          <View style={styles.bests}>
            <Text style={styles.bestValueTop}>SEASON {bestSeason}</Text>
            <Text style={styles.bestValue}>ALL-TIME {best}</Text>
          </View>
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
    alignItems: 'stretch',
    paddingHorizontal: 4,
    gap: 8,
  },
  logo: { marginTop: LOGO_TRIM_TOP, marginBottom: LOGO_TRIM_BOTTOM, alignSelf: 'flex-start' },
  /* In a room the two pill rows outgrow the logo's ink, so both ends cannot
     pin at once. The page resolves it the same way: the logo hangs from the
     floor, SNAKE's baseline stays on the seat strip's bottom edge, and the
     cap-line contract belongs to the solo header where the scores column
     fits inside the logo. */
  logoRoom: { alignSelf: 'flex-end' },
  title: {
    fontFamily: ANTON_FONT,
    fontSize: LOGO_SIZE,
    lineHeight: LOGO_LINE,
    letterSpacing: 1,
    color: GameColors.ink,
    textShadowColor: GameColors.gold,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  titleSecond: { marginTop: LOGO_TIGHTEN },
  /** the two lines to the logo's right: chrome pinned to the cap line above,
   *  the seat strip pinned to SNAKE's baseline below */
  column: { flex: 1, gap: 4, justifyContent: 'space-between' },
  chromeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chips: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  /* the tray: one bordered pill, its buttons separated by hairlines rather
     than by gaps, so the three read as one control the way the page's does */
  tray: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    overflow: 'hidden',
  },
  trayBtn: { paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  trayPurse: { gap: 5 },
  trayDivided: { borderLeftWidth: 1, borderLeftColor: 'rgba(194,162,90,0.45)' },
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
  purseCoin: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  purseText: { fontFamily: BARLOW_BOLD, fontSize: 11, letterSpacing: 1, color: GameColors.ink },
  /* The sprite sheet is 16 flags wide and 16 tall, positioned by negative
     margins, so anything short of a hard clip paints the WHOLE sheet across
     the chip: on a phone the name pill came out solid red, which is simply
     the sheet's first column. overflow alone was not holding it, so the
     window states its size on both axes and clips on both. */
  flag: {
    width: FLAG_W,
    height: FLAG_H,
    maxWidth: FLAG_W,
    maxHeight: FLAG_H,
    overflow: 'hidden',
    borderRadius: 2,
    alignSelf: 'center',
    flexShrink: 0,
  },
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
  seatScore: { fontFamily: ANTON_FONT, fontSize: 13, color: '#f4ecd8', flexShrink: 0 },
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

  /* stretched to the logo's ink box and spread: SCORE starts on PITCH's cap
     line, BEST ends on SNAKE's baseline, the number rides between */
  scores: { alignItems: 'flex-end', justifyContent: 'space-between' },
  scoreLabel: {
    fontFamily: BARLOW,
    fontSize: LABEL_SIZE,
    lineHeight: LABEL_LINE,
    marginTop: LABEL_TRIM,
    letterSpacing: 1.6,
    color: GameColors.muted,
  },
  scoreValue: {
    fontFamily: ANTON_FONT,
    fontSize: SCORE_SIZE,
    color: GameColors.ink,
    lineHeight: SCORE_LINE,
    marginVertical: SCORE_SQUEEZE,
  },
  bests: { alignItems: 'flex-end' },
  bestValueTop: {
    fontFamily: BARLOW_BOLD,
    fontSize: BEST_SIZE,
    lineHeight: BEST_LINE,
    color: GameColors.gold,
    letterSpacing: 1,
  },
  bestValue: {
    fontFamily: BARLOW_BOLD,
    fontSize: BEST_SIZE,
    lineHeight: BEST_LINE,
    marginBottom: BEST_TRIM,
    color: GameColors.gold,
    letterSpacing: 1,
  },
  clockText: { fontFamily: ANTON_FONT, fontSize: 15, color: GameColors.ink, letterSpacing: 1 },
});

/* the shell's own dark tokens, not literals: these sit on the table and must
   flip with the theme exactly as the rest of the screen does */
const darkStyles = StyleSheet.create({
  title: { color: DarkShell.ink, textShadowColor: GameColors.gold },
  whoText: { color: DarkShell.ink },
  purseText: { color: DarkShell.ink },
  tray: { borderColor: DarkShell.padRing },
  scoreLabel: { color: DarkShell.muted },
  scoreValue: { color: DarkShell.ink },
  clockText: { color: DarkShell.ink },
});
