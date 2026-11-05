// Écran Lecteur (lot « lecteur intégré », app iPhone) : la vidéo TikTok ou
// Instagram, collée ou partagée, se lit ici, dans le lecteur officiel ; la
// personne la met en pause sur la pièce et touche « Spotter ce moment ».
// Spotto prend l'image affichée (lib/player-capture.ts), qui suit ensuite le
// chemin d'une photo : « Entourez la pièce », puis la recherche. Rien n'est
// téléchargé ; le lien n'est ni envoyé au serveur ni enregistré.
// Site, ou lecteur coupé (LINK_PLAYER_ENABLED) : aucun lien n'y mène ;
// l'écran dit « parcours indisponible ».
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, Pressable, ScrollView, Text, View, findNodeHandle, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { WebView } from "react-native-webview";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { PUBLIC_WEB_URL } from "@/constants/brand";
import { EmbeddedPlayer, ShortLinkResolver } from "@/components/embedded-player";
import { ErrorMessage } from "@/components/error-message";
import { track } from "@/lib/analytics";
import { importPhotoForSpotter, prepareSharedPhoto } from "@/lib/image-import";
import {
  captureMoment,
  grantPlayerConsent,
  markScreenConsentShown,
  mediaState,
  pauseMedia,
  readPlayerConsent,
  reportBlackImage,
  screenConsentNeeded,
} from "@/lib/player-capture";
import {
  checkTikTok,
  clearPlayerLink,
  getHeldPlayerLink,
  openPlayerLink,
  playerBaseUrl,
  readPlayerLink,
  type HeldPlayerLink,
  type PlayerEmbed,
  type TikTokCheck,
  type UnavailableReason,
} from "@/lib/player-link";
import {
  PLAYER_TIMINGS,
  captureFailure,
  captureOutcome,
  checkForbidsPlayer,
  delay,
  embedHeight,
  isPlaybackSignal,
  noAnswerReason,
  playerCommand,
  playerLayout,
  seekCommand,
  tiktokErrorAction,
  type CaptureFailure,
  type CaptureMethod,
  type HostMessage,
} from "@/lib/player-state";
import { beginFromPhoto } from "@/lib/spot-flow";
import { PLAYER_CONSENT_GATE } from "@/lib/spot-flags";
import { closeSpotter } from "@/lib/spot-navigation";
import { discardLocalFile } from "@/lib/video-frames";
import { themedStyles } from "@/theme/themed-styles";

type Stage =
  | { kind: "opening" }
  /** Accord préalable (« deux clics ») avant de charger le lecteur officiel (contre-expertise n° 5). */
  | { kind: "gate" }
  /** Lien court non résolu par le réseau : second suivi dans une vue web cachée (contre-expertise n° 4b). */
  | { kind: "resolving"; url: string }
  | { kind: "player"; embed: PlayerEmbed }
  | { kind: "unavailable"; reason: UnavailableReason };
type Capture =
  | { kind: "idle" }
  | { kind: "busy"; method: CaptureMethod | null }
  /** Encart « Encore une étape », avant l'alerte d'iOS (enregistrement de l'écran). */
  | { kind: "consent" }
  | { kind: "failed"; reason: CaptureFailure }
  /** Image prise, « Entourez la pièce » ouvert : au retour, « L'image prise était noire ? ». */
  | { kind: "taken"; method: CaptureMethod };
type Notice = "tap_to_play" | "leave" | "reloaded";

const BASE_URL = playerBaseUrl(PUBLIC_WEB_URL);
const NO_CHECK: Promise<TikTokCheck> = Promise.resolve({ status: "skipped", html: null });

export default function PlayerScreen() {
  // Lu une fois : le lien reste en mémoire jusqu'à « Fermer » ou au départ de l'écran.
  const [held] = useState(getHeldPlayerLink);
  return held ? <Player held={held} /> : <MissingView />;
}

/** Aucun lien en attente (site, lien direct vers l'écran) : on repart proprement. */
function MissingView() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.centered}>
        <Text style={styles.body}>{t.preview.missing}</Text>
        <Pressable style={styles.primary} onPress={() => closeSpotter(router)} accessibilityRole="button">
          <Text style={styles.primaryLabel}>{t.preview.back}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
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

