// Contrat entre le serveur principal et le service vidéo (décision du
// fondateur des 14 et 15 novembre 2026). Le client du serveur principal est
// apps/backend/src/lib/videoWorker.ts : les deux fichiers doivent rester
// d'accord.
//
// - POST /frames, en-tête « Authorization: Bearer <VIDEO_WORKER_SECRET> »,
//   corps JSON {"url", "platform"} (adresse canonique TikTok ou Instagram,
//   reconstruite par le serveur principal) ;
// - 200 : {"durationSeconds", "frames": [{"timeSeconds", "width", "height",
//   "jpegBase64"}]}, de 6 à 16 images distinctes et nettes, dans l'ordre du
//   temps, 1 280 px au plus sur le grand côté, JPEG peu compressé (-q:v 2) ;
// - erreur : {"error": code}, avec le statut HTTP de ERROR_STATUS ;
// - GET /health, sans secret : {"status": "ok", "ytDlp", "ffmpeg"}.

/** Codes d'erreur du contrat, et leur statut HTTP. Le code JSON fait foi ;
 * le client ne lit le statut que si le code manque. « private » et
 * « not_found » partagent 404 (le client accepte aussi 403 pour « private »). */
export const ERROR_STATUS = Object.freeze({
  bad_request: 400,
  unauthorized: 401,
  private: 404,
  not_found: 404,
  too_long: 413,
  unsupported: 422,
  blocked: 451,
  unavailable: 502,
  busy: 503,
  timeout: 504,
});

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_STATUS));

/** Échec d'une demande : un code du contrat et, pour le journal seulement,
 * un détail court et fixe (jamais une adresse ni un texte reçu). */
export class WorkerError extends Error {
  /**
   * @param {keyof typeof ERROR_STATUS} code
   * @param {string} [detail]
   */
  constructor(code, detail = code) {
    super(`video_worker_${code}`);
    this.name = "WorkerError";
    this.code = code;
    this.detail = detail;
    this.status = ERROR_STATUS[code];
  }
}

/** Limites du service. Les valeurs « à mesurer » se règlent après l'essai
 * sur Render (Francfort, offre Starter : 512 Mo, 0,5 processeur). */
export const LIMITS = Object.freeze({
  /** Vidéo de 90 s au plus (vérifié avant tout décodage). */
  maxVideoSeconds: 90,
  /** Toute la demande, attente comprise : 25 s au plus. */
  requestDeadlineMs: 25_000,
  /** Demandes traitées à la fois. */
  maxConcurrentJobs: 2,
  /** Petite file d'attente ; au-delà, « busy » tout de suite. */
  maxQueuedJobs: 2,
  /** Attente au plus dans la file, puis « busy ». */
  maxQueueWaitMs: 4_000,
  /** Corps de la demande : quelques centaines d'octets suffisent. */
  maxBodyBytes: 4 * 1024,
  maxUrlLength: 2048,
  /** Images rendues : 6 à 12, jusqu'à 16 pour une vidéo de plus de 40 s. */
  minFrames: 6,
  maxFramesShort: 12,
  maxFrames: 16,
  longVideoSeconds: 40,
  maxFrameEdge: 1280,
  /** Qualité JPEG de ffmpeg. Retours du build 2 (« les captures proposées
   * sont de piètre qualité ») : -q:v 2 au lieu de 4 (≈ qualité 82 de libjpeg,
   * mesuré sur ses tables), soit moins de compression (≈ qualité 92 par la
   * même règle, à confirmer par une mesure). Les images envoyées à l'IA, elles,
   * sont réduites par le serveur (512 px) : inchangées. */
  jpegQscale: 2,
  /** Une image : 1 Mo au plus (le client refuse au-delà). */
  maxFrameBytes: 1_000_000,
  /** Toutes les images : 11 Mo au plus (≈ 14,7 Mo en base64 ; le serveur lit
   * 16 Mio depuis les retours du build 2, 12 Mio avant : le serveur doit être
   * déployé AVANT ce service). Avant : 8 Mo, trop peu pour 16 images moins
   * compressées (les plus lourdes seraient retirées). */
  maxTotalFrameBytes: 11_000_000,
  /** Images candidates examinées au plus (une toutes les 0,5 s au moins). */
  maxCandidates: 40,
  minCandidateSpacingSeconds: 0.5,
  /** Au-delà (durée × images par seconde), seules les images clés sont
   * décodées : ≈ 45 s à 30 images/s. À mesurer sur Render. */
  fullDecodeMaxFrames: 1400,
  /** Réponse JSON de yt-dlp lue au plus. */
  maxMetadataBytes: 8 * 1024 * 1024,
  /** Fichier vidéo téléchargé par yt-dlp, gardé en mémoire le temps de
   * l'extraction : 64 Mo au plus (90 s en 720p pèsent ≈ 10 à 30 Mo). */
  maxMediaBytes: 64 * 1024 * 1024,
  /** Images produites par ffmpeg lues au plus (toutes candidates confondues). */
  maxFfmpegOutputBytes: 48 * 1024 * 1024,
  /** Silence réseau toléré par yt-dlp et ffmpeg. */
  networkTimeoutSeconds: 8,
});
