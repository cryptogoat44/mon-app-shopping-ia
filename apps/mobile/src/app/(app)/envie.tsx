import { formatPrice } from "@/lib/format";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { PRIVACY_LEVELS, type PrivacyLevel, type WishAlertState, type WishlistItemDetail } from "@monapp/shared-types";
import { ApiError, addVaultItemFromMatch, deleteWishlistItem, fetchWishAlert, fetchWishAlertsStatus, fetchWishlistItem, republishWish } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useWishAlertsStatus } from "@/lib/use-wish-alerts-status";
import { alertDetails, bellButtonText, bellOn, bellVisible, canReportWish, priceDropNow, type StockReportTarget } from "@/lib/wish-alerts";
import { pairStacked } from "@/lib/text-fit";
import { searchCountryFrom } from "@/lib/foreign-shop";
import { keepAlertAllowed, turnOffKeepAlert, turnOnKeepAlert } from "@/lib/keep-alert";
import { addToVaultFromQuestion, noStepFor, targetOfWish } from "@/lib/purchase-question";
import { ShopWatchContext, usePurchaseQuestion } from "@/lib/use-purchase-question";
import { vaultChanged } from "@/lib/vault-changes";
import { FROM_ALERT } from "@/lib/push-state";
import { shareWishOutside } from "@/lib/share-wish";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { acceptLanguage, getActiveLocale, t } from "@/i18n";
import { PrivateAccountNote } from "@/components/private-account-note";
import { ShareIcon } from "@/components/icons";
import { ProductFrame } from "@/components/product-frame";
import type { ZoomState } from "@/components/image-viewer";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { ErrorMessage } from "@/components/error-message";
import { WishBoughtButton } from "@/components/wish-bought-button";
import { PieceExtraActions } from "@/components/piece-extra-actions";
import { AddToCollectionSheet } from "@/components/add-to-collection-sheet";
import { WishAlertButton, WishAlertSheet } from "@/components/wish-alert-sheet";
import { StockReportLink, StockReportSheet } from "@/components/stock-report-sheet";
import { PurchaseQuestionSheet, type PurchaseQuestionActions } from "@/components/purchase-question-sheet";
import { isAffiliateLink } from "@/lib/affiliate-link";
import { themedStyles } from "@/theme/themed-styles";

function displayPrice(item: WishlistItemDetail): string | null {
  if (item.priceMin === null) return null;
  return formatPrice(item.priceMin, item.currency, getActiveLocale());
}

