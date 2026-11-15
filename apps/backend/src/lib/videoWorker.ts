// Service vidéo séparé (lot « vidéo auto », décision du fondateur des 14 et
// 15 novembre 2026) : réglages et client du serveur principal.
//
// Le serveur principal ne télécharge toujours JAMAIS une vidéo ni une image
// de TikTok ou d'Instagram (tests/aucunMediaTiktokInstagram.test.ts). C'est
// le service vidéo, à part chez Render (apps/video-worker, service privé,
// Francfort), qui récupère la vidéo publique d'un lien, sans la garder, et en
// extrait quelques images. Le serveur principal ne fait que lui demander ces
// images, puis les donne à l'IA (étage 2 existant, services/videoMoments.ts).
//
// Contrat entre les deux services :
// - POST {VIDEO_WORKER_URL}/frames, en-tête « Authorization: Bearer
//   {VIDEO_WORKER_SECRET} », corps JSON {"url", "platform"} : l'adresse
//   CANONIQUE de la vidéo, reconstruite par le serveur à partir du lien
//   reconnu (workerVideoUrl), jamais le texte reçu de l'app ;
// - 200 : {"durationSeconds", "frames": [{"timeSeconds", "width", "height",
//   "jpegBase64"}]}, de 6 à 16 images distinctes et nettes, dans l'ordre du
//   temps, 1 280 px au plus sur le grand côté (JPEG, qualité ≈ 82) ;
// - erreur : {"error": code}. Le code JSON fait foi ; le statut HTTP ne sert
//   que si le code manque ou est inconnu (WORKER_ERROR_BY_STATUS) :
//     bad_request 400, unauthorized 401, private 403 ou 404, not_found 404,
//     too_long 413, unsupported 422, blocked 451, unavailable 502, busy 503,
//     timeout 504 ;
// - GET {VIDEO_WORKER_URL}/health, sans secret (non utilisé ici).
// Limites tenues par le service vidéo : vidéo de 90 s au plus, 25 s par
// demande, 2 demandes à la fois (sinon « busy »), rien écrit sur disque.
//
// Côté client, ici : seule l'adresse réglée est appelée (jamais une
// redirection), délai de 30 s, réponse de 12 Mo au plus, lue sans lui faire
// confiance (zod), images vérifiées (JPEG, 1 Mo au plus chacune), erreurs
// typées (VideoWorkerError : un type et un statut, jamais de contenu). Les
// tampons sont effacés dès qu'ils ne servent plus ; les chaînes base64,
// immuables en JavaScript, sont abandonnées dès le décodage.
import { z } from "zod";
import { normalizeVideoLink, type VideoLink, type VideoPlatform } from "@monapp/shared-types";
import type { env } from "../env.js";
import { imageFormatOf } from "./imageSafety.js";

// ---- Réglages (lus une seule fois, au démarrage) ----

/** Les variables lues (celles de src/env.ts). */
export type VideoWorkerEnvSource = Pick<typeof env, "VIDEO_LINK_ANALYSIS_ENABLED" | "VIDEO_WORKER_URL" | "VIDEO_WORKER_SECRET">;

export interface VideoWorkerConfig {
  /** Adresse du service, sans « / » final (ex. http://spotto-video:10000). */
  baseUrl: string;
  /** Secret partagé ; jamais journalisé. */
  secret: string;
}

/** Coupée (interrupteur), invalide (variables à corriger : nom et raison
 * fixe, jamais la valeur) ou prête. */
export type VideoWorkerConfigState = { state: "off" } | { state: "invalid"; problems: string[] } | { state: "ready"; config: VideoWorkerConfig };

