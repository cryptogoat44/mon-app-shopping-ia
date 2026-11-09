import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLECTION_ITEMS_MAX,
  COLLECTIONS_MAX,
  type CollectionSummary,
  type KeepSharedItemResponse,
  type SendMessageResponse,
  type SharedCollectionPage,
  type SharedCollectionsList,
  type WishlistPage,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import collectionsRoutes from "../src/routes/collections.js";
import conversationsRoutes from "../src/routes/conversations.js";
import wishlistRoutes from "../src/routes/wishlist.js";
import accountRoutes from "../src/routes/account.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { collectionsReady, normalizeCollectionName, resetCollectionsProbe } from "../src/lib/collections.js";
import { resetMessagesProbe } from "../src/lib/messaging.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Collections d'envies (lot collections, migration 0033), SANS base ni
// réseau : les routes sur une fausse base en mémoire (tests/fakeSupabase.ts).
// Le même parcours sur la vraie base de développement : collectionsBase.test.ts
// (à lancer sur le Mac, une fois 0033 appliquée sur spotto-dev-2).

// Images des marchands : jamais téléchargées pour de vrai.
const downloads = vi.hoisted(() => ({ images: new Map<string, Buffer>(), calls: [] as string[] }));
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return {
    ...original,
    downloadPublicImage: async (url: string) => {
      downloads.calls.push(url);
      const image = downloads.images.get(url);
      if (!image) throw new original.PublicImageError("Image refusée", 403);
      return image;
    },
  };
});

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const DAN = "d0000000-0000-4000-8000-000000000004";
const WISH = "e0000000-0000-4000-8000-000000000005";
const WISH_2 = "e0000000-0000-4000-8000-000000000006";
const MATCH = "f0000000-0000-4000-8000-000000000007";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:vignette";
const HD = "https://boutique.example/images/sac-hd.jpg";
const THUMB_2 = "https://encrypted-tbn0.gstatic.com/images?q=tbn:montre";
const OWN_FOLDER = (user: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${user}/`;
const SECRET_NAME = "Cadeaux secrets pour Léa";

function profile(id: string, username: string): Row {
  return { id, username, display_name: username[0]!.toUpperCase() + username.slice(1), avatar_url: null, messages_from: "everyone", piece_sends_from: "following" };
}

interface Seed {
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
}

const friends = (a: string, b: string): [string, string][] => [
  [a, b],
  [b, a],
];

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(profile(ALICE, "alice"), profile(BOB, "bob"), profile(CHLOE, "chloe"), profile(DAN, "dan"));
  for (const [follower, followee] of seed.follows ?? []) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  // Deux envies d'Alice : un sac venu d'un résultat (lien affilié), une montre.
  fake.table("product_matches").push({ id: MATCH, image_url: THUMB, image_hd_url: HD });
  fake.table("affiliate_links").push({ product_match_id: MATCH, affiliate_url: "https://partenaire.example/sac?aff=spotto" });
  fake.table("wishlist_items").push(
    {
      id: WISH,
      user_id: ALICE,
      title: "Sac cabas en cuir",
      image_url: THUMB,
      reference: "Note privée : taille M",
      price_min: "129.00",
      currency: "EUR",
      merchant_name: "Boutique",
      merchant_url: "https://boutique.example/sac",
      product_match_id: MATCH,
      created_at: "2026-11-01T00:00:00+00:00",
    },
    {
      id: WISH_2,
      user_id: ALICE,
      title: "Montre dorée",
      image_url: THUMB_2,
      reference: null,
      price_min: null,
      currency: null,
      merchant_name: null,
      merchant_url: "javascript:alert(1)",
      product_match_id: null,
      created_at: "2026-11-02T00:00:00+00:00",
    }
  );
  return fake;
}

let app: FastifyInstance | null = null;

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête,
 * et le journal du serveur avec ses vraies règles (lib/logPrivacy.ts). */
async function collectionsApp(db: unknown, logLines?: string[]): Promise<FastifyInstance> {
  app = Fastify({
    logger: logLines
      ? {
          level: "info",
          stream: { write: (line: string) => void logLines.push(line) },
          serializers: { req: requestLogFields },
          formatters: { log: withoutErrorDetails },
          hooks: { streamWrite: scrubLogLine },
        }
      : false,
  });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(collectionsRoutes);
  await app.register(conversationsRoutes);
  await app.register(wishlistRoutes);
  await app.register(accountRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    patch: (url: string, payload: object) => target.inject({ method: "PATCH", url, headers, payload }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
    del: (url: string, payload?: object) => target.inject({ method: "DELETE", url, headers, ...(payload ? { payload } : {}) }),
  };
}

async function create(target: FastifyInstance, user: string, name: string): Promise<CollectionSummary> {
  const res = await as(target, user).post("/api/collections", { name });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function place(target: FastifyInstance, user: string, wishId: string, collectionIds: string[]) {
  const res = await as(target, user).put(`/api/wishlist/${wishId}/collections`, { collectionIds });
  expect(res.statusCode).toBe(200);
  return res.json().collectionIds as string[];
}

async function share(target: FastifyInstance, user: string, id: string, visibility: "friends" | "private" = "friends") {
  const res = await as(target, user).patch(`/api/collections/${id}`, { visibility });
  expect(res.statusCode).toBe(200);
  return res.json() as CollectionSummary;
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#806040" } }).jpeg().toBuffer();
}

async function withImages() {
  downloads.images.set(THUMB, await jpeg(180, 240));
  downloads.images.set(HD, await jpeg(600, 800));
  downloads.images.set(THUMB_2, await jpeg(300, 300));
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetCollectionsProbe();
  resetMessagesProbe();
  downloads.images.clear();
  downloads.calls.length = 0;
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

describe("sans la migration 0033", () => {
  const missing = { missing: ["collections", "collection_items", "collection_image_copies"] };

  it("les collections se disent indisponibles ; chaque route répond « indisponible », rien n'est écrit", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) }, missing);
    const target = await collectionsApp(fake.db);
    expect((await as(target, ALICE).get("/api/collections/status")).json()).toEqual({ enabled: false, reportable: false });
    const alice = as(target, ALICE);
    for (const res of [
      await alice.get("/api/collections"),
      await alice.post("/api/collections", { name: "Été" }),
      await alice.patch(`/api/collections/${UNKNOWN}`, { name: "Hiver" }),
      await alice.del(`/api/collections/${UNKNOWN}`),
      await alice.get(`/api/collections/${UNKNOWN}/wishlist`),
      await alice.get(`/api/collections/${UNKNOWN}/shared`),
      await alice.get(`/api/users/${BOB}/collections`),
      await alice.get(`/api/wishlist/${WISH}/collections`),
      await alice.put(`/api/wishlist/${WISH}/collections`, { collectionIds: [] }),
      await alice.get(`/api/collection-items/${UNKNOWN}`),
      await alice.post(`/api/collection-items/${UNKNOWN}/keep`),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("collections_unavailable");
    }
    expect(fake.table("wishlist_items")).toHaveLength(2);
  });

  it("l'export, la suppression d'une envie, celle du compte et « En parler » fonctionnent quand même", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) }, missing);
    const target = await collectionsApp(fake.db);
    const exported = await as(target, ALICE).get("/api/me/export");
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({ collections: [], collectionItems: [] });
    expect((await as(target, ALICE).del(`/api/wishlist/${WISH_2}`)).statusCode).toBe(204);
    // Une envie de collection sans les collections : « introuvable », rien ne part.
    const talk = await as(target, BOB).post("/api/messages", { recipientId: ALICE, collectionItemId: UNKNOWN });
    expect(talk.statusCode).toBe(404);
    expect(fake.table("messages")).toHaveLength(0);
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });

  it("sonde du schéma : absente, un seul avertissement puis 5 minutes sans relire la base ; présente, mémorisée", async () => {
    let calls = 0;
    const warnings: unknown[] = [];
    const db = (error: object | null) => ({
      from: () => ({
        select: () => ({
          limit: async () => {
            calls += 1;
            return { error };
          },
        }),
      }),
    });
    const log = { warn: (fields: unknown) => void warnings.push(fields) };
    const absent = { supabaseAdmin: db({ code: "42P01" }), log } as unknown as FastifyInstance;
    let now = 0;
    const clock = () => now;
    expect(await collectionsReady(absent, clock)).toBe(false);
    const perProbe = calls;
    expect(warnings).toEqual([{ code: "42P01" }]);
    now = 4 * 60_000;
    expect(await collectionsReady(absent, clock)).toBe(false);
    expect(calls).toBe(perProbe);
    now = 6 * 60_000;
    expect(await collectionsReady(absent, clock)).toBe(false);
    expect(calls).toBe(perProbe * 2);
    resetCollectionsProbe();
    expect(await collectionsReady({ supabaseAdmin: db(null), log } as unknown as FastifyInstance, clock)).toBe(true);
    expect(await collectionsReady(absent, clock)).toBe(true);
  });
});

describe("créer, renommer, supprimer", () => {
  it("une nouvelle collection est privée ; liste dans l'ordre de création, avec le nombre d'envies", async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    expect((await as(target, ALICE).get("/api/collections/status")).json()).toEqual({ enabled: true, reportable: true });
    const summer = await create(target, ALICE, "  Été   2027 ");
    expect(summer).toMatchObject({ name: "Été 2027", visibility: "private", itemCount: 0, hidden: false });
    const gifts = await create(target, ALICE, "Cadeaux");
    await place(target, ALICE, WISH, [summer.id, gifts.id]);
    await place(target, ALICE, WISH_2, [gifts.id]);
    const list = (await as(target, ALICE).get("/api/collections")).json().collections as CollectionSummary[];
    expect(list.map((c) => [c.name, c.itemCount, c.visibility])).toEqual([
      ["Été 2027", 1, "private"],
      ["Cadeaux", 2, "private"],
    ]);
    // Les collections de Bob ne sont pas celles d'Alice.
    expect((await as(target, BOB).get("/api/collections")).json().collections).toEqual([]);
  });

  it("renommer ; une collection d'un autre : 404, rien n'est changé", async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    const summer = await create(target, ALICE, "Été");
    const renamed = await as(target, ALICE).patch(`/api/collections/${summer.id}`, { name: "Vacances" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "Vacances", visibility: "private" });
    const stolen = await as(target, BOB).patch(`/api/collections/${summer.id}`, { name: "À moi" });
    expect(stolen.statusCode).toBe(404);
    expect(stolen.json().error).toBe("collection_not_found");
    expect((await as(target, BOB).del(`/api/collections/${summer.id}`)).statusCode).toBe(404);
    expect(fake.table("collections")[0]!.name).toBe("Vacances");
    expect((await as(target, ALICE).patch(`/api/collections/${summer.id}`, {})).statusCode).toBe(400);
  });

  it("nom : vide, trop long, mot interdit — 400, rien n'est écrit ; 40 caractères (emoji compris) acceptés", async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    const empty = await as(target, ALICE).post("/api/collections", { name: "   " });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().message).toBe("Donnez un nom à la collection.");
    const long = await as(target, ALICE).post("/api/collections", { name: "a".repeat(41) });
    expect(long.statusCode).toBe(400);
    expect(long.json().message).toBe("Le nom est trop long (40 caractères maximum).");
    const banned = await as(target, ALICE).post("/api/collections", { name: "Pour ce connard" });
    expect(banned.statusCode).toBe(400);
    expect(banned.json().error).toBe("content_not_allowed");
    expect(fake.table("collections")).toHaveLength(0);
    const ok = await create(target, ALICE, "👜".repeat(40));
    const renameBanned = await as(target, ALICE).patch(`/api/collections/${ok.id}`, { name: "Sale pute" });
    expect(renameBanned.statusCode).toBe(400);
    expect(renameBanned.json().error).toBe("content_not_allowed");
    expect(fake.table("collections")[0]!.name).toBe("👜".repeat(40));
    expect(normalizeCollectionName(" Été\n\t2027  ")).toBe("Été 2027");
  });

  it(`au plus ${COLLECTIONS_MAX} collections`, async () => {
    const fake = seeded();
    for (let i = 0; i < COLLECTIONS_MAX; i += 1) fake.table("collections").push({ id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, user_id: ALICE, name: `C${i}`, visibility: "private", visibility_changed_at: null, created_at: `2026-11-01T00:00:${String(i).padStart(2, "0")}+00:00`, updated_at: "2026-11-01T00:00:00+00:00" });
    const target = await collectionsApp(fake.db);
    const refused = await as(target, ALICE).post("/api/collections", { name: "Une de trop" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("collection_limit");
    expect(fake.table("collections")).toHaveLength(COLLECTIONS_MAX);
    // Bob, lui, peut en créer.
    await create(target, BOB, "Première");
  });

  it("supprimer une collection ne supprime jamais ses envies", async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    const gifts = await create(target, ALICE, "Cadeaux");
    await place(target, ALICE, WISH, [gifts.id]);
    expect((await as(target, ALICE).del(`/api/collections/${gifts.id}`)).statusCode).toBe(204);
    expect(fake.table("collections")).toHaveLength(0);
    expect(fake.table("collection_items")).toHaveLength(0);
    expect(fake.table("wishlist_items").map((row) => row.id)).toEqual([WISH, WISH_2]);
    expect((await as(target, ALICE).get(`/api/wishlist/${WISH}/collections`)).json()).toEqual({ collectionIds: [] });
  });
});

describe("ranger une envie dans des collections", () => {
  it("plusieurs collections à la fois, retirée des autres ; puce « collection » de l'écran Envies", async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    const a = await create(target, ALICE, "A");
    const b = await create(target, ALICE, "B");
    expect(await place(target, ALICE, WISH, [a.id, b.id, a.id])).toEqual([a.id, b.id]);
    await place(target, ALICE, WISH_2, [a.id]);
    expect(await place(target, ALICE, WISH, [b.id])).toEqual([b.id]);
    expect((await as(target, ALICE).get(`/api/wishlist/${WISH}/collections`)).json()).toEqual({ collectionIds: [b.id] });
    const page: WishlistPage = (await as(target, ALICE).get(`/api/collections/${a.id}/wishlist`)).json();
    expect(page.items.map((item) => item.id)).toEqual([WISH_2]);
    // Sa propre puce montre ses envies comme d'habitude (image du marchand comprise : elles sont à elle).
    const bPage: WishlistPage = (await as(target, ALICE).get(`/api/collections/${b.id}/wishlist`)).json();
    expect(bPage.items[0]).toMatchObject({ id: WISH, imageUrl: THUMB, imageHdUrl: HD, affiliateUrl: "https://partenaire.example/sac?aff=spotto" });
    expect((await as(target, BOB).get(`/api/collections/${a.id}/wishlist`)).statusCode).toBe(404);
  });

  it("l'envie d'un autre, ou la collection d'un autre : 404, rien n'est rangé", async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    const mine = await create(target, ALICE, "A");
    const bobs = await create(target, BOB, "B");
    expect((await as(target, BOB).put(`/api/wishlist/${WISH}/collections`, { collectionIds: [bobs.id] })).statusCode).toBe(404);
    const foreign = await as(target, ALICE).put(`/api/wishlist/${WISH}/collections`, { collectionIds: [mine.id, bobs.id] });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error).toBe("collection_not_found");
    expect(fake.table("collection_items")).toHaveLength(0);
    expect((await as(target, ALICE).put(`/api/wishlist/${WISH}/collections`, { collectionIds: ["pas-un-id"] })).statusCode).toBe(400);
  });

  it(`au plus ${COLLECTION_ITEMS_MAX} envies par collection`, async () => {
    const fake = seeded();
    const target = await collectionsApp(fake.db);
    const full = await create(target, ALICE, "Pleine");
    for (let i = 0; i < COLLECTION_ITEMS_MAX; i += 1) {
      const id = `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      fake.table("wishlist_items").push({ id, user_id: ALICE, title: `Envie ${i}`, image_url: THUMB, reference: null, price_min: null, currency: null, merchant_name: null, merchant_url: null, product_match_id: null, created_at: "2026-11-01T00:00:00+00:00" });
      fake.table("collection_items").push({ id: `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`, collection_id: full.id, wishlist_item_id: id, user_id: ALICE, created_at: `2026-11-03T00:00:00.${String(i).padStart(6, "0")}+00:00` });
    }
    const refused = await as(target, ALICE).put(`/api/wishlist/${WISH}/collections`, { collectionIds: [full.id] });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("collection_full");
    expect(fake.table("collection_items")).toHaveLength(COLLECTION_ITEMS_MAX);
    // Pages de 24 : chaque envie une fois, les plus récemment ajoutées d'abord.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/collections/${full.id}/wishlist${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page: WishlistPage = (await as(target, ALICE).get(url)).json();
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(COLLECTION_ITEMS_MAX);
    expect(new Set(seen).size).toBe(COLLECTION_ITEMS_MAX);
    expect(seen[0]).toBe(`20000000-0000-4000-8000-${String(COLLECTION_ITEMS_MAX - 1).padStart(12, "0")}`);
  });
});

