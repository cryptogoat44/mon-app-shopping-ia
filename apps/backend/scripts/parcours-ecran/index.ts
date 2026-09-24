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
}

const SCENARIOS: Record<string, () => Promise<Scenario>> = {
  "lot-f": () => import("./scenarios/lot-f.js"),
};

async function main() {
  const key = process.argv[2];
  const load = key ? SCENARIOS[key] : undefined;
  if (!load) {
    throw new Error(`Indiquez un scénario : ${Object.keys(SCENARIOS).join(", ")}.`);
  }
  const scenario = await load();
  await runParcours(scenario.name, scenario.outputDir, scenario.run);
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
