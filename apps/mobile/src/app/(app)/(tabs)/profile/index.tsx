import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SpotImage } from "@/components/spot-image";
import { PieceTile } from "@/components/piece-tile";
import { ImageUnavailable } from "@/components/image-unavailable";
import { WishlistPanel } from "@/components/wishlist-panel";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { ApiError, fetchMyLifestylePosts, fetchVault } from "@/lib/api";
import type { Post, VaultItem } from "@monapp/shared-types";
import { CameraIcon, ClockIcon, PhotosIcon, PinIcon, PlusIcon, SettingsIcon, TagIcon, VerifiedIcon } from "@/components/icons";
import { hasSeveralPhotos } from "@/lib/post-extras";
import { gridCellLabel, pinnedFirst } from "@/lib/profile-pins";
import { ProfileLink } from "@/components/profile-link";
import { Avatar } from "@/components/avatar";
import { AvatarPhotoFlow } from "@/components/avatar-photo-flow";
import { onVaultChanged } from "@/lib/vault-changes";
import { useWishAlertNews } from "@/lib/use-wish-alert-news";
import { requestedProfileSegment, type ProfileSegment } from "@/lib/wishlist-link";
import { memberListRoute } from "@/lib/member-lists";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export default function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { profile, refreshProfile } = useAuth();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [vaultTotal, setVaultTotal] = useState(0);
  const [vaultNextCursor, setVaultNextCursor] = useState<string | null>(null);
  const [vaultLoadingMore, setVaultLoadingMore] = useState(false);
  const [lifestylePosts, setLifestylePosts] = useState<Post[]>([]);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [lifestyleError, setLifestyleError] = useState<string | null>(null);
  // « Voir mes Envies » (Spotter) ouvre l'onglet Envies ; sinon le Vault, comme toujours.
  const { segment: segmentParam } = useLocalSearchParams<{ segment?: string }>();
  const [segment, setSegment] = useState<ProfileSegment>(() => requestedProfileSegment(segmentParam) ?? "vault");
  // Lot « profil et icône des réglages » : choix, cadrage ou suppression de la photo.
  const [photoOpen, setPhotoOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  // Lot « alertes visibles » : les nouveautés des Envies (pastille de l'onglet, bandeau de la grille).
  const news = useWishAlertNews();
  const refreshNews = news.refresh;

  const load = useCallback(
    () =>
      Promise.all([
        fetchVault()
          .then((page) => {
            setItems(page.items);
            setVaultNextCursor(page.nextCursor);
            setVaultTotal(page.totalCount ?? page.items.length);
            setVaultError(null);
          })
          .catch((e) => setVaultError(e instanceof ApiError ? e.message : t.profile.loadError)),
        fetchMyLifestylePosts()
          .then((data) => {
            setLifestylePosts(data);
            setLifestyleError(null);
          })
          .catch((e) => setLifestyleError(e instanceof ApiError ? e.message : t.profile.loadError)),
      ]).finally(() => setLoading(false)),
    []
  );

  // Profil déjà ouvert : l'onglet demandé s'affiche aussi. Le paramètre est
  // ensuite retiré, pour qu'un prochain « Voir mes Envies » rouvre l'onglet
  // même après un passage au Vault — une fois l'écran au premier plan :
  // setParams vise l'écran affiché.
  useFocusEffect(
    useCallback(() => {
      const requested = requestedProfileSegment(segmentParam);
      if (!requested) return;
      setSegment(requested);
      router.setParams({ segment: undefined });
    }, [segmentParam, router])
  );

  useFocusEffect(
    useCallback(() => {
      load();
      refreshNews();
      // Compteurs (publications, abonnés) à jour à chaque retour sur l'écran.
      refreshProfile().catch(() => {});
    }, [load, refreshNews, refreshProfile])
  );

  // Lot 2 (Vault) : une pièce ajoutée ou modifiée après le retour sur le
  // profil (feuille quittée pendant l'envoi) : le Vault se relit. Profil
  // caché, rien : il se relira en reprenant la main (ci-dessus).
  useEffect(
    () =>
      onVaultChanged(() => {
        if (navigation.isFocused()) load();
      }),
    [load, navigation]
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([load(), refreshProfile()]);
    setRefreshing(false);
  }

  async function handleLoadMoreVault() {
    if (!vaultNextCursor || vaultLoadingMore || refreshing) return;
    setVaultLoadingMore(true);
    try {
      const page = await fetchVault(vaultNextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setVaultNextCursor(page.nextCursor);
    } catch {
      // silencieux : re-scroller vers le bas redéclenche onEndReached
    } finally {
      setVaultLoadingMore(false);
    }
  }

  // Épingles (migration 0049) : ses photos épinglées en tête, avec une marque.
  const lifestyleGrid = pinnedFirst(lifestylePosts);
  const isEmptyVault = segment === "vault" && !vaultError && items.length === 0;
  const isEmptyLifestyle = segment === "lifestyle" && !lifestyleError && lifestylePosts.length === 0;

  // Lot 2 (Vault) : ajout d'une pièce à la main. Au retour, le Vault se relit
  // (useFocusEffect ci-dessus) : la nouvelle pièce apparaît en tête.
  function openAddPiece() {
    router.push("/vault-item/new");
  }

  // Retours du build 2 (« ça prend beaucoup trop de place ») : la photo, les
  // compteurs et la rangée Vault · Lifestyle · Envies défilent avec le contenu
  // de chaque onglet, comme sur les réseaux sociaux ; seule la barre du haut
  // (@pseudo, réglages) reste fixe. En tête de chaque liste (`inset` : la
  // liste a ses propres marges, que l'en-tête annule pour garder toute la
  // largeur). Aucun champ de saisie ici : recréé à chaque affichage, sans risque.
  const profileHeader = (inset: boolean) => (
    <View style={inset ? styles.headerInset : styles.headerFull}>
      <View style={styles.head}>
        <Pressable style={styles.avatar} onPress={() => setPhotoOpen(true)} accessibilityRole="button" accessibilityLabel={t.profile.changeAvatar}>
          <Avatar uri={profile?.avatarUrl} userId={profile?.id ?? ""} displayName={profile?.displayName} username={profile?.username} size={72} />
          <View style={styles.avatarBadge}>
            <CameraIcon size={12} tint={color.blanc} strokeWidth={1.6} />
          </View>
        </Pressable>
        <View style={styles.who}>
          <Text style={styles.name} accessibilityRole="header">{profile?.displayName}</Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          {/* Lien en bio (migration 0049) : le même écran d'avertissement que pour les autres. */}
          <ProfileLink url={profile?.linkUrl} align="start" />
          <Pressable
            onPress={() => router.push("/edit-profile")}
            hitSlop={{ top: 4, bottom: 4 }}
            style={styles.editButton}
            accessibilityRole="button"
            accessibilityLabel={t.editProfile.title}
          >
            <Text style={styles.editLabel}>{t.editProfile.title}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.stats}>
        {/* Nombre de pièces du Vault : seulement ici, sur son propre profil
            (décision 5 du Lot Q) ; jamais sur le profil vu par un autre. */}
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{vaultTotal}</Text>
          <Text style={styles.statLabel}>{t.profile.vault}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{profile?.postsCount ?? 0}</Text>
          <Text style={styles.statLabel}>{t.profile.posts}</Text>
        </View>
        {/* Lot « vie sociale » : les deux compteurs ouvrent la liste des abonnés et celle des abonnements. */}
        <Pressable
          style={styles.statItem}
          onPress={() => (profile ? router.push(memberListRoute("followers", profile.id)) : undefined)}
          disabled={!profile}
          accessibilityRole="link"
          accessibilityLabel={t.memberLists.openFollowers(profile?.followersCount ?? 0)}
          testID="ouvrir-abonnes"
        >
          <Text style={styles.statNumber}>{profile?.followersCount ?? 0}</Text>
          <Text style={styles.statLabel}>{t.profile.followers}</Text>
        </Pressable>
        <Pressable
          style={styles.statItem}
          onPress={() => (profile ? router.push(memberListRoute("following", profile.id)) : undefined)}
          disabled={!profile}
          accessibilityRole="link"
          accessibilityLabel={t.memberLists.openFollowing(profile?.followingCount ?? 0)}
          testID="ouvrir-abonnements"
        >
          <Text style={styles.statNumber}>{profile?.followingCount ?? 0}</Text>
          <Text style={styles.statLabel}>{t.profile.followingCount}</Text>
        </Pressable>
      </View>

      <View style={styles.seg}>
        <Pressable
          onPress={() => setSegment("vault")}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === "vault" }}
        >
          <Text style={[styles.segItem, segment === "vault" ? styles.segItemActive : null]}>{t.profile.vault}</Text>
        </Pressable>
        <Pressable
          onPress={() => setSegment("lifestyle")}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === "lifestyle" }}
        >
          <Text style={[styles.segItem, segment === "lifestyle" ? styles.segItemActive : null]}>{t.profile.lifestyle}</Text>
        </Pressable>
        {/* Lot « alertes visibles » : une pastille discrète tant qu'il reste des nouveautés non vues. */}
        <Pressable
          onPress={() => setSegment("wishlist")}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === "wishlist" }}
          accessibilityLabel={news.hasUnseen ? t.wishAlerts.newsTabLabel(t.wishlist.title) : t.wishlist.title}
          style={styles.segWithDot}
        >
          <Text style={[styles.segItem, segment === "wishlist" ? styles.segItemActive : null]}>{t.wishlist.title}</Text>
          {news.hasUnseen ? <View style={styles.segDot} testID="pastille-envies" /> : null}
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Text style={styles.navHandle}>@{profile?.username}</Text>
        <Pressable onPress={() => router.push("/settings")} hitSlop={12} style={styles.navButton} accessibilityRole="button" accessibilityLabel={t.settings.title}>
          <SettingsIcon tint={color.encre} />
        </Pressable>
      </View>

      {loading ? (
        <ScrollView>
          {profileHeader(false)}
          <View style={styles.grid}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.piece}>
                <Skeleton style={styles.vaultThumb} />
                <Skeleton style={{ width: "80%", height: 11, marginTop: space.xs }} />
              </View>
            ))}
          </View>
        </ScrollView>
      ) : segment === "wishlist" ? (
        <WishlistPanel news={news} header={profileHeader(false)} />
      ) : segment === "vault" ? (
        <FlatList
          data={chunk(items, 3)}
          keyExtractor={(row) => row.map((item) => item.id).join("-")}
          contentContainerStyle={vaultError || isEmptyVault ? styles.emptyContent : styles.gridContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((item) => (
                <Pressable accessibilityRole="button"
                  key={item.id}
                  style={styles.piece}
                  onPress={() => router.push({ pathname: "/vault-item/[id]", params: { id: item.id } })}
                >
                  {/* La tuile « Écrin » des grilles (components/piece-tile.tsx) : 4:5, la pièce entière. */}
                  {item.imageUrl ? (
                    <PieceTile variant="grid" size="card" hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} accessibilityLabel={item.title} edgeColor={item.edgeColor} recyclingKey={item.id} />
                  ) : (
                    <View style={styles.vaultThumb}>
                      <ClockIcon size={30} tint={color.encre} />
                    </View>
                  )}
                  {item.verified ? (
                    <View style={styles.verifiedBadge}>
                      <VerifiedIcon size={16} />
                    </View>
                  ) : null}
                  <Text style={styles.pname} numberOfLines={1}>
                    {item.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          ListHeaderComponent={
            <>
              {profileHeader(!(vaultError || isEmptyVault))}
              {vaultError ? <ErrorMessage style={styles.emptyText}>{vaultError}</ErrorMessage> : null}
              {items.length > 0 ? (
                <Pressable
                  onPress={openAddPiece}
                  hitSlop={8}
                  style={styles.addPiece}
                  accessibilityRole="button"
                  accessibilityLabel={t.profile.addPiece}
                >
                  <PlusIcon size={16} tint={color.vert} strokeWidth={1.8} />
                  <Text style={styles.addPieceLabel}>{t.profile.addPiece}</Text>
                </Pressable>
              ) : null}
            </>
          }
          ListEmptyComponent={
            !vaultError ? (
              <View style={[styles.empty, styles.emptyBelowHeader]}>
                <Text style={styles.emptyText}>{t.profile.emptyVault}</Text>
                <Pressable accessibilityRole="button" onPress={openAddPiece} style={styles.emptyButton}>
                  <Text style={styles.emptyButtonLabel}>{t.profile.addPiece}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/(tabs)")}>
                  <Text style={styles.emptyCta}>{t.profile.emptyVaultCta}</Text>
                </Pressable>
              </View>
            ) : null
          }
          onEndReached={handleLoadMoreVault}
          onEndReachedThreshold={0.4}
          ListFooterComponent={vaultLoadingMore ? <ActivityIndicator color={color.encre} style={styles.footerLoader} /> : null}
        />
      ) : (
        <ScrollView
          contentContainerStyle={isEmptyLifestyle || lifestyleError ? styles.emptyContent : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
        >
          {profileHeader(false)}
          {lifestyleError ? (
            <View style={[styles.empty, styles.emptyBelowHeader]}>
              <ErrorMessage style={styles.emptyText}>{lifestyleError}</ErrorMessage>
            </View>
          ) : isEmptyLifestyle ? (
            <View style={[styles.empty, styles.emptyBelowHeader]}>
              <Text style={styles.emptyText}>{t.profile.emptyLifestyle}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push("/post-item/new")}>
                <Text style={styles.emptyCta}>{t.profile.emptyLifestyleCta}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.grid}>
              {lifestyleGrid.posts.map((post) => (
                <Pressable
                  key={post.id}
                  style={styles.piece}
                  onPress={() => router.push({ pathname: "/publication", params: { id: post.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={gridCellLabel(post.caption ?? t.profile.lifestylePhoto, lifestyleGrid.pinnedIds.has(post.id))}
                >
                  <View style={styles.thumb}>
                    {post.mediaUrl === null ? (
                      <ImageUnavailable variant="tile" />
                    ) : (
                      <SpotImage
                        size="small"
                        hdUri={post.mediaUrl}
                        fallbackUri={post.mediaThumbUrl ?? post.mediaUrl}
                        style={styles.thumbImage}
                        fit="cover"
                        recyclingKey={post.id}
                        accessibilityLabel={post.caption ?? t.profile.lifestylePhoto}
                      />
                    )}
                  </View>
                  {post.taggedPieces.length > 0 ? (
                    <View style={styles.tagBadge}>
                      <TagIcon size={12} tint={color.surImage} />
                    </View>
                  ) : null}
                  {/* Plusieurs photos (migration 0047) : une petite marque dans le coin. */}
                  {hasSeveralPhotos(post) ? (
                    <View style={styles.photosMark} accessible accessibilityLabel={t.carousel.morePhotos}>
                      <PhotosIcon size={12} />
                    </View>
                  ) : null}
                  {/* Épinglée (migration 0049) : une punaise dans le coin opposé ;
                      VoiceOver lit « Épinglée » dans le libellé de la case. */}
                  {lifestyleGrid.pinnedIds.has(post.id) ? (
                    <View style={styles.pinMark} testID="marque-epinglee">
                      <PinIcon size={12} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
      <AvatarPhotoFlow open={photoOpen} onClose={() => setPhotoOpen(false)} />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  navHandle: { fontSize: font.body, fontWeight: "600", color: color.encre },
  head: { paddingHorizontal: space.lg, flexDirection: "row", gap: space.lg, alignItems: "center" },
  navButton: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  avatar: { width: 72, height: 72 },
  avatarBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: color.vert,
    borderWidth: 2,
    borderColor: color.porcelaine,
    alignItems: "center",
    justifyContent: "center",
  },
  // Compteurs sur toute la largeur, sous la photo et le nom : quatre
  // colonnes égales (les libellés se chevauchaient à côté de la photo).
  stats: { flexDirection: "row", paddingHorizontal: space.lg, paddingTop: space.md },
  statItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
  statNumber: { fontSize: font.body, fontWeight: "600", color: color.encre },
  statLabel: { fontSize: font.caption, color: color.acier, marginTop: 2 },
  who: { flex: 1 },
  name: { fontSize: font.body, fontWeight: "600", color: color.encre },
  bio: { fontSize: font.secondary, color: color.acier, marginTop: 4, lineHeight: 19 },
  editButton: {
    alignSelf: "flex-start",
    // 36 points + 4 au-dessus et au-dessous (hitSlop) : zone tactile de 44.
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.md,
    marginTop: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
  },
  editLabel: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  seg: { flexDirection: "row", gap: 22, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: color.filet },
  segItem: { fontSize: 14.5, color: color.acier, paddingBottom: 12 },
  segItemActive: { color: color.encre, fontWeight: "600" },
  segWithDot: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  segDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: color.vert, marginTop: 2 },
  grid: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    flexDirection: "row",
    flexWrap: "wrap",
    // 3 colonnes de 31 % : un écart horizontal de 16 points faisait passer
    // la 3ᵉ photo à la ligne sur iPhone (constaté sur les captures).
    columnGap: space.sm,
    rowGap: space.md,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
  gridContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
  gridRow: { flexDirection: "row", gap: space.md, marginBottom: space.md },
  footerLoader: { paddingVertical: space.lg },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -60 },
  // Sous l'en-tête du profil, dans la liste : plus de remontée de 60 points (elle
  // chevaucherait les onglets en grand texte), un peu d'air à la place.
  emptyBelowHeader: { marginTop: 0, paddingVertical: space.xl },
  // L'en-tête du profil en tête d'une liste : même largeur que la grille sur le site.
  headerFull: { width: "100%", maxWidth: 640, alignSelf: "center" },
  // … dans une liste qui a ses marges (Vault) : il les annule, et garde l'écart d'avant sous les onglets.
  headerInset: { marginHorizontal: -space.lg, marginTop: -space.md, marginBottom: space.md },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginBottom: space.md },
  emptyCta: { ...lienSouligne, fontSize: font.body, color: color.vert, fontWeight: "600" },
  // Vault vide : l'ajout à la main en bouton plein, Spotter en lien dessous.
  emptyButton: {
    backgroundColor: color.vert,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    marginBottom: space.md,
  },
  emptyButtonLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  addPiece: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, minHeight: 44, marginBottom: space.xs },
  addPieceLabel: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  piece: { width: "31%" },
  // Grille « Lifestyle » (photos des membres) : carrée, coins des tuiles de grille.
  thumb: {
    backgroundColor: color.plinthe,
    borderRadius: radius.pieceGrid,
    borderCurve: "continuous",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  // Vault sans image (et squelette) : la forme de la tuile, sans photo donc sans bande.
  vaultThumb: { backgroundColor: color.plinthe, borderRadius: radius.pieceGrid, borderCurve: "continuous", aspectRatio: 4 / 5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  verifiedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  photosMark: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: color.voileImage,
    alignItems: "center",
    justifyContent: "center",
  },
  pinMark: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: color.voileImage,
    alignItems: "center",
    justifyContent: "center",
  },
  tagBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: color.voileImage,
    alignItems: "center",
    justifyContent: "center",
  },
  pname: { fontSize: font.caption, color: color.encre, marginTop: space.xs },
}));
