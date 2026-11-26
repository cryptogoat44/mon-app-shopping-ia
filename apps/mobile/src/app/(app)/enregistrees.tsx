import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { fetchCollections, fetchSavedPosts } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { loadsWithoutTap, nextEmptyStreak } from "@/lib/member-lists";
import { hasSeveralPhotos } from "@/lib/post-extras";
import { appendSavedPage, parseSavedListParams, savedListEmptyText } from "@/lib/saved-posts";
import { PhotosIcon } from "@/components/icons";
import { SpotImage } from "@/components/spot-image";
import { ImageUnavailable } from "@/components/image-unavailable";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { Skeleton } from "@/components/skeleton";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Publications enregistrées (lot « vie sociale », migration 0048) : vos
// publications enregistrées que vous pouvez encore voir, en grille de trois
// (la même case que le profil d'un membre), les plus récemment enregistrées
// d'abord ; `collection` : seulement celles rangées dans une de vos
// collections. Vous seul les voyez. Le serveur relit le droit de voir chaque
// publication : une page peut arriver plus courte, ou vide, alors qu'il en
// reste — la suite se charge alors d'elle-même, trois pages vides de rang au
// plus (la règle des listes de membres), puis « Voir la suite ». Relue à
// chaque retour sur l'écran (une publication a pu être retirée ou rangée
// ailleurs depuis son détail).
export default function SavedPostsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ collection?: string }>();
  const target = parseSavedListParams(params);
  if (!target) return <Redirect href="/profile" />;
  return <SavedPostsList key={target.collectionId ?? "all"} collectionId={target.collectionId} onBack={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} />;
}

function SavedPostsList({ collectionId, onBack }: { collectionId: string | null; onBack: () => void }) {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [emptyStreak, setEmptyStreak] = useState(0);
  const [collectionName, setCollectionName] = useState<string | null>(null);
  // Une réponse arrivée après un rechargement est ignorée.
  const generation = useRef(0);
  const shown = useRef(false);
  const fetchingMore = useRef(false);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(null);
    setMoreError(null);
    try {
      const page = await fetchSavedPosts(null, collectionId);
      if (current !== generation.current) return;
      shown.current = true;
      setPosts(page.posts);
      setCursor(page.nextCursor);
      setEmptyStreak(nextEmptyStreak(0, page.posts.length, page.nextCursor !== null, false));
    } catch (e) {
      if (current !== generation.current) return;
      // Un rafraîchissement raté garde la grille déjà affichée.
      if (shown.current) setMoreError(loadErrorMessage(e, t.savedPosts.listLoadError));
      else setError(loadErrorMessage(e, t.savedPosts.listLoadError));
    }
  }, [collectionId]);

  const loadMore = useCallback(
    async (byTap: boolean) => {
      if (!cursor || fetchingMore.current) return;
      const current = generation.current;
      fetchingMore.current = true;
      setLoadingMore(true);
      setMoreError(null);
      try {
        const page = await fetchSavedPosts(cursor, collectionId);
        if (current !== generation.current) return;
        setPosts((previous) => appendSavedPage(previous ?? [], page.posts));
        setCursor(page.nextCursor);
        setEmptyStreak((previous) => nextEmptyStreak(previous, page.posts.length, page.nextCursor !== null, byTap));
      } catch (e) {
        if (current === generation.current) setMoreError(loadErrorMessage(e, t.savedPosts.listLoadError));
      } finally {
        fetchingMore.current = false;
        setLoadingMore(false);
      }
    },
    [collectionId, cursor]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Le nom de la collection, pour le titre (une des vôtres ; inconnue : la liste le dira).
  useEffect(() => {
    if (!collectionId) return;
    let active = true;
    fetchCollections()
      .then((list) => {
        if (active) setCollectionName(list.find((collection) => collection.id === collectionId)?.name ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [collectionId]);

  // La suite peut-elle partir sans qu'on la demande ? Jamais après une erreur.
  const autoLoad = cursor !== null && moreError === null && loadsWithoutTap(emptyStreak);
  // Une page vide alors qu'il en reste : la suivante part d'elle-même.
  useEffect(() => {
    if (emptyStreak > 0 && autoLoad && !loadingMore) void loadMore(false);
  }, [autoLoad, emptyStreak, loadMore, loadingMore]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const header = (
    <View style={styles.header}>
      {collectionId && collectionName ? <Text style={styles.subtitle}>{t.savedPosts.collectionTabLabel(collectionName)}</Text> : null}
      <Text style={styles.note}>{t.savedPosts.privateNote}</Text>
    </View>
  );

  let body;
  if (posts === null) {
    body = error ? (
      <View style={styles.content}>
        {header}
        <LoadFailure message={error} onRetry={() => void load()} />
      </View>
    ) : (
      <View style={styles.content}>
        {header}
        <View style={styles.gridRow}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} style={styles.cell} />
          ))}
        </View>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={chunk(posts, 3)}
        keyExtractor={(row) => row.map((post) => post.id).join("-")}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        renderItem={({ item: row }) => (
          <View style={styles.gridRow}>
            {row.map((post) => (
              <Pressable
                key={post.id}
                style={styles.cell}
                onPress={() => router.push({ pathname: "/publication", params: { id: post.id } })}
                accessibilityRole="button"
                accessibilityLabel={post.caption ?? t.postDetail.title}
              >
                {post.mediaUrl === null ? (
                  <ImageUnavailable variant="tile" />
                ) : (
                  <SpotImage size="small" hdUri={post.mediaUrl} fallbackUri={post.mediaThumbUrl ?? post.mediaHdUrl ?? post.mediaUrl} style={styles.fill} fit="cover" recyclingKey={post.id} />
                )}
                {hasSeveralPhotos(post) ? (
                  <View style={styles.photosMark} accessible accessibilityLabel={t.carousel.morePhotos}>
                    <PhotosIcon size={14} />
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
        // Rien à montrer, et plus rien à charger : la phrase de la liste vide.
        ListEmptyComponent={cursor !== null ? null : <Text style={styles.empty}>{savedListEmptyText(collectionId !== null)}</Text>}
        ListFooterComponent={
          <View>
            {moreError ? <ErrorMessage style={styles.moreError}>{moreError}</ErrorMessage> : null}
            {loadingMore ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
            {cursor !== null && !loadingMore ? (
              <Pressable style={styles.more} onPress={() => void loadMore(true)} accessibilityRole="button" testID="enregistrees-suite">
                <Text style={styles.moreLabel}>{t.savedPosts.loadMore}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        onEndReached={() => {
          if (autoLoad) void loadMore(false);
        }}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.encre} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {t.savedPosts.listTitle}
        </Text>
        <View style={styles.navSide} />
      </View>
      <View style={styles.body}>{body}</View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, gap: space.sm },
  navSide: { minWidth: 26, minHeight: 44, justifyContent: "center" },
  back: { fontSize: 26, color: color.encre },
  title: { flexShrink: 1, fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre },
  body: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  header: { paddingTop: space.xs, paddingBottom: space.md, gap: space.xs },
  subtitle: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  gridRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  cell: { width: "32%", aspectRatio: 1, borderRadius: radius.pieceGrid, borderCurve: "continuous", overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  photosMark: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: radius.full, backgroundColor: color.voileImage, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg, lineHeight: 20, paddingHorizontal: space.md },
  moreError: { fontSize: font.secondary, marginTop: space.md, textAlign: "center" },
  loader: { marginTop: space.md },
  more: { alignSelf: "center", marginTop: space.md, minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
