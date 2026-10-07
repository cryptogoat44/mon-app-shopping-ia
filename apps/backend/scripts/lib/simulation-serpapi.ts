// Constantes de la simulation de SerpApi (lot 4 ter), partagées par le module
// chargé dans le serveur local (serpapi-simule.ts) et par l'outil
// parcours-iphone. Sans effet de bord : l'importer ne remplace rien.
import { fileURLToPath } from "node:url";

/** Ligne écrite par le serveur local quand la simulation est en place :
 * l'outil l'attend avant tout parcours, sinon il s'arrête. */
export const MARQUE_SIMULATION_SERPAPI = "[simulation SerpApi] active — aucun appel réel, aucun crédit";
/** Module à charger dans le serveur local (« tsx --import »). */
export const FICHIER_SIMULATION_SERPAPI = fileURLToPath(new URL("./serpapi-simule.ts", import.meta.url));
