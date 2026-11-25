import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { Post, UserProfile } from "@monapp/shared-types";
import { ApiError, fetchUserPosts, fetchUserProfile, followUser, unfollowUser } from "@/lib/api";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { LockIcon, MoreIcon, PhotosIcon, PinIcon } from "@/components/icons";
import { hasSeveralPhotos } from "@/lib/post-extras";
import { appendGridPage, gridCellLabel, profileGrid } from "@/lib/profile-pins";
import { ProfileLink } from "@/components/profile-link";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { SpotImage } from "@/components/spot-image";
import { ImageUnavailable } from "@/components/image-unavailable";
import { ErrorMessage } from "@/components/error-message";
import { FriendCollections } from "@/components/friend-collections";
import { useToast } from "@/lib/toast-context";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { followActionFor, followButton, followStateOf, showsPrivateShell } from "@/lib/follow-state";
import { memberListRoute } from "@/lib/member-lists";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

/** Entre deux compteurs du profil. */
const COUNT_SEPARATOR = " · ";

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Profil d'un autre utilisateur (Lot Q, décision 6) : identité, bio,
// compteurs, suivre / ne plus suivre, signaler / bloquer, et ses
// publications — chacune selon sa propre confidentialité (filtrée par le
// serveur). JAMAIS son Vault, ni même le nombre de pièces qu'il contient.
// Compte privé (lot « vie sociale ») : qui n'est pas un abonné accepté ne voit
// que nom, photo, bio et compteurs, un cadenas et une phrase ; le bouton dit
// « Suivre », puis « Demandé » (le toucher annule la demande).
// Épingles et lien en bio (migration 0049) : ses publications épinglées en
// tête de la grille, avec une marque ; son lien sous la bio (jamais pour un
// compte privé vu par un inconnu : le serveur ne le donne pas).
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [followBusy, setFollowBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Lot messages : bouton « Message », seulement si la messagerie est disponible.
  const messages = useMessagesStatus();

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
      const grid = profileGrid(page);
      setPosts(grid.posts);
      setPinnedIds(grid.pinnedIds);
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
      // Une épinglée revient à sa place chronologique : jamais deux fois.
      setPosts((prev) => appendGridPage(prev ?? [], page.posts));
      setNextCursor(page.nextCursor);
    } catch {
      // silencieux : re-scroller relance le chargement
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleFollow() {
    if (!profile) return;
    // Abonné(e) : ne plus suivre. Demande en attente : l'annuler. Sinon : suivre
    // (compte privé : le serveur enregistre une demande).
    const action = followActionFor(followStateOf(profile));
    setFollowBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (action === "follow") await followUser(profile.id, "profile");
      else await unfollowUser(profile.id);
      // Les publications « abonnés » apparaissent ou disparaissent : on relit.
      const [loadedProfile, page] = await Promise.all([fetchUserProfile(profile.id), fetchUserPosts(profile.id)]);
      setProfile(loadedProfile);
      const grid = profileGrid(page);
      setPosts(grid.posts);
      setPinnedIds(grid.pinnedIds);
      setNextCursor(page.nextCursor);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.userProfile.followError);
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
      <Pressable onPress={goBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      {profile ? (
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button" accessibilityLabel={t.userProfile.more}>
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
              <ErrorMessage style={styles.message}>{state === "not_found" ? t.userProfile.notFound : t.userProfile.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>{t.common.retry}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const isShell = showsPrivateShell(profile);
  const followState = followStateOf(profile);
  const follow = followButton(followState, t.userProfile.unfollow);

  const header = (
    <View style={styles.header}>
      <Avatar uri={profile.avatarUrl} userId={profile.id} displayName={profile.displayName} username={profile.username} size={88} accessibilityLabel={profile.displayName} />
      <Text style={styles.name} accessibilityRole="header">{profile.displayName}</Text>
      <Text style={styles.handle}>@{profile.username}</Text>
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      <ProfileLink url={profile.linkUrl} />
      {/* Compte privé vu par un inconnu : jamais le nombre de publications, et
          les deux compteurs restent du texte (ses listes ne s'ouvrent qu'à ses
          abonnés acceptés). Sinon, chacun ouvre sa liste. */}
      <View style={styles.counts}>
        {isShell ? null : <Text style={styles.count}>{`${t.userProfile.posts_count(profile.postsCount)}${COUNT_SEPARATOR}`}</Text>}
        {isShell ? (
          <Text style={styles.count}>{t.userProfile.followers(profile.followersCount)}</Text>
        ) : (
          <Pressable
            style={styles.countLink}
            onPress={() => router.push(memberListRoute("followers", profile.id))}
            accessibilityRole="link"
            accessibilityLabel={t.memberLists.openFollowers(profile.followersCount)}
            testID="ouvrir-abonnes"
          >
            <Text style={styles.count}>{t.userProfile.followers(profile.followersCount)}</Text>
          </Pressable>
        )}
        <Text style={styles.count}>{COUNT_SEPARATOR}</Text>
        {isShell ? (
          <Text style={styles.count}>{t.userProfile.following(profile.followingCount)}</Text>
        ) : (
          <Pressable
            style={styles.countLink}
            onPress={() => router.push(memberListRoute("following", profile.id))}
            accessibilityRole="link"
            accessibilityLabel={t.memberLists.openFollowing(profile.followingCount)}
            testID="ouvrir-abonnements"
          >
            <Text style={styles.count}>{t.userProfile.following(profile.followingCount)}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.follow, follow.primary ? null : styles.following, followBusy ? styles.busy : null]}
          onPress={handleFollow}
          disabled={followBusy}
          accessibilityRole="button"
          accessibilityLabel={follow.label}
          accessibilityHint={follow.hint}
          testID="bouton-suivre"
        >
          <Text style={[styles.followLabel, follow.primary ? null : styles.followingLabel]}>{follow.label}</Text>
        </Pressable>
        {messages.enabled ? (
          <Pressable
            style={[styles.follow, styles.following]}
            onPress={() => router.push({ pathname: "/conversation", params: { userId: profile.id } })}
            accessibilityRole="button"
            accessibilityLabel={t.messages.messageButtonLabel(profile.displayName)}
            testID="bouton-message"
          >
            <Text style={[styles.followLabel, styles.followingLabel]}>{t.messages.messageButton}</Text>
          </Pressable>
        ) : null}
      </View>
      {isShell ? (
        <View style={styles.shell} testID="profil-prive">
          <View accessible accessibilityLabel={t.privateAccount.lockLabel}>
            <LockIcon size={28} tint={color.acier} />
          </View>
          <Text style={styles.shellText}>{t.privateAccount.shellNotice}</Text>
        </View>
      ) : (
        <>
          {/* Lot collections : ses collections montrées aux amis (rien pour les autres). */}
          <FriendCollections userId={profile.id} displayName={profile.displayName} refreshKey={String(profile.isFollowing)} />
          <Text style={styles.sectionTitle}>{t.userProfile.posts}</Text>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      {nav}
      <FlatList
        data={isShell ? [] : chunk(posts ?? [], 3)}
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
                accessibilityLabel={gridCellLabel(post.caption ?? t.postDetail.title, pinnedIds.has(post.id))}
              >
                {/* Grille : miniature (480 px) d'une photo publiée ; image HD du
                    marchand pour un « achat » ; repli sur l'image d'origine.
                    Image retirée par la modération : « Image indisponible ». */}
                {post.mediaUrl === null ? (
                  <ImageUnavailable variant="tile" />
                ) : (
                  <SpotImage
                    size="small"
                    hdUri={post.mediaUrl}
                    fallbackUri={post.mediaThumbUrl ?? post.mediaHdUrl ?? post.mediaUrl}
                    style={styles.fill}
                    fit="cover"
                    recyclingKey={post.id}
                  />
                )}
                {/* Plusieurs photos (migration 0047) : une petite marque dans le coin. */}
                {hasSeveralPhotos(post) ? (
                  <View style={styles.photosMark} accessible accessibilityLabel={t.carousel.morePhotos}>
                    <PhotosIcon size={14} />
                  </View>
                ) : null}
                {/* Épinglée (migration 0049) : une punaise dans l'autre coin ;
                    VoiceOver lit « Épinglée » dans le libellé de la case. */}
                {pinnedIds.has(post.id) ? (
                  <View style={styles.pinMark} testID="marque-epinglee">
                    <PinIcon size={13} />
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
        ListEmptyComponent={isShell ? null : <Text style={styles.empty}>{t.userProfile.noPosts}</Text>}
        onEndReached={isShell ? undefined : handleLoadMore}
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

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  back: { fontSize: 26, color: color.encre },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center" },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { ...lienSouligne, fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  header: { alignItems: "center", paddingBottom: space.md },
  fill: { width: "100%", height: "100%" },
  name: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre, marginTop: space.md },
  handle: { fontSize: font.secondary, color: color.acier, marginTop: 2 },
  bio: { fontSize: font.secondary, color: color.encre, textAlign: "center", marginTop: space.sm, lineHeight: 20 },
  counts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", minHeight: 44 },
  count: { fontSize: font.caption, color: color.acier },
  countLink: { minHeight: 44, justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm, marginTop: space.md },
  follow: { minHeight: 44, minWidth: 130, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  following: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.filet },
  busy: { opacity: 0.6 },
  followLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  followingLabel: { color: color.encre },
  sectionTitle: { alignSelf: "flex-start", fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl },
  shell: { alignItems: "center", gap: space.sm, marginTop: space.xl, paddingHorizontal: space.lg },
  shellText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20 },
  gridRow: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  cell: { width: "32%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  photosMark: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: radius.full, backgroundColor: color.voileImage, alignItems: "center", justifyContent: "center" },
  pinMark: { position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: radius.full, backgroundColor: color.voileImage, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.md },
  footer: { paddingVertical: space.lg },
}));
