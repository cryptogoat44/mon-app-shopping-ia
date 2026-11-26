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
import { canSeeFriendCollections, resetCollectionsProbe, syncFriendCopies, wishesOffFriendShelf } from "../src/lib/collections.js";
import { friendShelfAllowed, friendShelvesFor, friendShelvesReady, resetFriendShelvesProbe, vaultPiecesInHiddenPosts } from "../src/lib/friendShelves.js";
import { DatabaseReadError } from "../src/lib/validation.js";
import { isBlockedEitherWay, isFollowing } from "../src/lib/visibility.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Étagères des amis (lot « étagères des amis », migration 0058, refondue
// selon le fondateur : allumées par défaut, ouvertes seulement après
// l'information vue, un ami voit tout, « Privée » reste privée), SANS base ni
// réseau : les vraies routes sur une fausse base en mémoire. Chaque règle a
// son cas refusé ET son cas permis : information non vue, pas ami, simple
// abonné, blocage dans chaque sens, compte suspendu, réglage éteint,
// migration absente ou incomplète, lecture impossible, collection privée.
// Le même parcours sur la vraie base : etageresAmisBase.test.ts.

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

const COLUMNS = ["wishes_shown_to_friends", "vault_shown_to_friends", "friend_shelves_informed_at"];
const INFORMED_AT = "2026-11-25T09:00:00+00:00";

function profile(id: string, username: string, shelves: { wishes?: boolean; vault?: boolean; informed?: boolean } = {}): Row {
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
    // Allumés par défaut (comme la migration 0058) ; information pas vue.
    wishes_shown_to_friends: shelves.wishes ?? true,
    vault_shown_to_friends: shelves.vault ?? true,
    friend_shelves_informed_at: shelves.informed ? INFORMED_AT : null,
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
  /** Alice a-t-elle vu l'information ? Oui par défaut dans ces tests. */
  informed?: boolean;
}

