// Lot « vidéo auto » : enchaînement de l'analyse d'un lien sur l'écran
// « vidéo partagée » (spot/lecteur) — « Que cherchez-vous dans cette
// vidéo ? », l'accord « analyse_video_ia » s'il manque ou s'il a été donné
// sur l'ancien texte, qui ne parlait que des vidéos du téléphone (texte
// commun aux deux écrans, videoLinkAiChoice), l'attente, les moments, puis la
// recherche habituelle.
// La logique sans écran est dans video-link-analysis.ts et video-link-run.ts
// (testées).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import type { VideoPlatform } from "@monapp/shared-types";
import { t } from "../i18n";
import { fetchConsentStatus, recordVideoAiChoice } from "./api";
import { track } from "./analytics";
import { videoLinkAiChoice, type VideoAiChoice } from "./spot-launch";
import { linkAnalysisRequest, type LinkAnalysis, type LinkFailureInfo, type QueryProblem } from "./video-link-analysis";
import { runLinkAnalysis, startMomentSearch, type LinkSpotOrigin } from "./video-link-run";

export type LinkAiPhase =
  /** Le champ et « Trouver la pièce » ; `problem` : ce qui ne va pas dans les mots. */
  | { kind: "ask"; problem: QueryProblem | null }
  | { kind: "consent" }
  | { kind: "working"; startedAt: number }
  /** Moments trouvés ; `selected` : celui qui partira (0 = le meilleur, présélectionné). */
  | { kind: "moments"; analysis: LinkAnalysis; selected: number }
  | { kind: "failed"; info: LinkFailureInfo };

export interface LinkAiInput {
  /** Analyse allumée sur le serveur : rien n'est demandé (pas même l'accord) tant qu'elle ne l'est pas. */
  active: boolean;
  /** Lien de la vidéo (adresse reconnue par le serveur quand elle est connue). */
  url: string;
  platform: VideoPlatform | null;
  origin: LinkSpotOrigin;
  /** Refus de l'accord : la capture d'écran prend le relais. */
  onDeclined: () => void;
}

export function useVideoLinkAnalysis({ active, url, platform, origin, onDeclined }: LinkAiInput) {
  const router = useRouter();
  const [phase, setPhase] = useState<LinkAiPhase>({ kind: "ask", problem: null });
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Accord lu en arrière-plan dès l'ouverture : « Trouver la pièce » n'attend pas.
  const choice = useRef<Promise<VideoAiChoice> | null>(null);
  // Chaque analyse a son numéro : la réponse d'une analyse annulée est ignorée.
  const run = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const alive = useRef(true);

  function loadChoice(): Promise<VideoAiChoice> {
    const request = fetchConsentStatus().then(videoLinkAiChoice);
    choice.current = request;
    request.catch(() => {
      if (choice.current === request) choice.current = null;
    });
    return request;
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current.controller?.abort();
    };
  }, []);
  useEffect(() => {
    if (active && !choice.current) loadChoice().catch(() => undefined);
    // Une fois, dès que l'analyse est connue comme allumée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function analyze() {
    const built = linkAnalysisRequest(url, query);
    if ("problem" in built) return setPhase({ kind: "ask", problem: built.problem });
    if (!platform) return;
    run.current.controller?.abort();
    const controller = new AbortController();
    const id = run.current.id + 1;
    run.current = { id, controller };
    setPhase({ kind: "working", startedAt: Date.now() });
    const outcome = await runLinkAnalysis(built.request, platform, controller.signal);
    if (!alive.current || run.current.id !== id || outcome.kind === "cancelled") return;
    run.current.controller = null;
    if (outcome.kind === "found") return setPhase({ kind: "moments", analysis: outcome.analysis, selected: 0 });
    // Accord retiré entre-temps (sur un autre appareil, par exemple), ou
    // donné sur un texte que le serveur n'accepte pas pour un lien : redemandé.
    if (outcome.info.failure === "consent") {
      choice.current = Promise.resolve("ask");
      return setPhase({ kind: "consent" });
    }
    setPhase({ kind: "failed", info: outcome.info });
  }

  /** « Trouver la pièce » : les mots d'abord, puis l'accord (demandé s'il
   * manque ou a été refusé : ce geste vaut demande), puis l'analyse. */
  async function find() {
    const built = linkAnalysisRequest(url, query);
    if ("problem" in built) return setPhase({ kind: "ask", problem: built.problem });
    setChecking(true);
    let current: VideoAiChoice;
    try {
      current = await (choice.current ?? loadChoice());
    } catch {
      if (alive.current) setPhase({ kind: "failed", info: { failure: "network", capacity: null } });
      return;
    } finally {
      if (alive.current) setChecking(false);
    }
    if (!alive.current) return;
    if (current !== "granted") return setPhase({ kind: "consent" });
    void analyze();
  }

  async function accept() {
    setSaving(true);
    setConsentError(null);
    try {
      await recordVideoAiChoice(true);
    } catch {
      if (alive.current) setConsentError(t.videoAuto.consentFailed);
      return;
    } finally {
      if (alive.current) setSaving(false);
    }
    track("video_ai_consent", { decision: "granted", context: "first_use" });
    choice.current = Promise.resolve("granted");
    if (alive.current) void analyze();
  }

  /** Refus : enregistré comme pour une vidéo du téléphone (aucune image ne
   * part sans accord), puis la capture d'écran. */
  async function decline() {
    setSaving(true);
    try {
      await recordVideoAiChoice(false);
      track("video_ai_consent", { decision: "declined", context: "first_use" });
      choice.current = Promise.resolve("declined");
    } catch {
      // Refus non enregistré (réseau) : sans conséquence, la question sera reposée.
    } finally {
      if (alive.current) setSaving(false);
    }
    if (!alive.current) return;
    setPhase({ kind: "ask", problem: null });
    onDeclined();
  }

  function cancel() {
    run.current.controller?.abort();
    run.current = { id: run.current.id + 1, controller: null };
    setPhase({ kind: "ask", problem: null });
  }

  function select(rank: number) {
    setPhase((current) => (current.kind === "moments" && current.analysis.moments[rank] ? { ...current, selected: rank } : current));
  }

  /** « Rechercher cette pièce » : la suite du parcours habituel (attente, résultats). */
  function search() {
    if (phase.kind !== "moments") return;
    if (!startMomentSearch(phase.analysis, phase.selected, origin)) return;
    router.push({ pathname: "/spot/lancer", params: { source: "photo", auto: "1" } });
  }

  return {
    phase,
    query,
    onQuery: (value: string) => {
      setQuery(value);
      if (phase.kind === "ask" && phase.problem) setPhase({ kind: "ask", problem: null });
    },
    checking,
    saving,
    consentError,
    find: () => void find(),
    accept: () => void accept(),
    decline: () => void decline(),
    cancel,
    select,
    search,
    editQuery: () => setPhase({ kind: "ask", problem: null }),
    retry: () => void find(),
  };
}

export type VideoLinkAnalysisFlow = ReturnType<typeof useVideoLinkAnalysis>;
