import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Retours du build 2 (24 novembre 2026, « quand je reviens dans ma wishlist la
// qualité est très mauvaise ») : la réponse de POST /api/wishlist porte
// l'image HD du résultat d'origine (champ imageHdUrl, déjà dans le type),
// relue comme pour la liste et la fiche (lib/pieceImages.ts). SANS base ni
// réseau : les vraies routes sur une fausse base en mémoire.

vi.mock("../src/lib/ownMatches.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/ownMatches.js")>();
  return { ...original, findOwnMatch: vi.fn() };
});

import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import wishlistRoutes from "../src/routes/wishlist.js";
import { findOwnMatch } from "../src/lib/ownMatches.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { fakeSupabase } from "./fakeSupabase.js";

const ownMatchMock = vi.mocked(findOwnMatch);
const ALICE = "a0000000-0000-4000-8000-000000000001";
const MATCH = "f0000000-0000-4000-8000-000000000007";
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:veste";
const HD = "https://boutique.example/images/veste-1600.jpg";
const SHOP = "https://boutique.example/veste";

let app: FastifyInstance | null = null;

async function wishApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: null };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(wishlistRoutes);
  await app.ready();
  return app;
}

function seeded(hd: string | null) {
  const fake = fakeSupabase();
  fake.table("profiles").push({ id: ALICE, username: "alice", locale: "fr" });
  fake.table("product_matches").push({ id: MATCH, image_url: THUMB, image_hd_url: hd, merchant_url: SHOP, merchant_name: "Boutique", created_at: "2026-11-20T10:00:00+00:00" });
  return fake;
}

const keep = (target: FastifyInstance, body: Record<string, unknown>) =>
  target.inject({ method: "POST", url: "/api/wishlist", headers: { "x-test-user": ALICE, "accept-language": "fr-FR" }, payload: { title: "Veste en laine", ...body } });

beforeEach(() => {
  resetWishAlertsProbe();
  ownMatchMock.mockReset();
  ownMatchMock.mockResolvedValue({ id: MATCH, imageUrl: THUMB, merchantUrl: SHOP, merchantName: "Boutique" });
});

afterEach(async () => {
  await app?.close();
  app = null;
});

describe("« Garder » : l'image HD dans la réponse", () => {
  it("permis : une envie venue d'un résultat qui a une image HD la reçoit tout de suite", async () => {
    const target = await wishApp(seeded(HD).db);
    const res = await keep(target, { imageUrl: THUMB, productMatchId: MATCH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageUrl: THUMB, imageHdUrl: HD, productMatchId: MATCH });
  });

  it("refusé : sans résultat d'origine (lien envoyé à la main), jamais d'image HD tirée de la requête", async () => {
    const target = await wishApp(seeded(HD).db);
    const res = await keep(target, { imageUrl: "https://images.example/veste.jpg", imageHdUrl: HD, merchantUrl: SHOP });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageHdUrl: null, productMatchId: null });
  });

  it("résultat sans image HD : null, comme avant", async () => {
    const target = await wishApp(seeded(null).db);
    const res = await keep(target, { imageUrl: THUMB, productMatchId: MATCH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageHdUrl: null });
  });

  it("lecture de l'image HD en échec : « Garder » réussit quand même, sans image HD", async () => {
    const fake = seeded(HD);
    const db = fake.db as unknown as { from: (table: string) => unknown };
    const from = db.from.bind(db);
    db.from = (table: string) => {
      if (table !== "product_matches") return from(table);
      throw new Error("base injoignable");
    };
    const target = await wishApp(db);
    const res = await keep(target, { imageUrl: THUMB, productMatchId: MATCH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageHdUrl: null, productMatchId: MATCH });
  });
});
