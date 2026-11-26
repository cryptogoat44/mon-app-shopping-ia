import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { ApiError, fetchFeed, fetchForYou } from "@/lib/api";
import { track } from "@/lib/analytics";
import { appendUnique, fetchUntilShown, forYouShown, noteForYouFailure, rememberSegment, rememberedSegment, type FeedSegment } from "@/lib/for-you";
import { SegmentedChoice } from "@/components/segmented-choice";
import { LoadFailure } from "@/components/load-failure";
import { AccountSuggestions } from "@/components/account-suggestions";
import { SearchIcon } from "@/components/icons";
import { color, font, radius, serifDisplayLetterSpacing, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { Skeleton } from "@/components/skeleton";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { ErrorMessage } from "@/components/error-message";
import { PostCard } from "@/components/post-card";
import { useAuth } from "@/lib/auth-context";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

function FeedSkeletonRow() {
  return (
    <View style={styles.post}>
      <View style={styles.author}>
        <Skeleton style={styles.avatar} />
        <Skeleton style={{ width: 100, height: 12 }} />
      </View>
      <Skeleton style={styles.media} />
      <Skeleton style={{ width: "70%", height: 12, marginTop: 12 }} />
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id;
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuTarget, setMenuTarget] = useState<{ userId: string; postId: string } | null>(null);
  // Lot « découverte » : « Abonnements | Pour vous ». Chaque fil garde sa
  // liste, sa suite et sa position (les deux listes restent montées) ; le
  // choix est gardé pour la session. Serveur d'avant ce lot : pas de choix.
  const [segment, setSegment] = useState<FeedSegment>(rememberedSegment);
  const [withForYou, setWithForYou] = useState(forYouShown);
  const [forYouPosts, setForYouPosts] = useState<Post[] | null>(null);
  const [forYouNext, setForYouNext] = useState<number | null>(null);
  const [forYouError, setForYouError] = useState<string | null>(null);
  const [forYouRefreshing, setForYouRefreshing] = useState(false);
  const [forYouLoadingMore, setForYouLoadingMore] = useState(false);
  // Comptes bloqués depuis cet écran : retirés aussi des suggestions.
  const [blockedIds, setBlockedIds] = useState<string[]>([]);

  function handleBlocked(userId: string) {
    setPosts((prev) => (prev ? prev.filter((p) => p.author.id !== userId) : prev));
    setForYouPosts((prev) => (prev ? prev.filter((p) => p.author.id !== userId) : prev));
    setBlockedIds((prev) => [...prev, userId]);
  }

  // Chantier 3 : une publication signalée quitte aussitôt le fil (les deux fils).
  function handleReported(postId: string) {
    setPosts((prev) => (prev ? prev.filter((p) => p.id !== postId) : prev));
    setForYouPosts((prev) => (prev ? prev.filter((p) => p.id !== postId) : prev));
  }

  /** Échec de « Pour vous » : un serveur d'avant ce lot (404) cache le choix
   * et revient aux abonnements ; sinon, « Réessayer » dans ce fil seulement. */
  function forYouFailed(e: unknown) {
    if (noteForYouFailure(e)) {
      setWithForYou(false);
      setSegment("following");
      return;
    }
    setForYouError(e instanceof ApiError ? e.message : t.forYou.loadError);
  }

  const loadForYou = useCallback(async () => {
    try {
      const page = await fetchUntilShown(fetchForYou);
      setForYouPosts(page.posts);
      setForYouNext(page.nextOffset);
      setForYouError(null);
    } catch (e) {
      forYouFailed(e);
    }
  }, []);

  // « Pour vous » se charge la première fois qu'il est montré, puis garde sa
  // liste et sa position ; tirer vers le bas le relit.
  useEffect(() => {
    if (segment === "forYou" && forYouPosts === null && forYouError === null) void loadForYou();
  }, [segment, forYouPosts, forYouError, loadForYou]);

  function chooseSegment(next: FeedSegment) {
    rememberSegment(next);
    setSegment(next);
    // Statistiques : l'ouverture de « Pour vous », rien de ce qui y est vu.
    if (next === "forYou") track("for_you_opened");
  }

  async function handleForYouRefresh() {
    setForYouRefreshing(true);
    await loadForYou();
    setForYouRefreshing(false);
  }

  async function handleForYouMore() {
    if (forYouNext === null || forYouLoadingMore || forYouRefreshing) return;
    setForYouLoadingMore(true);
    try {
      const page = await fetchUntilShown(fetchForYou, forYouNext);
      // Le classement a pu être refait entre deux pages : sans doublon.
      setForYouPosts((prev) => appendUnique(prev ?? [], page.posts));
      setForYouNext(page.nextOffset);
    } catch {
      // silencieux : re-scroller vers le bas redéclenche onEndReached
    } finally {
      setForYouLoadingMore(false);
    }
  }

  function retryForYou() {
    setForYouError(null);
    setForYouPosts(null);
  }

  const load = useCallback(async () => {
    try {
      const page = await fetchFeed();
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.feed.loadError);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchFeed()
        .then((page) => {
          if (!cancelled) {
            setPosts(page.posts);
            setNextCursor(page.nextCursor);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : t.feed.loadError);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore || refreshing) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(nextCursor);
      setPosts((prev) => (prev ? [...prev, ...page.posts] : page.posts));
      setNextCursor(page.nextCursor);
    } catch {
      // silencieux : re-scroller vers le bas redéclenche onEndReached
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{t.feed.title}</Text>
        {/* Retours du build 2 : une pastille en forme de champ de recherche, dans la même ligne que le titre
            (aucune hauteur perdue) ; elle ouvre la recherche de profils, clavier ouvert. */}
        <Pressable
          style={styles.searchPill}
          accessibilityRole="button"
          accessibilityLabel={t.feed.searchProfiles}
          accessibilityHint={t.feed.searchProfilesHint}
          onPress={() => router.push("/people-search")}
          hitSlop={{ top: 4, bottom: 4 }}
          testID="fil-rechercher-profil"
        >
          <SearchIcon size={16} tint={color.acierSurPlinthe} strokeWidth={1.6} />
          <Text style={styles.searchPillLabel} numberOfLines={1}>
            {t.feed.searchProfiles}
          </Text>
        </Pressable>
      </View>
      {withForYou ? (
        <View style={styles.segments}>
          <SegmentedChoice
            label={t.forYou.tabsLabel}
            options={[
              { value: "following", label: t.forYou.tabFollowing },
              { value: "forYou", label: t.forYou.tabForYou },
            ]}
            value={segment}
            onChange={chooseSegment}
          />
          {/* Comment le fil est classé : toujours affiché, jamais derrière un geste. */}
          {segment === "forYou" ? <Text style={styles.how}>{t.forYou.how}</Text> : null}
        </View>
      ) : null}

      {/* « Pour vous » : monté dès qu'il a été ouvert, caché sans être démonté quand on revient aux abonnements. */}
      {withForYou && (segment === "forYou" || forYouPosts !== null) ? (
        <View style={[styles.segmentBody, segment === "forYou" ? null : styles.hiddenSegment]}>
          {forYouPosts === null && forYouError ? (
            <View style={styles.content}>
              <LoadFailure message={forYouError} onRetry={retryForYou} />
            </View>
          ) : forYouPosts === null ? (
            <View style={styles.content}>
              <FeedSkeletonRow />
              <View style={styles.divider} />
              <FeedSkeletonRow />
            </View>
          ) : (
            <FlatList
              data={forYouPosts}
              keyExtractor={(post) => post.id}
              initialNumToRender={3}
              maxToRenderPerBatch={3}
              windowSize={5}
              removeClippedSubviews={Platform.OS !== "web"}
              contentContainerStyle={styles.content}
              refreshControl={<RefreshControl refreshing={forYouRefreshing} onRefresh={handleForYouRefresh} tintColor={color.encre} />}
              renderItem={({ item: post }) => (
                <PostCard
                  post={post}
                  // Publications de membres que l'on ne suit pas : toujours « signaler / bloquer » (règle 1.2 d'Apple).
                  onOpenMenu={post.author.id === myId ? undefined : () => setMenuTarget({ userId: post.author.id, postId: post.id })}
                  onPressAuthor={() =>
                    post.author.id === myId ? router.push("/profile") : router.push({ pathname: "/profil", params: { id: post.author.id } })
                  }
                  onOpenComments={() => router.push({ pathname: "/publication", params: { id: post.id } })}
                />
              )}
              ItemSeparatorComponent={() => <View style={styles.divider} />}
              ListHeaderComponent={
                <View>
                  {forYouError ? <ErrorMessage style={styles.errorText}>{forYouError}</ErrorMessage> : null}
                  <AccountSuggestions hiddenIds={blockedIds} />
                </View>
              }
              ListEmptyComponent={forYouNext === null ? <Text style={styles.forYouNote}>{t.forYou.empty}</Text> : null}
              onEndReached={handleForYouMore}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                forYouLoadingMore ? (
                  <ActivityIndicator color={color.encre} style={styles.footerLoader} />
                ) : forYouNext === null && forYouPosts.length > 0 ? (
                  <Text style={styles.forYouNote}>{t.forYou.end}</Text>
                ) : null
              }
            />
          )}
        </View>
      ) : null}

      <View style={[styles.segmentBody, withForYou && segment === "forYou" ? styles.hiddenSegment : null]}>
        {posts === null && !error ? (
          <View style={styles.content}>
            <FeedSkeletonRow />
            <View style={styles.divider} />
            <FeedSkeletonRow />
          </View>
        ) : (
          <FlatList
            data={posts ?? []}
            keyExtractor={(post) => post.id}
            // Fluidité (lot « images et fluidité ») : peu de publications
            // préparées à la fois, les autres au fil du défilement ; celles
            // sorties de l'écran sont libérées sur téléphone.
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews={Platform.OS !== "web"}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
            renderItem={({ item: post }) => (
              <PostCard
                post={post}
                // Ses propres publications (Lot F) : pas de « signaler / bloquer ».
                onOpenMenu={post.author.id === myId ? undefined : () => setMenuTarget({ userId: post.author.id, postId: post.id })}
                onPressAuthor={() =>
                  post.author.id === myId ? router.push("/profile") : router.push({ pathname: "/profil", params: { id: post.author.id } })
                }
                onOpenComments={() => router.push({ pathname: "/publication", params: { id: post.id } })}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.divider} />}
            ListHeaderComponent={error ? <ErrorMessage style={styles.errorText}>{error}</ErrorMessage> : null}
            ListEmptyComponent={
              posts !== null && !error ? (
                // Fil vide (Lot F) : expliquer quoi faire, avec des boutons ; et,
                // lot « découverte », des comptes à découvrir.
                <View>
                  <AccountSuggestions hiddenIds={blockedIds} />
                  <View style={styles.empty}>
                    <Text style={styles.emptyTitle} accessibilityRole="header">{t.feed.emptyTitle}</Text>
                    <Text style={styles.emptyText}>{t.feed.emptyBody}</Text>
                    <Pressable style={styles.emptyPrimary} onPress={() => router.push("/")} accessibilityRole="button">
                      <Text style={styles.emptyPrimaryLabel}>{t.feed.emptySpot}</Text>
                    </Pressable>
                    <Pressable style={styles.emptySecondary} onPress={() => router.push("/post-item/new")} accessibilityRole="button">
                      <Text style={styles.emptySecondaryLabel}>{t.feed.emptyPublish}</Text>
                    </Pressable>
                    <Pressable style={[styles.emptySecondary, styles.emptyFind]} onPress={() => router.push("/people-search")} accessibilityRole="button">
                      <SearchIcon size={18} tint={color.encre} strokeWidth={1.6} />
                      <Text style={styles.emptySecondaryLabel}>{t.feed.emptyFind}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={color.encre} style={styles.footerLoader} /> : null}
          />
        )}
      </View>

      <ReportBlockMenu
        visible={menuTarget !== null}
        onClose={() => setMenuTarget(null)}
        userId={menuTarget?.userId ?? ""}
        postId={menuTarget?.postId}
        onBlocked={handleBlocked}
        onReported={() => {
          if (menuTarget) handleReported(menuTarget.postId);
        }}
      />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, lineHeight: serifLineHeight.display, letterSpacing: serifDisplayLetterSpacing, color: color.encre },
  // Pastille « Rechercher un profil » : même forme que le champ de people-search.tsx ; texte acierSurPlinthe (seul gris lisible sur plinthe).
  searchPill: {
    flex: 1,
    maxWidth: 260,
    minHeight: 40,
    marginLeft: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
  },
  searchPillLabel: { flexShrink: 1, fontSize: font.secondary, color: color.acierSurPlinthe },
  // « Abonnements | Pour vous », puis la phrase qui explique le classement.
  segments: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm, maxWidth: 480, alignSelf: "center", width: "100%" },
  how: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  segmentBody: { flex: 1 },
  hiddenSegment: { display: "none" },
  forYouNote: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg, paddingHorizontal: space.lg, lineHeight: 20 },
  content: { paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  errorText: { color: color.acier, fontSize: font.secondary, paddingHorizontal: space.lg, marginBottom: space.md },
  empty: { alignItems: "center", marginTop: space.xl, paddingHorizontal: space.lg },
  emptyTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre, textAlign: "center", marginBottom: space.sm },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginBottom: space.lg, lineHeight: 20 },
  emptyPrimary: { alignSelf: "stretch", minHeight: 50, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  emptyPrimaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  emptySecondary: { alignSelf: "stretch", minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  emptySecondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "600" },
  // « Rechercher des profils » : la loupe avant le texte, comme la pastille du haut.
  emptyFind: { flexDirection: "row", gap: 8 },
  // Squelette de chargement (mêmes proportions qu'une publication).
  post: { paddingHorizontal: space.lg, paddingBottom: 26 },
  author: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: radius.full },
  media: { width: "100%", aspectRatio: 1, borderRadius: radius.piece, borderCurve: "continuous", overflow: "hidden" },
  divider: { height: 1, backgroundColor: color.filet, marginHorizontal: space.lg, marginBottom: 26 },
  footerLoader: { paddingVertical: space.lg },
}));
