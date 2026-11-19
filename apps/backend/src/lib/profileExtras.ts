import type { FastifyInstance } from "fastify";
import { DatabaseReadError } from "./validation.js";

// Épingles et lien en bio (lot « vie sociale », migration 0049). Un membre
// épingle jusqu'à 3 de ses publications « Une photo » (posts.pinned_at) et
// affiche un lien sous sa bio (profiles.link_url).
//
// Sans la migration 0049 (sonde ci-dessous) : PUT /api/posts/:id/pin répond
// « indisponible » ; un PATCH /api/me qui porte `linkUrl` est refusé en entier
// (rien du profil n'est enregistré : l'app ne croit jamais le lien gardé) ;
// les profils n'ont pas `linkUrl`, les publications pas `pinnedAt`, la
// première page d'un profil pas `pinned` ; l'app cache le champ et l'entrée.

export const PINS_UNAVAILABLE = {
  error: "pins_unavailable",
  message: "Les publications épinglées ne sont pas encore disponibles.",
} as const;
export const PROFILE_LINK_UNAVAILABLE = {
  error: "profile_link_unavailable",
  message: "Le lien du profil n'est pas encore disponible.",
} as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0049 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** Les deux colonnes de 0049 répondent-elles ? Deux lectures sans ligne.
 * Vrai : elles sont là. Faux : la base dit qu'elles n'existent pas. Toute
 * autre réponse (base injoignable, délai dépassé…) relève DatabaseReadError :
 * on ne sait pas, et rien n'est mémorisé. */
async function probeSchema(fastify: Db): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answers = await Promise.all([
      fastify.supabaseAdmin.from("posts").select("id, pinned_at").limit(0),
      fastify.supabaseAdmin.from("profiles").select("id, link_url").limit(0),
    ]);
    const firstError = answers.find((answer) => answer.error)?.error ?? null;
    if (!firstError) return true;
    failed = firstError as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Épingles et lien en bio coupés : migration 0049 absente");
    return false;
  }
  fastify.log.warn({ code }, "Épingles et lien en bio : schéma illisible");
  throw new DatabaseReadError("Schéma des épingles et du lien en bio illisible");
}

/** La base a-t-elle la migration 0049 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * savedPostsReady). Base illisible : DatabaseReadError, rien n'est mémorisé,
 * et la sonde est refaite à la requête suivante. */
export async function profileExtrasReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
  if (schemaReadyAt !== null) return true;
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return false;
  schemaProbe ??= probeSchema(fastify)
    .then((ready) => {
      if (ready) schemaReadyAt = now();
      else schemaMissingAt = now();
      return ready;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** Comme profileExtrasReady, pour une lecture qui peut se passer de 0049 :
 * base illisible → « absente » (rien de plus n'est montré), avec un avertissement. */
export async function profileExtrasShown(fastify: Db): Promise<boolean> {
  try {
    return await profileExtrasReady(fastify);
  } catch {
    return false;
  }
}

/** Tests seulement : oublie la sonde. */
export function resetProfileExtrasProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
