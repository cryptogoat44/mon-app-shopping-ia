// Écran « vidéo partagée » (mission « liens vidéo »), ouvert dès qu'un lien
// TikTok ou Instagram arrive (partagé à l'app, ou collé) ; paramètre `url`.
// À l'ouverture : GET /api/video-links/lookup (vidéo reconnue, interrupteurs
// des lecteurs, pièces déjà repérées par d'autres membres).
// - App iPhone, lecteur permis (build × serveur × accord) : le lecteur
//   officiel, jamais masqué ni modifié ; dessous, « Vidéo TikTok de @pseudo »
//   et « Ouvrir dans TikTok » ; puis « Spotter ce moment » (pause, puis
//   instantané de la vue : lib/player-snapshot.ts) ; puis les pièces déjà
//   repérées.
// - Sinon : l'écran de secours « Spottez cette vidéo » (components/video-fallback.tsx).
// - Site : jamais de lecteur ; les pièces déjà repérées et la consigne
//   « capture, puis glisser-déposer ou coller l'image ».
// - Lien non reconnu : l'aide « capture d'écran d'abord ».
// Lot « vidéo auto » (décision du fondateur, 14 et 15 novembre 2026) : quand
// le serveur dit l'analyse d'un lien allumée (GET /api/video-links/analyze/status,
// valeur exacte `true`), l'écran montre D'ABORD « Que cherchez-vous dans
// cette vidéo ? » et « Trouver la pièce », sur l'app comme sur le site : le
// serveur fait récupérer la vidéo publique (sans la garder), l'IA y trouve la
// pièce, puis le moment choisi suit le parcours d'une vidéo du téléphone
// (lib/use-video-link-analysis.ts). Le lecteur officiel (iPhone) et la
// capture d'écran restent proposés, et la capture s'affiche à chaque échec.
// Analyse coupée, ou serveur muet : l'écran reste exactement celui d'avant.
// Retours du build 2 (« la vidéo d'abord », 24 novembre 2026) : sur l'app
// iPhone, quand le lecteur peut vraiment s'ouvrir (lib/player-decision.ts
// openingPath), l'accord puis le lecteur passent AVANT l'analyse ; « Trouver
// la pièce automatiquement » reste un bouton sous « Spotter ce moment ».
// Lecteur impossible, en échec ou refusé : l'analyse (si elle est allumée,
// afterPlayerFailure), sinon l'écran de secours, comme avant. Le site ne
// change pas.
// Retours du build 3 (26 novembre 2026) : les commandes de TikTok cachées par
// ses paramètres officiels et NOTRE barre de lecture sous la vidéo
// (components/player-controls.tsx), repli sur les siennes si elle ne parle
// pas ; vidéo aux coins arrondis ; la vidéo prend la place qui reste après la
// zone d'actions MESURÉE (les deux actions visibles sans défiler) ; plus
// d'écran d'accord : le bouton Lecture vaut accord (étape « firstPlay » : rien
// n'est chargé chez TikTok ni chez Instagram avant cet appui) ; « Spotter ce
// moment » demande l'image du moment au serveur (TikTok, `frame: true`), et
// l'instantané contrôlé (noir, blanc, flou) reste le secours.
// Lot « propositions » (Parcours 2, 21 novembre 2026) : si le serveur dit
// aussi `pieces` (valeur exacte `true`), la question propose d'abord « Voir
// les propositions de l'IA » ; sinon elle reste celle d'avant.
// L'app ne télécharge rien elle-même : les images des moments arrivent du
// serveur et restent en mémoire. Le lien reste en attente 10 minutes
// (lib/pending-video-link.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { WebView } from "react-native-webview";
import type { VideoLink, VideoLookupResponse } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { PUBLIC_WEB_URL } from "@/constants/brand";
import { EmbeddedPlayer } from "@/components/embedded-player";
import { PlayIcon, PlayerControls, type PlayerSound } from "@/components/player-controls";
import { ErrorMessage } from "@/components/error-message";
import { ScreenshotHelp } from "@/components/screenshot-help";
import { ConsentView } from "@/components/spot-launch-views";
import { VideoFallback } from "@/components/video-fallback";
import { LinkAskView, LinkFailureView, LinkMomentsView, LinkWaitingView } from "@/components/video-link-analysis";
import { VideoProducts } from "@/components/video-products";
import { track } from "@/lib/analytics";
import { fetchInstagramEmbed, fetchVideoLinkAnalysisStatus, fetchVideoLinkFrame, lookupVideoLink } from "@/lib/api";
import { features } from "@/lib/features";
import { importPhotoForSpotter, type ImportResult } from "@/lib/image-import";
import { useImageDrop } from "@/lib/image-drop";
import { photoPickerEntry, type PhotoJourneyEntry } from "@/lib/journey-entries";
import { detectLink } from "@/lib/link-detection";
import { grantPlayerConsent, readPlayerConsent } from "@/lib/player-access";
import { afterPlayerFailure, decidePlayer, openingPath, playerOffered, type FallbackReason } from "@/lib/player-decision";
import { instagramHostPage, tiktokHostPage } from "@/lib/player-host-page";
import { TIKTOK_PLAYER_PARAMS_NATIVE, isPlayerPlatform, playerBaseUrl, videoOpenUrl, type PlayerPlatform } from "@/lib/player-link";
import { snapshotAvailable, snapshotPlayer, type PlayerSnapshot } from "@/lib/player-snapshot";
import {
  PLAYER_TIMINGS,
  embedHeight,
  estimatedActionsHeight,
  isPlaybackSignal,
  isPlayerAnswer,
  momentSeconds,
  playerCommand,
  playerLayout,
  seekCommand,
  tiktokErrorAction,
  type HostMessage,
} from "@/lib/player-state";
import { PLAYER_CONSENT_BY_PLAY_BUTTON, PLAYER_CONSENT_GATE } from "@/lib/spot-flags";
import { chooseSpotImage, frameFailureReason, frameSeconds, shouldAskServer, snapshotErrorCode, type ServerFrame, type SnapshotError } from "@/lib/spot-moment";
import { beginFromPhoto } from "@/lib/spot-flow";
import { closeSpotter } from "@/lib/spot-navigation";
import { useVideoImport } from "@/lib/use-video-import";
import { useVideoLinkAnalysis } from "@/lib/use-video-link-analysis";
import { LINK_ANALYSIS_OFF, cleanQuery } from "@/lib/video-link-analysis";
import { keepDescriptionInDraft } from "@/lib/video-link-run";
import { beginPhotoSearch, pendingVideoLinks } from "@/lib/video-context";
import { discardLocalFile } from "@/lib/video-frames";
import { themedStyles } from "@/theme/themed-styles";

