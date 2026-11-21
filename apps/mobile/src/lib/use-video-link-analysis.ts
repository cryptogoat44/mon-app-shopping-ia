// Lot « vidéo auto » : enchaînement de l'analyse d'un lien sur l'écran
// « vidéo partagée » (spot/lecteur) — « Que cherchez-vous dans cette
// vidéo ? », l'accord « analyse_video_ia » s'il manque ou s'il a été donné
// sur l'ancien texte, qui ne parlait que des vidéos du téléphone (texte
// commun aux deux écrans, videoLinkAiChoice), l'attente, les moments, puis la
// recherche habituelle.
// Lot « propositions » (Parcours 2, 21 novembre 2026) : quand le serveur le
// permet, « Voir les propositions de l'IA » lance la même analyse sans les
// mots (mode « pièces ») ; les pièces reçues restent en mémoire pour ce lien
// tant que l'écran est ouvert, « Réessayer » refait le dernier mode, et
// « Décrire la pièce autrement » ramène au champ, vide.
// La logique sans écran est dans video-link-analysis.ts et video-link-run.ts
// (testées).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import type { VideoLinkAnalysisRequest, VideoPlatform } from "@monapp/shared-types";
import { t } from "../i18n";
import { fetchConsentStatus, recordVideoAiChoice } from "./api";
import { track } from "./analytics";
import { videoLinkAiChoice, type VideoAiChoice } from "./spot-launch";
import { zoneFromCrop, type PieceZone } from "./piece-trace";
import { linkAnalysisRequest, linkPiecesRequest, type LinkAnalysis, type LinkFailureInfo, type LinkMode, type QueryProblem } from "./video-link-analysis";
import { runLinkAnalysis, startMomentSearch, type LinkSpotOrigin } from "./video-link-run";

export type LinkAiPhase =
  /** Le champ et « Trouver la pièce » ; `problem` : ce qui ne va pas dans les mots. */
  | { kind: "ask"; problem: QueryProblem | null }
  | { kind: "consent" }
  /** `mode` : avec les mots, ou les pièces (l'attente ne montre alors pas le texte du champ). */
  | { kind: "working"; startedAt: number; mode: LinkMode }
  /** Moments trouvés ; `selected` : celui qui partira (0 = le meilleur,
   * présélectionné) ; `zone` : la pièce entourée sur son image (au départ le
   * cadre de l'IA, `zoneFromAi`). */
  | { kind: "moments"; analysis: LinkAnalysis; selected: number; zone: PieceZone; zoneFromAi: boolean }
  /** `mode` : celui de l'essai manqué (« Réessayer » le refait, le geste « décrire » le suit). */
  | { kind: "failed"; info: LinkFailureInfo; mode: LinkMode };

export interface LinkAiInput {
  /** Analyse allumée sur le serveur : rien n'est demandé (pas même l'accord) tant qu'elle ne l'est pas. */
  active: boolean;
  /** « Voir les propositions de l'IA » permis par le serveur (lot « propositions »). */
  pieces?: boolean;
  /** Lien de la vidéo (adresse reconnue par le serveur quand elle est connue). */
  url: string;
  platform: VideoPlatform | null;
  origin: LinkSpotOrigin;
  /** Refus de l'accord : la capture d'écran prend le relais. */
  onDeclined: () => void;
}

/** Les moments, celui de rang `rank` choisi, avec le cadre de l'IA déjà tracé. */
export function momentsPhase(analysis: LinkAnalysis, rank: number): Extract<LinkAiPhase, { kind: "moments" }> | null {
  const moment = analysis.moments[rank];
  return moment ? { kind: "moments", analysis, selected: rank, zone: zoneFromCrop(moment.box), zoneFromAi: true } : null;
}

