// Constantes de la simulation d'Anthropic (lot 4, temps 1 bis), partagées par
// le module chargé dans le serveur local (anthropic-simule.ts) et par les
// outils de vérification à l'écran. Sans effet de bord : l'importer ne
// remplace rien.
import { fileURLToPath } from "node:url";

/** Clé factice donnée au serveur local : jamais une vraie clé dans un parcours. */
export const CLE_SIMULATION = "cle-factice-simulation-anthropic";
/** Ligne écrite par le serveur local quand la simulation est en place :
 * l'outil l'attend avant tout parcours, sinon il s'arrête. */
export const MARQUE_SIMULATION = "[simulation Anthropic] active — aucun appel réel";
/** Module à charger dans le serveur local (« tsx --import »). */
export const FICHIER_SIMULATION = fileURLToPath(new URL("./anthropic-simule.ts", import.meta.url));
