import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { Post, UserProfile } from "@monapp/shared-types";
import { ApiError, fetchUserPosts, fetchUserProfile, followUser, unfollowUser } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { MoreIcon, PersonIcon } from "@/components/icons";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { SpotImage } from "@/components/spot-image";
import { ErrorMessage } from "@/components/error-message";
import { useToast } from "@/lib/toast-context";

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Profil d'un autre utilisateur (Lot Q, décision 6) : identité, bio,
// compteurs, suivre / ne plus suivre, signaler / bloquer, et ses
// publications — chacune selon sa propre confidentialité (filtrée par le
// serveur). JAMAIS son Vault, ni même le nombre de pièces qu'il contient.
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [followBusy, setFollowBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setState("loading");
    try {
      const [loadedProfile, page] = await Promise.all([fetchUserProfile(id), fetchUserPosts(id)]);
      // Son propre profil : l'onglet Profil, qui montre aussi le Vault.
      if (loadedProfile.isMe) {
        router.replace("/profile");
        return;
      }
      setProfile(loadedProfile);
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLoadMore() {
    if (!id || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchUserPosts(id, nextCursor);
      setPosts((prev) => [...(prev ?? []), ...page.posts]);
      setNextCursor(page.nextCursor);
    } catch {
      // silencieux : re-scroller relance le chargement
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleFollow() {
    if (!profile) return;
    const wasFollowing = profile.isFollowing;
    setFollowBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (wasFollowing) await unfollowUser(profile.id);
      else await followUser(profile.id);
      // Les publications « abonnés » apparaissent ou disparaissent : on relit.
      const [loadedProfile, page] = await Promise.all([fetchUserProfile(profile.id), fetchUserPosts(profile.id)]);
      setProfile(loadedProfile);
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : fr.userProfile.followError);
    } finally {
      setFollowBusy(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/feed");
  }

  const nav = (
    <View style={styles.nav}>
      <Pressable onPress={goBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel="Retour">
        <Text style={styles.back}>‹</Text>
      </Pressable>
      {profile ? (
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button" accessibilityLabel={fr.userProfile.more}>
          <MoreIcon size={20} tint={color.encre} />
        </Pressable>
      ) : null}
    </View>
  );

  if (state !== "ready" || !profile) {
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? fr.userProfile.notFound : fr.userProfile.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>Réessayer</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.avatar}>
        {profile.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.fill} contentFit="cover" accessibilityLabel={profile.displayName} />
        ) : (
          <PersonIcon size={34} tint={color.acier} />
        )}
      </View>
      <Text style={styles.name} accessibilityRole="header">{profile.displayName}</Text>
      <Text style={styles.handle}>@{profile.username}</Text>
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      <Text style={styles.counts}>
        {fr.userProfile.posts_count(profile.postsCount)} · {fr.userProfile.followers(profile.followersCount)} · {fr.userProfile.following(profile.followingCount)}
      </Text>
      <Pressable
        style={[styles.follow, profile.isFollowing ? styles.following : null, followBusy ? styles.busy : null]}
        onPress={handleFollow}
        disabled={followBusy}
        accessibilityRole="button"
      >
        <Text style={[styles.followLabel, profile.isFollowing ? styles.followingLabel : null]}>
          {profile.isFollowing ? fr.userProfile.unfollow : fr.userProfile.follow}
        </Text>
      </Pressable>
      <Text style={styles.sectionTitle}>{fr.userProfile.posts}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      {nav}
      <FlatList
        data={chunk(posts ?? [], 3)}
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
                accessibilityLabel={post.caption ?? fr.postDetail.title}
              >
                {/* Grille : miniature (480 px) d'une photo publiée ; image HD du
                    marchand pour un « achat » ; repli sur l'image d'origine. */}
                <SpotImage
                  hdUri={post.mediaThumbUrl ?? post.mediaHdUrl}
                  fallbackUri={post.mediaUrl}
                  style={styles.fill}
                  fit="cover"
                  recyclingKey={post.id}
                />
              </Pressable>
            ))}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{fr.userProfile.noPosts}</Text>}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={color.encre} style={styles.footer} /> : null}
      />
      <ReportBlockMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        userId={profile.id}
        onBlocked={() => goBack()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  back: { fontSize: 26, color: color.encre },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center" },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  header: { alignItems: "center", paddingBottom: space.md },
  avatar: { width: 88, height: 88, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  name: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginTop: space.md },
  handle: { fontSize: font.secondary, color: color.acier, marginTop: 2 },
  bio: { fontSize: font.secondary, color: color.encre, textAlign: "center", marginTop: space.sm, lineHeight: 20 },
  counts: { fontSize: font.caption, color: color.acier, marginTop: space.sm },
  follow: { marginTop: space.md, minHeight: 44, minWidth: 160, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  following: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.filet },
  busy: { opacity: 0.6 },
  followLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  followingLabel: { color: color.encre },
  sectionTitle: { alignSelf: "flex-start", fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl },
  gridRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  cell: { width: "32%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.md },
  footer: { paddingVertical: space.lg },
});
