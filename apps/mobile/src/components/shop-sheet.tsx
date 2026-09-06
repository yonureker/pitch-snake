/**
 * The shop: the wallet's balance, every item on sale, and what is worn.
 * Prices come from the server; the art is this client's, keyed by item id,
 * so unknown ids still list and simply preview as classic. Buying is two
 * taps (BUY, then SURE?) exactly like the web, and wearing toggles: tapping
 * the worn item undresses it. Coins are minted by the validator and only
 * spent here.
 * @module
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GameColors, skinRamp } from '@/game/theme';
import { useBuyItem } from '@/hooks/queries/use-buy-item';
import { useEquip } from '@/hooks/queries/use-equip';
import { useShop } from '@/hooks/queries/use-shop';
import { useWallet } from '@/hooks/queries/use-wallet';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';
const ANTON = 'Anton_400Regular';

/** Props: whether the sheet shows, how it closes, and the dresser. */
export interface ShopSheetProps {
  open: boolean;
  onClose: () => void;
  /** Dress the live snake immediately; the server equip rides behind it. */
  onWorn: (skin: string | null, hat: string | null) => void;
}

/** The shop sheet, an overlay panel over the board. */
export function ShopSheet({ open, onClose, onWorn }: ShopSheetProps) {
  const wallet = useWallet();
  const shop = useShop(open);
  const buy = useBuyItem();
  const equip = useEquip();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!open) return null;

  const coins = wallet.data?.coins ?? 0;
  const owned = new Set(wallet.data?.items ?? []);
  const wornSkin = wallet.data?.skin ?? null;
  const wornHat = wallet.data?.hat ?? null;

  const wear = (kind: string, id: string, worn: boolean): void => {
    // tapping the worn item undresses that slot; the other slot is kept
    const nextSkin =
      kind === 'skin' ?
        worn ? null
        : id
      : wornSkin;
    const nextHat =
      kind === 'hat' ?
        worn ? null
        : id
      : wornHat;
    onWorn(nextSkin, nextHat);
    equip.mutate({ skin: nextSkin, hat: nextHat });
  };

  const buyGo = (id: string, price: number): void => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    if (coins < price || buy.isPending) return;
    buy.mutate(id);
  };

  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>SHOP</Text>
      <Text style={styles.coins}>{coins} COINS</Text>
      <ScrollView style={styles.list}>
        {(shop.data ?? []).map((item) => {
          const isOwned = owned.has(item.id);
          const worn = item.id === wornSkin || item.id === wornHat;
          const swatch = item.kind === 'skin' ? `rgb(${skinRamp(item.id).head.join(',')})` : null;
          return (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => {
                if (isOwned) wear(item.kind, item.id, worn);
                else buyGo(item.id, item.price);
              }}
              style={[styles.row, worn && styles.rowWorn]}
            >
              {swatch !== null ?
                // dynamic by nature: the swatch IS the skin's own colour
                <View style={[styles.swatch, { backgroundColor: swatch }]} />
              : <Text style={styles.hatMark}>{'▲'}</Text>}
              <Text style={styles.name}>{item.name}</Text>
              <Text style={[styles.price, isOwned && styles.priceOwned]}>
                {worn ?
                  'WEARING'
                : isOwned ?
                  'WEAR'
                : confirmId === item.id ?
                  'SURE?'
                : coins < item.price ?
                  `${String(item.price)} · SHORT`
                : String(item.price)}
              </Text>
            </Pressable>
          );
        })}
        {shop.isPending && <Text style={styles.note}>Loading{'…'}</Text>}
        {shop.isError && <Text style={styles.note}>Could not reach the shop.</Text>}
        {buy.data?.error != null && <Text style={styles.note}>{buy.data.error}</Text>}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.doneBtn}>
        <Text style={styles.doneText}>DONE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(24,32,22,0.96)',
    borderRadius: 9,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  title: { fontFamily: ANTON, fontSize: 28, color: '#f4ecd8', letterSpacing: 1 },
  coins: { fontFamily: BARLOW_BOLD, fontSize: 13, color: GameColors.goldBright, letterSpacing: 1 },
  list: { alignSelf: 'stretch', marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(194,162,90,0.35)',
    marginBottom: 6,
  },
  rowWorn: { borderColor: GameColors.goldBright, backgroundColor: 'rgba(194,162,90,0.12)' },
  swatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(0,0,0,0.35)' },
  hatMark: { width: 18, textAlign: 'center', color: GameColors.goldBright, fontFamily: BARLOW_BOLD },
  name: { flex: 1, fontFamily: BARLOW, fontSize: 13, color: '#e9e0cd', letterSpacing: 0.5 },
  price: { fontFamily: BARLOW_BOLD, fontSize: 12, color: GameColors.goldBright, letterSpacing: 0.5 },
  priceOwned: { color: '#b7ac93' },
  note: { fontFamily: BARLOW, fontSize: 12, color: '#b7ac93', textAlign: 'center', paddingVertical: 8 },
  doneBtn: {
    borderWidth: 1,
    borderColor: GameColors.gold,
    borderRadius: 7,
    paddingVertical: 8,
    paddingHorizontal: 22,
  },
  doneText: { fontFamily: BARLOW_BOLD, fontSize: 13, color: GameColors.goldBright, letterSpacing: 1.5 },
});
