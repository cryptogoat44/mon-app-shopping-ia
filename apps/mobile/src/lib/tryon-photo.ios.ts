// Essayage virtuel photo, app iPhone : la photo de la personne. Choisie dans
// la photothèque (le sélecteur d'iOS ne remet que la photo choisie, sans
// autorisation à demander) ou prise avec l'appareil photo (autorisation
// d'iOS demandée au premier appui, comme « Prendre une photo » du Spotter,
// lib/image-import.ts ; la photo prise n'entre jamais dans la photothèque),
// puis convertie sur l'iPhone : un JPEG de 1 296 px au plus sur le grand
// côté, redessiné droit, sans les métadonnées de la photo d'origine (dont la
// localisation). Le serveur revérifie tout (type réel, taille) et refait
// l'image. Chaque fichier écrit en route est effacé dès qu'il ne sert plus
// (lib/tryon-files.ios.ts). Version site : tryon-photo.web.ts, dont les
// limites sont reprises (taille de l'envoi, grand côté).
// Imports relatifs : fichier testé par vitest (tests/tryon-iphone.test.ts).
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { t } from "../i18n";
import { photoRefusalMessage } from "./tryon-flow.ios";
import { PHOTO_UPLOAD_MAX_BYTES, fittedSize } from "./tryon-photo.web";
import { discardTryonFile, keepInTryonDirectory } from "./tryon-files.ios";

/** Même qualité que le site (tryon-photo.web.ts). */
const JPEG_QUALITY = 0.9;

export type PhotoSource = "library" | "camera";

/** Refus sur l'iPhone, avant tout envoi. `unavailable` : le sélecteur n'a pas
 * pu remettre la photo (restée sur iCloud, sans connexion, par exemple). */
export type IphonePhotoRefusal = "unreadable" | "upload_too_large" | "camera_denied" | "camera_unavailable" | "unavailable";

/** Copie remise par le sélecteur ou l'appareil photo, rangée dans le dossier de l'essayage. */
export interface PickedPhoto {
  uri: string;
}

/** La photo prête à partir : le JPEG converti, dans le dossier de l'essayage. */
export interface TryonPhoto {
  uri: string;
  width: number;
  height: number;
}

export type PickOutcome = { kind: "picked"; picked: PickedPhoto } | { kind: "cancelled" } | { kind: "refused"; reason: IphonePhotoRefusal };
export type PrepareOutcome = { kind: "ready"; photo: TryonPhoto } | { kind: "refused"; reason: IphonePhotoRefusal };

async function launch(source: PhotoSource): Promise<ImagePicker.ImagePickerResult | "denied"> {
  if (source === "library") {
    return ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      // JPEG de préférence ; une photo HEIC est de toute façon convertie ensuite.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      // Photo restée sur iCloud : téléchargée plutôt que refusée.
      shouldDownloadFromNetwork: true,
    });
  }
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return "denied";
  return ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
}

/** Ouvre la photothèque ou l'appareil photo. La copie remise est aussitôt
 * rangée dans le dossier de l'essayage. */
export async function pickTryonPhoto(source: PhotoSource): Promise<PickOutcome> {
  let result: ImagePicker.ImagePickerResult | "denied";
  try {
    result = await launch(source);
  } catch {
    // Appareil photo absent (simulateur) ou indisponible ; photo que le sélecteur n'a pas pu remettre.
    return { kind: "refused", reason: source === "camera" ? "camera_unavailable" : "unavailable" };
  }
  if (result === "denied") return { kind: "refused", reason: "camera_denied" };
  if (result.canceled) return { kind: "cancelled" };
  const [asset, ...extra] = result.assets;
  // Une seule photo est demandée : une copie de plus ne servirait à rien.
  for (const other of extra) discardTryonFile(other.uri);
  if (!asset) return { kind: "cancelled" };
  return { kind: "picked", picked: { uri: keepInTryonDirectory(asset.uri) } };
}

/** Convertit la copie remise par le sélecteur en JPEG prêt à partir, puis
 * efface cette copie, quelle que soit l'issue. La taille est lue sur l'image
 * ouverte, droite (orientation appliquée) : celle annoncée par le sélecteur
 * peut être celle d'une photo couchée. */
export async function prepareTryonPhoto(picked: PickedPhoto): Promise<PrepareOutcome> {
  let original: ImageRef | null = null;
  let resized: ImageRef | null = null;
  let savedUri: string | null = null;
  try {
    original = await ImageManipulator.manipulate(picked.uri).renderAsync();
    if (original.width <= 0 || original.height <= 0) return { kind: "refused", reason: "unreadable" };
    const size = fittedSize(original.width, original.height);
    let image: ImageRef = original;
    if (size.width !== original.width || size.height !== original.height) {
      resized = await ImageManipulator.manipulate(original).resize(size).renderAsync();
      image = resized;
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    savedUri = keepInTryonDirectory(saved.uri);
    if (new File(savedUri).size > PHOTO_UPLOAD_MAX_BYTES) {
      discardTryonFile(savedUri);
      return { kind: "refused", reason: "upload_too_large" };
    }
    return { kind: "ready", photo: { uri: savedUri, width: saved.width, height: saved.height } };
  } catch {
    // Conversion interrompue après l'écriture du JPEG : il ne servira pas.
    discardTryonFile(savedUri);
    return { kind: "refused", reason: "unreadable" };
  } finally {
    // Images ouvertes : libérées sans attendre (elles pèsent lourd en mémoire).
    resized?.release();
    original?.release();
    // La copie du sélecteur ne sert plus, quelle que soit l'issue.
    discardTryonFile(picked.uri);
  }
}

/** Le JPEG à joindre à l'envoi : le File d'expo-file-system, un vrai Blob lu
 * depuis le fichier (le fetch d'Expo refuse l'objet { uri, name, type } de
 * React Native, lib/image-file.ts). Le fichier reste à effacer après l'envoi. */
export function photoBody(photo: TryonPhoto): Blob {
  return new File(photo.uri);
}

/** Message d'un refus sur l'iPhone, dans la langue de l'app. Les textes
 * viennent du catalogue du site et de fr.ts / en.ts : aucun n'est écrit deux
 * fois. Le bouton cité est celui de l'étape photo (« Choisir dans la galerie »). */
export function iphonePhotoRefusalMessage(reason: IphonePhotoRefusal): string {
  switch (reason) {
    case "unreadable":
    case "upload_too_large":
      return photoRefusalMessage(reason);
    case "camera_denied":
      return t.cameraCapture.denied;
    case "camera_unavailable":
      return t.cameraCapture.unavailable(t.avatarPhoto.chooseFromLibrary);
    case "unavailable":
      return t.common.photoUnavailable;
  }
}
