import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import type { VaultCategory } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { addToWishlist, loadSpotResult } from "@/api/client";
import { getLastSpotResult } from "@/api/spotSession";
import type { Piece, SpotFailReason } from "@/api/types";
import { addVaultItemFromMatch } from "@/lib/api";
import { openMerchantLink } from "@/lib/merchant-links";
import { chooseInitialResult, type InitialResultState } from "@/lib/spot-result";
import { getDraft, updateDraft } from "@/lib/spot-draft";
import { beginFromLink, beginFromPhoto } from "@/lib/spot-flow";
import { detectLink } from "@/lib/link-detection";
import { importPhotoForSpotter } from "@/lib/image-import";
import { VAULT_CATEGORIES, VAULT_CATEGORY_LABELS } from "@/lib/vault-labels";
import { useToast } from "@/lib/toast-context";
import { Skeleton } from "@/components/skeleton";
import { SpotImage } from "@/components/spot-image";
import { ErrorMessage } from "@/components/error-message";
import { CameraIcon } from "@/components/icons";

function formatPrice(piece: Piece): string {
  if (piece.priceFrom === null) return fr.result.priceOnSite;
  const currency = piece.currency === "EUR" ? "€" : (piece.currency ?? "");
  return `${piece.priceFrom.toLocaleString("fr-FR")} ${currency}`.trim();
}

type ScreenState = InitialResultState | { kind: "error"; searchId: string };

