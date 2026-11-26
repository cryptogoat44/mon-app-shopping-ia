// « Spotter ce moment » (mission « liens vidéo », app iPhone) : l'instantané
// de ce que la vue web du lecteur officiel montre, par le module natif local
// modules/spotto-player-snapshot (WKWebView.takeSnapshot, après la pause des
// médias de la vue). Rien d'autre : aucun fichier de la plateforme n'est
// jamais demandé (règle absolue n° 2).
//
// ⚠️ SI L'INSTANTANÉ SORT NOIR SUR UN VRAI IPHONE : S'ARRÊTER LÀ. Aucune autre
// méthode de capture ne peut être ajoutée sans la décision du fondateur.
// L'écran de secours « Spottez cette vidéo » reste le chemin.
//
// Retours du build 2 : l'image rendue est CONTRÔLÉE (ce n'est pas une autre
// méthode de capture) : noire ou blanche (contrôle repris du commit 93ba4d1,
// player-state.ts isBlankFrame), ou illisible, elle est effacée et refusée ;
// l'écran passe alors à la recherche automatique ou à l'écran de secours
// (snapshot_failed). Le contrôle est fait ici, en JS, et non dans le module
// natif : il marche aussi avec les builds 1 et 2 déjà installés.
//
// Retours du build 3 (accord du fondateur du 26 novembre 2026) : pour TikTok,
// l'image du moment demandée à notre serveur (lot 1, `frame: true`) est
// désormais la voie principale (lecteur.tsx, lib/spot-moment.ts) ;
// l'instantané reste le SECOURS, et pour Instagram la seule voie. Il est
// contrôlé : noir ou blanc (« blank_frame »), et désormais flou
// (« blurry_frame », player-state.ts isBlurryFrame), sur la même petite copie
// de 96 px, sans coût de plus. Refusé, il est effacé avant l'erreur.
// Le refus pour flou ne vaut que pour TikTok (blurCheckApplies) : la mesure
// ne distingue pas un tissu uni à plis doux, net, d'une image floue, et pour
// Instagram l'instantané est la seule voie (le doute profite au membre).
//
// Module absent de l'app installée (les deux lecteurs coupés au build, ou
// Expo Go) : `snapshotAvailable` vaut false, et l'écran montre le secours.
// Version site : player-snapshot.web.ts (jamais de capture sur le site).
import { requireOptionalNativeModule } from "expo";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";
import type { PlayerPlatform } from "./player-link";
import { blurCheckApplies, frameSharpness, isBlankFrame, isBlurryFrame } from "./player-state";
import { base64ToBytes, decodePngSample } from "./png-pixels";
import { discardLocalFile } from "./video-frames";

/** Nom du module natif local (modules/spotto-player-snapshot/ios). */
const NATIVE_MODULE = "SpottoPlayerSnapshot";

interface PlayerSnapshotModule {
  /** JPEG de 1 600 px au plus, qualité 0,8, dans le sous-dossier
   * « lecteur-instantane/ » du cache (vidé à chaque lancement :
   * player-snapshot-files.ts) : son adresse file://. */
  snapshot(viewTag: number): Promise<string>;
}

const native = requireOptionalNativeModule<PlayerSnapshotModule>(NATIVE_MODULE);

export const snapshotAvailable: boolean = native !== null;

export interface PlayerSnapshot {
  uri: string;
  width: number;
  height: number;
}

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

/** Côté de la petite copie examinée, en pixels (comme l'ancien contrôle). */
const BLANK_CHECK_EDGE = 96;

/** Petite copie PNG (96 px), décodée dans l'app comme video-frames.ts :
 * noire ou blanche (« blank_frame »), floue (« blurry_frame »), ou bonne
 * (null) ? Sa copie est effacée aussitôt. Illisible : traitée comme vide. */
async function looksUnusable(uri: string, checkBlur: boolean): Promise<"blank_frame" | "blurry_frame" | null> {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: BLANK_CHECK_EDGE });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
    discardLocalFile(saved.uri);
    if (!saved.base64) return "blank_frame";
    const sample = decodePngSample(base64ToBytes(saved.base64));
    if (isBlankFrame(sample)) return "blank_frame";
    if (!checkBlur) return null;
    // Calibrage du seuil sur l'iPhone (BLUR_LIMITS) : la valeur seule, jamais l'image.
    if (typeof __DEV__ !== "undefined" && __DEV__) console.info("[player] netteté", frameSharpness(sample)?.toFixed(3) ?? "rien à juger");
    return isBlurryFrame(sample) ? "blurry_frame" : null;
  } catch {
    return "blank_frame";
  }
}

/** Instantané du conteneur natif `viewTag` (celui qui entoure la vue web du
 * lecteur). Le fichier est à effacer par l'appelant (discardLocalFile) dès
 * que la recherche est partie, ou si elle est abandonnée. Taille illisible :
 * le fichier est effacé ici, avant l'erreur (son adresse serait perdue).
 * Image noire, blanche ou illisible : effacée ici, puis « blank_frame » ;
 * floue (TikTok seulement) : effacée ici, puis « blurry_frame »
 * (lib/spot-moment.ts). */
export async function snapshotPlayer(viewTag: number, platform: PlayerPlatform): Promise<PlayerSnapshot> {
  if (!native) throw new Error("player snapshot module missing");
  const uri = await native.snapshot(viewTag);
  if (typeof uri !== "string" || !uri.startsWith("file://")) throw new Error("player snapshot: unexpected answer");
  try {
    const { width, height } = await imageSize(uri);
    const unusable = await looksUnusable(uri, blurCheckApplies(platform));
    if (unusable) throw new Error(unusable);
    return { uri, width, height };
  } catch (error) {
    discardLocalFile(uri);
    throw error;
  }
}
