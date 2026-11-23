// La page look (lot « page look », migration facultative 0057, décisions du
// fondateur du 23 novembre 2026). Règle d'or : la vie privée d'abord.
//
// Routes du membre (compte exigé) :
// - GET /api/looks/status : { enabled, manage } (0057, et LOOK_PAGES_ENABLED
//   pour créer). Un ancien serveur répond 404 : l'app garde « Partager ».
// - POST /api/looks { matchId } : la page d'une pièce de SA recherche,
//   terminée, boutiques arrivées, de moins de 30 jours. Même pièce encore
//   partagée : le même lien (200), sans nouvelle copie.
// - GET /api/looks : ses pages actives.
// - DELETE /api/looks/:id : arrête SA page (ligne supprimée, copie effacée).
// - POST /api/admin/looks/stop { link } : un administrateur arrête une page.
//
// Route publique (sans compte), la seule porte vers une page :
// - GET /api/looks/public/:token : lecture seule, jeton exact exigé, une
//   seule réponse (404) pour une page inconnue, arrêtée, expirée, d'un compte
//   suspendu ou supprimé, ou illisible ; jamais rien de personnel (liste
//   fixe, lib/lookPages.ts) ; aucune écriture, aucun appel payant ; une
//   limite de débit commune à tout le service (lookPublicGlobal), le serveur
//   ne voyant pas l'adresse du visiteur. Le jeton n'apparaît jamais au
//   journal (route déclarée seulement, lib/logPrivacy.ts).
//
// Aucun appel à services/serpapi.ts, visualSearch.ts, textSearch.ts,
// shoppingQueryAi.ts ni videoMoments.ts (tests/looks.test.ts).
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  LOOK_ACTIVE_MAX,
  LOOK_LIMIT_ERROR,
  LOOK_NOT_FOUND_ERROR,
  LOOK_NOT_READY_ERROR,
  LOOK_PAGES_UNAVAILABLE_ERROR,
  type CreateLookResponse,
  type LookPagesStatus,
  type SharedLooksList,
} from "@monapp/shared-types";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { deferredPending, deferredStateOf } from "../lib/deferredComplement.js";
import {
  LOOK_IMAGE_BUCKET,
  LOOK_LIFETIME_MS,
  buildLookContent,
  copyLookImage,
  isLookToken,
  isWordsPiece,
  lookPagesReady,
  lookPagesSwitchOn,
  lookReadiness,
  lookTokenFromLink,
  lookUrl,
  newLookToken,
  publicLookOf,
  removeLookImages,
  type LookNotReady,
} from "../lib/lookPages.js";
import { isSuspended } from "../lib/moderation.js";
import { PRODUCT_MATCH_NOT_FOUND, findOwnMatchRow } from "../lib/ownMatches.js";
import { parseMatchRows, parseSearchRow, toProductSearch } from "../lib/searchRows.js";
import { INVALID_ID, idParamsSchema, parseDbRows, parseInput } from "../lib/validation.js";
import { verdictColumnReady } from "../lib/verdictColumn.js";

const NOT_FOUND = { error: LOOK_NOT_FOUND_ERROR, message: "Cette page n'est plus disponible." } as const;
const READ_FAILED = { error: "look_unavailable", message: "La page n'a pas pu être chargée." } as const;
const UNAVAILABLE = { error: LOOK_PAGES_UNAVAILABLE_ERROR, message: "Les pages look ne sont pas disponibles." } as const;
const LIMIT = { error: LOOK_LIMIT_ERROR, message: "Vous avez déjà 30 pages partagées : arrêtez-en une dans Réglages → Vos données." } as const;
const INVALID_LINK = { error: "invalid_request", message: "Lien de page look invalide." } as const;

const createSchema = z.object({ matchId: z.guid() });
const stopSchema = z.object({ link: z.string().min(1).max(2048) });

