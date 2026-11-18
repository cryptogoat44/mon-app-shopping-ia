// Publier plusieurs photos (lot « vie sociale », migration 0047) : la
// publication est créée avec la photo 1, exactement comme avant, puis chaque
// autre photo lui est ajoutée, une par requête (POST /api/posts/:id/media),
// l'une après l'autre. L'écran reste ouvert jusqu'à la dernière ; une photo
// manquée propose « Réessayer » ou « Continuer sans cette photo ». Pendant
// ces quelques secondes, les abonnés peuvent voir la publication avec moins
// de photos : accepté (fiche 9).
// Logique pure, testée à part (tests/photos-identifications.test.ts).
import { POST_EXTRAS_UNAVAILABLE_ERROR, POST_MEDIA_CLOSED_ERROR, POST_MEDIA_FULL_ERROR, POST_PHOTOS_MAX } from "@monapp/shared-types";
import { ApiError } from "./api-error";
import { t } from "../i18n";

/** Les photos choisies, dans l'ordre : celles déjà là, puis les nouvelles,
 * sans doublon, POST_PHOTOS_MAX au plus. */
export function mergePicked(current: readonly string[], picked: readonly string[], max: number = POST_PHOTOS_MAX): string[] {
  const merged: string[] = [];
  for (const uri of [...current, ...picked]) {
    if (merged.length >= max) break;
    if (uri && !merged.includes(uri)) merged.push(uri);
  }
  return merged;
}

/** Les photos sans celle de cette place. */
export function removePhotoAt(list: readonly string[], index: number): string[] {
  return list.filter((_, position) => position !== index);
}

/** Combien de photos le sélecteur peut encore rendre. */
export function remainingSlots(list: readonly string[], max: number = POST_PHOTOS_MAX): number {
  return Math.max(0, max - list.length);
}

/** Où en est l'envoi. `index` : le numéro de la photo (2 à `total`), comme
 * l'écran le dit (« Photo 2 sur 5 ») ; `skipped` : les photos laissées de
 * côté jusque-là (« Continuer sans cette photo »). */
export type UploadState =
  | { step: "idle" }
  | { step: "creating"; total: number }
  | { step: "adding"; postId: string; index: number; total: number; skipped: number }
  | { step: "failed"; postId: string; index: number; total: number; skipped: number; retryable: boolean }
  | { step: "done"; postId: string; skipped: number };

export const UPLOAD_IDLE: UploadState = { step: "idle" };

/** « Publier » : la publication part avec la photo 1. */
export function startUpload(total: number): UploadState {
  return { step: "creating", total: Math.max(1, Math.min(total, POST_PHOTOS_MAX)) };
}

/** Après la photo `index` : la suivante, ou fini. */
function after(postId: string, index: number, total: number, skipped: number): UploadState {
  return index >= total ? { step: "done", postId, skipped } : { step: "adding", postId, index: index + 1, total, skipped };
}

/** La publication existe : la photo 2 suit (ou c'est fini, avec une seule photo). */
export function postCreated(state: UploadState, postId: string): UploadState {
  return state.step === "creating" ? after(postId, 1, state.total, 0) : state;
}

/** La photo en cours est enregistrée. */
export function photoAdded(state: UploadState): UploadState {
  return state.step === "adding" ? after(state.postId, state.index, state.total, state.skipped) : state;
}

/** La photo en cours a échoué. `retryable` : faux quand réessayer ne
 * servirait à rien (publication fermée, déjà pleine, nouveauté absente). */
export function photoFailed(state: UploadState, retryable: boolean): UploadState {
  return state.step === "adding" ? { ...state, step: "failed", retryable } : state;
}

/** « Réessayer » : la même photo repart. */
export function retryPhoto(state: UploadState): UploadState {
  if (state.step !== "failed" || !state.retryable) return state;
  return { step: "adding", postId: state.postId, index: state.index, total: state.total, skipped: state.skipped };
}

/** « Continuer sans cette photo ». */
export function skipPhoto(state: UploadState): UploadState {
  return state.step === "failed" ? after(state.postId, state.index, state.total, state.skipped + 1) : state;
}

/** Une photo refusée pour de bon : la publication ne reçoit plus de photo
 * (10 minutes passées), elle est pleine, introuvable, ou la nouveauté n'est
 * pas sur le serveur. Une coupure du réseau, une limite atteinte ou une
 * panne du serveur : on peut réessayer. */
export function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  const code = error.body?.error;
  if (code === POST_MEDIA_CLOSED_ERROR || code === POST_MEDIA_FULL_ERROR || code === POST_EXTRAS_UNAVAILABLE_ERROR) return false;
  return error.status !== 404;
}

/** Le texte de l'écran pendant l'envoi ; null quand rien n'est à dire. */
export function uploadMessage(state: UploadState): string | null {
  if (state.step === "creating") return state.total > 1 ? t.carousel.uploading(1, state.total) : null;
  if (state.step === "adding") return t.carousel.uploading(state.index, state.total);
  if (state.step === "failed") return state.retryable ? t.carousel.photoFailed : t.carousel.photoRefused;
  return null;
}

/** L'envoi occupe l'écran (« Publier », « Annuler » et les choix inactifs). */
export function uploadBusy(state: UploadState): boolean {
  return state.step === "creating" || state.step === "adding" || state.step === "failed";
}
