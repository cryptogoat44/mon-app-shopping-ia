import { formatPrice } from "@/lib/format";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, size, space } from "@/theme/tokens";
import { acceptLanguage, getActiveLocale, t } from "@/i18n";
import type { CollectionSummary, WishAlertState } from "@monapp/shared-types";
import { getCollectionWishlist, getWishlist } from "@/api/client";
import type { Piece, WishlistItem } from "@/api/types";
import { ApiError, fetchCollections, fetchWishAlertStates, fetchWishAlertsStatus } from "@/lib/api";
import { useWishAlertsStatus } from "@/lib/use-wish-alerts-status";
import { bellVisible, priceDropPrices, trackPriceDropsShown } from "@/lib/wish-alerts";
import { collectionChips, selectedCollection } from "@/lib/collections";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useAuth } from "@/lib/auth-context";
import { showsWishes } from "@/lib/friend-shelves";
import { useToast } from "@/lib/toast-context";
import { BookmarkIcon, ClockIcon, LockIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { CollectionOptionsSheet } from "@/components/collection-options-sheet";
import { savedListRoute } from "@/lib/saved-posts";
import { CollectionNameSheet } from "@/components/collection-name-sheet";
import { CollectionSettingsSheet } from "@/components/collection-settings-sheet";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { SpotImage } from "@/components/spot-image";
import { SegmentedChoice } from "@/components/segmented-choice";
import { ReceivedPieces } from "@/components/received-pieces";
import { isAffiliateLink } from "@/lib/affiliate-link";
import { searchCountryFrom } from "@/lib/foreign-shop";
import { usePreferences } from "@/lib/preferences-context";
import { appendPage, loadAllPages, WISHLIST_LOAD_MAX, wishlistScope, wishlistTotalText, wishlistView, type WishlistPageOf, type WishlistSort } from "@/lib/wishlist-view";
import { WishlistSearchEmpty, WishlistTools } from "@/components/wishlist-tools";
import { WishAlertBell, WishAlertSheet } from "@/components/wish-alert-sheet";
import { WishAlertNewsBanner } from "@/components/wish-alert-news-banner";
import { bannerItems, trackNewsOpened, trackNewsShown, unseenItems } from "@/lib/wish-alert-news";
import type { WishAlertNewsState } from "@/lib/use-wish-alert-news";
import { themedStyles } from "@/theme/themed-styles";

function displayPrice(item: Piece): string | null {
  if (item.priceFrom === null) return null;
  return formatPrice(item.priceFrom, item.currency, getActiveLocale());
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// Envies (Lot F) : un onglet du Profil (Vault · Lifestyle · Envies), plus
// dans la barre de navigation. Privées : n'apparaissent que sur son propre
// profil, jamais sur le profil vu par quelqu'un d'autre. Lot 5 : « Mes
// envies » ou « Reçues » (les pièces envoyées par d'autres personnes) ; une
// envie ne se partage que par un geste volontaire, depuis son détail.
// Lot collections : « Toutes » puis une puce par collection (cachées sans
// les collections sur le serveur), « Nouvelle collection », et « Gérer » la
// collection choisie (nom, qui la voit, suppression).
// Recherche, tri par prix et total (2026-11-09) : en haut de la liste, sur
// les envies de la puce choisie (lib/wishlist-view.ts, wishlist-tools.tsx).
// Lot 2 (alertes prix et stock) : une cloche sur chaque envie que le serveur
// reconnaît (dans « Toutes » comme dans vos collections), cachée sans les
// alertes sur le serveur ; elle ouvre la feuille de la cloche.
// Lot « alertes visibles » : en tête de la grille, le bandeau des nouveautés
// (`news`, lues par le Profil) ; affichées, elles deviennent « vues » sur
// l'appareil et restent dans le bandeau tant que la grille reste ouverte.
// Retours du build 2 (« ça prend beaucoup trop de place ») : tout le haut des
// Envies défile avec la grille (en tête de la liste : plus rien ne glisse
// sous une ligne fixe), en trois lignes courtes : « Mes envies | Reçues »
// avec le signet des publications enregistrées et le cadenas « Qui voit vos
// Envies » ; les puces, avec « … » pour la collection choisie ; le total,
// la loupe et le tri (wishlist-tools.tsx).
export function WishlistPanel({ news }: { news: WishAlertNewsState }) {
  const [view, setView] = useState<"mine" | "received">("mine");
  const switcher = (
    <SegmentedChoice
      label={t.wishlist.tabsLabel}
      options={[
        { value: "mine", label: t.wishlist.mine },
        { value: "received", label: t.wishlist.received },
      ]}
      value={view}
      onChange={setView}
    />
  );
  return view === "mine" ? (
    <MyWishlist news={news} switcher={switcher} />
  ) : (
    <ScrollView>
      <View style={styles.switcher}>{switcher}</View>
      <ReceivedPieces />
    </ScrollView>
  );
}

function MyWishlist({ news, switcher }: { news: WishAlertNewsState; switcher: ReactNode }) {
  const router = useRouter();
  const { showToast } = useToast();
  // Envies lues pour la puce choisie, dans l'ordre récent, et le curseur de
  // la page suivante (null : toutes sont lues). null : pas encore lues.
  const [list, setList] = useState<WishlistPageOf<WishlistItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  // Numéro de la lecture en cours : une plus récente (autre puce, retour sur
  // l'écran, écran quitté) l'abandonne.
  const loadRun = useRef(0);
  const [query, setQuery] = useState("");
  const { wishlistSort: sort, chooseWishlistSort } = usePreferences();
  const collectionsAvailable = useCollectionsStatus();
  // Étagères des amis : la phrase « Qui voit vos Envies » suit le réglage.
  const { profile } = useAuth();
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<CollectionSummary | null>(null);
  // Retours du build 2 : la feuille « Qui voit vos Envies » (cadenas) et celle de la collection choisie (« … »).
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const selected = selectedCollection(collections, selectedId);
  const chips = collectionChips(collectionsAvailable, collections);
  // Identifiant seul (jamais l'objet, recréé à chaque relecture des puces) : pas de rechargement en boucle.
  const selectedKey = selected?.id ?? null;
  const fetchPage = useCallback((cursor?: string) => (selectedKey ? getCollectionWishlist(selectedKey, cursor) : getWishlist(cursor)), [selectedKey]);
  // Lot 2 : les cloches, par envie (vide sans les alertes sur le serveur).
  const alerts = useWishAlertsStatus();
  const [alertStates, setAlertStates] = useState<ReadonlyMap<string, WishAlertState>>(new Map());
  const [alertTarget, setAlertTarget] = useState<WishlistItem | null>(null);

  // Recherche, tri et total portent sur toutes les envies, pas seulement la
  // première page (lib/wishlist-view.ts, loadAllPages) : elle s'affiche tout
  // de suite, les suivantes sont lues derrière (100 au plus dans une
  // collection, 500 pour « Toutes »). Relecture (retour sur l'écran, tirer
  // pour rafraîchir) : la liste affichée reste en place jusqu'à la fin.
  const load = useCallback(async () => {
    const run = ++loadRun.current;
    const active = () => run === loadRun.current;
    setLoadingAll(true);
    try {
      const all = await loadAllPages(fetchPage, {
        max: WISHLIST_LOAD_MAX,
        active,
        onFirstPage: (page) => setList((current) => current ?? page),
      });
      if (!all) return;
      setList(all);
      setError(null);
    } catch (e) {
      if (!active()) return;
      setList({ items: [], nextCursor: null });
      setError(e instanceof ApiError ? e.message : t.wishlist.loadError);
    } finally {
      if (active()) setLoadingAll(false);
    }
  }, [fetchPage]);

  // Écran quitté (Vault, « Reçues ») : la lecture des pages suivantes s'arrête.
  useEffect(
    () => () => {
      loadRun.current += 1;
    },
    []
  );

  // Les puces : relues à chaque retour sur l'écran (une envie a pu être rangée
  // depuis sa fiche). En échec : pas de puces, les envies restent affichées.
  const loadCollections = useCallback(() => {
    if (!collectionsAvailable.enabled) {
      setCollections(null);
      return;
    }
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections(null));
  }, [collectionsAvailable.enabled]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  useFocusEffect(
    useCallback(() => {
      loadCollections();
    }, [loadCollections])
  );

  // Les cloches : relues à chaque retour sur l'écran (une cloche a pu être
  // réglée depuis la fiche). En échec ou sans les alertes : aucune cloche.
  const loadAlerts = useCallback(() => {
    fetchWishAlertsStatus()
      .then((status) => (status.available ? fetchWishAlertStates() : new Map<string, WishAlertState>()))
      .then(setAlertStates)
      .catch(() => setAlertStates(new Map()));
  }, []);
  useFocusEffect(
    useCallback(() => {
      loadAlerts();
    }, [loadAlerts])
  );

  // Lot « alertes visibles » : les nouveautés déjà affichées pendant cette
  // visite restent dans le bandeau ; « Masquer » le vide.
  const [newsShown, setNewsShown] = useState<ReadonlySet<string>>(new Set());
  const { items: newsItems, seen: newsSeen, markSeen: markNewsSeen } = news;
  const newsBanner = bannerItems(newsItems, newsSeen, newsShown);
  const gridShown = list !== null;
  // Affichées (la grille est là) : vues, sur l'appareil, pour ce compte.
  useEffect(() => {
    if (!gridShown) return;
    const fresh = unseenItems(newsItems, newsSeen).map((item) => item.id);
    if (fresh.length === 0) return;
    setNewsShown((current) => new Set([...current, ...fresh]));
    markNewsSeen(fresh);
    trackNewsShown(fresh.length);
  }, [gridShown, newsItems, newsSeen, markNewsSeen]);

  async function handleRefresh() {
    setRefreshing(true);
    loadCollections();
    loadAlerts();
    news.refresh();
    await load();
    setRefreshing(false);
  }

  // Au-delà de 500 envies, ou après une page en échec : la suite au défilement.
  async function handleLoadMore() {
    const cursor = list?.nextCursor;
    if (!cursor || loadingMore || loadingAll || refreshing) return;
    const run = loadRun.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      if (run !== loadRun.current) return;
      setList((current) => (current ? { items: appendPage(current.items, page.items), nextCursor: page.nextCursor } : current));
    } catch {
      // silencieux : re-scroller vers le bas redéclenche onEndReached
    } finally {
      setLoadingMore(false);
    }
  }

  const loading = list === null;
  const isEmpty = !error && list?.items.length === 0;
  const hasItems = (list?.items.length ?? 0) > 0;
  const inCollection = selectedKey !== null;
  // Ce qui est affiché : la puce choisie, puis la recherche, puis le tri.
  const view = wishlistView(list?.items ?? [], { query, sort, country: searchCountryFrom(acceptLanguage()) });
  const complete = list?.nextCursor === null;
  // Pages suivantes en cours de lecture : le total attend d'avoir tout.
  const readingNext = loadingAll && !complete;
  const totalLine =
    !hasItems || view.visible.length === 0
      ? null
      : readingNext
        ? { text: t.wishlist.totalLoading, label: t.wishlist.totalLoading }
        : wishlistTotalText(view.total, wishlistScope(query, inCollection), getActiveLocale());
  const partialNote = list && hasItems && !complete && !readingNext ? t.wishlist.partialNote(list.items.length) : null;
  // Parcours 3 : « Baisse de prix · 89 € » sous le prix des Envies dont le
  // dernier prix vu passe sous le seuil, même interrupteur « Alertes prix et
  // stock » coupé (lib/wish-alerts.ts) ; lu avec la vignette par VoiceOver.
  const drops = priceDropPrices(view.visible, alertStates, alerts, searchCountryFrom(acceptLanguage()), getActiveLocale());
  const dropLabel = (id: string) => {
    const price = drops.get(id);
    return price ? t.wishAlerts.priceDropAt(price) : null;
  };
  useEffect(() => {
    trackPriceDropsShown(drops.size);
  }, [drops.size]);

  function choose(collectionId: string | null) {
    if (collectionId === selectedId) return;
    loadRun.current += 1;
    setOptionsOpen(false);
    setSelectedId(collectionId);
    setList(null);
    setError(null);
  }

  function changeSort(next: WishlistSort) {
    chooseWishlistSort(next, { inCollection });
  }

  // Tout le haut des Envies, en tête de la liste (il défile avec la grille). JSX
  // en ligne, jamais un composant créé ici : le champ de recherche garderait mal le clavier.
  const header = (
    <>
      <View style={styles.topRow}>
        <View style={styles.topSwitcher}>{switcher}</View>
        <View style={styles.topIcons}>
          {/* Publications enregistrées (migration 0048) : un signet, caché sans elles sur le serveur. */}
          {collectionsAvailable.savedPosts ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => router.push(savedListRoute())}
              accessibilityRole="link"
              accessibilityLabel={t.savedPosts.listTitle}
              testID="entree-enregistrees"
            >
              <BookmarkIcon size={21} tint={color.encre} />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.iconButton}
            onPress={() => setPrivacyOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t.wishlist.privacyTitle}
            testID="qui-voit-vos-envies"
          >
            <LockIcon size={20} tint={color.encre} />
          </Pressable>
        </View>
      </View>
      {chips ? (
        <View style={styles.chipsWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chips}
            accessibilityRole="tablist"
            accessibilityLabel={t.collections.chipsLabel}
          >
            {chips.map((chip) => {
              const active = selectedKey === chip.collectionId;
              return (
                <Pressable
                  key={chip.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => choose(chip.collectionId)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  aria-selected={active}
                  accessibilityLabel={chip.accessibilityLabel}
                >
                  <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]} numberOfLines={1}>
                    {chip.label}
                    {chip.hidden ? ` · ${t.collections.hiddenBadge}` : chip.shared ? ` · ${t.collections.sharedBadge}` : ""}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable style={[styles.chip, styles.chipNew]} onPress={() => setCreating(true)} accessibilityRole="button" testID="puce-nouvelle-collection">
              <PlusIcon size={12} tint={color.vert} />
              <Text style={styles.chipNewLabel}>{t.collections.newCollection}</Text>
            </Pressable>
          </ScrollView>
          {/* La collection choisie : « … », hors de la liste d'onglets (VoiceOver ne le compte pas comme un onglet). */}
          {selected ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => setOptionsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t.collections.ownOptionsLabel(selected.name)}
              testID="options-collection"
            >
              <MoreIcon size={20} tint={color.encre} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <WishAlertNewsBanner
        items={newsBanner}
        onOpen={(item) => {
          trackNewsOpened(item);
          // Ouverte sans « from » : le clic vers la boutique reste compté « wishlist »,
          // jamais « price_alert » (la confidentialité promet que les statistiques ne
          // comptent, pour les nouveautés, que leur nombre et la sorte ouverte).
          router.push({ pathname: "/envie", params: { id: item.wishlistItemId } });
        }}
        onHide={() => setNewsShown(new Set())}
      />
      {error ? <ErrorMessage style={styles.emptyText}>{error}</ErrorMessage> : null}
      {/* Recherche, tri et total : seulement quand il y a des envies à chercher. */}
      {hasItems ? <WishlistTools query={query} onQueryChange={setQuery} sort={sort} onSortChange={changeSort} total={totalLine} note={partialNote} /> : null}
    </>
  );

  return (
    <>
      {/* « Qui voit vos Envies » : la phrase de confidentialité, mot pour mot, derrière le cadenas ;
          celle des amis quand « Montrer mes Envies à mes amis » est allumé (migration 0058). */}
      <Modal visible={privacyOpen} animationType="slide" transparent onRequestClose={() => setPrivacyOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPrivacyOpen(false)} accessibilityRole="button" accessibilityLabel={t.common.close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {t.wishlist.privacyTitle}
          </Text>
          <Text style={styles.sheetBody}>
            {showsWishes(profile) ? t.wishlist.privateNoteFriends : collectionsAvailable.enabled ? t.wishlist.privateNoteCollections : t.wishlist.privateNote}
          </Text>
          <Pressable style={[styles.sheetButton, styles.sheetPrimary]} onPress={() => setPrivacyOpen(false)} accessibilityRole="button" testID="compris-confidentialite">
            <Text style={[styles.sheetButtonLabel, styles.sheetPrimaryLabel]}>{t.wishlist.privacyOk}</Text>
          </Pressable>
        </View>
      </Modal>
      {/* « … » de la collection choisie : qui la voit, ses publications rangées (vous seul les voyez), « Gérer ». */}
      <CollectionOptionsSheet
        collection={selected}
        visible={optionsOpen}
        savedPosts={collectionsAvailable.savedPosts === true}
        onClose={() => setOptionsOpen(false)}
        onPosts={(collection) => router.push(savedListRoute(collection.id))}
        onManage={setManaging}
      />
      <CollectionNameSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(collection) => {
          setCreating(false);
          showToast(t.collections.created);
          setCollections((current) => [...(current ?? []), collection]);
          choose(collection.id);
        }}
      />
      <CollectionSettingsSheet
        collection={managing}
        onClose={() => setManaging(null)}
        onChanged={(updated) => {
          setManaging(updated);
          setCollections((current) => current?.map((collection) => (collection.id === updated.id ? updated : collection)) ?? current);
        }}
        onDeleted={(id) => {
          setManaging(null);
          setCollections((current) => current?.filter((collection) => collection.id !== id) ?? current);
          choose(null);
        }}
      />
      {alerts.available ? (
        <WishAlertSheet
          wish={alertTarget ? { id: alertTarget.id, title: alertTarget.name } : null}
          state={alertTarget ? (alertStates.get(alertTarget.id) ?? null) : null}
          visible={alertTarget !== null}
          onClose={() => setAlertTarget(null)}
          onSaved={(saved) => setAlertStates((current) => new Map(current).set(saved.wishlistItemId, saved))}
        />
      ) : null}
      {/* Une seule liste, chargement compris : le haut (puces, recherche) n'est jamais recréé quand une puce est choisie. */}
      <FlatList
          data={loading ? [] : chunk(view.visible, 3)}
          keyExtractor={(row) => row.map((item) => item.id).join("-")}
          contentContainerStyle={[styles.gridContent, isEmpty || error ? styles.emptyContent : null]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Pressable
                    onPress={() => router.push({ pathname: "/envie", params: { id: item.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={[item.name, dropLabel(item.id)].filter(Boolean).join(", ")}
                  >
                    <View style={styles.thumb}>
                      {item.imageUrl ? (
                        <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.thumbImage} fit="cover" size="card" accessibilityLabel={item.name} />
                      ) : (
                        <ClockIcon size={30} tint={color.encre} />
                      )}
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {displayPrice(item) ? <Text style={styles.price}>{displayPrice(item)}</Text> : null}
                    {dropLabel(item.id) ? <Text style={styles.priceDrop}>{dropLabel(item.id)}</Text> : null}
                  </Pressable>
                  {/* Lot 2 : la cloche, sur le coin de la vignette — zone à part, jamais dans celle qui ouvre la fiche. */}
                  {bellVisible(alerts, alertStates.get(item.id)) ? (
                    <WishAlertBell title={item.name} state={alertStates.get(item.id) ?? null} onPress={() => setAlertTarget(item)} style={styles.bell} />
                  ) : null}
                  {item.merchantUrl ? (
                    <MerchantLinkButton
                      url={item.affiliateUrl ?? item.merchantUrl}
                      merchantName={item.merchantName}
                      matchId={item.productMatchId}
                      context="wishlist"
                      isAffiliate={isAffiliateLink(item)}
                      compact
                      // Vignette étroite : la mention seule ; ce qu'elle signifie se lit sur la fiche de l'envie.
                      explain={false}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loading ? (
              <View style={styles.gridRow}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.card}>
                    <Skeleton style={styles.thumb} />
                    <Skeleton style={{ width: "80%", height: 11 }} />
                  </View>
                ))}
              </View>
            ) : error ? null : hasItems ? (
              // Recherche sans résultat ; pages suivantes encore en lecture : le chargement en bas.
              readingNext ? null : (
                <WishlistSearchEmpty message={t.wishlist.searchEmpty(query.trim(), inCollection)} onClear={() => setQuery("")} />
              )
            ) : selected ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t.collections.empty}</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t.wishlist.empty}</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push("/")}>
                  <Text style={styles.emptyCta}>{t.wishlist.emptyCta}</Text>
                </Pressable>
              </View>
            )
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore || readingNext ? <ActivityIndicator color={color.encre} style={styles.footerLoader} /> : null}
      />
    </>
  );
}

const styles = themedStyles(() => ({
  switcher: { paddingHorizontal: space.lg, paddingTop: space.sm, maxWidth: 640, alignSelf: "center", width: "100%" },
  // Ligne 1 : « Mes envies | Reçues », puis le signet et le cadenas (passe à la ligne en grand texte).
  topRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.xs, paddingBottom: space.xs },
  topSwitcher: { flexShrink: 1 },
  topIcons: { flexDirection: "row", alignItems: "center", marginLeft: "auto" },
  iconButton: { minWidth: size.touchTarget, minHeight: size.touchTarget, alignItems: "center", justifyContent: "center" },
  // Ligne 2 : les puces, d'un bord à l'autre de l'écran (la liste a ses marges), puis « … ».
  chipsWrap: { flexDirection: "row", alignItems: "center", marginHorizontal: -space.lg, paddingRight: space.sm, paddingBottom: space.xs },
  chipsScroll: { flex: 1 },
  chips: { paddingHorizontal: space.lg, gap: space.xs, alignItems: "center", minHeight: size.touchTarget },
  chip: { minHeight: 36, maxWidth: 220, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  chipActive: { backgroundColor: color.vert, borderColor: color.vert },
  chipLabel: { fontSize: font.caption, color: color.encre },
  chipLabelActive: { color: color.blanc, fontWeight: "600" },
  chipNew: { borderStyle: "dashed", borderColor: color.vert },
  chipNewLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.xs },
  sheetTitle: { fontSize: font.body, fontWeight: "600", color: color.encre },
  sheetBody: { fontSize: font.secondary, color: color.acier, lineHeight: 20 },
  sheetButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  sheetPrimary: { backgroundColor: color.vert, borderColor: color.vert, marginTop: space.xs },
  sheetButtonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre, textAlign: "center" },
  sheetPrimaryLabel: { color: color.blanc },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginBottom: space.md },
  emptyCta: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  gridContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
  gridRow: { flexDirection: "row", gap: space.md, marginBottom: space.md },
  card: { width: "31%" },
  bell: { position: "absolute", top: space.xs, right: space.xs },
  thumb: { backgroundColor: color.plinthe, borderRadius: radius.sm, aspectRatio: 1, alignItems: "center", justifyContent: "center", marginBottom: space.xs, overflow: "hidden" },
  thumbImage: { width: "100%", height: "100%" },
  name: { fontSize: font.caption, color: color.encre },
  price: { fontSize: 11, color: color.acier, marginTop: 2 },
  // Parcours 3 : « Baisse de prix · 89 € », en vert (le seul accent).
  priceDrop: { fontSize: 11, color: color.vert, fontWeight: "600", marginTop: 2 },
  footerLoader: { paddingVertical: space.lg },
}));