const ID = z.guid();
const LOOK_ROWS = z.array(
  z.object({
    id: ID,
    token: z.string(),
    content: z.unknown(),
    image_path: z.string().nullable(),
    created_at: z.string(),
    expires_at: z.string(),
  })
);
const PUBLIC_ROW = z.object({
  user_id: ID,
  content: z.unknown(),
  image_path: z.string().nullable(),
  expires_at: z.string(),
});
const EXPIRED_ROWS = z.array(z.object({ id: ID, image_path: z.string().nullable() }));
const DELETED_ROWS = z.array(z.object({ id: ID, user_id: ID, image_path: z.string().nullable() }));

/** Le titre d'une page dans la liste du membre : le nom de la pièce copié. */
function titleOf(content: unknown): string {
  const piece = (content as { piece?: { name?: unknown } } | null)?.piece;
  return typeof piece?.name === "string" ? piece.name : "";
}

/** Efface les pages expirées du membre (lignes, puis copies), comme
 * lib/searchRetention.ts le fait pour les recherches : à chaque action du
 * membre sur ses pages (création, liste). Jamais à la lecture publique. */
async function purgeExpired(fastify: FastifyInstance, userId: string, now: Date): Promise<void> {
  const expired = parseDbRows(
    EXPIRED_ROWS,
    await fastify.supabaseAdmin.from("shared_looks").select("id, image_path").eq("user_id", userId).lt("expires_at", now.toISOString()),
    "Pages look expirées"
  );
  if (expired.length === 0) return;
  const { error } = await fastify.supabaseAdmin
    .from("shared_looks")
    .delete()
    .eq("user_id", userId)
    .in(
      "id",
      expired.map((row) => row.id)
    );
  if (error) {
    fastify.log.warn("Pages look expirées : effacement remis à plus tard");
    return;
  }
  await removeLookImages(
    fastify,
    expired.map((row) => row.image_path)
  );
}

/** Ses pages actives (non expirées), les plus récentes d'abord. */
async function activeLooks(fastify: FastifyInstance, userId: string, now: Date) {
  return parseDbRows(
    LOOK_ROWS,
    await fastify.supabaseAdmin
      .from("shared_looks")
      .select("id, token, content, image_path, created_at, expires_at")
      .eq("user_id", userId)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false }),
    "Pages look"
  );
}

