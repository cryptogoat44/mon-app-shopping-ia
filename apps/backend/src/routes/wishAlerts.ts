// Alertes prix et stock (lot 2, migration 0036) : l'interrupteur des
// Réglages, la cloche de chaque envie et « Plus disponible ».
// - GET /api/alerts/status : toujours 200 ; sans 0036, tout est faux et
//   l'app cache la cloche, l'interrupteur et « Plus disponible » ;
// - les autres routes répondent 404 « alerts_unavailable » sans 0036.
// La cloche et l'interrupteur sont des réglages personnels : permis à un
// compte suspendu, comme les autres. « Plus disponible » n'en est pas un : il
// change les envies des AUTRES membres (épuisées, et leurs alertes en
// attente périmées) — refusé à un compte suspendu (403), comme commenter ou suivre.
// Journal : des codes, jamais un compte, un titre ni une adresse.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { WISH_ALERT_ERRORS, type UpdateWishAlertResponse, type WishAlertStatesList } from "@monapp/shared-types";
import { trackingKeyOf } from "../lib/alertKeys.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { findOwnMatch, PRODUCT_MATCH_NOT_FOUND } from "../lib/ownMatches.js";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import {
  ensureTracking,
  readWishAlertState,
  readWishAlertStates,
  reportSoldOut,
  saveWatch,
  setWishAlertsEnabled,
  wishAlertsReady,
  wishAlertsStatus,
  wishBought,
} from "../lib/wishAlerts.js";

const SERVER_ERROR = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;
export const ALERTS_UNAVAILABLE = { error: WISH_ALERT_ERRORS.unavailable, message: "Page introuvable." } as const;
const NOT_TRACKABLE = { error: WISH_ALERT_ERRORS.notTrackable, message: "Requête invalide." } as const;
const WISH_NOT_FOUND = { error: "wishlist_item_not_found", message: "Envie introuvable." } as const;
const WISH_BOUGHT = {
  error: WISH_ALERT_ERRORS.bought,
  message: "Cette pièce est dans votre Vault : aucune alerte ne partira pour elle.",
} as const;
const REPORT_LIMIT = {
  error: WISH_ALERT_ERRORS.reportLimit,
  message: "Vous avez signalé beaucoup de pièces aujourd'hui. Réessayez demain.",
} as const;
const INVALID_BODY = { error: "invalid_body", message: "Requête invalide." } as const;

const settingsSchema = z.object({ enabled: z.boolean() });
const watchSchema = z.object({
  priceDrop: z.boolean(),
  restock: z.boolean(),
  soldOut: z.boolean().optional(),
  enableAlerts: z.boolean().optional(),
});
const stockReportSchema = z.union([
  z.object({ productMatchId: z.guid() }).strict(),
  z.object({ wishlistItemId: z.guid() }).strict(),
]);

