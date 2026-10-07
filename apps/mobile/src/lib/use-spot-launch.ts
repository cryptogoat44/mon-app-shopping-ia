// Enchaînement de l'écran unique du Spotter (lot 4 ter) : « Lancer », l'accord
// au premier usage, l'attente, les replis. La logique sans écran est dans
// spot-launch.ts (testée).
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { t } from "../i18n";
import { recordVideoAiChoice } from "./api";
import { track } from "./analytics";
import { closeSpotter } from "./spot-navigation";
import { draftImageUri, type SpotDraft } from "./spot-draft";
import { checkVideoAi, identifyNextMoment, launchPhoto, launchVideo, photoCrop, type LaunchOutcome, type VideoAiChoice, type VideoAiReadiness } from "./spot-launch";
import type { AutoFailure } from "./video-auto";
import type { FramePreview, OpenedVideo } from "./video-timeline";
import type { WaitingImage } from "../components/spot-waiting";

/** États de l'écran unique ; pendant « working », l'attente occupe tout l'écran. */
export type LaunchPhase =
  | { kind: "ask" }
  | { kind: "consent" }
  | { kind: "working" }
  | { kind: "not_found" }
  | { kind: "failed"; reason: Exclude<AutoFailure, "consent"> | "check" }
  | { kind: "prepare_failed" };

/** Disponibilité de l'IA et accord de la personne : demandés en arrière-plan
 * dès l'ouverture (vidéo seulement), redemandés au lancement en cas d'échec. */
function useVideoAiReadiness(active: boolean) {
  const pending = useRef<Promise<VideoAiReadiness> | null>(null);
  const [readiness, setReadiness] = useState<VideoAiReadiness | null>(null);
  const load = useCallback(() => {
    const request = checkVideoAi();
    pending.current = request;
    request.then(
      (value) => pending.current === request && setReadiness(value),
      () => {
        if (pending.current === request) pending.current = null;
      }
    );
    return request;
  }, []);
  useEffect(() => {
    if (active) load().catch(() => undefined);
  }, [active, load]);
  /** Choix fait sur cet écran : une réponse plus ancienne, arrivée en retard, est ignorée. */
  function decide(choice: VideoAiChoice) {
    const next = { enabled: readiness?.enabled ?? true, choice };
    pending.current = Promise.resolve(next);
    setReadiness(next);
  }
  return { readiness, decide, ensure: () => pending.current ?? load() };
}

function draftImage(draft: SpotDraft, crop = draft.crop): WaitingImage | null {
  const uri = draftImageUri(draft);
  return uri ? { source: { uri }, size: draft.imageSize, crop } : null;
}

/** Chaque lancement a son numéro : le résultat d'un lancement annulé est
 * ignoré. Le résultat s'ouvre par-dessus l'écran : la vidéo reste ouverte
 * pour les corrections, et un retour ramène à la question, mots compris. */
function useLaunchRun(auto: boolean) {
  const router = useRouter();
  const [phase, setPhase] = useState<LaunchPhase>(auto ? { kind: "working" } : { kind: "ask" });
  const [waitingImage, setWaitingImage] = useState<WaitingImage | null>(null);
  const run = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const showingResult = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!showingResult.current) return;
      showingResult.current = false;
      setPhase({ kind: "ask" });
    }, [])
  );
  // Quitter l'écran abandonne la requête en cours.
  useEffect(() => () => run.current.controller?.abort(), []);

  function begin(image: WaitingImage | null) {
    run.current.controller?.abort();
    const controller = new AbortController();
    run.current = { id: run.current.id + 1, controller };
    setWaitingImage(image);
    setPhase({ kind: "working" });
    return { id: run.current.id, signal: controller.signal };
  }
  const isCurrent = (id: number) => id === run.current.id;
  function stop() {
    run.current.controller?.abort();
    run.current = { id: run.current.id + 1, controller: null };
  }
  /** Fin d'un lancement : résultats, ou état de repli (sauf annulation). */
  function settle(id: number, outcome: LaunchOutcome, onConsentRequired: () => void) {
    if (!isCurrent(id) || outcome.kind === "cancelled") return;
    run.current.controller = null;
    if (outcome.kind === "result") {
      showingResult.current = true;
      router.push({ pathname: "/spot/result", params: outcome.searchId ? { searchId: outcome.searchId } : {} });
    } else if (outcome.kind === "consent_required") onConsentRequired();
    else setPhase(outcome);
  }
  return { router, phase, setPhase, waitingImage, setWaitingImage, begin, isCurrent, stop, settle };
}

/** Écran d'accord : « Accepter », ou le lien discret qui enregistre un refus
 * (la question n'est plus reposée) puis ouvre le curseur, sans IA ni envoi
 * d'image. */
