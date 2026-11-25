import { formatLongDate, formatPrice } from "@/lib/format";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, Keyboard, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import type { MatchFeedbackReason, ProductSearch, VaultCategory, VerdictLevel } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { acceptLanguage, getActiveLocale, t } from "@/i18n";
import { closeSpotter } from "@/lib/spot-navigation";
import { addToWishlist, loadSpotResult } from "@/api/client";
import { clearLastSpotResult, getLastSpotResult, rememberLaunchExtras, withLaunchExtras } from "@/api/spotSession";
import type { Piece, SpotFailReason, SpotResult } from "@/api/types";
import { addVaultItemFromMatch, fetchMessagesStatus, fetchShops, fetchWishAlertsStatus } from "@/lib/api";
import { openMerchantLink } from "@/lib/merchant-links";
import { chooseInitialResult, pieceTitle, withoutTextPrompt, withTextSearch, type InitialResultState } from "@/lib/spot-result";
import { afterShops, requestShops, shopsPending } from "@/lib/spot-shops";
import { allPieces, merchantContextFor, merchantMarkFor, opensOfferPage } from "@/lib/result-sections";
import {
  bestProposalIndex,
  bigCardLabel,
  firstAvailableIndex,
  chooseCard,
  clickPlacements,
  hasPrice,
  holdCard,
  NO_CHOICE,
  noPriceAnywhere,
  noPriceNoticeShown,
  startIndexOf,
  wordsArrivalReveal,
  wordsSortNote,
  type BigCardChoice,
  type BigCardLabel,
  type ClickPlacement,
  type StartOptions,
} from "@/lib/price-first";
import { isPriceSort, resultLayout, stockFilterShown, type ResultView } from "@/lib/result-sort";
import { usePreferences } from "@/lib/preferences-context";
import { searchCountryFrom } from "@/lib/foreign-shop";
import { getDraft } from "@/lib/spot-draft";
import { autoTextSearchDue, autoTextSearchWords, claimAutoTextSearch } from "@/lib/auto-text-search";
import { failureCorrections, successCorrections, successSheetActions, type Correction } from "@/lib/spot-corrections";
import { withIds } from "@/lib/owned-marks";
import { capacityMessages } from "@/lib/use-search-limits";
import { VAULT_CATEGORIES } from "@/lib/vault-labels";
import { useToast } from "@/lib/toast-context";
import { messagesStatus } from "@/lib/conversations";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { canSendToFriend, sendToFriend } from "@/lib/send-to-friend";
import { useWishAlertsStatus } from "@/lib/use-wish-alerts-status";
import { canReportResult, wishAlertsStatus, type StockReportTarget } from "@/lib/wish-alerts";
import { Skeleton } from "@/components/skeleton";
import { SpotImage } from "@/components/spot-image";
import { EnlargeableImage } from "@/components/image-viewer";
import { ErrorMessage } from "@/components/error-message";
import { NoPriceNotice } from "@/components/no-price-notice";
import { CorrectionButtons, CorrectionsLink, CorrectionsSheet, useCorrections } from "@/components/spot-corrections";
import { ActionButtons, type Action } from "@/components/spot-launch-views";
import { ReportedLine, ResultFeedbackButton, ResultFeedbackSheet } from "@/components/result-feedback-sheet";
import { ResultComplement, ShopsPending, textSearchStatusNote } from "@/components/result-complement";
import { TextSearchAlreadyUsed, TextSearchPrompt } from "@/components/text-search-prompt";
import { CheapestBadge, ProposalCard } from "@/components/proposal-card";
import { FiltersEmpty, InStockOnlyToggle, ResultSortBar, WithPriceOnlyEmpty } from "@/components/result-sort-bar";
import { PriceSortedList } from "@/components/price-sorted-list";
import { NoPriceSection } from "@/components/no-price-section";
import { YourPiece } from "@/components/your-piece";
import { yourPieceImage } from "@/lib/your-piece";
import { useHeroReveal } from "@/lib/use-hero-reveal";
import { ForeignShopNote } from "@/components/foreign-shop-note";
import { OfferMarkNote } from "@/components/offer-mark";
import { StockNote } from "@/components/stock-note";
import { VerdictLine } from "@/components/verdict-line";
import { verdictToTrack } from "@/lib/verdict";
import { LuxuryResaleEntry } from "@/components/luxury-resale";
import { luxuryResaleToTrack } from "@/lib/luxury-resale";
import { KeptNotice } from "@/components/kept-notice";
import { PurchaseQuestionSheet, type PurchaseQuestionActions } from "@/components/purchase-question-sheet";
import { SendToFriendLink } from "@/components/send-to-friend-link";
import { StockReportLink, StockReportSheet } from "@/components/stock-report-sheet";
import { useAuth } from "@/lib/auth-context";
import { keepAlertAllowed, keptNoticeAlert, turnOffKeepAlert, turnOnKeepAlert, type KeepAlertOrigin, type KeptWish } from "@/lib/keep-alert";
import { addToVaultFromQuestion, noStepFor, type QuestionTarget } from "@/lib/purchase-question";
import { ShopWatchContext, usePurchaseQuestion } from "@/lib/use-purchase-question";
import { vaultChanged } from "@/lib/vault-changes";
import { track } from "@/lib/analytics";
import { openWishlistFromSpotter } from "@/lib/wishlist-link";
import { isAffiliateLink } from "@/lib/affiliate-link";
import { AffiliateMention } from "@/components/affiliate-mention";
import { PieceExtraActions } from "@/components/piece-extra-actions";
import { LookConfirmSheet } from "@/components/look-confirm-sheet";
import { createLook, rememberedLookReused, rememberedLookUrl, rememberLookUrl, shareLookLink, useLookPagesStatus } from "@/lib/look-pages";
import { dayOf, lookShareAllowed } from "@/lib/look-page";
import { ApiError } from "@/lib/api-error";
import { themedStyles } from "@/theme/themed-styles";

function displayPrice(piece: Piece): string {
  if (piece.priceFrom === null) return t.result.priceOnSite;
  return formatPrice(piece.priceFrom, piece.currency, getActiveLocale());
}

/** Libellé de la grande carte (lib/price-first.ts, bigCardLabel). */
function bigCardLabelText(label: BigCardLabel): string {
  if (label === "best") return t.result.bestProposal;
  return label === "bestWithPrice" ? t.result.bestWithPrice : t.result.otherProposal;
}

const OTHERS_SHOWN_FIRST = 11;

type ScreenState = InitialResultState | { kind: "error"; searchId: string };

