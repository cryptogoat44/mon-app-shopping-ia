import { useCallback, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { getRecentSearches } from "@/api/client";
import { clearLastSpotResult } from "@/api/spotSession";
import type { Piece } from "@/api/types";
import { ClockIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { HowItWorksCard } from "@/components/how-it-works";
import { LinkEntry } from "@/components/link-entry";
import { SeeAllRecentLink } from "@/components/recent-searches";
import { ScreenshotHelp } from "@/components/screenshot-help";
import { EntryTiles, LatestVideoCard, LatestVideoNote, LatestVideoQuestion } from "@/components/spot-entry";
import { SpotImage } from "@/components/spot-image";
import { SearchLimitsNotice } from "@/components/search-limits-notice";
import { VisualSearchTip } from "@/components/visual-search-tip";
import { useAuth } from "@/lib/auth-context";
import { importPhotoForSpotter, prepareSharedPhoto, takePhotoForSpotter, type ImportResult } from "@/lib/image-import";
import { latestVideoUri, loadLatestVideo, saveLatestVideoChoice } from "@/lib/latest-video";
import type { LatestVideo, LatestVideoChoice, LatestVideoState } from "@/lib/latest-video-state";
import { RECENT_SEARCHES_LIMIT, reopenParams } from "@/lib/recent-searches";
import { sharedRefusalMessage, type SharedItem } from "@/lib/shared-item";
import { useImageDrop } from "@/lib/image-drop";
import { beginPhotoSearch, type PhotoOrigin } from "@/lib/video-context";
import { adoptSpotVideo, videoImportMessage } from "@/lib/spot-video";
import { useLinkEntry } from "@/lib/use-link-entry";
import { useSharedItemOpener } from "@/lib/use-shared-item";
import { useVideoImport } from "@/lib/use-video-import";
import { discardLocalFile } from "@/lib/video-frames";
import { useSearchLimits } from "@/lib/use-search-limits";
import { themedStyles } from "@/theme/themed-styles";

/** Dernière vidéo de la galerie (app iPhone, en option), relue à chaque retour
 * sur Spotter. L'accès aux photos n'est demandé à iOS qu'après un « oui ». */
function useLatestVideo() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<LatestVideoState>({ kind: "off" });
  const [answer, setAnswer] = useState<"idle" | "saving" | "failed" | "answered">("idle");
  const load = useCallback(async () => {
    try {
      setState(await loadLatestVideo(userId));
    } catch {
      // Galerie ou réponse illisible : le sélecteur reste proposé.
      setState({ kind: "off" });
    }
  }, [userId]);
  // Retour sur Spotter : la note d'après la réponse a été lue.
  const refresh = useCallback(() => {
    setAnswer((current) => (current === "saving" ? current : "idle"));
    return load();
  }, [load]);

  async function choose(choice: LatestVideoChoice) {
    if (!userId) return;
    setAnswer("saving");
    try {
      await saveLatestVideoChoice(userId, choice);
    } catch {
      return setAnswer("failed");
    }
    await load();
    setAnswer("answered");
  }

  // Juste après un « oui » qui ne peut rien montrer : on dit pourquoi.
  const note = answer !== "answered" ? null : state.kind === "no_access" ? t.spotter.latestVideoNoAccess : state.kind === "none" ? t.spotter.latestVideoEmpty : null;
  return { state, refresh, choose: (choice: LatestVideoChoice) => void choose(choice), saving: answer === "saving", failed: answer === "failed", note };
}

function RecentRow({ recent }: { recent: { searchId: string; piece: Piece }[] }) {
  const router = useRouter();
  if (recent.length === 0) return null;
  return (
    <View style={styles.recentSection}>
      <View style={styles.recentHeader}>
        <Text style={styles.recentTitle} accessibilityRole="header">
          {t.spotter.recentlySpotted}
        </Text>
        <SeeAllRecentLink />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
        {recent.map(({ searchId, piece }) => (
          <Pressable
            key={searchId}
            style={styles.recentItem}
            onPress={() => {
              // Rouverte depuis l'historique : toujours relue sur le serveur (gratuit), jamais
              // la copie en mémoire du dernier lancement, qui peut être périmée (voie B lancée
              // ou plus admissible, propositions de vos mots arrivées depuis). La proposition
              // de la vignette s'y affiche en grand (lib/recent-searches.ts).
              clearLastSpotResult();
              router.push({ pathname: "/spot/result", params: reopenParams({ searchId, piece }) });
            }}
            accessibilityRole="button"
            accessibilityLabel={piece.name}
          >
            <View style={styles.recentThumb}>
              {piece.imageUrl ? <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} fit="cover" size="small" /> : <ClockIcon size={26} tint={color.acier} />}
            </View>
            <Text style={styles.recentName} numberOfLines={1}>
              {piece.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Lien TikTok ou Instagram (mission « liens vidéo ») : la question déplie le
 * champ de lien, qui ouvre l'écran « vidéo partagée » (lecteur officiel sur
 * l'app iPhone ; pièces déjà repérées et consigne sur le site). Un lien sans
 * vidéo lisible (Pinterest) montre l'aide « capture d'écran d'abord ». */
function LinkHelp({ onHelp }: { onHelp: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen((value) => !value)} style={styles.linkQuestion} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.linkQuestionLabel}>{t.player.linkQuestion}</Text>
      </Pressable>
      {open ? <LinkEntry onHelp={onHelp} /> : null}
    </>
  );
}

/** Entrées du Spotter : vidéo (sélecteur), photo, dernière vidéo de la galerie,
 * et ce qui arrive par la feuille de partage d'iOS (lot « partager vers Spotto »).
 * `reveal` remonte en haut de l'écran, où s'affichent l'aide et les messages. */
function useSpotterEntries(reveal: () => void) {
  const router = useRouter();
  const openLink = useLinkEntry();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"photo" | "camera" | "latest" | null>(null);
  // Lien partagé qui ne se lit pas : l'aide « capture d'écran d'abord », en haut de l'écran.
  const [linkHelp, setLinkHelp] = useState(false);
  const [query, setQuery] = useState("");
  const { importing, importVideo, importSharedVideo } = useVideoImport(setMessage);
  // Elle ne sert qu'à ce moment-là : refermée quand on quitte Spotter.
  useFocusEffect(useCallback(() => () => setLinkHelp(false), []));

  /** Photo prête, choisie, partagée ou déposée : l'écran « Entourez la pièce ».
   * Un lien de vidéo en attente (10 minutes) lui est associé (lib/video-context.ts). */
  async function openPhoto(picked: ImportResult, unavailable: string, origin: PhotoOrigin, options: { discardImageAfterSearch?: boolean } = {}) {
    if (picked.kind === "unavailable") return setMessage(unavailable);
    if (picked.kind !== "picked") return;
    await beginPhotoSearch(picked, origin, options);
    router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
  }

  const photoOrigin: PhotoOrigin = Platform.OS === "web" ? "web" : "app";

  async function addPhoto() {
    setMessage(null);
    await openPhoto(await importPhotoForSpotter(), t.common.photoUnavailable, photoOrigin);
  }

  // Site : une image glissée-déposée sur la page, ou collée (Ctrl+V / ⌘V).
  useImageDrop(
    useCallback((picked: ImportResult) => {
      setMessage(null);
      void openPhoto(picked, t.common.photoUnavailable, "web");
      // openPhoto ne dépend que de setters stables et du routeur.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
    useCallback(() => setMessage(t.videoLink.notAnImage), [])
  );

  /** « Prendre une photo » (app iPhone, lot « app iPhone prête ») : la même
   * suite qu'une photo choisie ; autorisation refusée : on dit où la donner. */
  async function takePhoto() {
    setMessage(null);
    setBusy("camera");
    try {
      const taken = await takePhotoForSpotter();
      if (taken.kind === "denied") return setMessage(t.cameraCapture.denied);
      await openPhoto(taken, t.cameraCapture.unavailable(t.spotter.addPhoto), "app");
    } finally {
      setBusy(null);
    }
  }

  /** Élément partagé : les mêmes chemins que les boutons de l'écran. */
  async function openShared(item: SharedItem) {
    setMessage(null);
    setLinkHelp(false);
    // Spotter déjà défilé vers le bas : l'aide ou le message serait hors de vue.
    reveal();
    if (item.kind === "refused") return setMessage(sharedRefusalMessage(item.reason));
    if (item.kind === "video") return importSharedVideo(item.uri, item.sizeBytes);
    if (item.kind === "link") {
      const outcome = await openLink(item.text, "share");
      if (outcome.kind === "refused") setMessage(outcome.message);
      if (outcome.kind === "help") {
        setLinkHelp(true);
        // VoiceOver : l'aide apparaît sans rien dire (un message d'erreur, lui, s'annonce).
        if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(t.firstTry.linkHelp.title);
      }
      return;
    }
    setBusy("photo");
    try {
      const prepared = await prepareSharedPhoto(item.uri, item.width, item.height);
      // L'image préparée est un nouveau fichier : la copie reçue n'a plus d'usage.
      discardLocalFile(item.uri);
      // Capture de la recherche d'image d'iOS : jamais gardée après la recherche (règle n° 4).
      const visual = item.origin === "visual_intelligence";
      await openPhoto(prepared, t.share.imageUnreadable(t.spotter.addPhoto), visual ? "visual_intelligence" : "share", { discardImageAfterSearch: visual });
    } finally {
      setBusy(null);
    }
  }

  /** « Lancer » sur la dernière vidéo : elle s'ouvre (téléchargée depuis
   * iCloud si besoin), puis l'analyse démarre aussitôt. */
  async function launchLatest(latest: LatestVideo) {
    setMessage(null);
    setBusy("latest");
    try {
      const result = await adoptSpotVideo(await latestVideoUri(latest.id), null, "latest");
      if (result.kind !== "ready") return setMessage(videoImportMessage(result));
      router.push({ pathname: "/spot/lancer", params: { source: "video", query: query.trim(), auto: "1" } });
      // Recherche partie : au retour, le champ est prêt pour une autre vidéo.
      setQuery("");
    } catch {
      setMessage(t.video.unavailable);
    } finally {
      setBusy(null);
    }
  }

  return {
    message,
    linkHelp,
    showLinkHelp: () => setLinkHelp(true),
    openShared: (item: SharedItem) => void openShared(item),
    query,
    onQuery: (value: string) => {
      setQuery(value);
      setMessage(null);
    },
    busy: importing ? ("video" as const) : busy,
    importing,
    addVideo: () => void importVideo(),
    addPhoto: () => void addPhoto(),
    // L'appareil photo : sur l'app iPhone seulement (le site garde l'import).
    takePhoto: Platform.OS === "ios" ? () => void takePhoto() : undefined,
    launchLatest: (latest: LatestVideo) => void launchLatest(latest),
  };
}

// Spotter (lot 4 ter) : un seul point d'entrée, « Ajouter une vidéo », et la
// photo à égalité ; sur l'app iPhone, en option, la dernière vidéo de la
// galerie — il ne reste qu'à taper quelques mots et « Lancer ».
export default function SpotterScreen() {
  const [recent, setRecent] = useState<{ searchId: string; piece: Piece }[]>([]);
  // Historique relu au moins une fois : « Comment ça marche » ne s'affiche pas avant.
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const entries = useSpotterEntries(() => scroll.current?.scrollTo({ y: 0, animated: true }));
  const latestVideo = useLatestVideo();
  const latest = latestVideo.state.kind === "ready" ? latestVideo.state.video : null;
  // Lot limites annoncées : pause du service ou dernières recherches, dites avant de choisir une photo.
  const limits = useSearchLimits();
  // Lot « partager vers Spotto » : l'élément partagé s'ouvre ici, Spotter affiché et libre.
  useSharedItemOpener(entries.openShared, entries.busy === null);

  const loadRecent = useCallback(() => getRecentSearches(RECENT_SEARCHES_LIMIT).then(setRecent).then(() => setRecentLoaded(true)).catch(() => {}), []);
  useFocusEffect(
    useCallback(() => {
      loadRecent();
      void latestVideo.refresh();
    }, [loadRecent, latestVideo.refresh])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadRecent(), latestVideo.refresh(), limits.refresh()]);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
      >
        <Text style={styles.title} accessibilityRole="header">
          {t.spotter.title}
        </Text>
        <Text style={styles.lead}>{t.spotter.lead}</Text>
        <SearchLimitsNotice notice={limits.notice} />
        <VisualSearchTip />
        {entries.linkHelp ? (
          <View style={styles.sharedHelp}>
            <ScreenshotHelp onAddScreenshot={entries.addPhoto} onAddVideo={entries.addVideo} busy={entries.importing} />
          </View>
        ) : null}
        {latest ? (
          <LatestVideoCard
            video={latest}
            query={entries.query}
            onQuery={entries.onQuery}
            onLaunch={() => entries.launchLatest(latest)}
            onAddVideo={entries.addVideo}
            busy={entries.busy === "latest"}
          />
        ) : null}
        {entries.message ? <ErrorMessage style={styles.feedback}>{entries.message}</ErrorMessage> : null}
        <EntryTiles
          videoLabel={latest ? t.spotter.otherVideo : t.spotter.addVideo}
          onVideo={entries.addVideo}
          onPhoto={entries.addPhoto}
          onCamera={entries.takePhoto}
          busy={entries.busy}
        />
        {latestVideo.state.kind === "ask" ? <LatestVideoQuestion onAnswer={latestVideo.choose} saving={latestVideo.saving} failed={latestVideo.failed} /> : null}
        {latestVideo.note ? <LatestVideoNote message={latestVideo.note} /> : null}
        {Platform.OS === "web" ? <Text style={styles.dropHint}>{t.videoLink.dropHint}</Text> : null}
        <LinkHelp onHelp={entries.showLinkHelp} />
        <RecentRow recent={recent} />
        {recentLoaded && recent.length === 0 ? <HowItWorksCard /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  lead: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
  feedback: { fontSize: font.caption, marginTop: space.sm, lineHeight: 18 },
  sharedHelp: { marginTop: space.lg },
  dropHint: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.md, textAlign: "center" },
  linkQuestion: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  linkQuestionLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline", textAlign: "center" },
  recentSection: { marginTop: space.xxl - space.xs },
  recentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, marginBottom: space.md },
  recentTitle: { fontSize: font.body, fontWeight: "600", color: color.encre },
  recentRow: { gap: space.md },
  recentItem: { width: 104 },
  recentThumb: { width: 104, height: 104, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  recentName: { fontSize: font.caption, color: color.acier, marginTop: 7, lineHeight: 16 },
}));
