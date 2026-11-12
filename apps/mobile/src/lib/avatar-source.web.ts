import { checkSourceFile, undecodableRefusal, type AvatarPick } from "./avatar-photo";

// Choix de la photo de profil — site (version iPhone : avatar-source.ts).
// Un fichier de l'ordinateur ou du téléphone : JPEG, PNG ou HEIC. Le
// navigateur doit savoir l'ouvrir pour qu'on la cadre : seul Safari lit le
// HEIC ; ailleurs, un message clair le dit (« heic_browser »).

/** Pas d'appareil photo sur le site : « Choisir un fichier » suffit (sur
 * téléphone, le navigateur propose aussi de prendre une photo). */
export const CAN_TAKE_PHOTO = false;

const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif";

/** Ouvre le choix d'un fichier. Appelé directement depuis l'appui (le
 * navigateur n'ouvre ce choix qu'à la suite d'un geste). null : annulé. */
function chooseFile(): Promise<File | null> {
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

/** Dimensions de l'image ouverte par le navigateur ; null s'il ne sait pas la lire. */
function measure(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    image.onerror = () => resolve(null);
    image.src = uri;
  });
}

export async function pickAvatarFromLibrary(): Promise<AvatarPick> {
  const file = await chooseFile();
  if (!file) return { kind: "cancelled" };
  const info = { mimeType: file.type, fileName: file.name, fileSize: file.size };
  const refusal = checkSourceFile(info);
  if (refusal) return { kind: "refused", reason: refusal };
  const uri = URL.createObjectURL(file);
  const size = await measure(uri);
  if (!size) {
    URL.revokeObjectURL(uri);
    return { kind: "refused", reason: undecodableRefusal(info) };
  }
  return { kind: "picked", image: { uri, ...size } };
}

export async function takeAvatarPhoto(): Promise<AvatarPick> {
  return { kind: "cancelled" };
}

/** Libère l'image choisie une fois le parcours fini. */
export function releasePickedImage(uri: string): void {
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}
