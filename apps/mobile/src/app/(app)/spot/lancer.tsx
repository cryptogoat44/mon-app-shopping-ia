import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { VIDEO_AI, type CropRect } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { containsLink } from "@/lib/link-detection";
import { closeSpotter } from "@/lib/spot-navigation";
import { isAdjustedCrop } from "@/lib/crop-geometry";
import { WHOLE_IMAGE_ZONE, zoneFromCrop, zoneReady, type PieceZone } from "@/lib/piece-trace";
import { draftImageUri, getDraft, leaveLaunchScreen, updateDraft, type SpotDraft } from "@/lib/spot-draft";
import { getSpotVideo, holdSpotVideo, importSpotVideo, letGoSpotVideo, videoImportMessage } from "@/lib/spot-video";
import { blocksLaunch } from "@/lib/search-limits";
import { useSearchLimits } from "@/lib/use-search-limits";
import { useSpotLaunch, type LaunchPhase } from "@/lib/use-spot-launch";
import { clampTime, formatClock, type FramePreview, type OpenedVideo } from "@/lib/video-timeline";
import { AskView, ConsentView, FallbackView, LaunchPreview, PhotoFrame, type Action, type AskProps } from "@/components/spot-launch-views";
import { SpotWaitingScreen } from "@/components/spot-waiting";
import { CancelledNote, SearchRecoveryView } from "@/components/search-recovery";
import { SearchLimitsNotice } from "@/components/search-limits-notice";
import { VideoContextLabel } from "@/components/video-context-label";
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

/** Photo dont la zone est déjà connue (moment d'une vidéo, entouré sur
 * l'écran des moments ; retour sur cet écran après une recherche annulée) :
 * elle est retracée, modifiable. Sinon, rien tant que la personne n'a pas
 * entouré la pièce. */
function initialZone(media: Media): PieceZone | null {
  const crop = media.source === "photo" ? (media.draft?.crop ?? null) : null;
  if (!crop) return null;
  return isWholeImage(crop) ? { ...WHOLE_IMAGE_ZONE } : zoneFromCrop(crop);
}

const isWholeImage = (crop: CropRect) => crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;

/** Mots de départ : ceux de l'adresse (mots tapés sur l'accueil), sinon,
 * pour une photo, ceux du brouillon — la description d'un lien vidéo
 * analysé (video-link-run.ts), gardée hors de l'adresse. Sans eux, le
 * lancement automatique les effacerait du brouillon (launchPhoto). */
