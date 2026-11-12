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
// Module absent de l'app installée (les deux lecteurs coupés au build, ou
// Expo Go) : `snapshotAvailable` vaut false, et l'écran montre le secours.
// Version site : player-snapshot.web.ts (jamais de capture sur le site).
import { requireOptionalNativeModule } from "expo";
import { Image } from "react-native";

/** Nom du module natif local (modules/spotto-player-snapshot/ios). */
const NATIVE_MODULE = "SpottoPlayerSnapshot";

interface PlayerSnapshotModule {
  /** JPEG de 1 600 px au plus, qualité 0,8, dans le cache de l'app : son adresse file://. */
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

/** Instantané du conteneur natif `viewTag` (celui qui entoure la vue web du
 * lecteur). Le fichier est à effacer par l'appelant (discardLocalFile) dès
 * que la recherche est partie, ou si elle est abandonnée. */
export async function snapshotPlayer(viewTag: number): Promise<PlayerSnapshot> {
  if (!native) throw new Error("player snapshot module missing");
  const uri = await native.snapshot(viewTag);
  if (typeof uri !== "string" || !uri.startsWith("file://")) throw new Error("player snapshot: unexpected answer");
  const { width, height } = await imageSize(uri);
  return { uri, width, height };
}
