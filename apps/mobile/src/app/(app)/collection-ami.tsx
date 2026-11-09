import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { PostAuthor, SharedCollectionItem, SharedCollectionPage } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { ApiError, fetchSharedCollection, keepSharedItem } from "@/lib/api";
import { canReportCollection, sharedItemImage, sharedItemPrice } from "@/lib/collections";
import { loadErrorMessage } from "@/lib/load-error";
import { useAuth } from "@/lib/auth-context";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { MoreIcon } from "@/components/icons";
import { ImageUnavailable } from "@/components/image-unavailable";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

function ItemRow({ item, owner, canTalk }: { item: SharedCollectionItem; owner: PostAuthor; canTalk: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState(false);
  const image = sharedItemImage(item);
  const meta = [item.merchantName, sharedItemPrice(item, getActiveLocale())].filter(Boolean).join(" · ");

  async function handleKeep() {
    if (keeping || kept) return;
    setKeeping(true);
    try {
      const result = await keepSharedItem(item.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(result.alreadyKept ? t.collections.alreadyKept : t.collections.kept);
      setKept(true);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.collections.keepError);
    } finally {
      setKeeping(false);
    }
  }

  return (
    <View style={styles.row} testID={`envie-ami-${item.id}`}>
      <View style={styles.thumb}>
        {/* Toujours la copie faite par Spotto ; sans copie : « Image indisponible ». */}
        {image === null ? <ImageUnavailable variant="thumb" /> : <SpotImage hdUri={null} fallbackUri={image} style={styles.fill} fit="cover" accessibilityLabel={item.title} />}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {item.merchantUrl ? (
          <>
            <MerchantLinkButton url={item.merchantUrl} merchantName={item.merchantName} matchId={item.productMatchId} context="received" isAffiliate={item.isAffiliate} compact />
            {item.isAffiliate ? <Text style={styles.disclosure}>{t.result.affiliateDisclosure}</Text> : null}
          </>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            style={[styles.action, kept ? styles.actionDone : null]}
            onPress={() => void handleKeep()}
            disabled={keeping || kept}
            accessibilityRole="button"
            accessibilityLabel={t.collections.keepLabel(item.title)}
            accessibilityState={{ busy: keeping, disabled: kept }}
          >
            <Text style={[styles.actionLabel, kept ? styles.actionDoneLabel : null]}>{kept ? t.collections.alreadyKept : t.collections.keep}</Text>
          </Pressable>
          {canTalk ? (
            <Pressable
              style={styles.action}
              onPress={() => router.push({ pathname: "/conversation", params: { userId: owner.id, collectionItemId: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={t.collections.talkLabel(item.title, owner.displayName)}
              testID="en-parler"
            >
              <Text style={styles.actionLabel}>{t.collections.talk}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// Une collection d'un ami (lot collections) : ses envies, avec la copie de
// leur image faite par Spotto, leur prix et le lien vers la boutique ;
// « Garder » (dans mes Envies) et « En parler » (la conversation avec cet
// ami, l'envie jointe d'avance). Introuvable pour quiconque n'est pas son ami.
// Lot modération des collections : « Signaler cette collection » (ou bloquer
// son auteur), dans le menu « … » ; signalée, elle disparaît aussitôt.
export default function FriendCollectionScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const messages = useMessagesStatus();
  const collections = useCollectionsStatus();
  const { session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState<SharedCollectionPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setState("not_found");
      return;
    }
    setState("loading");
    try {
      setPage(await fetchSharedCollection(id));
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!id || !page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await fetchSharedCollection(id, page.nextCursor);
      setPage((current) => (current ? { ...next, items: [...current.items, ...next.items] } : next));
    } catch (e) {
      setMoreError(loadErrorMessage(e, t.collections.loadMoreError));
    } finally {
      setLoadingMore(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/feed");
  }

  const reportable = page !== null && canReportCollection(collections, page.collection.owner.id, session?.user.id);
  const nav = (
    <View style={styles.nav}>
      <Pressable onPress={goBack} hitSlop={12} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t.collections.back}>
        <Text style={styles.backLabel}>‹ {t.collections.back}</Text>
      </Pressable>
      {state === "ready" && reportable ? (
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={12} style={styles.navMore} accessibilityRole="button" accessibilityLabel={t.collections.options} testID="options-collection">
          <MoreIcon size={20} tint={color.encre} />
        </Pressable>
      ) : null}
    </View>
  );

  if (state !== "ready" || !page) {
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? t.collections.notFound : t.collections.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={() => void load()} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>{t.common.retry}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const { collection, items } = page;
  return (
    <SafeAreaView style={styles.screen}>
      {nav}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {collection.name}
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: "/profil", params: { id: collection.owner.id } })}
          hitSlop={6}
          style={styles.ownerLine}
          accessibilityRole="link"
          accessibilityLabel={t.common.viewProfile(collection.owner.displayName)}
        >
          <Avatar uri={collection.owner.avatarUrl} userId={collection.owner.id} displayName={collection.owner.displayName} username={collection.owner.username} size={24} />
          <Text style={styles.owner}>
            {t.collections.by(collection.owner.displayName)} · {t.collections.itemCount(collection.itemCount)}
          </Text>
        </Pressable>
        {items.length === 0 ? <Text style={styles.empty}>{t.collections.friendEmpty}</Text> : null}
        {items.map((item) => (
          <ItemRow key={item.id} item={item} owner={collection.owner} canTalk={messages.enabled} />
        ))}
        {moreError ? <ErrorMessage style={styles.message}>{moreError}</ErrorMessage> : null}
        {page.nextCursor ? (
          <Pressable style={styles.more} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button" accessibilityState={{ busy: loadingMore }}>
            {loadingMore ? <ActivityIndicator color={color.encre} /> : <Text style={styles.moreLabel}>{t.collections.loadMore}</Text>}
          </Pressable>
        ) : null}
      </ScrollView>
      {reportable ? (
        <ReportBlockMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          userId={collection.owner.id}
          collectionId={collection.id}
          // Signalée, ou son auteur bloqué : elle ne vous est plus montrée.
          onReported={goBack}
          onBlocked={goBack}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  navBack: { minHeight: 44, justifyContent: "center" },
  navMore: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  backLabel: { color: color.encre, fontSize: font.secondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center", marginTop: space.xs },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  ownerLine: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 4, marginBottom: space.md },
  owner: { flexShrink: 1, fontSize: font.secondary, color: color.acier },
  empty: { fontSize: font.secondary, color: color.acier, lineHeight: 20 },
  row: { flexDirection: "row", gap: space.md, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: color.filet },
  thumb: { width: 96, height: 96, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  rowText: { flex: 1, gap: 4 },
  itemTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  meta: { fontSize: font.caption, color: color.acier },
  disclosure: { fontSize: 11.5, color: color.acier },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  action: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  actionDone: { borderColor: color.plinthe, backgroundColor: color.plinthe },
  actionLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  actionDoneLabel: { color: color.acier },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.md },
  moreLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
