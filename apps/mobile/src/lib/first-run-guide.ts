// Guide de la première recherche (lot « recherche confiance ») : trois étapes
// illustrées sur Spotter, la toute première fois seulement, pour une
// personne qui n'a encore rien spotté — sur l'app comme sur le site.
// Même convention que la carte « Astuce » (components/visual-search-tip.tsx) :
// une marque rangée sur l'appareil (AsyncStorage, localStorage sur le site)
// dès que le guide s'affiche ; il ne revient jamais, fermé ou non. Stockage
// indisponible : il n'est pas montré, plutôt que de revenir sans fin.
// Logique pure, testée : le stockage est passé en paramètre. Imports
// relatifs : fichier testé par vitest.

export const FIRST_RUN_GUIDE_KEY = "spotto.guide-premiere-recherche";
/** Partager ou coller le lien, entourer la pièce, comparer et créer une alerte. */
export const FIRST_RUN_GUIDE_STEPS = 3;

/** Ce qu'il faut du stockage (AsyncStorage dans l'app). */
export interface GuideStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Le guide peut-il s'afficher maintenant ? Oui une seule fois par appareil :
 * la marque est rangée aussitôt. Lecture ou écriture impossible : non. */
export async function claimFirstRunGuide(store: GuideStore): Promise<boolean> {
  try {
    if (await store.getItem(FIRST_RUN_GUIDE_KEY)) return false;
    await store.setItem(FIRST_RUN_GUIDE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Une personne qui a déjà spotté (historique non vide) : jamais le guide,
 * la marque est rangée sans rien montrer. Stockage indisponible : rien. */
export async function skipFirstRunGuide(store: GuideStore): Promise<void> {
  try {
    if (!(await store.getItem(FIRST_RUN_GUIDE_KEY))) await store.setItem(FIRST_RUN_GUIDE_KEY, "1");
  } catch {
    // Rien à faire : le guide n'est montré qu'à un historique vide.
  }
}

/** L'étape suivante ; null après la dernière (le bouton lance alors une vraie recherche). */
export function nextGuideStep(step: number): number | null {
  return step + 1 < FIRST_RUN_GUIDE_STEPS ? step + 1 : null;
}
