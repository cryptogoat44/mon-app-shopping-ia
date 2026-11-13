// Alertes prix et stock (lot 2, migration 0036 ; nouvelle version, 0041) :
// les réglages « Alertes prix et stock » et « Aider les autres membres », la
// cloche de chaque envie (et son seuil) et « Plus disponible ».
// - GET /api/alerts/status : toujours 200 ; sans 0041, tout est faux et
//   l'app cache la cloche, les réglages et « Plus disponible » ;
// - les autres routes répondent 404 « alerts_unavailable » sans 0041.
// La cloche et les réglages sont des réglages personnels : permis à un
// compte suspendu, comme les autres. « Plus disponible » n'en est pas un : il
// peut changer les envies des AUTRES membres (rupture établie à 3) — refusé
// à un compte suspendu (403), comme commenter ou suivre.
// Journal : des codes, jamais un compte, un titre, une adresse ni une envie.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { MAX_TARGET_PRICE, WISH_ALERT_ERRORS, type UpdateWishAlertResponse, type WishAlertStatesList } from "@monapp/shared-types";
import { trackingKeyOf } from "../lib/alertKeys.js";
import { searchLocaleFor } from "../lib/locale.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { findOwnMatch, PRODUCT_MATCH_NOT_FOUND } from "../lib/ownMatches.js";
import { INVALID_ID, idParamsSchema, parseInput } from "../lib/validation.js";
import {
  ensureTracking,
  readWishAlertState,
  readWishAlertStates,
  reportSoldOut,
  saveWatch,
  saveWishAlertSettings,
  setWishAlertsEnabled,
  wishAlertsReady,
  wishAlertsStatus,
  wishBought,
  WishTargetUnknownCurrencyError,
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

const settingsSchema = z
  .object({ enabled: z.boolean().optional(), helpOthers: z.boolean().optional() })
  .strict()
  .refine((body) => body.enabled !== undefined || body.helpOthers !== undefined);
const watchSchema = z.object({
  priceDrop: z.boolean(),
  restock: z.boolean(),
  soldOut: z.boolean().optional(),
  enableAlerts: z.boolean().optional(),
  // « Prévenez-moi si le prix passe sous… » (dans la devise du pays du membre).
  targetPrice: z.number().finite().min(0.01).max(MAX_TARGET_PRICE).nullable().optional(),
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

  // Les réglages des Réglages : « Alertes prix et stock » (coupé par
  // défaut) et « Aider les autres membres » (allumé par défaut).
  fastify.put("/api/alerts/settings", write, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    const body = parseInput(settingsSchema, request.body, reply, INVALID_BODY);
    if (!body) return;
    try {
      await saveWishAlertSettings(fastify, request.user!.id, body);
      return reply.send(await wishAlertsStatus(fastify, request.user!.id));
    } catch (error) {
      request.log.error({ error }, "Alertes prix : réglages non enregistrés");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // La cloche de chacune de vos envies suivies.
  fastify.get("/api/alerts/wishes", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    try {
      return reply.send({ items: await readWishAlertStates(fastify, request.user!.id, searchLocaleFor(request).country) } satisfies WishAlertStatesList);
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
      const state = await readWishAlertState(fastify, request.log, request.user!.id, params.id, searchLocaleFor(request).country);
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
  // `targetPrice` : le seuil de la baisse de prix (absent : pré-rempli avec
  // le dernier prix vu, ou inchangé) ; impossible sans pays connu (422). Un
  // suivi sans pays prend celui de la recherche en cours (pris en charge),
  // gardé sur le suivi au même moment.
  fastify.put("/api/wishlist/:id/alerts", write, async (request, reply) => {
    if (!(await ensureReady(reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(watchSchema, request.body, reply, INVALID_BODY);
    if (!body) return;
    const userId = request.user!.id;
    const choice = { priceDrop: body.priceDrop, restock: body.restock, soldOut: body.soldOut ?? false, targetPrice: body.targetPrice };
    const anyOn = choice.priceDrop || choice.restock || choice.soldOut;
    try {
      const tracking = await ensureTracking(fastify, request.log, userId, params.id);
      if (!tracking) return reply.code(404).send(WISH_NOT_FOUND);
      if (anyOn && !tracking.match_key_hash) return reply.code(422).send(NOT_TRACKABLE);
      if (anyOn && (await wishBought(fastify, userId, params.id))) return reply.code(422).send(WISH_BOUGHT);
      await saveWatch(fastify, userId, params.id, choice, tracking, searchLocaleFor(request).country);
      if (anyOn && body.enableAlerts) await setWishAlertsEnabled(fastify, userId, true);
      const [state, status] = await Promise.all([readWishAlertState(fastify, request.log, userId, params.id, searchLocaleFor(request).country), wishAlertsStatus(fastify, userId)]);
      if (!state) return reply.code(404).send(WISH_NOT_FOUND);
      return reply.send({ state, status } satisfies UpdateWishAlertResponse);
    } catch (error) {
      if (error instanceof WishTargetUnknownCurrencyError) return reply.code(422).send(INVALID_BODY);
      request.log.error({ error }, "Alertes prix : cloche non enregistrée");
      return reply.code(500).send(SERVER_ERROR);
    }
  });

  // « Plus disponible » : sur un résultat d'une de vos recherches, ou sur une
  // de vos envies. Vos envies de la même pièce passent « épuisée » ; celles
  // des autres membres une fois la pièce signalée par 3 membres différents
  // d'affilée depuis le même pays (et seulement si vous aidez les autres
  // membres). Le signalement garde son auteur et le pays de sa recherche,
  // jamais lié à une alerte ; le journal ne dit ni la pièce, ni les envies
  // touchées. 20 par jour (heure de Paris) au plus. La limite en
  // mémoire ne compte qu'un signalement possible (pièce trouvée, avec une
  // clé) : une demande refusée (404, 422) n'use jamais la part du jour.
  // Toute demande, refusée ou non, compte en revanche dans la limite par
  // défaut (300 par minute), comme sur les autres routes (revue de sécurité
  // du 12 novembre 2026 : avant, les demandes refusées n'étaient comptées
  // nulle part).
  // Refusé à un compte suspendu : il peut changer les envies des autres membres.
  fastify.post(
    "/api/alerts/stock-reports",
    {
      preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("default"), fastify.rateLimitCheck("stockReport")],
      config: { rateLimitName: "stockReport" as const },
    },
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
        if ((await reportSoldOut(fastify, userId, key, searchLocaleFor(request).country)) === "limited") return reply.code(429).send(REPORT_LIMIT);
        request.log.info({ outcome: "reported" }, "Alertes prix : « Plus disponible » signalé");
        return reply.code(204).send();
      } catch (error) {
        request.log.error({ error }, "Alertes prix : « Plus disponible » non enregistré");
        return reply.code(500).send(SERVER_ERROR);
      }
    }
  );
}
