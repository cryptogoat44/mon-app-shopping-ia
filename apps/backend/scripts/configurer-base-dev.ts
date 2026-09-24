// Configuration UNIQUE, faite par le fondateur : enregistre dans
// apps/backend/.env (ignoré par Git) l'adresse de connexion Postgres de
// spotto-dev, utilisée ensuite par `pnpm --filter backend migrer-dev`.
//
//   pnpm --filter backend configurer-base-dev
//
// Ne demande QUE le mot de passe de la base, en saisie masquée : l'adresse
// est construite ici. Rien n'est jamais affiché ; la connexion est testée
// avant d'enregistrer ; toutes les protections contre la production de
// lib/dev-database.ts s'appliquent.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { askHidden } from "./lib/prompt.js";
import { DEV_DATABASE_ENV, DEV_PROJECT_REF, assertDevDatabaseUrl, describeDevDatabase } from "./lib/dev-database.js";

// « Session pooler » de spotto-dev (région eu-west-1). Le numéro « aws-1 »
// ne se déduit pas de la région (documentation Supabase) : vérifié le
// 2026-09-24 en tentant une connexion avec un mot de passe volontairement
// faux — seul ce serveur reconnaît le projet (« mot de passe refusé »), les
// autres répondent « projet inconnu ».
const DEV_POOLER_HOST = "aws-1-eu-west-1.pooler.supabase.com";
const DEV_POOLER_PORT = 5432;

const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

function buildDevUrl(password: string): string {
  return `postgresql://postgres.${DEV_PROJECT_REF}:${encodeURIComponent(password)}@${DEV_POOLER_HOST}:${DEV_POOLER_PORT}/postgres`;
}

async function main() {
  console.log(`Base visée : spotto-dev (${DEV_PROJECT_REF}), serveur ${DEV_POOLER_HOST}`);
  const password = await askHidden("Mot de passe de la base spotto-dev (ne s'affiche pas) : ");
  if (!password) throw new Error("Mot de passe manquant.");

  const url = buildDevUrl(password);
  const parsed = assertDevDatabaseUrl(url); // refuse tout ce qui n'est pas spotto-dev

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password authentication failed/i.test(message)) {
      throw new Error("Mot de passe refusé par la base spotto-dev. Vérifiez-le, ou réinitialisez-le dans Supabase, puis relancez.");
    }
    throw new Error(`Connexion impossible (${message}). Vérifiez votre connexion internet, puis relancez.`);
  } finally {
    await client.end().catch(() => {});
  }
  console.log(`Connexion réussie à ${describeDevDatabase(parsed)}.`);

  // Lire d'abord le fichier en entier, puis l'écrire (jamais les deux dans
  // la même instruction : l'ouverture en écriture le viderait).
  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const lines = current.split("\n").filter((line) => !line.startsWith(`${DEV_DATABASE_ENV}=`));
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  lines.push(`${DEV_DATABASE_ENV}=${url}`, "");
  const next = lines.join("\n");
  const kept = current.split("\n").filter((line) => line && !line.startsWith(`${DEV_DATABASE_ENV}=`));
  if (!kept.every((line) => next.includes(line))) {
    throw new Error("Contrôle de sécurité : le fichier .env aurait perdu une ligne. Rien n'a été écrit.");
  }
  writeFileSync(ENV_PATH, next, { mode: 0o600 });
  console.log(`${DEV_DATABASE_ENV} enregistrée dans apps/backend/.env (jamais affichée). Terminé.`);
}

main().catch((error: unknown) => {
  // Le message ne contient jamais l'adresse ni le mot de passe.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erreur : ${message.replace(/postgres(ql)?:\/\/\S+/g, "[adresse masquée]")}`);
  process.exit(1);
});
