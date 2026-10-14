import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACCEPTED_CONSENT_VERSIONS,
  CONSENT_TYPES,
  CONSENT_VERSIONS,
  OPTIONAL_CONSENTS,
  isAccountDeletionWord,
  type ConsentStatus,
  type ConsentType,
  type VersionedConsentType,
} from "@monapp/shared-types";
import { env } from "../env.js";
import { collectExport } from "../lib/exportData.js";
import { localDay, resolveTimeZone } from "../lib/exportFormat.js";
import { exportContentSecurityPolicy, renderExportHtml } from "../lib/exportHtml.js";
import { collectLookups } from "../lib/exportLookups.js";
import { requestLocale } from "../lib/locale.js";
import { isAdmin } from "../lib/moderation.js";
import { deleteUserStorageFiles, removeOwnedFiles, storageLeftovers } from "../lib/storage.js";
import { parseDbRows, parseInput } from "../lib/validation.js";
import { WISH_COPY_BUCKET } from "../lib/wishShare.js";

/** Corps de DELETE /api/me : le mot tapé par la personne (revérifié ici). */
const deleteAccountSchema = z.object({ confirmation: z.string().max(40).refine((value) => isAccountDeletionWord(value)) });
const DELETION_NOT_CONFIRMED = { error: "deletion_not_confirmed", message: "Pour confirmer la suppression, tapez le mot demandé." } as const;
/** Un administrateur retire d'abord son rôle (dans la base) : sans lui, plus
 * personne ne traiterait les signalements. */
const ADMIN_ACCOUNT_DELETION = {
  error: "admin_account",
  message: "Ce compte est administrateur et ne peut pas être supprimé tant qu'il a ce rôle. Retirez d'abord le rôle d'administrateur, puis recommencez.",
} as const;
const RECEIVED_PIECE_ROWS = z.array(
  z.object({ sender_id: z.string().uuid(), image_url: z.string().nullable(), image_thumb_url: z.string().nullable() })
);

const recordConsentsSchema = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(CONSENT_TYPES),
        version: z.string().trim().min(1).max(40).optional(),
        granted: z.boolean().optional(),
      })
    )
    .min(1)
    .max(CONSENT_TYPES.length),
});

function isVersioned(type: ConsentType): type is VersionedConsentType {
  return type in CONSENT_VERSIONS;
}

// Export : format choisi par la personne à chaque export. « json » (par
// défaut, comme les anciennes versions de l'app) : les lignes brutes ;
// « html » : le fichier lisible, qui contient aussi le JSON complet.
const exportQuerySchema = z.object({ format: z.enum(["json", "html"]).default("json") });

const EXPORT_FILE_BASE = { fr: "spotto-mes-donnees", en: "spotto-my-data" } as const;

/** Origine de notre stockage (seules images affichées dans le fichier). */
function storageOrigin(): string | null {
  try {
    return new URL(env.SUPABASE_URL).origin;
  } catch {
    return null;
  }
}

