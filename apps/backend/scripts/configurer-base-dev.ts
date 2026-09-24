// Configuration UNIQUE, faite par le fondateur : enregistre dans
// apps/backend/.env (ignoré par Git) l'adresse de connexion Postgres de
// spotto-dev, utilisée ensuite par `pnpm --filter backend migrer-dev`.
//
//   pnpm --filter backend configurer-base-dev
//
// Demande l'adresse affichée par Supabase (qui contient « [YOUR-PASSWORD] »,
// pas secrète) puis le mot de passe de la base, en saisie masquée. Rien
// n'est jamais affiché ; seule une adresse de spotto-dev est acceptée ; la
// connexion est testée avant d'enregistrer.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ask, askHidden } from "./lib/prompt.js";
import { DEV_DATABASE_ENV, assertDevDatabaseUrl, describeDevDatabase } from "./lib/dev-database.js";

const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

async function main() {
  const template = (await ask("Adresse de connexion copiée depuis Supabase (avec [YOUR-PASSWORD]) : ")).trim();
  if (!template.includes("[YOUR-PASSWORD]")) {
    throw new Error("L'adresse doit contenir [YOUR-PASSWORD] : copiez-la telle qu'affichée par Supabase, sans la modifier.");
  }
  const password = await askHidden("Mot de passe de la base spotto-dev (ne s'affiche pas) : ");
  if (!password) throw new Error("Mot de passe manquant.");

  const url = template.replace("[YOUR-PASSWORD]", encodeURIComponent(password));
  const parsed = assertDevDatabaseUrl(url);

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  await client.connect();
  await client.query("select 1");
  await client.end();
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
