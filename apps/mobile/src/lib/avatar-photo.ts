// Photo de profil (lot « profil et icône des réglages ») : ce qui est
// accepté, les messages d'un refus et les étapes du parcours (choisir,
// cadrer, valider ; ou supprimer). Logique pure, testée sans écran
// (tests/avatar-photo.test.ts). Choix de l'image : lib/avatar-source.ts
// (iPhone) et avatar-source.web.ts (site) ; recadrage : lib/avatar-image.ts.
import { AVATAR_MAX_BYTES } from "@monapp/shared-types";
import { t } from "../i18n";

/** Image choisie, prête à cadrer (dimensions de l'image redressée). */
export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

export type AvatarRefusal = "format" | "heic_browser" | "too_large" | "unreadable" | "camera_denied";

export type AvatarPick = { kind: "picked"; image: PickedImage } | { kind: "cancelled" } | { kind: "refused"; reason: AvatarRefusal };

/** Image choisie la plus lourde acceptée, avant recadrage sur l'appareil
 * (une photo de 48 Mpx d'iPhone en JPEG pèse jusqu'à ≈ 15 Mo). Ce qui part
 * ensuite au serveur est un carré JPEG bien plus léger (AVATAR_MAX_BYTES au plus). */
export const AVATAR_SOURCE_MAX_BYTES = 30 * 1024 * 1024;
/** Côté du carré JPEG envoyé au serveur (qui le refait en 512 px). */
export const AVATAR_UPLOAD_SIDE = 1024;

const ACCEPTED_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const ACCEPTED_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "heic", "heif"]);

export interface SourceFile {
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

function extensionOf(fileName: string | null | undefined): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName ?? "");
  return match ? match[1]!.toLowerCase() : null;
}

/** Photo HEIC/HEIF (format des photos d'iPhone), d'après son type ou son nom. */
export function isHeicLike(file: SourceFile): boolean {
  return /^image\/hei[cf]/i.test(file.mimeType ?? "") || ["heic", "heif"].includes(extensionOf(file.fileName) ?? "");
}

/** Refus d'une image avant même de l'ouvrir : trop lourde, ou d'un format
 * autre que JPEG, PNG ou HEIC. Type et nom inconnus : on laisse essayer. */
export function checkSourceFile(file: SourceFile): AvatarRefusal | null {
  if (typeof file.fileSize === "number" && file.fileSize > AVATAR_SOURCE_MAX_BYTES) return "too_large";
  const type = (file.mimeType ?? "").toLowerCase();
  const extension = extensionOf(file.fileName);
  if (type && !ACCEPTED_TYPES.has(type) && !(extension && ACCEPTED_EXTENSIONS.has(extension))) return "format";
  if (!type && extension && !ACCEPTED_EXTENSIONS.has(extension)) return "format";
  return null;
}

/** Image qui n'a pas pu être ouverte : une photo HEIC sur un navigateur qui
 * ne sait pas la lire (tous sauf Safari), sinon un fichier illisible. */
export function undecodableRefusal(file: SourceFile): AvatarRefusal {
  return isHeicLike(file) ? "heic_browser" : "unreadable";
}

/** Le carré prêt à partir dépasse ce que le serveur accepte. */
export function isUploadTooLarge(bytes: number): boolean {
  return bytes > AVATAR_MAX_BYTES;
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** Le carré prêt à partir dépasse la limite du serveur (cas extrême). */
export function uploadTooLargeMessage(): string {
  return t.avatarPhoto.refusedTooLarge(megabytes(AVATAR_MAX_BYTES));
}

/** Message montré pour un refus, dans la langue de l'app. */
export function refusalMessage(reason: AvatarRefusal): string {
  switch (reason) {
    case "format":
      return t.avatarPhoto.refusedFormat;
    case "heic_browser":
      return t.avatarPhoto.refusedHeicBrowser;
    case "too_large":
      return t.avatarPhoto.refusedTooLarge(megabytes(AVATAR_SOURCE_MAX_BYTES));
    case "camera_denied":
      return t.cameraCapture.denied;
    default:
      return t.avatarPhoto.refusedUnreadable;
  }
}

// ---------------------------------------------------------------------
// Étapes : menu → choix de l'image → cadrage → envoi ; ou menu →
// confirmation → suppression. Un refus ou un échec ramène à l'étape d'avant,
// avec son message ; jamais de fermeture muette.
// ---------------------------------------------------------------------

export type AvatarFlow =
  | { step: "closed" }
  | { step: "menu"; error: string | null }
  | { step: "picking" }
  | { step: "confirmDelete" }
  | { step: "deleting" }
  | { step: "crop"; image: PickedImage; error: string | null }
  | { step: "sending"; image: PickedImage };

export type AvatarFlowEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "pick" }
  | { type: "picked"; result: AvatarPick }
  | { type: "askDelete" }
  | { type: "confirmDelete" }
  | { type: "validate" }
  | { type: "succeeded" }
  | { type: "failed"; message: string };

export const CLOSED: AvatarFlow = { step: "closed" };

export function avatarFlow(state: AvatarFlow, event: AvatarFlowEvent): AvatarFlow {
  switch (event.type) {
    case "open":
      return state.step === "closed" ? { step: "menu", error: null } : state;
    case "close":
      // Pendant un envoi ou une suppression, on attend la réponse.
      return state.step === "sending" || state.step === "deleting" ? state : CLOSED;
    case "pick":
      return state.step === "menu" ? { step: "picking" } : state;
    case "picked":
      if (state.step !== "picking" && state.step !== "menu") return state;
      if (event.result.kind === "picked") return { step: "crop", image: event.result.image, error: null };
      if (event.result.kind === "refused") return { step: "menu", error: refusalMessage(event.result.reason) };
      return CLOSED;
    case "askDelete":
      return state.step === "menu" ? { step: "confirmDelete" } : state;
    case "confirmDelete":
      return state.step === "confirmDelete" ? { step: "deleting" } : state;
    case "validate":
      return state.step === "crop" ? { step: "sending", image: state.image } : state;
    case "succeeded":
      return state.step === "sending" || state.step === "deleting" ? CLOSED : state;
    case "failed":
      if (state.step === "sending") return { step: "crop", image: state.image, error: event.message };
      if (state.step === "deleting") return { step: "menu", error: event.message };
      return state;
  }
}