const DEFAULT_FOLLOWS: [string, string][] = [
  [ALICE, BOB],
  [BOB, ALICE],
  [CHLOE, ALICE],
  [ALICE, DAN],
];

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  const missing = options.missingColumns?.profiles ?? [];
  const rows = [
    profile(ALICE, "alice", { wishes: seed.wishes ?? true, vault: seed.vault ?? true, informed: seed.informed ?? true }),
    profile(BOB, "bob"),
    profile(CHLOE, "chloe"),
    profile(DAN, "dan"),
    profile(EVE, "eve"),
  ];
  for (const row of rows) for (const column of missing) delete row[column];
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

  it("permis : un ami (chacun suit l'autre), réglage exactement vrai, information vue", () => {
    expect(friendShelfAllowed(friend, true, true, INFORMED_AT)).toBe(true);
    expect(friendShelfAllowed({ ...friend, isPrivate: true }, true, true, INFORMED_AT)).toBe(true);
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
    for (const [why, audience, ownerFollows, setting] of refused) expect(friendShelfAllowed(audience, ownerFollows, setting, INFORMED_AT), why).toBe(false);
  });

  it("refusé : information pas vue (date vide, absente ou mal formée), même réglage allumé et entre amis", () => {
    for (const informedAt of [null, undefined, "", 0, true, {}]) expect(friendShelfAllowed(friend, true, true, informedAt), String(informedAt)).toBe(false);
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
    ["un ami, réglages allumés mais information pas encore vue par Alice", { informed: false }, BOB],
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

  for (const [why, missing] of [
    ["migration 0058 absente", COLUMNS],
    ["migration incomplète (les deux réglages sans la date de l'information)", ["friend_shelves_informed_at"]],
  ] as [string, string[]][]) {
    it(`${why} : rien d'annoncé, pages vides, réglages absents de /api/me, enregistrement « indisponible »`, async () => {
      const target = await shelvesApp(seeded({}, { missingColumns: { profiles: missing } }).db);
      const seen = await whatSees(target, BOB);
      expect(seen.status).toEqual([200, 200, 200]);
      expect(seen.hasField).toBe(false);
      expect(seen.wishes.items).toEqual([]);
      expect(seen.vault.items).toEqual([]);
      const me = (await as(target, ALICE).get("/api/me")).json() as Profile;
      expect("showWishesToFriends" in me).toBe(false);
      expect("showVaultToFriends" in me).toBe(false);
      expect("friendShelvesInformed" in me).toBe(false);
      for (const body of [{ wishes: true }, { informed: true }]) {
        const put = await as(target, ALICE).put("/api/me/friend-shelves", body);
        expect(put.statusCode).toBe(404);
        expect(put.json().error).toBe("friend_shelves_unavailable");
      }
    });
  }

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
  it("permis : titre, copie Spotto de l'image, prix, boutique, lien, collections ; les clés exactes, rien d'autre", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    const res = await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const page = res.json() as FriendWishPage;
    expect(page.items.map((item) => item.id)).toEqual([WISH_2, WISH]);
    for (const item of page.items) {
      // Aucune alerte allumée ici : pas de champ priceAlert ; aucune collection : liste vide.
      expect(Object.keys(item).sort()).toEqual(["collections", "currency", "id", "imageThumbUrl", "imageUrl", "isAffiliate", "merchantName", "merchantUrl", "priceMin", "title"]);
      expect(item.collections).toEqual([]);
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

  it("allumer le réglage ne copie rien ; l'éteindre efface les copies, sauf celles d'une collection « Mes amis »", async () => {
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
  it("permis : nom, catégorie, image, date d'ajout et « achat vérifié » ; jamais la recherche d'origine ni l'affiliation", async () => {
    const target = await shelvesApp(seeded().db);
    const res = await as(target, BOB).get(`/api/users/${ALICE}/vault`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const page = res.json() as FriendVaultPage;
    expect(page.items.map((item) => item.id)).toEqual([VAULT_MATCH, VAULT_PHOTO]);
    for (const item of page.items) expect(Object.keys(item).sort()).toEqual(["category", "createdAt", "id", "imageHdUrl", "imageUrl", "title", "verified"]);
    expect(page.items[0]).toEqual({ id: VAULT_MATCH, title: "Sac cabas", category: "bags", imageUrl: THUMB, imageHdUrl: HD, createdAt: "2026-11-04T00:00:00+00:00", verified: false });
    expect(page.items[1]).toEqual({ id: VAULT_PHOTO, title: "Veste en laine", category: "clothing", imageUrl: OWN_PHOTO, imageHdUrl: null, createdAt: "2026-11-03T00:00:00+00:00", verified: true });
    const text = JSON.stringify(page);
    for (const secret of [MATCH, "productMatchId", "affiliate", "search"]) expect(text, secret).not.toContain(secret);
  });

  it("le profil n'annonce jamais le nombre de pièces du Vault", async () => {
    const target = await shelvesApp(seeded().db);
    const body = (await as(target, BOB).get(`/api/users/${ALICE}`)).json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/vaultCount|vault_count|itemCount/);
  });
});

describe("le réglage : PUT /api/me/friend-shelves", () => {
  it("/api/me renvoie les deux réglages tels qu'enregistrés (allumés au départ) et si l'information a été vue", async () => {
    const target = await shelvesApp(seeded().db);
    const bob = (await as(target, BOB).get("/api/me")).json() as Profile;
    expect(bob).toMatchObject({ showWishesToFriends: true, showVaultToFriends: true, friendShelvesInformed: false });
    const alice = (await as(target, ALICE).get("/api/me")).json() as Profile;
    expect(alice.friendShelvesInformed).toBe(true);
    // Jamais la date elle-même, ni le nom de la colonne.
    expect(JSON.stringify(alice)).not.toContain(INFORMED_AT);
    expect(JSON.stringify(alice)).not.toContain("informed_at");
  });

  it("l'information vue (« Compris ») : la date est notée par ce seul geste, et les étagères s'ouvrent", async () => {
    const fake = seeded({ informed: false });
    const target = await shelvesApp(fake.db);
    // Refusé : rien d'ouvert tant qu'Alice n'a pas vu l'information, même
    // après avoir touché ses réglages (le réglage seul n'écrit pas la date).
    expect((await whatSees(target, BOB)).hasField).toBe(false);
    expect((await as(target, ALICE).put("/api/me/friend-shelves", { vault: true })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.friend_shelves_informed_at).toBeNull();
    expect((await whatSees(target, BOB)).hasField).toBe(false);
    // Lire son profil ou celui d'un autre n'écrit jamais la date.
    await as(target, ALICE).get("/api/me");
    await as(target, BOB).get(`/api/users/${ALICE}`);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.friend_shelves_informed_at).toBeNull();
    // Permis : « Compris ».
    expect((await as(target, ALICE).put("/api/me/friend-shelves", { informed: true })).statusCode).toBe(204);
    expect(typeof fake.table("profiles").find((row) => row.id === ALICE)!.friend_shelves_informed_at).toBe("string");
    const seen = await whatSees(target, BOB);
    expect(seen.shelves).toEqual({ wishes: true, vault: true });
    expect(seen.vault.items).toHaveLength(2);
  });

  it("l'information refusée (« Éteindre ») : les deux réglages éteints et la date notée, en une fois ; rien n'est ouvert", async () => {
    const fake = seeded({ informed: false });
    const target = await shelvesApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/friend-shelves", { wishes: false, vault: false, informed: true })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === ALICE)).toMatchObject({ wishes_shown_to_friends: false, vault_shown_to_friends: false });
    expect(typeof fake.table("profiles").find((row) => row.id === ALICE)!.friend_shelves_informed_at).toBe("string");
    const seen = await whatSees(target, BOB);
    expect(seen.hasField).toBe(false);
    expect(seen.wishes).toEqual({ items: [], nextCursor: null });
    expect(seen.vault).toEqual({ items: [], nextCursor: null });
    expect(((await as(target, ALICE).get("/api/me")).json() as Profile).friendShelvesInformed).toBe(true);
  });

  it("permis : un vrai oui ou non, pour l'un, l'autre ou les deux ; refusé : texte, nombre, corps vide, clé inconnue, « informé » autre que vrai", async () => {
    const fake = seeded({ wishes: false, vault: false });
    const target = await shelvesApp(fake.db);
    const bob = as(target, BOB);
    // Bob a ses deux réglages allumés (par défaut) : il éteint le Vault, les Envies ne bougent pas.
    expect((await bob.put("/api/me/friend-shelves", { vault: false })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === BOB)).toMatchObject({ vault_shown_to_friends: false, wishes_shown_to_friends: true });
    for (const body of [{ wishes: "true" }, { vault: 1 }, {}, { wishes: true, autre: true }, null, { informed: false }, { informed: "true" }, { informed: 1 }]) {
      expect((await bob.put("/api/me/friend-shelves", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(fake.table("profiles").find((row) => row.id === BOB)).toMatchObject({ vault_shown_to_friends: false, wishes_shown_to_friends: true, friend_shelves_informed_at: null });
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

// ---------------------------------------------------------------------------
// Modération : ce qu'elle masque ne se voit pas non plus sur les étagères.

const HIDDEN_AT = "2026-11-10T00:00:00+00:00";
const PRIVATE_COLLECTION = "c1000000-0000-4000-8000-000000000001";
const FRIENDS_COLLECTION = "c1000000-0000-4000-8000-000000000002";

/** Une collection d'Alice (masquée par la modération si `hidden`) qui contient `wishIds`. */
function aliceCollection(fake: ReturnType<typeof fakeSupabase>, id: string, visibility: "private" | "friends", hidden: boolean, wishIds: string[]) {
  fake.table("collections").push({
    id,
    user_id: ALICE,
    name: "Collection",
    visibility,
    visibility_changed_at: null,
    created_at: "2026-11-01T00:00:00+00:00",
    updated_at: "2026-11-01T00:00:00+00:00",
    hidden_at: hidden ? HIDDEN_AT : null,
  });
  wishIds.forEach((wishId, index) =>
    fake.table("collection_items").push({
      id: `c2000000-0000-4000-8000-${id.slice(-4)}${String(index).padStart(8, "0")}`,
      collection_id: id,
      wishlist_item_id: wishId,
      user_id: ALICE,
      created_at: "2026-11-01T00:00:00+00:00",
    })
  );
}

/** Une publication « achat » d'Alice qui montre la pièce `vaultItemId`. */
function purchasePost(fake: ReturnType<typeof fakeSupabase>, id: string, vaultItemId: string, hidden: boolean) {
  fake.table("posts").push({
    id,
    user_id: ALICE,
    type: "purchase",
    caption: null,
    media_url: OWN_PHOTO,
    privacy: "followers",
    vault_item_id: vaultItemId,
    wishlist_item_id: null,
    media_thumb_url: null,
    media_removed_at: null,
    hidden_at: hidden ? HIDDEN_AT : null,
    created_at: "2026-11-05T00:00:00+00:00",
  });
}

/** Seule la lecture de `table` avec `columns` échoue (les sondes, déjà passées, ne sont pas refaites). */
function breakSelect(fake: ReturnType<typeof fakeSupabase>, table: string, columns: (asked: string) => boolean): () => void {
  const original = fake.db.from;
  const broken = withBrokenTables(fake.db, [table]).from(table);
  (fake.db as { from: (name: string) => unknown }).from = (name: string) => {
    const query = original(name);
    if (name !== table) return query;
    return { ...query, select: (asked: string, ...rest: unknown[]) => (columns(asked) ? broken : (query.select as (...args: unknown[]) => unknown)(asked, ...rest)) };
  };
  return () => {
    (fake.db as { from: typeof original }).from = original;
  };
}

describe("Envies d'une collection masquée par la modération : jamais sur l'étagère des amis", () => {
  it("refusé : une envie d'une collection masquée (privée ou « Mes amis ») n'est pas montrée ; permis : les autres, et elle revient quand la modération rend une collection « Mes amis » (une collection privée la garde privée)", async () => {
    for (const visibility of ["private", "friends"] as const) {
      const fake = seeded();
      aliceCollection(fake, PRIVATE_COLLECTION, visibility, true, [WISH]);
      const target = await shelvesApp(fake.db);
      const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
      expect(page, visibility).toEqual({ items: [expect.objectContaining({ id: WISH_2 })], nextCursor: null });
      expect(JSON.stringify(page)).not.toContain("Sac cabas");
      // Rendue par la modération : l'envie revient… sauf d'une collection « Privée ».
      fake.table("collections").find((row) => row.id === PRIVATE_COLLECTION)!.hidden_at = null;
      const back = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
      expect(back.items.map((item) => item.id), visibility).toEqual(visibility === "friends" ? [WISH_2, WISH] : [WISH_2]);
      await target.close();
      app = null;
    }
  });

  it("refusé même si l'envie est aussi dans une collection « Mes amis » non masquée ; permis : une collection « Mes amis » non masquée ne retire rien", async () => {
    const fake = seeded();
    aliceCollection(fake, PRIVATE_COLLECTION, "friends", true, [WISH]);
    aliceCollection(fake, FRIENDS_COLLECTION, "friends", false, [WISH, WISH_2]);
    const target = await shelvesApp(fake.db);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage).items.map((item) => item.id)).toEqual([WISH_2]);
    fake.table("collections").find((row) => row.id === PRIVATE_COLLECTION)!.hidden_at = null;
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage).items.map((item) => item.id)).toEqual([WISH_2, WISH]);
  });

  it("pages : le rang ne laisse ni trou ni doublon, et rien ne dit que des envies sont masquées", async () => {
    const fake = seeded();
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const id = `e2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
      ids.push(id);
      fake.table("wishlist_items").push({ id, user_id: ALICE, title: `Envie ${i}`, image_url: THUMB, reference: null, price_min: null, currency: null, merchant_name: null, merchant_url: null, product_match_id: null, created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+00:00` });
    }
    // 32 envies, dont 5 masquées réparties sur les deux pages : 27 montrées.
    const hidden = [WISH, ids[29]!, ids[20]!, ids[3]!, ids[0]!];
    aliceCollection(fake, PRIVATE_COLLECTION, "friends", true, hidden);
    const target = await shelvesApp(fake.db);
    const first = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toBe("24");
    const second = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist?cursor=24`)).json() as FriendWishPage;
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(27);
    for (const id of hidden) expect(seen).not.toContain(id);
    // Au-delà de la fin : la même page vide qu'un ami qui n'a rien.
    expect((await as(target, BOB).get(`/api/users/${ALICE}/wishlist?cursor=27`)).json()).toEqual({ items: [], nextCursor: null });
  });

  it("lecture des collections masquées impossible : erreur, jamais une envie (et wishesOffFriendShelf ne répond jamais « aucune »)", async () => {
    const fake = seeded();
    aliceCollection(fake, PRIVATE_COLLECTION, "private", true, [WISH]);
    const target = await shelvesApp(fake.db);
    // Permis : les sondes passent, l'étagère répond.
    expect((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).statusCode).toBe(200);
    const restore = breakSelect(fake, "collections", (columns) => columns === "*");
    const res = await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    await expect(wishesOffFriendShelf({ supabaseAdmin: fake.db, log: { warn: () => {} } } as unknown as FastifyInstance, ALICE)).rejects.toBeInstanceOf(DatabaseReadError);
    restore();
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toMatch(/Sac cabas|Montre/);
    const restoreItems = breakSelect(fake, "collection_items", (columns) => columns === "id, collection_id, wishlist_item_id");
    const resItems = await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    restoreItems();
    expect(resItems.statusCode).toBe(500);
  });

  it("copies : celle d'une envie d'une collection privée masquée est effacée par la remise en ordre ; celle d'une collection « Mes amis » masquée reste (comme avant ce lot)", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect(new Set(fake.table("collection_image_copies").map((row) => row.wishlist_item_id))).toEqual(new Set([WISH, WISH_2]));
    const fastify = { supabaseAdmin: fake.db, log: { warn: () => {}, info: () => {}, error: () => {} } } as unknown as FastifyInstance;
    // Refusé : le sac est dans une collection privée masquée, plus rien ne le montre aux amis.
    aliceCollection(fake, PRIVATE_COLLECTION, "private", true, [WISH]);
    await syncFriendCopies(fastify, fastify.log, ALICE, [WISH, WISH_2]);
    expect(fake.table("collection_image_copies").map((row) => row.wishlist_item_id)).toEqual([WISH_2]);
    expect(fake.removed.filter((path) => path.startsWith(`post-media/${ALICE}/`))).toHaveLength(2);
    // Permis : la montre, dans une collection « Mes amis » masquée, garde sa
    // copie (la règle des collections, inchangée : elle resservira si la
    // modération rend la collection).
    aliceCollection(fake, FRIENDS_COLLECTION, "friends", true, [WISH_2]);
    await syncFriendCopies(fastify, fastify.log, ALICE, [WISH, WISH_2]);
    expect(fake.table("collection_image_copies").map((row) => row.wishlist_item_id)).toEqual([WISH_2]);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage).items).toEqual([]);
  });
});

describe("Vault : une pièce dont la publication « achat » est masquée par la modération", () => {
  const HIDDEN_POST = "a1000000-0000-4000-8000-000000000001";
  const SHOWN_POST = "a1000000-0000-4000-8000-000000000002";

  it("refusé : la pièce n'est pas sur l'étagère tant que la publication reste masquée ; permis : elle revient quand la modération la rend", async () => {
    const fake = seeded();
    purchasePost(fake, HIDDEN_POST, VAULT_PHOTO, true);
    const target = await shelvesApp(fake.db);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/vault`)).json() as FriendVaultPage;
    expect(page).toEqual({ items: [expect.objectContaining({ id: VAULT_MATCH })], nextCursor: null });
    expect(JSON.stringify(page)).not.toContain(OWN_PHOTO);
    fake.table("posts").find((row) => row.id === HIDDEN_POST)!.hidden_at = null;
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/vault`)).json() as FriendVaultPage).items.map((item) => item.id)).toEqual([VAULT_MATCH, VAULT_PHOTO]);
  });

  it("permis : une publication non masquée ne retire rien ; refusé : une seule publication masquée suffit, même si une autre est visible", async () => {
    const fake = seeded();
    purchasePost(fake, SHOWN_POST, VAULT_PHOTO, false);
    const target = await shelvesApp(fake.db);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/vault`)).json() as FriendVaultPage).items).toHaveLength(2);
    purchasePost(fake, HIDDEN_POST, VAULT_PHOTO, true);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/vault`)).json() as FriendVaultPage).items.map((item) => item.id)).toEqual([VAULT_MATCH]);
  });

  it("pages : le rang ne laisse ni trou ni doublon", async () => {
    const fake = seeded();
    for (let i = 0; i < 30; i += 1) {
      fake.table("vault_items").push({ id: `f2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, user_id: ALICE, title: `Pièce ${i}`, image_url: OWN_PHOTO, category: "clothing", verified: false, product_match_id: null, affiliate_conversion_id: null, created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+00:00` });
    }
    purchasePost(fake, HIDDEN_POST, VAULT_PHOTO, true);
    purchasePost(fake, SHOWN_POST, "f2000000-0000-4000-8000-000000000029", true);
    const target = await shelvesApp(fake.db);
    const first = (await as(target, BOB).get(`/api/users/${ALICE}/vault`)).json() as FriendVaultPage;
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toBe("24");
    const second = (await as(target, BOB).get(`/api/users/${ALICE}/vault?cursor=24`)).json() as FriendVaultPage;
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect(seen).not.toContain(VAULT_PHOTO);
    expect(seen).not.toContain("f2000000-0000-4000-8000-000000000029");
  });

  it("lecture des publications impossible : erreur, jamais une pièce (et vaultPiecesInHiddenPosts ne répond jamais « aucune »)", async () => {
    const fake = seeded();
    purchasePost(fake, HIDDEN_POST, VAULT_PHOTO, true);
    const db = withBrokenTables(fake.db, ["posts"]);
    await expect(vaultPiecesInHiddenPosts({ supabaseAdmin: db } as unknown as FastifyInstance, ALICE)).rejects.toBeInstanceOf(DatabaseReadError);
    const target = await shelvesApp(db);
    const res = await as(target, BOB).get(`/api/users/${ALICE}/vault`);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toMatch(/Veste|Sac cabas/);
    // Permis : la même base, publications lisibles.
    expect(await vaultPiecesInHiddenPosts({ supabaseAdmin: fake.db } as unknown as FastifyInstance, ALICE)).toEqual([VAULT_PHOTO]);
  });
});

// ---------------------------------------------------------------------------
// Refonte (décisions du fondateur, 25 novembre) : « Privée » reste privée, et
// un ami voit tout le reste, en lecture seule.

describe("« Privée » reste privée : une envie d'une collection privée n'est jamais sur l'étagère", () => {
  it("refusé : l'envie d'une collection « Privée » (non masquée) est absente, et le nom de la collection n'apparaît nulle part ; permis : les autres", async () => {
    await withImages();
    const fake = seeded();
    aliceCollection(fake, PRIVATE_COLLECTION, "private", false, [WISH]);
    fake.table("collections").find((row) => row.id === PRIVATE_COLLECTION)!.name = "Cadeaux secrets";
    const target = await shelvesApp(fake.db);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items.map((item) => item.id)).toEqual([WISH_2]);
    const text = JSON.stringify(page);
    expect(text).not.toContain("Sac cabas");
    expect(text).not.toContain("Cadeaux secrets");
    // Aucune copie faite pour l'envie privée.
    expect(fake.table("collection_image_copies").map((row) => row.wishlist_item_id)).toEqual([WISH_2]);
  });

  it("permis : l'envie aussi rangée dans une collection « Mes amis » reste visible par cette collection (règle des collections), pas sur l'étagère", async () => {
    const fake = seeded();
    aliceCollection(fake, PRIVATE_COLLECTION, "private", false, [WISH]);
    aliceCollection(fake, FRIENDS_COLLECTION, "friends", false, [WISH]);
    const target = await shelvesApp(fake.db);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items.map((item) => item.id)).toEqual([WISH_2]);
    const shared = await as(target, BOB).get(`/api/collections/${FRIENDS_COLLECTION}/shared`);
    expect(shared.statusCode).toBe(200);
    expect(JSON.stringify(shared.json())).toContain("Sac cabas");
  });

  it("ranger une envie dans une collection privée la retire de l'étagère et efface sa copie (remise en ordre existante) ; la sortir la remet", async () => {
    await withImages();
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    const alice = as(target, ALICE);
    await as(target, BOB).get(`/api/users/${ALICE}/wishlist`);
    expect(new Set(fake.table("collection_image_copies").map((row) => row.wishlist_item_id))).toEqual(new Set([WISH, WISH_2]));
    const created = await alice.post("/api/collections", { name: "Rien que pour moi" });
    expect(created.statusCode).toBe(201);
    // Une nouvelle collection est « Privée » au départ (inchangé).
    expect(created.json().visibility).toBe("private");
    expect((await alice.put(`/api/wishlist/${WISH}/collections`, { collectionIds: [created.json().id] })).statusCode).toBe(200);
    expect(fake.table("collection_image_copies").map((row) => row.wishlist_item_id)).toEqual([WISH_2]);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage).items.map((item) => item.id)).toEqual([WISH_2]);
    expect((await alice.put(`/api/wishlist/${WISH}/collections`, { collectionIds: [] })).statusCode).toBe(200);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage).items.map((item) => item.id)).toEqual([WISH_2, WISH]);
  });

  it("pages : des envies privées réparties sur les deux pages ne laissent ni trou ni doublon", async () => {
    const fake = seeded();
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const id = `e2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
      ids.push(id);
      fake.table("wishlist_items").push({ id, user_id: ALICE, title: `Envie ${i}`, image_url: THUMB, reference: null, price_min: null, currency: null, merchant_name: null, merchant_url: null, product_match_id: null, created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+00:00` });
    }
    const privateIds = [WISH_2, ids[28]!, ids[15]!, ids[2]!];
    aliceCollection(fake, PRIVATE_COLLECTION, "private", false, privateIds);
    const target = await shelvesApp(fake.db);
    const first = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toBe("24");
    const second = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist?cursor=24`)).json() as FriendWishPage;
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(28);
    for (const id of privateIds) expect(seen).not.toContain(id);
    // Toujours les plus récentes d'abord.
    expect(seen[0]).toBe(WISH);
    expect(seen[1]).toBe(ids[29]);
  });

  it("au-delà de « Max rows » de Supabase : l'ordre est lu en entier, jamais tronqué", async () => {
    const fake = seeded({}, { maxRows: 10 });
    for (let i = 0; i < 30; i += 1) {
      fake.table("wishlist_items").push({ id: `e2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, user_id: ALICE, title: `Envie ${i}`, image_url: THUMB, reference: null, price_min: null, currency: null, merchant_name: null, merchant_url: null, product_match_id: null, created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+00:00` });
    }
    const target = await shelvesApp(fake.db);
    const second = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist?cursor=24`)).json() as FriendWishPage;
    expect(second.items).toHaveLength(8);
  });
});

describe("un ami voit tout le reste : collections « Mes amis », alerte de prix", () => {
  const ALERTS_READY: FakeDbOptions = { rpc: async (fn) => (fn === "wish_alerts_version" ? { data: 3, error: null } : { data: null, error: { code: "PGRST202", message: "absente" } }) };

  it("permis : le nom des collections « Mes amis » où l'envie est rangée ; refusé : le nom d'une collection masquée ou privée", async () => {
    const fake = seeded();
    aliceCollection(fake, FRIENDS_COLLECTION, "friends", false, [WISH]);
    fake.table("collections").find((row) => row.id === FRIENDS_COLLECTION)!.name = "Pour l'hiver";
    const HIDDEN_FRIENDS = "c1000000-0000-4000-8000-000000000003";
    aliceCollection(fake, HIDDEN_FRIENDS, "friends", true, [WISH_2]);
    fake.table("collections").find((row) => row.id === HIDDEN_FRIENDS)!.name = "Masquée";
    const target = await shelvesApp(fake.db);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items.map((item) => [item.id, item.collections])).toEqual([[WISH, ["Pour l'hiver"]]]);
    expect(JSON.stringify(page)).not.toContain("Masquée");
  });

  it("permis : l'alerte de prix allumée, avec son seuil ; refusé : une cloche sans alerte de prix, et les nouvelles d'alerte", async () => {
    const fake = seeded({}, ALERTS_READY);
    fake.table("wish_watches").push(
      { wishlist_item_id: WISH, user_id: ALICE, notify_price_drop: true, notify_restock: false, notify_sold_out: false, target_price: "99.00", target_currency: "EUR", target_country: "fr", below_target: false },
      { wishlist_item_id: WISH_2, user_id: ALICE, notify_price_drop: false, notify_restock: true, notify_sold_out: false, target_price: null, target_currency: null, target_country: null, below_target: false }
    );
    fake.table("wish_alert_events").push({ id: UNKNOWN, wishlist_item_id: WISH, user_id: ALICE, kind: "price_drop", old_price: "129.00", new_price: "89.00", currency: "EUR", created_on: "2026-11-20", status: "sent" });
    const target = await shelvesApp(fake.db);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items.find((item) => item.id === WISH)!.priceAlert).toEqual({ targetPrice: 99, targetCurrency: "EUR" });
    expect("priceAlert" in page.items.find((item) => item.id === WISH_2)!).toBe(false);
    const text = JSON.stringify(page);
    for (const secret of ["89", "restock", "soldOut", "price_drop", "fr\"", "below"]) expect(text, secret).not.toContain(secret);
  });

  it("alerte allumée sans seuil : allumée, seuil vide ; alertes indisponibles (0041 absente) : aucune alerte annoncée", async () => {
    const watch = { wishlist_item_id: WISH, user_id: ALICE, notify_price_drop: true, notify_restock: false, notify_sold_out: false, target_price: null, target_currency: null, target_country: null, below_target: false };
    const ready = seeded({}, ALERTS_READY);
    ready.table("wish_watches").push({ ...watch });
    const target = await shelvesApp(ready.db);
    expect(((await as(target, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage).items.find((item) => item.id === WISH)!.priceAlert).toEqual({ targetPrice: null, targetCurrency: null });
    await target.close();
    app = null;
    resetWishAlertsProbe();
    const absent = seeded();
    absent.table("wish_watches").push({ ...watch });
    const without = await shelvesApp(absent.db);
    const page = (await as(without, BOB).get(`/api/users/${ALICE}/wishlist`)).json() as FriendWishPage;
    expect(page.items.every((item) => !("priceAlert" in item))).toBe(true);
  });

  it("refusé : l'alerte, les collections, la date et « Achat vérifié » n'apparaissent dans aucune autre réponse (profil, publications, visiteur refusé)", async () => {
    const fake = seeded({}, ALERTS_READY);
    aliceCollection(fake, FRIENDS_COLLECTION, "friends", false, [WISH]);
    fake.table("wish_watches").push({ wishlist_item_id: WISH, user_id: ALICE, notify_price_drop: true, notify_restock: false, notify_sold_out: false, target_price: "99.00", target_currency: "EUR", target_country: "fr", below_target: false });
    const target = await shelvesApp(fake.db);
    for (const url of [`/api/users/${ALICE}`, `/api/users/${ALICE}/posts`]) {
      const text = (await as(target, BOB).get(url)).body;
      for (const secret of ["priceAlert", "targetPrice", "verified", "2026-11-03", "2026-11-04"]) expect(text, `${url} ${secret}`).not.toContain(secret);
    }
    for (const viewer of [CHLOE, DAN, EVE]) {
      const seen = await whatSees(target, viewer);
      expect(JSON.stringify([seen.wishes, seen.vault])).toBe(JSON.stringify([{ items: [], nextCursor: null }, { items: [], nextCursor: null }]));
    }
  });

  it("refusé : les pièces reçues et les publications enregistrées ne sont jamais renvoyées", async () => {
    const fake = seeded();
    fake.table("piece_sends").push({ id: UNKNOWN, sender_id: BOB, recipient_id: ALICE, title: "Pièce reçue de Bob", created_at: "2026-11-06T00:00:00+00:00" });
    fake.table("saved_posts").push({ user_id: ALICE, post_id: UNKNOWN, created_at: "2026-11-06T00:00:00+00:00" });
    const target = await shelvesApp(fake.db);
    const seen = await whatSees(target, BOB);
    const text = JSON.stringify([seen.wishes, seen.vault]);
    expect(text).not.toContain("Pièce reçue de Bob");
    expect(text).not.toContain(UNKNOWN);
    expect(seen.wishes.items.map((item) => item.id).sort()).toEqual([WISH, WISH_2].sort());
  });

  it("vieille app : aucun champ nouveau n'est exigé (le réglage s'enregistre sans « informé », la page reste lisible sans les champs ajoutés)", async () => {
    const fake = seeded();
    const target = await shelvesApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/friend-shelves", { wishes: false })).statusCode).toBe(204);
    expect((await as(target, ALICE).put("/api/me/friend-shelves", { wishes: true })).statusCode).toBe(204);
    const page = (await as(target, BOB).get(`/api/users/${ALICE}/vault`)).json() as FriendVaultPage;
    // Les champs qu'une app d'avant la refonte lit sont toujours là.
    for (const item of page.items) for (const key of ["id", "title", "category", "imageUrl", "imageHdUrl"]) expect(key in item).toBe(true);
  });
});