export function useVideoLinkAnalysis({ active, pieces = false, url, platform, origin, onDeclined }: LinkAiInput) {
  const router = useRouter();
  const [phase, setPhase] = useState<LinkAiPhase>({ kind: "ask", problem: null });
  const [query, setQuery] = useState("");
  // Accord en cours de vérification, et pour quel geste (son bouton est occupé).
  const [checking, setChecking] = useState<LinkMode | null>(null);
  // « Décrire la pièce autrement » : le champ prend le focus à son retour.
  const [focusQuery, setFocusQuery] = useState(false);
  // Propositions refusées par le serveur (interrupteur coupé entre-temps : 400 « invalid_query ») : le bouton disparaît pour ce lien.
  const [piecesRefused, setPiecesRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Accord lu en arrière-plan dès l'ouverture : « Trouver la pièce » n'attend pas.
  const choice = useRef<Promise<VideoAiChoice> | null>(null);
  // Chaque analyse a son numéro : la réponse d'une analyse annulée est ignorée.
  const run = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const alive = useRef(true);
  // Le geste qui attend l'accord : l'écran d'accord reprend le mode demandé.
  const pendingMode = useRef<LinkMode>("words");
  // Propositions de l'IA reçues pour ce lien (en mémoire, le temps de l'écran) : y revenir ne refait aucun appel.
  const piecesCache = useRef<LinkAnalysis | null>(null);

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

  /** Les propositions déjà reçues pour ce lien, la première présélectionnée ; null s'il n'y en a pas. */
  function cachedPieces(): Extract<LinkAiPhase, { kind: "moments" }> | null {
    return piecesCache.current ? momentsPhase(piecesCache.current, 0) : null;
  }

  /** Une analyse : avec les mots (comme avant), ou en mode « pièces », sans
   * aucun texte — le texte déjà tapé reste dans le champ. */
  async function analyze(mode: LinkMode) {
    let request: VideoLinkAnalysisRequest;
    if (mode === "pieces") {
      const cached = cachedPieces();
      if (cached) return setPhase(cached);
      request = linkPiecesRequest(url);
    } else {
      const built = linkAnalysisRequest(url, query);
      if ("problem" in built) return setPhase({ kind: "ask", problem: built.problem });
      request = built.request;
    }
    if (!platform) return;
    setFocusQuery(false);
    run.current.controller?.abort();
    const controller = new AbortController();
    const id = run.current.id + 1;
    run.current = { id, controller };
    setPhase({ kind: "working", startedAt: Date.now(), mode });
    const outcome = await runLinkAnalysis(request, platform, controller.signal);
    if (!alive.current || run.current.id !== id || outcome.kind === "cancelled") return;
    run.current.controller = null;
    if (outcome.kind === "found") {
      if (mode === "pieces") piecesCache.current = outcome.analysis;
      const found = momentsPhase(outcome.analysis, 0);
      return setPhase(found ?? { kind: "failed", info: { failure: "no_moment", capacity: null }, mode });
    }
    // Accord retiré entre-temps (sur un autre appareil, par exemple), ou
    // donné sur un texte que le serveur n'accepte pas pour un lien : redemandé.
    if (outcome.info.failure === "consent") {
      choice.current = Promise.resolve("ask");
      pendingMode.current = mode;
      return setPhase({ kind: "consent" });
    }
    if (mode === "pieces" && outcome.info.failure === "invalid_query") setPiecesRefused(true);
    setPhase({ kind: "failed", info: outcome.info, mode });
  }

  /** L'accord (demandé s'il manque ou a été refusé : le geste vaut demande),
   * puis l'analyse dans le mode du geste. */
  async function consentThenAnalyze(mode: LinkMode) {
    setChecking(mode);
    let current: VideoAiChoice;
    try {
      current = await (choice.current ?? loadChoice());
    } catch {
      if (alive.current) setPhase({ kind: "failed", info: { failure: "network", capacity: null }, mode });
      return;
    } finally {
      if (alive.current) setChecking(null);
    }
    if (!alive.current) return;
    if (current !== "granted") {
      pendingMode.current = mode;
      return setPhase({ kind: "consent" });
    }
    void analyze(mode);
  }

  /** « Trouver la pièce » : les mots d'abord, puis l'accord, puis l'analyse. */
  async function find() {
    const built = linkAnalysisRequest(url, query);
    if ("problem" in built) return setPhase({ kind: "ask", problem: built.problem });
    await consentThenAnalyze("words");
  }

  /** « Voir les propositions de l'IA » : les propositions déjà reçues pour ce
   * lien, sans nouvel appel ; sinon l'accord, puis l'analyse sans les mots. */
  async function findPieces() {
    if (!pieces || piecesRefused) return;
    const cached = cachedPieces();
    if (cached) {
      setFocusQuery(false);
      return setPhase(cached);
    }
    await consentThenAnalyze("pieces");
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
    // Le mode demandé avant l'écran d'accord.
    if (alive.current) void analyze(pendingMode.current);
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

  /** Un autre moment : son image, avec le cadre de l'IA déjà tracé (le
   * moment déjà choisi, touché de nouveau, garde la pièce entourée). */
  function select(rank: number) {
    setPhase((current) => (current.kind === "moments" && rank !== current.selected ? (momentsPhase(current.analysis, rank) ?? current) : current));
  }

  /** La pièce entourée par la personne (ou l'image entière) : elle remplace le cadre de l'IA. */
  function changeZone(zone: PieceZone) {
    setPhase((current) => (current.kind === "moments" ? { ...current, zone, zoneFromAi: false } : current));
  }

  /** « Décrire la pièce autrement » (mode « pièces ») : le champ, vide, qui
   * prend le focus ; les propositions restent en mémoire pour ce lien. */
  function describeInstead() {
    setQuery("");
    setFocusQuery(true);
    setPhase({ kind: "ask", problem: null });
  }

  /** « Lancer la recherche » : directement l'attente puis les résultats,
   * avec la zone de l'écran des moments (demande du fondateur, 17 novembre
   * 2026 : le moins d'étapes possible, on entoure sur l'écran des moments).
   * La description part avec le brouillon (jamais dans l'adresse) : elle trie
   * les propositions, et sert à la recherche dans les boutiques si aucune
   * n'a de prix (lien vidéo sans prix, même jour). En mode « pièces », c'est
   * le nom de la pièce choisie qui part ainsi (startMomentSearch). */
  function search() {
    if (phase.kind !== "moments") return;
    if (!startMomentSearch(phase.analysis, phase.selected, origin, { crop: phase.zone.crop, byAi: phase.zoneFromAi }, query)) return;
    router.push({ pathname: "/spot/lancer", params: { source: "photo", auto: "1" } });
  }

  return {
    phase,
    query,
    onQuery: (value: string) => {
      setQuery(value);
      if (phase.kind === "ask" && phase.problem) setPhase({ kind: "ask", problem: null });
    },
    // « Voir les propositions de l'IA » à montrer : permis par le serveur, et pas refusé depuis.
    piecesAvailable: pieces && !piecesRefused,
    checking: checking !== null,
    checkingMode: checking,
    focusQuery,
    saving,
    consentError,
    find: () => void find(),
    findPieces: () => void findPieces(),
    accept: () => void accept(),
    decline: () => void decline(),
    cancel,
    select,
    changeZone,
    search,
    editQuery: () => setPhase({ kind: "ask", problem: null }),
    describeInstead,
    // Le dernier mode, pas toujours celui des mots.
    retry: () => (phase.kind === "failed" && phase.mode === "pieces" ? void findPieces() : void find()),
  };
}

export type VideoLinkAnalysisFlow = ReturnType<typeof useVideoLinkAnalysis>;
