// Import relatif : fichier testé par vitest.
import { isShareOpeningUrl } from "../lib/shared-item";

// Adresses reçues par l'app iPhone avant la navigation. L'extension de partage
// (lot « partager vers Spotto ») rouvre l'app par « spotto://dataUrl=… » : ce
// n'est pas un écran (sinon « page introuvable »). App fermée : elle démarre
// comme d'habitude, à l'accueil ; app ouverte : on reste sur l'écran affiché.
// Le contenu partagé est lu à part (lib/share-intake.ts) puis ouvert dans le
// Spotter. Toute autre adresse passe telle quelle.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (!isShareOpeningUrl(path)) return path;
    return initial ? "/" : null;
  } catch {
    return path;
  }
}
