/**
 * The multiplayer step: the three doors in (quick match, a friend's code,
 * create), the lobby with its ready check, and full time's standings with
 * the series tallies. Every room decision lives in useRoom; this component
 * only lays out and relays taps, the same split the game screen keeps.
 * @module
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GameColors } from '@/game/theme';
import type { UseRoom } from '@/hooks/use-room';
import { cleanCode } from '@/lib/rooms';

const ANTON = 'Anton_400Regular';
const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';

/** Props: the room machine, whether a round is live, and the way out. */
export interface RoomPanelProps {
  room: UseRoom;
  /** 'ready' | 'countdown' | 'playing' | 'paused' | 'dead' from the loop. */
  phase: string;
  /** Stored player name, prefilled; the panel washes what is typed. */
  initialName: string;
  onBack: () => void;
}

/** The whole multiplayer surface below the MULTIPLAYER title. */
export function RoomPanel({ room, phase, initialName, onBack }: RoomPanelProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const inRound = room.status === 'lobby' && !room.over && (phase === 'playing' || phase === 'countdown');
  if (inRound) return null;

  if (room.status === 'idle' || room.status === 'connecting') {
    const busy = room.status === 'connecting';
    return (
      <View style={styles.panel}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={(t) => {
            setName(
              t
                .replace(/[^a-z0-9]/gi, '')
                .toUpperCase()
                .slice(0, 5),
            );
          }}
          placeholder="YOUR NAME"
          placeholderTextColor="#9a917c"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={5}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || name === ''}
          onPress={() => {
            room.quick(name);
          }}
          style={[styles.quickBtn, (busy || name === '') && styles.btnDim]}
        >
          <Text style={styles.quickText}>QUICK MATCH</Text>
          <Text style={styles.quickSub}>Seated with whoever is waiting. Rated.</Text>
        </Pressable>
        <View style={styles.codeRow}>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(t) => {
              setCode(cleanCode(t));
            }}
            placeholder="CODE"
            placeholderTextColor="#9a917c"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={5}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || name === '' || code.length !== 5}
            onPress={() => {
              room.join(name, code);
            }}
            style={[styles.joinBtn, (busy || name === '' || code.length !== 5) && styles.btnDim]}
          >
            <Text style={styles.joinText}>JOIN</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || name === ''}
            onPress={() => {
              room.create(name);
            }}
            style={[styles.ghostBtn, (busy || name === '') && styles.btnDim]}
          >
            <Text style={styles.ghostText}>CREATE</Text>
          </Pressable>
        </View>
        {room.note !== '' && <Text style={styles.note}>{room.note}</Text>}
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.ghostBtn}>
          <Text style={styles.ghostText}>BACK</Text>
        </Pressable>
      </View>
    );
  }

  // in a room: full time standings when over, else the lobby roster
  return (
    <View style={styles.panel}>
      <Text style={styles.codeLine}>
        ROOM {room.code}
        {room.over ? ' · THE HOST CALLS THE REMATCH' : ''}
      </Text>
      {room.over ?
        <View style={styles.board}>
          {room.standings.map((row) => (
            <View key={`${String(row.place)}-${row.name}`} style={styles.boardRow}>
              <Text style={[styles.rk, row.me && styles.mine]}>{row.place}</Text>
              <Text style={[styles.nm, row.me && styles.mine]}>{row.name}</Text>
              <Text style={[styles.sc, row.me && styles.mine]}>{row.score}</Text>
              <Text style={styles.vw}>
                {'\u{1F3C6}'} {row.wins}
              </Text>
            </View>
          ))}
        </View>
      : <View style={styles.board}>
          {room.present.map((p) => (
            <View key={p.ref} style={styles.boardRow}>
              <Text style={styles.rk}>
                {p.ref === room.myRef ?
                  room.myReady ?
                    '✓'
                  : '·'
                : p.ready ?
                  '✓'
                : '·'}
              </Text>
              <Text style={[styles.nm, p.ref === room.myRef && styles.mine]}>{p.name}</Text>
              <Text style={styles.sc}>{p.host ? 'HOST' : ''}</Text>
            </View>
          ))}
          {room.present.length < 2 && <Text style={styles.note}>Share the code; two to five play.</Text>}
        </View>
      }
      {room.note !== '' && <Text style={styles.note}>{room.note}</Text>}
      <View style={styles.btnRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (room.isHost && room.myReady && room.readyStats.all) room.start();
            else room.toggleReady();
          }}
          style={styles.quickBtn}
        >
          <Text style={styles.quickText}>
            {room.isHost && room.myReady && room.readyStats.all ?
              room.over ?
                'REMATCH'
              : 'START'
            : room.myReady ?
              'UNREADY'
            : 'READY UP'}
          </Text>
          <Text style={styles.quickSub}>
            {room.readyStats.ready}/{room.readyStats.seats} READY
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={room.leave} style={styles.ghostBtn}>
          <Text style={styles.ghostText}>LEAVE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { alignSelf: 'stretch', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  nameInput: {
    alignSelf: 'stretch',
    backgroundColor: '#f6efde',
    borderRadius: 8,
    paddingVertical: 9,
    textAlign: 'center',
    fontFamily: ANTON,
    fontSize: 16,
    letterSpacing: 2,
    color: GameColors.ink,
  },
  quickBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: '#4e7d38',
    borderRadius: 8,
    paddingVertical: 9,
    gap: 1,
  },
  quickText: { fontFamily: ANTON, fontSize: 16, letterSpacing: 1.5, color: '#f4ecd8' },
  quickSub: { fontFamily: BARLOW, fontSize: 10, letterSpacing: 0.5, color: 'rgba(244,236,216,0.8)' },
  codeRow: { flexDirection: 'row', gap: 6, alignSelf: 'stretch' },
  codeInput: {
    flex: 1,
    backgroundColor: '#f6efde',
    borderRadius: 8,
    paddingVertical: 8,
    textAlign: 'center',
    fontFamily: ANTON,
    fontSize: 15,
    letterSpacing: 3,
    color: GameColors.ink,
  },
  joinBtn: {
    backgroundColor: GameColors.food,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  joinText: { fontFamily: ANTON, fontSize: 14, letterSpacing: 1.5, color: '#fff' },
  ghostBtn: {
    borderWidth: 1,
    borderColor: GameColors.gold,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  ghostText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1.5, color: GameColors.goldBright },
  btnDim: { opacity: 0.45 },
  note: {
    fontFamily: BARLOW,
    fontSize: 11.5,
    color: '#b7ac93',
    textAlign: 'center',
    lineHeight: 15,
  },
  codeLine: { fontFamily: BARLOW_BOLD, fontSize: 11, letterSpacing: 2, color: GameColors.gold },
  board: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(33,30,26,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(194,162,90,0.4)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 4,
  },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  rk: { width: 18, textAlign: 'center', fontFamily: BARLOW_BOLD, fontSize: 12, color: GameColors.gold },
  nm: { flex: 1, fontFamily: BARLOW_BOLD, fontSize: 13, letterSpacing: 1, color: '#e9e0cd' },
  sc: { fontFamily: ANTON, fontSize: 13, color: '#e9e0cd' },
  vw: { fontFamily: BARLOW_BOLD, fontSize: 11, color: GameColors.goldBright },
  mine: { color: GameColors.goldBright },
  btnRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', justifyContent: 'center' },
});
