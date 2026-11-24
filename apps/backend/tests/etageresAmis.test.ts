import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendVaultPage, FriendWishPage, Profile, UserProfile } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import usersRoutes from "../src/routes/users.js";
import meRoutes from "../src/routes/me.js";
import wishlistRoutes from "../src/routes/wishlist.js";
import collectionsRoutes from "../src/routes/collections.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import type { Audience } from "../src/lib/audience.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { canSeeFriendCollections, resetCollectionsProbe } from "../src/lib/collections.js";
import { friendShelfAllowed, friendShelvesFor, friendShelvesReady, resetFriendShelvesProbe } from "../src/lib/friendShelves.js";
import { DatabaseReadError } from "../src/lib/validation.js";
import { isBlockedEitherWay, isFollowing } from "../src/lib/visibility.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Étagères des amis (lot « étagères des amis », migration 0058), SANS base ni
// réseau : les vraies routes sur une fausse base en mémoire. Chaque règle a
// son cas refusé ET son cas permis : pas ami, simple abonné, blocage dans
// chaque sens, compte suspendu, réglage éteint, migration absente, lecture
// impossible. Le même parcours sur la vraie base : etageresAmisBase.test.ts.

// Images des marchands : jamais téléchargées pour de vrai.
const downloads = vi.hoisted(() => ({ images: new Map<string, Buffer>(), calls: [] as string[], onDownload: null as null | (() => void) }));
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return {
    ...original,
    downloadPublicImage: async (url: string) => {
      downloads.calls.push(url);
      downloads.onDownload?.();
      const image = downloads.images.get(url);
      if (!image) throw new original.PublicImageError("Image refusée", 403);
      return image;
    },
  };
});

// Alice montre ses étagères. Bob est son ami (chacun suit l'autre). Chloé la
// suit sans être suivie. Dan est suivi par Alice sans la suivre. Eve ne la
// connaît pas.
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const DAN = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const WISH = "e1000000-0000-4000-8000-000000000001";
const WISH_2 = "e1000000-0000-4000-8000-000000000002";
const VAULT_PHOTO = "f1000000-0000-4000-8000-000000000001";
const VAULT_MATCH = "f1000000-0000-4000-8000-000000000002";
const MATCH = "f0000000-0000-4000-8000-000000000007";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:vignette";
const HD = "https://boutique.example/images/sac-hd.jpg";
const THUMB_2 = "https://encrypted-tbn0.gstatic.com/images?q=tbn:montre";
const OWN_PHOTO = `${STORAGE_ORIGIN}/storage/v1/object/public/vault-media/${ALICE}/photo.jpg`;
const OWN_FOLDER = `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${ALICE}/`;
const SECRET_NOTE = "Note privée : taille M";

const COLUMNS = ["wishes_shown_to_friends", "vault_shown_to_friends"];

function profile(id: string, username: string, shelves: { wishes?: boolean; vault?: boolean } = {}): Row {
  return {
    id,
    username,
    display_name: username[0]!.toUpperCase() + username.slice(1),
    avatar_url: null,
    bio: null,
    locale: "fr",
    default_privacy: "followers",
    piece_sends_from: "following",
    messages_from: "everyone",
    is_private: false,
    wishes_shown_to_friends: shelves.wishes ?? false,
    vault_shown_to_friends: shelves.vault ?? false,
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

interface Seed {
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
  wishes?: boolean;
  vault?: boolean;
}

const DEFAULT_FOLLOWS: [string, string][] = [
  [ALICE, BOB],
  [BOB, ALICE],
  [CHLOE, ALICE],
  [ALICE, DAN],
];

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  const migrated = !(options.missingColumns?.profiles ?? []).includes(COLUMNS[0]!);
  const rows = [
    profile(ALICE, "alice", { wishes: seed.wishes ?? true, vault: seed.vault ?? true }),
    profile(BOB, "bob"),
    profile(CHLOE, "chloe"),
    profile(DAN, "dan"),
    profile(EVE, "eve"),
  ];
  if (!migrated) for (const row of rows) for (const column of COLUMNS) delete row[column];
  fake.table("profiles").push(...rows);
  for (const [follower, followee] of seed.follows ?? DEFAULT_FOLLOWS) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  fake.table("product_matches").push({ id: MATCH, image_url: THUMB, image_hd_url: HD });
  fake.table("affiliate_links").push({ product_match_id: MATCH, affiliate_url: "https://partenaire.example/sac?aff=spotto" });
  fake.table("wishlist_items").push(
    {
      id: WISH,
      user_id: ALICE,
      title: "Sac cabas en cuir",
      image_url: THUMB,
      reference: SECRET_NOTE,
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
  fake.table("vault_items").push(
    { id: VAULT_PHOTO, user_id: ALICE, title: "Veste en laine", image_url: OWN_PHOTO, category: "clothing", verified: true, product_match_id: null, affiliate_conversion_id: null, created_at: "2026-11-03T00:00:00+00:00" },
    { id: VAULT_MATCH, user_id: ALICE, title: "Sac cabas", image_url: THUMB, category: "bags", verified: false, product_match_id: MATCH, affiliate_conversion_id: null, created_at: "2026-11-04T00:00:00+00:00" }
  );
  return fake;
}

/** Une base dont certaines tables ne répondent plus (panne simulée). */
function withBrokenTables(db: ReturnType<typeof fakeSupabase>["db"], tables: string[]) {
  const result = { data: null, error: { code: "08006", message: "panne simulée" }, count: null };
  const broken: unknown = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "then") return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
        if (prop === "maybeSingle" || prop === "single" || prop === "range") return () => Promise.resolve(result);
        return () => broken;
      },
    }
  );
  return { ...db, from: (table: string) => (tables.includes(table) ? broken : db.from(table)) };
}

