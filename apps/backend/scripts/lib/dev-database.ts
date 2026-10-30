// Garde-fou des outils de développement : ils ne visent QUE spotto-dev-2
// (sedfepcpmhilaxbrgdif), depuis le lot outils du 30 octobre 2026. L'ancien
// spotto-dev, devenu inaccessible, est refusé comme la production. Les
// migrations de production restent manuelles, faites par le fondateur
// (procédure dans CLAUDE.md) — ce module ne doit jamais pouvoir s'en
// approcher.

export const DEV_PROJECT_REF = "sedfepcpmhilaxbrgdif"; // spotto-dev-2
export const DEV_PROJECT_NAME = "spotto-dev-2";
export const PROD_PROJECT_REF = "selhqdqfrflsqivgxypf"; // spotto-prod, production depuis le 28 octobre — toujours refusée
export const DEV_DATABASE_ENV = "DEV_DATABASE_URL";
/** Forme du serveur « Session pooler » de Supabase (ex. aws-0-eu-central-1.pooler.supabase.com). */
export const POOLER_HOST = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/;

/** Projets toujours refusés, avec ce que dit le refus. */
export const REFUSED_PROJECTS: Readonly<Record<string, string>> = {
  [PROD_PROJECT_REF]: "la PRODUCTION (spotto-prod)",
  qcwnlqkxnhqpyjpkooiw: "l'ancienne PRODUCTION",
  sbtwsmxfdfxzgcohbznd: "l'ancien spotto-dev, inaccessible (ne jamais l'utiliser)",
};

export class DevDatabaseGuardError extends Error {}

/** Le projet refusé que l'adresse cite, n'importe où (utilisateur, hôte, mot de passe…), ou null. */
function refusedProject(url: string): string | null {
  return Object.entries(REFUSED_PROJECTS).find(([ref]) => url.includes(ref))?.[1] ?? null;
}

/** Vérifie qu'une adresse de connexion Postgres désigne bien spotto-dev-2.
 * Lève une erreur (sans jamais recopier l'adresse, qui contient le mot de
 * passe) dans tous les autres cas. */
export function assertDevDatabaseUrl(url: string | undefined): URL {
  if (!url) throw new DevDatabaseGuardError(`${DEV_DATABASE_ENV} est absente de apps/backend/.env.`);
  const refused = refusedProject(url);
  if (refused) {
    throw new DevDatabaseGuardError(`Cette adresse désigne ${refused} : refusé. Les migrations de production restent manuelles.`);
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
    throw new DevDatabaseGuardError(`Cette adresse ne désigne pas ${DEV_PROJECT_NAME} (${DEV_PROJECT_REF}) : refusé.`);
  }
  if (!parsed.password || parsed.password.includes("YOUR-PASSWORD")) {
    throw new DevDatabaseGuardError("Le mot de passe de la base manque dans l'adresse.");
  }
  return parsed;
}

/** Pour les messages : l'hôte seulement, jamais l'utilisateur ni le mot de passe. */
export function describeDevDatabase(url: URL): string {
  return `${DEV_PROJECT_NAME} (${url.hostname})`;
}

/** Vérifie qu'une adresse de projet Supabase (https://<ref>.supabase.co)
 * désigne bien spotto-dev-2 — même protection que pour la base (parcours à
 * l'écran, Lot F). */
export function assertDevSupabaseUrl(url: string | undefined, origine: string): URL {
  if (!url) throw new DevDatabaseGuardError(`Adresse Supabase absente (${origine}).`);
  const refused = refusedProject(url);
  if (refused) {
    throw new DevDatabaseGuardError(`${origine} désigne ${refused} : refusé.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DevDatabaseGuardError(`Adresse Supabase illisible (${origine}).`);
  }
  if (parsed.hostname.toLowerCase() !== `${DEV_PROJECT_REF}.supabase.co`) {
    throw new DevDatabaseGuardError(`${origine} ne désigne pas ${DEV_PROJECT_NAME} (${DEV_PROJECT_REF}) : refusé.`);
  }
  return parsed;
}
