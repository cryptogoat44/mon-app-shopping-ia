// Constantes de la coupure simulée vers Supabase Auth (lot 4 ter), partagées
// par le module chargé dans le serveur local (panne-auth-simulee.ts) et par
// l'outil parcours-iphone. Sans effet de bord : l'importer ne remplace rien.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Ligne écrite par le serveur local quand le module est en place. */
export const MARQUE_PANNE_AUTH = "[panne simulée] module actif — coupures seulement sur signal de l'outil";
/** Module à charger dans le serveur local (« tsx --import »). */
export const FICHIER_PANNE_AUTH = fileURLToPath(new URL("./panne-auth-simulee.ts", import.meta.url));
/** Fichier-signal : sa présence déclenche une coupure (consommée aussitôt). */
export const FICHIER_SIGNAL_PANNE = join(tmpdir(), "spotto-parcours-iphone-panne-auth");
