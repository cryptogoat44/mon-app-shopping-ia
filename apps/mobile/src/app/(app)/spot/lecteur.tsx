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
// Rien n'est téléchargé de TikTok ni d'Instagram. Le lien reste en attente
// 10 minutes (lib/pending-video-link.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, Text, View, findNodeHandle, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { WebView } from "react-native-webview";
import type { VideoLink, VideoLookupResponse } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { PUBLIC_WEB_URL } from "@/constants/brand";
import { EmbeddedPlayer } from "@/components/embedded-player";
import { ErrorMessage } from "@/components/error-message";
import { ScreenshotHelp } from "@/components/screenshot-help";
import { VideoFallback } from "@/components/video-fallback";
import { VideoProducts } from "@/components/video-products";
import { track } from "@/lib/analytics";
import { fetchInstagramEmbed, lookupVideoLink } from "@/lib/api";
import { features } from "@/lib/features";
import { importPhotoForSpotter, type ImportResult } from "@/lib/image-import";
import { useImageDrop } from "@/lib/image-drop";
import { detectLink } from "@/lib/link-detection";
import { grantPlayerConsent, readPlayerConsent } from "@/lib/player-access";
import { decidePlayer, type FallbackReason } from "@/lib/player-decision";
import { instagramHostPage, tiktokHostPage } from "@/lib/player-host-page";
import { isPlayerPlatform, playerBaseUrl, videoOpenUrl, type PlayerPlatform } from "@/lib/player-link";
import { snapshotAvailable, snapshotPlayer } from "@/lib/player-snapshot";
import { PLAYER_TIMINGS, embedHeight, isPlaybackSignal, momentSeconds, playerCommand, playerLayout, tiktokErrorAction, type HostMessage } from "@/lib/player-state";
import { PLAYER_CONSENT_GATE } from "@/lib/spot-flags";
import { beginFromPhoto } from "@/lib/spot-flow";
import { closeSpotter } from "@/lib/spot-navigation";
import { useVideoImport } from "@/lib/use-video-import";
import { beginPhotoSearch, pendingVideoLinks } from "@/lib/video-context";
import { discardLocalFile } from "@/lib/video-frames";
import { themedStyles } from "@/theme/themed-styles";

type Stage =
  | { kind: "loading" }
  /** Lien qui ne mène à aucune vidéo reconnue : l'aide « capture d'écran d'abord ». */
  | { kind: "unknown" }
  /** Accord préalable (une fois par plateforme) avant de charger le lecteur officiel. */
  | { kind: "consent" }
  /** Code d'intégration Instagram demandé au serveur. */
  | { kind: "preparing" }
  | { kind: "player"; html: string }
  | { kind: "fallback"; reason: FallbackReason }
  | { kind: "web" };
type Notice = "tap_to_play" | "leave" | "reloaded";

const BASE_URL = playerBaseUrl(PUBLIC_WEB_URL);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fallbackLead(reason: FallbackReason): string {
  if (reason === "consent_refused") return t.videoLink.fallbackLead.refused;
  if (reason === "snapshot_failed") return t.videoLink.fallbackLead.snapshot;
  if (reason === "server_unknown") return t.videoLink.fallbackLead.unchecked;
  return t.videoLink.fallbackLead.notHere;
}