function initialQuery(param: string | string[] | undefined, media: Media): string {
  if (typeof param === "string") return param;
  return media.source === "photo" ? (media.draft?.words ?? "") : "";
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
/** Hauteur fixe de l'écran « Entourez la pièce » autour de la photo (lot « fidélité aux maquettes ») :
 * barre 44 + titre 34 + écart 2 + consigne 18 + écart 12 (la photo) + écart 4 et « Utiliser toute l'image » 44
 * + écart 8 et champ 44 + écart 12 et bouton 52 + 9 de réserve = 283. S'y ajoutent, mesurées, la pastille de la
 * vidéo associée et la note des mots (toujours au-dessus du bouton). */
const PHOTO_FIXED_HEIGHT = 283;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function PhaseContent({ phase, flow, ask }: { phase: LaunchPhase; flow: ReturnType<typeof useSpotLaunch>; ask: AskProps }) {
  const router = useRouter();
  const manual: Action = { label: t.videoAuto.chooseMyself, onPress: flow.chooseMyself };
  switch (phase.kind) {
    case "ask":
    case "working":
      return (
        <>
          {phase.kind === "ask" && phase.cancelled ? <CancelledNote /> : null}
          <AskView {...ask} />
        </>
      );
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
    case "unsettled":
      return <SearchRecoveryView state={phase.state} onRelaunch={flow.relaunch} onCheck={flow.recheck} back={{ label: t.common.back, onPress: flow.ask }} />;
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
function useAsk(
  media: Media,
  setMedia: (media: Media) => void,
  query: string,
  setQuery: (value: string) => void,
  flow: ReturnType<typeof useSpotLaunch>,
  zone: PieceZone | null
): AskProps {
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
  // Les mots ne servent qu'à l'IA, pour trouver la pièce dans la vidéo (petit lot, 2026-10-25).
  const withQuery = isVideo && !flow.declined;
  const linkInQuery = withQuery && containsLink(query);
  const enoughWords = !withQuery || query.trim().length >= VIDEO_AI.queryMinLength;
  // Photo : des mots facultatifs, qui trient les propositions (petit lot 2, 2026-10-27).
  const photoWords = media.source === "photo";
  return {
    withQuery,
    photoWords,
    // Moment d'un lien vidéo : la description, envoyée à Google Shopping si rien n'a de prix (lien vidéo sans prix).
    linkWords: photoWords && media.draft?.textSearchIfNoPrice === true,
    // Tant que la pièce n'est pas entourée, avec ou sans mots (lots « premier essai » et « entourer la pièce »).
    frameHint: photoWords && !isAdjustedCrop(zone?.crop ?? null),
    autoFocus: isVideo,
    query,
    onQuery: (value) => {
      setQuery(value);
      setMessage(null);
    },
    onLaunch: flow.launch,
    // Photo : « Chercher cette pièce » (maquette « Écrin » 3) ; vidéo : « Lancer », ou « Choisir l'image » sans l'IA.
    launchLabel: photoWords ? t.launch.searchPiece : isVideo && flow.declined ? t.launch.chooseImage : t.launch.launch,
    // Photo : « Lancer » attend la zone, dont le résultat dépend (lot entourer la pièce).
    canLaunch: enoughWords && !linkInQuery && (!photoWords || zoneReady(zone)),
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
  const insets = useSafeAreaInsets();
  // Photo : hauteurs mesurées de la pastille de la vidéo associée et de la note des mots, sous la photo.
  const [contextHeights, setContextHeights] = useState({ context: 0, note: 0 });
  const contextHeight = contextHeights.context + contextHeights.note;
  const measureAsk = useCallback((part: "context" | "note", height: number) => {
    setContextHeights((previous) => (Math.abs(previous[part] - height) < 1 ? previous : { ...previous, [part]: height }));
  }, []);
  const [media, setMedia] = useState(() => initialMedia(params.source));
  const [query, setQuery] = useState(() => initialQuery(params.query, media));
  // Photo : la zone entourée (rien tant que la pièce n'est pas entourée) ; le
  // défilement s'arrête pendant le tracé.
  const [zone, setZone] = useState<PieceZone | null>(() => initialZone(media));
  // Le cadre affiché est encore celui de l'IA (jamais retouché par la personne).
  const [zoneFromAi, setZoneFromAi] = useState(() => media.draft?.zoneByAi === true && initialZone(media) !== null);
  const [dragging, setDragging] = useState(false);
  const preview = useLaunchPreview(media);
  /** La personne entoure la pièce (ou choisit l'image entière) : la zone est la sienne, plus celle de l'IA. */
  const changeZone = (next: PieceZone) => {
    setZone(next);
    if (zoneFromAi) {
      setZoneFromAi(false);
      updateDraft({ zoneByAi: false });
    }
  };
  // Lot limites annoncées : Spotter en pause ou part du jour épuisée — le
  // serveur refuserait : « Lancer » est désactivé et l'écran dit pourquoi
  // (jamais de lancement automatique non plus). Compteur inconnu : rien ne change.
  const limits = useSearchLimits();
  const blocked = blocksLaunch(limits.notice);
  const flow = useSpotLaunch({ ...media, preview: preview.source, query, crop: media.source === "photo" ? (zone?.crop ?? null) : null, auto: params.auto === "1" && !blocked });
  // Lancement automatique : une seule fois (il est déjà parti, effet de
  // useSpotLaunch). « auto » est aussitôt retiré de l'adresse : sur le site,
  // revenir sur cet écran par « Précédent » puis « Suivant » du navigateur
  // rouvre la question, sans relancer une recherche (payante) sans un geste.
  useEffect(() => {
    if (params.auto !== undefined) router.setParams({ auto: undefined });
    // Une seule fois, à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ask = useAsk(media, setMedia, query, setQuery, flow, zone);
  // Photo : l'image occupe le haut de l'écran ; quand le clavier s'ouvre, on
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
  // Écran quitté (« ‹ », ou retiré de la pile) : l'image à ne pas garder
  // (instantané du lecteur, capture de la recherche d'image d'iOS) est effacée
  // avec son brouillon. Les résultats s'ouvrent par-dessus cet écran : il
  // reste en place pendant la recherche, et après un échec (« Relancer »).
  useEffect(() => leaveLaunchScreen, []);
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
        query={identifying ? "" : query}
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
        <Pressable onPress={() => router.back()} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹ {t.common.back}</Text>
        </Pressable>
        <Pressable onPress={flow.close} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{t.spotter.close}</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {flow.phase.kind === "ask" && blocked ? <SearchLimitsNotice notice={limits.notice} style={styles.limits} /> : null}
        {flow.phase.kind === "ask" && photoUri ? (
          <PhotoFrame
            uri={photoUri}
            zone={zone}
            onChange={changeZone}
            onDragChange={setDragging}
            // Lot « fidélité aux maquettes » : la photo la plus grande possible, champ et bouton visibles sans défiler.
            height={clamp(windowHeight - insets.top - insets.bottom - PHOTO_FIXED_HEIGHT - contextHeight, 220, 480)}
            caption={zoneFromAi ? t.targeting.aiCaption : t.targeting.caption}
          />
        ) : flow.phase.kind === "ask" ? (
          <LaunchPreview
            source={preview.source}
            failed={preview.failed}
            duration={media.video ? formatClock(media.video.durationMs) : null}
            height={Math.min(Math.max(windowHeight - 640, 110), 300)}
          />
        ) : null}
        {/* Mission « liens vidéo » : recherche associée à une vidéo (lecteur, ou lien en attente), avec sa croix — sous la photo, avant le bouton. */}
        <PhaseContent
          phase={flow.phase}
          flow={flow}
          ask={{ ...(blocked ? { ...ask, canLaunch: false } : ask), context: photoUri ? <VideoContextLabel /> : undefined, onMeasure: measureAsk }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  nav: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  navSide: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  close: { fontSize: font.body, fontWeight: "400", color: color.encre },
  // « ‹ Retour » écrit en toutes lettres : sur cet écran, le geste « glisser pour revenir » est coupé.
  back: { fontSize: font.body, fontWeight: "400", color: color.encre },
  content: { paddingHorizontal: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  limits: { marginTop: 0, marginBottom: space.md },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center" },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