// Caractères visibles seulement (le secret part dans un en-tête HTTP), 32 au moins.
const SECRET = /^[\x21-\x7e]{32,512}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Nom interne du réseau privé de Render (« spotto-video ») : un seul mot, sans point.
const INTERNAL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Exemple neutre : le nom du produit n'est jamais écrit en dur hors des
// commentaires (tests/marque.test.ts).
const URL_MISSING = "VIDEO_WORKER_URL : absente (adresse du service vidéo, par exemple http://nom-interne-du-service:10000)";
const URL_INVALID = "VIDEO_WORKER_URL : adresse http ou https attendue, sans identifiants, paramètres ni fragment";
const URL_PUBLIC_HTTP = "VIDEO_WORKER_URL : http seulement sur le réseau privé (nom interne de Render, localhost) ; https ailleurs";
const SECRET_MISSING = "VIDEO_WORKER_SECRET : absent";
const SECRET_INVALID = "VIDEO_WORKER_SECRET : forme invalide (32 à 512 caractères visibles, sans espace)";
/** Raison donnée quand le service est bien réglé mais que l'IA manque. */
export const AI_KEY_MISSING = "ANTHROPIC_API_KEY : absente (l'analyse des liens réutilise l'analyse des vidéos par l'IA)";

/** Hôte du réseau privé : nom interne sans point (réseau privé de Render),
 * localhost, ou adresse IPv4 locale ou privée. Le secret n'y voyage en
 * clair (http) que là. */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (host === "localhost" || host === "::1") return true;
  const ipv4 = IPV4.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return INTERNAL_NAME.test(host);
}

