import { Canvas, Picture, useImage } from '@shopify/react-native-skia';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SPEEDS } from '@pitch-snake/engine';

import { Image } from 'expo-image';

import atlasSource from '@/assets/food-atlas.png';
import appleIcon from '@/assets/icon-apple.png';
import skullIcon from '@/assets/icon-skull.png';
import starIcon from '@/assets/icon-star.png';
import { Dpad } from '@/components/dpad';
import { GameColors } from '@/game/theme';
import { useGameLoop } from '@/game/use-game-loop';

const SPEED_LABELS: { label: string; ms: number }[] = [
  { label: 'SLOW', ms: SPEEDS.slow },
  { label: 'NORMAL', ms: SPEEDS.normal },
  { label: 'FAST', ms: SPEEDS.fast },
];

const ANTON = 'Anton_400Regular';
const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';

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
  const showOverlay = loop.phase === 'ready' || loop.phase === 'paused' || dead;
  const deadLine =
    loop.deadReason === 'wall' ? 'The walls got you. '
    : loop.deadReason === 'ghost' ? 'The ghost got you. '
    : '';
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
        <View style={styles.scores}>
          <Text style={styles.scoreLabel}>SCORE</Text>
          <Text style={styles.scoreValue}>{loop.score}</Text>
          <Text style={styles.bestValue}>BEST {loop.best}</Text>
        </View>
      </View>

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
              <Text style={[styles.overlayTitle, dead && styles.overlayTitleDead]}>
                {dead ?
                  'FULL TIME'
                : loop.phase === 'paused' ?
                  'HALF TIME'
                : 'KICK OFF'}
              </Text>
              {dead ?
                <Text style={styles.overlayText}>
                  {deadLine}You scored {loop.score}.
                </Text>
              : loop.phase === 'paused' ?
                <Text style={styles.overlayText}>Take a breather.</Text>
              : <Text style={styles.overlayText}>Eat to grow. Survive the pitch.</Text>}
              {loop.phase === 'ready' && (
                <View style={styles.legend}>
                  <LegendRow
                    icon={<Image source={appleIcon} style={styles.lgImage} />}
                    text="Emoji"
                    value="+1"
                    valueTone="pos"
                  />
                  <LegendRow
                    icon={
                      <View style={styles.lgRing}>
                        <Image source={starIcon} style={styles.lgRingImage} />
                      </View>
                    }
                    text="Emoji with a ring"
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
              {loop.phase !== 'paused' && (
                <View style={styles.speedRow}>
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
              <Pressable accessibilityRole="button" onPress={loop.start} style={styles.startBtn}>
                <Text style={styles.startText}>
                  {dead ?
                    'REMATCH'
                  : loop.phase === 'paused' ?
                    'RESUME'
                  : 'START'}
                </Text>
              </Pressable>
            </View>
          )}
          {loop.phase === 'playing' && (
            <Pressable accessibilityRole="button" onPress={loop.pause} style={styles.pauseBtn} hitSlop={10}>
              <Text style={styles.pauseText}>II</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.padWrap}>
        <Dpad onDir={loop.steer} />
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
  lgRingImage: { width: 13, height: 13 },
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
    backgroundColor: GameColors.food,
    paddingHorizontal: 38,
    paddingVertical: 12,
    borderRadius: 4,
    shadowColor: '#b32f1c',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  startText: { fontFamily: ANTON, color: '#ffffff', fontSize: 17, letterSpacing: 2 },
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
  padWrap: { flex: 1, marginTop: 2 },
});
