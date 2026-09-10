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
import { kitOf } from '@/lib/kit';
import type { Profile } from '@/lib/profile';
import { GameColors } from '@/game/theme';
import { SnakePreview } from '@/components/snake-preview';
import { useWallet } from '@/hooks/queries/use-wallet';
import { JERSEY_LEFT_DEFAULT, JERSEY_RIGHT_DEFAULT } from '@/game/pitch-art';

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
  // the preview dresses the skin the player actually wears
  const wallet = useWallet();
  const wornSkin = wallet.data?.skin ?? null;
  const [name, setName] = useState(profile?.name === 'YOU' ? '' : (profile?.name ?? ''));
  const [country, setCountry] = useState<string | null>(profile?.country ?? null);
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickFlag, setPickFlag] = useState(false);
  // The kit is held as TYPED TEXT, not as a washed Kit: a half-typed '#f2c1'
  // has to stay in the field while the preview falls back to the classic
  // colour, and washing on every keystroke would delete the character the
  // player is in the middle of typing.
  const [kitLeft, setKitLeft] = useState(profile?.kit.left ?? '');
  const [kitRight, setKitRight] = useState(profile?.kit.right ?? '');
  const [kitNum, setKitNum] = useState(
    profile?.kit.num === undefined || profile.kit.num === null ? '' : String(profile.kit.num),
  );
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
      const kit = kitOf({ left: kitLeft, right: kitRight, num: kitNum });
      const res = await saver.mutateAsync({ name: clean, country: country ?? '', kit });
      setBusy(false);
      if (res === 'saved') {
        onSaved({ name: clean, country, kit });
        onClose(); // a save is the sheet's job done (web parity)
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
      {/* The way out is a corner, not a row (the web sheet's call, ported):
          DONE sat at the very bottom, behind a whole screen of login pitch,
          and an X in the corner is where a person looks to close a sheet. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={styles.closeX}
        hitSlop={10}
      >
        <Text style={styles.closeXText}>×</Text>
      </Pressable>
      <Text style={styles.title}>YOUR ACCOUNT</Text>
      {locked && <Text style={styles.lock}>{'Finish the round to change your profile.'}</Text>}

      {who.anonymous ?
        <>
          {/* WHO YOU ARE is gated behind a login (2026-09-08, the owner's
              call, ported from the web sheet): the boards only show a row
              once an account stands behind it, so letting a guest claim a
              name spent a scarce, forever-unique five-character name on a
              device that will forget them. Reason before request: three
              lines of what a login gets you, then the one field that gets
              it. */}
          <Text style={styles.sellHead}>Log in to:</Text>
          <Text style={styles.sellItem}>{'\u00b7  Get a custom username'}</Text>
          <Text style={styles.sellItem}>{'\u00b7  Add a jersey to your snake'}</Text>
          <Text style={styles.sellItem}>{'\u00b7  Choose your country'}</Text>
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
                  // Six to ten, because the code's length is a Supabase project
                  // setting the client cannot read. Hard-coding six truncated an
                  // eight-digit code to its first six and then submitted it.
                  setCode(t.replace(/\D/g, '').slice(0, 10));
                }}
                placeholder="CODE"
                placeholderTextColor="#9a917c"
                keyboardType="number-pad"
                maxLength={10}
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

          {/* The kit: the one thing on this sheet a player picks rather than
              buys, which is why it sits with the name and the flag and not in
              the shop. The label names WHOSE shirt this is and stops there,
              and the row reads left to right: the three things you set, then
              the snake they dress (the web sheet's order, ported). The halves
              are typed as hex because this platform has no colour well; a
              half-finished one shows its classic colour until it becomes a
              colour. */}
          <Text style={styles.kitLabel}>{"SNAKE'S JERSEY"}</Text>
          <View style={styles.kitRow}>
            <TextInput
              style={styles.kitHex}
              value={kitLeft}
              editable={!locked}
              onChangeText={(t) => {
                setKitLeft(t.replace(/[^#0-9a-f]/gi, '').slice(0, 7));
              }}
              placeholder={JERSEY_LEFT_DEFAULT}
              placeholderTextColor="#9a917c"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={7}
              accessibilityLabel="Shirt colour, left half"
            />
            <TextInput
              style={styles.kitHex}
              value={kitRight}
              editable={!locked}
              onChangeText={(t) => {
                setKitRight(t.replace(/[^#0-9a-f]/gi, '').slice(0, 7));
              }}
              placeholder={JERSEY_RIGHT_DEFAULT}
              placeholderTextColor="#9a917c"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={7}
              accessibilityLabel="Shirt colour, right half"
            />
            <TextInput
              style={styles.kitNum}
              value={kitNum}
              editable={!locked}
              onChangeText={(t) => {
                setKitNum(t.replace(/\D/g, '').slice(0, 2));
              }}
              placeholder="10"
              placeholderTextColor="#9a917c"
              keyboardType="number-pad"
              maxLength={2}
              accessibilityLabel="Shirt number, 0 to 99"
            />
            <SnakePreview skin={wornSkin} left={kitLeft} right={kitRight} num={kitNum} />
          </View>

          <View style={styles.rule} />
          <Text style={styles.blurb}>Logged in as {who.email ?? 'your account'}.</Text>
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
  kitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kitLabel: {
    fontFamily: BARLOW_BOLD,
    fontSize: 11,
    letterSpacing: 1,
    color: GameColors.muted,
    marginTop: 2,
  },
  kitHex: {
    flex: 1,
    minWidth: 0,
    height: 38,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    fontFamily: BARLOW,
    fontSize: 11,
    color: GameColors.ink,
    textAlign: 'center',
  },
  kitNum: {
    width: 46,
    height: 38,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
    fontFamily: ANTON,
    fontSize: 16,
    color: GameColors.ink,
    textAlign: 'center',
  },
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
  closeX: {
    position: 'absolute',
    top: 6,
    right: 8,
    zIndex: 2,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeXText: { fontFamily: BARLOW_BOLD, fontSize: 24, lineHeight: 26, color: GameColors.muted },
  sellHead: { fontFamily: BARLOW_BOLD, fontSize: 13, color: GameColors.ink },
  sellItem: { fontFamily: BARLOW, fontSize: 12.5, lineHeight: 18, color: GameColors.muted },
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