/** L'adresse du service, sans « / » final ; null (et une raison) si elle est invalide. */
function readWorkerUrl(raw: string | undefined, problems: string[]): string | null {
  const text = raw?.trim();
  if (!text) {
    problems.push(URL_MISSING);
    return null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    problems.push(URL_INVALID);
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || text.includes("?") || text.includes("#")) {
    problems.push(URL_INVALID);
    return null;
  }
  if (url.protocol === "http:" && !isPrivateNetworkHost(url.hostname)) {
    problems.push(URL_PUBLIC_HTTP);
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function readWorkerSecret(raw: string | undefined, problems: string[]): string | null {
  if (!raw) {
    problems.push(SECRET_MISSING);
    return null;
  }
  if (!SECRET.test(raw)) {
    problems.push(SECRET_INVALID);
    return null;
  }
  return raw;
}

/** Réglages du service vidéo, vérifiés. Interrupteur coupé : ni l'adresse ni
 * le secret ne sont lus. */
export function readVideoWorkerConfig(source: VideoWorkerEnvSource): VideoWorkerConfigState {
  if (source.VIDEO_LINK_ANALYSIS_ENABLED !== true) return { state: "off" };
  const problems: string[] = [];
  const baseUrl = readWorkerUrl(source.VIDEO_WORKER_URL, problems);
  const secret = readWorkerSecret(source.VIDEO_WORKER_SECRET, problems);
  if (!baseUrl || !secret) return { state: "invalid", problems };
  return { state: "ready", config: { baseUrl, secret } };
}

interface WarnLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

export const CONFIG_WARNING = "Analyse des liens vidéo coupée : réglages invalides";

/** Une seule ligne de journal, au démarrage, quand l'interrupteur est allumé
 * mais que l'analyse ne peut pas marcher : les variables à corriger, jamais
 * leur valeur (ni l'adresse, ni le secret). */
export function logVideoWorkerConfigState(state: VideoWorkerConfigState, aiAvailable: boolean, log: WarnLog): void {
  if (state.state === "invalid") log.warn({ problems: state.problems }, CONFIG_WARNING);
  else if (state.state === "ready" && !aiAvailable) log.warn({ problems: [AI_KEY_MISSING] }, CONFIG_WARNING);
}

// ---- Adresse envoyée au service vidéo ----

const CANONICAL_URL: Record<VideoPlatform, RegExp> = {
  tiktok: /^https:\/\/www\.tiktok\.com\/@[a-z0-9._]{0,30}\/(?:video|photo)\/\d{6,25}$/,
  instagram: /^https:\/\/www\.instagram\.com\/(?:reel|p|tv)\/[A-Za-z0-9_-]{5,64}\/$/,
};

/** L'adresse canonique à donner au service vidéo : celle que parseVideoLink
 * a reconstruite à partir des seuls plateforme, identifiant et pseudo (jamais
 * le texte reçu, ni ses paramètres), revérifiée ici : forme exacte (https,
 * www.tiktok.com ou www.instagram.com) et même vidéo une fois relue. Null au
 * moindre écart (protection SSRF : le service vidéo n'ouvre jamais une
 * adresse choisie par un tiers). */
export function workerVideoUrl(link: VideoLink): string | null {
  const url = link.canonicalUrl;
  if (!CANONICAL_URL[link.platform]?.test(url)) return null;
  const again = normalizeVideoLink(url);
  if (!again || again.platform !== link.platform || again.videoKey !== link.videoKey || again.canonicalUrl !== url) return null;
  return url;
}

// ---- Client ----

/** Délai de toute la demande au service vidéo (lui-même s'arrête à 25 s). */
export const VIDEO_WORKER_TIMEOUT_MS = 30_000;
/** Réponse lue au plus : 16 images de 1 280 px pèsent ≈ 3 à 6 Mo en base64. */
export const VIDEO_WORKER_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
/** Une erreur tient en quelques octets. */
const MAX_ERROR_BYTES = 4 * 1024;
export const VIDEO_WORKER_MAX_FRAMES = 16;
export const VIDEO_WORKER_MAX_FRAME_EDGE = 1280;
/** Une image de 1 280 px en JPEG (qualité ≈ 82) pèse ≈ 100 à 400 Ko. */
export const VIDEO_WORKER_MAX_FRAME_BYTES = 1024 * 1024;

export const VIDEO_WORKER_ERROR_CODES = ["bad_request", "unauthorized", "unsupported", "private", "not_found", "blocked", "too_long", "unavailable", "busy", "timeout"] as const;
export type VideoWorkerErrorCode = (typeof VIDEO_WORKER_ERROR_CODES)[number];

/** Code déduit du statut HTTP, quand la réponse d'erreur n'en donne pas un connu. */
export const WORKER_ERROR_BY_STATUS: Readonly<Record<number, VideoWorkerErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "private",
  404: "not_found",
  413: "too_long",
  422: "unsupported",
  451: "blocked",
  502: "unavailable",
  503: "busy",
  504: "timeout",
};

/** Échec d'une demande : un code du contrat, ou, côté client, une réponse
 * hors contrat (« invalid_response ») ou un service injoignable
 * (« unreachable »). Le délai de 30 s dépassé donne « timeout ». */
export type VideoWorkerFailure = VideoWorkerErrorCode | "invalid_response" | "unreachable";

/** Le message ne contient jamais de contenu (ni adresse, ni image) : un type
 * et, pour une réponse HTTP, son statut. */
export class VideoWorkerError extends Error {
  constructor(
    public readonly kind: VideoWorkerFailure,
    public readonly status: number | null = null
  ) {
    super(`video_worker_${kind}`);
    this.name = "VideoWorkerError";
  }
}

export interface VideoWorkerRequest {
  /** Adresse canonique (workerVideoUrl). */
  url: string;
  platform: VideoPlatform;
}

/** Une image rendue par le service vidéo, décodée (JPEG). */
export interface WorkerFrame {
  timeSeconds: number;
  /** Taille annoncée par le service (la taille réelle est relue par sharp). */
  width: number;
  height: number;
  data: Buffer;
}

export interface VideoWorkerFrames {
  durationSeconds: number;
  frames: WorkerFrame[];
}

/** Appel HTTP (fetch par défaut ; un faux dans les tests). */
export type VideoWorkerFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchFramesOptions {
  fetcher?: VideoWorkerFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_LENGTH = Math.ceil(VIDEO_WORKER_MAX_FRAME_BYTES / 3) * 4;
/** Arrondis du service : un instant peut dépasser la durée d'une fraction de seconde. */
const TIME_TOLERANCE_SECONDS = 1;

// Réponse lue sans lui faire confiance. Une propriété inconnue est ignorée
// (le service peut en ajouter) ; tout le reste est vérifié. Moins de 6 images
// sont acceptées (vidéo très courte) : jamais plus de 16.
const framesResponseSchema = z
  .object({
    durationSeconds: z.number().finite().nonnegative().max(86_400),
    frames: z
      .array(
        z.object({
          timeSeconds: z.number().finite().nonnegative(),
          width: z.number().int().min(1).max(VIDEO_WORKER_MAX_FRAME_EDGE),
          height: z.number().int().min(1).max(VIDEO_WORKER_MAX_FRAME_EDGE),
          jpegBase64: z.string().min(4).max(MAX_BASE64_LENGTH).regex(BASE64),
        })
      )
      .min(1)
      .max(VIDEO_WORKER_MAX_FRAMES),
  })
  .refine((body) => body.frames.every((frame, index) => frame.timeSeconds <= body.durationSeconds + TIME_TOLERANCE_SECONDS && (index === 0 || frame.timeSeconds >= body.frames[index - 1]!.timeSeconds)));

const errorResponseSchema = z.object({ error: z.string().max(40) });

/** Efface les images (à appeler dès qu'elles ne servent plus, erreur comprise). */
export function wipeFrames(frames: readonly WorkerFrame[]): void {
  for (const frame of frames) frame.data.fill(0);
}

/** Le corps de la réponse, `max` octets au plus (annoncés ou reçus) ; au-delà,
 * la lecture s'arrête et rien n'est gardé. */
async function readCapped(response: Response, max: number, signal: AbortSignal): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    throw new VideoWorkerError("invalid_response", response.status);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new VideoWorkerError("invalid_response", response.status);
      }
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof VideoWorkerError) throw error;
    throw new VideoWorkerError(signal.aborted ? "timeout" : "unreachable", response.status);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** Le JSON d'un corps, ou undefined s'il n'en est pas un. Le corps est effacé. */