type Stage =
  | { kind: "loading" }
  /** Lien qui ne mène à aucune vidéo reconnue : l'aide « capture d'écran d'abord ». */
  | { kind: "unknown" }
  /** Accord préalable (une fois par plateforme) avant de charger le lecteur officiel (écran d'avant, PLAYER_CONSENT_BY_PLAY_BUTTON à false). */
  | { kind: "consent" }
  /** Retours du build 3 : la toute première fois, rien n'est chargé ; le bouton Lecture vaut accord. */
  | { kind: "firstPlay" }
  /** Code d'intégration Instagram demandé au serveur. */
  | { kind: "preparing" }
  | { kind: "player"; html: string }
  | { kind: "fallback"; reason: FallbackReason }
  | { kind: "web" }
  /** Lot « vidéo auto » : l'analyse du lien (question, accord, attente, moments, échec). */
  | { kind: "auto" }
  /** App iPhone : la capture d'écran choisie à la place de l'analyse (sur le site : « web »). */
  | { kind: "capture" };
type Notice = "tap_to_play" | "leave" | "reloaded";

const BASE_URL = playerBaseUrl(PUBLIC_WEB_URL);
/** Coins de la vidéo et du fond de la première fois : comme embedded-player.tsx. */
const VIDEO_RADIUS = 14; // = radius.piece du lot « Vitrine » (tokens.ts) : à remplacer par le jeton à l'assemblage
/** « Spotter ce moment » : après « pause », l'état « en pause » du lecteur, ou ce délai au plus (pour que le temps soit à jour). */
const PAUSE_WAIT_MS = 400;
/** Repli : 5 s après la première lecture sans aucun temps avec une durée, les commandes de TikTok reviennent. */
const CONTROLS_FALLBACK_MS = 5_000;

function fallbackLead(reason: FallbackReason): string {
  if (reason === "consent_refused") return t.videoLink.fallbackLead.refused;
  if (reason === "snapshot_failed" || reason === "snapshot_blurry") return t.videoLink.fallbackLead.snapshot;
  if (reason === "server_unknown") return t.videoLink.fallbackLead.unchecked;
  return t.videoLink.fallbackLead.notHere;
}

function TopBar({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <View style={styles.nav}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
        <Text style={styles.back}>‹ {t.common.back}</Text>
      </Pressable>
      <Pressable onPress={onClose} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
        <Text style={styles.close}>{t.spotter.close}</Text>
      </Pressable>
    </View>
  );
}

export default function VideoScreen() {
  const params = useLocalSearchParams<{ url?: string }>();
  const url = typeof params.url === "string" ? params.url.trim() : "";
  const detection = detectLink(url);
  const platform = detection.kind === "supported" && isPlayerPlatform(detection.platform) ? detection.platform : null;
  // Un lien par ouverture de l'écran : un autre lien ouvre un nouvel écran.
  return <SharedVideo key={url} url={url} platform={platform} />;
}

