import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { ReceivedPiece } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { ApiError, fetchReceivedPieces, removeReceivedPiece } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { formatPrice, timeAgo } from "@/lib/format";
import { useToast } from "@/lib/toast-context";
import { MoreIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

function PieceRow({ piece, onOpenMenu, onRemoved }: { piece: ReceivedPiece; onOpenMenu: () => void; onRemoved: (id: string) => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [removing, setRemoving] = useState(false);
  const price = piece.priceMin === null ? null : formatPrice(piece.priceMin, piece.currency, getActiveLocale());

  async function handleRemove() {
    setRemoving(true);
    try {
      await removeReceivedPiece(piece.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.received.removed);
      onRemoved(piece.id);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.received.removeError);
      setRemoving(false);
    }
  }

  return (
    <View style={styles.row} testID={`piece-recue-${piece.id}`}>
      <View style={styles.thumb}>
        <SpotImage hdUri={null} fallbackUri={piece.imageThumbUrl} style={styles.fill} fit="cover" accessibilityLabel={piece.title} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={2}>
          {piece.title}
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: "/profil", params: { id: piece.sender.id } })}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={t.common.viewProfile(piece.sender.displayName)}
        >
          <Text style={styles.meta}>
            {[t.received.from(piece.sender.displayName), timeAgo(piece.createdAt, getActiveLocale()), price].filter(Boolean).join(" · ")}
          </Text>
        </Pressable>
        {piece.merchantUrl ? (
          <>
            <MerchantLinkButton
              url={piece.merchantUrl}
              merchantName={piece.merchantName}
              matchId={piece.productMatchId}
              context="received"
              isAffiliate={piece.isAffiliate}
              compact
            />
            {piece.isAffiliate ? <Text style={styles.disclosure}>{t.result.affiliateDisclosure}</Text> : null}
          </>
        ) : null}
        <Pressable onPress={handleRemove} disabled={removing} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityState={{ busy: removing }}>
          <Text style={styles.removeLabel}>{t.received.remove}</Text>
        </Pressable>
      </View>
      <Pressable onPress={onOpenMenu} hitSlop={11} style={styles.more} accessibilityRole="button" accessibilityLabel={t.received.options(piece.title)}>
        <MoreIcon size={18} tint={color.acier} />
      </Pressable>
    </View>
  );
}

// Pièces reçues (lot 5, 5.C) : onglet « Reçues » des Envies, et écran ouvert
// depuis l'Activité. Chaque pièce : sa copie d'image (jamais l'adresse
// d'origine), qui l'a envoyée, le lien marchand (mention « lien affilié »),
// « Retirer », et le menu « Signaler cette pièce » / « Bloquer ».
export function ReceivedPieces() {
  const [pieces, setPieces] = useState<ReceivedPiece[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [menuPiece, setMenuPiece] = useState<ReceivedPiece | null>(null);

  const load = useCallback(
    () =>
      fetchReceivedPieces()
        .then((page) => {
          setPieces(page.pieces);
          setNextCursor(page.nextCursor);
          setError(null);
          setMoreError(null);
        })
        .catch((e) => setError(loadErrorMessage(e, t.received.loadError))),
    []
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchReceivedPieces(nextCursor);
      setPieces((current) => [...(current ?? []), ...page.pieces]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setMoreError(loadErrorMessage(e, t.received.loadMoreError));
    } finally {
      setLoadingMore(false);
    }
  }

  if (pieces === null && error) return <LoadFailure message={error} onRetry={() => void load()} />;
  if (pieces === null) {
    return (
      <View style={styles.list}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.row}>
            <Skeleton style={styles.thumb} />
            <View style={styles.rowText}>
              <Skeleton style={{ width: "70%", height: 13, marginBottom: 6 }} />
              <Skeleton style={{ width: "40%", height: 11 }} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {pieces.length === 0 ? <Text style={styles.empty}>{t.received.empty}</Text> : null}
      {pieces.map((piece) => (
        <PieceRow
          key={piece.id}
          piece={piece}
          onOpenMenu={() => setMenuPiece(piece)}
          onRemoved={(id) => setPieces((current) => (current ?? []).filter((p) => p.id !== id))}
        />
      ))}
      {moreError ? <ErrorMessage style={styles.moreError}>{moreError}</ErrorMessage> : null}
      {nextCursor ? (
        <Pressable style={styles.loadMore} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button" accessibilityState={{ busy: loadingMore }}>
          {loadingMore ? <ActivityIndicator color={color.encre} /> : <Text style={styles.loadMoreLabel}>{t.received.loadMore}</Text>}
        </Pressable>
      ) : null}
      <ReportBlockMenu
        visible={menuPiece !== null}
        onClose={() => setMenuPiece(null)}
        userId={menuPiece?.sender.id ?? ""}
        pieceId={menuPiece?.id}
        onBlocked={(blockedId) => setPieces((current) => (current ?? []).filter((p) => p.sender.id !== blockedId))}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginTop: space.xl, paddingHorizontal: space.lg },
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.filet },
  thumb: { width: 76, height: 76, borderRadius: radius.sm, backgroundColor: color.plinthe, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  meta: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  disclosure: { fontSize: 11.5, color: color.acier },
  remove: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
  removeLabel: { fontSize: font.caption, color: color.danger, fontWeight: "600" },
  more: { paddingTop: 2, minWidth: 32, alignItems: "flex-end" },
  moreError: { fontSize: font.secondary, marginTop: space.md },
  loadMore: { alignSelf: "center", marginTop: space.md, minHeight: 44, minWidth: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, justifyContent: "center" },
  loadMoreLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
