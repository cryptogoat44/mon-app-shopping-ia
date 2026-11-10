import * as ImagePicker from "expo-image-picker";
import { checkSourceFile, undecodableRefusal, type AvatarPick } from "./avatar-photo";

// Choix de la photo de profil — iPhone (version site : avatar-source.web.ts).
// Galerie : le sélecteur du système ne remet que la photo choisie, sans
// accès au reste de la photothèque (aucune autorisation demandée). Il la
// remet de préférence en JPEG (« compatible ») ; une photo HEIC est de toute
// façon convertie en JPEG au recadrage (lib/avatar-image.ts). Appareil photo :
// l'autorisation d'iOS est demandée au premier appui, caméra avant d'abord.

/** L'appareil photo est proposé (iPhone seulement). */
export const CAN_TAKE_PHOTO = true;

function fromAsset(result: ImagePicker.ImagePickerResult): AvatarPick {
  const asset = result.canceled ? null : (result.assets[0] ?? null);
  if (!asset) return { kind: "cancelled" };
  const file = { mimeType: asset.mimeType, fileName: asset.fileName, fileSize: asset.fileSize };
  const refusal = checkSourceFile(file);
  if (refusal) return { kind: "refused", reason: refusal };
  if (!asset.width || !asset.height) return { kind: "refused", reason: undecodableRefusal(file) };
  return { kind: "picked", image: { uri: asset.uri, width: asset.width, height: asset.height } };
}

export async function pickAvatarFromLibrary(): Promise<AvatarPick> {
  try {
    return fromAsset(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        // Photo restée sur iCloud : téléchargée plutôt que refusée.
        shouldDownloadFromNetwork: true,
      })
    );
  } catch {
    return { kind: "refused", reason: "unreadable" };
  }
}

export async function takeAvatarPhoto(): Promise<AvatarPick> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: "refused", reason: "camera_denied" };
    return fromAsset(await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, cameraType: ImagePicker.CameraType.front }));
  } catch {
    // Appareil photo absent (simulateur) ou indisponible.
    return { kind: "refused", reason: "unreadable" };
  }
}

/** Libère l'image choisie une fois le parcours fini (rien à faire sur iPhone : fichier du cache). */
export function releasePickedImage(_uri: string): void {}
