import type { FastifyInstance } from "fastify";
import { DatabaseReadError } from "./validation.js";

// Plusieurs photos par publication, et identifier des personnes (lot « vie
// sociale », migration 0047). La photo 1 reste dans la publication
// (posts.media_url) ; les photos 2 à 5 sont dans post_media, les membres
// identifiés dans post_people_tags.
//
// Sans la migration 0047 (sonde ci-dessous), une publication garde une seule
// photo comme avant : les routes des photos et des identifications répondent
// « indisponible », une publication demandée AVEC des identifications est
// refusée avant toute écriture (jamais publiée sans elles en silence), et
// les publications n'ont ni `media` ni `people`.

export const POST_EXTRAS_UNAVAILABLE = {
  error: "post_extras_unavailable",
  message: "Les photos multiples et les identifications ne sont pas encore disponibles.",
} as const;

/** Sonde refaite au plus toutes les 5 minutes tant que 0047 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

type Db = Pick<FastifyInstance, "supabaseAdmin" | "log">;

/** Réponses de la base qui veulent dire « la colonne ou la table n'existe
 * pas » (Postgres : 42703, 42P01 ; PostgREST : PGRST204, PGRST205). */
const ABSENT_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** Les deux tables de 0047 répondent-elles ? Deux lectures sans ligne.
 * Vrai : elles sont là. Faux : la base dit qu'elles n'existent pas. Toute
 * autre réponse (base injoignable, délai dépassé…) relève DatabaseReadError :
 * on ne sait pas, et « absentes par défaut » laisserait partir une
 * publication sans les identifications demandées, ou une suppression sans
 * effacer les photos 2 à 5. */
async function probeSchema(fastify: Db): Promise<boolean> {
  let failed: { code?: string } | null;
  try {
    const answers = await Promise.all([
      fastify.supabaseAdmin.from("post_media").select("post_id, position").limit(0),
      fastify.supabaseAdmin.from("post_people_tags").select("post_id, author_id").limit(0),
    ]);
    const firstError = answers.find((answer) => answer.error)?.error ?? null;
    if (!firstError) return true;
    failed = firstError as { code?: string };
  } catch {
    failed = null;
  }
  const code = failed?.code ?? null;
  if (code !== null && ABSENT_CODES.has(code)) {
    fastify.log.warn({ code }, "Photos multiples et identifications coupées : migration 0047 absente");
    return false;
  }
  fastify.log.warn({ code }, "Photos multiples et identifications : schéma illisible");
  throw new DatabaseReadError("Schéma des photos et des identifications illisible");
}

/** La base a-t-elle la migration 0047 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes (comme
 * commentThreadsReady). Base illisible : DatabaseReadError, rien n'est
 * mémorisé, et la sonde est refaite à la requête suivante. */
export async function postExtrasReady(fastify: Db, now: () => number = Date.now): Promise<boolean> {
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

/** Tests seulement : oublie la sonde. */
export function resetPostExtrasProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}