// Détail d'une Envie (Lot Q, bloc 3, UX-04) : l'image entière, « Voir chez
// … » (lien affilié signalé) et « Retirer de mes Envies ». Lot 5 (5.C) :
// partager l'envie, toujours par un geste volontaire — la republier sur son
// profil (confidentialité au choix), l'envoyer à une personne sur Spotto, ou
// la partager hors de l'app (mention « lien affilié » quand c'est le cas).
// Lot « Retrouver ses pièces » : « Voir chez … » devient le bouton principal
// et « Je l'ai achetée » le suit — garder puis acheter quelques jours plus
// tard ; republier passe en bouton secondaire.
// Lot 2 (alertes prix et stock) : la cloche de l'envie et « Plus
// disponible ? », seulement si le serveur a les alertes et reconnaît la
// pièce (`trackable`). Pas de cloche pour une pièce achetée (`bought` du
// serveur, ou `inVault` juste après « Je l'ai achetée ») : aucune alerte ne
// partirait. Ouverte par une alerte (`from=alerte`) : le clic vers la
// boutique est compté « price_alert ». Nouvelle version (0041) : la
// notification ne dit plus ni la pièce, ni la boutique, ni le prix ; la fiche
// montre ce qui a changé, chargé depuis le serveur (la cloche : dernier prix
// vu dans votre pays, et l'état du stock quand il est connu).
export default function WishlistItemScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const { profile, session } = useAuth();
  const [item, setItem] = useState<WishlistItemDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyLevel>(profile?.defaultPrivacy ?? "followers");
  const [republishing, setRepublishing] = useState(false);
  // Lot messages : « Envoyer dans une conversation », si la messagerie est disponible.
  const messages = useMessagesStatus();
  // Lot collections : « Ajouter à une collection », si les collections sont disponibles.
  const collections = useCollectionsStatus();
  const [collectionSheet, setCollectionSheet] = useState(false);
  // Lot 2 : la cloche (null : pas encore lue, ou alertes indisponibles).
  const alerts = useWishAlertsStatus();
  const [alertState, setAlertState] = useState<WishAlertState | null>(null);
  const [alertSheet, setAlertSheet] = useState(false);
  const [stockReport, setStockReport] = useState<StockReportTarget | null>(null);
  // Zoom à deux doigts sur place (retours du build 3) : la page ne défile pas pendant le pincement.
  const [zoomState, setZoomState] = useState<ZoomState>("idle");
  // « Je l'ai achetée » et la cloche l'un sous l'autre dès que l'un des deux ne tient plus sur une ligne dans sa
  // moitié : selon la largeur ET la taille du texte (lot « finitions de l'œil », lib/text-fit.ts).
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const pairStackedNow = pairStacked(windowWidth, fontScale, [t.result.markAsBought, bellButtonText(alertState)]);
  const pairItem = pairStackedNow ? null : styles.pairItem;
  // Parcours 3 : « Vous l'avez achetée ? » au retour de la boutique, depuis le
  // bouton principal d'une Envie qui a sa proposition d'origine
  // (lib/use-purchase-question.ts) ; jamais pour une pièce déjà au Vault
  // (`inVault`, ou cloche « achetée » : la même pièce achetée depuis un autre
  // résultat), ni par-dessus une autre feuille.
  const country = searchCountryFrom(acceptLanguage());
  const purchase = usePurchaseQuestion({
    userId: session?.user.id ?? null,
    screenTarget: item ? targetOfWish(item) : null,
    owned: () => item?.inVault === true || alertState?.bought === true,
    sheetOpen: alertSheet || collectionSheet || stockReport !== null,
  });

  const loadAlert = useCallback(async () => {
    if (!id) return;
    try {
      const status = await fetchWishAlertsStatus();
      setAlertState(status.available ? await fetchWishAlert(id) : null);
    } catch {
      // Sans réponse : ni cloche ni « Plus disponible », l'envie reste affichée.
      setAlertState(null);
    }
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    void loadAlert();
    try {
      setItem(await fetchWishlistItem(id));
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id, loadAlert]);

  // Relu à chaque retour sur l'écran : une publication supprimée depuis son
  // détail rend l'envie de nouveau republiable.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  async function handleRepublish() {
    if (!item) return;
    setRepublishing(true);
    setError(null);
    try {
      const post = await republishWish(item.id, privacy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.wishlistItem.republished);
      setItem((current) => (current ? { ...current, sharedPost: { id: post.id, privacy: post.privacy, createdAt: post.createdAt } } : current));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.wishlistItem.republishError);
    } finally {
      setRepublishing(false);
    }
  }

  async function handleShareOutside() {
    if (!item) return;
    const outcome = await shareWishOutside(item);
    if (outcome === "copied") showToast(t.wishlistItem.linkCopied);
  }

  async function handleRemove() {
    if (!item) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteWishlistItem(item.id);
      showToast(t.wishlistItem.removed);
      goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.wishlistItem.removeError);
      setRemoving(false);
    }
  }

  /** Parcours 3 : ce que « Vous l'avez achetée ? » fait pour cette Envie
   * (gardée, et son Envie connue : « Non » propose seulement de suivre son prix). */
  function questionActions(wish: WishlistItemDetail, matchId: string): PurchaseQuestionActions {
    const piece = { real: true, alertTrackable: alertState?.trackable === true, priceFrom: wish.priceMin, currency: wish.currency };
    const context = { country, bought: wish.inVault === true || alertState?.bought === true };
    return {
      addToVault: async (category) => {
        const outcome = await addToVaultFromQuestion({ matchId, title: wish.title, imageUrl: wish.imageUrl }, category, { add: addVaultItemFromMatch, changed: vaultChanged });
        if (outcome.kind === "added") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setItem((current) => (current ? { ...current, inVault: true } : current));
        }
        return outcome;
      },
      noStep: () => noStepFor({ kept: true, wishKnown: true, alertPossible: keepAlertAllowed(alerts, piece, context), alertOn: bellOn(alertState) }),
      // Déjà gardée : « Garder » n'est jamais proposé ici.
      keep: async () => null,
      turnOnAlert: async () => {
        const saved = await turnOnKeepAlert(wish.id, piece, context, "question");
        if (saved) setAlertState(saved);
        return saved !== null;
      },
      turnOffAlert: async () => {
        const off = await turnOffKeepAlert(wish.id);
        if (off) void loadAlert();
        return off;
      },
    };
  }

  const screen = (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t.wishlistItem.backLabel}>
          <Text style={styles.backLabel}>‹ {t.wishlistItem.back}</Text>
        </Pressable>
        {/* Maquette « Écrin » 6 : le partage en haut à droite, même condition et même geste que « Partager hors de Spotto » (qui reste en bas). */}
        {state === "ready" && item?.merchantUrl ? (
          <Pressable onPress={handleShareOutside} style={styles.navShare} accessibilityRole="button" accessibilityLabel={t.wishlistItem.shareOutside}>
            <View accessible={false}>
              <ShareIcon size={18} tint={color.encre} strokeWidth={1.6} />
            </View>
          </Pressable>
        ) : null}
      </View>

      {state !== "ready" || !item ? (
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? t.wishlistItem.notFound : t.wishlist.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>{t.common.retry}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} scrollEnabled={zoomState !== "zooming"}>
          <ProductFrame hdUri={item.imageHdUrl} fallbackUri={item.imageUrl} edgeColor={item.edgeColor} accessibilityLabel={item.title} fullResolution onZoomStateChange={setZoomState} enlargeable />
          <Text style={styles.title} accessibilityRole="header">{item.title}</Text>
          {(() => {
            const details = alertDetails(alertState, getActiveLocale());
            const meta = <Text style={styles.meta}>{[item.merchantName, displayPrice(item)].filter(Boolean).join(" · ")}</Text>;
            if (!details.lastPrice && !details.stock) return <View style={styles.priceRow}>{meta}</View>;
            // Parcours 3 : « Baisse de prix » au-dessus du dernier prix vu, même interrupteur coupé (lib/wish-alerts.ts).
            const drop = priceDropNow(alerts, alertState, { priceFrom: item.priceMin, currency: item.currency }, { country, inVault: item.inVault === true });
            // Maquette « Écrin » 6 : la boutique et le prix à gauche, le dernier prix vu et le stock à droite, sur la même ligne (rien n'est coupé : la rangée passe à la ligne).
            return (
              <>
                {drop ? (
                  <Text style={styles.priceDrop} testID="baisse-de-prix">
                    {t.wishAlerts.priceDrop}
                  </Text>
                ) : null}
                <View style={styles.priceRow}>
                  {meta}
                  <Text style={styles.alertDetails}>
                    {details.lastPrice ? (
                      // Lot « finitions de l'œil » (maquette 6) : le libellé en gris, la valeur en clair.
                      <Text style={styles.alertDetail} testID="dernier-prix-vu">
                        {lastSeenParts(details.lastPrice).label ? <Text style={styles.alertDetailLabel}>{lastSeenParts(details.lastPrice).label}</Text> : null}
                        {lastSeenParts(details.lastPrice).value}
                      </Text>
                    ) : null}
                    {details.lastPrice && details.stock ? <Text style={styles.alertDetail}>{" · "}</Text> : null}
                    {details.stock ? (
                      <Text style={[styles.alertDetail, alertState?.stock === "sold_out" ? styles.alertSoldOut : null]} testID="etat-du-stock">
                        {details.stock}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              </>
            );
          })()}

          <View style={styles.merchant}>
            {item.merchantUrl ? (
              <MerchantLinkButton
                url={item.affiliateUrl ?? item.merchantUrl}
                merchantName={item.merchantName}
                matchId={item.productMatchId}
                context={from === FROM_ALERT ? "price_alert" : "wishlist"}
                isAffiliate={isAffiliateLink(item)}
                primary
                externalIcon
              />
            ) : null}
            {/* Actions propres au site, rien sur iPhone (components/piece-extra-actions). */}
            <PieceExtraActions
              matchId={item.productMatchId}
              imageUrls={[item.imageHdUrl, item.imageUrl]}
              buyUrl={item.affiliateUrl ?? item.merchantUrl}
              title={item.title}
              style={styles.extraActions}
            />
          </View>

          {/* Maquette « Écrin » 6 : « Je l'ai achetée » et la cloche côte à côte (l'un sous l'autre en grand texte) ; seul, un bouton prend
              toute la largeur. Lot 2 : la cloche, jamais pour une pièce achetée (aucune alerte ne partirait). */}
          {item.productMatchId || bellVisible(alerts, alertState, item.inVault) ? (
            <View style={[styles.pairRow, { flexDirection: pairStackedNow ? "column" : "row" }]}>
              {item.productMatchId ? (
                // Sa feuille de catégorie et son message d'erreur restent sous le bouton.
                <View style={pairItem}>
                  <WishBoughtButton item={item} style={styles.pairButton} onAdded={() => setItem((current) => (current ? { ...current, inVault: true } : current))} />
                </View>
              ) : null}
              {/* Dans sa propre vue, comme « Je l'ai achetée » : la marge intérieure du bouton ne compte pas dans le partage (site). */}
              {bellVisible(alerts, alertState, item.inVault) ? (
                <View style={pairItem}>
                  <WishAlertButton title={item.title} state={alertState} onPress={() => setAlertSheet(true)} style={styles.pairButton} />
                </View>
              ) : null}
            </View>
          ) : null}
          {/* « Plus disponible ? » (discret), centré juste sous la rangée, pour une pièce reconnue ; jamais sous « Plus ». */}
          <View style={styles.alerts}>
            {canReportWish(alerts, alertState) ? (
              <StockReportLink pieceName={item.title} onPress={() => setStockReport({ kind: "wish", id: item.id, title: item.title })} style={styles.stockReport} />
            ) : null}
          </View>

          {collections.enabled ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.secondaryButton, styles.collectionButton]}
              onPress={() => setCollectionSheet(true)}
              testID="ajouter-a-une-collection"
            >
              <Text style={styles.secondaryLabel}>{t.collections.addToCollection}</Text>
            </Pressable>
          ) : null}

          <View style={styles.shareSection}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t.wishlistItem.shareTitle}</Text>
            <Text style={styles.hint}>{t.wishlistItem.shareHint}</Text>

            {item.sharedPost ? (
              // Déjà sur le profil : l'état réel, jamais un choix reproposé.
              <View style={styles.sharedBox}>
                <Text style={styles.sharedTitle}>{t.wishlistItem.sharedState(t.vaultLabels.privacy[item.sharedPost.privacy])}</Text>
                <Pressable
                  onPress={() => router.push({ pathname: "/publication", params: { id: item.sharedPost!.id } })}
                  hitSlop={8}
                  accessibilityRole="link"
                >
                  <Text style={styles.sharedLink}>{t.wishlistItem.viewPost}</Text>
                </Pressable>
                <Text style={styles.hint}>{t.wishlistItem.shareAgainHint}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>{t.wishlistItem.republishVisibility}</Text>
                <View style={styles.pillRow} accessibilityRole="radiogroup" accessibilityLabel={t.wishlistItem.republishVisibility}>
                  {PRIVACY_LEVELS.map((level) => (
                    <Pressable
                      key={level}
                      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                      style={[styles.privacyPill, privacy === level ? styles.privacyPillActive : null]}
                      onPress={() => setPrivacy(level)}
                      disabled={republishing}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: privacy === level }}
                    >
                      <Text style={[styles.privacyLabel, privacy === level ? styles.privacyLabelActive : null]}>{t.vaultLabels.privacy[level]}</Text>
                    </Pressable>
                  ))}
                </View>
                {/* Compte privé : « Public » ne veut alors dire que « mes abonnés ». */}
                <PrivateAccountNote />
                <Pressable
                  accessibilityRole="button"
                  style={[styles.secondaryButton, styles.republishButton]}
                  onPress={handleRepublish}
                  disabled={republishing}
                  accessibilityState={{ disabled: republishing, busy: republishing }}
                >
                  <Text style={[styles.secondaryLabel, republishing ? styles.labelBusy : null]}>
                    {republishing ? t.wishlistItem.republishing : t.wishlistItem.republish}
                  </Text>
                </Pressable>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => router.push({ pathname: "/envoyer-envie", params: { id: item.id } })}
            >
              <Text style={styles.secondaryLabel}>{t.wishlistItem.sendToSomeone}</Text>
            </Pressable>
            {messages.enabled ? (
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={() => router.push({ pathname: "/choisir-conversation", params: { wishId: item.id } })}
                testID="envoyer-dans-conversation"
              >
                <Text style={styles.secondaryLabel}>{t.messages.sendToConversation}</Text>
              </Pressable>
            ) : null}
            {item.merchantUrl ? (
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleShareOutside}>
                <Text style={styles.secondaryLabel}>{t.wishlistItem.shareOutside}</Text>
              </Pressable>
            ) : null}
          </View>

          {error ? <ErrorMessage style={styles.message}>{error}</ErrorMessage> : null}
          {!confirming ? (
            <Pressable onPress={() => setConfirming(true)} hitSlop={12} style={styles.removeRow} accessibilityRole="button">
              <Text style={styles.removeLabel}>{t.wishlistItem.remove}</Text>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.confirmText} accessibilityRole="alert">
                {item.sharedPost ? t.wishlistItem.removeConfirmWithPost : t.wishlistItem.removeConfirm}
              </Text>
              <View style={styles.confirmButtons}>
                <Pressable onPress={() => setConfirming(false)} disabled={removing} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>{t.wishlistItem.cancel}</Text>
                </Pressable>
                <Pressable onPress={handleRemove} disabled={removing} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.removeLabel}>{removing ? t.wishlistItem.removing : t.wishlistItem.confirm}</Text>
                </Pressable>
              </View>
            </View>
          )}
          {collections.enabled ? <AddToCollectionSheet wishId={item.id} visible={collectionSheet} onClose={() => setCollectionSheet(false)} /> : null}
          {alerts.available ? (
            <>
              <WishAlertSheet wish={{ id: item.id, title: item.title }} state={alertState} visible={alertSheet} onClose={() => setAlertSheet(false)} onSaved={setAlertState} />
              <StockReportSheet target={stockReport} onClose={() => setStockReport(null)} onReported={() => void loadAlert()} />
            </>
          ) : null}
        </ScrollView>
      )}
      {/* Parcours 3 : « Vous l'avez achetée ? » au retour de la boutique. */}
      <PurchaseQuestionSheet
        question={purchase.question}
        actions={purchase.question && item?.productMatchId ? questionActions(item, item.productMatchId) : null}
        onClose={purchase.close}
      />
    </SafeAreaView>
  );
  // Parcours 3 : le bouton principal (« Voir chez … », components/merchant-link-button.tsx) guette le retour par ce contexte.
  return <ShopWatchContext.Provider value={purchase.watch}>{screen}</ShopWatchContext.Provider>;
}

