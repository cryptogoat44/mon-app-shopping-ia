// Analyse automatique d'une vidéo TikTok ou Instagram à partir de son lien
// (lot « vidéo auto », décision du fondateur des 14 et 15 novembre 2026), vu
// de l'app : la personne colle ou partage le lien et écrit ce qu'elle cherche ;
// le serveur fait récupérer la vidéo publique (sans la garder) par le service
// vidéo, l'IA y trouve les moments où la pièce apparaît, et l'app enchaîne
// comme pour une vidéo du téléphone (image du moment + cadre → recherche
// habituelle). La capture d'écran reste la roue de secours à chaque échec.
// Ce fichier : la décision d'afficher l'analyse, la demande, la lecture de la
// réponse (jamais de confiance aveugle dans le réseau), et chaque échec
// traduit en message et en gestes possibles. Logique pure, testée.
// Lot « propositions » (Parcours 2, 21 novembre 2026) : un second mode,
// « pièces » — sans écrire, la personne demande à l'IA les pièces qu'elle
// voit (« Voir les propositions de l'IA »), quand le serveur le permet.
// Imports relatifs : fichier testé par vitest.
import {
  SEARCH_QUERY_MAX_LENGTH,
  VIDEO_AI,
  VIDEO_LINK_FAILURE_CAUSES,
  VIDEO_PIECES,
  normalizeVideoLink,
  pieceLabel,
  pieceLabelKey,
  type CropRect,
  type VideoLink,
  type VideoLinkAnalysisErrorCode,
  type VideoLinkAnalysisRequest,
  type VideoLinkFailureCause,
  type VideoPlatform,
} from "@monapp/shared-types";
import { t } from "../i18n";
import { ApiError } from "./api-error";
import { readJpegDataUri, type PixelSize } from "./data-uri";
import { containsLink } from "./link-detection";
import { isNetworkError } from "./network-error";
import { capacityFailure, capacityMonthTip, monthlyQuotaCopy, type CapacityFailure } from "./spot-capacity";
import type { Locale } from "./preferences";
import type { LinkAiFailure } from "./video-link-failures";

/** Un moment lu et vérifié : l'image (« data: », gardée en mémoire), sa taille, le cadre de la pièce. */
export interface LinkMoment {
  timeSeconds: number;
  image: string;
  size: PixelSize;
  box: CropRect;
}

export interface LinkAnalysis {
  video: VideoLink;
  /** Le meilleur d'abord ; vide : la pièce n'a pas été repérée. */
  moments: LinkMoment[];
  /** Mode « pièces » (lot « propositions ») : le nom de chaque pièce proposée
   * par l'IA, dans l'ordre des moments (une image par pièce). Absent avec des mots. */
  labels?: string[];
}

/** Lot « propositions » : avec les mots de la personne (comme avant), ou les
 * pièces que l'IA voit, sans aucun texte. */
export type LinkMode = "words" | "pieces";

/** GET /api/video-links/analyze/status : seule la valeur exacte `true` allume
 * l'analyse. Réponse illisible, serveur plus ancien (404) ou injoignable :
 * l'écran reste exactement celui d'avant. */
export function linkAnalysisEnabled(body: unknown): boolean {
  return typeof body === "object" && body !== null && "enabled" in body && body.enabled === true;
}

/** L'analyse d'un lien, « Voir les propositions de l'IA » (lot « propositions »),
 * et l'image du moment demandée au serveur (retours du build 3, TikTok). */
export interface LinkAnalysisStatus {
  enabled: boolean;
  pieces: boolean;
  /** POST /api/video-links/frame possible (champ du lot 1, indépendant de l'analyse). */
  frame: boolean;
}

/** Repli : tout coupé (erreur, serveur plus ancien ou injoignable). */
export const LINK_ANALYSIS_OFF: LinkAnalysisStatus = { enabled: false, pieces: false, frame: false };

/** Pour chacun, seule la valeur exacte `true` compte ; les propositions ne
 * valent qu'avec l'analyse allumée ; l'image du moment ne dépend pas de
 * l'analyse (absente, comme sur un serveur sans le lot 1 : faux). */
export function linkAnalysisStatus(body: unknown): LinkAnalysisStatus {
  const enabled = linkAnalysisEnabled(body);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  return { enabled, pieces: enabled && record?.pieces === true, frame: record?.frame === true };
}

export type QueryProblem = "too_short" | "too_long" | "link";

/** Mots de la personne, espaces superflus retirés. */
export function cleanQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

