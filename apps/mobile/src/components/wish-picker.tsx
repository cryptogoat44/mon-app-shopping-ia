import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { WishlistItem } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchWishlist } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { ErrorMessage } from "@/components/error-message";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

/** Une envie choisie pour être jointe à un message. */
export interface PickedWish {
  id: string;
  title: string;
  imageUrl: string;
}

// « Joindre une envie » (lot messages) : une de vos Envies, choisie dans la
// liste. Le serveur en copie l'image au moment de l'envoi.
export function WishPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (wish: PickedWish) => void }) {
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(null);
    fetchWishlist()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((e) => {
        if (!cancelled) setError(loadErrorMessage(e, t.messages.pickerError));
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchWishlist(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(loadErrorMessage(e, t.messages.pickerError));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.messages.pickerClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.messages.pickerTitle}
        </Text>
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
          {items === null && !error ? <ActivityIndicator color={color.encre} /> : null}
          {items?.length === 0 ? <Text style={styles.empty}>{t.messages.pickerEmpty}</Text> : null}
          {items?.map((item) => (
            <Pressable
              key={item.id}
              style={styles.row}
              onPress={() => onPick({ id: item.id, title: item.title, imageUrl: item.imageUrl })}
              accessibilityRole="button"
              accessibilityLabel={t.messages.pickWish(item.title)}
            >
              <View style={styles.thumb}>
                <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.fill} fit="cover" size="small" />
              </View>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </Pressable>
          ))}
          {nextCursor ? (
            <Pressable style={styles.more} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button" accessibilityState={{ busy: loadingMore }}>
              {loadingMore ? <ActivityIndicator color={color.encre} /> : <Text style={styles.moreLabel}>{t.messages.loadMore}</Text>}
            </Pressable>
          ) : null}
        </ScrollView>
        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
          <Text style={styles.cancelLabel}>{t.messages.pickerClose}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { maxHeight: "75%", backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, paddingHorizontal: space.lg, marginBottom: space.sm },
  list: { paddingHorizontal: space.lg, paddingBottom: space.md },
  error: { fontSize: font.secondary, marginBottom: space.sm },
  empty: { fontSize: font.secondary, color: color.acier, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs, minHeight: 56 },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  rowTitle: { flex: 1, fontSize: font.secondary, color: color.encre },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  cancel: { marginTop: space.sm, marginHorizontal: space.lg, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