/** « Dernier prix vu : 240 € » en deux parties : le libellé (le texte de la phrase sans le prix) et la valeur.
 * Phrase d'une autre forme : tout en valeur, comme avant. */
function lastSeenParts(text: string): { label: string | null; value: string } {
  const label = t.wishAlerts.lastSeenPrice("");
  return label && text.startsWith(label) && text.length > label.length ? { label, value: text.slice(label.length) } : { label: null, value: text };
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 8 },
  navBack: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center" },
  backLabel: { fontSize: font.body, fontWeight: "400", color: color.encre },
  navShare: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center", marginBottom: space.sm },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { ...lienSouligne, fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { paddingHorizontal: space.md, paddingTop: 4, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre, marginTop: space.md },
  priceRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: space.sm, marginTop: 4 },
  meta: { fontSize: font.caption, lineHeight: 18, color: color.acier },
  alertDetails: { fontSize: font.caption, lineHeight: 18 },
  alertDetail: { fontSize: font.caption, lineHeight: 18, color: color.encre },
  alertDetailLabel: { color: color.acier },
  alertSoldOut: { fontWeight: "600" },
  // Parcours 3 : « Baisse de prix », en vert (le seul accent).
  priceDrop: { fontSize: font.caption, color: color.vert, fontWeight: "600", marginTop: 4 },
  merchant: { marginTop: space.md, marginBottom: 0 },
  extraActions: { marginTop: space.sm },
  pairRow: { gap: space.sm, marginTop: space.sm },
  // Deux moitiés égales, quelle que soit la longueur des libellés (flexBasis explicite : le site le lit aussi).
  pairItem: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  pairButton: { flexGrow: 1 },
  alerts: { marginBottom: space.md },
  stockReport: { alignSelf: "center", marginTop: 0 },
  shareSection: { borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.lg, marginBottom: space.lg, gap: space.sm },
  sectionTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  hint: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  privacyPill: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: "center" },
  privacyPillActive: { backgroundColor: color.vert, borderColor: color.vert },
  privacyLabel: { fontSize: font.caption, color: color.acier },
  privacyLabelActive: { color: color.blanc, fontWeight: "600" },
  republishButton: { marginTop: space.xs },
  labelBusy: { color: color.acier },
  secondaryButton: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center" },
  collectionButton: { marginBottom: space.lg },
  secondaryLabel: { color: color.vert, fontSize: font.secondary, fontWeight: "600" },
  sharedBox: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: 6 },
  sharedTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  sharedLink: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  removeRow: { alignItems: "center", minHeight: 44, justifyContent: "center" },
  removeLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirm: { backgroundColor: color.plinthe, borderRadius: radius.md, padding: space.md },
  confirmText: { fontSize: font.secondary, color: color.encre, marginBottom: space.sm },
  confirmButtons: { flexDirection: "row", gap: space.lg },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
}));