function useConsentChoice(decide: (choice: VideoAiChoice) => void, onGranted: () => void, onDeclined: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    setSaving(true);
    setError(null);
    try {
      await recordVideoAiChoice(true);
    } catch {
      setError(t.videoAuto.consentFailed);
      return;
    } finally {
      setSaving(false);
    }
    track("video_ai_consent", { decision: "granted", context: "first_use" });
    decide("granted");
    onGranted();
  }
  async function decline() {
    setSaving(true);
    try {
      await recordVideoAiChoice(false);
      track("video_ai_consent", { decision: "declined", context: "first_use" });
      decide("declined");
    } catch {
      // Refus non enregistré (réseau) : sans conséquence — aucune image ne
      // part sans accord ; la question sera simplement reposée.
    } finally {
      setSaving(false);
    }
    onDeclined();
  }
  return { saving, error, accept: () => void accept(), decline: () => void decline() };
}

export interface LaunchInput {
  source: "video" | "photo";
  video: OpenedVideo | null;
  draft: SpotDraft | null;
  preview: FramePreview | null;
  query: string;
  /** Lancer dès l'ouverture (dernière vidéo de la galerie, mots tapés sur l'accueil). */
  auto: boolean;
}

export function useSpotLaunch({ source, video, draft, preview, query, auto }: LaunchInput) {
  const flow = useLaunchRun(auto);
  const { router, setPhase } = flow;
  const ai = useVideoAiReadiness(source === "video");
  const consent = useConsentChoice(
    ai.decide,
    () => void runVideo(),
    () => {
      setPhase({ kind: "ask" });
      chooseMyself();
    }
  );
  const previewImage = preview ? { source: preview } : null;
  const consentRequired = () => {
    ai.decide("ask");
    setPhase({ kind: "consent" });
  };
  const showPrepared = (id: number) => (prepared: SpotDraft) => flow.isCurrent(id) && flow.setWaitingImage(draftImage(prepared));

  async function runVideo() {
    if (!video) return closeSpotter(router);
    const { id, signal } = flow.begin(previewImage);
    flow.settle(id, await launchVideo(video, query, signal, showPrepared(id)), consentRequired);
  }
  // Les moments sont déjà trouvés : réessayer ne refait que la préparation (aucun appel à l'IA).
  async function retryPrepare() {
    if (!video) return closeSpotter(router);
    const { id, signal } = flow.begin(previewImage);
    flow.settle(id, await identifyNextMoment(video, signal, showPrepared(id)), consentRequired);
  }
  async function runPhoto() {
    if (!draft) return closeSpotter(router);
    const { id, signal } = flow.begin(draftImage(draft, photoCrop(draft)));
    flow.settle(id, await launchPhoto(draft, query, signal), consentRequired);
  }

  /** Curseur manuel ; les mots tapés suivent jusqu'au recadrage. */
  function chooseMyself() {
    const words = query.trim();
    router.push({ pathname: "/spot/video", params: words ? { query: words } : {} });
  }
  function proceed(ready: VideoAiReadiness) {
    if (!ready.enabled) return setPhase({ kind: "failed", reason: "disabled" });
    if (ready.choice === "ask") return setPhase({ kind: "consent" });
    if (ready.choice === "declined") {
      setPhase({ kind: "ask" });
      return chooseMyself();
    }
    void runVideo();
  }
  /** « Lancer ». Vidéo : selon l'IA et l'accord ; si leur vérification n'a
   * pas encore répondu (réveil du serveur), l'attente s'affiche déjà. */
  async function launch() {
    if (source === "photo") return runPhoto();
    if (ai.readiness) return proceed(ai.readiness);
    const { id } = flow.begin(previewImage);
    try {
      const ready = await ai.ensure();
      if (flow.isCurrent(id)) proceed(ready);
    } catch {
      if (flow.isCurrent(id)) setPhase({ kind: "failed", reason: "check" });
    }
  }

  useEffect(() => {
    if (auto) void launch();
    // Une seule fois, à l'ouverture.
  }, []);

  return {
    phase: flow.phase,
    waitingImage: flow.waitingImage,
    saving: consent.saving,
    consentError: consent.error,
    declined: ai.readiness?.choice === "declined",
    launch: () => void launch(),
    cancel: () => {
      flow.stop();
      track("spot_cancelled");
      setPhase({ kind: "ask" });
    },
    close: () => {
      flow.stop();
      closeSpotter(router);
    },
    accept: consent.accept,
    decline: consent.decline,
    chooseMyself,
    retry: () => void (flow.phase.kind === "failed" && flow.phase.reason === "check" ? launch() : runVideo()),
    retryPrepare: () => void retryPrepare(),
    ask: () => setPhase({ kind: "ask" }),
    enableAi: () => setPhase({ kind: "consent" }),
  };
}
