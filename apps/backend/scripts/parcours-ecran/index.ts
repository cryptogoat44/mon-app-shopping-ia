// Parcours à l'écran, réutilisable d'un lot à l'autre (voir CLAUDE.md).
//
//   pnpm --filter backend parcours-ecran <scénario>        ex. : lot-f
//
// Chaque scénario vit dans scenarios/<nom>.ts et exporte `name`,
// `outputDir` (dossier de docs/ pour les captures) et `run(parcours)`.
//
// Après une mise en ligne (point 23 de la feuille de route V1) : cet outil ne
// vise JAMAIS la production, et doit le rester (il refuse tout autre projet
// que spotto-dev-2, crée puis supprime des comptes, lance un serveur local
// avec une clé SerpApi invalide). Le trajet complet inscription → recherche →
// Vault → suppression est vérifié par tests/parcoursComplet.test.ts, contre
// spotto-dev-2, avec tous les tests, sur la version exacte à mettre en ligne
// (pnpm --filter backend test:ci). Une fois en ligne, refaites ce trajet UNE
// fois à la main sur le site de production, avec un compte jetable (une
// adresse à vous) :
//   1. créer le compte, accepter les documents, choisir un pseudo ;
//   2. Spotter : importer une photo et lancer la recherche (une vraie
//      recherche SerpApi, comptée dans le plafond du jour) : des propositions
//      s'affichent ;
//   3. « Je l'ai achetée » sur une proposition : la pièce est dans le Vault ;
//   4. Réglages → « Supprimer mon compte », taper SUPPRIMER ; se reconnecter
//      avec ce compte doit ensuite échouer.
// Si une étape coince : revenir en arrière (MISE-EN-LIGNE.md).
import { runParcours, type Parcours } from "./boite-a-outils.js";

interface Scenario {
  name: string;
  outputDir: string;
  run: (parcours: Parcours) => Promise<void>;
  /** Variables de construction du site propres au scénario (liste fermée). */
  buildEnv?: Record<string, string>;
  /** IA d'Anthropic simulée dans le serveur local (aucun appel réel). */
  simulatedAi?: boolean;
  /** Hôtes de statistiques envoyés VOLONTAIREMENT (sentry-site seulement) ;
   * tout autre envoi vers PostHog ou Sentry fait échouer le parcours. */
  statistiquesAutorisees?: readonly string[];
}

const SCENARIOS: Record<string, () => Promise<Scenario>> = {
  "lot-f": () => import("./scenarios/lot-f.js"),
  images: () => import("./scenarios/images.js"),
  "bloc-5": () => import("./scenarios/bloc-5.js"),
  francfort: () => import("./scenarios/francfort.js"),
  "lot-2": () => import("./scenarios/lot-2.js"),
  "sentry-site": () => import("./scenarios/sentry-site.js"),
  "lot-3": () => import("./scenarios/lot-3.js"),
  "lot-3bis": () => import("./scenarios/lot-3bis.js"),
  "lot-4-ter": () => import("./scenarios/lot-4-ter.js"),
  "lot-4-quater": () => import("./scenarios/lot-4-quater.js"),
  "lot-5": () => import("./scenarios/lot-5.js"),
  "lot-5-partage": () => import("./scenarios/lot-5-partage.js"),
  "lot-5-suppression": () => import("./scenarios/lot-5-suppression.js"),
  "fiabilite-signalement": () => import("./scenarios/fiabilite-signalement.js"),
  "lot-5-retrait-image": () => import("./scenarios/lot-5-retrait-image.js"),
  "demarrage-site": () => import("./scenarios/demarrage-site.js"),
  "petit-lot": () => import("./scenarios/petit-lot.js"),
  "petit-lot-2": () => import("./scenarios/petit-lot-2.js"),
};

async function main() {
  const key = process.argv[2];
  const load = key ? SCENARIOS[key] : undefined;
  if (!load) {
    throw new Error(`Indiquez un scénario : ${Object.keys(SCENARIOS).join(", ")}.`);
  }
  const scenario = await load();
  await runParcours(scenario.name, scenario.outputDir, scenario.run, process.argv.slice(3), scenario.buildEnv ?? {}, {
    simulatedAi: scenario.simulatedAi ?? false,
    statistiquesAutorisees: scenario.statistiquesAutorisees ?? [],
  });
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
