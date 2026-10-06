import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { closeSpotter } from "@/lib/spot-navigation";
import { prepareErrorMessage } from "@/lib/spot-flow";
import { getSpotVideo, holdSpotVideo, importSpotVideo, letGoSpotVideo, startSearchFromFrame, videoImportMessage } from "@/lib/spot-video";
import { clampTime, filmstripTimes, formatClock, formatClockTenths, type FramePreview, type OpenedVideo } from "@/lib/video-timeline";
import { VideoScrubber } from "@/components/video-scrubber";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

const STRIP_COUNT = 8;
const THUMBNAIL_EDGE = 160;
const PREVIEW_EDGE = 900;
/** Pas des boutons « − 0,1 s » et « + 0,1 s » (lot 4, temps 1 bis). */
const FINE_STEP_MS = 100;

/** Grande image du moment choisi : une seule extraction à la fois, la plus récente demandée. */
function useFramePreview(video: OpenedVideo | null, onError: () => void) {
  const [preview, setPreview] = useState<FramePreview | null>(null);
  const pending = useRef<number | null>(null);
  const running = useRef(false);
  async function drain(source: OpenedVideo) {
    running.current = true;
    while (pending.current !== null) {
      const time = pending.current;
      pending.current = null;
      try {
        setPreview(await source.preview(time, PREVIEW_EDGE));
      } catch {
        onError();
      }
    }
    running.current = false;
  }
  function request(time: number) {
    pending.current = time;
    if (video && !running.current) void drain(video);
  }
  return { preview, request, reset: () => setPreview(null) };
}

