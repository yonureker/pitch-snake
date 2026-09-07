/**
 * The profile sheet: who you are on the boards, and the door to keeping it.
 *
 * The page's twin, and it exists for the same reason: a player earns coins,
 * badges, a rating and board rows anonymously from the first launch, and this
 * is where they put a name on that and, if they want, an address so it
 * survives a lost phone. Linking keeps the SAME user id, so nothing already
 * earned moves.
 *
 * Identity is a bonus tier and this sheet is never in the way: everything here
 * is optional, and a player who closes it plays exactly as before.
 *
 * @module
 */
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import flagSheet from '@/assets/flags.png';
import { authWho, sendEmailCode, signOutToAnon, verifyEmailCode } from '@/lib/auth';
import { FLAG_CODES, FLAG_COLS, flagIndex } from '@/lib/leaderboard';
import { useSaveProfile } from '@/hooks/queries/use-save-profile';
import type { Profile } from '@/lib/profile';
import { GameColors } from '@/game/theme';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';
const ANTON = 'Anton_400Regular';

// FLAG_CODES is one concatenated string of ISO pairs, because the sprite's
// grid position IS the index in that order; chunk it once to list them.
const CODE_LIST: string[] = Array.from({ length: FLAG_CODES.length / 2 }, (_, i) =>
  FLAG_CODES.slice(i * 2, i * 2 + 2),
);

// The sprite's grid position IS the ISO index, and the crop is the app's own
// accepted shape: a StyleSheet box with only the offsets computed.
const FLAG_W = 26;
const FLAG_H = 19.5;

/** One flag, cropped out of the shared sprite by its ISO position. */
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
        resizeMode="stretch"
      />
    </View>
  );
}

/** Props: the sheet edits a profile and hands the result back. */
export interface ProfileSheetProps {
  profile: Profile | null;
  /** Locked while a round is live or a room seat is held (identity freezes). */
  locked: boolean;
  onSaved: (p: Profile) => void;
  onClose: () => void;
}

