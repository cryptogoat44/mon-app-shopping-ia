// Applique une migration SQL sur spotto-dev UNIQUEMENT (décision du
// fondateur, 2026-09-24). Les migrations de production restent manuelles.
//
//   pnpm --filter backend migrer-dev supabase/migrations/0016_….sql [--verifier fichier.sql]
//
// L'adresse de connexion (DEV_DATABASE_URL, dans apps/backend/.env) est
// vérifiée avant toute connexion : le script refuse de s'exécuter si elle ne
// désigne pas spotto-dev (voir lib/dev-database.ts). La migration s'exécute
// en une seule transaction : tout ou rien. Rien de secret n'est affiché.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DEV_DATABASE_ENV, assertDevDatabaseUrl, describeDevDatabase } from "./lib/dev-database.js";

function argAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const url = process.env[DEV_DATABASE_ENV];
  const parsed = assertDevDatabaseUrl(url); // refuse tout ce qui n'est pas spotto-dev

  const migrationPath = process.argv.slice(2).find((arg, index, all) => !arg.startsWith("--") && all[index - 1] !== "--verifier");
  const verificationPath = argAfter("--verifier");
  if (!migrationPath && !verificationPath) {
    throw new Error("Indiquez un fichier de migration (et, si besoin, --verifier <fichier.sql>).");
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  await client.connect();
  console.log(`Base visée : ${describeDevDatabase(parsed)}`);
  try {
    if (migrationPath) {
      const sql = readFileSync(resolve(migrationPath), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
      console.log(`Migration appliquée : ${migrationPath}`);
    }
    if (verificationPath) {
      const result = await client.query(readFileSync(resolve(verificationPath), "utf8"));
      console.log(`Vérification (${verificationPath}) :`);
      console.table(result.rows);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erreur : ${message.replace(/postgres(ql)?:\/\/\S+/g, "[adresse masquée]")}`);
  process.exit(1);
});