// Étape 1 d'une vidéo importée (lot 4) : la personne choisit l'image où la
// pièce est visible. Tout se passe sur l'appareil ; « Utiliser cette image »
// envoie cette seule image, comme une photo importée — même coût.
export default function VideoFrameScreen() {
  const router = useRouter();
  // Ouvert depuis un résultat de l'analyse automatique : le curseur part du
  // moment proposé par l'IA (lot 4, temps 1 bis), sinon du début.
  const { start } = useLocalSearchParams<{ start?: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const [video, setVideo] = useState<OpenedVideo | null>(() => getSpotVideo());
  const [thumbnails, setThumbnails] = useState<FramePreview[] | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<"frame" | "video" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const frame = useFramePreview(video, () => setMessage(t.video.frameError));

  // La vidéo reste ouverte tant qu'un écran du parcours en a besoin (voir
  // spot-video.ts) ; le dernier à partir la libère (copie effacée sur iPhone).
  useEffect(() => {
    holdSpotVideo();
    return letGoSpotVideo;
  }, []);

  // Frise et première image, à chaque nouvelle vidéo (ou nouvel essai).
  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    setStatus("loading");
    setThumbnails(null);
    frame.reset();
    video
      .filmstrip(filmstripTimes(video.durationMs, STRIP_COUNT), THUMBNAIL_EDGE)
      .then((images) => {
        if (cancelled) return;
        setThumbnails(images);
        const first = clampTime(Number(start) || 0, video.durationMs);
        setTimeMs(first);
        frame.request(first);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // Une préparation par vidéo et par essai.
  }, [video, attempt]);

  if (!video) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.lead}>{t.preview.missing}</Text>
          <Pressable style={styles.primary} onPress={() => closeSpotter(router)} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{t.preview.back}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  function moveTo(time: number) {
    if (!video) return;
    const next = clampTime(time, video.durationMs);
    setTimeMs(next);
    setMessage(null);
    frame.request(next);
  }

  async function handleUse() {
    setBusy("frame");
    setMessage(null);
    try {
      const draft = await startSearchFromFrame(timeMs);
      router.push({ pathname: "/spot/ciblage", params: { searchId: draft.searchId ?? "" } });
    } catch (error) {
      setMessage(error instanceof Error && error.message.startsWith("video_") ? t.video.frameError : prepareErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleAnother() {
    setBusy("video");
    setMessage(null);
    try {
      const result = await importSpotVideo();
      if (result.kind === "ready") setVideo(getSpotVideo());
      else setMessage(videoImportMessage(result));
    } finally {
      setBusy(null);
    }
  }

  const previewHeight = Math.min(Math.max(windowHeight * 0.42, 260), 440);
  const ready = status === "ready";
  const shown = frame.preview !== null && status !== "error";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.step}>{t.video.step}</Text>
        <Pressable onPress={() => closeSpotter(router)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{t.spotter.close}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging}>
        <Text style={styles.title} accessibilityRole="header">
          {t.video.title}
        </Text>
        <Text style={styles.caption}>{t.video.caption}</Text>

        <View style={[styles.previewBox, { height: previewHeight }]}>
          {/* Toujours en place, même vide : sur iPhone, une image arrivée en même temps
              que le composant pouvait s'afficher agrandie et rognée (expo-image appliquait
              « contain » après elle). Masquée tant qu'il n'y a pas d'image à montrer. */}
          <Image
            source={frame.preview}
            style={[styles.fill, shown ? null : styles.hidden]}
            contentFit="contain"
            accessible={shown}
            accessibilityLabel={shown ? t.video.frameLabel(formatClockTenths(timeMs, t.video.decimalSeparator)) : undefined}
          />
          {!shown && status === "loading" ? (
            <View style={[styles.overlay, styles.centeredBox]} accessibilityLabel={t.video.preparing}>
              <ActivityIndicator color={color.encre} />
              <Text style={styles.caption}>{t.video.preparing}</Text>
            </View>
          ) : null}
        </View>

        {status === "error" ? (
          <View style={styles.errorBlock}>
            <ErrorMessage style={styles.lead}>{t.video.loadError}</ErrorMessage>
            <Pressable style={styles.secondary} onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t.common.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.clock}>
              {formatClockTenths(timeMs, t.video.decimalSeparator)} / {formatClock(video.durationMs)}
            </Text>
            <VideoScrubber
              durationMs={video.durationMs}
              timeMs={timeMs}
              thumbnails={thumbnails}
              count={STRIP_COUNT}
              onChange={(time) => moveTo(time)}
              onDragChange={setDragging}
            />
            <View style={styles.fineRow}>
              <Pressable style={styles.fine} onPress={() => moveTo(timeMs - FINE_STEP_MS)} disabled={!ready} accessibilityRole="button" accessibilityLabel={t.video.stepBack}>
                <Text style={styles.fineLabel}>{t.video.stepBackShort}</Text>
              </Pressable>
              <Pressable style={styles.fine} onPress={() => moveTo(timeMs + FINE_STEP_MS)} disabled={!ready} accessibilityRole="button" accessibilityLabel={t.video.stepForward}>
                <Text style={styles.fineLabel}>{t.video.stepForwardShort}</Text>
              </Pressable>
            </View>
          </>
        )}

        {message ? <ErrorMessage style={styles.message}>{message}</ErrorMessage> : null}

        <Pressable
          style={[styles.primary, !ready || busy !== null ? styles.primaryDisabled : null]}
          onPress={handleUse}
          disabled={!ready || busy !== null}
          accessibilityRole="button"
        >
          {busy === "frame" ? <ActivityIndicator color={color.blanc} /> : null}
          <Text style={[styles.primaryLabel, !ready || busy !== null ? styles.primaryLabelDisabled : null]}>{busy === "frame" ? t.video.using : t.video.use}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={handleAnother} disabled={busy !== null} accessibilityRole="button">
          {busy === "video" ? <ActivityIndicator color={color.encre} /> : null}
          <Text style={styles.secondaryLabel}>{t.video.another}</Text>
        </Pressable>
        <Text style={styles.privacy}>{t.video.privacy}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  back: { fontSize: 26, color: color.encre },
  step: { fontSize: font.caption, color: color.acier },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29 },
  caption: { fontSize: font.caption, color: color.acier, marginTop: 6, lineHeight: 18 },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  previewBox: { marginTop: space.md, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  hidden: { opacity: 0 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  centeredBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  clock: { fontSize: font.caption, color: color.acier, textAlign: "center", marginVertical: space.sm, fontVariant: ["tabular-nums"] },
  fineRow: { flexDirection: "row", justifyContent: "center", gap: space.md, marginTop: space.sm },
  fine: { minHeight: 44, minWidth: 88, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  fineLabel: { fontSize: font.secondary, color: color.encre, fontVariant: ["tabular-nums"] },
  errorBlock: { marginTop: space.md, gap: space.sm },
  message: { fontSize: font.caption, marginTop: space.md },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  privacy: { fontSize: font.caption, color: color.acier, marginTop: space.md, lineHeight: 18, textAlign: "center" },
}));