function SharedVideo({ url, platform: linkPlatform }: { url: string; platform: PlayerPlatform | null }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const embedWidth = Math.floor(Math.min(screen.width - 2 * space.md, 400));
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  // Zone d'actions sous la vidéo, mesurée (null avant la première mesure : estimée).
  const [actionsHeight, setActionsHeight] = useState<number | null>(null);
  // Notre barre de lecture (« ours »), ou les commandes de TikTok si elle ne reçoit aucun temps (repli).
  const [controlsMode, setControlsMode] = useState<"ours" | "tiktok">("ours");
  const controlsModeRef = useRef<"ours" | "tiktok">("ours");
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState<PlayerSound>("unknown");
  const [progress, setProgress] = useState<{ currentTime: number; duration: number } | null>(null);
  // Image du moment demandée au serveur (lot 1) : seule la valeur exacte `true` l'allume.
  const [frameEnabled, setFrameEnabled] = useState(false);
  const [lookup, setLookup] = useState<VideoLookupResponse | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // Pièce entourée sur l'écran des moments : le défilement s'arrête pendant le tracé.
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [embedSize, setEmbedSize] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"spot" | "photo" | null>(null);
  // Lot « vidéo auto » : analyse d'un lien allumée sur le serveur (faux tant qu'il ne l'a pas dit).
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  // Lot « propositions » : « Voir les propositions de l'IA » permis par le serveur (faux tant qu'il ne l'a pas dit).
  const [piecesEnabled, setPiecesEnabled] = useState(false);
  // « La vidéo d'abord » : le lecteur qui vient d'échouer n'est plus reproposé sur l'écran de l'analyse.
  const [playerBroken, setPlayerBroken] = useState<FallbackReason | null>(null);
  const { importing, importVideo } = useVideoImport(setMessage);
  const webRef = useRef<WebView>(null);
  const frameRef = useRef<View>(null);
  // Refs lues après un `await` ou dans un message du lecteur : jamais l'état d'un rendu précédent.
  const alive = useRef(true);
  const readyRef = useRef(false);
  // Le lecteur a répondu (même s'il attend un toucher) : plus de remplacement au bout de 12 s.
  const answered = useRef(false);
  // L'analyse allumée, lue par fallback() depuis un minuteur ou un message de la vue web.
  const analysisRef = useRef(false);
  const lastTime = useRef<number | null>(null);
  const crashed = useRef(false);
  // Une durée > 0 est arrivée du lecteur (notre barre marche) ; la première lecture a été vue.
  const gotDuration = useRef(false);
  const sawPlaying = useRef(false);
  // « Spotter ce moment » attend l'état « en pause » (ou 400 ms) ; abandonné si l'écran est quitté.
  const pauseWaiter = useRef<(() => void) | null>(null);
  const spotAbort = useRef<AbortController | null>(null);

  const link: VideoLink | null = lookup?.link ?? null;
  const platform: PlayerPlatform | null = link?.platform ?? linkPlatform;
  const name = platform ? t.spotter.platformName[platform] : "";
  const openUrl = platform ? videoOpenUrl(url, platform, link) : null;
  const isTikTokPlayer = stage.kind === "player" && platform === "tiktok";
  const ourControls = platform === "tiktok" && controlsMode === "ours";
  const layout = playerLayout(
    screen.width,
    screen.height - insets.top - insets.bottom,
    actionsHeight ?? estimatedActionsHeight({ analysis: analysisEnabled, firstPlay: stage.kind === "firstPlay", controls: ourControls })
  );
  // « Regarder dans le lecteur » seulement s'il peut vraiment s'ouvrir : vidéo
  // reconnue par le serveur (sans elle, decide() tombe sur l'écran de secours)
  // et même décision que decide() pour le reste (lib/player-decision.ts).
  const withPlayer = platform !== null && link !== null && playerOffered({ platform, os: Platform.OS, build: features, server: lookup?.players ?? null, snapshotReady: snapshotAvailable });
  const auto = useVideoLinkAnalysis({
    active: analysisEnabled,
    pieces: piecesEnabled,
    url: link?.canonicalUrl ?? url,
    platform,
    origin: Platform.OS === "web" ? "web" : "app",
    onDeclined: () => showCapture(),
  });
  // La description, lue par une photo choisie ou déposée (le dépôt garde la fonction de son premier rendu).
  const queryRef = useRef("");
  queryRef.current = auto.query;
  const keptQuery = cleanQuery(auto.query);
  // L'état de l'analyse, lu par fallback() depuis un minuteur ou un message de la vue web.
  const phaseRef = useRef(auto.phase.kind);
  phaseRef.current = auto.phase.kind;

  useEffect(
    () => () => {
      alive.current = false;
      // Écran quitté pendant « Spotter ce moment » : la demande au serveur est abandonnée.
      spotAbort.current?.abort();
      pauseWaiter.current?.();
    },
    []
  );

  function fallback(reason: FallbackReason) {
    if (!alive.current) return;
    // App iPhone, analyse allumée : la recherche automatique ; sinon l'écran de secours, comme avant.
    // Analyse déjà en échec (limite du jour, vidéo privée…) : l'écran de secours, qui dit pourquoi.
    const next = afterPlayerFailure({ os: Platform.OS, analysis: analysisRef.current, aiFailed: phaseRef.current === "failed" });
    if (platform) track("player_unavailable", { platform, reason, next, link_platform: platform });
    // Le lecteur qui vient d'échouer n'est plus reproposé, même après un retour à l'analyse.
    if (reason !== "consent_refused") setPlayerBroken(reason);
    if (next === "ai") {
      setMessage(null);
      return setStage({ kind: "auto" });
    }
    setStage({ kind: "fallback", reason });
  }

  /** Lecteur permis : la page hôte, écrite par l'app (TikTok : l'identifiant seul ; Instagram : le code du serveur). */
  async function startPlayer(video: VideoLink) {
    readyRef.current = false;
    answered.current = false;
    gotDuration.current = false;
    lastTime.current = null;
    sawPlaying.current = false;
    setReady(false);
    setEmbedSize(null);
    setPlaying(false);
    setProgress(null);
    const title = t.player.frameTitle(t.spotter.platformName[video.platform]);
    if (video.platform === "tiktok") {
      // Commandes de TikTok cachées (notre barre dessous), ou les siennes après le repli.
      const html = tiktokHostPage(video.videoKey, title, controlsModeRef.current === "tiktok" ? TIKTOK_PLAYER_PARAMS_NATIVE : undefined);
      return html ? setStage({ kind: "player", html }) : fallback("player_error");
    }
    setStage({ kind: "preparing" });
    try {
      const embed = await fetchInstagramEmbed(video.canonicalUrl);
      if (!alive.current) return;
      if (embed.creatorHandle) {
        setHandle(embed.creatorHandle);
        void pendingVideoLinks.learn(url, { creatorHandle: embed.creatorHandle });
      }
      const html = instagramHostPage(embed.html, title);
      return html ? setStage({ kind: "player", html }) : fallback("embed_unavailable");
    } catch {
      // 404 « player_off » ou « embed_unavailable », 503 « embed_busy », réseau.
      fallback("embed_unavailable");
    }
  }

  async function decide(response: VideoLookupResponse | null, consentOverride?: "refused" | true) {
    const video = response?.link ?? null;
    const videoPlatform = video?.platform ?? linkPlatform;
    if (!videoPlatform) return setStage({ kind: "unknown" });
    const consent = consentOverride ?? (!PLAYER_CONSENT_GATE || (await readPlayerConsent())[videoPlatform]);
    if (!alive.current) return;
    const decision = decidePlayer({
      platform: videoPlatform,
      os: Platform.OS,
      build: features,
      server: response ? response.players : null,
      snapshotReady: snapshotAvailable,
      consent,
    });
    if (decision.kind === "web") return setStage({ kind: "web" });
    if (decision.kind === "fallback") return fallback(decision.reason);
    // Retours du build 3 : le bouton Lecture vaut accord ; l'écran d'accord d'avant reste joignable par la constante.
    if (decision.kind === "consent") return setStage(PLAYER_CONSENT_BY_PLAY_BUTTON ? { kind: "firstPlay" } : { kind: "consent" });
    if (video) void startPlayer(video);
    else fallback("server_unknown");
  }

  async function load() {
    setStage({ kind: "loading" });
    setMessage(null);
    if (!linkPlatform) return setStage({ kind: "unknown" });
    // Analyse d'un lien (et ses propositions) : seule la valeur exacte `true` allume ; erreur, serveur plus ancien : tout coupé, l'écran d'avant.
    const [response, status] = await Promise.all([lookupVideoLink(url).catch(() => null), fetchVideoLinkAnalysisStatus().catch(() => LINK_ANALYSIS_OFF)]);
    if (!alive.current) return;
    const enabled = status.enabled;
    setLookup(response);
    analysisRef.current = enabled;
    setAnalysisEnabled(enabled);
    setPiecesEnabled(status.pieces);
    setFrameEnabled(status.frame);
    if (response?.link) {
      setHandle(response.link.creatorHandle);
      void pendingVideoLinks.learn(url, { url: response.link.canonicalUrl, creatorHandle: response.link.creatorHandle });
    }
    // Lien que le serveur ne reconnaît pas : l'aide habituelle. Serveur injoignable ou TikTok
    // momentanément muet : pas de lecteur (ses interrupteurs sont inconnus), l'écran de secours.
    if (response && !response.link) {
      const transient = response.linkIssue === "unreachable" || response.linkIssue === "rate_limited";
      if (!transient) return setStage({ kind: "unknown" });
      if (enabled) return setStage({ kind: "auto" });
      return void decide(null);
    }
    // « La vidéo d'abord » : sur l'app iPhone, le lecteur (accord, puis lecteur) quand il peut s'ouvrir.
    const offered = response?.link ? playerOffered({ platform: response.link.platform, os: Platform.OS, build: features, server: response.players, snapshotReady: snapshotAvailable }) : false;
    if (openingPath({ os: Platform.OS, offered, analysis: enabled }) === "auto") return setStage({ kind: "auto" });
    void decide(response);
  }

  /** Le lecteur officiel (iPhone), proposé à côté de l'analyse : accord, lecteur, ou écran de secours. */
  function openPlayerPath() {
    setMessage(null);
    void decide(lookup);
  }

  /** La capture d'écran à la place de l'analyse : sur le site, la consigne d'avant ; sur iPhone, les trois gestes.
   * Plan B en un geste (lot « recherche confiance ») : le lien repart pour 10 minutes d'attente (la capture
   * ajoutée lui sera associée, même après une longue analyse), et la description sera reprise (openPicked). */
  function showCapture() {
    if (!alive.current) return;
    setMessage(null);
    if (platform) void pendingVideoLinks.hold({ url: link?.canonicalUrl ?? url, platform, creatorHandle: handle });
    setStage({ kind: Platform.OS === "web" ? "web" : "capture" });
  }

  function backToAuto() {
    // « Spotter ce moment » encore en attente (image du serveur : jusqu'à 30 s) : abandonné, rien ne part
    // par-dessus l'analyse, l'instantané est effacé (spotMoment, finally).
    spotAbort.current?.abort();
    setMessage(null);
    // Après un échec : la question de nouveau, la description gardée (jamais le même échec réaffiché).
    if (auto.phase.kind === "failed") auto.editQuery();
    setStage({ kind: "auto" });
  }

  useEffect(() => {
    void load();
    // Une seule fois par lien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lecteur muet 12 s : la recherche automatique ou l'écran de secours. Un lecteur qui a
  // répondu mais attend un toucher (lecture automatique refusée) n'est pas remplacé.
  useEffect(() => {
    if (stage.kind !== "player" || ready) return;
    const timer = setTimeout(() => {
      if (alive.current && !answered.current) fallback("no_answer");
    }, PLAYER_TIMINGS.noAnswerMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, ready, generation]);

  /** Pause par la commande officielle du lecteur TikTok (Instagram n'en offre aucune). */
  const pausePlayer = useCallback(() => {
    if (isTikTokPlayer && readyRef.current) webRef.current?.postMessage(playerCommand("pause"));
  }, [isTikTokPlayer]);

  // Arrière-plan, ou écran recouvert (« Entourez la pièce ») : la vidéo s'arrête où elle est.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") pausePlayer();
    });
    return () => subscription.remove();
  }, [pausePlayer]);
  useFocusEffect(useCallback(() => () => pausePlayer(), [pausePlayer]));

  const announced = notice === "tap_to_play" ? t.player.tapToPlay : notice === "reloaded" ? t.player.reloaded : notice === "leave" ? t.player.leaveLink(name) : null;
  useEffect(() => {
    if (announced) AccessibilityInfo.announceForAccessibility(announced);
  }, [announced]);
  // Lecteur en échec, l'analyse prend le relais : VoiceOver le dit, seulement quand la phrase
  // s'affiche vraiment au-dessus de la question (jamais sur un ancien échec de l'analyse).
  const playerLeadShown = playerBroken !== null && stage.kind === "auto" && auto.phase.kind === "ask";
  useEffect(() => {
    if (playerLeadShown && playerBroken) AccessibilityInfo.announceForAccessibility(playerBroken === "snapshot_failed" || playerBroken === "snapshot_blurry" ? t.videoLinkAuto.playerLead.snapshot : t.videoLinkAuto.playerLead.notHere);
  }, [playerLeadShown, playerBroken]);

  function markReady() {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
    setNotice((current) => (current === "tap_to_play" ? null : current));
  }

  function onHostMessage(hostMessage: HostMessage) {
    if (isPlayerAnswer(hostMessage)) answered.current = true;
    if (hostMessage.kind === "other") {
      if (__DEV__) console.info("[player] message", hostMessage.type, hostMessage.origin);
      return;
    }
    if (hostMessage.kind === "size") return setEmbedSize(hostMessage.height);
    if (hostMessage.kind === "error") {
      if (tiktokErrorAction(hostMessage.code) === "tap_to_play") return setNotice("tap_to_play");
      return fallback("player_error");
    }
    if (hostMessage.kind === "state") {
      const nowPlaying = hostMessage.state === "playing" || hostMessage.state === "buffering";
      setPlaying(nowPlaying);
      if (hostMessage.state === "playing") sawPlaying.current = true;
      if (hostMessage.state === "paused") pauseWaiter.current?.();
    }
    if (hostMessage.kind === "muted") setSound(hostMessage.muted ? "muted" : "on");
    if (hostMessage.kind === "time") {
      lastTime.current = hostMessage.currentTime;
      if (hostMessage.duration > 0) {
        gotDuration.current = true;
        setProgress({ currentTime: hostMessage.currentTime, duration: hostMessage.duration });
      }
    }
    if (hostMessage.kind === "embedReady" || isPlaybackSignal(hostMessage)) markReady();
  }

  // ---- Notre barre de lecture : les commandes officielles du lecteur TikTok (relayées par la page hôte) ----

  function sendCommand(command: string) {
    webRef.current?.postMessage(command);
  }

  /** Lecture : marche même avant le premier signal (il relance une lecture automatique refusée, 3002). */
  function playVideo() {
    sendCommand(playerCommand("play"));
  }

  function pauseVideo() {
    sendCommand(playerCommand("pause"));
  }

  function seekVideo(seconds: number) {
    sendCommand(seekCommand(seconds));
    // Le moment choisi par la personne, même si le lecteur en pause ne redonne pas son temps.
    lastTime.current = seconds;
    setProgress((current) => (current ? { ...current, currentTime: seconds } : current));
  }

  /** Son : inconnu → activé, activé → coupé, coupé → activé ; suit onMute s'il arrive, sinon notre dernière commande. */
  function toggleSound() {
    const next: PlayerSound = sound === "on" ? "muted" : "on";
    sendCommand(playerCommand(next === "muted" ? "mute" : "unMute"));
    setSound(next);
  }

  // Repli honnête : 5 s après la première lecture, toujours aucun temps avec une durée → le lecteur est
  // rechargé UNE fois avec ses propres commandes (comme au build 3), et notre barre se retire.
  useEffect(() => {
    if (!isTikTokPlayer || controlsMode !== "ours" || !ready || !link) return;
    const video = link;
    const timer = setTimeout(() => {
      if (!alive.current || gotDuration.current || !sawPlaying.current || controlsModeRef.current !== "ours") return;
      if (__DEV__) console.info("[player] repli sur les commandes de TikTok");
      controlsModeRef.current = "tiktok";
      setControlsMode("tiktok");
      setGeneration((value) => value + 1);
      void startPlayer(video);
    }, CONTROLS_FALLBACK_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTikTokPlayer, controlsMode, ready, generation, link]);

  function onCrash() {
    // Un seul redémarrage ; au second arrêt, l'écran de secours.
    if (crashed.current) return fallback("webview_error");
    crashed.current = true;
    readyRef.current = false;
    answered.current = false;
    setReady(false);
    setNotice("reloaded");
    setGeneration((value) => value + 1);
  }

  function openVideo() {
    if (!openUrl || !platform) return;
    track("player_fallback", { platform, choice: "open_app", link_platform: platform });
    void Linking.openURL(openUrl).catch(() => {});
  }

  /** La vidéo d'origine, dans TikTok ou Instagram (lien affiché au-dessus de l'analyse). */
  function openOriginal() {
    if (openUrl) void Linking.openURL(openUrl).catch(() => {});
  }

  /** Photo prête (choisie, ou déposée sur le site) : « Entourez la pièce », associée au lien en attente.
   * La description écrite pour l'analyse est reprise sous la photo (plan B en un geste).
   * `entry` : d'où vient la photo (mesure du parcours : un nouveau parcours, celui d'une photo). */
  async function openPicked(picked: ImportResult, entry: PhotoJourneyEntry) {
    if (picked.kind === "unavailable") return setMessage(t.common.photoUnavailable);
    if (picked.kind !== "picked") return;
    await beginPhotoSearch(picked, Platform.OS === "web" ? "web" : "app", { entry });
    keepDescriptionInDraft(queryRef.current);
    if (alive.current) router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
  }

  async function addScreenshot() {
    setMessage(null);
    setBusy("photo");
    if (platform) track("player_fallback", { platform, choice: "screenshot", link_platform: platform });
    try {
      await openPicked(await importPhotoForSpotter(), photoPickerEntry(Platform.OS));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  useImageDrop(
    useCallback((picked: ImportResult) => void openPicked(picked, "photo_drop"), []),
    useCallback(() => setMessage(t.videoLink.notAnImage), [])
  );

  /** Après « pause » : l'état « en pause » du lecteur, ou PAUSE_WAIT_MS au plus (pour que le temps soit à jour). */
  function waitForPause(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (pauseWaiter.current === done) pauseWaiter.current = null;
        resolve();
      };
      const timer = setTimeout(done, PAUSE_WAIT_MS);
      pauseWaiter.current = done;
    });
  }

  /** « Spotter ce moment » (retours du build 3) : pause ; puis, pour TikTok quand le serveur le permet et que
   * le temps est connu, l'image du moment demandée au serveur EN MÊME TEMPS que l'instantané de la vue ;
   * l'image du serveur d'abord, sinon l'instantané s'il a passé le contrôle (ni noir, ni blanc, ni flou),
   * sinon le secours (lib/spot-moment.ts). Puis « Entourez la pièce ». */
  async function spotMoment() {
    if (!platform || busy) return;
    setMessage(null);
    setBusy("spot");
    AccessibilityInfo.announceForAccessibility(t.player.taking);
    const controller = new AbortController();
    spotAbort.current = controller;
    let shot: PlayerSnapshot | null = null;
    try {
      if (isTikTokPlayer && readyRef.current) {
        webRef.current?.postMessage(playerCommand("pause"));
        await waitForPause();
      }
      if (!alive.current) return;
      const time = lastTime.current;
      const video = link;
      // Même fait que la phrase de confidentialité (progress !== null) : une durée arrivée.
      const askServer = video !== null && time !== null && gotDuration.current && shouldAskServer({ platform, frame: frameEnabled, lastTime: time });
      const tag = frameRef.current ? findNodeHandle(frameRef.current) : null;
      const [snapshotResult, serverResult] = await Promise.allSettled([
        tag === null ? Promise.reject(new Error("no_view")) : snapshotPlayer(tag),
        askServer && video && time !== null ? fetchVideoLinkFrame({ url: video.canonicalUrl, atSeconds: frameSeconds(time) }, controller.signal) : Promise.resolve(null),
      ]);
      shot = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
      const snapshotError: SnapshotError | null = snapshotResult.status === "rejected" ? snapshotErrorCode(snapshotResult.reason) : null;
      const server: ServerFrame | null = serverResult.status === "fulfilled" ? serverResult.value : null;
      // Écran quitté pendant l'attente : rien ne part, l'instantané est effacé (finally).
      if (!alive.current || controller.signal.aborted) return;
      if (serverResult.status === "rejected") track("player_frame_failed", { reason: frameFailureReason(serverResult.reason), link_platform: platform });
      const choice = chooseSpotImage({ server, snapshot: shot, snapshotError });
      if (choice.source === "none") return fallback(choice.reason);
      const videoContext = {
        url: link?.canonicalUrl ?? url,
        platform,
        creatorHandle: handle,
        source: platform === "tiktok" ? ("tiktok_player" as const) : ("instagram_player" as const),
        momentSeconds: platform === "tiktok" ? momentSeconds(time) : null,
      };
      track("player_spot", { platform, image_source: choice.source, link_platform: platform });
      // L'image du serveur reste en mémoire (« data: ») et suit le chemin d'une photo ; l'instantané n'a pas servi.
      if (choice.source === "server") beginFromPhoto(choice.image, { width: choice.width, height: choice.height }, { video: videoContext });
      if (choice.source === "snapshot") {
        // Règle n° 4 : l'instantané est effacé dès que la recherche est partie.
        beginFromPhoto(choice.uri, { width: choice.width, height: choice.height }, { video: videoContext, discardImageAfterSearch: true });
        shot = null;
      }
      // Plan B en un geste : la description écrite pour l'analyse suit aussi l'image du moment.
      keepDescriptionInDraft(queryRef.current);
      router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
    } finally {
      // Instantané qui n'a pas servi (image du serveur choisie, écran quitté, secours) : effacé.
      if (shot) discardLocalFile(shot.uri);
      if (spotAbort.current === controller) spotAbort.current = null;
      if (alive.current) setBusy(null);
    }
  }

  /** Retours du build 3 : le premier appui sur Lecture vaut accord (retenu par plateforme, retirable dans
   * Réglages), puis le lecteur se charge. Rien n'est demandé à TikTok, à Meta ni à notre serveur avant. */
  async function firstPlay() {
    if (!platform) return;
    track("player_consent", { platform, choice: "play", link_platform: platform });
    await grantPlayerConsent(platform);
    if (alive.current) void decide(lookup, true);
  }

  async function acceptConsent() {
    if (!platform) return;
    track("player_consent", { platform, choice: "play", link_platform: platform });
    await grantPlayerConsent(platform);
    if (alive.current) void decide(lookup, true);
  }

  function refuseConsent() {
    if (!platform) return;
    track("player_consent", { platform, choice: "refuse", link_platform: platform });
    void decide(lookup, "refused");
  }

  /** « Trouver la pièce automatiquement », sous « Spotter ce moment » : l'analyse du lien. */
  function playerToAuto() {
    if (platform) track("player_to_ai", { platform, from: "player", link_platform: platform });
    backToAuto();
  }

  const back = () => router.back();
  const close = () => closeSpotter(router);
  const products = lookup?.products ?? [];
  const memory = <VideoProducts products={products} videoUrl={link?.canonicalUrl ?? url} showEmpty={Boolean(lookup?.memoryAvailable && link)} />;
  const videoLabel = handle ? t.player.videoBy(name, handle) : t.player.frameTitle(name);

  const errorLine = message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null;
  // Lot « vidéo auto » : depuis le lecteur ou la capture, retour à l'analyse du lien (seulement si elle est allumée).
  const autoLink = analysisEnabled ? (
    <Pressable onPress={backToAuto} style={styles.discreet} accessibilityRole="button">
      <Text style={styles.discreetLabel}>{t.videoLinkAuto.backToAuto}</Text>
    </Pressable>
  ) : null;
  // App iPhone : le lecteur officiel reste proposé à côté de l'analyse, sauf s'il vient d'échouer.
  const playerButton = withPlayer && playerBroken === null ? (
    <Pressable style={styles.secondary} onPress={openPlayerPath} accessibilityRole="button">
      <Text style={styles.secondaryLabel}>{t.videoLinkAuto.player(name)}</Text>
    </Pressable>
  ) : null;
  const captureLink = (
    <Pressable onPress={showCapture} style={styles.discreet} accessibilityRole="button">
      <Text style={styles.discreetLabel}>{t.videoLinkAuto.capture}</Text>
    </Pressable>
  );
  /** Consigne du site : capture, puis glisser-déposer ou coller ; `title` : sous un échec de l'analyse. */
  const webBox = (title?: string) => (
    <View style={styles.box}>
      {title ? (
        <Text style={styles.boxTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Text style={styles.body}>{t.videoLink.webInstruction}</Text>
      <Pressable style={styles.primary} onPress={() => void addScreenshot()} disabled={busy !== null} accessibilityRole="button">
        <Text style={styles.primaryLabel}>{t.spotter.addPhoto}</Text>
      </Pressable>
      {openUrl ? (
        <Pressable style={styles.secondary} onPress={openVideo} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{t.player.open}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  // Plan B en un geste : la description écrite pour l'analyse sera reprise sous la capture.
  const keptNote = keptQuery ? <Text style={styles.keptNote}>{t.videoLinkAuto.planB.keptQuery(keptQuery)}</Text> : null;
  /** La capture d'écran, à la place de l'analyse (ou après son échec, par son bouton) : jamais d'impasse. */
  const captureBlock =
    Platform.OS === "web" ? (
      webBox(t.videoLinkAuto.capture)
    ) : (
      <>
        <VideoFallback title={t.videoLinkAuto.capture} lead={t.videoLinkAuto.captureLead} onOpenVideo={openUrl ? openVideo : null} onAddScreenshot={() => void addScreenshot()} busy={busy !== null} />
        {playerButton}
      </>
    );

  let body;
  if (stage.kind === "loading" || stage.kind === "preparing") {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={color.encre} />
        <Text style={[styles.body, styles.center]}>{t.player.opening}</Text>
      </View>
    );
  } else if (stage.kind === "unknown") {
    body = (
      <View style={styles.content}>
        <ScreenshotHelp onAddScreenshot={() => void addScreenshot()} onAddVideo={() => void importVideo()} busy={importing || busy !== null} />
        {errorLine}
      </View>
    );
  } else if (stage.kind === "auto") {
    const phase = auto.phase;
    let autoBody;
    if (phase.kind === "consent") {
      autoBody = (
        <ConsentView
          saving={auto.saving}
          error={auto.consentError}
          onAccept={auto.accept}
          onChooseMyself={auto.decline}
          onPolicy={() => router.push("/confidentialite")}
          declineLabel={t.videoLinkAuto.consentDecline}
        />
      );
    } else if (phase.kind === "working") {
      autoBody = <LinkWaitingView startedAt={phase.startedAt} query={auto.query} mode={phase.mode} onCancel={auto.cancel} />;
    } else if (phase.kind === "moments") {
      autoBody = (
        <>
          <LinkMomentsView
            analysis={phase.analysis}
            selected={phase.selected}
            zone={phase.zone}
            zoneFromAi={phase.zoneFromAi}
            onSelect={auto.select}
            onZone={auto.changeZone}
            onDragChange={setDragging}
            onSearch={auto.search}
            onEditQuery={auto.editQuery}
            onDescribe={auto.describeInstead}
          />
          {captureLink}
        </>
      );
    } else if (phase.kind === "failed") {
      // Plan B en un geste (lot « recherche confiance ») : une phrase calme et un seul bouton, la capture
      // d'écran (lien gardé, description reprise) ; jamais d'impasse. `platform` : statistiques du plan B.
      // Lot « propositions » : le geste « décrire » suit le mode de l'essai manqué (onDescribe) ; rien d'écrit, « Votre lien est gardé ».
      autoBody = <LinkFailureView info={phase.info} mode={phase.mode} keptDescription={keptQuery !== ""} onDescribe={auto.describeInstead} platformName={name || undefined} platform={platform} onRetry={auto.retry} onEditQuery={auto.editQuery} onCapture={showCapture} />;
    } else {
      // Lecteur en échec juste avant : une phrase dit pourquoi l'analyse prend le relais.
      const playerLead = playerBroken === null ? null : playerBroken === "snapshot_failed" || playerBroken === "snapshot_blurry" ? t.videoLinkAuto.playerLead.snapshot : t.videoLinkAuto.playerLead.notHere;
      autoBody = (
        <>
          {playerLead ? <Text style={styles.body}>{playerLead}</Text> : null}
          <LinkAskView
            query={auto.query}
            onQuery={auto.onQuery}
            onFind={auto.find}
            problem={phase.problem}
            checking={auto.checking}
            onPieces={auto.piecesAvailable ? auto.findPieces : undefined}
            checkingMode={auto.checkingMode}
            focusQuery={auto.focusQuery}
          />
          {playerButton}
          {captureLink}
        </>
      );
    }
    body = (
      <View style={styles.content}>
        <View style={styles.captionRow}>
          <Text style={styles.caption} numberOfLines={1}>
            {videoLabel}
          </Text>
          {openUrl ? (
            <Pressable onPress={openOriginal} hitSlop={8} style={styles.link} accessibilityRole="link">
              <Text style={styles.linkLabel}>{t.player.openIn(name)}</Text>
            </Pressable>
          ) : null}
        </View>
        {autoBody}
        {errorLine}
        {phase.kind === "working" ? null : memory}
      </View>
    );
  } else if (stage.kind === "capture") {
    body = (
      <View style={styles.content}>
        {captureBlock}
        {keptNote}
        {autoLink}
        {errorLine}
        {memory}
      </View>
    );
  } else if (stage.kind === "consent") {
    body = (
      <View style={styles.content}>
        <Text style={styles.body}>{t.player.gate.body(name)}</Text>
        <Pressable style={styles.primary} onPress={() => void acceptConsent()} accessibilityRole="button">
          <Text style={styles.primaryLabel}>{t.player.gate.play}</Text>
        </Pressable>
        {/* Le libellé suit la même règle que fallback() : « chercher automatiquement » seulement si « Non merci » y mène (analyse allumée, pas déjà en échec). */}
        <Pressable style={styles.secondary} onPress={refuseConsent} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>
            {afterPlayerFailure({ os: Platform.OS, analysis: analysisEnabled, aiFailed: auto.phase.kind === "failed" }) === "ai" ? t.player.gate.refuseAuto : t.player.gate.refuse}
          </Text>
        </Pressable>
        {memory}
      </View>
    );
  } else if (stage.kind === "fallback") {
    body = (
      <View style={styles.content}>
        <VideoFallback lead={fallbackLead(stage.reason)} onOpenVideo={openUrl ? openVideo : null} onAddScreenshot={() => void addScreenshot()} busy={busy !== null} />
        {autoLink}
        {errorLine}
        {memory}
      </View>
    );
  } else if (stage.kind === "web") {
    body = (
      <View style={styles.content}>
        {memory}
        {webBox()}
        {keptNote}
        {autoLink}
        {errorLine}
      </View>
    );
  } else if (stage.kind === "firstPlay") {
    // La toute première fois (retours du build 3) : RIEN n'est chargé chez TikTok ni chez Instagram (ni image,
    // ni cadre, ni code d'intégration demandé au serveur) : un fond sobre au format du lecteur, notre bouton de
    // lecture au centre, une phrase dessous. Le premier appui vaut accord (firstPlay).
    const isEmbed = platform === "instagram";
    const lineLabel = `${t.player.firstPlay.lineLead(name)}${t.player.firstPlay.lineLink}${t.player.firstPlay.lineEnd}`;
    body = (
      <View style={styles.playerContent}>
        <Pressable
          onPress={() => void firstPlay()}
          style={[styles.poster, { width: isEmbed ? embedWidth : layout.width, height: layout.height }]}
          accessibilityRole="button"
          accessibilityLabel={t.player.firstPlay.play(name)}
          accessibilityHint={t.player.firstPlay.hint}
        >
          <View style={styles.playDisc}>
            <PlayIcon size={28} fill={color.surNuit} />
          </View>
        </Pressable>
        <View style={styles.actions} onLayout={(event) => setActionsHeight(Math.ceil(event.nativeEvent.layout.height))}>
          {/* Notre barre au repos (TikTok) : la place est gardée, rien ne saute à l'arrivée du lecteur. */}
          {platform === "tiktok" ? (
            <PlayerControls width={layout.width} duration={null} currentTime={null} playing={false} sound="unknown" onPlay={() => void firstPlay()} onPause={() => void firstPlay()} onSeek={() => {}} onSound={() => {}} idle />
          ) : null}
          <Pressable onPress={() => router.push("/settings")} style={styles.consentLine} accessibilityRole="link" accessibilityLabel={lineLabel}>
            <Text style={styles.consentText}>
              {t.player.firstPlay.lineLead(name)}
              <Text style={styles.consentLink}>{t.player.firstPlay.lineLink}</Text>
              {t.player.firstPlay.lineEnd}
            </Text>
          </Pressable>
          <View style={styles.captionRow}>
            <Text style={styles.caption} numberOfLines={1}>
              {videoLabel}
            </Text>
            {openUrl ? (
              <Pressable onPress={openVideo} hitSlop={8} style={styles.link} accessibilityRole="link">
                <Text style={styles.linkLabel}>{t.player.openIn(name)}</Text>
              </Pressable>
            ) : null}
          </View>
          {/* « Spotter ce moment » grisé tant que la vidéo n'est pas lancée. */}
          <Pressable style={[styles.primary, styles.primaryDisabled]} disabled accessibilityRole="button" accessibilityState={{ disabled: true }}>
            <Text style={[styles.primaryLabel, styles.primaryLabelDisabled]}>{t.player.spot}</Text>
          </Pressable>
          {analysisEnabled ? (
            <Pressable style={styles.secondary} onPress={playerToAuto} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.videoLinkAuto.backToAuto}</Text>
            </Pressable>
          ) : (
            captureLink
          )}
        </View>
        {errorLine}
        {memory}
      </View>
    );
  } else {
    const isEmbed = platform === "instagram";
    const embedBox = embedHeight(embedSize, layout.height);
    const spotDisabled = !ready || busy !== null;
    body = (
      <View style={styles.playerContent}>
        <EmbeddedPlayer
          key={generation}
          html={stage.html}
          baseUrl={BASE_URL}
          width={isEmbed ? embedWidth : layout.width}
          height={isEmbed ? embedBox.height : layout.height}
          scrollable={isEmbed && embedBox.scroll}
          webRef={webRef}
          frameRef={frameRef}
          onMessage={onHostMessage}
          onLeave={() => setNotice("leave")}
          onLoadFailure={() => fallback("webview_error")}
          onCrash={onCrash}
        />
        {/* Zone d'actions, mesurée : la vidéo prend la place qui reste, les deux actions restent visibles sans défiler. */}
        <View style={styles.actions} onLayout={(event) => setActionsHeight(Math.ceil(event.nativeEvent.layout.height))}>
          {isTikTokPlayer && controlsMode === "ours" ? (
            <PlayerControls
              width={layout.width}
              duration={progress?.duration ?? null}
              currentTime={progress?.currentTime ?? null}
              playing={playing}
              sound={sound}
              onPlay={playVideo}
              onPause={pauseVideo}
              onSeek={seekVideo}
              onSound={toggleSound}
              onDraggingChange={setDragging}
            />
          ) : null}
          <View style={styles.captionRow}>
            <Text style={styles.caption} numberOfLines={1}>
              {videoLabel}
            </Text>
            {openUrl ? (
              <Pressable onPress={openVideo} hitSlop={8} style={styles.link} accessibilityRole="link">
                <Text style={styles.linkLabel}>{t.player.openIn(name)}</Text>
              </Pressable>
            ) : null}
          </View>
          {announced ? <Text style={styles.notice}>{announced}</Text> : null}
          <Pressable
            style={[styles.primary, spotDisabled ? styles.primaryDisabled : null]}
            onPress={() => void spotMoment()}
            disabled={spotDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: spotDisabled, busy: busy === "spot" }}
          >
            {busy === "spot" ? <ActivityIndicator color={color.surInactif} /> : null}
            <Text style={[styles.primaryLabel, spotDisabled ? styles.primaryLabelDisabled : null]}>{busy === "spot" ? t.player.taking : t.player.spot}</Text>
          </Pressable>
          {analysisEnabled ? (
            <Pressable style={styles.secondary} onPress={playerToAuto} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.videoLinkAuto.backToAuto}</Text>
            </Pressable>
          ) : null}
        </View>
        {/* L'image sera demandée à notre serveur (TikTok, interrupteur allumé, temps du lecteur connu : comme
            shouldAskServer) : la phrase le dit ; sinon (temps pas encore arrivé, repli sans temps) celle d'avant. */}
        <Text style={styles.privacy}>{frameEnabled && isTikTokPlayer && progress !== null ? t.player.privacyFrame(name) : t.player.privacy(name)}</Text>
        {errorLine}
        {memory}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar onBack={back} onClose={close} />
      {/* Clavier ouvert sur « Que cherchez-vous dans cette vidéo ? » : la vue remonte jusqu'au bouton (iPhone). */}
      <ScrollView contentContainerStyle={styles.scroll} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  scroll: { flexGrow: 1, paddingBottom: space.xxl },
  content: { paddingHorizontal: space.lg, gap: space.md, maxWidth: 480, alignSelf: "center", width: "100%" },
  playerContent: { alignItems: "center", paddingHorizontal: space.md, gap: space.sm, maxWidth: 480, alignSelf: "center", width: "100%" },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  center: { textAlign: "center" },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  // « ‹ Retour » écrit en toutes lettres : sur cet écran, le geste « glisser pour revenir » est coupé.
  back: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.sm, alignSelf: "stretch", marginTop: space.md },
  boxTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, lineHeight: serifLineHeight.body, color: color.encre },
  discreet: { minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  discreetLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline", textAlign: "center" },
  captionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, alignSelf: "stretch", minHeight: 44 },
  caption: { fontSize: font.caption, color: color.acier, flexShrink: 1 },
  link: { minHeight: 44, justifyContent: "center" },
  linkLabel: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "600" },
  notice: { fontSize: font.caption, color: color.acier, lineHeight: 18, alignSelf: "stretch", textAlign: "center" },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, alignSelf: "stretch" },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabelDisabled: { color: color.surInactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600", textAlign: "center", flexShrink: 1 },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch", paddingHorizontal: space.md },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500", textAlign: "center" },
  message: { fontSize: font.caption, lineHeight: 18, alignSelf: "stretch" },
  privacy: { fontSize: font.caption, color: color.acier, lineHeight: 18, textAlign: "center" },
  keptNote: { fontSize: font.caption, color: color.acier, lineHeight: 18, alignSelf: "stretch" },
  // Retours du build 3 : zone d'actions mesurée sous la vidéo, et la toute première fois.
  actions: { alignSelf: "stretch", alignItems: "center", gap: space.sm },
  poster: { backgroundColor: color.nuit, borderRadius: VIDEO_RADIUS, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  playDisc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: color.voileImage,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.surNuit,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  consentLine: { minHeight: 44, justifyContent: "center", alignSelf: "stretch" },
  consentText: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  consentLink: { ...lienSouligne, color: color.encre },
}));
