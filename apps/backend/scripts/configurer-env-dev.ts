// Configuration faite par le fondateur, dans son Terminal (lot outils, 30 octobre 2026) :
// apps/backend/.env et apps/mobile/.env basculent vers spotto-dev-2.
//
//   pnpm --filter backend configurer-env-dev
//
// Reprend l'adresse et la clé secrète déjà enregistrées par configurer-banc ;
// demande seulement la clé publique (« publishable »), en saisie masquée.
// N'affiche aucune valeur ; garde une copie de chaque ancien fichier
// (.env.sauvegarde-…, ignorée par Git). Aucun appel : rien n'est vérifié en ligne.
import { fileURLToPath } from "node:url";
import { ACCES_SPOTTO_DEV_2, configurerEnvDev } from "./lib/env-dev.js";
import { askHidden } from "./lib/prompt.js";

const ENV_SERVEUR = fileURLToPath(new URL("../.env", import.meta.url));
const ENV_APP = fileURLToPath(new URL("../../mobile/.env", import.meta.url));

configurerEnvDev({
  acces: ACCES_SPOTTO_DEV_2,
  envServeur: ENV_SERVEUR,
  envApp: ENV_APP,
  demanderClePublique: () => askHidden("Clé publique (« publishable ») de spotto-dev-2 (ne s'affiche pas) : "),
  journal: (ligne) => console.log(ligne),
  horodatage: new Date().toISOString().replace(/[:.]/g, "-"),
})
  .then(() => console.log("Terminé. Pensez à vider le presse-papiers (copiez un simple mot)."))
  .catch((error: unknown) => {
    // Les messages ne contiennent jamais de valeur.
    console.error(`Erreur : ${error instanceof Error ? error.message : "inattendue"}`);
    process.exitCode = 1;
  });
