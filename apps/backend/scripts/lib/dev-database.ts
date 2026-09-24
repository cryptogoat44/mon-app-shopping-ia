// Garde-fou des migrations automatiques : elles ne visent QUE spotto-dev.
// Les migrations de production restent manuelles, faites par le fondateur
// (procédure dans CLAUDE.md) — ce module ne doit jamais pouvoir s'en
// approcher.

export const DEV_PROJECT_REF = "sbtwsmxfdfxzgcohbznd"; // spotto-dev
export const PROD_PROJECT_REF = "qcwnlqkxnhqpyjpkooiw"; // production — toujours refusée
export const DEV_DATABASE_ENV = "DEV_DATABASE_URL";

export class DevDatabaseGuardError extends Error {}

/** Vérifie qu'une adresse de connexion Postgres désigne bien spotto-dev.
 * Lève une erreur (sans jamais recopier l'adresse, qui contient le mot de
 * passe) dans tous les autres cas. */
export function assertDevDatabaseUrl(url: string | undefined): URL {
  if (!url) throw new DevDatabaseGuardError(`${DEV_DATABASE_ENV} est absente de apps/backend/.env.`);
  if (url.includes(PROD_PROJECT_REF)) {
    throw new DevDatabaseGuardError("Cette adresse désigne la PRODUCTION : refusé. Les migrations de production restent manuelles.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DevDatabaseGuardError("Adresse de connexion illisible.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new DevDatabaseGuardError("Ce n'est pas une adresse de connexion Postgres.");
  }
  const user = decodeURIComponent(parsed.username);
  const host = parsed.hostname.toLowerCase();
  // Deux formes officielles de Supabase : connexion directe
  // (db.<ref>.supabase.co) ou « pooler » (utilisateur postgres.<ref>).
  const isDev = host === `db.${DEV_PROJECT_REF}.supabase.co` || user === `postgres.${DEV_PROJECT_REF}`;
  if (!isDev) {
    throw new DevDatabaseGuardError(`Cette adresse ne désigne pas spotto-dev (${DEV_PROJECT_REF}) : refusé.`);
  }
  if (!parsed.password || parsed.password.includes("YOUR-PASSWORD")) {
    throw new DevDatabaseGuardError("Le mot de passe de la base manque dans l'adresse.");
  }
  return parsed;
}

/** Pour les messages : l'hôte seulement, jamais l'utilisateur ni le mot de passe. */
export function describeDevDatabase(url: URL): string {
  return `spotto-dev (${url.hostname})`;
}

/** Vérifie qu'une adresse de projet Supabase (https://<ref>.supabase.co)
 * désigne bien spotto-dev — même protection que pour la base (parcours à
 * l'écran, Lot F). */
export function assertDevSupabaseUrl(url: string | undefined, origine: string): URL {
  if (!url) throw new DevDatabaseGuardError(`Adresse Supabase absente (${origine}).`);
  if (url.includes(PROD_PROJECT_REF)) {
    throw new DevDatabaseGuardError(`${origine} désigne la PRODUCTION : refusé.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DevDatabaseGuardError(`Adresse Supabase illisible (${origine}).`);
  }
  if (parsed.hostname.toLowerCase() !== `${DEV_PROJECT_REF}.supabase.co`) {
    throw new DevDatabaseGuardError(`${origine} ne désigne pas spotto-dev (${DEV_PROJECT_REF}) : refusé.`);
  }
  return parsed;
}
