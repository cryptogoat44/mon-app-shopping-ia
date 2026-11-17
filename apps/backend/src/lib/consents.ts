import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCEPTED_CONSENT_VERSIONS, type VersionedConsentType } from "@monapp/shared-types";

const latestConsentSchema = z.object({
  granted_at: z.string().nullable(),
  document_version: z.string().nullable(),
});

export class ConsentLookupError extends Error {}

/** Vrai si le DERNIER choix enregistré pour ce consentement est un accord,
 * donné sur un texte encore valable (`accepted`, par défaut
 * ACCEPTED_CONSENT_VERSIONS ; plus étroit pour un usage que seuls les textes
 * récents couvrent, ex. VIDEO_LINK_CONSENT_VERSIONS). Un refus ou un retrait
 * postérieur l'emporte toujours. Relève ConsentLookupError si la base ne
 * répond pas : la route échoue proprement, sans rien envoyer. */
export async function hasCurrentConsent(
  fastify: FastifyInstance,
  userId: string,
  type: VersionedConsentType,
  accepted: readonly string[] = ACCEPTED_CONSENT_VERSIONS[type]
): Promise<boolean> {
  const { data, error } = await fastify.supabaseAdmin
    .from("consents")
    .select("granted_at, document_version")
    .eq("user_id", userId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ConsentLookupError("Lecture du consentement impossible");
  const latest = latestConsentSchema.nullable().parse(data);
  if (latest === null || latest.granted_at === null || latest.document_version === null) return false;
  return accepted.includes(latest.document_version);
}
