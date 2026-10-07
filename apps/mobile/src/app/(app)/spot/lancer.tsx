import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { VIDEO_AI, type CropRect } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { containsLink } from "@/lib/link-detection";
import { closeSpotter } from "@/lib/spot-navigation";
import { DEFAULT_CROP } from "@/lib/crop-geometry";
import { draftImageUri, getDraft, type SpotDraft } from "@/lib/spot-draft";
import { getSpotVideo, holdSpotVideo, importSpotVideo, letGoSpotVideo, videoImportMessage } from "@/lib/spot-video";
import { useSpotLaunch, type LaunchPhase } from "@/lib/use-spot-launch";
import { clampTime, formatClock, type FramePreview, type OpenedVideo } from "@/lib/video-timeline";
import { AskView, ConsentView, FallbackView, LaunchPreview, PhotoFrame, type Action, type AskProps } from "@/components/spot-launch-views";
import { SpotWaitingScreen } from "@/components/spot-waiting";
import { themedStyles } from "@/theme/themed-styles";

const PREVIEW_EDGE = 900;
const SLOW_VIDEO_MS = 45_000;
const SLOW_PHOTO_MS = 20_000;

interface Media {
  source: "video" | "photo";
  video: OpenedVideo | null;
  draft: SpotDraft | null;
}

function initialMedia(source: string | undefined): Media {
  return source === "photo" ? { source: "photo", video: null, draft: getDraft() } : { source: "video", video: getSpotVideo(), draft: null };
}