/** La demande envoyée au serveur, ou ce qui ne va pas dans les mots (dit sous le champ). */
export function linkAnalysisRequest(url: string, query: string): { request: VideoLinkAnalysisRequest } | { problem: QueryProblem } {
  const words = cleanQuery(query);
  if (containsLink(words)) return { problem: "link" };
  if (words.length < VIDEO_AI.queryMinLength) return { problem: "too_short" };
  if (words.length > SEARCH_QUERY_MAX_LENGTH) return { problem: "too_long" };
  return { request: { url: url.trim(), query: words } };
}

export function queryProblemMessage(problem: QueryProblem): string {
  return t.videoLinkAuto.query[problem];
}

/** Mode « pièces » : le lien seul — le texte déjà tapé reste dans le champ, il ne part pas. */
export function linkPiecesRequest(url: string): VideoLinkAnalysisRequest {
  return { url: url.trim(), mode: "pieces" };
}

/** Le mode d'une demande : « pièces » si elle le dit, sinon les mots. */
export function linkModeOf(request: VideoLinkAnalysisRequest): LinkMode {
  return "mode" in request && request.mode === "pieces" ? "pieces" : "words";
}

const isProportion = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function readBox(value: unknown): CropRect | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isProportion(x) || !isProportion(y) || !isProportion(width) || !isProportion(height)) return null;
  if (width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return null;
  return { x, y, width, height };
}

/** Instant d'un moment : des secondes, positives (une vidéo analysée dure 90 s au plus). */
const MAX_MOMENT_SECONDS = 3600;

function readMoment(value: unknown): LinkMoment | null {
  if (typeof value !== "object" || value === null) return null;
  const { timeSeconds, image, box } = value as Record<string, unknown>;
  if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > MAX_MOMENT_SECONDS) return null;
  const crop = readBox(box);
  const jpeg = readJpegDataUri(image);
  if (!crop || !jpeg || typeof image !== "string") return null;
  return { timeSeconds, image, size: jpeg.size, box: crop };
}

/** La vidéo reconnue, relue ici : seule une vidéo TikTok ou Instagram reconnue est gardée. */
function readVideo(value: unknown): VideoLink | null {
  if (typeof value !== "object" || value === null) return null;
  const { canonicalUrl, creatorHandle } = value as Record<string, unknown>;
  const link = normalizeVideoLink(typeof canonicalUrl === "string" ? canonicalUrl : null);
  if (!link) return null;
  return { ...link, creatorHandle: link.creatorHandle ?? (typeof creatorHandle === "string" && /^[\w.]{1,64}$/.test(creatorHandle) ? creatorHandle : null) };
}

/** Les noms du mode « pièces », revérifiés : un par moment (1 à 3), chacun
 * tel que pieceLabel le rend (lettres seulement, aucun mot de personne), sans
 * doublon ; null sinon. */
function readLabels(value: unknown, count: number): string[] | null {
  if (!Array.isArray(value) || value.length !== count || count < 1 || count > VIDEO_PIECES.max) return null;
  const keys = new Set<string>();
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || pieceLabel(item) !== item || keys.has(pieceLabelKey(item))) return null;
    keys.add(pieceLabelKey(item));
    labels.push(item);
  }
  return labels;
}

/** Réponse du serveur → analyse vérifiée ; null si elle est illisible (traitée
 * comme une panne). Avec des mots, rien ne change (`labels` est ignoré) ; en
 * mode « pièces », les noms sont obligatoires et revérifiés. */
export function parseLinkAnalysis(body: unknown, mode: LinkMode = "words"): LinkAnalysis | null {
  if (typeof body !== "object" || body === null) return null;
  const { video, moments, labels } = body as Record<string, unknown>;
  const link = readVideo(video);
  if (!link || !Array.isArray(moments) || moments.length > VIDEO_AI.moments) return null;
  const read: LinkMoment[] = [];
  for (const item of moments) {
    const moment = readMoment(item);
    if (!moment) return null;
    read.push(moment);
  }
  if (mode === "words") return { video: link, moments: read };
  const names = readLabels(labels, read.length);
  return names ? { video: link, moments: read, labels: names } : null;
}

export type { LinkAiFailure };

// Un code par erreur du contrat partagé : TypeScript refuse un oubli.
const FAILURE_BY_CODE: Record<VideoLinkAnalysisErrorCode, LinkAiFailure> = {
  video_analysis_disabled: "disabled",
  video_ai_consent_required: "consent",
  invalid_query: "invalid_query",
  invalid_link: "invalid_link",
  video_unavailable: "unavailable",
  video_private: "private",
  video_too_long: "too_long",
  video_no_moment: "no_moment",
  video_busy: "busy",
  video_timeout: "timeout",
  video_ai_user_limit: "user_limit",
  video_ai_global_limit: "global_limit",
};

function isContractCode(code: string): code is VideoLinkAnalysisErrorCode {
  return Object.prototype.hasOwnProperty.call(FAILURE_BY_CODE, code);
}

