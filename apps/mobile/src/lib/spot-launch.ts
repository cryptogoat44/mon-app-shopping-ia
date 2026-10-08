// Parcours unique du Spotter (lot 4 ter) : une vidéo ou une photo, quelques
// mots, « Lancer » — puis tout s'enchaîne sans autre geste. Vidéo : images
// extraites sur l'appareil, meilleur moment et cadre de la pièce par l'IA
// (avec l'accord « analyse_video_ia »), identification. Photo : identification
// directe, sur la zone centrale (comme au ciblage quand on ne touche pas au
// cadre). Le curseur et le choix manuel ne servent qu'en repli.
import type { ConsentStatus, CropRect } from "@monapp/shared-types";
import { setLastSpotResult } from "../api/spotSession";
import { fetchConsentStatus, fetchVideoAiEnabled } from "./api";
import { DEFAULT_CROP } from "./crop-geometry";
import { hasCurrentConsent } from "./policy-notice";
import { updateDraft, type SpotDraft } from "./spot-draft";
import { identifyDraft } from "./spot-identify";
import { analyzeVideo, prepareMoment, remainingMoments, type AutoFailure } from "./video-auto";
import type { OpenedVideo } from "./video-timeline";

/** Accord pour l'analyse par IA : donné (sur le texte en vigueur) ; refusé
 * (jamais redemandé : réactivable d'un geste ou dans Réglages) ; à demander
 * (jamais demandé, ou donné sur un texte qui a changé depuis). */
export type VideoAiChoice = "granted" | "declined" | "ask";

export function videoAiChoice(statuses: readonly ConsentStatus[]): VideoAiChoice {
  if (hasCurrentConsent(statuses, "analyse_video_ia")) return "granted";
  const status = statuses.find((item) => item.type === "analyse_video_ia");
  return status?.decidedAt && !status.grantedAt ? "declined" : "ask";
}

export interface VideoAiReadiness {
  /** Analyse automatique active sur le serveur (clé présente). */
  enabled: boolean;
  choice: VideoAiChoice;
}

/** Vérifié en arrière-plan dès l'ouverture de l'écran : le champ reste
 * disponible tout de suite, la réponse arrive pendant la saisie. */
export async function checkVideoAi(): Promise<VideoAiReadiness> {
  const [enabled, statuses] = await Promise.all([fetchVideoAiEnabled(), fetchConsentStatus()]);
  return { enabled, choice: videoAiChoice(statuses) };
}

export type LaunchOutcome =
  /** Identification terminée (réussie ou non) : l'écran Résultat prend le relais. */
  | { kind: "result"; searchId: string | null }
  /** L'IA n'a pas repéré la pièce : un vrai résultat, pas une panne. */
  | { kind: "not_found" }
  | { kind: "failed"; reason: Exclude<AutoFailure, "consent"> }
  /** Accord retiré entre-temps (sur un autre appareil, par exemple). */
  | { kind: "consent_required" }
  /** Moments trouvés, mais l'image n'a pas pu être extraite de la vidéo :
   * réessayer ne rappelle pas l'IA. */
  | { kind: "prepare_failed" }
  | { kind: "cancelled" };

async function identify(draft: SpotDraft, signal: AbortSignal): Promise<LaunchOutcome> {
  const outcome = await identifyDraft(draft, signal);
  return outcome.kind === "cancelled" ? outcome : { kind: "result", searchId: outcome.searchId };
}

/** Meilleur moment pas encore essayé : image en pleine taille, cadre de
 * l'IA, puis identification (1 crédit). `onDraft` reçoit l'image recadrée,
 * affichée pendant l'attente. */
export async function identifyNextMoment(video: OpenedVideo, signal: AbortSignal, onDraft?: (draft: SpotDraft) => void): Promise<LaunchOutcome> {
  const rank = remainingMoments(video)[0];
  if (rank === undefined) return { kind: "not_found" };
  let draft: SpotDraft;
  try {
    draft = await prepareMoment(video, rank);
  } catch {
    return { kind: "prepare_failed" };
  }
  if (signal.aborted) return { kind: "cancelled" };
  onDraft?.(draft);
  return identify(draft, signal);
}

/** Vidéo : analyse sur l'appareil puis par l'IA, et identification du meilleur moment. */
export async function launchVideo(video: OpenedVideo, query: string, signal: AbortSignal, onDraft?: (draft: SpotDraft) => void): Promise<LaunchOutcome> {
  const analysis = await analyzeVideo(video, query, () => undefined, signal);
  if (analysis.kind === "cancelled" || analysis.kind === "not_found") return analysis;
  // Plafond global des recherches atteint (lot 4 quater) : annoncé sur l'écran
  // Résultat, comme pour une photo ; aucune identification n'est tentée.
  if (analysis.kind === "capacity") {
    setLastSpotResult({ searchId: null, status: "failed", pieces: [], similarPieces: [], failReason: "capacity", capacity: analysis.capacity, query: query.trim() || null });
    return { kind: "result", searchId: null };
  }
  if (analysis.kind === "failed") return analysis.reason === "consent" ? { kind: "consent_required" } : { kind: "failed", reason: analysis.reason };
  return identifyNextMoment(video, signal, onDraft);
}

/** Zone analysée d'une photo : celle déjà choisie (recadrage), sinon la zone centrale. */
export function photoCrop(draft: SpotDraft): CropRect {
  return draft.crop ?? DEFAULT_CROP;
}

/** Photo : la zone entourée sur l'écran (cadre « Entourez la pièce », option B
 * du fondateur) et les mots tapés, puis l'identification. */
export async function launchPhoto(draft: SpotDraft, query: string, signal: AbortSignal, crop: CropRect = photoCrop(draft)): Promise<LaunchOutcome> {
  const ready = updateDraft({ crop, query: query.trim() }) ?? draft;
  return identify(ready, signal);
}