export default async function accountRoutes(fastify: FastifyInstance) {
  // Statut de consentement courant (le dernier événement par type) — sert à
  // afficher "CGU acceptées le ..." dans l'écran Compte.
  fastify.get("/api/consents", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("consents")
      .select("type, granted_at, revoked_at, document_version")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture des consentements");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // On ne garde que l'événement le plus récent par type (déjà trié par
    // created_at décroissant ci-dessus).
    type Row = { type: ConsentType; granted_at: string | null; revoked_at: string | null; document_version: string | null };
    const latestByType = new Map<ConsentType, Row>();
    for (const row of (data as Row[]) ?? []) {
      if (!latestByType.has(row.type)) latestByType.set(row.type, row);
    }

    // Dernier événement par type : un accord (granted_at) ou, pour un
    // consentement facultatif, un refus / retrait (revoked_at).
    const statuses: ConsentStatus[] = CONSENT_TYPES.map((type) => {
      const latest = latestByType.get(type);
      const grantedAt = latest?.granted_at ?? null;
      const decidedAt = grantedAt ?? latest?.revoked_at ?? null;
      const version = latest?.document_version ?? null;
      const isCurrent = grantedAt !== null && (!isVersioned(type) || (version !== null && ACCEPTED_CONSENT_VERSIONS[type].includes(version)));
      return { type, grantedAt, decidedAt, version, isCurrent };
    });

    return reply.send(statuses);
  });

  // Enregistre un événement de consentement par type demandé. On insère
  // toujours une nouvelle ligne (jamais de mise à jour) : le consentement
  // est un historique d'événements, pas un simple statut qu'on écrase — en
  // cas de contrôle, on doit pouvoir montrer quand il a été donné.
  fastify.post("/api/consents", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const parsed = recordConsentsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Requête invalide." });
    }

    // Un texte (document juridique, déclaration d'âge) n'est accepté que
    // dans sa version en vigueur : l'historique doit montrer précisément
    // quel texte a été accepté.
    const outdated = parsed.data.consents.find(
      (consent) => isVersioned(consent.type) && consent.version !== CONSENT_VERSIONS[consent.type]
    );
    if (outdated) {
      return reply.code(409).send({
        error: "outdated_document",
        message: "Ce document a été mis à jour. Relisez-le, puis acceptez-le à nouveau.",
      });
    }

    // Refuser ou retirer n'a de sens que pour un consentement facultatif :
    // les documents obligatoires ne se « retirent » pas (on supprime son
    // compte pour cela).
    if (parsed.data.consents.some((consent) => consent.granted === false && !OPTIONAL_CONSENTS.includes(consent.type))) {
      return reply.code(400).send({ error: "invalid_body", message: "Seul un consentement facultatif peut être refusé ou retiré." });
    }

    const userId = request.user!.id;
    const now = new Date().toISOString();

    const { error } = await fastify.supabaseAdmin.from("consents").insert(
      parsed.data.consents.map((consent) => {
        const granted = consent.granted !== false;
        return {
          user_id: userId,
          type: consent.type,
          granted_at: granted ? now : null,
          revoked_at: granted ? null : now,
          document_version: isVersioned(consent.type) ? CONSENT_VERSIONS[consent.type] : null,
        };
      })
    );

    if (error) {
      request.log.error({ error }, "Échec d'enregistrement du consentement");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.code(204).send();
  });

  // Export RGPD (droit d'accès et de portabilité) : TOUTES les données
  // personnelles de l'utilisateur (lecture : lib/exportData.ts, règle 10 du
  // programme ; le test tests/exportCompleteness.test.ts vérifie chaque
  // section). Si une seule lecture échoue, l'export entier échoue : un export
  // partiel présenté comme complet serait pire qu'une erreur (audit Lot Q,
  // SEC-01). Jamais requireActiveAccount : un compte suspendu peut toujours
  // exporter ses données.
  fastify.get(
    "/api/me/export",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("dataExport")], config: { rateLimitName: "dataExport" } },
    async (request, reply) => {
      const query = parseInput(exportQuerySchema, request.query, reply);
      if (!query) return;
      const userId = request.user!.id;

      const { data, failures } = await collectExport(fastify, userId, request.user!.email);
      if (failures.length > 0) {
        request.log.error({ failures }, "Export RGPD incomplet — échec de lecture");
        return reply.code(500).send({ error: "export_failed", message: "L'export a échoué, réessayez." });
      }

      // Fichier lisible : dans la langue de l'app (Accept-Language), dates dans
      // le fuseau de l'appareil (en-tête X-Time-Zone, jamais dans l'adresse :
      // elle finirait dans les journaux de Render).
      let page: string | null = null;
      const locale = requestLocale(request);
      const timeZone = resolveTimeZone(request.headers["x-time-zone"], locale);
      if (query.format === "html") {
        try {
          const lookups = await collectLookups(fastify, userId, data);
          page = renderExportHtml(data, lookups, {
            locale,
            timeZone,
            storageOrigin: storageOrigin(),
            // Nom de la section et de la colonne seulement, jamais sa valeur.
            onUnknownColumn: (section, column) => request.log.warn({ section, column }, "Export lisible : colonne inconnue, affichée sous son nom brut"),
          });
        } catch (error) {
          request.log.error({ errorName: error instanceof Error ? error.name : "inconnue" }, "Export RGPD lisible impossible");
          return reply.code(500).send({ error: "export_failed", message: "L'export a échoué, réessayez." });
        }
      }

      const { error: requestLogError } = await fastify.supabaseAdmin.from("data_export_requests").insert({
        user_id: userId,
        status: "ready",
        completed_at: new Date().toISOString(),
      });
      if (requestLogError) {
        request.log.error({ requestLogError }, "Échec d'enregistrement de la demande d'export");
      }
      // Le format va seulement dans le journal (aucune colonne pour lui en base).
      request.log.info({ format: query.format }, "Export RGPD envoyé");

      reply.header("Cache-Control", "no-store");
      if (page === null) return reply.send(data);

      // Téléchargé, jamais affiché sur l'adresse de l'API : pièce jointe,
      // type imposé, et une politique de sécurité « sandbox » au cas où.
      const fileName = `${EXPORT_FILE_BASE[locale]}-${localDay(new Date(), timeZone)}.html`;
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", `sandbox; ${exportContentSecurityPolicy(storageOrigin())}`)
        .send(page);
    }
  );

  // Suppression réelle de compte : supprime l'utilisateur Supabase Auth (les
  // clés étrangères "on delete cascade" du schéma nettoient déjà profils,
  // vault, posts, recherches, abonnements, consentements...), puis vide les
  // fichiers de stockage associés pour ne laisser aucune trace orpheline.
  // Garde-fous (lot 5, décisions du fondateur du 2026-10-15) : le mot de
  // confirmation tapé, revérifié ici, et jamais un compte administrateur.
  fastify.delete("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    if (!parseInput(deleteAccountSchema, request.body, reply, DELETION_NOT_CONFIRMED)) return reply;
    if (await isAdmin(fastify, userId)) return reply.code(409).send(ADMIN_ACCOUNT_DELETION);

    // Lot 5 : les pièces reçues disparaissent avec le compte (cascade en
    // base) ; la copie de leur image est rangée chez la personne qui les a
    // envoyées, on la supprime ici. Ses propres copies (pièces envoyées,
    // publications « envie ») sont dans son dossier, vidé juste après.
    let received: z.infer<typeof RECEIVED_PIECE_ROWS>;
    try {
      received = parseDbRows(
        RECEIVED_PIECE_ROWS,
        await fastify.supabaseAdmin.from("piece_sends").select("sender_id, image_url, image_thumb_url").eq("recipient_id", userId),
        "Pièces reçues avant la suppression du compte"
      );
    } catch {
      request.log.error("Lecture des pièces reçues impossible avant suppression du compte");
      return reply.code(500).send({ error: "internal_error", message: "La suppression a échoué." });
    }
    const receivedCopies = await removeOwnedFiles(
      fastify,
      WISH_COPY_BUCKET,
      received.flatMap((piece) => [piece.image_url, piece.image_thumb_url].flatMap((url) => (url ? [{ ownerId: piece.sender_id, url }] : [])))
    );

    // Le droit à l'effacement ne dépend pas d'un incident de stockage
    // (décision du fondateur, 2026-10-15) : un fichier qui refuse de
    // s'effacer est compté et signalé au journal — des nombres, jamais un
    // identifiant —, puis le compte est supprimé quand même.
    const leftovers = storageLeftovers([receivedCopies, ...(await deleteUserStorageFiles(fastify, userId))]);
    if (leftovers.length > 0) request.log.warn({ leftovers }, "Suppression de compte : fichiers restés dans le stockage, à nettoyer");

    const { error } = await fastify.supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      request.log.error({ error }, "Échec de suppression du compte");
      return reply.code(500).send({ error: "internal_error", message: "La suppression a échoué." });
    }

    return reply.code(204).send();
  });
}
