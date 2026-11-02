// Interrupteurs de la voie C (lot c, 2026-11-02) : le seul endroit qui lit
// VOIE_C_ENABLED, VOIE_C_AI_ENABLED et ANTHROPIC_PHOTO_ENABLED (src/env.ts).
// Tous coupés par défaut ; seule la valeur exacte "true" en allume un. Ils ne
// sont pas dans la liste des variables que les outils peuvent changer
// (scripts/lib/render-guard.ts, EDITABLE_VARIABLES) : le fondateur seul les
// allume, à la main, dans le tableau de bord de Render.
//
// L'interrupteur de la photo n'est pas décoratif : assertNoUserImage refuse
// tout bloc image avant chaque appel à Anthropic de la voie C tant qu'il est
// coupé. Dans ce lot, la voie C n'envoie d'ailleurs aucune image : seulement
// les titres et les sites des premiers résultats Lens. Attention : l'analyse
// des vidéos existante (routes/videoMoments.ts, consentement analyse_video_ia)
// envoie déjà des images d'une vidéo à Anthropic, et cet interrupteur ne la
// couvre PAS (décision du fondateur à confirmer).
// Un futur chemin qui enverrait une photo (recadrage par l'IA, requête tirée
// de l'image) devra vérifier cet interrupteur ET, côté serveur, avant de
// traiter l'image, un consentement à jour d'une nouvelle version validée par
// la juriste — version qui n'est PAS ajoutée à ACCEPTED_CONSENT_VERSIONS ici.
import { env } from "../env.js";

/** Toute la voie C : complément « boutiques » au lancement et route « Que cherchez-vous ? ». */
export function voieCEnabled(): boolean {
  return env.VOIE_C_ENABLED;
}

/** L'étape IA de la voie C (titres Lens → requête) : interrupteur allumé ET clé d'Anthropic présente. */
export function voieCAiEnabled(): boolean {
  return env.VOIE_C_AI_ENABLED && Boolean(env.ANTHROPIC_API_KEY);
}

/** Envoi d'une photo d'un utilisateur à Anthropic : coupé par défaut. */
export function userPhotoToAnthropicAllowed(): boolean {
  return env.ANTHROPIC_PHOTO_ENABLED;
}

/** Bloc image refusé : le message ne contient jamais de contenu. */
export class UserImageRefusedError extends Error {
  constructor() {
    super("user_image_refused");
    this.name = "UserImageRefusedError";
  }
}

// Profondeur bornée : le corps d'une requête à l'API Messages est peu profond
// (messages → content → bloc → source) ; au-delà, on refuse par prudence.
const MAX_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Un bloc image (type « image »), ou une source d'image (media_type image/…), quelque part dans le corps ? */
function containsImage(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => containsImage(item, depth + 1));
  if (!isRecord(value)) return false;
  if (value.type === "image") return true;
  if (typeof value.media_type === "string" && value.media_type.toLowerCase().startsWith("image/")) return true;
  return Object.values(value).some((item) => containsImage(item, depth + 1));
}

/** À appeler juste avant chaque appel à Anthropic de la voie C : lève une
 * erreur sans contenu si le corps contient une image alors que l'envoi d'une
 * photo est coupé. */
export function assertNoUserImage(body: unknown): void {
  if (userPhotoToAnthropicAllowed()) return;
  if (containsImage(body, 0)) throw new UserImageRefusedError();
}