function unavailableText(reason: UnavailableReason, name: string): string {
  switch (reason) {
    case "not_public":
      return t.player.unavailable.notPublic;
    case "not_a_video":
      return t.player.unavailable.notAVideo(name);
    case "short_link":
      return t.player.unavailable.shortLink(name);
    case "no_answer":
      return t.player.unavailable.noAnswer(name);
    case "network":
      return t.spotter.networkError;
    case "player_error":
      return t.player.unavailable.playerError(name);
    case "crashed":
      return t.player.unavailable.crashed;
  }
}

function failureText(reason: CaptureFailure): string {
  const shortcut = t.preview.screenshotShortcut.ios;
  if (reason === "declined") return t.player.captureFailed.declined(shortcut);
  if (reason === "phone_call") return t.player.captureFailed.phoneCall(shortcut);
  return t.player.captureFailed.body(shortcut);
}

function noticeText(notice: Notice, name: string): string {
  if (notice === "leave") return t.player.leaveLink(name);
  return notice === "tap_to_play" ? t.player.tapToPlay : t.player.reloaded;
}

/** Encart posé sur le lecteur, ancré en bas : toujours visible, même sur petit écran (contre-expertise n° 1). */
function OverlayBox({ children }: { children: ReactNode }) {
  return <View style={styles.overlayBox}>{children}</View>;
}