export default async function wishAlertsRoutes(fastify: FastifyInstance) {
  const write = { preHandler: [fastify.requireAuth, fastify.rateLimit("wishAlertWrite")], config: { rateLimitName: "wishAlertWrite" as const } };

  /** Sans 0036 : 404, et l'app cache tout. */
  async function ensureReady(reply: FastifyReply): Promise<boolean> {
    if (await wishAlertsReady(fastify)) return true;
    void reply.code(404).send(ALERTS_UNAVAILABLE);
    return false;
  }

  // Les alertes sont-elles disponibles, l'interrupteur allumé, les notifications possibles ?
  fastify.get("/api/alerts/status", { preHandler: fastify.requireAuth }, async (request, reply) => {
    try {
      return reply.send(await wishAlertsStatus(fastify, request.user!.id));
    } catch (error) {
      request.log.error({ error }, "Alertes prix : état illisible");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // L'interrupteur « Alertes prix et stock » des Réglages.
  fastify.put("/api/alerts/settings", write, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    const body = parseInput(settingsSchema, request.body, reply, INVALID_BODY);
    if (!body) return;
    try {
      await setWishAlertsEnabled(fastify, request.user!.id, body.enabled);
      return reply.send(await wishAlertsStatus(fastify, request.user!.id));
    } catch (error) {
      request.log.error({ error }, "Alertes prix : interrupteur non enregistré");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // La cloche de chacune de vos envies suivies.
  fastify.get("/api/alerts/wishes", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    try {
      return reply.send({ items: await readWishAlertStates(fastify, request.user!.id) } satisfies WishAlertStatesList);
    } catch (error) {
      request.log.error({ error }, "Alertes prix : cloches illisibles");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // La cloche d'une de vos envies (son suivi est créé s'il manque).
  fastify.get("/api/wishlist/:id/alerts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    try {
      const state = await readWishAlertState(fastify, request.log, request.user!.id, params.id);
      if (!state) return reply.code(404).send(WISH_NOT_FOUND);
      return reply.send(state);
    } catch (error) {
      request.log.error({ error }, "Alertes prix : cloche illisible");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // Régler la cloche d'une de vos envies. Une pièce sans clé n'a pas de
  // cloche (422), une pièce déjà dans votre Vault non plus (422 : aucune
  // alerte ne partirait). `enableAlerts` : la première cloche allume aussi
  // l'interrupteur général (après la feuille d'explication de l'app).
  fastify.put("/api/wishlist/:id/alerts", write, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(watchSchema, request.body, reply, INVALID_BODY);
    if (!body) return;
    const userId = request.user!.id;
    const choice = { priceDrop: body.priceDrop, restock: body.restock, soldOut: body.soldOut ?? false };
    const anyOn = choice.priceDrop || choice.restock || choice.soldOut;
    try {
      const tracking = await ensureTracking(fastify, request.log, userId, params.id);
      if (!tracking) return reply.code(404).send(WISH_NOT_FOUND);
      if (anyOn && !tracking.match_key_hash) return reply.code(422).send(NOT_TRACKABLE);
      if (anyOn && (await wishBought(fastify, userId, params.id))) return reply.code(422).send(WISH_BOUGHT);
      await saveWatch(fastify, userId, params.id, choice);
      if (anyOn && body.enableAlerts) await setWishAlertsEnabled(fastify, userId, true);
      const [state, status] = await Promise.all([readWishAlertState(fastify, request.log, userId, params.id), wishAlertsStatus(fastify, userId)]);
      if (!state) return reply.code(404).send(WISH_NOT_FOUND);
      return reply.send({ state, status } satisfies UpdateWishAlertResponse);
    } catch (error) {
      request.log.error({ error }, "Alertes prix : cloche non enregistrée");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // « Plus disponible » : sur un résultat d'une de vos recherches, ou sur une
  // de vos envies. Toutes les envies de la même pièce passent « épuisée »,
  // sans aucune alerte. 20 par jour (heure de Paris) au plus. La limite en
  // mémoire ne compte qu'un signalement possible (pièce trouvée, avec une
  // clé) : une demande refusée (404, 422) n'use jamais la part du jour.
  // Refusé à un compte suspendu : il change les envies des autres membres.
  fastify.post(
    "/api/alerts/stock-reports",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimitCheck("stockReport")], config: { rateLimitName: "stockReport" as const } },
    async (request, reply) => {
      if (!(await ensureReady(reply))) return;
      const body = parseInput(stockReportSchema, request.body, reply, INVALID_BODY);
      if (!body) return;
      const userId = request.user!.id;
      try {
        let key: { hash: string; merchant: string | null } | null;
        if ("productMatchId" in body) {
          const match = await findOwnMatch(fastify, userId, body.productMatchId);
          if (!match) return reply.code(404).send(PRODUCT_MATCH_NOT_FOUND);
          key = trackingKeyOf(match.merchantUrl, match.merchantName);
        } else {
          const tracking = await ensureTracking(fastify, request.log, userId, body.wishlistItemId);
          if (!tracking) return reply.code(404).send(WISH_NOT_FOUND);
          key = tracking.match_key_hash ? { hash: tracking.match_key_hash, merchant: tracking.merchant_key } : null;
        }
        if (!key) return reply.code(422).send(NOT_TRACKABLE);
        fastify.countRateLimitHit(request, "stockReport");
        if ((await reportSoldOut(fastify, userId, key)) === "limited") return reply.code(429).send(REPORT_LIMIT);
        request.log.info({ outcome: "reported" }, "Alertes prix : « Plus disponible » signalé");
        return reply.code(204).send();
      } catch (error) {
        request.log.error({ error }, "Alertes prix : « Plus disponible » non enregistré");
        return reply.code(500).send(SERVER_ERROR);
      }
    }
  );
}
