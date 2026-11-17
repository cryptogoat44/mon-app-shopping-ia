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
// Imports relatifs : fichier testé par vitest.
import {
  SEARCH_QUERY_MAX_LENGTH,
  VIDEO_AI,
  normalizeVideoLink,
  type CropRect,
  type VideoLink,
  type VideoLinkAnalysisErrorCode,
  type VideoLinkAnalysisRequest,
} from "@monapp/shared-types";
import { t } from "../i18n";
import { ApiError } from "./api-error";
import { readJpegDataUri, type PixelSize } from "./data-uri";
import { containsLink } from "./link-detection";
import { isNetworkError } from "./network-error";
import { capacityFailure, capacityMonthTip, type CapacityFailure } from "./spot-capacity";
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
}

/** GET /api/video-links/analyze/status : seule la valeur exacte `true` allume
 * l'analyse. Réponse illisible, serveur plus ancien (404) ou injoignable :
 * l'écran reste exactement celui d'avant. */
export function linkAnalysisEnabled(body: unknown): boolean {
  return typeof body === "object" && body !== null && "enabled" in body && body.enabled === true;
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

/** Réponse du serveur → analyse vérifiée ; null si elle est illisible (traitée comme une panne). */
export function parseLinkAnalysis(body: unknown): LinkAnalysis | null {
  if (typeof body !== "object" || body === null) return null;
  const { video, moments } = body as Record<string, unknown>;
  const link = readVideo(video);
  if (!link || !Array.isArray(moments) || moments.length > VIDEO_AI.moments) return null;
  const read: LinkMoment[] = [];
  for (const item of moments) {
    const moment = readMoment(item);
    if (!moment) return null;
    read.push(moment);
  }
  return { video: link, moments: read };
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

/** Erreur reçue (ou délai dépassé côté app) → échec à montrer. */
export function linkAiFailure(error: unknown, timedOut = false): LinkFailureInfo {
  if (timedOut) return { failure: "timeout", capacity: null };
  if (error instanceof ApiError) {
    const capacity = capacityFailure(error.body);
    if (capacity) return { failure: "search_limit", capacity };
    const code = typeof error.body?.error === "string" ? error.body.error : "";
    // Vidéo introuvable ou sans vidéo (supprimée, publication de photos,
    // direct) : le serveur l'envoie en 422, jamais pour une panne (5xx).
    // Un nouvel essai échouerait pareil : message non « réessayable ».
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

export interface LinkFailureView {
  title: string;
  message: string;
  /** Une panne (annoncée comme une erreur) ; « pièce non repérée » est un vrai résultat. */
  isError: boolean;
  /** « Réessayer » : seulement quand un nouvel essai peut aboutir tout de suite. */
  retry: boolean;
  /** « Modifier la description » : les mots peuvent tout changer. */
  editQuery: boolean;
}

const RETRYABLE: readonly LinkAiFailure[] = ["unavailable", "timeout", "busy", "network"];

function capacityMessage(capacity: CapacityFailure, locale: Locale): string {
  if (capacity.reason === "capacity_month") return `${t.result.capacityMonthTitle} ${capacityMonthTip(capacity.resumesOn, locale)}`;
  if (capacity.reason === "capacity_user") return `${t.result.capacityUserTitle} ${t.result.capacityUserTip}`;
  return `${t.result.capacityDayTitle} ${t.result.capacityDayTip}`;
}

function failureMessage({ failure, capacity }: LinkFailureInfo, locale: Locale): string {
  if (failure === "search_limit") return capacity ? capacityMessage(capacity, locale) : t.videoLinkAuto.failure.global_limit;
  // Jamais affiché : un accord manquant ouvre l'écran d'accord.
  if (failure === "consent") return t.videoLinkAuto.failure.unavailable;
  return t.videoLinkAuto.failure[failure];
}

/** Message et gestes d'un échec. La capture d'écran est toujours affichée en dessous (jamais d'impasse). */
export function linkFailureView(info: LinkFailureInfo, locale: Locale): LinkFailureView {
  const notFound = info.failure === "no_moment";
  return {
    title: notFound ? t.videoLinkAuto.notFoundTitle : t.videoLinkAuto.failedTitle,
    message: failureMessage(info, locale),
    isError: !notFound,
    retry: RETRYABLE.includes(info.failure),
    editQuery: notFound || info.failure === "invalid_query",
  };
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

/** Instant lisible d'un moment (« 0:12 »). */
export function momentClock(timeSeconds: number): string {
  const total = Math.max(0, Math.floor(timeSeconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