/** Aperçu : une image du milieu de la vidéo, ou la photo elle-même. */
function useLaunchPreview({ video, draft }: Media) {
  const [state, setState] = useState<{ source: FramePreview | null; failed: boolean }>({ source: null, failed: false });
  useEffect(() => {
    if (!video) {
      setState({ source: draft?.localImageUri ? { uri: draft.localImageUri } : null, failed: !draft?.localImageUri });
      return;
    }
    let cancelled = false;
    setState({ source: null, failed: false });
    // Une vignette « de frise » : gardée jusqu'à la libération de la vidéo (sur le
    // site, les grandes images du curseur sont oubliées au fil des déplacements).
    video
      .filmstrip([clampTime(video.durationMs / 2, video.durationMs)], PREVIEW_EDGE)
      .then(([source]) => !cancelled && setState({ source: source ?? null, failed: !source }))
      .catch(() => !cancelled && setState({ source: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [video, draft]);
  return state;
}

/** Vue de chaque état, hors attente (plein écran). Le choix manuel n'apparaît
 * qu'en repli : pièce non repérée ou panne. */
function PhaseContent({ phase, flow, ask }: { phase: LaunchPhase; flow: ReturnType<typeof useSpotLaunch>; ask: AskProps }) {
  const router = useRouter();
  const manual: Action = { label: t.videoAuto.chooseMyself, onPress: flow.chooseMyself };
  switch (phase.kind) {
    case "ask":
    case "working":
      return <AskView {...ask} />;
    case "consent":
      return (
        <ConsentView saving={flow.saving} error={flow.consentError} onAccept={flow.accept} onChooseMyself={flow.decline} onPolicy={() => router.push("/confidentialite")} />
      );
    case "not_found":
      return <FallbackView failure={false} title={t.videoAuto.notFoundTitle} text={t.videoAuto.notFound} actions={[manual, { label: t.videoAuto.editQuery, onPress: flow.ask }]} />;
    case "failed": {
      const retryable = phase.reason === "check" || phase.reason === "unavailable" || phase.reason === "network" || phase.reason === "video";
      const text = phase.reason === "check" ? t.videoAuto.checkFailed : t.videoAuto.failure[phase.reason];
      return <FallbackView failure title={t.videoAuto.failedTitle} text={text} actions={retryable ? [{ label: t.common.retry, onPress: flow.retry }, manual] : [manual]} />;
    }
    case "prepare_failed":
      return <FallbackView failure title={t.videoAuto.failedTitle} text={t.video.frameError} actions={[{ label: t.common.retry, onPress: flow.retryPrepare }, manual]} />;
  }
}

/** Parcours perdu (page rechargée sur le site) : on repart proprement. */
function MissingView() {
  const router = useRouter();
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

/** La question : mots, lien collé (une autre vidéo s'ajoute ici même), libellé de « Lancer ». */
function useAsk(media: Media, setMedia: (media: Media) => void, query: string, setQuery: (value: string) => void, flow: ReturnType<typeof useSpotLaunch>): AskProps {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [addingVideo, setAddingVideo] = useState(false);

  async function addVideo() {
    setMessage(null);
    setAddingVideo(true);
    try {
      const result = await importSpotVideo();
      if (result.kind !== "ready") return setMessage(videoImportMessage(result));
      setMedia({ source: "video", video: getSpotVideo(), draft: null });
      setQuery("");
      router.setParams({ source: "video" });
    } finally {
      setAddingVideo(false);
    }
  }

  const isVideo = media.source === "video";
  const linkInQuery = containsLink(query);
  const enoughWords = !isVideo || flow.declined || query.trim().length >= VIDEO_AI.queryMinLength;
  return {
    autoFocus: isVideo,
    query,
    onQuery: (value) => {
      setQuery(value);
      setMessage(null);
    },
    onLaunch: flow.launch,
    launchLabel: isVideo && flow.declined ? t.launch.chooseImage : t.launch.launch,
    canLaunch: enoughWords && !linkInQuery,
    declined: isVideo && flow.declined,
    onEnableAi: flow.enableAi,
    linkInQuery,
    onAddVideo: () => void addVideo(),
    addingVideo,
    message,
    privacy: isVideo ? (flow.declined ? t.video.privacy : t.videoAuto.privacyNote) : null,
  };
}

// Parcours unique du Spotter (lot 4 ter) : après le choix d'une vidéo ou
// d'une photo, un seul écran — l'aperçu, « Que cherchez-vous ? » prêt à la
// saisie, « Lancer ». Tout le reste s'enchaîne seul jusqu'aux résultats.
export default function LaunchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string; query?: string; auto?: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const [media, setMedia] = useState(() => initialMedia(params.source));
  const [query, setQuery] = useState(typeof params.query === "string" ? params.query : "");
  // Photo : la zone entourée ; le défilement s'arrête pendant qu'on déplace le cadre.
  const [crop, setCrop] = useState<CropRect>(() => media.draft?.crop ?? DEFAULT_CROP);
  const [dragging, setDragging] = useState(false);
  const preview = useLaunchPreview(media);
  const flow = useSpotLaunch({ ...media, preview: preview.source, query, crop: media.source === "photo" ? crop : null, auto: params.auto === "1" });
  const ask = useAsk(media, setMedia, query, setQuery, flow);
  // Photo : le cadre occupe le haut de l'écran ; quand le clavier s'ouvre, on
  // descend jusqu'à « Lancer », sinon caché dessous (constaté sur iPhone).
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (media.source !== "photo") return;
    const subscription = Keyboard.addListener("keyboardDidShow", () => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => subscription.remove();
  }, [media.source]);

  // La vidéo reste ouverte tant que cet écran est dans le parcours (résultats,
  // corrections) ; le dernier écran à partir la libère (copie effacée sur iPhone).
  useEffect(() => {
    holdSpotVideo();
    return letGoSpotVideo;
  }, []);
  // Une autre vidéo choisie entre-temps (depuis le curseur) : c'est elle qui compte.
  useFocusEffect(
    useCallback(() => {
      const current = getSpotVideo();
      if (media.source === "video" && current && current !== media.video) setMedia({ source: "video", video: current, draft: null });
    }, [media])
  );

  if (!media.video && !media.draft) return <MissingView />;
  const photoUri = media.source === "photo" && media.draft ? draftImageUri(media.draft) : null;
  if (flow.phase.kind === "working") {
    const isVideo = media.source === "video";
    const identifying = !isVideo || Boolean(flow.waitingImage?.crop);
    return (
      <SpotWaitingScreen
        image={flow.waitingImage}
        title={identifying ? t.analysis.title : t.launch.waitingVideo}
        query={query}
        usual={isVideo ? t.launch.usualVideo : t.analysis.usual}
        slowAfterMs={isVideo ? SLOW_VIDEO_MS : SLOW_PHOTO_MS}
        onCancel={flow.cancel}
        onClose={flow.close}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Pressable onPress={flow.close} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{t.spotter.close}</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {flow.phase.kind === "ask" && photoUri ? (
          <PhotoFrame uri={photoUri} crop={crop} onChange={setCrop} onDragChange={setDragging} height={Math.min(Math.max(windowHeight * 0.42, 220), 400)} />
        ) : flow.phase.kind === "ask" ? (
          <LaunchPreview
            source={preview.source}
            failed={preview.failed}
            duration={media.video ? formatClock(media.video.durationMs) : null}
            height={Math.min(Math.max(windowHeight - 640, 110), 300)}
          />
        ) : null}
        <PhaseContent phase={flow.phase} flow={flow} ask={ask} />
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
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center" },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