export default async function looksRoutes(fastify: FastifyInstance) {
  async function ensureManageable(reply: FastifyReply): Promise<boolean> {
    if (await lookPagesReady(fastify)) return true;
    await reply.code(404).send(UNAVAILABLE);
    return false;
  }

  fastify.get("/api/looks/status", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const manage = await lookPagesReady(fastify);
    return reply.send({ enabled: manage && lookPagesSwitchOn(), manage } satisfies LookPagesStatus);
  });

  fastify.post(
    "/api/looks",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("lookCreate"), fastify.rateLimit("lookCreateGlobal")],
      config: { rateLimitName: "lookCreate" },
    },
    async (request, reply) => {
      if (!lookPagesSwitchOn() || !(await lookPagesReady(fastify))) return reply.code(503).send(UNAVAILABLE);
      const body = parseInput(createSchema, request.body, reply);
      if (!body) return;
      const userId = request.user!.id;
      const now = new Date();

      // 1. Sa proposition seulement : celle d'un autre membre répond comme une inexistante.
      const own = await findOwnMatchRow(fastify, userId, body.matchId);
      if (!own) return reply.code(404).send(PRODUCT_MATCH_NOT_FOUND);

      // 2. La recherche et TOUTES ses propositions, relues comme GET
      // /api/searches/:id : mentions, retraits, ordre et verdict sont
      // exactement ceux de l'écran.
      const { data: searchData, error: searchError } = await fastify.supabaseAdmin.from("product_searches").select("*").eq("id", own.search_id).eq("user_id", userId).maybeSingle();
      const row = searchError ? null : parseSearchRow(searchData);
      if (!row) return reply.code(404).send(PRODUCT_MATCH_NOT_FOUND);
      const { data: matchRows, error: matchesError } = await fastify.supabaseAdmin.from("product_matches").select("*").eq("search_id", row.id);
      const matches = matchesError ? null : parseMatchRows(matchRows);
      if (!matches) {
        request.log.error("Page look : propositions illisibles");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }
      const affiliateUrlByMatchId = await fetchAffiliateUrls(
        fastify,
        matches.map((match) => match.id)
      );
      const search = toProductSearch(row, matches, affiliateUrlByMatchId, new Map(), false, { verdict: await verdictColumnReady(fastify) });
      const notReady = lookReadiness(search, deferredPending(deferredStateOf(row, now.getTime())), now.getTime());
      if (notReady) return reply.code(409).send({ error: LOOK_NOT_READY_ERROR, message: "Ce résultat ne peut pas être partagé pour l'instant.", reason: notReady });
      // « Résultats pour vos mots » : jamais partagée (ses boutiques et le verdict seraient ceux d'une autre pièce).
      if (isWordsPiece(search, own.id)) return reply.code(409).send({ error: LOOK_NOT_READY_ERROR, message: "Cette pièce ne peut pas être partagée.", reason: "words_piece" satisfies LookNotReady });
      const content = buildLookContent(search, own.id);
      // Retirée depuis (boutique masquée), ou sans lien web : rien à montrer.
      if (!content) return reply.code(404).send(PRODUCT_MATCH_NOT_FOUND);

      // 3. Page encore active pour cette pièce : le même lien. Sinon, les
      // pages expirées partent d'abord, puis le plafond.
      await purgeExpired(fastify, userId, now);
      const active = await activeLooks(fastify, userId, now);
      const existing = await findExistingLook(fastify, userId, own.id);
      if (existing) {
        reply.header("Cache-Control", "no-store");
        return reply.code(200).send({ id: existing.id, url: lookUrl(existing.token), expiresAt: existing.expires_at, created: false } satisfies CreateLookResponse);
      }
      if (active.length >= LOOK_ACTIVE_MAX) return reply.code(409).send(LIMIT);

      // 4. La copie de l'image (480 px) ; échec : page sans image.
      const imagePath = await copyLookImage(fastify, request.log, { id: own.id, image_url: own.image_url });

      // 5. La page, construite par le serveur (liste fixe).
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + LOOK_LIFETIME_MS).toISOString();
      const token = newLookToken();
      const { data: inserted, error: insertError } = await fastify.supabaseAdmin
        .from("shared_looks")
        .insert({ user_id: userId, search_id: row.id, match_id: own.id, token, content, image_path: imagePath, created_at: createdAt, expires_at: expiresAt })
        .select("id")
        .single();
      if (insertError || !inserted) {
        await removeLookImages(fastify, [imagePath]);
        // Deux demandes en même temps pour la même pièce : la première a gagné.
        const raced = insertError?.code === "23505" ? await findExistingLook(fastify, userId, own.id) : null;
        if (raced) return reply.code(200).send({ id: raced.id, url: lookUrl(raced.token), expiresAt: raced.expires_at, created: false } satisfies CreateLookResponse);
        request.log.error({ code: insertError?.code ?? null }, "Page look : enregistrement impossible");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }
      const id = ID.parse((inserted as { id: unknown }).id);
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({ id, url: lookUrl(token), expiresAt, created: true } satisfies CreateLookResponse);
    }
  );

  fastify.get("/api/looks", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await ensureManageable(reply))) return;
    const userId = request.user!.id;
    const now = new Date();
    await purgeExpired(fastify, userId, now);
    const looks = await activeLooks(fastify, userId, now);
    reply.header("Cache-Control", "no-store");
    return reply.send({
      looks: looks.map((look) => ({ id: look.id, url: lookUrl(look.token), title: titleOf(look.content), createdAt: look.created_at, expiresAt: look.expires_at })),
    } satisfies SharedLooksList);
  });

  fastify.delete("/api/looks/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await ensureManageable(reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    // Seulement SA page : celle d'un autre membre répond comme une inexistante, et reste en ligne.
    const deleted = parseDbRows(
      DELETED_ROWS,
      await fastify.supabaseAdmin.from("shared_looks").delete().eq("id", params.id).eq("user_id", userId).select("id, user_id, image_path"),
      "Arrêt d'une page look"
    );
    if (deleted.length === 0) return reply.code(404).send(NOT_FOUND);
    await removeLookImages(
      fastify,
      deleted.map((row) => row.image_path)
    );
    return reply.code(204).send();
  });

  // Modération : arrêter une page signalée, à partir du lien collé. Le
  // journal ne note que l'identifiant interne, jamais le jeton.
  fastify.post("/api/admin/looks/stop", { preHandler: [fastify.requireAuth, fastify.requireAdmin] }, async (request, reply) => {
    if (!(await ensureManageable(reply))) return;
    const body = parseInput(stopSchema, request.body, reply, INVALID_LINK);
    if (!body) return;
    const token = lookTokenFromLink(body.link);
    if (!token) return reply.code(400).send(INVALID_LINK);
    const deleted = parseDbRows(
      DELETED_ROWS,
      await fastify.supabaseAdmin.from("shared_looks").delete().eq("token", token).select("id, user_id, image_path"),
      "Arrêt d'une page look (modération)"
    );
    const stopped = deleted[0];
    if (!stopped) return reply.code(404).send(NOT_FOUND);
    await removeLookImages(fastify, [stopped.image_path]);
    request.log.info({ lookId: stopped.id }, "Page look arrêtée par la modération");
    return reply.code(204).send();
  });

  // La page, pour un visiteur sans compte.
  fastify.get(
    "/api/looks/public/:token",
    { preHandler: fastify.rateLimit("lookPublicGlobal"), config: { rateLimitName: "lookPublicGlobal" } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Robots-Tag", "noindex, nofollow");
      reply.header("Referrer-Policy", "no-referrer");
      const token = (request.params as { token?: unknown }).token;
      // Jeton mal formé : refusé sans lire la base.
      if (!isLookToken(token)) return reply.code(404).send(NOT_FOUND);
      if (!(await lookPagesReady(fastify))) return reply.code(404).send(NOT_FOUND);
      const { data, error } = await fastify.supabaseAdmin.from("shared_looks").select("user_id, content, image_path, expires_at").eq("token", token).maybeSingle();
      if (error) {
        request.log.error({ code: error.code ?? null }, "Page look : lecture impossible");
        return reply.code(503).send(READ_FAILED);
      }
      const parsed = PUBLIC_ROW.safeParse(data);
      if (!parsed.success) return reply.code(404).send(NOT_FOUND);
      const stored = parsed.data;
      // Expirée dès la seconde d'expiration (la ligne part à la prochaine action du membre).
      const expiresAt = Date.parse(stored.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return reply.code(404).send(NOT_FOUND);
      try {
        // Compte suspendu : invisible aussitôt ; compte supprimé (profil parti) : invisible aussi.
        if (await isSuspended(fastify, stored.user_id)) return reply.code(404).send(NOT_FOUND);
        const { data: profile, error: profileError } = await fastify.supabaseAdmin.from("profiles").select("id").eq("id", stored.user_id).maybeSingle();
        if (profileError) throw new Error("profil illisible");
        if (profile === null) return reply.code(404).send(NOT_FOUND);
      } catch {
        request.log.error("Page look : compte illisible");
        return reply.code(503).send(READ_FAILED);
      }
      const look = publicLookOf(stored, (path) => fastify.supabaseAdmin.storage.from(LOOK_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl);
      if (!look) return reply.code(404).send(NOT_FOUND);
      return reply.send(look);
    }
  );
}

const EXISTING_ROWS = z.array(z.object({ id: ID, token: z.string(), expires_at: z.string() }));

/** Sa page encore active pour cette pièce, s'il y en a une. */
async function findExistingLook(fastify: FastifyInstance, userId: string, matchId: string) {
  const rows = parseDbRows(
    EXISTING_ROWS,
    await fastify.supabaseAdmin.from("shared_looks").select("id, token, expires_at").eq("user_id", userId).eq("match_id", matchId).gt("expires_at", new Date().toISOString()).limit(1),
    "Page look d'une pièce"
  );
  return rows[0] ?? null;
}