/** The sheet. */
export function ProfileSheet({ profile, locked, onSaved, onClose }: ProfileSheetProps) {
  const who = authWho();
  // server writes go through the query layer, never straight from a component
  const saver = useSaveProfile();
  const [name, setName] = useState(profile?.name === 'YOU' ? '' : (profile?.name ?? ''));
  const [country, setCountry] = useState<string | null>(profile?.country ?? null);
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickFlag, setPickFlag] = useState(false);
  const [email, setEmail] = useState('');
  const [codeMode, setCodeMode] = useState<'off' | 'link' | 'switch'>('off');
  const [code, setCode] = useState('');

  const save = (): void => {
    const clean = name
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 5);
    if (clean === '') {
      setSay('Pick a name first.');
      return;
    }
    setBusy(true);
    setSay('Saving…');
    void (async () => {
      // '' rather than null for the flag: null KEEPS whatever is stored, and
      // a player who picked NONE means to clear it (set_profile's contract)
      const res = await saver.mutateAsync({ name: clean, country: country ?? '' });
      setBusy(false);
      if (res === 'saved') {
        setSay('Saved.');
        onSaved({ name: clean, country });
      } else if (res === 'taken') {
        setSay('That name is taken. Pick another.');
      } else {
        setSay('Could not reach your account. Try again.');
      }
    })();
  };

  const startEmail = (): void => {
    const addr = email.trim();
    if (!addr.includes('@')) {
      setSay('That does not look like an address.');
      return;
    }
    setBusy(true);
    setSay('Sending a code…');
    void (async () => {
      const res = await sendEmailCode(addr);
      setBusy(false);
      if (res === 'error') {
        setSay('Could not send a code. Try again.');
        return;
      }
      setCodeMode(res === 'exists' ? 'switch' : 'link');
      setSay(
        res === 'exists' ?
          'That address already has an account. The code signs this device into it.'
        : 'Check your mail for a six-digit code.',
      );
    })();
  };

  const finishEmail = (): void => {
    if (codeMode === 'off') return;
    setBusy(true);
    setSay('Checking…');
    void (async () => {
      const ok = await verifyEmailCode(email.trim(), code.trim(), codeMode);
      setBusy(false);
      setSay(ok ? 'Signed in.' : 'Wrong or expired code.');
      if (ok) {
        setCodeMode('off');
        setCode('');
      }
    })();
  };

  if (pickFlag) {
    return (
      <View style={styles.sheet}>
        <Text style={styles.title}>YOUR FLAG</Text>
        <ScrollView style={styles.flagList} contentContainerStyle={styles.flagGrid}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCountry(null);
              setPickFlag(false);
            }}
            style={styles.flagCell}
          >
            <Text style={styles.flagNone}>NONE</Text>
          </Pressable>
          {CODE_LIST.map((c) => (
            <Pressable
              accessibilityRole="button"
              key={c}
              onPress={() => {
                setCountry(c);
                setPickFlag(false);
              }}
              style={[styles.flagCell, country === c && styles.flagCellOn]}
            >
              <Flag code={c} />
              <Text style={styles.flagCode}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setPickFlag(false);
          }}
          style={styles.ghost}
        >
          <Text style={styles.ghostText}>BACK</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>PLAYER</Text>
      {locked && <Text style={styles.lock}>{'Finish the round to change your profile.'}</Text>}

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => {
            setPickFlag(true);
          }}
          style={styles.flagBtn}
        >
          <Flag code={country} />
        </Pressable>
        <TextInput
          style={styles.nameInput}
          value={name}
          editable={!locked}
          onChangeText={(t) => {
            setName(
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
          disabled={locked || busy}
          onPress={save}
          style={[styles.save, (locked || busy) && styles.dim]}
        >
          <Text style={styles.saveText}>SAVE</Text>
        </Pressable>
      </View>

      <View style={styles.rule} />

      {who.anonymous ?
        <>
          <Text style={styles.blurb}>
            Add an address and this name, your coins, badges and rating survive a lost phone. Nothing you have
            already earned moves.
          </Text>
          <View style={styles.row}>
            <TextInput
              style={styles.emailInput}
              value={email}
              editable={!locked}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#9a917c"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Pressable
              accessibilityRole="button"
              disabled={locked || busy}
              onPress={startEmail}
              style={[styles.save, (locked || busy) && styles.dim]}
            >
              <Text style={styles.saveText}>SEND</Text>
            </Pressable>
          </View>
          {codeMode !== 'off' && (
            <View style={styles.row}>
              <TextInput
                style={styles.emailInput}
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/\D/g, '').slice(0, 6));
                }}
                placeholder="123456"
                placeholderTextColor="#9a917c"
                keyboardType="number-pad"
                maxLength={6}
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={finishEmail}
                style={[styles.save, busy && styles.dim]}
              >
                <Text style={styles.saveText}>ENTER</Text>
              </Pressable>
            </View>
          )}
        </>
      : <>
          <Text style={styles.blurb}>Signed in as {who.email ?? 'your account'}.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void signOutToAnon();
              setSay('Signed out. This device plays as a new guest.');
            }}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>SIGN OUT</Text>
          </Pressable>
        </>
      }

      {say !== '' && <Text style={styles.say}>{say}</Text>}
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
        <Text style={styles.doneText}>DONE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 380,
    gap: 10,
    padding: 16,
    borderRadius: 14,
    backgroundColor: GameColors.panel,
    borderWidth: 2,
    borderColor: GameColors.gold,
  },
  title: {
    fontFamily: ANTON,
    fontSize: 20,
    letterSpacing: 1.5,
    color: GameColors.ink,
    textAlign: 'center',
  },
  lock: { fontFamily: BARLOW, fontSize: 11.5, color: GameColors.food, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flagBtn: {
    width: 44,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    flex: 1,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    fontFamily: ANTON,
    fontSize: 16,
    letterSpacing: 2,
    color: GameColors.ink,
  },
  emailInput: {
    flex: 1,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    fontFamily: BARLOW,
    fontSize: 13,
    color: GameColors.ink,
  },
  save: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: GameColors.food,
  },
  saveText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1, color: '#ffffff' },
  dim: { opacity: 0.5 },
  rule: { height: 1, backgroundColor: 'rgba(33,30,26,0.18)' },
  blurb: { fontFamily: BARLOW, fontSize: 12, lineHeight: 17, color: GameColors.muted },
  say: { fontFamily: BARLOW, fontSize: 12, color: GameColors.ink, textAlign: 'center' },
  ghost: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: GameColors.gold,
  },
  ghostText: { fontFamily: ANTON, fontSize: 14, letterSpacing: 1.2, color: GameColors.gold },
  done: {
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: GameColors.food,
  },
  doneText: { fontFamily: ANTON, fontSize: 15, letterSpacing: 1.2, color: '#ffffff' },
  flag: { width: FLAG_W, height: FLAG_H, overflow: 'hidden', borderRadius: 2, alignSelf: 'center' },
  flagSheet: { width: FLAG_W * FLAG_COLS, height: FLAG_H * 16 },
  flagList: { maxHeight: 320 },
  flagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  flagCell: {
    width: 58,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  flagCellOn: { borderColor: GameColors.gold, backgroundColor: 'rgba(194,162,90,0.16)' },
  flagCode: { fontFamily: BARLOW_BOLD, fontSize: 9, color: GameColors.muted },
  flagNone: { fontFamily: BARLOW_BOLD, fontSize: 10, color: GameColors.muted, paddingVertical: 6 },
});
