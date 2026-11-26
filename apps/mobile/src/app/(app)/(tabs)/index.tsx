import { useCallback, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, serifDisplayLetterSpacing, serifFont, serifLineHeight, size, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { clearLastSpotResult } from "@/api/spotSession";
import { ErrorMessage } from "@/components/error-message";
import { FirstRunGuide } from "@/components/first-run-guide";
import { HowItWorksCard } from "@/components/how-it-works";
import { LinkEntry } from "@/components/link-entry";
import { HistorySearchField, RecentSearchTile } from "@/components/recent-searches";
import { ScreenshotHelp } from "@/components/screenshot-help";
import { EntryTiles, LatestVideoCard, LatestVideoNote, LatestVideoQuestion } from "@/components/spot-entry";
import { SearchLimitsNotice } from "@/components/search-limits-notice";
import { VisualSearchTip } from "@/components/visual-search-tip";
import { useAuth } from "@/lib/auth-context";
import { importPhotoForSpotter, prepareSharedPhoto, takePhotoForSpotter, type ImportResult } from "@/lib/image-import";
import { latestVideoUri, loadLatestVideo, loadLatestVideoReduced, saveLatestVideoChoice, saveLatestVideoReduced } from "@/lib/latest-video";
import type { LatestVideo, LatestVideoChoice, LatestVideoState } from "@/lib/latest-video-state";
import { reopenParams } from "@/lib/recent-searches";
import { useSearchHistory, type HistoryEntry } from "@/lib/use-search-history";
import { sharedRefusalMessage, type SharedItem } from "@/lib/shared-item";
import { useImageDrop } from "@/lib/image-drop";
import { beginPhotoSearch, type PhotoOrigin } from "@/lib/video-context";
import { photoPickerEntry, type PhotoJourneyEntry } from "@/lib/journey-entries";
import { adoptSpotVideo, videoImportMessage } from "@/lib/spot-video";
import { useLinkEntry } from "@/lib/use-link-entry";
import { useSharedItemOpener } from "@/lib/use-shared-item";
import { useVideoImport } from "@/lib/use-video-import";
import { discardLocalFile } from "@/lib/video-frames";
import { moveIntoCaptureCache } from "@/lib/visual-search-intake";
import { useSearchLimits } from "@/lib/use-search-limits";
import { useFirstRunGuide } from "@/lib/use-first-run-guide";
import { themedStyles } from "@/theme/themed-styles";
import { useTabBarSpace } from "@/lib/use-tab-bar-space";

/** Dernière vidéo de la galerie (app iPhone, en option), relue à chaque retour
 * sur Spotter. L'accès aux photos n'est demandé à iOS qu'après un « oui ». */
function useLatestVideo() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<LatestVideoState>({ kind: "off" });
  const [answer, setAnswer] = useState<"idle" | "saving" | "failed" | "answered">("idle");
  // Retours du build 3, point 3 : la carte se replie en une ligne fine au lieu
  // de disparaître ; la forme est retenue sur l'appareil, par compte.
  // Lot « fidélité aux maquettes » (décision 17) : repliée par défaut, la ligne fine de la maquette.
  const [reduced, setReduced] = useState(true);
  // Un geste pendant une relecture l'emporte sur la valeur relue (lue avant lui).
  const reducedTouches = useRef(0);
  // Carte repliée sur une ligne par défaut, et de nouveau à chaque retour sur Spotter.
  const [expanded, setExpanded] = useState(false);
  const load = useCallback(async () => {
    const touches = reducedTouches.current;
    try {
      // Lues ensemble : la carte ne s'affiche jamais grande puis petite. Forme
      // illisible : repliée, le défaut (jamais la carte cachée pour si peu).
      const [next, isReduced] = await Promise.all([loadLatestVideo(userId), userId ? loadLatestVideoReduced(userId).catch(() => true) : Promise.resolve(true)]);
      if (touches === reducedTouches.current) setReduced(isReduced);
      setState(next);
    } catch {
      // Galerie ou réponse illisible : le sélecteur reste proposé.
      setState({ kind: "off" });
    }
  }, [userId]);
  // Retour sur Spotter : la note d'après la réponse a été lue.
  const refresh = useCallback(() => {
    setAnswer((current) => (current === "saving" ? current : "idle"));
    setExpanded(false);
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

  /** Réduire / rouvrir : la forme change tout de suite ; si l'enregistrement
   * échoue, elle vaut pour cette visite seulement (simple préférence
   * d'affichage : ni message, ni accord touché — Réglages seul éteint la proposition). */
  function setCardReduced(next: boolean) {
    reducedTouches.current += 1;
    setReduced(next);
    setExpanded(false);
    if (userId) void saveLatestVideoReduced(userId, next).catch(() => {});
  }

  // Juste après un « oui » qui ne peut rien montrer : on dit pourquoi.
  const note = answer !== "answered" ? null : state.kind === "no_access" ? t.spotter.latestVideoNoAccess : state.kind === "none" ? t.spotter.latestVideoEmpty : null;
  return {
    state,
    refresh,
    choose: (choice: LatestVideoChoice) => void choose(choice),
    saving: answer === "saving",
    failed: answer === "failed",
    note,
    expanded,
    toggle: () => setExpanded((value) => !value),
    reduced,
    reduce: () => setCardReduced(true),
    reveal: () => setCardReduced(false),
  };
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
   * Un lien de vidéo en attente (10 minutes) lui est associé (lib/video-context.ts).
   * `entry` : d'où vient la photo (mesure du parcours, journey_started). */
  async function openPhoto(picked: ImportResult, unavailable: string, origin: PhotoOrigin, options: { entry: PhotoJourneyEntry; discardImageAfterSearch?: boolean }) {
    if (picked.kind === "unavailable") return setMessage(unavailable);
    if (picked.kind !== "picked") return;
    await beginPhotoSearch(picked, origin, options);
    router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
  }

  const photoOrigin: PhotoOrigin = Platform.OS === "web" ? "web" : "app";

  async function addPhoto() {
    setMessage(null);
    await openPhoto(await importPhotoForSpotter(), t.common.photoUnavailable, photoOrigin, { entry: photoPickerEntry(Platform.OS) });
  }

  // Site : une image glissée-déposée sur la page, ou collée (Ctrl+V / ⌘V).
  useImageDrop(
    useCallback((picked: ImportResult) => {
      setMessage(null);
      void openPhoto(picked, t.common.photoUnavailable, "web", { entry: "photo_drop" });
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
      await openPhoto(taken, t.cameraCapture.unavailable(t.spotter.tilePhoto), "app", { entry: "photo_camera" });
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
      // Capture de la recherche d'image d'iOS : jamais gardée après la recherche (règle n° 4) ;
      // rangée dans « recherche-image/ » du cache, vidé à chaque lancement (app fermée en plein parcours).
      const visual = item.origin === "visual_intelligence";
      const ready = visual && prepared.kind === "picked" ? { ...prepared, uri: await moveIntoCaptureCache(prepared.uri) } : prepared;
      await openPhoto(ready, t.share.imageUnreadable(t.spotter.tilePhoto), visual ? "visual_intelligence" : "share", {
        discardImageAfterSearch: visual,
        entry: visual ? "photo_visual_search" : "photo_share",
      });
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

/** « Récemment spottées » (lot « historique ») : le titre de la section, une
 * phrase, et le champ de recherche — rien tant que l'historique est vide (ou
 * pas encore lu), sauf l'échec de la première lecture, dit avec « Réessayer ». */
function HistoryHeader({ history }: { history: ReturnType<typeof useSearchHistory> }) {
  const failedFirst = history.status === "failed" && !history.loaded;
  if (!failedFirst && (!history.loaded || history.empty)) return null;
  return (
    <View style={styles.recentSection}>
      <Text style={styles.recentTitle} accessibilityRole="header">
        {t.spotter.recentlySpotted}
      </Text>
      {failedFirst ? null : (
        <>
          <HistorySearchField value={history.text} onChangeText={history.onChangeText} onClear={history.clear} />
          {/* Règle du quota : gardée, juste au-dessus des cases qu'elle concerne (lot « fidélité aux maquettes »). */}
          <Text style={styles.recentLead}>{t.retrouverPieces.recentLead}</Text>
        </>
      )}
    </View>
  );
}

/** Sous la liste : chargement, aucune correspondance, échec avec « Réessayer », ou fin de l'historique. */
function HistoryFooter({ history }: { history: ReturnType<typeof useSearchHistory> }) {
  const { status, query, entries } = history;
  if (status === "loading" || status === "more") {
    // Une relecture avec des lignes déjà là (retour sur Spotter) : pas de roue en plus.
    if (status === "loading" && entries.length > 0) return null;
    if (status === "loading" && query === null && !history.loaded) return null;
    return <ActivityIndicator color={color.encre} style={styles.historyLoading} accessibilityLabel={t.retrouverPieces.historyLoading} />;
  }
  if (status === "failed" || status === "moreFailed") {
    return (
      <View style={styles.historyNote} accessibilityLiveRegion="polite">
        <ErrorMessage style={styles.historyMessage}>{status === "failed" ? t.retrouverPieces.recentLoadError : t.retrouverPieces.historyMoreFailed}</ErrorMessage>
        <Pressable onPress={history.retry} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryLabel}>{t.common.retry}</Text>
        </Pressable>
      </View>
    );
  }
  if (status === "unavailable") return <Text style={styles.historyEnd} accessibilityLiveRegion="polite">{t.retrouverPieces.historyUnavailable}</Text>;
  if (query !== null && entries.length === 0) return <Text style={styles.historyEnd} accessibilityLiveRegion="polite">{t.retrouverPieces.historyNoMatch(query)}</Text>;
  if (history.endConfirmed && entries.length > 0) return <Text style={styles.historyEnd}>{t.retrouverPieces.historyEnd}</Text>;
  return null;
}

// Spotter (lot 4 ter) : un seul point d'entrée, « Ajouter une vidéo », et la
// photo à égalité ; sur l'app iPhone, en option, la dernière vidéo de la
// galerie — il ne reste qu'à taper quelques mots et « Lancer ».
// Retours du build 2, lot « historique » : l'écran est une liste. Tout le haut
// (messages, champ du lien, tuiles, dernière vidéo) en est l'en-tête, passé
// comme un élément (jamais un composant recréé à chaque rendu : les champs
// perdraient le clavier et le texte) ; puis « Récemment spottées », tout
// l'historique, chargé par pages de 20 en descendant.
// Retours du build 3, point 7 : l'historique en grille de deux colonnes
// (numColumns fixe, jamais changé : pas de `key` sur la liste ; l'écart entre
// les colonnes est porté par chaque case, pour qu'une case seule en fin de
// liste garde sa demi-largeur).
export default function SpotterScreen() {
  const router = useRouter();
  const history = useSearchHistory();
  // Historique relu au moins une fois : « Comment ça marche » ne s'affiche pas avant.
  const recentLoaded = history.loaded;
  const [refreshing, setRefreshing] = useState(false);
  const list = useRef<FlatList<HistoryEntry>>(null);
  const entries = useSpotterEntries(() => list.current?.scrollToOffset({ offset: 0, animated: true }));
  const latestVideo = useLatestVideo();
  const latest = latestVideo.state.kind === "ready" ? latestVideo.state.video : null;
  // Lot limites annoncées : pause du service ou dernières recherches, dites avant de choisir une photo.
  const limits = useSearchLimits();
  // Lot « partager vers Spotto » : l'élément partagé s'ouvre ici, Spotter affiché et libre.
  useSharedItemOpener(entries.openShared, entries.busy === null);
  // Lot « recherche confiance » : le guide de la première recherche, une seule fois par appareil, pour un historique vide.
  const guide = useFirstRunGuide(recentLoaded ? history.empty : null);
  // Retours du build 3 (point 5) : la barre flotte au-dessus de la liste ; la dernière rangée remonte au-dessus d'elle.
  const tabBarSpace = useTabBarSpace();

  const reloadHistory = history.reload;
  useFocusEffect(
    useCallback(() => {
      void reloadHistory();
      void latestVideo.refresh();
    }, [reloadHistory, latestVideo.refresh])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([history.reload(), latestVideo.refresh(), limits.refresh()]);
    setRefreshing(false);
  }

  function openEntry(entry: HistoryEntry) {
    // Rouverte depuis l'historique : toujours relue sur le serveur (gratuit), jamais
    // la copie en mémoire du dernier lancement, qui peut être périmée (voie B lancée
    // ou plus admissible, propositions de vos mots arrivées depuis). La pièce de la
    // ligne (avec une recherche : celle qui correspond) s'y affiche en grand (lib/recent-searches.ts).
    clearLastSpotResult();
    router.push({ pathname: "/spot/result", params: reopenParams(entry) });
  }

  const header = (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        {t.spotter.title}
      </Text>
      <Text style={styles.lead}>{t.spotter.lead}</Text>
      {guide.state === "shown" ? (
        <FirstRunGuide
          onClose={guide.close}
          onStart={() => {
            // La dernière étape lance une vraie recherche : le choix d'une capture ou d'une photo.
            guide.close();
            entries.addPhoto();
          }}
        />
      ) : null}
      <SearchLimitsNotice notice={limits.notice} />
      {/* L'astuce (iPhone, iOS 26) attend la décision du guide : jamais les deux cartes à la fois. */}
      {guide.state === "hidden" ? <VisualSearchTip /> : null}
      {entries.linkHelp ? (
        <View style={styles.sharedHelp}>
          <ScreenshotHelp onAddScreenshot={entries.addPhoto} onAddVideo={entries.addVideo} busy={entries.importing} />
        </View>
      ) : null}
      {/* Retours du build 2 : le champ du lien, toujours visible, avant les tuiles (plus de question à déplier). */}
      <LinkEntry onHelp={entries.showLinkHelp} />
      <EntryTiles
        videoLabel={latest ? t.spotter.otherVideo : t.spotter.addVideo}
        onVideo={entries.addVideo}
        onPhoto={entries.addPhoto}
        onCamera={entries.takePhoto}
        busy={entries.busy}
      />
      {entries.message ? <ErrorMessage style={styles.feedback}>{entries.message}</ErrorMessage> : null}
      {Platform.OS === "web" ? <Text style={styles.dropHint}>{t.videoLink.dropHint}</Text> : null}
      {latest ? (
        <LatestVideoCard
          video={latest}
          query={entries.query}
          onQuery={entries.onQuery}
          onLaunch={() => entries.launchLatest(latest)}
          onAddVideo={entries.addVideo}
          busy={entries.busy === "latest"}
          expanded={latestVideo.expanded}
          onToggle={latestVideo.toggle}
          reduced={latestVideo.reduced}
          onReduce={latestVideo.reduce}
          onReveal={latestVideo.reveal}
        />
      ) : null}
      {latestVideo.state.kind === "ask" ? <LatestVideoQuestion onAnswer={latestVideo.choose} saving={latestVideo.saving} failed={latestVideo.failed} /> : null}
      {latestVideo.note ? <LatestVideoNote message={latestVideo.note} /> : null}
      {recentLoaded && history.empty && guide.state !== "shown" ? <HowItWorksCard /> : null}
      <HistoryHeader history={history} />
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <FlatList
        ref={list}
        data={history.entries}
        keyExtractor={(entry) => entry.searchId}
        numColumns={2}
        renderItem={({ item, index }) => <RecentSearchTile entry={item} column={index % 2 === 0 ? "left" : "right"} onOpen={() => openEntry(item)} />}
        ListHeaderComponent={header}
        ListFooterComponent={<HistoryFooter history={history} />}
        onEndReached={history.loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}
        scrollIndicatorInsets={{ bottom: tabBarSpace }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
      />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { paddingHorizontal: space.md, paddingTop: space.md, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, lineHeight: serifLineHeight.display, letterSpacing: serifDisplayLetterSpacing, color: color.encre },
  lead: { fontSize: font.caption, lineHeight: 18, color: color.acier, marginTop: space.xs },
  feedback: { fontSize: font.caption, marginTop: space.sm, lineHeight: 18 },
  sharedHelp: { marginTop: space.lg },
  dropHint: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.sm, textAlign: "center" },
  recentSection: { marginTop: space.lg, marginBottom: 12, gap: space.xs },
  recentTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre },
  recentLead: { fontSize: font.caption, lineHeight: 18, color: color.acier, marginTop: space.xs },
  historyLoading: { marginTop: space.lg, minHeight: size.touchTarget },
  historyNote: { alignItems: "center", marginTop: space.lg },
  historyMessage: { fontSize: font.secondary, textAlign: "center", lineHeight: 21 },
  retry: { marginTop: space.sm, minHeight: size.touchTarget, minWidth: size.touchTarget, justifyContent: "center", alignItems: "center" },
  retryLabel: { ...lienSouligne, fontSize: font.body, color: color.vert, fontWeight: "600" },
  historyEnd: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.lg, textAlign: "center" },
}));
