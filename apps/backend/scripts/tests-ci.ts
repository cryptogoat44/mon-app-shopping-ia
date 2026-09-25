// Tests serveur pour les vérifications automatiques GitHub (Lot Q, bloc 4).
//
//   pnpm --filter backend test:ci
//
// 1. Refuse de démarrer si SUPABASE_URL ne désigne pas spotto-dev (même
//    garde-fou que migrer-dev et parcours-ecran) : jamais la production.
// 2. Lance toute la suite une fois.
// 3. Les tests parlent au vrai spotto-dev : un fichier échoue parfois dès sa
//    préparation (« fetch failed », voir points-de-vigilance.md). Les
//    fichiers en échec sont relancés UNE seule fois, et c'est dit clairement
//    dans le journal ; un second échec fait échouer la vérification.
// Rien de secret n'est affiché (ni clé, ni adresse complète).
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";

interface VitestJson {
  testResults: { name: string; status: string }[];
}

function runVitest(files: string[], jsonPath: string): number {
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${jsonPath}`, ...files],
    { stdio: "inherit" }
  );
  return result.status ?? 1;
}

function failedFiles(jsonPath: string): string[] | null {
  if (!existsSync(jsonPath)) return null;
  const report = JSON.parse(readFileSync(jsonPath, "utf8")) as VitestJson;
  return report.testResults.filter((file) => file.status !== "passed").map((file) => relative(process.cwd(), file.name));
}

function main(): number {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL");
  console.log(`Tests serveur contre spotto-dev (${url.hostname}).`);

  const dir = mkdtempSync(join(tmpdir(), "spotto-tests-"));
  const first = runVitest([], join(dir, "premier.json"));
  if (first === 0) return 0;

  const failed = failedFiles(join(dir, "premier.json"));
  if (!failed || failed.length === 0) {
    console.error("Échec des tests sans fichier identifiable (erreur de démarrage) : pas de relance.");
    return first;
  }
  console.log(`\nRelance unique de ${failed.length} fichier(s) en échec (échec réseau passager possible) :`);
  for (const file of failed) console.log(`  - ${file}`);
  const second = runVitest(failed, join(dir, "relance.json"));
  console.log(second === 0 ? "\nRelance réussie : échec passager au premier passage." : "\nÉchec confirmé à la relance.");
  return second;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
}