function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  } finally {
    body.fill(0);
  }
}

/** Le code d'une réponse d'erreur : celui du JSON s'il est connu, sinon celui du statut. */
function errorCodeOf(json: unknown, status: number): VideoWorkerErrorCode {
  const parsed = errorResponseSchema.safeParse(json);
  const code = parsed.success ? parsed.data.error : null;
  if (code !== null && (VIDEO_WORKER_ERROR_CODES as readonly string[]).includes(code)) return code as VideoWorkerErrorCode;
  return WORKER_ERROR_BY_STATUS[status] ?? "unavailable";
}

/** Les images décodées, vérifiées une à une (JPEG, taille). */
function decodeFrames(body: z.infer<typeof framesResponseSchema>, status: number): WorkerFrame[] {
  const frames: WorkerFrame[] = [];
  try {
    for (const frame of body.frames) {
      const data = Buffer.from(frame.jpegBase64, "base64");
      frames.push({ timeSeconds: frame.timeSeconds, width: frame.width, height: frame.height, data });
      if (data.length === 0 || data.length > VIDEO_WORKER_MAX_FRAME_BYTES || imageFormatOf(data) !== "jpeg") {
        throw new VideoWorkerError("invalid_response", status);
      }
    }
    return frames;
  } catch (error) {
    wipeFrames(frames);
    throw error;
  }
}

/** Demande au service vidéo les images de la vidéo `request.url`. Relève
 * VideoWorkerError en cas d'échec (jamais une autre erreur). */
export async function fetchVideoFrames(config: VideoWorkerConfig, request: VideoWorkerRequest, options: FetchFramesOptions = {}): Promise<VideoWorkerFrames> {
  const fetcher: VideoWorkerFetch = options.fetcher ?? ((url, init) => fetch(url, init));
  const signal = AbortSignal.timeout(options.timeoutMs ?? VIDEO_WORKER_TIMEOUT_MS);
  // Seule l'adresse réglée : jamais une autre, jamais une redirection.
  const target = `${config.baseUrl}/frames`;
  let response: Response;
  try {
    response = await fetcher(target, {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${config.secret}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ url: request.url, platform: request.platform }),
      signal,
    });
  } catch {
    throw new VideoWorkerError(signal.aborted ? "timeout" : "unreachable");
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    // Une redirection n'est jamais suivie : réponse hors contrat.
    if (status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new VideoWorkerError("invalid_response", status);
    }
    let json: unknown;
    try {
      json = parseJson(await readCapped(response, MAX_ERROR_BYTES, signal));
    } catch (error) {
      if (error instanceof VideoWorkerError && error.kind === "timeout") throw error;
      json = undefined;
    }
    throw new VideoWorkerError(errorCodeOf(json, status), status);
  }
  const json = parseJson(await readCapped(response, options.maxResponseBytes ?? VIDEO_WORKER_MAX_RESPONSE_BYTES, signal));
  const parsed = framesResponseSchema.safeParse(json);
  if (!parsed.success) throw new VideoWorkerError("invalid_response", status);
  return { durationSeconds: parsed.data.durationSeconds, frames: decodeFrames(parsed.data, status) };
}
