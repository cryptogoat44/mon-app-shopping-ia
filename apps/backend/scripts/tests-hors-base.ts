// Tests serveur SANS base ni clé (lot « filets de sécurité », point 23 de la
// feuille de route V1) : la vérification « Tests serveur hors base » de
// GitHub, et la même chose sur un ordinateur.
//
//   pnpm --filter backend test:hors-base
//
// Lance tous les fichiers tests/*.test.ts qui n'importent pas tests/helpers
// (ceux qui l'importent créent des comptes dans spotto-dev-2 : ils ne
// tournent que sur le Mac du fondateur, et dans « Tests serveur
// (spotto-dev-2) » une fois ses deux secrets ajoutés).
// Les réglages de la base et des fournisseurs sont FORCÉS à des valeurs
// factices, quel que soit apps/backend/.env : un test qui tenterait de joindre
// une base échouerait aussitôt (adresse locale fermée), sans jamais toucher
// spotto-dev-2 ni la production. SerpApi et Anthropic restent refusés par
// tests/setup/noPaidCalls.ts. Rien de secret n'est lu ni affiché.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Un fichier de tests qui importe tests/helpers a besoin de la base. */
function needsDatabase(source: string): boolean {
  return /from\s+["']\.\/helpers(?:\.js)?["']/.test(source);
}

const FAKE_SETTINGS = {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_ROLE_KEY: "faux-cle-service",
  SUPABASE_ANON_KEY: "faux-cle-anon",
  SERPAPI_KEY: "faux-serpapi",
  NODE_ENV: "test",
} as const;

function main(): number {
  const dir = "tests";
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(dir, name));
  const offline = files.filter((file) => !needsDatabase(readFileSync(file, "utf8")));
  console.log(`Tests serveur hors base : ${offline.length} fichiers sur ${files.length} (les ${files.length - offline.length} autres ont besoin de la base).`);
  if (offline.length === 0) {
    console.error("Aucun fichier trouvé : lancer depuis apps/backend.");
    return 1;
  }
  const result = spawnSync("pnpm", ["exec", "vitest", "run", ...offline], {
    stdio: "inherit",
    env: { ...process.env, ...FAKE_SETTINGS },
  });
  return result.status ?? 1;
}

process.exitCode = main();
