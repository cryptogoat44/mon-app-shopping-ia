// Configuration UNIQUE, faite par le fondateur : enregistre dans
// apps/backend/.env (ignoré par Git) l'adresse de connexion Postgres de
// spotto-dev-2, utilisée ensuite par `pnpm --filter backend migrer-dev`.
//
//   pnpm --filter backend configurer-base-dev
//
// Demande le serveur du « Session pooler » (affiché par Supabase, sans aucun
// secret) puis le mot de passe de la base, en saisie masquée : l'adresse est
// construite ici. Rien n'est jamais affiché ; la connexion est testée avant
// d'enregistrer ; toutes les protections contre la production de
// lib/dev-database.ts s'appliquent.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ask, askHidden } from "./lib/prompt.js";
import { DEV_DATABASE_ENV, DEV_PROJECT_NAME, DEV_PROJECT_REF, POOLER_HOST, assertDevDatabaseUrl, describeDevDatabase } from "./lib/dev-database.js";

// « Session pooler » : son serveur dépend de la région du projet et son
// numéro (« aws-0 », « aws-1 »…) ne se déduit pas de la région
// (documentation Supabase). Pour spotto-dev-2, le fondateur le lit dans
// Supabase (bouton « Connect », « Session pooler ») ; sa forme est contrôlée
// (lib/dev-database.ts). L'ancien spotto-dev utilisait aws-1-eu-west-1.
const DEV_POOLER_PORT = 5432;

const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

function buildDevUrl(host: string, password: string): string {
  return `postgresql://postgres.${DEV_PROJECT_REF}:${encodeURIComponent(password)}@${host}:${DEV_POOLER_PORT}/postgres`;
}

async function main() {
  console.log(`Base visée : ${DEV_PROJECT_NAME} (${DEV_PROJECT_REF}).`);
  const host = (await ask("Serveur du « Session pooler » de spotto-dev-2 (Supabase → Connect → Session pooler, par exemple aws-0-eu-central-1.pooler.supabase.com) : ")).trim().toLowerCase();
  if (!POOLER_HOST.test(host)) throw new Error("Serveur non reconnu : il doit avoir la forme aws-0-eu-central-1.pooler.supabase.com. Rien n'est enregistré.");
  const password = await askHidden(`Mot de passe de la base ${DEV_PROJECT_NAME} (ne s'affiche pas) : `);
  if (!password) throw new Error("Mot de passe manquant.");

  const url = buildDevUrl(host, password);
  const parsed = assertDevDatabaseUrl(url); // refuse tout ce qui n'est pas spotto-dev-2

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password authentication failed/i.test(message)) {
      throw new Error(`Mot de passe refusé par la base ${DEV_PROJECT_NAME}. Vérifiez-le, ou réinitialisez-le dans Supabase, puis relancez.`);
    }
    if (/tenant or user not found/i.test(message)) {
      throw new Error("Ce serveur ne connaît pas spotto-dev-2 : vérifiez le serveur du « Session pooler » dans Supabase, puis relancez.");
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