export default function ResultScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  // matchId : proposition de la vignette touchée dans « Récemment spottées » (lib/recent-searches.ts).
  const { searchId, matchId } = useLocalSearchParams<{ searchId?: string; matchId?: string }>();
  const [state, setState] = useState<ScreenState>(() => chooseInitialResult(getLastSpotResult(), searchId));
  // La copie en mémoire ne sert qu'au passage depuis l'écran Analyse : lue une
  // fois, elle est oubliée (ses mentions propres au lancement sont gardées à
  // part). Tout retour sur cet écran relit donc la recherche sur le serveur.
  const fromLaunch = useRef(state.kind === "ready");
  // Ce que la personne a fait de la grande carte (lib/price-first.ts,
  // BigCardChoice) : aucun geste, elle suit l'ordre « prix d'abord » ; dès
  // qu'elle en touche une ou agit sur la grande carte, celle-ci ne change plus
  // d'elle-même. La ref, tenue à jour avec l'état, sert à handleTextSearchDone,
  // appelé depuis le rendu où « Chercher » a été touché.
  const [choice, setChoice] = useState<BigCardChoice>(NO_CHOICE);
  const choiceRef = useRef<BigCardChoice>(NO_CHOICE);
  const [kept, setKept] = useState<Set<string>>(new Set());
  // Ajout aux Envies confirmé par le serveur : « Ajoutée à vos Envies · Voir mes Envies » (lot « premier essai »).
  const [keptSaved, setKeptSaved] = useState<Set<string>>(new Set());
  // Parcours 3 : par proposition gardée pendant cette visite, son Envie et
  // l'état de son alerte de baisse de prix (lib/keep-alert.ts).
  const [keptWishes, setKeptWishes] = useState<ReadonlyMap<string, KeptWish>>(new Map());
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [categoryOpen, setCategoryOpen] = useState(false);
  // Proposition visée par la feuille ouverte (« Je l'ai achetée », « … ») :
  // celle de la grande carte quand la personne a touché le bouton, quoi qu'il
  // arrive ensuite à l'écran (relecture ORD-1).
  const [categoryTarget, setCategoryTarget] = useState<Piece | null>(null);
  const [reportTarget, setReportTarget] = useState<Piece | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // La page look (lot « page look ») : « Partager le look » quand le serveur
  // le permet, une feuille de confirmation, puis la feuille de partage.
  const lookStatus = useLookPagesStatus();
  const [lookTarget, setLookTarget] = useState<Piece | null>(null);
  const [lookBusy, setLookBusy] = useState(false);
  const [blockedMerchantUrl, setBlockedMerchantUrl] = useState<string | null>(null);
  const [showAllOthers, setShowAllOthers] = useState(false);
  // Section « Sans prix » dépliée : son bouton, ou « Ce n'est pas la bonne pièce ? » (relecture ORD-5).
  const [noPriceOpen, setNoPriceOpen] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  // « Résultat incohérent » : motif changé ou retiré dans cet écran (null : retiré).
  const [reportOpen, setReportOpen] = useState(false);
  const [feedbackOverrides, setFeedbackOverrides] = useState<ReadonlyMap<string, MatchFeedbackReason | null>>(new Map());
  // Voie B (lot c) : seconde recherche avec les mots refusée, sans leurs propositions pour l'instant.
  const [textSearchUsed, setTextSearchUsed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const heroReveal = useHeroReveal(scrollRef);
  // Pour amener l'écran sur une section (relecture E2, ORD-5).
  const noPriceSection = useRef<View>(null);
  const noPriceTop = useRef(0);
  const revealWords = useRef(false);
  // À faire une fois « Ce n'est pas la bonne pièce ? » refermée.
  const afterCorrectionsSheet = useRef<(() => void) | null>(null);
  // « Votre pièce » : l'image du lancement, encore sur l'appareil ; lue une
  // fois (un autre essai préparé ensuite depuis cet écran ne la change pas).
  // Rien pour un résultat rouvert : son image n'est gardée nulle part.
  const [yourPiece] = useState(() => yourPieceImage(fromLaunch.current, getDraft()));
  // Lien vidéo sans prix (lib/auto-text-search.ts, décision du fondateur du
  // 17 novembre 2026) : la description du brouillon, lue une fois ; null pour
  // une photo, une vidéo du téléphone ou un résultat rouvert. « running » :
  // la recherche avec ces mots est partie d'elle-même, l'invitation montre
  // son attente ; « done » : terminée, refusée ou déjà lancée — plus rien ne
  // part de soi-même pour ce résultat.
  const [autoWords] = useState(() => autoTextSearchWords(fromLaunch.current, getDraft()));
  const [autoText, setAutoText] = useState<"idle" | "running" | "done">("idle");
  // Tri et filtre (lib/result-sort.ts) : gardés sur l'appareil, les mêmes à
  // chaque nouvelle recherche. Tri par prix : pas de grande carte, sauf une
  // carte de la liste triée que la personne vient de toucher.
  const { resultView: view, chooseResultView } = usePreferences();
  const priceSort = isPriceSort(view.sort) ? view.sort : null;
  const [pickedInPriceList, setPickedInPriceList] = useState(false);
  // Carte touchée dans la liste triée : l'écran remonte la montrer, une fois affichée.
  const [priceListReveal, setPriceListReveal] = useState(0);
  // Le tri au moment où « Chercher » a été touché ne suffit pas (handleTextSearchDone) : le tri en cours.
  const priceSortRef = useRef(priceSort);
  // « Envoyer à un ami » (lib/send-to-friend.ts) : seulement avec la messagerie du serveur.
  const messages = useMessagesStatus();
  // Lot 2 : « Plus disponible ? » (lib/wish-alerts.ts), seulement avec les alertes du serveur.
  const alerts = useWishAlertsStatus();
  const [stockReport, setStockReport] = useState<StockReportTarget | null>(null);
  const { session } = useAuth();
  // Parcours 3 : « Vous l'avez achetée ? » au retour de la boutique, pour la
  // grande carte et tous les « Voir chez … » des cartes (lib/use-purchase-question.ts) ;
  // jamais pour une pièce déjà au Vault, ni par-dessus une autre feuille.
  const purchase = usePurchaseQuestion({
    userId: session?.user.id ?? null,
    owned: (target) => bought.has(target.matchId),
    sheetOpen: categoryOpen || reportOpen || correctionsOpen || stockReport !== null,
  });
  // Pays de la recherche, pour l'alerte de baisse de prix de « Garder » (lib/keep-alert.ts).
  const keepAlertCountry = searchCountryFrom(acceptLanguage());

  const result = state.kind === "ready" ? state.result : null;
  // Voie C (lot c) : l'indice désigne toutes les propositions de l'écran —
  // recherche visuelle d'abord, puis les sections du complément. Prix
  // d'abord (lib/price-first.ts) : sans choix de la personne, la grande carte
  // est la mieux classée avec un prix, d'abord dans la devise du pays de la
  // recherche (comme « Boutique à l'étranger ») — ou, rouverte depuis
  // « Récemment spottées », la proposition de la vignette ; une pièce déjà
  // gardée ou achetée passe devant.
  const startOptions: StartOptions = { country: searchCountryFrom(acceptLanguage()), matchId: matchId ?? null };
  const bestIndex = result ? bestProposalIndex(result, startOptions.country) : 0;
  const startIndex = result ? startIndexOf(choice, result, startOptions) : 0;
  const selectedIndex = choice.chosen ?? startIndex;
  const piece = result ? (allPieces(result)[selectedIndex] ?? null) : null;
  const lookAllowed = lookShareAllowed(lookStatus, piece, result);
  // Place de chaque proposition pour les statistiques du clic, dans la disposition de l'écran.
  const placements: ReadonlyMap<number, ClickPlacement> = result ? clickPlacements(result, startIndex) : new Map();

  // La grande carte a changé (une autre touchée, ou « vos mots » sans geste) :
  // le lien de secours « navigateur a bloqué » et l'erreur d'une action
  // parlaient de l'ancienne (relecture F7).
  const pieceId = piece?.id ?? null;
  useEffect(() => {
    setBlockedMerchantUrl(null);
    setActionError(null);
  }, [pieceId]);

  // Résultat absent de la mémoire (rouvert depuis « Récemment spottées »,
  // page rechargée) : relu sur le serveur, sans relancer d'identification.
  const pendingSearchId = state.kind === "loading" ? state.searchId : null;
  useEffect(() => {
    if (!pendingSearchId) return;
    let cancelled = false;
    loadSpotResult(pendingSearchId)
      .then((loaded) => !cancelled && setState({ kind: "ready", result: withLaunchExtras(loaded) }))
      .catch(() => !cancelled && setState({ kind: "error", searchId: pendingSearchId }));
    return () => {
      cancelled = true;
    };
  }, [pendingSearchId]);

  // Relu sur le serveur : « Gardée » et « Ajoutée au Vault » sur ce que la
  // personne a déjà rangé (lot « Retrouver ses pièces », lib/owned-marks.ts).
  const owned = result?.owned;
  useEffect(() => {
    if (!owned) return;
    setKept((previous) => withIds(previous, owned.kept));
    setBought((previous) => withIds(previous, owned.bought));
  }, [owned]);

  useEffect(() => {
    if (result?.status === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [result?.status]);

  // Une fois, au premier affichage : la copie du lancement est oubliée.
  useEffect(() => {
    if (!fromLaunch.current || state.kind !== "ready") return;
    rememberLaunchExtras(state.result);
    clearLastSpotResult();
  }, []);

  // Boutiques ensuite (lib/spot-shops.ts) : la ligne « Recherche dans
  // d'autres boutiques… », puis les boutiques ajoutées dessous — ou la ligne
  // retirée, sans message. La demande est celle partie avec la réponse du
  // lancement (ou, résultat relu encore en attente, une nouvelle). La grande
  // carte ne change pas (complement.late, lib/price-first.ts).
  const shopsSearchId = result && shopsPending(result) ? result.searchId : null;
  useEffect(() => {
    if (!shopsSearchId) return;
    let active = true;
    void requestShops(shopsSearchId, (signal) => fetchShops(shopsSearchId, signal)).then((outcome) => {
      if (!active) return;
      setState((current) => (current.kind === "ready" ? { kind: "ready", result: afterShops(current.result, shopsSearchId, outcome) } : current));
    });
    return () => {
      active = false;
    };
  }, [shopsSearchId]);

  // La requête des boutiques arrive après le premier affichage : gardée comme celle du lancement (résultat rouvert).
  const lateQuery = result?.complement?.late ? result.complement.query : null;
  useEffect(() => {
    if (result && lateQuery) rememberLaunchExtras(result);
  }, [lateQuery]);

  // Lien vidéo sans prix : une fois la recherche visuelle et les boutiques
  // connues, aucune proposition avec un prix — la recherche avec la
  // description part d'elle-même (la même que « Chercher »), une seule fois
  // par recherche (claimAutoTextSearch : nouveau rendu, écran rouvert ou
  // second écran ne la relancent pas). Un prix quelque part : rien ne part.
  const autoTextDue = autoWords !== null && autoText === "idle" && autoTextSearchDue(result);
  const autoTextSearchId = autoTextDue ? (result?.searchId ?? null) : null;
  useEffect(() => {
    if (!autoTextSearchId) return;
    setAutoText(claimAutoTextSearch(autoTextSearchId) ? "running" : "done");
  }, [autoTextSearchId]);

  // Le verdict (lot « verdict », lib/verdict.ts) : verdict_shown une fois par
  // résultat affiché, et de nouveau si son niveau change (boutiques arrivées ensuite).
  const verdictTracked = useRef<{ searchId: string | null; level: VerdictLevel } | null>(null);
  const verdictLevel = result?.verdict?.level ?? null;
  const verdictSearchId = result?.searchId ?? null;
  useEffect(() => {
    const next = verdictToTrack(verdictSearchId, result?.verdict, verdictTracked.current);
    if (!next) return;
    verdictTracked.current = next;
    track("verdict_shown", { level: next.level });
  }, [verdictSearchId, verdictLevel]);

  // Seconde main de luxe (lib/luxury-resale.ts) : luxury_resale_shown une fois
  // par résultat affiché qui montre l'entrée, et quand elle apparaît avec les
  // boutiques arrivées ensuite (mémoire par recherche, comme le verdict).
  const luxuryResaleTracked = useRef<string | null | undefined>(undefined);
  const luxuryResaleShown = result?.status === "success" && result.luxuryResale !== undefined;
  useEffect(() => {
    const next = luxuryResaleToTrack(verdictSearchId, luxuryResaleShown ? result?.luxuryResale : undefined, luxuryResaleTracked.current);
    if (!next) return;
    luxuryResaleTracked.current = next.searchId;
    track("luxury_resale_shown", { sites_count: next.sitesCount });
  }, [verdictSearchId, luxuryResaleShown]);

  useScrollToEndOnKeyboard(scrollRef, result?.complement?.suggestText === true);

  // Messagerie pas encore lue (site rechargé sur cet écran) : lue une fois ici.
  // Les alertes aussi (lot 2) : « Plus disponible ? » n'apparaît qu'avec elles.
  useEffect(() => {
    if (!messagesStatus().enabled) fetchMessagesStatus().catch(() => {});
    if (!wishAlertsStatus().available) fetchWishAlertsStatus().catch(() => {});
  }, []);

  useEffect(() => {
    if (priceListReveal > 0) heroReveal.scrollToSection(0);
  }, [priceListReveal]);

  // ---- Corrections (lot 4 ter) : recadrer, autres moments, choisir l'image soi-même ----

  const corrections = useCorrections(result, setActionError);
  // La feuille se referme avant d'ouvrir l'écran suivant (sinon elle resterait par-dessus).
  const fromSheet = (action: Action): Action => ({
    ...action,
    onPress: () => {
      setCorrectionsOpen(false);
      action.onPress();
    },
  });

  // ---- Actions sur une proposition ----

  function updateChoice(change: (current: BigCardChoice) => BigCardChoice) {
    const next = change(choiceRef.current);
    choiceRef.current = next;
    setChoice(next);
  }

  /** Agir sur la grande carte la retient (relecture ORD-1, E1, F1) : elle ne
   * change plus d'elle-même, même si « vos mots » répondent pendant qu'une
   * feuille est ouverte ; la règle annoncée ne vaut que sans aucun geste. */
  function holdPiece() {
    updateChoice((current) => holdCard(current, startIndex));
  }

  async function handleOpenMerchant() {
    const url = piece?.affiliateUrl ?? piece?.merchantUrl;
    if (!piece || !url) return;
    holdPiece();
    setBlockedMerchantUrl(null);
    // Où la personne l'a trouvée : la place notée quand elle l'a touchée, sinon la grande carte d'office.
    const placement = choice.placement ?? placements.get(selectedIndex);
    // Parcours 3 : le retour de la boutique est guetté pour CETTE pièce (« Vous l'avez achetée ? »).
    const outcome = await purchase.watch.open(
      merchantContextFor(piece),
      () => openMerchantLink({ matchId: piece.real ? piece.id : null, url, context: merchantContextFor(piece), placement, mark: merchantMarkFor(piece) }),
      piece
    );
    if (outcome.blocked) setBlockedMerchantUrl(outcome.url ?? url);
  }

  async function handleKeep() {
    if (!piece || kept.has(piece.id)) return;
    holdPiece();
    setActionError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!(await keepPiece(piece, "save"))) setActionError(t.result.keepError);
  }

  /** Garder `piece` : la grande carte (« Garder »), ou la pièce visée par
   * « Vous l'avez achetée ? », sans toucher à la grande carte. Une fois
   * l'Envie créée, son alerte de baisse de prix s'allume si la pièce le
   * permet (Parcours 3, lib/keep-alert.ts : jamais l'interrupteur des
   * Réglages) ; un refus de l'alerte ne défait jamais « Garder », et le
   * message s'affiche ensuite une seule fois (VoiceOver). null : l'Envie n'a
   * pas pu être créée. */
  async function keepPiece(piece: Piece, origin: KeepAlertOrigin): Promise<KeptWish | null> {
    setKept((prev) => new Set(prev).add(piece.id));
    try {
      const wish = await addToWishlist(piece);
      const alert = wish ? await turnOnKeepAlert(wish.id, piece, { country: keepAlertCountry, bought: bought.has(piece.id) }, origin).catch(() => null) : null;
      const saved: KeptWish = { wishId: wish?.id ?? null, alert: alert ? "on" : "none" };
      setKeptWishes((prev) => new Map(prev).set(piece.id, saved));
      setKeptSaved((prev) => new Set(prev).add(piece.id));
      return saved;
    } catch {
      setKept((prev) => {
        const next = new Set(prev);
        next.delete(piece.id);
        return next;
      });
      return null;
    }
  }

  function openCategory() {
    if (!piece) return;
    holdPiece();
    setCategoryTarget(piece);
    setCategoryOpen(true);
  }

  /** La proposition retenue à l'ouverture de la feuille, jamais celle affichée au moment du choix. */
  async function handleBought(category: VaultCategory) {
    setCategoryOpen(false);
    const target = categoryTarget;
    if (!target || bought.has(target.id)) return;
    setActionError(null);
    try {
      const added = await addVaultItemFromMatch({ title: pieceTitle(target.name), imageUrl: target.imageUrl, category, productMatchId: target.id });
      setBought((prev) => new Set(prev).add(target.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Parcours 3 (correction au passage) : déjà là, le serveur le dit ; le Vault est prévenu, comme depuis la fiche d'une Envie.
      showToast(added.alreadyInVault === true ? t.retrouverPieces.alreadyInVault : t.result.boughtToast);
      vaultChanged();
    } catch {
      setActionError(t.result.boughtError);
    }
  }

  /** Parcours 3 : « Activer l'alerte » (question) pour une pièce gardée pendant cette visite. */
  async function turnOnAlertFor(target: Piece): Promise<boolean> {
    const wishId = keptWishes.get(target.id)?.wishId;
    if (!wishId) return false;
    const on = await turnOnKeepAlert(wishId, target, { country: keepAlertCountry, bought: bought.has(target.id) }, "question");
    if (on) setKeptWishes((prev) => new Map(prev).set(target.id, { wishId, alert: "on" }));
    return on !== null;
  }

  /** Parcours 3 : « Couper l'alerte », sous la grande carte ou dans la question. */
  async function turnOffAlertFor(target: Piece): Promise<boolean> {
    const wishId = keptWishes.get(target.id)?.wishId;
    if (!wishId) return false;
    const off = await turnOffKeepAlert(wishId);
    if (off) setKeptWishes((prev) => new Map(prev).set(target.id, { wishId, alert: "off" }));
    return off;
  }

  /** Parcours 3 : ce que « Vous l'avez achetée ? » fait pour la pièce visée —
   * celle de la carte touchée, jamais la grande carte affichée au retour. */
  function questionActionsFor(target: QuestionTarget): PurchaseQuestionActions | null {
    const touched = target.piece;
    if (!touched) return null;
    const keptWish = keptWishes.get(touched.id);
    return {
      addToVault: async (category) => {
        const outcome = await addToVaultFromQuestion({ matchId: touched.id, title: pieceTitle(touched.name), imageUrl: touched.imageUrl }, category, { add: addVaultItemFromMatch, changed: vaultChanged });
        if (outcome.kind === "added") {
          setBought((prev) => new Set(prev).add(touched.id));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        return outcome;
      },
      noStep: () =>
        noStepFor({
          kept: kept.has(touched.id),
          wishKnown: Boolean(keptWish?.wishId),
          alertPossible: keepAlertAllowed(alerts, touched, { country: keepAlertCountry, bought: bought.has(touched.id) }),
          alertOn: keptWish?.alert === "on",
        }),
      keep: async () => {
        const saved = await keepPiece(touched, "question");
        return saved ? saved.alert === "on" : null;
      },
      turnOnAlert: () => turnOnAlertFor(touched),
      turnOffAlert: () => turnOffAlertFor(touched),
    };
  }

  /** « … » et la ligne « Signalé : … » : la feuille vise la grande carte de ce moment. */
  function openReport() {
    if (!piece) return;
    holdPiece();
    setReportTarget(piece);
    setReportOpen(true);
  }

  /** « Envoyer à un ami » depuis la grande carte : sa pièce, retenue comme
   * pour ses autres boutons (elle ne change plus d'elle-même), jamais
   * remplacée ; le choix d'une conversation s'ouvre par-dessus cet écran,
   * qui reste tel quel au retour. */
  function handleSendToFriend() {
    if (!piece || !canSendToFriend(piece, messages)) return;
    holdPiece();
    router.push(sendToFriend(piece, "big_card"));
  }

  async function handleShare() {
    if (!piece) return;
    holdPiece();
    if (lookAllowed) {
      // Même pièce déjà partagée pendant cette visite : le même lien, sans nouvelle feuille.
      const known = rememberedLookUrl(piece.id);
      if (known) await shareLook(piece, known, rememberedLookReused(piece.id));
      else setLookTarget(piece);
      return;
    }
    const url = piece.affiliateUrl ?? piece.merchantUrl ?? "";
    const message = t.result.shareMessage(piece.name, url, isAffiliateLink(piece));
    try {
      if (Platform.OS === "web" && !(typeof navigator !== "undefined" && "share" in navigator)) {
        // Le message entier, pas le lien seul : la mention « lien affilié »
        // doit accompagner le lien partout où il circule.
        await Clipboard.setStringAsync(message);
        showToast(t.result.linkCopied);
        return;
      }
      await Share.share({ message });
    } catch {
      // Partage annulé par l'utilisateur : rien à signaler.
    }
  }

  /** « Créer le lien » : la page (ou celle déjà active pour cette pièce), puis la feuille de partage. */
  async function confirmLook() {
    const target = lookTarget;
    setLookTarget(null);
    if (!target || lookBusy) return;
    setLookBusy(true);
    setActionError(null);
    AccessibilityInfo.announceForAccessibility(t.look.creating);
    try {
      const look = await createLook(target.id);
      rememberLookUrl(target.id, look.url, look.created);
      await shareLook(target, look.url, !look.created);
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { error?: string; reason?: string }) : null;
      setActionError(body?.error === "look_limit" ? t.look.limitReached : body?.reason === "shops_pending" ? t.look.shopsPending : t.look.createError);
    } finally {
      setLookBusy(false);
    }
  }

  async function shareLook(target: Piece, url: string, reused: boolean) {
    const outcome = await shareLookLink(target.name, url, reused, target.id);
    if (outcome === "copied") showToast(t.look.linkCopied);
    // Site : le navigateur a refusé après l'attente de la création ; le lien est gardé, un nouveau toucher le partage.
    else if (outcome === "needs_tap") showToast(t.look.tapToShare);
  }

  /** « Plus disponible ? » de la grande carte : sa pièce, retenue comme pour
   * ses autres boutons ; la confirmation s'ouvre par-dessus l'écran. */
  function handleStockReport() {
    if (!piece || !canReportResult(alerts, piece)) return;
    holdPiece();
    setStockReport({ kind: "match", id: piece.id, title: pieceTitle(piece.name) });
  }

  /** Voie B (lot c) : le résultat est remplacé sur place, dans cet écran
   * seulement. Un retour sur l'écran relit la recherche sur le serveur, qui a
   * l'issue de la recherche par les mots (voir fromLaunch). */
  function replaceResult(next: SpotResult) {
    setState({ kind: "ready", result: next });
  }

  /** Lien vidéo sans prix : la recherche partie d'elle-même a son issue
   * (réponse, refus, « déjà lancée ») — l'invitation n'est plus montrée pour
   * elle (le serveur dit seul s'il la propose encore, suggestText). */
  function endAutoTextSearch() {
    setAutoText((current) => (current === "running" ? "done" : current));
  }

  /** La recherche par les mots a répondu, ou elle est relue avec son issue
   * (après « Annuler », un 409 ou une panne). Appelée depuis le rendu où
   * « Chercher » a été touché : le geste de la personne est lu dans la ref.
   * Sans geste, la grande carte peut changer (règle annoncée) : l'écran
   * remonte la montrer et VoiceOver le dit (relecture E3) ; sinon, il amène
   * « Résultats pour vos mots » en haut s'ils sont arrivés au-dessus de la
   * partie visible, une fois la section placée (relecture E2, onWordsLayout). */
  function handleTextSearchDone(search: ProductSearch) {
    endAutoTextSearch();
    if (!result) return;
    const next = withTextSearch(result, search);
    // Tri par prix : ni section ni grande carte d'office à montrer, les propositions des mots prennent leur place dans la liste triée.
    const reveal = priceSortRef.current ? null : wordsArrivalReveal(result, next, choiceRef.current, startOptions);
    revealWords.current = reveal === "words";
    replaceResult(next);
    if (reveal === "hero") heroReveal.revealHero(allPieces(next)[startIndexOf(choiceRef.current, next, startOptions)]?.name ?? null);
  }

  /** Le serveur ne la propose plus (déjà lancée, coupée, non admissible) :
   * l'invitation disparaît, ici comme au retour sur cet écran. */
  function handleTextSearchClosed(alreadyUsed: boolean) {
    endAutoTextSearch();
    if (!result) return;
    replaceResult(withoutTextPrompt(result));
    setTextSearchUsed(alreadyUsed);
  }

  function selectPiece(index: number) {
    // Elle garde la place où la personne l'a trouvée, pour les statistiques du clic.
    updateChoice((current) => chooseCard(current, index, startIndex, placements.get(index)));
    setBlockedMerchantUrl(null);
    setActionError(null);
    // Comparer sans remonter : la page reste où elle est, sauf si la grande
    // image n'est plus assez visible pour voir le changement.
    heroReveal.revealHero(result ? (allPieces(result)[index]?.name ?? null) : null);
  }

  /** Tri par prix : une carte de la liste triée touchée passe en grand, en
   * haut, avec ses boutons (elle quitte la liste) ; l'écran y remonte. Comme
   * en « Pertinence », elle ne change plus d'elle-même ensuite. */
  function selectFromPriceList(index: number) {
    updateChoice((current) => chooseCard(current, index, startIndex, placements.get(index)));
    setBlockedMerchantUrl(null);
    setActionError(null);
    setPickedInPriceList(true);
    setPriceListReveal((count) => count + 1);
    const name = result ? (allPieces(result)[index]?.name ?? null) : null;
    if (name && Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(t.result.shownAbove(name), { queue: true });
  }

  /** Nouveau tri ou filtre, gardé pour les recherches suivantes. Changer de
   * tri retire la carte touchée dans la liste triée ; la grande carte de
   * « Pertinence », elle, reste celle d'avant (aucun geste n'est perdu). */
  function changeView(next: ResultView) {
    if (next.sort !== view.sort) {
      setPickedInPriceList(false);
      priceSortRef.current = isPriceSort(next.sort) ? next.sort : null;
      revealWords.current = false;
    }
    chooseResultView(next);
  }

  /** « Résultats pour vos mots » vient d'arriver et de prendre sa place : une
   * fois, l'écran l'amène en haut s'il est arrivé au-dessus de la partie
   * visible (section « Sans prix » dépliée) ; sinon il ne bouge pas — la
   * personne a pu toucher une carte pendant l'attente, passée en grand en haut. */
  function onWordsLayout(event: LayoutChangeEvent) {
    const { y, height } = event.nativeEvent.layout;
    if (!revealWords.current || height === 0) return;
    revealWords.current = false;
    heroReveal.revealArrivedSection(y);
  }

  /** La section « Sans prix » en haut de l'écran. Sa place est mesurée au
   * moment du geste : sur le site, onLayout ne suit pas une section qui se
   * déplace sans changer de taille (« Voir plus » au-dessus, vos mots). */
  function scrollToWithoutPrice() {
    const content = (scrollRef.current as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
    const fallback = () => heroReveal.scrollToSection(noPriceTop.current);
    if (!noPriceSection.current || !content) return fallback();
    noPriceSection.current.measureLayout(content, (_x, y) => heroReveal.scrollToSection(y), fallback);
  }

  function announceWithoutPrice(open: boolean, count: number) {
    // En file d'attente : dit après ce que VoiceOver lit déjà, sans le couper.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(open ? t.result.withoutPriceShown(count) : t.result.withoutPriceHidden(count), { queue: true });
  }

  // ---- Rendus ----

  const nav = (
    <View style={styles.nav}>
      <Pressable onPress={() => closeSpotter(router)} hitSlop={12} style={styles.navSide} accessibilityRole="button">
        <Text style={styles.close}>{t.spotter.close}</Text>
      </Pressable>
      <Text style={styles.navTitle}>{t.result.title}</Text>
      <View style={styles.navSide} />
    </View>
  );

  if (state.kind === "loading") {
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <View style={styles.content} accessibilityLabel={t.result.loading}>
          <Skeleton style={styles.hero} />
          <Skeleton style={{ width: "35%", height: 12, marginTop: space.md }} />
          <Skeleton style={{ width: "80%", height: 22, marginTop: space.sm }} />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === "error" || state.kind === "missing") {
    const isError = state.kind === "error";
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <View style={styles.failContent}>
          <Text style={styles.failTitle} accessibilityRole="header">
            {isError ? t.result.loadErrorTitle : t.result.missingTitle}
          </Text>
          <Text style={styles.failTip}>{isError ? t.result.loadErrorTip : t.result.missingTip}</Text>
          <Pressable
            style={styles.primary}
            accessibilityRole="button"
            onPress={() => (state.kind === "error" ? setState({ kind: "loading", searchId: state.searchId }) : closeSpotter(router))}
          >
            <Text style={styles.primaryLabel}>{isError ? t.result.retry : t.result.backToSpotter}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Voie B (lot c) : « Que cherchez-vous ? » quand le serveur le propose —
  // pré-rempli avec les mots tapés sous la photo, si ce résultat vient d'être
  // calculé (le brouillon en mémoire est alors le sien) ; « déjà lancée » à
  // sa place après un refus du serveur. Lien vidéo sans prix : la même
  // invitation, partie d'elle-même avec la description (son attente, puis
  // « Résultats pour vos mots » ; un refus garde le message habituel).
  const autoTextRunning = autoText === "running";
  const textSearch = (withIntro: boolean) =>
    result?.searchId && (result.complement?.suggestText || autoTextRunning) ? (
      <TextSearchPrompt
        searchId={result.searchId}
        initialWords={autoTextRunning ? autoWords : fromLaunch.current ? getDraft()?.words : null}
        onDone={handleTextSearchDone}
        onClosed={handleTextSearchClosed}
        withIntro={withIntro}
        autoStart={autoTextRunning}
      />
    ) : textSearchUsed ? (
      <TextSearchAlreadyUsed />
    ) : null;

  if (!result || result.status === "failed" || !piece) {
    const reason = result?.failReason ?? "no_match";
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <FailureView
          reason={reason}
          textSearch={reason === "no_match" ? textSearch(false) : null}
          textNote={reason === "no_match" ? textSearchStatusNote(result?.complement?.textStatus) : null}
          resumesOn={result?.resumesOn}
          corrections={failureCorrections(reason, corrections.context)}
          actions={corrections.actions}
          onAddVideo={corrections.addVideo}
          importing={corrections.importing}
          onBack={() => closeSpotter(router)}
          error={actionError}
        />
      </SafeAreaView>
    );
  }

  const reportedFor = (p: Piece) => (feedbackOverrides.has(p.id) ? (feedbackOverrides.get(p.id) ?? null) : (p.feedbackReason ?? null));
  const reported = reportedFor(piece);
  // La feuille « … » vise la proposition retenue à son ouverture (relecture ORD-1).
  const reportPiece = reportTarget ?? piece;
  // Prix d'abord (lib/price-first.ts) : « Autres propositions » avec un prix,
  // le complément, puis la section repliée « Sans prix » ; tout comme avant
  // quand rien n'a de prix. Chaque clic garde son rang d'origine.
  // Tri des résultats (lib/result-sort.ts) : en « Pertinence » sans filtre,
  // exactement l'écran d'avant. « Avec prix seulement » : les mêmes sections,
  // sans les propositions sans prix. La ligne des prix et « Le moins cher »
  // portent sur toutes les propositions, boutiques arrivées ensuite
  // comprises : elles changent à leur arrivée, jamais la grande carte.
  const layout = resultLayout(result, view, { selectedIndex, pickedInPriceList, country: startOptions.country });
  const sections = layout.sections;
  const others = sections.others;
  const withoutPriceCount = sections.withoutPrice.length;
  // 11 autres propositions d'emblée (la meilleure + 11 = 12 images à
  // charger), le reste — jusqu'à 40 au total avec la règle des prix — sur demande.
  const visibleOthers = showAllOthers ? others : others.slice(0, OTHERS_SHOWN_FIRST);
  const hiddenCount = others.length - visibleOthers.length;
  // Le message « aucun prix » et le texte du tri suivent la grande carte d'office, pas celle que la personne choisit.
  const noticeShown = noPriceNoticeShown(result, startIndex);
  const wordsNote = wordsSortNote(result, startIndex);
  // « Ce n'est pas la bonne pièce ? » : voir gratuitement les propositions repliées avant toute nouvelle recherche (relecture ORD-5).
  const successList = successCorrections(corrections.context);
  // Trié par prix, pas de section « Sans prix » où descendre : les propositions sans prix sont en fin de liste.
  const sheetActions = successSheetActions(successList, priceSort ? 0 : withoutPriceCount);
  const showBigCard = layout.bigCard !== null;
  const cheapest = layout.cheapest;
  const lowest = layout.summary ? layout.summary.cheapest.piece : null;
  const summaryText =
    layout.summary && lowest && lowest.priceFrom !== null ? t.result.offersSummary(layout.summary.count, formatPrice(lowest.priceFrom, lowest.currency, getActiveLocale())) : null;
  // « Aucun prix » : en « Pertinence », comme avant ; trié par prix, quand rien n'a de prix ; jamais avec « Avec prix seulement ».
  const noPriceNotice = !view.withPriceOnly && (priceSort ? result.pieces.length > 0 && !allPieces(result).some(hasPrice) : noticeShown);

  function toggleWithoutPrice() {
    const open = !noPriceOpen;
    setNoPriceOpen(open);
    if (open) track("no_price_results_opened", { results_count: withoutPriceCount, context: "section" });
    announceWithoutPrice(open, withoutPriceCount);
  }

  /** Depuis « Ce n'est pas la bonne pièce ? » : la feuille se referme, la
   * section s'ouvre et l'écran y descend, une fois la feuille refermée — sur
   * le site, le lien qui l'a ouverte reprend alors le focus, ce qui fait
   * remonter la page jusqu'à lui. Filet si la fermeture n'est pas signalée. */
  function showWithoutPriceFromSheet() {
    afterCorrectionsSheet.current = scrollToWithoutPrice;
    setCorrectionsOpen(false);
    if (!noPriceOpen) {
      setNoPriceOpen(true);
      track("no_price_results_opened", { results_count: withoutPriceCount, context: "not_right" });
    }
    announceWithoutPrice(true, withoutPriceCount);
    setTimeout(runAfterCorrectionsSheet, 700);
  }

  function runAfterCorrectionsSheet() {
    const next = afterCorrectionsSheet.current;
    afterCorrectionsSheet.current = null;
    next?.();
  }

  /** Le lien a repris le focus (site) et la page a fini de remonter : l'écran peut descendre. */
  function onCorrectionsSheetDismissed() {
    setTimeout(runAfterCorrectionsSheet, 80);
  }

  const screen = (
    <SafeAreaView style={styles.screen}>
      {nav}
      {/* Voie B : le champ « Que cherchez-vous ? » est en bas de la liste. */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        onScroll={heroReveal.onScroll}
        scrollEventThrottle={32}
        onLayout={heroReveal.onViewportLayout}
        // Trié par prix : la ligne regardée reste à sa place quand une boutique arrive au-dessus
        // (iPhone ; le navigateur le fait de lui-même). « Pertinence » : inchangé.
        maintainVisibleContentPosition={priceSort && Platform.OS !== "web" ? { minIndexForVisible: 0 } : undefined}
      >
        {/* Le verdict : la phrase de tête, d'après les titres des boutiques ; rien quand le serveur ne sait pas (components/verdict-line.tsx).
            Sa boîte est toujours là, même vide (collapsable={false} : jamais aplatie), en premier : trié par prix sur
            iPhone, la phrase arrivée avec les boutiques grandit vers le bas, visible, au lieu de passer au-dessus de l'écran.
            minHeight 1 : vide, une boîte de hauteur 0 en haut de la liste n'est pas « visible » pour iOS ni Android
            (y + hauteur > défilement), qui prendraient alors la ligne d'après comme repère et cacheraient la phrase. */}
        <View collapsable={false} testID="verdict-place" style={styles.verdictPlace}>
          <VerdictLine verdict={result.verdict} />
        </View>
        {/* Voie C : le décompte, le tri et l'absence de prix parlent de la recherche visuelle seule.
            Prix d'abord : « aucun prix » quand la recherche visuelle n'en a aucun et que la grande carte
            d'office n'en a pas non plus (sinon elles sont toutes repliées en bas, avec le même texte). */}
        {result.pieces.length > 0 ? <Text style={styles.count}>{t.result.count(result.pieces.length, result.query)}</Text> : null}
        {wordsNote && !priceSort ? <Text style={styles.count}>{wordsNote === "words" ? t.result.sortedByWords : t.result.sortedByWordsPriceFirst}</Text> : null}
        {/* Tri des résultats : en haut de la liste, la ligne des prix avec. */}
        <ResultSortBar view={view} onChange={changeView} summary={summaryText} />
        {/* Stock affiché : « En stock seulement », juste sous « Avec prix seulement », quand une offre dit son stock (ou qu'il est déjà choisi). */}
        {stockFilterShown(result, view) ? <InStockOnlyToggle view={view} onChange={changeView} /> : null}
        {layout.emptyWithFilter ? <WithPriceOnlyEmpty onShowAll={() => changeView({ ...view, withPriceOnly: false })} /> : null}
        {/* Stock affiché : « En stock seulement » ne laisse plus rien ; un seul geste retire les deux filtres. */}
        {layout.emptyWithStockFilter ? <FiltersEmpty onShowAll={() => changeView({ ...view, withPriceOnly: false, inStockOnly: false })} /> : null}
        {noPriceNotice ? <NoPriceNotice /> : null}

        {yourPiece ? <YourPiece image={yourPiece} /> : null}
        {/* Tri par prix : pas de grande carte, sauf une carte touchée dans la liste ; « Avec prix seulement » : pas sans prix. */}
        {showBigCard ? (
          <>
            <View style={styles.hero} onLayout={heroReveal.onHeroLayout}>
              <EnlargeableImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} label={piece.name} style={styles.fill}>
                <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} accessibilityLabel={piece.name} />
              </EnlargeableImage>
            </View>

            <Text style={styles.rankLabel}>{bigCardLabelText(bigCardLabel(selectedIndex, bestIndex, firstAvailableIndex(result), allPieces(result)[selectedIndex]))}</Text>
            <Text style={styles.name} accessibilityRole="header">
              {piece.name}
            </Text>
            <Text style={styles.meta}>
              {[piece.merchantName, displayPrice(piece)].filter(Boolean).join(" · ")}
            </Text>
            {selectedIndex === cheapest ? <CheapestBadge /> : null}
            <ForeignShopNote piece={piece} />
            {/* Boutiques douteuses : « Boutique connue » ou « Prix inhabituellement bas » (components/offer-mark.tsx). */}
            <OfferMarkNote piece={piece} />
            {/* Stock affiché : « En stock » ou « Épuisée » d'après Google, au moment de la recherche (components/stock-note.tsx). */}
            <StockNote piece={piece} />
            {/* Juste sous la proposition, visible sans défilement (décision du fondateur, lot 4 ter). */}
            {sheetActions.length > 0 ? <CorrectionsLink style={styles.notRight} onPress={() => setCorrectionsOpen(true)} /> : null}

            {piece.merchantUrl ? (
              <Pressable style={styles.primary} onPress={handleOpenMerchant} accessibilityRole="link">
                <Text style={styles.primaryLabel}>{opensOfferPage(piece) ? t.result.viewOffer : t.result.viewAt(piece.merchantName ?? "")}</Text>
              </Pressable>
            ) : null}
            {blockedMerchantUrl ? (
              <Pressable
                onPress={() => {
                  WebBrowser.openBrowserAsync(blockedMerchantUrl).catch(() => {});
                  setBlockedMerchantUrl(null);
                }}
                accessibilityRole="link"
              >
                <Text style={styles.blockedLink}>{t.result.merchantLinkBlocked}</Text>
              </Pressable>
            ) : null}
            {/* « Lien affilié » seulement pour un vrai lien affilié (lot garde-fous, lib/affiliate-link.ts). */}
            <AffiliateMention isAffiliate={isAffiliateLink(piece)} explain centered />

            <View style={styles.actions}>
              <Pressable style={styles.action} onPress={handleKeep} disabled={kept.has(piece.id)} accessibilityRole="button">
                <Text style={styles.actionLabel}>{kept.has(piece.id) ? t.result.kept : t.result.keep}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={openCategory} disabled={bought.has(piece.id)} accessibilityRole="button">
                <Text style={styles.actionLabel}>{bought.has(piece.id) ? t.result.bought : t.result.markAsBought}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={handleShare} disabled={lookBusy} accessibilityRole="button" accessibilityState={{ busy: lookBusy }}>
                <Text style={styles.actionLabel}>{lookBusy ? t.look.creating : lookAllowed ? t.look.share : t.result.share}</Text>
              </Pressable>
              {piece.real ? <ResultFeedbackButton onPress={openReport} /> : null}
            </View>
            {/* Actions propres au site, rien sur iPhone (components/piece-extra-actions). */}
            <PieceExtraActions
              matchId={piece.real ? piece.id : null}
              imageUrls={[piece.imageHdUrl, piece.imageUrl]}
              buyUrl={piece.affiliateUrl ?? piece.merchantUrl}
              title={piece.name}
              style={styles.extraActions}
            />
            {canSendToFriend(piece, messages) ? <SendToFriendLink style={styles.sendToFriend} pieceName={piece.name} onPress={handleSendToFriend} /> : null}
            {canReportResult(alerts, piece) ? <StockReportLink style={styles.sendToFriend} pieceName={piece.name} onPress={handleStockReport} /> : null}
            {/* Seconde main de luxe : sous « Plus disponible ? », seulement quand le serveur a retenu une seule maison (components/luxury-resale.tsx). */}
            <LuxuryResaleEntry resale={result.luxuryResale} />
            {/* Sans clé (VoiceOver ne relit pas le message à chaque pièce) : « Couper l'alerte » en cours ou en échec reste à sa pièce par `pieceId`. */}
            {keptSaved.has(piece.id) ? (
              <KeptNotice pieceId={piece.id} onOpen={() => openWishlistFromSpotter(router)} alert={keptNoticeAlert(keptWishes.get(piece.id), bought.has(piece.id))} onTurnOff={() => turnOffAlertFor(piece)} />
            ) : null}
            {piece.real && reported ? <ReportedLine reason={reported} onPress={openReport} /> : null}
            {actionError ? <ErrorMessage style={styles.actionError}>{actionError}</ErrorMessage> : null}
          </>
        ) : null}
        {/* Sans grande carte, le lien reste en haut de la liste, visible sans défilement. */}
        {!showBigCard && sheetActions.length > 0 ? <CorrectionsLink style={styles.notRight} onPress={() => setCorrectionsOpen(true)} /> : null}
        {/* Seconde main de luxe, sans grande carte : juste sous « Ce n'est pas la bonne pièce ? ». */}
        {!showBigCard ? <LuxuryResaleEntry style={styles.luxuryResaleTop} resale={result.luxuryResale} /> : null}

        {priceSort ? (
          <>
            {/* Une seule liste triée par prix, sans titre de section ; boutiques en attente : la ligne d'attente, en haut. */}
            {result.complement?.pending ? <ShopsPending /> : null}
            <PriceSortedList key={priceSort} items={layout.priceList ?? []} cheapestIndex={cheapest} onSelect={selectFromPriceList} placements={placements} />
          </>
        ) : (
          <>
            {others.length > 0 ? (
              <>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {t.result.otherProposals}
                </Text>
                <View style={styles.grid}>
                  {/* Cartes (image, nom, boutique, prix, « Voir chez … ») : components/proposal-card.tsx. */}
                  {visibleOthers.map(({ piece: p, index }) => (
                    <ProposalCard key={p.id} piece={p} onSelect={() => selectPiece(index)} placement={placements.get(index)} cheapest={index === cheapest} />
                  ))}
                </View>
                {hiddenCount > 0 ? (
                  <Pressable
                    style={styles.secondary}
                    onPress={() => {
                      setShowAllOthers(true);
                      // price_first : cette section ne montre que des propositions avec prix (analytics-events.ts, relecture F5).
                      track("similar_results_opened", { price_first: !noPriceAnywhere(result) });
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryLabel}>{t.result.showMore(hiddenCount)}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {/* Voie C (lot c) : le complément, sous « Autres propositions » — jamais à leur place. Prix d'abord : la
                grande carte n'en vient que si aucune proposition de la recherche visuelle n'a de prix, et jamais
                quand les boutiques arrivent après l'affichage (boutiques ensuite : la ligne d'attente, à leur place). */}
            {result.complement?.pending ? <ShopsPending /> : null}
            <ResultComplement source="ai" others={sections.shopping} query={result.complement?.query} onSelect={selectPiece} placements={placements} cheapestIndex={cheapest} />
            <View onLayout={onWordsLayout}>
              <ResultComplement
                source="words"
                others={sections.words}
                textStatus={result.complement?.textStatus}
                onSelect={selectPiece}
                placements={placements}
                cheapestIndex={cheapest}
              />
            </View>
            {/* Prix d'abord : les propositions sans prix en dernier, repliées ; « Que cherchez-vous ? » reste tout en bas (clavier). */}
            <View
              ref={noPriceSection}
              onLayout={(event) => {
                noPriceTop.current = event.nativeEvent.layout.y;
              }}
            >
              <NoPriceSection
                pieces={sections.withoutPrice}
                open={noPriceOpen}
                onToggle={toggleWithoutPrice}
                caption={!noticeShown}
                onSelect={selectPiece}
                placements={placements}
              />
            </View>
          </>
        )}
        {textSearch(true)}
      </ScrollView>

      {lookTarget ? (
        <LookConfirmSheet date={formatLongDate(dayOf(result.createdAt) ?? "", getActiveLocale())} onConfirm={confirmLook} onClose={() => setLookTarget(null)} />
      ) : null}

      {reportPiece.real ? (
        <ResultFeedbackSheet
          visible={reportOpen}
          matchId={reportPiece.id}
          current={reportedFor(reportPiece)}
          onClose={() => setReportOpen(false)}
          onChanged={(reason) => setFeedbackOverrides((previous) => new Map(previous).set(reportPiece.id, reason))}
        />
      ) : null}

      {alerts.available ? <StockReportSheet target={stockReport} onClose={() => setStockReport(null)} /> : null}

      <CorrectionsSheet
        visible={correctionsOpen}
        onClose={() => setCorrectionsOpen(false)}
        onDismiss={onCorrectionsSheetDismissed}
        withoutPrice={sheetActions[0] === "show_without_price" ? { label: t.result.showWithoutPrice(withoutPriceCount), onPress: showWithoutPriceFromSheet } : null}
      >
        {successList.length === 1 && successList[0] === "add_video" ? (
          <CorrectionButtons list={successList} actions={corrections.actions} onAddVideo={fromSheet(corrections.actions.add_video).onPress} importing={corrections.importing} />
        ) : (
          <ActionButtons secondary={successList.map((correction) => fromSheet(corrections.actions[correction]))} />
        )}
      </CorrectionsSheet>

      <Modal visible={categoryOpen} transparent animationType="slide" onRequestClose={() => setCategoryOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCategoryOpen(false)} accessibilityRole="button" accessibilityLabel={t.common.close} />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {t.result.categoryTitle}
          </Text>
          {VAULT_CATEGORIES.map((category) => (
            <Pressable key={category} style={styles.sheetRow} onPress={() => handleBought(category)} accessibilityRole="button">
              <Text style={styles.sheetRowLabel}>{t.vaultLabels.categories[category]}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>

      {/* Parcours 3 : « Vous l'avez achetée ? » au retour de la boutique. */}
      <PurchaseQuestionSheet question={purchase.question} actions={purchase.question ? questionActionsFor(purchase.question.target) : null} onClose={purchase.close} />
    </SafeAreaView>
  );
  // Parcours 3 : les « Voir chez … » des cartes (sections, complément, « Sans
  // prix », liste triée) guettent le retour de la boutique par ce contexte
  // (components/proposal-card.tsx, ShopLink).
  return <ShopWatchContext.Provider value={purchase.watch}>{screen}</ShopWatchContext.Provider>;
}

/** Voie B (lot c) : « Que cherchez-vous ? » est en bas de la liste ; au
 * clavier, l'écran y descend, sinon « Chercher » reste caché dessous sur
 * iPhone (même défaut que « Lancer », lancer.tsx). Seul champ de l'écran :
 * rien tant que l'invitation n'est pas affichée. */
function useScrollToEndOnKeyboard(scrollRef: RefObject<ScrollView | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const subscription = Keyboard.addListener("keyboardDidShow", () => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => subscription.remove();
  }, [scrollRef, active]);
}

function FailureView({
  reason,
  textSearch,
  textNote,
  resumesOn,
  corrections,
  actions,
  onAddVideo,
  importing,
  onBack,
  error,
}: {
  reason: SpotFailReason;
  /** Voie B (lot c), « rien trouvé » seulement : « Que cherchez-vous ? »,
   * quand le serveur le propose. */
  textSearch: ReactNode;
  /** Voie B : la recherche par les mots n'a rien donné, ou n'a pas abouti. */
  textNote: string | null;
  /** Plafond du mois atteint (lot 4 quater) : jour de la reprise. */
  resumesOn?: string | null;
  /** Deux au plus, la plus utile d'abord (lib/spot-corrections.ts). */
  corrections: Correction[];
  actions: Record<Correction, Action>;
  onAddVideo: () => void;
  importing: boolean;
  onBack: () => void;
  error: string | null;
}) {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToEndOnKeyboard(scrollRef, Boolean(textSearch));
  const copy = {
    no_match: [t.result.noMatchTitle, t.result.noMatchTip],
    technical: [t.result.technicalTitle, t.result.technicalTip],
    rate_limited: [t.result.rateLimitedTitle, t.result.rateLimitedTip],
    needs_photo: [t.result.previewUnavailableTitle, t.result.previewUnavailableTip],
    // Plafond des recherches (lot 4 quater) : pour le mois, la date de la reprise ;
    // le chiffre de la part et l'heure de reprise quand on les connaît (lot limites annoncées).
    capacity_day: capacityMessages("capacity_day", resumesOn),
    capacity_month: capacityMessages("capacity_month", resumesOn),
    capacity_user: capacityMessages("capacity_user", resumesOn),
    // Part du mois épuisée (lot quotas) : le mois et la date du retour.
    capacity_user_month: capacityMessages("capacity_user_month", resumesOn),
    // Recherche relue encore en cours (lot recherche coupée) : jamais « rien trouvé ».
    running: [t.searchRecovery.runningTitle, t.searchRecovery.runningTip],
    // Fournisseur en panne (disjoncteur, lot garde-fous) : rien n'a été compté.
    paused: [t.result.pausedTitle, t.result.pausedTip],
  }[reason];

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.failContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={styles.failTitle} accessibilityRole="header">
        {copy[0]}
      </Text>
      <Text style={styles.failTip}>{copy[1]}</Text>
      {textNote ? <Text style={styles.failTip}>{textNote}</Text> : null}
      {error ? <ErrorMessage style={styles.actionError}>{error}</ErrorMessage> : null}
      {corrections.length > 0 ? <CorrectionButtons list={corrections} actions={actions} onAddVideo={onAddVideo} importing={importing} /> : null}
      {textSearch}
      <Pressable style={styles.textButton} onPress={onBack} accessibilityRole="button">
        <Text style={styles.textButtonLabel}>{t.result.backToSpotter}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  navTitle: { fontSize: font.caption, color: color.acier },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  count: { fontSize: font.caption, color: color.acier, marginBottom: space.sm },
  verdictPlace: { minHeight: 1 },
  hero: { width: "100%", aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  rankLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600", marginTop: space.md },
  name: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: serifLineHeight.title, marginTop: 4 },
  meta: { fontSize: font.secondary, color: color.acier, marginTop: 4 },
  notRight: { alignItems: "flex-start", marginTop: 0 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.lg },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  textButtonLabel: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
  blockedLink: { ...lienSouligne, textAlign: "center", fontSize: font.caption, color: color.vert, fontWeight: "600", marginTop: 10 },
  actions: { flexDirection: "row", gap: 10, marginTop: space.md },
  action: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  actionLabel: { fontSize: font.caption, color: color.encre, fontWeight: "500", textAlign: "center" },
  actionError: { fontSize: font.caption, marginTop: space.sm },
  extraActions: { marginTop: space.sm },
  sendToFriend: { alignSelf: "center", marginTop: 4 },
  luxuryResaleTop: { alignSelf: "flex-start", marginTop: 0 },
  sectionTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl, marginBottom: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg },
  failContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  failTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: serifLineHeight.title },
  failTip: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.sm },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: space.xl },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.md },
  sheetTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre, marginBottom: space.sm },
  sheetRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.filet },
  sheetRowLabel: { fontSize: font.body, color: color.encre },
}));