describe("visibilité : privée par défaut, « Mes amis » entre amis seulement", () => {
  async function aliceShares(fake: ReturnType<typeof seeded>, target: FastifyInstance) {
    await withImages();
    const gifts = await create(target, ALICE, "Cadeaux");
    await place(target, ALICE, WISH, [gifts.id]);
    return gifts;
  }

  it("privée : même un ami ne voit rien, avec la même réponse qu'une collection inexistante", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await collectionsApp(fake.db);
    const gifts = await aliceShares(fake, target);
    expect((await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json()).toEqual({ collections: [] });
    const hidden = await as(target, BOB).get(`/api/collections/${gifts.id}/shared`);
    const missing = await as(target, BOB).get(`/api/collections/${UNKNOWN}/shared`);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).toBe(missing.body);
    // Aucune copie tant que personne d'autre ne peut la voir.
    expect(fake.uploads).toEqual([]);
    expect(downloads.calls).toEqual([]);
  });

  it("« Mes amis » : un ami (chacun suit l'autre) voit la collection ; les autres, une liste vide et le même 404", async () => {
    const fake = seeded({ follows: [...friends(ALICE, BOB), [CHLOE, ALICE], [ALICE, DAN]] });
    const target = await collectionsApp(fake.db);
    const gifts = await aliceShares(fake, target);
    expect(await share(target, ALICE, gifts.id)).toMatchObject({ visibility: "friends", itemCount: 1 });

    const list: SharedCollectionsList = (await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json();
    expect(list.collections).toEqual([{ id: gifts.id, name: "Cadeaux", itemCount: 1, coverUrl: expect.stringContaining(OWN_FOLDER(ALICE)) }]);
    const page: SharedCollectionPage = (await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).json();
    expect(page.collection).toMatchObject({ id: gifts.id, name: "Cadeaux", itemCount: 1, owner: { id: ALICE, username: "alice" } });
    expect(page.items).toHaveLength(1);

    // Chloé suit Alice sans retour, Alice suit Dan sans retour : ni l'une ni l'autre ne sont amies.
    const unknownBody = (await as(target, CHLOE).get(`/api/collections/${UNKNOWN}/shared`)).body;
    for (const stranger of [CHLOE, DAN]) {
      expect((await as(target, stranger).get(`/api/users/${ALICE}/collections`)).json()).toEqual({ collections: [] });
      const res = await as(target, stranger).get(`/api/collections/${gifts.id}/shared`);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(unknownBody);
      const item = await as(target, stranger).get(`/api/collection-items/${page.items[0]!.id}`);
      expect(item.statusCode).toBe(404);
      expect(item.body).toBe(unknownBody);
    }
    expect(JSON.parse(unknownBody)).toEqual({ error: "collection_not_found", message: "Collection introuvable." });

    // Revenue privée : plus rien pour Bob.
    await share(target, ALICE, gifts.id, "private");
    expect((await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    expect((await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json()).toEqual({ collections: [] });
  });

  it("blocage dans un sens ou dans l'autre : rien n'est visible", async () => {
    for (const block of [[ALICE, BOB] as [string, string], [BOB, ALICE] as [string, string]]) {
      const fake = seeded({ follows: friends(ALICE, BOB) });
      const target = await collectionsApp(fake.db);
      const gifts = await aliceShares(fake, target);
      await share(target, ALICE, gifts.id);
      const itemId = ((await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).json() as SharedCollectionPage).items[0]!.id;
      fake.table("blocks").push({ blocker_id: block[0], blocked_id: block[1], created_at: "2026-11-01T00:00:00+00:00" });
      expect((await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json()).toEqual({ collections: [] });
      expect((await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
      expect((await as(target, BOB).get(`/api/collection-items/${itemId}`)).statusCode).toBe(404);
      expect((await as(target, BOB).post(`/api/collection-items/${itemId}/keep`)).statusCode).toBe(404);
      await app?.close();
      app = null;
    }
  });

  it("compte suspendu : ses collections partagées sont cachées, et il ne peut plus en montrer une", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await collectionsApp(fake.db);
    const gifts = await aliceShares(fake, target);
    await share(target, ALICE, gifts.id);
    const other = await create(target, ALICE, "Autre");
    fake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    expect((await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json()).toEqual({ collections: [] });
    expect((await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    const refused = await as(target, ALICE).patch(`/api/collections/${other.id}`, { visibility: "friends" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("account_suspended");
    // Elle range et voit toujours ses propres collections.
    expect((await as(target, ALICE).get("/api/collections")).json().collections).toHaveLength(2);
    // Levée de la suspension : la collection réapparaît.
    fake.tables.set("suspensions", []);
    expect((await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).statusCode).toBe(200);
  });
});

describe("images : une copie dans notre stockage, jamais l'adresse du marchand", () => {
  it("ce que voit un ami : titre, copie, prix, lien sûr (affilié signalé) ; jamais la note privée ni l'image du marchand", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    await withImages();
    const target = await collectionsApp(fake.db);
    const gifts = await create(target, ALICE, "Cadeaux");
    await share(target, ALICE, gifts.id);
    expect(fake.uploads).toEqual([]);
    await place(target, ALICE, WISH, [gifts.id]);
    await place(target, ALICE, WISH_2, [gifts.id]);
    // Une copie par envie (deux tailles chacune), la plus grande source retenue.
    expect(fake.uploads.filter((path) => path.startsWith(`post-media/${ALICE}/`))).toHaveLength(4);
    expect(fake.table("collection_image_copies")).toHaveLength(2);

    const res = await as(target, BOB).get(`/api/collections/${gifts.id}/shared`);
    const page: SharedCollectionPage = res.json();
    const [watch, bag] = page.items;
    expect(bag).toMatchObject({ title: "Sac cabas en cuir", priceMin: 129, currency: "EUR", merchantName: "Boutique", isAffiliate: true, merchantUrl: "https://partenaire.example/sac?aff=spotto" });
    expect(watch).toMatchObject({ title: "Montre dorée", merchantUrl: null, isAffiliate: false, priceMin: null });
    for (const item of page.items) {
      expect(item.imageUrl!.startsWith(OWN_FOLDER(ALICE))).toBe(true);
      expect(item.imageThumbUrl!.startsWith(OWN_FOLDER(ALICE))).toBe(true);
    }
    for (const forbidden of ["gstatic", "sac-hd.jpg", "Note privée", "javascript:"]) expect(res.body).not.toContain(forbidden);
    // Même chose pour une seule envie (carte d'« En parler ») et pour la couverture.
    const single = await as(target, BOB).get(`/api/collection-items/${bag!.id}`);
    expect(single.json()).toEqual(bag);
    const cover = ((await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json() as SharedCollectionsList).collections[0]!.coverUrl;
    expect(cover).toBe(watch!.imageThumbUrl);
  });

  it("passer une collection à « Mes amis » copie les images de ses envies ; revenir à « Privée » les efface", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    await withImages();
    const target = await collectionsApp(fake.db);
    const gifts = await create(target, ALICE, "Cadeaux");
    await place(target, ALICE, WISH, [gifts.id]);
    await place(target, ALICE, WISH_2, [gifts.id]);
    expect(fake.uploads).toEqual([]);
    await share(target, ALICE, gifts.id);
    expect(fake.uploads).toHaveLength(4);
    expect(fake.removed).toEqual([]);
    await share(target, ALICE, gifts.id, "private");
    expect(fake.table("collection_image_copies")).toHaveLength(0);
    expect(fake.removed.sort()).toEqual(fake.uploads.sort());
  });

  it("une envie dans deux collections partagées : une seule copie, effacée quand plus aucune ne la montre", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    await withImages();
    const target = await collectionsApp(fake.db);
    const a = await create(target, ALICE, "A");
    const b = await create(target, ALICE, "B");
    const privateOne = await create(target, ALICE, "Privée");
    await share(target, ALICE, a.id);
    await share(target, ALICE, b.id);
    await place(target, ALICE, WISH, [a.id, b.id, privateOne.id]);
    expect(fake.uploads).toHaveLength(2);
    await place(target, ALICE, WISH, [b.id, privateOne.id]);
    expect(fake.removed).toEqual([]);
    expect(fake.table("collection_image_copies")).toHaveLength(1);
    // Retirée de la dernière collection partagée : copie effacée (la collection privée ne compte pas).
    await place(target, ALICE, WISH, [privateOne.id]);
    expect(fake.table("collection_image_copies")).toHaveLength(0);
    expect(fake.removed.sort()).toEqual(fake.uploads.sort());
  });

  it("collection supprimée, envie supprimée : la copie est effacée", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    await withImages();
    const target = await collectionsApp(fake.db);
    const a = await create(target, ALICE, "A");
    await share(target, ALICE, a.id);
    await place(target, ALICE, WISH, [a.id]);
    await place(target, ALICE, WISH_2, [a.id]);
    const copyOf = (wishId: string) => fake.table("collection_image_copies").find((row) => row.wishlist_item_id === wishId)!;
    const watchCopy = copyOf(WISH_2);
    expect((await as(target, ALICE).del(`/api/wishlist/${WISH_2}`)).statusCode).toBe(204);
    expect(fake.removed.sort()).toEqual([watchCopy.image_url, watchCopy.image_thumb_url].map((url) => String(url).split("/public/")[1]).sort());
    expect(fake.table("collection_image_copies").map((row) => row.wishlist_item_id)).toEqual([WISH]);
    expect((await as(target, ALICE).del(`/api/collections/${a.id}`)).statusCode).toBe(204);
    expect(fake.table("collection_image_copies")).toHaveLength(0);
    expect(fake.removed.sort()).toEqual(fake.uploads.sort());
    // L'envie reste dans les Envies.
    expect(fake.table("wishlist_items").map((row) => row.id)).toEqual([WISH]);
  });

  it("copie impossible : l'envie est montrée sans image (« Image indisponible »), jamais avec l'adresse d'origine ; réessayée au geste suivant", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await collectionsApp(fake.db);
    const a = await create(target, ALICE, "A");
    await share(target, ALICE, a.id);
    // Aucune image téléchargeable : le marchand refuse notre serveur.
    expect((await as(target, ALICE).put(`/api/wishlist/${WISH}/collections`, { collectionIds: [a.id] })).statusCode).toBe(200);
    expect(downloads.calls.sort()).toEqual([HD, THUMB].sort());
    const res = await as(target, BOB).get(`/api/collections/${a.id}/shared`);
    expect((res.json() as SharedCollectionPage).items[0]).toMatchObject({ title: "Sac cabas en cuir", imageUrl: null, imageThumbUrl: null });
    expect(res.body).not.toContain("gstatic");
    expect(res.body).not.toContain("sac-hd.jpg");
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/collections`)).json() as SharedCollectionsList).collections[0]!.coverUrl).toBeNull();
    // Une copie rangée par erreur hors de notre stockage n'est jamais montrée.
    fake.table("collection_image_copies").push({ wishlist_item_id: WISH, user_id: ALICE, image_url: THUMB, image_thumb_url: HD, created_at: "2026-11-09T00:00:00+00:00" });
    const tampered = await as(target, BOB).get(`/api/collections/${a.id}/shared`);
    expect((tampered.json() as SharedCollectionPage).items[0]!.imageUrl).toBeNull();
    expect(tampered.body).not.toContain("gstatic");
    fake.tables.set("collection_image_copies", []);
    // Le marchand répond de nouveau : la copie est faite au prochain changement.
    await withImages();
    await share(target, ALICE, a.id, "private");
    await share(target, ALICE, a.id);
    expect((((await as(target, BOB).get(`/api/collections/${a.id}/shared`)).json()) as SharedCollectionPage).items[0]!.imageUrl).toContain(OWN_FOLDER(ALICE));
  });
});

describe("« Garder » et « En parler »", () => {
  async function sharedBag(fake: ReturnType<typeof seeded>, target: FastifyInstance): Promise<string> {
    await withImages();
    const gifts = await create(target, ALICE, "Cadeaux");
    await share(target, ALICE, gifts.id);
    await place(target, ALICE, WISH, [gifts.id]);
    return ((await as(target, BOB).get(`/api/collections/${gifts.id}/shared`)).json() as SharedCollectionPage).items[0]!.id;
  }

  it("Garder : l'envie entre dans MES Envies avec les informations du marchand, une seule fois", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await collectionsApp(fake.db);
    const itemId = await sharedBag(fake, target);
    const kept = await as(target, BOB).post(`/api/collection-items/${itemId}/keep`);
    expect(kept.statusCode).toBe(201);
    const body: KeepSharedItemResponse = kept.json();
    expect(body.alreadyKept).toBe(false);
    expect(body.item).toMatchObject({ title: "Sac cabas en cuir", imageUrl: THUMB, priceMin: 129, currency: "EUR", merchantName: "Boutique", merchantUrl: "https://boutique.example/sac", productMatchId: null, reference: null });
    const bobs = fake.table("wishlist_items").filter((row) => row.user_id === BOB);
    expect(bobs).toHaveLength(1);
    // Jamais la note privée d'Alice.
    expect(bobs[0]!.reference).toBeNull();
    const again = await as(target, BOB).post(`/api/collection-items/${itemId}/keep`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ alreadyKept: true, item: { id: bobs[0]!.id } });
    expect(fake.table("wishlist_items").filter((row) => row.user_id === BOB)).toHaveLength(1);
    // Un non-ami : 404.
    expect((await as(target, CHLOE).post(`/api/collection-items/${itemId}/keep`)).statusCode).toBe(404);
    expect(fake.table("wishlist_items").filter((row) => row.user_id === CHLOE)).toHaveLength(0);
  });

  it("En parler : l'envie jointe au message pour son auteur, image copiée chez l'expéditeur ; jamais pour quelqu'un d'autre", async () => {
    const fake = seeded({ follows: [...friends(ALICE, BOB), ...friends(BOB, CHLOE)] });
    const target = await collectionsApp(fake.db);
    const itemId = await sharedBag(fake, target);
    const res = await as(target, BOB).post("/api/messages", { recipientId: ALICE, collectionItemId: itemId, text: "Il est beau !" });
    expect(res.statusCode).toBe(201);
    const sent: SendMessageResponse = res.json();
    expect(sent.message.wish).toMatchObject({ title: "Sac cabas en cuir", priceMin: 129, isAffiliate: true });
    expect(sent.message.wish!.imageUrl.startsWith(OWN_FOLDER(BOB))).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("gstatic");
    // Montrer l'envie d'Alice à Chloé : refusé (même réponse qu'une envie inconnue).
    const elsewhere = await as(target, BOB).post("/api/messages", { recipientId: CHLOE, collectionItemId: itemId });
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json().error).toBe("wishlist_item_not_found");
    expect((await as(target, BOB).post("/api/messages", { recipientId: ALICE, collectionItemId: UNKNOWN })).statusCode).toBe(404);
    expect((await as(target, BOB).post("/api/messages", { recipientId: ALICE, collectionItemId: itemId, wishId: WISH })).statusCode).toBe(400);
    expect(fake.table("messages")).toHaveLength(1);
  });
});

describe("limites de débit", () => {
  it("écritures et changements de visibilité, par heure", async () => {
    process.env.NODE_ENV = "development";
    const fake = seeded();
    const busy = "40000000-0000-4000-8000-000000000001";
    fake.table("profiles").push(profile(busy, "rangeuse"));
    const target = await collectionsApp(fake.db);
    const first = await create(target, busy, "Une");
    for (let i = 0; i < RATE_LIMITS.collectionVisibility.max; i += 1) {
      expect((await as(target, busy).patch(`/api/collections/${first.id}`, { visibility: i % 2 === 0 ? "friends" : "private" })).statusCode).toBe(200);
    }
    const tooOften = await as(target, busy).patch(`/api/collections/${first.id}`, { visibility: "friends" });
    expect(tooOften.statusCode).toBe(429);
    expect(tooOften.json().error).toBe("collection_visibility_limit");
    // Renommer reste possible jusqu'à la limite des écritures (chaque demande compte, même refusée).
    let status = 200;
    let attempts = 1 + RATE_LIMITS.collectionVisibility.max + 1;
    while (status === 200 && attempts < RATE_LIMITS.collectionWrite.max + 5) {
      status = (await as(target, busy).patch(`/api/collections/${first.id}`, { name: `Nom ${attempts}` })).statusCode;
      attempts += 1;
    }
    expect(status).toBe(429);
    expect(attempts).toBe(RATE_LIMITS.collectionWrite.max + 1);
    expect((await as(target, busy).post("/api/collections", { name: "Encore" })).json().error).toBe("collection_write_limit");
  });
});

describe("données personnelles", () => {
  it("l'export contient les collections (nom, visibilité), les envies rangées (identifiant, titre) et les copies", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    await withImages();
    const target = await collectionsApp(fake.db);
    const gifts = await create(target, ALICE, "Cadeaux");
    const summer = await create(target, ALICE, "Été");
    await share(target, ALICE, gifts.id);
    await place(target, ALICE, WISH, [gifts.id, summer.id]);
    await create(target, BOB, "Collection de Bob");

    const json = (await as(target, ALICE).get("/api/me/export")).json();
    expect(json.collections.map((row: Row) => [row.name, row.visibility])).toEqual([
      ["Cadeaux", "friends"],
      ["Été", "private"],
    ]);
    expect(json.collectionItems).toHaveLength(2);
    for (const row of json.collectionItems as Row[]) {
      expect(row).toMatchObject({ wishlist_item_id: WISH, wishlist_item_title: "Sac cabas en cuir" });
      expect(String(row.friends_image_url)).toContain(OWN_FOLDER(ALICE));
    }
    expect(JSON.stringify(json)).not.toContain("Collection de Bob");

    const page = await as(target, ALICE).get("/api/me/export?format=html");
    expect(page.statusCode).toBe(200);
    const text = page.body.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'");
    expect(text).toContain("Vos collections");
    expect(text).toContain("Cadeaux");
    expect(text).toContain("Vos amis");
    expect(text).toContain("Vous seul (privée)");
    expect(text).toContain("Envies rangées (1)");
  });

  it("suppression du compte : les copies montrées aux amis sont effacées", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    await withImages();
    const target = await collectionsApp(fake.db);
    const gifts = await create(target, ALICE, "Cadeaux");
    await share(target, ALICE, gifts.id);
    await place(target, ALICE, WISH, [gifts.id]);
    expect(fake.uploads).toHaveLength(2);
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.removed.sort()).toEqual(fake.uploads.sort());
    expect(fake.deletedUsers).toEqual([ALICE]);
  });

  it("le journal du serveur ne contient jamais le nom d'une collection, même quand l'écriture échoue", async () => {
    const lines: string[] = [];
    let fail = false;
    const fake = seeded(
      { follows: friends(ALICE, BOB) },
      {
        failWrite: (table, action, values) =>
          fail && table === "collections" && (action === "insert" || action === "update")
            ? { code: "23514", message: `new row violates check constraint, Failing row contains (${JSON.stringify(values)})` }
            : null,
      }
    );
    await withImages();
    const target = await collectionsApp(fake.db, lines);
    const gifts = await create(target, ALICE, SECRET_NAME);
    await share(target, ALICE, gifts.id);
    await place(target, ALICE, WISH, [gifts.id]);
    await as(target, BOB).get(`/api/users/${ALICE}/collections`);
    await as(target, BOB).get(`/api/collections/${gifts.id}/shared`);
    await as(target, ALICE).get("/api/me/export");
    fail = true;
    expect((await as(target, ALICE).post("/api/collections", { name: SECRET_NAME })).statusCode).toBe(500);
    expect((await as(target, ALICE).patch(`/api/collections/${gifts.id}`, { name: `${SECRET_NAME} 2` })).statusCode).toBe(500);
    expect((await as(target, ALICE).post("/api/collections", { name: "Pour ce connard" })).statusCode).toBe(400);
    const log = lines.join("\n");
    expect(log).toContain("Échec de la création d'une collection");
    expect(log).toContain("23514");
    expect(log).toContain("Collections : images copiées pour les amis");
    for (const secret of ["Cadeaux secrets", "Léa", "connard", "Sac cabas"]) expect(log).not.toContain(secret);
  });
});