/** Capture d'écran faite par la personne, ajoutée avec le sélecteur de photos (repli). */
function ScreenshotFallback({ title, text, onAdd }: { title: string | null; text: string; onAdd: () => void }) {
  return (
    <>
      {title ? (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Text style={styles.body}>{text}</Text>
      <Pressable style={styles.primary} onPress={onAdd} accessibilityRole="button">
        <Text style={styles.primaryLabel}>{t.firstTry.linkHelp.addScreenshot}</Text>
      </Pressable>
    </>
  );
}

function Player({ held }: { held: HeldPlayerLink }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const layout = playerLayout(screen.width, screen.height - insets.top - insets.bottom);
  const embedWidth = Math.floor(Math.min(screen.width - 2 * space.md, 400));
  const name = t.spotter.platformName[held.platform];
  const webRef = useRef<WebView>(null);
  const frameRef = useRef<View>(null);
  const [generation, setGeneration] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: "opening" });
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [embedSize, setEmbedSize] = useState<number | null>(null);
  const [capture, setCapture] = useState<Capture>({ kind: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Refs lues après un `await` ou dans un message du lecteur : jamais l'état d'un rendu précédent.
  const alive = useRef(true);
  const busy = useRef(false);
  const token = useRef(0);
  const embedRef = useRef<PlayerEmbed | null>(null);
  const loadedRef = useRef(false);
  const readyRef = useRef(false);
  const check = useRef<Promise<TikTokCheck>>(NO_CHECK);
  const lastTime = useRef<number | null>(null);
  const resumeAt = useRef<number | null>(null);
  const reloaded = useRef(false);
  const fallbackTried = useRef(false);
  const consent = useRef<((go: boolean) => void) | null>(null);
  const tiktokPlayer = stage.kind === "player" && stage.embed.platform === "tiktok" && stage.embed.variant === "player";

  // Départ de l'écran : plus rien ne s'enchaîne après un `await` (contre-expertise n° 2a) ; l'encart
  // « Encore une étape » resté ouvert est refermé ; le lien n'est oublié que s'il est toujours le nôtre (n° 2c).
  useEffect(
    () => () => {
      alive.current = false;
      consent.current?.(false);
      consent.current = null;
    },
    []
  );
  useEffect(() => () => clearPlayerLink(held), [held]);

  function unavailable(reason: UnavailableReason) {
    if (!alive.current) return;
    token.current += 1;
    embedRef.current = null;
    track("player_unavailable", { platform: held.platform, reason });
    setStage({ kind: "unavailable", reason });
  }

  function resetPlayback() {
    loadedRef.current = false;
    readyRef.current = false;
    setLoaded(false);
    setReady(false);
    setEmbedSize(null);
  }

  function markLoaded() {
    loadedRef.current = true;
    setLoaded(true);
  }

  function markReady() {
    readyRef.current = true;
    setReady(true);
    setNotice((current) => (current === "tap_to_play" ? null : current));
  }

  /** Lecteur (re)lancé avec ce code. TikTok : la vérification oEmbed tourne en parallèle ; si elle refuse la vidéo, l'écran le dit, même lecteur prêt (n° 14). */
  function start(embed: PlayerEmbed) {
    const mine = ++token.current;
    embedRef.current = embed;
    resetPlayback();
    if (embed.platform === "tiktok" && embed.variant === "player") {
      check.current = checkTikTok(embed.oembedUrl);
      void check.current.then((result) => {
        const forbidden = checkForbidsPlayer(result.status);
        if (forbidden && alive.current && token.current === mine) unavailable(forbidden);
      });
    }
    setStage({ kind: "player", embed });
  }

  /** Ouverture : lien court suivi, publication Instagram vérifiée. */
  async function open(url: string, webResolve: boolean) {
    const mine = ++token.current;
    embedRef.current = null;
    reloaded.current = false;
    fallbackTried.current = false;
    setStage({ kind: "opening" });
    const result = await openPlayerLink(url, { width: embedWidth });
    if (!alive.current || token.current !== mine) return;
    if (result.kind === "embed") return start(result.embed);
    const link = readPlayerLink(url);
    if (result.reason === "short_link" && webResolve && link.kind === "short") return setStage({ kind: "resolving", url: link.url });
    unavailable(result.reason);
  }

  // Accord préalable lu une fois ; donné : le lecteur s'ouvre aussitôt.
  useEffect(() => {
    void (async () => {
      const given = !PLAYER_CONSENT_GATE || (await readPlayerConsent())[held.platform];
      if (!alive.current) return;
      if (given) void open(held.url, true);
      else setStage({ kind: "gate" });
    })();
    // Une seule fois par lien tenu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  /** Repli documenté de TikTok (n° 9) : le code d'intégration renvoyé par l'oEmbed, une seule fois. */
  async function fallbackToEmbed(): Promise<boolean> {
    const embed = embedRef.current;
    if (!embed || embed.platform !== "tiktok" || embed.variant !== "player" || fallbackTried.current) return false;
    fallbackTried.current = true;
    const mine = token.current;
    const result = await check.current;
    if (!alive.current || token.current !== mine || result.status !== "ok" || !result.html) return false;
    track("player_fallback", { platform: "tiktok", choice: "embed" });
    start({ platform: "tiktok", variant: "oembed", id: embed.id, html: result.html });
    return true;
  }

  // Lecteur muet 12 s : repli TikTok si possible, sinon la raison donnée par la vérification (note R1 §4).
  useEffect(() => {
    if (stage.kind !== "player" || loaded) return;
    const embed = stage.embed;
    const mine = token.current;
    const timer = setTimeout(() => {
      void (async () => {
        if (!alive.current || token.current !== mine || loadedRef.current) return;
        if (await fallbackToEmbed()) return;
        if (!alive.current || token.current !== mine || loadedRef.current) return;
        if (embed.platform !== "tiktok" || embed.variant !== "player") return unavailable("no_answer");
        unavailable(noAnswerReason((await check.current).status));
      })();
    }, PLAYER_TIMINGS.noAnswerMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, loaded, generation]);

  // Codes d'intégration : « Spotter ce moment » ne s'active qu'après une lecture constatée (n° 13).
  useEffect(() => {
    if (stage.kind !== "player" || stage.embed.variant !== "oembed" || ready) return;
    const timer = setInterval(() => {
      const viewTag = findNodeHandle(frameRef.current);
      if (viewTag === null) return;
      void mediaState(viewTag).then((state) => {
        if (state === "playing" && alive.current && !readyRef.current) markReady();
      });
    }, PLAYER_TIMINGS.mediaPollMs);
    return () => clearInterval(timer);
  }, [stage, ready, generation]);

  /** Commandes au lecteur TikTok seulement : une page Instagram ne reçoit jamais de script (note R2 §3.5). */
  function send(command: string) {
    const embed = embedRef.current;
    if (embed && embed.platform === "tiktok" && embed.variant === "player") webRef.current?.postMessage(command);
  }

  const pausePlayer = useCallback(() => {
    const embed = embedRef.current;
    if (embed && embed.platform === "tiktok" && embed.variant === "player") webRef.current?.postMessage(playerCommand("pause"));
    const viewTag = findNodeHandle(frameRef.current);
    if (viewTag !== null) void pauseMedia(viewTag);
  }, []);

  // Arrière-plan, ou écran recouvert (« Entourez la pièce ») : la vidéo s'arrête où elle est.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") pausePlayer();
    });
    return () => subscription.remove();
  }, [pausePlayer]);
  useFocusEffect(useCallback(() => () => pausePlayer(), [pausePlayer]));

  // VoiceOver : chaque encart est annoncé (accessibilityLiveRegion ne sert que sur Android, n° 1).
  const announced = capture.kind === "consent" ? t.player.screenConsent.body : capture.kind === "failed" ? failureText(capture.reason) : notice ? noticeText(notice, name) : null;
  useEffect(() => {
    if (announced) AccessibilityInfo.announceForAccessibility(announced);
  }, [announced]);

  function onHostMessage(hostMessage: HostMessage) {
    if (hostMessage.kind === "other") {
      if (__DEV__) console.info("[player] message", hostMessage.type, hostMessage.origin);
      return;
    }
    if (hostMessage.kind === "size") return setEmbedSize(hostMessage.height);
    if (hostMessage.kind === "error") return onPlayerError(hostMessage.code);
    if (hostMessage.kind === "time") lastTime.current = hostMessage.currentTime;
    if (!loadedRef.current) markLoaded();
    if (hostMessage.kind === "embedReady") {
      if (!readyRef.current) setNotice("tap_to_play");
      return;
    }
    if (readyRef.current || !isPlaybackSignal(hostMessage)) return;
    markReady();
    // Lecteur recréé : le lecteur ignore les commandes avant la première lecture ;
    // retour au même moment, en pause, dès qu'il joue (n° 19).
    if (resumeAt.current !== null) {
      send(seekCommand(resumeAt.current));
      send(playerCommand("pause"));
      resumeAt.current = null;
    }
  }

  /** Nouveau lecteur (recréé : réglages lus à la création seulement, WebView.ios.tsx l.44). */
  function reload() {
    reloaded.current = true;
    resumeAt.current = lastTime.current;
    resetPlayback();
    setGeneration((value) => value + 1);
  }

  function onPlayerError(code: number) {
    const action = tiktokErrorAction(code, reloaded.current, fallbackTried.current);
    if (action === "tap_to_play") return setNotice("tap_to_play");
    if (action === "reload") return reload();
    if (action === "fallback") {
      void fallbackToEmbed().then((switched) => {
        if (!switched) unavailable(code >= 2000 && code < 2100 ? "no_answer" : "player_error");
      });
      return;
    }
    unavailable(action);
  }

  function onLoadFailure() {
    if (!loadedRef.current) unavailable("no_answer");
  }

  function onCrash() {
    setNotice("reloaded");
    reload();
  }

  function askScreenConsent(): Promise<boolean> {
    if (!screenConsentNeeded()) return Promise.resolve(true);
    if (!alive.current) return Promise.resolve(false);
    setCapture({ kind: "consent" });
    return new Promise((resolve) => {
      consent.current = resolve;
    });
  }

  function answerConsent(go: boolean) {
    if (go) markScreenConsentShown();
    setCapture(go ? { kind: "busy", method: "screen" } : { kind: "idle" });
    consent.current?.(go);
    consent.current = null;
  }

  async function spotThisMoment() {
    // Garde posée avant le premier `await` : deux touchers rapides ne lancent qu'une capture (n° 2b).
    if (busy.current || !readyRef.current || !embedRef.current) return;
    const viewTag = findNodeHandle(frameRef.current);
    if (viewTag === null) return;
    busy.current = true;
    const platform = embedRef.current.platform;
    try {
      setMessage(null);
      setNotice(null);
      setCapture({ kind: "busy", method: null });
      // Pause : commande officielle de TikTok (note R1 §2), puis pause de toute
      // la vue web (iOS 15+), seule possible pour les codes d'intégration.
      send(playerCommand("pause"));
      await pauseMedia(viewTag);
      await delay(PLAYER_TIMINGS.settleAfterPauseMs);
      if (!alive.current) return;
      const result = await captureMoment({
        viewTag,
        confirmScreen: askScreenConsent,
        onMethod: (method) => {
          if (alive.current) setCapture({ kind: "busy", method });
        },
        stillWanted: () => alive.current,
      });
      // Écran quitté pendant la prise : l'image est effacée, rien ne s'ouvre.
      if (!alive.current) {
        if (result.frame) discardLocalFile(result.frame.uri);
        return;
      }
      track("player_capture", { platform, method: result.method ?? "none", outcome: captureOutcome(result), remembered: result.remembered, attempts: result.attempts.length });
      if (!result.frame || !result.method) return setCapture({ kind: "failed", reason: captureFailure(result.attempts) });
      // Même préparation qu'une photo partagée (1 600 px au plus, JPEG) ; la copie brute est aussitôt effacée.
      const prepared = await prepareSharedPhoto(result.frame.uri, result.frame.width, result.frame.height);
      discardLocalFile(result.frame.uri);
      if (!alive.current) {
        if (prepared.kind === "picked") discardLocalFile(prepared.uri);
        return;
      }
      if (prepared.kind !== "picked") return setCapture({ kind: "failed", reason: "failed" });
      beginFromPhoto(prepared.uri, { width: prepared.width, height: prepared.height });
      setCapture({ kind: "taken", method: result.method });
      router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
    } finally {
      busy.current = false;
    }
  }

  async function retryAfterBlack(method: CaptureMethod) {
    if (busy.current) return;
    track("player_fallback", { platform: held.platform, choice: "black_reported" });
    await reportBlackImage(method);
    if (alive.current) await spotThisMoment();
  }

  async function addScreenshot() {
    setMessage(null);
    track("player_fallback", { platform: held.platform, choice: "screenshot" });
    const picked = await importPhotoForSpotter();
    if (!alive.current) return;
    if (picked.kind === "unavailable") return setMessage(t.common.photoUnavailable);
    if (picked.kind !== "picked") return;
    beginFromPhoto(picked.uri, { width: picked.width, height: picked.height });
    router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
  }

  function openInApp() {
    track("player_fallback", { platform: held.platform, choice: "open_app" });
    void Linking.openURL(held.url).catch(() => {});
  }

  async function acceptGate() {
    track("player_consent", { platform: held.platform, choice: "play" });
    await grantPlayerConsent(held.platform);
    if (alive.current) void open(held.url, true);
  }

  const back = () => router.back();
  const close = () => closeSpotter(router);

  if (stage.kind === "opening" || stage.kind === "resolving") {
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={back} onClose={close} />
        <View style={styles.centered}>
          <ActivityIndicator color={color.encre} />
          <Text style={[styles.body, styles.center]}>{t.player.opening}</Text>
        </View>
        {stage.kind === "resolving" ? (
          <ShortLinkResolver
            url={stage.url}
            onResolved={(url) => void open(url, false)}
            onFailed={() => {
              if (alive.current) unavailable("short_link");
            }}
          />
        ) : null}
      </SafeAreaView>
    );
  }

  if (stage.kind === "gate") {
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={back} onClose={close} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.body}>{t.player.gate.body(name)}</Text>
          <Pressable style={styles.primary} onPress={() => void acceptGate()} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{t.player.gate.play}</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => {
              track("player_consent", { platform: held.platform, choice: "screenshot" });
              void addScreenshot();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryLabel}>{t.firstTry.linkHelp.addScreenshot}</Text>
          </Pressable>
          {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (stage.kind === "unavailable") {
    const retryable = stage.reason === "no_answer" || stage.reason === "network";
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={back} onClose={close} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            {t.player.unavailableTitle}
          </Text>
          <Text style={styles.body}>{unavailableText(stage.reason, name)}</Text>
          {retryable ? (
            <Pressable style={styles.primary} onPress={() => void open(held.url, true)} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.common.retry}</Text>
            </Pressable>
          ) : null}
          <View style={styles.box}>
            <ScreenshotFallback title={null} text={t.player.captureFailed.body(t.preview.screenshotShortcut.ios)} onAdd={() => void addScreenshot()} />
          </View>
          <Pressable style={styles.secondary} onPress={openInApp} accessibilityRole="button">
            <Text style={styles.secondaryLabel}>{t.player.openIn(name)}</Text>
          </Pressable>
          {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isBusy = capture.kind === "busy";
  const disabled = !ready || isBusy || capture.kind === "consent";
  const recording = capture.kind === "busy" && capture.method === "screen";
  const spotLabel = !ready && !loaded ? t.player.opening : recording ? t.player.recording : isBusy ? t.player.taking : t.player.spot;
  const isEmbed = stage.embed.variant === "oembed";
  const embedBox = embedHeight(embedSize, layout.height);
  const frameWidth = isEmbed ? embedWidth : layout.width;
  const frameHeight = isEmbed ? embedBox.height : layout.height;
  const spotButton = (
    <Pressable
      style={[styles.primary, layout.mode === "compact" ? styles.compactButton : null, disabled ? styles.primaryDisabled : null]}
      onPress={() => void spotThisMoment()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: isBusy }}
    >
      {recording ? <View style={styles.recordingDot} /> : isBusy || !loaded ? <ActivityIndicator color={color.surInactif} /> : null}
      <Text style={[styles.primaryLabel, disabled ? styles.primaryLabelDisabled : null]} numberOfLines={2}>
        {spotLabel}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen}>
      {layout.mode === "regular" ? <TopBar onBack={back} onClose={close} /> : null}
      <ScrollView contentContainerStyle={styles.playerContent} bounces={false}>
        {layout.mode === "regular" ? <Text style={styles.instruction}>{t.player.instruction}</Text> : null}
        <EmbeddedPlayer
          key={generation}
          embed={stage.embed}
          title={t.player.frameTitle(name)}
          baseUrl={BASE_URL}
          width={frameWidth}
          height={frameHeight}
          scrollable={isEmbed && embedBox.scroll}
          webRef={webRef}
          frameRef={frameRef}
          onMessage={onHostMessage}
          onLeave={() => setNotice("leave")}
          onLoadFailure={onLoadFailure}
          onCrash={onCrash}
        >
          {notice ? (
            <OverlayBox>
              <Text style={styles.body}>{noticeText(notice, name)}</Text>
              {notice === "leave" ? (
                <Pressable onPress={openInApp} style={styles.link} accessibilityRole="button">
                  <Text style={styles.linkLabel}>{t.player.openIn(name)}</Text>
                </Pressable>
              ) : null}
            </OverlayBox>
          ) : null}
          {capture.kind === "consent" ? (
            <OverlayBox>
              <Text style={styles.title} accessibilityRole="header">
                {t.player.screenConsent.title}
              </Text>
              <Text style={styles.body}>{t.player.screenConsent.body}</Text>
              <Pressable style={styles.primary} onPress={() => answerConsent(true)} accessibilityRole="button">
                <Text style={styles.primaryLabel}>{t.player.screenConsent.continue}</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => answerConsent(false)} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>{t.player.screenConsent.myself}</Text>
              </Pressable>
            </OverlayBox>
          ) : null}
          {capture.kind === "failed" ? (
            <OverlayBox>
              <ScreenshotFallback
                title={capture.reason === "cancelled" ? null : t.player.captureFailed.title}
                text={failureText(capture.reason)}
                onAdd={() => void addScreenshot()}
              />
            </OverlayBox>
          ) : null}
          {capture.kind === "taken" ? (
            <OverlayBox>
              <Pressable style={styles.link} onPress={() => void retryAfterBlack(capture.method)} accessibilityRole="button">
                <Text style={styles.linkLabel}>{t.player.blackImage}</Text>
              </Pressable>
            </OverlayBox>
          ) : null}
          {message ? (
            <OverlayBox>
              <ErrorMessage style={styles.message}>{message}</ErrorMessage>
            </OverlayBox>
          ) : null}
        </EmbeddedPlayer>
        {layout.mode === "regular" ? (
          <>
            {spotButton}
            <Text style={styles.privacy}>{t.player.privacy(name)}</Text>
          </>
        ) : (
          <View style={styles.compactBar}>
            <Pressable onPress={back} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
              <Text style={styles.back}>‹</Text>
            </Pressable>
            {spotButton}
            <Pressable onPress={close} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
              <Text style={styles.close}>{t.spotter.close}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md, maxWidth: 480, alignSelf: "center", width: "100%" },
  playerContent: { alignItems: "center", paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  center: { textAlign: "center" },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  back: { fontSize: 26, color: color.encre },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  instruction: { fontSize: font.secondary, color: color.acier, lineHeight: 18, textAlign: "center", minHeight: 36 },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, alignSelf: "stretch" },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600", textAlign: "center", flexShrink: 1 },
  primaryLabelDisabled: { color: color.surInactif },
  compactButton: { flex: 1, alignSelf: "auto" },
  compactBar: { flexDirection: "row", alignItems: "center", gap: space.sm, alignSelf: "stretch", minHeight: 60 },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.sm, alignSelf: "stretch" },
  overlayBox: { backgroundColor: color.porcelaine, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.sm, marginTop: space.sm },
  link: { minHeight: 44, justifyContent: "center" },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600", textDecorationLine: "underline" },
  message: { fontSize: font.caption, lineHeight: 18, alignSelf: "stretch" },
  privacy: { fontSize: font.caption, color: color.acier, lineHeight: 18, textAlign: "center" },
  // Pastille d'enregistrement (règle 2.5.14) : rouge des actions « danger », couleur à valider par le fondateur.
  recordingDot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: color.danger },
}));
