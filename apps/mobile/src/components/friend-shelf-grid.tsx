import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { fetchUserVault, fetchUserWishlist } from "@/lib/api";
import { sharedItemImage, sharedItemPrice } from "@/lib/collections";
import { loadErrorMessage } from "@/lib/load-error";
import { shelfCellImageSize, shelfCellLabel, type ShelfItem, type ShelfKind } from "@/lib/friend-shelves";

export type { ShelfItem } from "@/lib/friend-shelves";
import { ImageUnavailable } from "@/components/image-unavailable";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

// Étagères des amis (lot « étagères des amis », migration 0058) : les Envies
// et le Vault d'un ami, en lecture seule, sur son profil. Ni « Garder », ni
// cloche, ni « Envoyer » : seulement voir, et « Voir chez … » pour une envie.
// Les images des envies sont toujours la copie faite par Spotto (jamais
// l'adresse du marchand) ; celles du Vault, l'image que la pièce affiche
// (en deux temps, comme la grille du Vault de son propriétaire).


export interface FriendShelfState {
  items: ShelfItem[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  reload: () => void;
  loadMore: () => void;
  retryMore: () => void;
}

/** Une étagère d'un ami : lue seulement quand `active` (l'onglet est ouvert,
 * donc annoncé par le serveur) — jamais avant. Relue quand `refreshKey`
 * change (abonnement modifié). */
export function useFriendShelf(userId: string, kind: ShelfKind, active: boolean, refreshKey: string): FriendShelfState {
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [status, setStatus] = useState<FriendShelfState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (from: string | null): Promise<{ items: ShelfItem[]; nextCursor: string | null }> => {
      if (kind === "wishes") {
        const page = await fetchUserWishlist(userId, from);
        return { items: page.items.map((item) => ({ kind: "wishes" as const, item })), nextCursor: page.nextCursor };
      }
      const page = await fetchUserVault(userId, from);
      return { items: page.items.map((item) => ({ kind: "vault" as const, item })), nextCursor: page.nextCursor };
    },
    [kind, userId],
  );

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setStatus("loading");
    setError(null);
    setMoreError(null);
    fetchPage(null)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch((e) => {
        if (mine !== generation.current) return;
        setError(loadErrorMessage(e, t.friendShelves.loadError));
        setStatus("error");
      });
  }, [fetchPage]);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setItems([]);
      setCursor(null);
      setStatus("idle");
      return;
    }
    reload();
  }, [active, reload, refreshKey]);

  // `retry` : seulement le bouton « Réessayer ». Après une erreur, la fin de
  // liste (onEndReached) ne relance plus rien toute seule.
  const fetchMore = useCallback((retry: boolean) => {
    if (!active || !cursor || loadingMore || status !== "ready") return;
    if (moreError !== null && !retry) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    fetchPage(cursor)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch((e) => {
        if (mine === generation.current) setMoreError(loadErrorMessage(e, t.friendShelves.loadMoreError));
      })
      .finally(() => {
        if (mine === generation.current) setLoadingMore(false);
      });
  }, [active, cursor, fetchPage, loadingMore, moreError, status]);

  const loadMore = useCallback(() => fetchMore(false), [fetchMore]);
  const retryMore = useCallback(() => fetchMore(true), [fetchMore]);

  return { items, status, error, loadingMore, moreError, reload, loadMore, retryMore };
}

/** Une case de la grille (3 par rangée) : l'image seule ; le nom est dans le libellé. */
export function FriendShelfCell({ entry, onOpen }: { entry: ShelfItem; onOpen: (entry: ShelfItem) => void }) {
  const thumb = entry.kind === "wishes" ? sharedItemImage(entry.item) : entry.item.imageUrl;
  const hd = entry.kind === "wishes" ? entry.item.imageUrl : (entry.item.imageHdUrl ?? entry.item.imageUrl);
  return (
    <Pressable style={styles.cell} onPress={() => onOpen(entry)} accessibilityRole="button" accessibilityLabel={shelfCellLabel(entry)} testID={`etagere-${entry.kind}-${entry.item.id}`}>
      {thumb === null ? (
        <ImageUnavailable variant="tile" accessible={false} />
      ) : (
        <SpotImage size={shelfCellImageSize(entry.kind)} hdUri={hd} fallbackUri={thumb} style={styles.fill} fit="cover" recyclingKey={`${entry.kind}-${entry.item.id}`} />
      )}
    </Pressable>
  );
}

/** La petite feuille d'une case : l'image en grand, le nom, puis le prix et
 * « Voir chez … » (envie) ou la catégorie (pièce du Vault). Lecture seule. */
export function FriendShelfSheet({ entry, onClose }: { entry: ShelfItem | null; onClose: () => void }) {
  if (!entry) return null;
  const large = entry.kind === "wishes" ? (entry.item.imageUrl ?? entry.item.imageThumbUrl) : (entry.item.imageHdUrl ?? entry.item.imageUrl);
  const small = entry.kind === "wishes" ? sharedItemImage(entry.item) : entry.item.imageUrl;
  const price = entry.kind === "wishes" ? sharedItemPrice(entry.item, getActiveLocale()) : null;
  const meta = entry.kind === "wishes" ? [entry.item.merchantName, price].filter(Boolean).join(" · ") : (t.vaultLabels.categories[entry.item.category] ?? t.vaultLabels.categories.other);
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.avoider}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.friendShelves.close} />
        <View style={styles.sheet} testID="feuille-etagere">
          <View style={styles.handle} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={styles.image}>
              {small === null || large === null ? (
                <ImageUnavailable variant="frame" />
              ) : (
                <SpotImage size="large" hdUri={large} fallbackUri={small} style={styles.fill} fit="contain" accessibilityLabel={entry.item.title} />
              )}
            </View>
            <Text style={styles.title} accessibilityRole="header">
              {entry.item.title}
            </Text>
            {meta ? <Text style={styles.meta}>{meta}</Text> : null}
            {/* La mention « Lien affilié » est affichée par le bouton lui-même. */}
            {entry.kind === "wishes" && entry.item.merchantUrl ? (
              <MerchantLinkButton url={entry.item.merchantUrl} merchantName={entry.item.merchantName} matchId={null} context="received" isAffiliate={entry.item.isAffiliate} />
            ) : null}
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
              <Text style={styles.closeLabel}>{t.friendShelves.close}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  cell: { width: "32%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  avoider: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    maxHeight: "85%",
    flexShrink: 1,
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.full, backgroundColor: color.filet, marginTop: space.sm },
  sheetContent: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  image: { width: "100%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: color.plinthe },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.sm },
  meta: { fontSize: font.secondary, color: color.acier },
  closeButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  closeLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
}));
