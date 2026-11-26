// « Pincez pour zoomer » (retours du build 3, réponse du fondateur aux
// maquettes, 26 novembre 2026 : « oui bonne idée » pour ne l'afficher que la
// toute première fois). Une petite pastille sur la première grande image
// zoomable vue sur l'iPhone (components/image-viewer.tsx) ; elle ne revient
// plus jamais. Même convention que le guide de la première recherche
// (lib/first-run-guide.ts) : une marque rangée sur l'appareil (AsyncStorage)
// dès que l'aide s'affiche, pour tous les comptes de l'appareil (simple aide
// d'affichage), jamais envoyée. Lecture impossible : considérée comme vue
// (jamais répétée par erreur). Site : jamais (une souris ne pince pas).
// Logique pure, testée : le stockage est passé en paramètre. Imports
// relatifs : fichier testé par vitest.

export const ZOOM_HINT_KEY = "spotto.zoom-hint-seen";
/** La pastille disparaît d'elle-même après ce délai (ms), ou au premier pincement. */
export const ZOOM_HINT_MS = 4000;

/** Ce qu'il faut du stockage (AsyncStorage dans l'app). */
export interface ZoomHintStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** L'aide a-t-elle déjà été montrée sur cet appareil ? Lecture impossible : oui. */
export async function loadZoomHintSeen(store: ZoomHintStore): Promise<boolean> {
  try {
    return (await store.getItem(ZOOM_HINT_KEY)) !== null;
  } catch {
    return true;
  }
}

/** Range la marque « déjà montrée ». Écriture impossible : rien (l'aide reste rare : 4 s, au plus une fois par ouverture de l'app). */
export async function markZoomHintSeen(store: ZoomHintStore): Promise<void> {
  try {
    await store.setItem(ZOOM_HINT_KEY, "1");
  } catch {
    // Rien à faire.
  }
}

/** L'aide peut-elle s'afficher maintenant ? Oui une seule fois par appareil,
 * jamais sur le site : la marque est rangée aussitôt. */
export async function claimZoomHint(store: ZoomHintStore, platform: string): Promise<boolean> {
  if (platform === "web") return false;
  if (await loadZoomHintSeen(store)) return false;
  await markZoomHintSeen(store);
  return true;
}