let app: FastifyInstance | null = null;

async function shelvesApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(usersRoutes);
  await app.register(meRoutes);
  await app.register(wishlistRoutes);
  await app.register(collectionsRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: unknown) => target.inject({ method: "PUT", url, headers, payload: payload as object }),
    patch: (url: string, payload: object) => target.inject({ method: "PATCH", url, headers, payload }),
    del: (url: string) => target.inject({ method: "DELETE", url, headers }),
  };
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#806040" } }).jpeg().toBuffer();
}

async function withImages() {
  downloads.images.set(THUMB, await jpeg(180, 240));
  downloads.images.set(HD, await jpeg(600, 800));
  downloads.images.set(THUMB_2, await jpeg(300, 300));
}

/** Ce que `viewer` voit des étagères d'Alice : le champ du profil et les deux pages. */
async function whatSees(target: FastifyInstance, viewer: string) {
  const client = as(target, viewer);
  const [profileRes, wishesRes, vaultRes] = await Promise.all([client.get(`/api/users/${ALICE}`), client.get(`/api/users/${ALICE}/wishlist`), client.get(`/api/users/${ALICE}/vault`)]);
  return {
    status: [profileRes.statusCode, wishesRes.statusCode, vaultRes.statusCode],
    shelves: (profileRes.json() as UserProfile).friendShelves,
    hasField: "friendShelves" in (profileRes.json() as object),
    wishes: wishesRes.json() as FriendWishPage,
    vault: vaultRes.json() as FriendVaultPage,
  };
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetFriendShelvesProbe();
  resetPrivateAccountsProbe();
  resetCollectionsProbe();
  resetWishAlertsProbe();
  downloads.images.clear();
  downloads.calls.length = 0;
  downloads.onDownload = null;
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

// ---------------------------------------------------------------------------

describe("la règle, sans base", () => {
  const friend: Audience = { self: false, blocked: false, suspended: false, isPrivate: false, follows: true, requested: false };

  it("permis : un ami (chacun suit l'autre), réglage exactement vrai", () => {
    expect(friendShelfAllowed(friend, true, true)).toBe(true);
    expect(friendShelfAllowed({ ...friend, isPrivate: true }, true, true)).toBe(true);
  });

  it("refusé dans tous les autres cas", () => {
    const refused: [string, Audience, boolean, unknown][] = [
      ["soi-même", { ...friend, self: true, follows: false }, false, true],
      ["simple abonné (pas suivi en retour)", friend, false, true],
      ["suivi sans suivre (pas abonné)", { ...friend, follows: false }, true, true],
      ["demande en attente d'un compte privé", { ...friend, isPrivate: true, follows: false, requested: true }, true, true],
      ["blocage (un sens ou l'autre)", { ...friend, blocked: true }, true, true],
      ["propriétaire suspendu", { ...friend, suspended: true }, true, true],
      ["réglage éteint", friend, true, false],
      ["réglage vide", friend, true, null],
      ["réglage absent", friend, true, undefined],
      ["réglage en texte", friend, true, "true"],
      ["réglage en nombre", friend, true, 1],
    ];
    for (const [why, audience, ownerFollows, setting] of refused) expect(friendShelfAllowed(audience, ownerFollows, setting), why).toBe(false);
  });
});

describe("profil d'un membre : les étagères annoncées seulement à ses amis", () => {
  it("permis : son ami voit les deux étagères annoncées", async () => {
    const target = await shelvesApp(seeded().db);
    const seen = await whatSees(target, BOB);
    expect(seen.status).toEqual([200, 200, 200]);
    expect(seen.shelves).toEqual({ wishes: true, vault: true });
  });

  it("un seul réglage allumé : une seule étagère annoncée, l'autre page vide", async () => {
    await withImages();
    const target = await shelvesApp(seeded({ wishes: false, vault: true }).db);
    const seen = await whatSees(target, BOB);
    expect(seen.shelves).toEqual({ wishes: false, vault: true });
    expect(seen.wishes).toEqual({ items: [], nextCursor: null });
    expect(seen.vault.items).toHaveLength(2);
    expect(downloads.calls).toEqual([]);
  });

  for (const [why, seed, viewer] of [
    ["un simple abonné (Chloé suit Alice, pas l'inverse)", {}, CHLOE],
    ["un membre qu'Alice suit sans être suivie (Dan)", {}, DAN],
    ["une inconnue (Eve)", {}, EVE],
    ["un ami qui a bloqué Alice", { blocks: [[BOB, ALICE]] }, BOB],
    ["un ami bloqué par Alice", { blocks: [[ALICE, BOB]] }, BOB],
    ["un ami, Alice suspendue", { suspended: [ALICE] }, BOB],
    ["un ami, les deux réglages éteints", { wishes: false, vault: false }, BOB],
  ] as [string, Seed, string][]) {
    it(`refusé : ${why} — aucun champ, pages vides, rien qui dise pourquoi`, async () => {
      await withImages();
      const target = await shelvesApp(seeded(seed).db);
      const seen = await whatSees(target, viewer);
      expect(seen.hasField).toBe(false);
      expect(seen.wishes).toEqual({ items: [], nextCursor: null });
      expect(seen.vault).toEqual({ items: [], nextCursor: null });
      // Rien n'a été copié pour un visiteur refusé.
      expect(downloads.calls).toEqual([]);
    });
  }

  it("refusé : soi-même (le propriétaire a ses propres écrans)", async () => {
    const target = await shelvesApp(seeded().db);
    const seen = await whatSees(target, ALICE);
    expect(seen.hasField).toBe(false);
    expect(seen.wishes.items).toEqual([]);
  });

  it("migration 0058 absente : rien d'annoncé, pages vides, réglages absents de /api/me, enregistrement « indisponible »", async () => {
    const target = await shelvesApp(seeded({}, { missingColumns: { profiles: COLUMNS } }).db);
    const seen = await whatSees(target, BOB);
    expect(seen.status).toEqual([200, 200, 200]);
    expect(seen.hasField).toBe(false);
    expect(seen.wishes.items).toEqual([]);
    expect(seen.vault.items).toEqual([]);
    const me = (await as(target, ALICE).get("/api/me")).json() as Profile;
    expect("showWishesToFriends" in me).toBe(false);
    expect("showVaultToFriends" in me).toBe(false);
    const put = await as(target, ALICE).put("/api/me/friend-shelves", { wishes: true });
    expect(put.statusCode).toBe(404);
    expect(put.json().error).toBe("friend_shelves_unavailable");
  });

  it("schéma illisible (ni « présent » ni « absent ») : la sonde ne répond pas « absent », et rien n'est montré", async () => {
    const fake = seeded();
    const db = withBrokenTables(fake.db, ["profiles"]);
    await expect(friendShelvesReady({ supabaseAdmin: db as never, log: { warn: () => {} } as never })).rejects.toBeInstanceOf(DatabaseReadError);
  });

  for (const table of ["blocks", "follows", "suspensions"]) {
    it(`lecture impossible (${table}) : jamais ouvert — profil sans étagère, pages en erreur, jamais une envie`, async () => {
      const fake = seeded();
      const db = withBrokenTables(fake.db, [table]);
      // La règle elle-même : une erreur, jamais « oui ».
      await expect(friendShelvesFor({ supabaseAdmin: db, log: { warn: () => {} } } as unknown as FastifyInstance, BOB, ALICE)).rejects.toBeInstanceOf(DatabaseReadError);
      const target = await shelvesApp(db);
      const wishes = await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
      expect(wishes.statusCode).toBe(500);
      expect(JSON.stringify(wishes.json())).not.toContain("Sac cabas");
      const vault = await as(target, BOB).get(`/api/users/${ALICE}/vault`);
      expect(vault.statusCode).toBe(500);
    });
  }

  it("lecture impossible des réglages eux-mêmes : profil lisible, sans étagère", async () => {
    const fake = seeded();
    // La sonde passe (colonnes présentes), puis la lecture du réglage échoue.
    const target = await shelvesApp(fake.db);
    expect((await whatSees(target, BOB)).shelves).toEqual({ wishes: true, vault: true });
    const original = fake.db.from;
    const broken = withBrokenTables(fake.db, ["profiles"]).from("profiles");
    // Seule la lecture des réglages échoue (la sonde, déjà passée, n'est pas refaite).
    (fake.db as { from: (table: string) => unknown }).from = (table: string) => {
      const query = original(table);
      if (table !== "profiles") return query;
      return { ...query, select: (columns: string) => (columns.includes("wishes_shown_to_friends") ? broken : query.select(columns)) };
    };
    const res = await as(target, BOB).get(`/api/users/${ALICE}`);
    (fake.db as { from: typeof original }).from = original;
    expect(res.statusCode).toBe(200);
    expect("friendShelves" in (res.json() as object)).toBe(false);
  });
});

describe("les Envies d'un ami : lecture seule, jamais ce qui est privé", () => {
  it("permis : titre, copie Spotto de l'image, prix, boutique, lien ; les clés exactes, rien d'autre", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    const res = await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const page = res.json() as FriendWishPage;
    expect(page.items.map((item) => item.id)).toEqual([WISH_2, WISH]);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(["currency", "id", "imageThumbUrl", "imageUrl", "isAffiliate", "merchantName", "merchantUrl", "priceMin", "title"]);
      // Toujours une copie de notre stockage, dans le dossier d'Alice : jamais l'image du marchand.
      expect(item.imageUrl?.startsWith(OWN_FOLDER)).toBe(true);
      expect(item.imageThumbUrl?.startsWith(OWN_FOLDER)).toBe(true);
    }
    const sac = page.items.find((item) => item.id === WISH)!;
    expect(sac).toMatchObject({ title: "Sac cabas en cuir", priceMin: 129, currency: "EUR", merchantName: "Boutique", merchantUrl: "https://partenaire.example/sac?aff=spotto", isAffiliate: true });
    // Un lien qui n'est pas un lien web n'est jamais servi.
    expect(page.items.find((item) => item.id === WISH_2)!.merchantUrl).toBeNull();
    const text = JSON.stringify(page);
    for (const secret of [SECRET_NOTE, THUMB, HD, THUMB_2, MATCH, "2026-11-0", "reference", "productMatchId", "addedAt", "createdAt"]) expect(text, secret).not.toContain(secret);
    // Copies faites à la demande (une par envie de la page), une seule fois.
    expect(fake.table("collection_image_copies")).toHaveLength(2);
    const callsAfterFirst = downloads.calls.length;
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect(downloads.calls.length).toBe(callsAfterFirst);
  });

  it("une image impossible à copier : l'envie sans image, jamais l'adresse du marchand", async () => {
    const target = await shelvesApp(seeded().db);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items).toHaveLength(2);
    for (const item of page.items) expect([item.imageUrl, item.imageThumbUrl]).toEqual([null, null]);
  });

  it("allumer le réglage ne copie rien ; l'éteindre efface les copies, sauf celles d'une collection montrée aux amis", async () => {
    await withImages();
    const fake = seeded({ wishes: false });
    const target = await shelvesApp(fake.db);
    const alice = as(target, ALICE);
    expect((await alice.put("/api/me/friend-shelves", { wishes: true })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.wishes_shown_to_friends).toBe(true);
    expect(downloads.calls).toEqual([]);
    expect(fake.table("collection_image_copies")).toHaveLength(0);
    // Une collection « Mes amis » contient le sac.
    const created = await alice.post("/api/collections", { name: "Pour l'hiver" });
    expect(created.statusCode).toBe(201);
    expect((await alice.put(`/api/wishlist/${WISH}/collections`, { collectionIds: [created.json().id] })).statusCode).toBe(200);
    expect((await alice.patch(`/api/collections/${created.json().id}`, { visibility: "friends" })).statusCode).toBe(200);
    // Bob ouvre l'étagère : la montre est copiée à son tour.
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect(new Set(fake.table("collection_image_copies").map((row) => row.wishlist_item_id))).toEqual(new Set([WISH, WISH_2]));
    // Éteint : la copie de la montre part, celle du sac (collection montrée) reste.
    expect((await alice.put("/api/me/friend-shelves", { wishes: false })).statusCode).toBe(204);
    expect(fake.table("collection_image_copies").map((row) => row.wishlist_item_id)).toEqual([WISH]);
    expect(fake.removed.some((path) => path.startsWith(`post-media/${ALICE}/`))).toBe(true);
    expect((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json()).toEqual({ items: [], nextCursor: null });
  });

  it("réglage éteint pendant que les copies se font : aucune copie ne reste (vérifiée après coup)", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    // Alice éteint le réglage pendant que Bob fait faire les copies (et la
    // remise en ordre de ce moment-là ne voit encore aucune copie).
    downloads.onDownload = () => {
      fake.table("profiles").find((row) => row.id === ALICE)!.wishes_shown_to_friends = false;
    };
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    // Refusé : une copie qui survit au « non ».
    await vi.waitFor(() => expect(fake.table("collection_image_copies")).toHaveLength(0));
    expect(downloads.calls.length).toBeGreaterThan(0);
    expect(fake.removed.filter((path) => path.startsWith(`post-media/${ALICE}/`)).length).toBeGreaterThanOrEqual(4);
  });

  it("réglage resté allumé : la vérification d'après coup garde les copies", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    // Permis : les deux copies restent, aucun fichier effacé.
    expect(fake.table("collection_image_copies")).toHaveLength(2);
    expect(fake.removed.filter((path) => path.startsWith(`post-media/${ALICE}/`))).toEqual([]);
  });

  it("une envie retirée part de l'étagère et sa copie est effacée", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect((await as(target, ALICE).del(`/api/wishlist/${WISH_2}`)).statusCode).toBe(204);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items.map((item) => item.id)).toEqual([WISH]);
  });

  it("pages : 24 par page, le curseur est un rang (jamais une date) ; curseur mal formé refusé", async () => {
    const fake = seeded();
    for (let i = 0; i < 30; i += 1) {
      fake.table("wishlist_items").push({
        id: `e2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
        user_id: ALICE,
        title: `Envie ${i}`,
        image_url: THUMB,
        reference: null,
        price_min: null,
        currency: null,
        merchant_name: null,
        merchant_url: null,
        product_match_id: null,
        created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+00:00`,
      });
    }
    const target = await shelvesApp(fake.db);
    const first = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toBe("24");
    const second = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist?cursor=24`)).json() as FriendWishPage;
    expect(second.items).toHaveLength(8);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(32);
    expect((await as(target, BOB).get(`/api/users/${ALICE}/wishlist?cursor=2026-11-01`)).statusCode).toBe(400);
  });
});

describe("le Vault d'un ami : lecture seule", () => {
  it("permis : nom, catégorie, image ; jamais la date, « achat vérifié » ni la recherche d'origine", async () => {
    const target = await shelvesApp(seeded().db);
    const res = await as(target, BOB).get(`/api/users/${ALICE}/vault`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const page = res.json() as FriendVaultPage;
    expect(page.items.map((item) => item.id)).toEqual([VAULT_MATCH, VAULT_PHOTO]);
    for (const item of page.items) expect(Object.keys(item).sort()).toEqual(["category", "id", "imageHdUrl", "imageUrl", "title"]);
    expect(page.items[0]).toEqual({ id: VAULT_MATCH, title: "Sac cabas", category: "bags", imageUrl: THUMB, imageHdUrl: HD });
    expect(page.items[1]).toEqual({ id: VAULT_PHOTO, title: "Veste en laine", category: "clothing", imageUrl: OWN_PHOTO, imageHdUrl: null });
    const text = JSON.stringify(page);
    for (const secret of ["verified", "2026-11-0", MATCH, "productMatchId", "createdAt", "affiliate"]) expect(text, secret).not.toContain(secret);
  });

  it("le profil n'annonce jamais le nombre de pièces du Vault", async () => {
    const target = await shelvesApp(seeded().db);
    const body = (await as(target, BOB).get(`/api/users/${ALICE}`)).json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/vaultCount|vault_count|itemCount/);
  });
});

describe("le réglage : PUT /api/me/friend-shelves", () => {
  it("/api/me renvoie les deux réglages, éteints au départ", async () => {
    const target = await shelvesApp(seeded({ wishes: false, vault: false }).db);
    const me = (await as(target, BOB).get("/api/me")).json() as Profile;
    expect(me.showWishesToFriends).toBe(false);
    expect(me.showVaultToFriends).toBe(false);
  });

  it("permis : un vrai oui ou non, pour l'un, l'autre ou les deux ; refusé : texte, nombre, corps vide, clé inconnue", async () => {
    const fake = seeded({ wishes: false, vault: false });
    const target = await shelvesApp(fake.db);
    const bob = as(target, BOB);
    expect((await bob.put("/api/me/friend-shelves", { vault: true })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === BOB)).toMatchObject({ vault_shown_to_friends: true, wishes_shown_to_friends: false });
    for (const body of [{ wishes: "true" }, { vault: 1 }, {}, { wishes: true, autre: true }, null]) {
      expect((await bob.put("/api/me/friend-shelves", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(fake.table("profiles").find((row) => row.id === BOB)).toMatchObject({ vault_shown_to_friends: true, wishes_shown_to_friends: false });
  });

  it("limité : au-delà de la limite horaire, 429", async () => {
    process.env.NODE_ENV = "development";
    const target = await shelvesApp(seeded().db);
    const bob = as(target, BOB);
    for (let i = 0; i < RATE_LIMITS.friendShelvesSetting.max; i += 1) expect((await bob.put("/api/me/friend-shelves", { vault: i % 2 === 0 })).statusCode).toBe(204);
    const tooOften = await bob.put("/api/me/friend-shelves", { vault: true });
    expect(tooOften.statusCode).toBe(429);
    expect(tooOften.json().error).toBe("friend_shelves_setting_limit");
  });
});

describe("contre-lecture : les vérifications de blocage ne sont plus « ouvertes par défaut »", () => {
  const fastifyWith = (db: unknown) => ({ supabaseAdmin: db, log: { warn: () => {}, error: () => {} } }) as unknown as FastifyInstance;

  it("isBlockedEitherWay : permis (lecture réussie) → vrai ou faux ; lecture impossible → erreur, jamais « pas bloqué »", async () => {
    const fake = seeded({ blocks: [[ALICE, EVE]] });
    expect(await isBlockedEitherWay(fastifyWith(fake.db), EVE, ALICE)).toBe(true);
    expect(await isBlockedEitherWay(fastifyWith(fake.db), BOB, ALICE)).toBe(false);
    await expect(isBlockedEitherWay(fastifyWith(withBrokenTables(fake.db, ["blocks"])), BOB, ALICE)).rejects.toBeInstanceOf(DatabaseReadError);
  });

  it("isFollowing : lecture impossible → erreur, jamais une réponse par défaut", async () => {
    const fake = seeded();
    expect(await isFollowing(fastifyWith(fake.db), BOB, ALICE)).toBe(true);
    await expect(isFollowing(fastifyWith(withBrokenTables(fake.db, ["follows"])), BOB, ALICE)).rejects.toBeInstanceOf(DatabaseReadError);
  });

  it("collections des amis : permis entre amis ; refusé au simple abonné ; lecture des blocages impossible → erreur, jamais « visible »", async () => {
    const fake = seeded();
    expect(await canSeeFriendCollections(fastifyWith(fake.db), BOB, ALICE)).toBe(true);
    expect(await canSeeFriendCollections(fastifyWith(fake.db), CHLOE, ALICE)).toBe(false);
    for (const table of ["blocks", "follows", "suspensions"]) {
      await expect(canSeeFriendCollections(fastifyWith(withBrokenTables(fake.db, [table])), BOB, ALICE), table).rejects.toBeInstanceOf(DatabaseReadError);
    }
  });
});