export interface LinkFailureInfo {
  failure: LinkAiFailure;
  /** Plafond des recherches atteint (motif et reprise), quand c'est la cause. */
  capacity: CapacityFailure | null;
}

/** Cause précise d'une vidéo indisponible (champ « cause », lot « recherche
 * confiance ») ; un serveur plus ancien ne l'envoie pas : null. */
function failureCause(body: unknown): VideoLinkFailureCause | null {
  const cause = typeof body === "object" && body !== null ? (body as Record<string, unknown>).cause : undefined;
  return typeof cause === "string" && (VIDEO_LINK_FAILURE_CAUSES as readonly string[]).includes(cause) ? (cause as VideoLinkFailureCause) : null;
}

/** Erreur reçue (ou délai dépassé côté app) → échec à montrer. */
export function linkAiFailure(error: unknown, timedOut = false): LinkFailureInfo {
  if (timedOut) return { failure: "timeout", capacity: null };
  if (error instanceof ApiError) {
    const capacity = capacityFailure(error.body);
    if (capacity) return { failure: "search_limit", capacity };
    const code = typeof error.body?.error === "string" ? error.body.error : "";
    // Plan B en un geste : vidéo privée ou supprimée, ou refus de TikTok ou
    // d'Instagram (le serveur le dit depuis le lot « recherche confiance ») :
    // réessayer ne changerait rien, la capture d'écran est le bon chemin.
    const cause = code === "video_unavailable" || code === "video_private" ? failureCause(error.body) : null;
    if (cause === "private_or_removed") return { failure: "private", capacity: null };
    if (cause === "refused") return { failure: "refused", capacity: null };
    // Vidéo introuvable ou sans vidéo (supprimée — serveur plus ancien —,
    // publication de photos, direct) : le serveur l'envoie en 422, jamais
    // pour une panne (5xx). Un nouvel essai échouerait pareil.
    if (code === "video_unavailable" && error.status === 422) return { failure: "invalid_link", capacity: null };
    if (isContractCode(code)) return { failure: FAILURE_BY_CODE[code], capacity: null };
    // Codes voisins (analyse des vidéos du téléphone, limites par minute).
    if (code === "video_ai_disabled") return { failure: "disabled", capacity: null };
    if (code === "rate_limited" || error.status === 429) return { failure: "rate_limited", capacity: null };
    if (error.status === 504) return { failure: "timeout", capacity: null };
    // Autre refus définitif (compte suspendu, par exemple) : jamais « Réessayer ».
    if (error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 408) return { failure: "disabled", capacity: null };
    return { failure: "unavailable", capacity: null };
  }
  // fetch échoue sans réponse : hors ligne, serveur injoignable (TypeError
  // sur le site, « fetch failed » d'expo/fetch sur iPhone). L'annulation par
  // la personne est traitée avant (video-link-run.ts).
  return { failure: isNetworkError(error) ? "network" : "unavailable", capacity: null };
}

/** Les gestes d'un échec : « capture », la capture d'écran avec le lien et la
 * description gardés (plan B) ; « retry », réessayer ; « edit_query »,
 * modifier la description. */
export type LinkFailureAction = "capture" | "retry" | "edit_query";

export interface LinkFailureView {
  title: string;
  /** Une phrase, calme et sans détail technique. */
  message: string;
  /** Une panne (annoncée comme une erreur) ; « pièce non repérée », une vidéo
   * privée ou refusée par la plateforme sont des constats, dits calmement. */
  isError: boolean;
  /** Le seul bouton (plan B en un geste) : la capture d'écran, sauf quand un
   * autre geste aboutit d'abord (connexion à rétablir, description à préciser). */
  primary: LinkFailureAction;
  /** Un lien discret sous le bouton (jamais un second bouton), ou rien.
   * « Réessayer » seulement quand un nouvel essai peut aboutir tout de suite. */
  secondary: LinkFailureAction | null;
}

// Un nouvel essai peut aboutir tout de suite (panne passagère) : « Réessayer » en lien discret.
const RETRYABLE: readonly LinkAiFailure[] = ["unavailable", "timeout", "busy"];
// Des constats sur la vidéo, pas des pannes : dits calmement, jamais en rouge.
const CALM: readonly LinkAiFailure[] = ["no_moment", "private", "refused", "invalid_link", "too_long"];
// Les mots peuvent tout changer : « Modifier la description » d'abord, la capture en lien.
const QUERY_FIRST: readonly LinkAiFailure[] = ["no_moment", "invalid_query"];

function capacityMessage(capacity: CapacityFailure, locale: Locale): string {
  if (capacity.reason === "capacity_month") return `${t.result.capacityMonthTitle} ${capacityMonthTip(capacity.resumesOn, locale)}`;
  if (capacity.reason === "capacity_user") return `${t.result.capacityUserTitle} ${t.result.capacityUserTip}`;
  if (capacity.reason === "capacity_user_month") return monthlyQuotaCopy(null, capacity.resumesOn, locale).join(" ");
  return `${t.result.capacityDayTitle} ${t.result.capacityDayTip}`;
}