function TopBar({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <View style={styles.nav}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
        <Text style={styles.back}>‹</Text>
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
  const layout = playerLayout(screen.width, screen.height - insets.top - insets.bottom);
  const embedWidth = Math.floor(Math.min(screen.width - 2 * space.md, 400));
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [lookup, setLookup] = useState<VideoLookupResponse | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const [embedSize, setEmbedSize] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"spot" | "photo" | null>(null);
  const { importing, importVideo } = useVideoImport(setMessage);
  const webRef = useRef<WebView>(null);
  const frameRef = useRef<View>(null);
  // Refs lues après un `await` ou dans un message du lecteur : jamais l'état d'un rendu précédent.
  const alive = useRef(true);
  const readyRef = useRef(false);
  const lastTime = useRef<number | null>(null);
  const crashed = useRef(false);

  const link: VideoLink | null = lookup?.link ?? null;
  const platform: PlayerPlatform | null = link?.platform ?? linkPlatform;
  const name = platform ? t.spotter.platformName[platform] : "";
  const openUrl = platform ? videoOpenUrl(url, platform, link) : null;
  const isTikTokPlayer = stage.kind === "player" && platform === "tiktok";

  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  function fallback(reason: FallbackReason) {
    if (!alive.current) return;
    if (platform) track("player_unavailable", { platform, reason });
    setStage({ kind: "fallback", reason });
  }

  /** Lecteur permis : la page hôte, écrite par l'app (TikTok : l'identifiant seul ; Instagram : le code du serveur). */
  async function startPlayer(video: VideoLink) {
    readyRef.current = false;
    setReady(false);
    setEmbedSize(null);
    const title = t.player.frameTitle(t.spotter.platformName[video.platform]);
    if (video.platform === "tiktok") {
      const html = tiktokHostPage(video.videoKey, title);
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
    if (decision.kind === "consent") return setStage({ kind: "consent" });
    if (video) void startPlayer(video);
    else fallback("server_unknown");
  }

  async function load() {
    setStage({ kind: "loading" });
    setMessage(null);
    if (!linkPlatform) return setStage({ kind: "unknown" });
    let response: VideoLookupResponse | null = null;
    try {
      response = await lookupVideoLink(url);
    } catch {
      response = null;
    }
    if (!alive.current) return;
    setLookup(response);
    if (response?.link) {
      setHandle(response.link.creatorHandle);
      void pendingVideoLinks.learn(url, { url: response.link.canonicalUrl, creatorHandle: response.link.creatorHandle });
    }
    // Lien que le serveur ne reconnaît pas : l'aide habituelle. Serveur injoignable ou TikTok
    // momentanément muet : pas de lecteur (ses interrupteurs sont inconnus), l'écran de secours.
    if (response && !response.link) {
      const transient = response.linkIssue === "unreachable" || response.linkIssue === "rate_limited";
      if (!transient) return setStage({ kind: "unknown" });
      return void decide(null);
    }
    void decide(response);
  }

  useEffect(() => {
    void load();
    // Une seule fois par lien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lecteur muet 12 s : écran de secours.
  useEffect(() => {
    if (stage.kind !== "player" || ready) return;
    const timer = setTimeout(() => {
      if (alive.current && !readyRef.current) fallback("no_answer");
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

  function markReady() {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
    setNotice((current) => (current === "tap_to_play" ? null : current));
  }

  function onHostMessage(hostMessage: HostMessage) {
    if (hostMessage.kind === "other") {
      if (__DEV__) console.info("[player] message", hostMessage.type, hostMessage.origin);
      return;
    }
    if (hostMessage.kind === "size") return setEmbedSize(hostMessage.height);
    if (hostMessage.kind === "error") {
      if (tiktokErrorAction(hostMessage.code) === "tap_to_play") return setNotice("tap_to_play");
      return fallback("player_error");
    }
    if (hostMessage.kind === "time") lastTime.current = hostMessage.currentTime;
    if (hostMessage.kind === "embedReady" || isPlaybackSignal(hostMessage)) markReady();
  }

  function onCrash() {
    // Un seul redémarrage ; au second arrêt, l'écran de secours.
    if (crashed.current) return fallback("webview_error");
    crashed.current = true;
    readyRef.current = false;
    setReady(false);
    setNotice("reloaded");
    setGeneration((value) => value + 1);
  }

  function openVideo() {
    if (!openUrl || !platform) return;
    track("player_fallback", { platform, choice: "open_app" });
    void Linking.openURL(openUrl).catch(() => {});
  }

  /** Photo prête (choisie, ou déposée sur le site) : « Entourez la pièce », associée au lien en attente. */
  async function openPicked(picked: ImportResult) {
    if (picked.kind === "unavailable") return setMessage(t.common.photoUnavailable);
    if (picked.kind !== "picked") return;
    await beginPhotoSearch(picked, Platform.OS === "web" ? "web" : "app");
    if (alive.current) router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
  }

  async function addScreenshot() {
    setMessage(null);
    setBusy("photo");
    if (platform) track("player_fallback", { platform, choice: "screenshot" });
    try {
      await openPicked(await importPhotoForSpotter());
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  useImageDrop(
    useCallback((picked: ImportResult) => void openPicked(picked), []),
    useCallback(() => setMessage(t.videoLink.notAnImage), [])
  );

  /** « Spotter ce moment » : pause, instantané de la vue (rien d'autre), puis « Entourez la pièce ». */
  async function spotMoment() {
    if (!platform || busy) return;
    setMessage(null);
    setBusy("spot");
    try {
      if (isTikTokPlayer && readyRef.current) {
        webRef.current?.postMessage(playerCommand("pause"));
        await sleep(PLAYER_TIMINGS.pauseSettleMs);
      }
      const tag = frameRef.current ? findNodeHandle(frameRef.current) : null;
      if (tag === null) return fallback("snapshot_failed");
      let shot;
      try {
        shot = await snapshotPlayer(tag);
      } catch {
        return fallback("snapshot_failed");
      }
      if (!alive.current) return discardLocalFile(shot.uri);
      track("player_spot", { platform });
      beginFromPhoto(
        shot.uri,
        { width: shot.width, height: shot.height },
        {
          video: {
            url: link?.canonicalUrl ?? url,
            platform,
            creatorHandle: handle,
            source: platform === "tiktok" ? "tiktok_player" : "instagram_player",
            momentSeconds: platform === "tiktok" ? momentSeconds(lastTime.current) : null,
          },
          // Règle n° 4 : l'instantané est effacé dès que la recherche est partie.
          discardImageAfterSearch: true,
        }
      );
      router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function acceptConsent() {
    if (!platform) return;
    track("player_consent", { platform, choice: "play" });
    await grantPlayerConsent(platform);
    if (alive.current) void decide(lookup, true);
  }

  function refuseConsent() {
    if (!platform) return;
    track("player_consent", { platform, choice: "refuse" });
    void decide(lookup, "refused");
  }

  const back = () => router.back();
  const close = () => closeSpotter(router);
  const products = lookup?.products ?? [];
  const memory = <VideoProducts products={products} videoUrl={link?.canonicalUrl ?? url} showEmpty={Boolean(lookup?.memoryAvailable && link)} />;
  const videoLabel = handle ? t.player.videoBy(name, handle) : t.player.frameTitle(name);

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
        {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}
      </View>
    );
  } else if (stage.kind === "consent") {
    body = (
      <View style={styles.content}>
        <Text style={styles.body}>{t.player.gate.body(name)}</Text>
        <Pressable style={styles.primary} onPress={() => void acceptConsent()} accessibilityRole="button">
          <Text style={styles.primaryLabel}>{t.player.gate.play}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={refuseConsent} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{t.player.gate.refuse}</Text>
        </Pressable>
        {memory}
      </View>
    );
  } else if (stage.kind === "fallback") {
    body = (
      <View style={styles.content}>
        <VideoFallback lead={fallbackLead(stage.reason)} onOpenVideo={openUrl ? openVideo : null} onAddScreenshot={() => void addScreenshot()} busy={busy !== null} />
        {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}
        {memory}
      </View>
    );
  } else if (stage.kind === "web") {
    body = (
      <View style={styles.content}>
        {memory}
        <View style={styles.box}>
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
        {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}
      </View>
    );
  } else {
    const isEmbed = platform === "instagram";
    const embedBox = embedHeight(embedSize, layout.height);
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
          style={[styles.primary, !ready || busy !== null ? styles.primaryDisabled : null]}
          onPress={() => void spotMoment()}
          disabled={!ready || busy !== null}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy !== null, busy: busy === "spot" }}
        >
          {busy === "spot" ? <ActivityIndicator color={color.blanc} /> : null}
          <Text style={styles.primaryLabel}>{busy === "spot" ? t.player.taking : t.player.spot}</Text>
        </Pressable>
        <Text style={styles.privacy}>{t.player.privacy(name)}</Text>
        {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}
        {memory}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar onBack={back} onClose={close} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
  back: { fontSize: 26, color: color.encre },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.sm, alignSelf: "stretch", marginTop: space.md },
  captionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, alignSelf: "stretch", minHeight: 44 },
  caption: { fontSize: font.caption, color: color.acier, flexShrink: 1 },
  link: { minHeight: 44, justifyContent: "center" },
  linkLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600", textDecorationLine: "underline" },
  notice: { fontSize: font.caption, color: color.acier, lineHeight: 18, alignSelf: "stretch", textAlign: "center" },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, alignSelf: "stretch" },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600", textAlign: "center", flexShrink: 1 },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  message: { fontSize: font.caption, lineHeight: 18, alignSelf: "stretch" },
  privacy: { fontSize: font.caption, color: color.acier, lineHeight: 18, textAlign: "center" },
}));