export default function ResultScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const { searchId } = useLocalSearchParams<{ searchId?: string }>();
  const [state, setState] = useState<ScreenState>(() => chooseInitialResult(getLastSpotResult(), searchId));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockedMerchantUrl, setBlockedMerchantUrl] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const result = state.kind === "ready" ? state.result : null;
  const piece = result?.pieces[selectedIndex] ?? null;

  // Résultat absent de la mémoire (rouvert depuis « Récemment spottées »,
  // page rechargée) : relu sur le serveur, sans relancer d'identification.
  const pendingSearchId = state.kind === "loading" ? state.searchId : null;
  useEffect(() => {
    if (!pendingSearchId) return;
    let cancelled = false;
    loadSpotResult(pendingSearchId)
      .then((loaded) => !cancelled && setState({ kind: "ready", result: loaded }))
      .catch(() => !cancelled && setState({ kind: "error", searchId: pendingSearchId }));
    return () => {
      cancelled = true;
    };
  }, [pendingSearchId]);

  useEffect(() => {
    if (result?.status === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [result?.status]);

  // ---- Reprendre le parcours (recadrer, importer une capture, réessayer) ----

  const draft = getDraft();
  const canReframe = Boolean(draft) || Boolean(result?.sourceUrl);

  async function handleReframe() {
    if (draft) {
      router.replace({ pathname: "/spot/ciblage", params: {} });
      return;
    }
    const detection = result?.sourceUrl ? detectLink(result.sourceUrl) : null;
    if (detection?.kind !== "supported") return;
    try {
      const next = await beginFromLink(detection.url, detection.platform);
      router.replace({ pathname: "/spot/apercu", params: { searchId: next.searchId ?? "" } });
    } catch {
      setActionError(fr.spotter.prepareError);
    }
  }

  async function handleImportCapture() {
    setActionError(null);
    const picked = await importPhotoForSpotter();
    if (picked.kind === "denied") return setActionError(fr.spotter.photoDenied);
    if (picked.kind !== "picked") return;
    const size = { width: picked.width, height: picked.height };
    try {
      if (draft) {
        updateDraft({ localImageUri: picked.uri, imageSize: size, crop: null });
      } else {
        const detection = result?.sourceUrl ? detectLink(result.sourceUrl) : null;
        if (detection?.kind === "supported") {
          await beginFromLink(detection.url, detection.platform);
          updateDraft({ localImageUri: picked.uri, imageSize: size });
        } else {
          await beginFromPhoto(picked.uri, size);
        }
      }
      router.replace({ pathname: "/spot/ciblage", params: {} });
    } catch {
      setActionError(fr.spotter.prepareError);
    }
  }

  function handleRetry() {
    if (draft) router.replace({ pathname: "/spot/analysis", params: {} });
    else handleReframe();
  }

  // ---- Actions sur une proposition ----

  async function handleOpenMerchant() {
    const url = piece?.affiliateUrl ?? piece?.merchantUrl;
    if (!piece || !url) return;
    setBlockedMerchantUrl(null);
    const outcome = await openMerchantLink({ matchId: piece.real ? piece.id : null, url, context: "result" });
    if (outcome.blocked) setBlockedMerchantUrl(outcome.url ?? url);
  }

  async function handleKeep() {
    if (!piece || kept.has(piece.id)) return;
    setActionError(null);
    setKept((prev) => new Set(prev).add(piece.id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await addToWishlist(piece);
    } catch {
      setKept((prev) => {
        const next = new Set(prev);
        next.delete(piece.id);
        return next;
      });
      setActionError(fr.result.keepError);
    }
  }

  async function handleBought(category: VaultCategory) {
    setCategoryOpen(false);
    if (!piece || bought.has(piece.id)) return;
    setActionError(null);
    try {
      await addVaultItemFromMatch({ title: piece.name.slice(0, 120), imageUrl: piece.imageUrl, category, productMatchId: piece.id });
      setBought((prev) => new Set(prev).add(piece.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(fr.result.boughtToast);
    } catch {
      setActionError(fr.result.boughtError);
    }
  }

  async function handleShare() {
    if (!piece) return;
    const url = piece.affiliateUrl ?? piece.merchantUrl ?? "";
    const message = fr.result.shareMessage(piece.name, url);
    try {
      if (Platform.OS === "web" && !(typeof navigator !== "undefined" && "share" in navigator)) {
        await Clipboard.setStringAsync(url);
        showToast(fr.result.linkCopied);
        return;
      }
      await Share.share({ message });
    } catch {
      // Partage annulé par l'utilisateur : rien à signaler.
    }
  }

  function selectPiece(index: number) {
    setSelectedIndex(index);
    setBlockedMerchantUrl(null);
    setActionError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  // ---- Rendus ----

  const nav = (
    <View style={styles.nav}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        hitSlop={12}
        style={styles.navSide}
        accessibilityRole="button"
        accessibilityLabel="Retour"
      >
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <Text style={styles.navTitle}>{fr.result.title}</Text>
      {result?.status === "success" && canReframe ? (
        <Pressable onPress={handleReframe} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.navAction}>{fr.result.reframe}</Text>
        </Pressable>
      ) : (
        <View style={styles.navSide} />
      )}
    </View>
  );

  if (state.kind === "loading") {
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <View style={styles.content} accessibilityLabel={fr.result.loading}>
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
            {isError ? fr.result.loadErrorTitle : fr.result.missingTitle}
          </Text>
          <Text style={styles.failTip}>{isError ? fr.result.loadErrorTip : fr.result.missingTip}</Text>
          <Pressable
            style={styles.primary}
            accessibilityRole="button"
            onPress={() => (state.kind === "error" ? setState({ kind: "loading", searchId: state.searchId }) : router.replace("/"))}
          >
            <Text style={styles.primaryLabel}>{isError ? fr.result.retry : fr.result.backToSpotter}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!result || result.status === "failed" || !piece) {
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <FailureView
          reason={result?.failReason ?? "no_match"}
          canReframe={canReframe}
          onReframe={handleReframe}
          onImportCapture={handleImportCapture}
          onRetry={handleRetry}
          onBack={() => router.replace("/")}
          error={actionError}
        />
      </SafeAreaView>
    );
  }

  const others = result.pieces.map((p, index) => ({ p, index })).filter(({ index }) => index !== selectedIndex);

  return (
    <SafeAreaView style={styles.screen}>
      {nav}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <Text style={styles.count}>{fr.result.count(result.pieces.length, result.query)}</Text>

        <View style={styles.hero}>
          <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} accessibilityLabel={piece.name} />
        </View>

        <Text style={styles.rankLabel}>{selectedIndex === 0 ? fr.result.bestProposal : fr.result.otherProposal}</Text>
        <Text style={styles.name} accessibilityRole="header">
          {piece.name}
        </Text>
        <Text style={styles.meta}>
          {[piece.merchantName, formatPrice(piece)].filter(Boolean).join(" · ")}
        </Text>

        {piece.merchantUrl ? (
          <Pressable style={styles.primary} onPress={handleOpenMerchant} accessibilityRole="link">
            <Text style={styles.primaryLabel}>{fr.result.viewAt(piece.merchantName ?? "")}</Text>
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
            <Text style={styles.blockedLink}>{fr.result.merchantLinkBlocked}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.disclosure}>{fr.result.affiliateDisclosure}</Text>

        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={handleKeep} disabled={kept.has(piece.id)} accessibilityRole="button">
            <Text style={styles.actionLabel}>{kept.has(piece.id) ? fr.result.kept : fr.result.keep}</Text>
          </Pressable>
          <Pressable
            style={styles.action}
            onPress={() => setCategoryOpen(true)}
            disabled={bought.has(piece.id)}
            accessibilityRole="button"
          >
            <Text style={styles.actionLabel}>{bought.has(piece.id) ? fr.result.bought : fr.result.markAsBought}</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={handleShare} accessibilityRole="button">
            <Text style={styles.actionLabel}>{fr.result.share}</Text>
          </Pressable>
        </View>
        {actionError ? <ErrorMessage style={styles.actionError}>{actionError}</ErrorMessage> : null}

        {others.length > 0 ? (
          <>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {fr.result.otherProposals}
            </Text>
            <View style={styles.grid}>
              {others.map(({ p, index }) => (
                <Pressable
                  key={p.id}
                  style={styles.card}
                  onPress={() => selectPiece(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}${p.merchantName ? `, ${p.merchantName}` : ""}`}
                >
                  <View style={styles.cardImage}>
                    <SpotImage hdUri={p.imageHdUrl} fallbackUri={p.imageUrl} style={styles.fill} />
                  </View>
                  <Text style={styles.cardName} numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {[p.merchantName, p.priceFrom !== null ? formatPrice(p) : null].filter(Boolean).join(" · ")}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={categoryOpen} transparent animationType="slide" onRequestClose={() => setCategoryOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCategoryOpen(false)} accessibilityRole="button" accessibilityLabel="Fermer" />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {fr.result.categoryTitle}
          </Text>
          {VAULT_CATEGORIES.map((category) => (
            <Pressable key={category} style={styles.sheetRow} onPress={() => handleBought(category)} accessibilityRole="button">
              <Text style={styles.sheetRowLabel}>{VAULT_CATEGORY_LABELS[category]}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FailureView({
  reason,
  canReframe,
  onReframe,
  onImportCapture,
  onRetry,
  onBack,
  error,
}: {
  reason: SpotFailReason;
  canReframe: boolean;
  onReframe: () => void;
  onImportCapture: () => void;
  onRetry: () => void;
  onBack: () => void;
  error: string | null;
}) {
  const copy = {
    no_match: [fr.result.noMatchTitle, fr.result.noMatchTip],
    technical: [fr.result.technicalTitle, fr.result.technicalTip],
    rate_limited: [fr.result.rateLimitedTitle, fr.result.rateLimitedTip],
    needs_photo: [fr.result.previewUnavailableTitle, fr.result.previewUnavailableTip],
  }[reason];

  // Ordre des actions selon la cause : après « rien trouvé », recadrer
  // d'abord (réessayer à l'identique redonnerait le même résultat) ; après
  // une panne, réessayer d'abord.
  const reframe = canReframe ? { label: fr.result.reframe, onPress: onReframe } : null;
  const capture = { label: fr.result.importCapture, onPress: onImportCapture, icon: true };
  const retry = { label: fr.result.retry, onPress: onRetry };
  const actions =
    reason === "technical"
      ? [retry, reframe]
      : reason === "needs_photo"
        ? [capture]
        : reason === "rate_limited"
          ? []
          : [reframe, capture, retry];
  const [first, ...rest] = actions.filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <View style={styles.failContent}>
      <Text style={styles.failTitle} accessibilityRole="header">
        {copy[0]}
      </Text>
      <Text style={styles.failTip}>{copy[1]}</Text>
      {error ? <ErrorMessage style={styles.actionError}>{error}</ErrorMessage> : null}
      {first ? (
        <Pressable style={styles.primary} onPress={first.onPress} accessibilityRole="button">
          {"icon" in first ? <CameraIcon size={18} tint={color.blanc} /> : null}
          <Text style={styles.primaryLabel}>{first.label}</Text>
        </Pressable>
      ) : null}
      {rest.map((action) => (
        <Pressable key={action.label} style={styles.secondary} onPress={action.onPress} accessibilityRole="button">
          {"icon" in action ? <CameraIcon size={18} tint={color.encre} /> : null}
          <Text style={styles.secondaryLabel}>{action.label}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.textButton} onPress={onBack} accessibilityRole="button">
        <Text style={styles.textButtonLabel}>{fr.result.backToSpotter}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  back: { fontSize: 26, color: color.encre },
  navTitle: { fontSize: font.caption, color: color.acier },
  navAction: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  count: { fontSize: font.caption, color: color.acier, marginBottom: space.sm },
  hero: { width: "100%", aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  rankLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600", marginTop: space.md },
  name: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 28, marginTop: 4 },
  meta: { fontSize: font.secondary, color: color.acier, marginTop: 4 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.lg },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  textButtonLabel: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
  blockedLink: { textAlign: "center", fontSize: font.caption, color: color.vert, fontWeight: "600", marginTop: 10, textDecorationLine: "underline" },
  disclosure: { textAlign: "center", fontSize: 11.5, color: color.acier, marginTop: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: space.md },
  action: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  actionLabel: { fontSize: font.caption, color: color.encre, fontWeight: "500", textAlign: "center" },
  actionError: { fontSize: font.caption, marginTop: space.sm },
  sectionTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl, marginBottom: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg },
  card: { width: "48%" },
  cardImage: { width: "100%", aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  cardName: { fontSize: font.caption, color: color.encre, marginTop: 8, lineHeight: 17 },
  cardMeta: { fontSize: 12, color: color.acier, marginTop: 2 },
  failContent: { flex: 1, justifyContent: "center", paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  failTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29 },
  failTip: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.sm },
  backdrop: { flex: 1, backgroundColor: "rgba(20,19,18,0.35)" },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: space.xl },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.md },
  sheetTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.sm },
  sheetRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.filet },
  sheetRowLabel: { fontSize: font.body, color: color.encre },
});