function failureMessage({ failure, capacity }: LinkFailureInfo, locale: Locale, platform: string): string {
  if (failure === "search_limit") return capacity ? capacityMessage(capacity, locale) : t.videoLinkAuto.failure.global_limit;
  // Jamais affiché : un accord manquant ouvre l'écran d'accord.
  if (failure === "consent") return t.videoLinkAuto.failure.unavailable;
  if (failure === "refused") return t.videoLinkAuto.refused.message(platform);
  return t.videoLinkAuto.failure[failure];
}

function failureTitle(failure: LinkAiFailure, platform: string): string {
  if (failure === "no_moment") return t.videoLinkAuto.notFoundTitle;
  if (failure === "private") return t.videoLinkAuto.privateTitle;
  if (failure === "refused") return t.videoLinkAuto.refused.title(platform);
  return t.videoLinkAuto.failedTitle;
}

function primaryAction(failure: LinkAiFailure): LinkFailureAction {
  if (failure === "network") return "retry";
  return QUERY_FIRST.includes(failure) ? "edit_query" : "capture";
}

function secondaryAction(failure: LinkAiFailure): LinkFailureAction | null {
  if (failure === "network" || QUERY_FIRST.includes(failure)) return "capture";
  return RETRYABLE.includes(failure) ? "retry" : null;
}

/** Message et gestes d'un échec (plan B en un geste) : une phrase calme et un
 * seul bouton, la capture d'écran le plus souvent ; elle est toujours
 * proposée, en bouton ou en lien (jamais d'impasse). `platform` : « TikTok »
 * ou « Instagram », pour dire qui a refusé. `mode` (lot « propositions ») :
 * en mode « pièces », « aucune pièce proposée » a son titre et sa phrase ; le
 * geste « décrire » reste le bouton (son libellé suit le mode, à l'écran). */
export function linkFailureView(info: LinkFailureInfo, locale: Locale, platform: string = t.videoLinkAuto.platformFallback, mode: LinkMode = "words"): LinkFailureView {
  const noPiece = mode === "pieces" && info.failure === "no_moment";
  return {
    title: noPiece ? t.videoLinkAuto.pieces.noneTitle : failureTitle(info.failure, platform),
    message: noPiece ? t.videoLinkAuto.pieces.noneMessage : failureMessage(info, locale, platform),
    isError: !CALM.includes(info.failure),
    primary: primaryAction(info.failure),
    secondary: secondaryAction(info.failure),
  };
}

/** Plan B, pour les statistiques (mesure du parcours) : la capture choisie
 * après une vidéo privée ou supprimée (« private »), ou refusée par la
 * plateforme (« refused ») — sa cause et la plateforme du lien. null pour
 * tout autre échec : la capture y reste proposée, mais ce n'est pas le plan B.
 * Le plan B montré, lui, se lit déjà dans video_link_ai_result (`reason`). */
export function planBChoice(info: LinkFailureInfo, platform: VideoPlatform | null): { link_platform: VideoPlatform; cause: VideoLinkFailureCause } | null {
  if (!platform) return null;
  if (info.failure === "private") return { link_platform: platform, cause: "private_or_removed" };
  if (info.failure === "refused") return { link_platform: platform, cause: "refused" };
  return null;
}

/** Étapes de l'attente : la récupération de la vidéo, puis l'IA. Le serveur
 * fait tout en une seule demande : l'étape montrée suit les durées
 * habituelles (récupération en quelques secondes), d'où « en général ». */
export const LINK_FETCH_STEP_MS = 7_000;
/** Au-delà, l'attente dit que c'est plus long que d'habitude. */
export const LINK_SLOW_MS = 30_000;
/** Délai de l'app : le serveur répond en 25 à 40 s au plus ; au-delà, l'attente s'arrête. */
export const LINK_ANALYSIS_TIMEOUT_MS = 90_000;

export function linkWaitingStep(elapsedMs: number): 0 | 1 {
  return elapsedMs < LINK_FETCH_STEP_MS ? 0 : 1;
}

/** Les deux étapes montrées ; en mode « pièces », l'IA regarde les pièces (lot « propositions »). */
export function linkWaitingSteps(mode: LinkMode): readonly string[] {
  return mode === "pieces" ? t.videoLinkAuto.pieces.waitingSteps : t.videoLinkAuto.waiting.steps;
}

/** Instant lisible d'un moment (« 0:12 »). */
export function momentClock(timeSeconds: number): string {
  const total = Math.max(0, Math.floor(timeSeconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
