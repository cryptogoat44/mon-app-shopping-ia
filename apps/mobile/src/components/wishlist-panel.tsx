import { formatPrice } from "@/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, space } from "@/theme/tokens";
import { acceptLanguage, getActiveLocale, t } from "@/i18n";
import type { CollectionSummary } from "@monapp/shared-types";
import { getCollectionWishlist, getWishlist } from "@/api/client";
import type { Piece, WishlistItem } from "@/api/types";
import { ApiError, fetchCollections } from "@/lib/api";
import { collectionChips, collectionState, selectedCollection } from "@/lib/collections";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useToast } from "@/lib/toast-context";
import { ClockIcon, PlusIcon } from "@/components/icons";
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
export function WishlistPanel() {
  const [view, setView] = useState<"mine" | "received">("mine");
  return (
    <>
      <View style={styles.switcher}>
        <SegmentedChoice
          label={t.wishlist.tabsLabel}
          options={[
            { value: "mine", label: t.wishlist.mine },
            { value: "received", label: t.wishlist.received },
          ]}
          value={view}
          onChange={setView}
        />
      </View>
      {view === "mine" ? (
        <MyWishlist />
      ) : (
        <ScrollView>
          <ReceivedPieces />
        </ScrollView>
      )}
    </>
  );
}

function MyWishlist() {
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
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<CollectionSummary | null>(null);
  const selected = selectedCollection(collections, selectedId);
  const chips = collectionChips(collectionsAvailable, collections);
  // Identifiant seul (jamais l'objet, recréé à chaque relecture des puces) : pas de rechargement en boucle.
  const selectedKey = selected?.id ?? null;
  const fetchPage = useCallback((cursor?: string) => (selectedKey ? getCollectionWishlist(selectedKey, cursor) : getWishlist(cursor)), [selectedKey]);

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

  async function handleRefresh() {
    setRefreshing(true);
    loadCollections();
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

  function choose(collectionId: string | null) {
    if (collectionId === selectedId) return;
    loadRun.current += 1;
    setSelectedId(collectionId);
    setList(null);
    setError(null);
  }

  function changeSort(next: WishlistSort) {
    chooseWishlistSort(next, { inCollection });
  }

  return (
    <>
      <Text style={styles.privateNote}>{collectionsAvailable.enabled ? t.wishlist.privateNoteCollections : t.wishlist.privateNote}</Text>
      {chips ? (
        <View style={styles.chipsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" accessibilityLabel={t.collections.chipsLabel}>
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
          {selected ? (
            <View style={styles.selectedRow}>
              <Text style={styles.selectedState}>{collectionState(selected)}</Text>
              <Pressable onPress={() => setManaging(selected)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.collections.manageLabel(selected.name)} testID="gerer-collection">
                <Text style={styles.manage}>{t.collections.manage}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
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
      {loading ? (
        <View style={styles.grid}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.card}>
              <Skeleton style={styles.thumb} />
              <Skeleton style={{ width: "80%", height: 11 }} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={chunk(view.visible, 3)}
          keyExtractor={(row) => row.map((item) => item.id).join("-")}
          contentContainerStyle={isEmpty || error ? styles.emptyContent : styles.gridContent}
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
                    accessibilityLabel={item.name}
                  >
                    <View style={styles.thumb}>
                      {item.imageUrl ? (
                        <SpotImage hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} style={styles.thumbImage} fit="cover" size="small" accessibilityLabel={item.name} />
                      ) : (
                        <ClockIcon size={30} tint={color.encre} />
                      )}
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {displayPrice(item) ? <Text style={styles.price}>{displayPrice(item)}</Text> : null}
                  </Pressable>
                  {item.merchantUrl ? (
                    <MerchantLinkButton
                      url={item.affiliateUrl ?? item.merchantUrl}
                      merchantName={item.merchantName}
                      matchId={item.productMatchId}
                      context="wishlist"
                      isAffiliate={isAffiliateLink(item)}
                      compact
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}
          ListHeaderComponent={
            <>
              {error ? <ErrorMessage style={styles.emptyText}>{error}</ErrorMessage> : null}
              {/* Recherche, tri et total : seulement quand il y a des envies à chercher. */}
              {hasItems ? <WishlistTools query={query} onQueryChange={setQuery} sort={sort} onSortChange={changeSort} total={totalLine} note={partialNote} /> : null}
            </>
          }
          ListEmptyComponent={
            error ? null : hasItems ? (
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
      )}
    </>
  );
}

const styles = themedStyles(() => ({
  switcher: { paddingHorizontal: space.lg, paddingTop: space.sm, maxWidth: 640, alignSelf: "center", width: "100%" },
  privateNote: { fontSize: font.caption, color: color.acier, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs, maxWidth: 640, alignSelf: "center", width: "100%" },
  chipsWrap: { maxWidth: 640, alignSelf: "center", width: "100%", paddingBottom: space.xs },
  chips: { paddingHorizontal: space.lg, gap: space.xs, alignItems: "center" },
  chip: { minHeight: 36, maxWidth: 220, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  chipActive: { backgroundColor: color.vert, borderColor: color.vert },
  chipLabel: { fontSize: font.caption, color: color.encre },
  chipLabelActive: { color: color.blanc, fontWeight: "600" },
  chipNew: { borderStyle: "dashed", borderColor: color.vert },
  chipNewLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600" },
  selectedRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xs },
  selectedState: { flex: 1, fontSize: font.caption, color: color.acier, lineHeight: 18 },
  manage: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -60 },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginBottom: space.md },
  emptyCta: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  grid: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
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
  thumb: { backgroundColor: color.plinthe, borderRadius: radius.sm, aspectRatio: 1, alignItems: "center", justifyContent: "center", marginBottom: space.xs, overflow: "hidden" },
  thumbImage: { width: "100%", height: "100%" },
  name: { fontSize: font.caption, color: color.encre },
  price: { fontSize: 11, color: color.acier, marginTop: 2 },
  footerLoader: { paddingVertical: space.lg },
}));
