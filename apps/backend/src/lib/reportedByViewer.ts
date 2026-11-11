// Ce que la personne a signalé disparaît aussitôt de CE qu'elle voit
// (chantier 3, point 6 de la feuille de route V1 ; règle 1.2 d'Apple) : une
// publication signalée sort de son fil et des profils qu'elle consulte, un
// commentaire signalé de la liste des commentaires, une pièce reçue signalée
// de ses pièces reçues, un message de sa conversation (lot messages), une
// collection d'un ami de son profil (lot modération des collections) —
// quelle que soit la suite
// donnée au signalement. Les autres personnes continuent de les voir tant
// qu'un administrateur (ou le masquage automatique, lib/autoHide.ts) ne les a
// pas masqués. Aucune migration : la table `reports` existe depuis 0011.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";

/** Les plus récents seulement : la liste part dans l'adresse de la requête
 * (filtre « not in »), qui doit rester courte. */
export const REPORTED_IDS_LIMIT = 100;

const ROWS = z.array(z.object({ target_id: z.guid() }));

/** Identifiants des contenus de ce type signalés par `viewerId`, les plus
 * récents d'abord. Lecture impossible : liste vide (le fil s'affiche quand
 * même), erreur journalisée. */
export async function reportedIdsFor(
  fastify: Pick<FastifyInstance, "supabaseAdmin">,
  log: Pick<FastifyBaseLogger, "error">,
  viewerId: string,
  targetType: "post" | "comment" | "piece" | "message" | "collection"
): Promise<string[]> {
  const { data, error } = await fastify.supabaseAdmin
    .from("reports")
    .select("target_id")
    .eq("reporter_id", viewerId)
    .eq("target_type", targetType)
    .order("created_at", { ascending: false })
    .limit(REPORTED_IDS_LIMIT);
  const rows = ROWS.safeParse(data);
  if (error || !rows.success) {
    log.error({ code: error?.code ?? null }, "Contenus signalés illisibles : rien n'est retiré");
    return [];
  }
  return [...new Set(rows.data.map((row) => row.target_id))];
}

/** Filtre PostgREST « id not in (…) », ou null s'il n'y a rien à retirer. */
export function notInFilter(ids: readonly string[]): string | null {
  return ids.length > 0 ? `(${ids.join(",")})` : null;
}
