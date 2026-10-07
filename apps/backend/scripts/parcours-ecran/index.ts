// Parcours à l'écran, réutilisable d'un lot à l'autre (voir CLAUDE.md).
//
//   pnpm --filter backend parcours-ecran <scénario>        ex. : lot-f
//
// Chaque scénario vit dans scenarios/<nom>.ts et exporte `name`,
// `outputDir` (dossier de docs/ pour les captures) et `run(parcours)`.
import { runParcours, type Parcours } from "./boite-a-outils.js";

interface Scenario {
  name: string;
  outputDir: string;
  run: (parcours: Parcours) => Promise<void>;
  /** Variables de construction du site propres au scénario (liste fermée). */
  buildEnv?: Record<string, string>;
  /** IA d'Anthropic simulée dans le serveur local (aucun appel réel). */
  simulatedAi?: boolean;
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
  });
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
