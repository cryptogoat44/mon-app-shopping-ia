// Essayage virtuel photo (site) : la photo de la personne. Choisie avec le
// sélecteur de fichiers du navigateur, ouverte par le navigateur, puis
// redessinée dans un canevas en JPEG de 1 296 px au plus sur le grand côté :
// toutes les métadonnées (EXIF, dont la localisation) disparaissent, et rien
// n'est écrit nulle part — la photo reste en mémoire le temps de l'essai.
// Les photos HEIC s'ouvrent là où le navigateur sait les lire (Safari) ;
// ailleurs, un message demande un JPEG ou un PNG. Le serveur revérifie tout
// (type réel, taille) et refait l'image. Même façon de choisir un fichier que
// la photo de profil (lib/avatar-source.web.ts).
// Fichier .web : jamais dans l'app iPhone. Aucun accès à `document` au
// chargement du module : les pages du site sont rendues à l'avance, dans Node.
// Testé avec un faux navigateur (tests/tryon-photo.test.ts).

/** Photo choisie la plus lourde acceptée, avant conversion (une photo de
 * 48 Mpx d'iPhone en JPEG pèse jusqu'à ≈ 15 Mo). */
export const PHOTO_SOURCE_MAX_BYTES = 30 * 1024 * 1024;
/** Limite du serveur pour le fichier envoyé (le JPEG converti en est loin). */
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Grand côté du JPEG envoyé (règle du lot, comme le serveur). */
export const PHOTO_MAX_SIDE = 1296;
const JPEG_QUALITY = 0.9;

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
const ACCEPTED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const ACCEPTED_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
/** Ce que le navigateur peut produire en sortie du canevas et que le serveur accepte. */
const OUTPUT_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);

/** `too_large` : la photo choisie ; `upload_too_large` : le JPEG converti (cas extrême). */
export type PhotoRefusal = "format" | "too_large" | "upload_too_large" | "heic_browser" | "unreadable";

/** La photo prête à partir : un JPEG en mémoire. */
export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export type PhotoChoice = { kind: "picked"; photo: PreparedPhoto } | { kind: "refused"; reason: PhotoRefusal };

export interface PhotoFileInfo {
  type: string;
  name: string;
  size: number;
}

function extensionOf(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1]!.toLowerCase() : null;
}

/** Photo HEIC/HEIF (format des photos d'iPhone), d'après son type ou son nom. */
export function isHeicFile(file: PhotoFileInfo): boolean {
  return /^image\/hei[cf]/i.test(file.type) || ["heic", "heif"].includes(extensionOf(file.name) ?? "");
}

/** Refus avant même d'ouvrir la photo : trop lourde, ou d'un autre format
 * que JPEG, PNG, WebP ou HEIC. Type vide (certains navigateurs pour le
 * HEIC) : l'extension décide. */
export function checkPhotoFile(file: PhotoFileInfo): PhotoRefusal | null {
  if (file.size > PHOTO_SOURCE_MAX_BYTES) return "too_large";
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  if (type) return ACCEPTED_TYPES.has(type) || (type === "application/octet-stream" && extension !== null && ACCEPTED_EXTENSIONS.has(extension)) ? null : "format";
  return extension !== null && ACCEPTED_EXTENSIONS.has(extension) ? null : "format";
}

/** Dimensions du JPEG envoyé : jamais agrandi, grand côté ramené à `maxSide`. */
export function fittedSize(width: number, height: number, maxSide: number = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Ouvre le choix d'un fichier. Appelé directement depuis l'appui (le
 * navigateur n'ouvre ce choix qu'à la suite d'un geste). null : annulé. */
export function chooseTryonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** L'image ouverte par le navigateur ; null s'il ne sait pas la lire. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/** Redessine l'image en JPEG à la bonne taille. Fond blanc : une photo PNG
 * transparente ne devient pas noire. Le navigateur applique l'orientation
 * de la photo en la dessinant. */
async function encodeJpeg(image: HTMLImageElement): Promise<PreparedPhoto | null> {
  const size = fittedSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
  const blob = await canvasBlob(canvas);
  // Libère tout de suite la mémoire du canevas (les pixels de la photo).
  canvas.width = 0;
  canvas.height = 0;
  return blob ? { blob, ...size } : null;
}

/** Contrôle, ouverture et conversion d'une photo choisie. L'adresse
 * temporaire du fichier d'origine est libérée dès l'image ouverte. */
export async function preparePhoto(file: File): Promise<PhotoChoice> {
  const info: PhotoFileInfo = { type: file.type, name: file.name, size: file.size };
  const refusal = checkPhotoFile(info);
  if (refusal) return { kind: "refused", reason: refusal };
  const sourceUrl = URL.createObjectURL(file);
  let image: HTMLImageElement | null;
  try {
    image = await loadImage(sourceUrl);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
  if (!image) return { kind: "refused", reason: isHeicFile(info) ? "heic_browser" : "unreadable" };
  const photo = await encodeJpeg(image);
  if (!photo || !OUTPUT_TYPES.has(photo.blob.type)) return { kind: "refused", reason: "unreadable" };
  if (photo.blob.size > PHOTO_UPLOAD_MAX_BYTES) return { kind: "refused", reason: "upload_too_large" };
  return { kind: "picked", photo };
}
