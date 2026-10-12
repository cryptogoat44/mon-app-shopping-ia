import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import type { AppNotification, Post, ReceivedPiece, WishlistItemDetail } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { downloadPublicImage, PublicImageError } from "../src/lib/publicImage.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 5, section 5.C : partage d'une envie. Les envies restent privées ; le
// partage est un geste volontaire : republier sur son profil (publication
// « envie », jamais un achat), envoyer à une personne (réglage « Qui peut
// m'envoyer des pièces », blocages, suspension, débit, signalement). L'image
// montrée est toujours une copie dans notre stockage, jamais l'adresse
// d'origine (« comme Instagram »). Le téléchargement est simulé : aucun site
// extérieur n'est appelé.
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const downloadMock = vi.mocked(downloadPublicImage);

const ORIGINAL_IMAGE = "https://images.example-shop.test/sac-kelly.jpg";
const OUR_STORAGE = `${env.SUPABASE_URL}/storage/v1/object/public/post-media/`;

describe("partage d'une envie", () => {
  let app: FastifyInstance;
  let owner: TestUser; // a l'envie et la partage
  let friend: TestUser; // suit `owner`
  let stranger: TestUser; // ne suit personne
  let admin: TestUser;
  let photo: Buffer;
  let wishId = "";
  let matchId = "";

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), payload });
  const received = async (user: TestUser): Promise<ReceivedPiece[]> => (await request(user, "GET", "/api/pieces/received")).json().pieces;
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const send = (from: TestUser, to: TestUser, id = wishId) => request(from, "POST", `/api/wishlist/${id}/send`, { recipientId: to.id });
  const setPieceSendsFrom = async (user: TestUser, value: string) =>
    expect((await request(user, "PUT", "/api/me/piece-sends-from", { pieceSendsFrom: value })).statusCode).toBe(204);
  const storageFiles = async (userId: string): Promise<string[]> =>
    ((await app.supabaseAdmin.storage.from("post-media").list(userId, { limit: 1000 })).data ?? []).map((f) => f.name);
  const fileName = (url: string) => url.split("/").pop()!;

  async function createWish(user: TestUser, title: string, productMatchId: string | null = null): Promise<string> {
    const res = await request(user, "POST", "/api/wishlist", {
      title,
      imageUrl: ORIGINAL_IMAGE,
      merchantName: "Boutique test",
      merchantUrl: "https://example-shop.test/sac",
      priceMin: 120,
      currency: "EUR",
      productMatchId,
    });
    expect(res.statusCode).toBe(200);
    return res.json().id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [owner, friend, stranger, admin] = await Promise.all([
      createTestUser(app, "wso"),
      createTestUser(app, "wsf"),
      createTestUser(app, "wss"),
      createTestUser(app, "wsa"),
    ]);
    photo = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#876" } }).jpeg().toBuffer();
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    expect((await request(friend, "POST", `/api/follows/${owner.id}`)).statusCode).toBe(204);

    // Résultat d'une recherche de `owner` avec un lien affilié (inséré directement : aucun appel SerpApi).
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_url: "https://www.tiktok.com/@x/video/2", source_platform: "tiktok", method: "oembed", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Sac Kelly", image_url: ORIGINAL_IMAGE, merchant_url: "https://example-shop.test/sac" })
      .select("id")
      .single();
    matchId = match!.id;
    await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: matchId, network: "direct", affiliate_url: "https://example-shop.test/sac?aff=spotto" });
    wishId = await createWish(owner, "Sac Kelly", matchId);
  });

  beforeEach(() => {
    downloadMock.mockReset();
    downloadMock.mockResolvedValue(photo);
  });

  afterAll(async () => {
    for (const user of [owner, friend, stranger, admin]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("par défaut, une envie reste privée : rien dans le fil, ni sur le profil, ni dans « Reçues »", async () => {
    expect((await request(friend, "GET", "/api/feed")).json().posts).toEqual([]);
    expect((await request(friend, "GET", `/api/users/${owner.id}/posts`)).json().posts).toEqual([]);
    expect(await received(friend)).toEqual([]);
    expect((await request(owner, "GET", "/api/me")).json().pieceSendsFrom).toBe("following");
    expect((await request(friend, "GET", `/api/wishlist/${wishId}`)).statusCode).toBe(404);
  });

  it("republier : une publication « envie » (jamais un achat ni un badge), avec la copie de l'image, la confidentialité choisie", async () => {
    const res = await request(owner, "POST", `/api/wishlist/${wishId}/republish`, { privacy: "followers" });
    expect(res.statusCode).toBe(200);
    const post: Post = res.json();
    expect(post).toMatchObject({ type: "wish", privacy: "followers", vaultItem: null, caption: null });
    expect(post.wish).toMatchObject({ title: "Sac Kelly", merchantName: "Boutique test", priceMin: 120, isAffiliate: true });
    expect(post.wish!.merchantUrl).toBe("https://example-shop.test/sac?aff=spotto");
    // Jamais l'adresse d'origine : une copie dans notre stockage, dans le dossier de l'auteur.
    expect(post.mediaUrl.startsWith(`${OUR_STORAGE}${owner.id}/`)).toBe(true);
    expect(post.mediaThumbUrl!.startsWith(`${OUR_STORAGE}${owner.id}/`)).toBe(true);
    expect(JSON.stringify(post)).not.toContain(ORIGINAL_IMAGE);
    expect(downloadMock).toHaveBeenCalledWith(ORIGINAL_IMAGE);
    expect(await storageFiles(owner.id)).toEqual(expect.arrayContaining([fileName(post.mediaUrl), fileName(post.mediaThumbUrl!)]));

    // Visible des abonnés (fil, profil, détail), jamais des autres.
    expect((await request(friend, "GET", "/api/feed")).json().posts.map((p: Post) => p.id)).toContain(post.id);
    expect((await request(stranger, "GET", `/api/posts/${post.id}`)).statusCode).toBe(404);
    expect((await request(stranger, "GET", `/api/users/${owner.id}/posts`)).json().posts).toEqual([]);

    // Détail de l'envie : l'état du partage.
    const detail: WishlistItemDetail = (await request(owner, "GET", `/api/wishlist/${wishId}`)).json();
    expect(detail.sharedPost).toMatchObject({ id: post.id, privacy: "followers" });

    // Une seule à la fois ; jamais par la route générique des publications.
    expect((await request(owner, "POST", `/api/wishlist/${wishId}/republish`, { privacy: "public" })).statusCode).toBe(409);
    const generic = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { ...authHeaders(owner.token), "content-type": "multipart/form-data; boundary=x" },
      payload: '--x\r\nContent-Disposition: form-data; name="type"\r\n\r\nwish\r\n--x--\r\n',
    });
    expect(generic.statusCode).toBe(400);

    // Le lien marchand d'une publication « envie » visible est suivi (clic enregistré).
    expect((await request(friend, "POST", `/api/product-matches/${matchId}/click`, { context: "post" })).statusCode).toBe(200);
    expect((await request(stranger, "POST", `/api/product-matches/${matchId}/click`, { context: "post" })).statusCode).toBe(404);
  });

  it("image irrécupérable : rien n'est publié ni envoyé (comme une publication Instagram refusée)", async () => {
    downloadMock.mockRejectedValue(new PublicImageError("Adresse interne refusée"));
    const other = await createWish(owner, "Mocassins");
    const republish = await request(owner, "POST", `/api/wishlist/${other}/republish`, { privacy: "public" });
    expect(republish.statusCode).toBe(422);
    expect(republish.json().error).toBe("wish_image_unavailable");
    // `friend` suit `owner` (il accepte donc ses pièces) : l'envoi échoue sur l'image.
    expect((await send(owner, friend, other)).statusCode).toBe(422);
    expect(await received(friend)).toEqual([]);
    expect((await request(owner, "GET", `/api/wishlist/${other}`)).json().sharedPost).toBeNull();
  });

  it("envoyer : refusé par défaut si la personne ne vous suit pas ; accepté si elle vous suit ; elle est notifiée", async () => {
    // `owner` ne suit pas `friend` : `friend` → `owner` refusé (réglage par défaut de `owner`).
    const friendWish = await createWish(friend, "Écharpe");
    const refused = await send(friend, owner, friendWish);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("recipient_not_accepting");
    expect(downloadMock).not.toHaveBeenCalled();

    // `friend` suit `owner` : `owner` → `friend` accepté.
    const res = await send(owner, friend);
    expect(res.statusCode).toBe(201);
    const pieces = await received(friend);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      id: res.json().id,
      title: "Sac Kelly",
      sender: { id: owner.id },
      merchantName: "Boutique test",
      merchantUrl: "https://example-shop.test/sac?aff=spotto",
      isAffiliate: true,
      priceMin: 120,
    });
    expect(pieces[0]!.imageUrl.startsWith(`${OUR_STORAGE}${owner.id}/`)).toBe(true);
    expect(JSON.stringify(pieces)).not.toContain(ORIGINAL_IMAGE);
    expect((await notifications(friend)).find((n) => n.type === "piece_received")).toMatchObject({ actor: { id: owner.id } });

    // Le lien marchand d'une pièce reçue est suivi ; jamais pour qui ne l'a pas reçue.
    expect((await request(friend, "POST", `/api/product-matches/${matchId}/click`, { context: "received" })).statusCode).toBe(200);
    expect((await request(stranger, "POST", `/api/product-matches/${matchId}/click`, { context: "received" })).statusCode).toBe(404);
  });

  it("réglage « Qui peut m'envoyer des pièces » : tout le monde, ou personne", async () => {
    expect((await send(owner, stranger)).statusCode).toBe(403);
    await setPieceSendsFrom(stranger, "everyone");
    expect((await request(stranger, "GET", "/api/me")).json().pieceSendsFrom).toBe("everyone");
    expect((await send(owner, stranger)).statusCode).toBe(201);
    // `stranger` ne voit pas la publication « envie » (abonnés seulement) : le clic passe par la pièce reçue.
    expect((await request(stranger, "POST", `/api/product-matches/${matchId}/click`, { context: "received" })).statusCode).toBe(200);
    await setPieceSendsFrom(stranger, "nobody");
    expect((await send(owner, stranger)).statusCode).toBe(403);
    expect((await request(stranger, "PUT", "/api/me/piece-sends-from", { pieceSendsFrom: "personne" })).statusCode).toBe(400);
    expect((await send(owner, owner)).statusCode).toBe(400);
    const otherWish = await createWish(friend, "Pas à moi");
    expect((await send(owner, stranger, otherWish)).statusCode).toBe(404); // l'envie d'un autre
  });

  it("blocage : envoi impossible dans les deux sens, et les pièces déjà reçues disparaissent", async () => {
    await setPieceSendsFrom(stranger, "everyone");
    expect((await request(stranger, "POST", `/api/blocks/${owner.id}`)).statusCode).toBe(204);
    expect((await send(owner, stranger)).json().error).toBe("recipient_not_found");
    expect(await received(stranger)).toEqual([]);
    expect((await request(stranger, "DELETE", `/api/blocks/${owner.id}`)).statusCode).toBe(204);
    expect(await received(stranger)).toHaveLength(1);
  });

  it("signaler une pièce reçue ; la modération la masque (chez la personne, avec sa notification) puis la rétablit", async () => {
    const piece = (await received(friend))[0]!;
    expect((await request(friend, "POST", "/api/reports", { targetType: "piece", targetId: piece.id, reason: "inappropriate" })).statusCode).toBe(204);

    const queue = (await request(admin, "GET", "/api/admin/moderation?status=open")).json();
    const item = queue.items.find((i: { targetId: string }) => i.targetId === piece.id);
    expect(item.preview).toMatchObject({ kind: "piece", title: "Sac Kelly", author: { id: owner.id }, hidden: false });
    expect(JSON.stringify(item)).not.toContain(friend.id); // jamais qui a signalé

    const decision = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "piece", targetId: piece.id, action: "hide", reason: "inappropriate" });
    expect(decision.statusCode).toBe(200);
    expect(await received(friend)).toEqual([]);
    expect((await notifications(friend)).some((n) => n.type === "piece_received")).toBe(false);
    expect((await notifications(owner)).find((n) => n.type === "moderation")?.moderation).toMatchObject({ action: "hide", targetType: "piece" });
    expect((await notifications(friend)).find((n) => n.type === "report_handled")?.reportedType).toBe("piece");

    expect((await request(admin, "POST", `/api/admin/moderation/actions/${decision.json().actionId}/undo`, {})).statusCode).toBe(200);
    expect(await received(friend)).toHaveLength(1);
  });

  it("compte suspendu : ni republier, ni envoyer", async () => {
    expect((await request(friend, "POST", "/api/reports", { targetType: "user", targetId: owner.id, reason: "spam" })).statusCode).toBe(204);
    const suspension = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "user", targetId: owner.id, action: "suspend", reason: "spam" });
    expect(suspension.statusCode).toBe(200);
    const other = await createWish(owner, "Ceinture");
    expect((await request(owner, "POST", `/api/wishlist/${other}/republish`, { privacy: "public" })).json().error).toBe("account_suspended");
    expect((await send(owner, friend, other)).json().error).toBe("account_suspended");
    expect(downloadMock).not.toHaveBeenCalled();
    expect((await request(admin, "POST", `/api/admin/moderation/actions/${suspension.json().actionId}/undo`, {})).statusCode).toBe(200);
  });

  it("retirer une pièce reçue : elle disparaît avec la copie de son image ; seule la personne qui l'a reçue peut le faire", async () => {
    const piece = (await received(friend))[0]!;
    expect((await request(stranger, "DELETE", `/api/pieces/received/${piece.id}`)).statusCode).toBe(404);
    expect((await request(friend, "DELETE", `/api/pieces/received/${piece.id}`)).statusCode).toBe(204);
    expect(await received(friend)).toEqual([]);
    expect(await storageFiles(owner.id)).not.toContain(fileName(piece.imageUrl));
  });

  it("limite de débit : 20 envois par heure au plus", async () => {
    // Un compte neuf (compteur à zéro) ; `stranger` refuse tout : aucune copie d'image, mais chaque envoi compte.
    const sender = await createTestUser(app, "wsl");
    try {
      await setPieceSendsFrom(stranger, "nobody");
      const wish = await createWish(sender, "Lunettes");
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await send(sender, stranger, wish)).statusCode);
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(403));
      expect(statuses[20]).toBe(429);
    } finally {
      await deleteTestUser(app, sender.id);
    }
  });

  it("export RGPD : pièces envoyées et reçues, réglage ; retirer l'envie supprime sa publication et sa copie", async () => {
    const exported = (await request(owner, "GET", "/api/me/export")).json();
    expect(exported.piecesSent.length).toBeGreaterThanOrEqual(1);
    expect(exported.profile.piece_sends_from).toBe("following");
    expect((await request(stranger, "GET", "/api/me/export")).json().piecesReceived).toHaveLength(1);

    const detail: WishlistItemDetail = (await request(owner, "GET", `/api/wishlist/${wishId}`)).json();
    const post: Post = (await request(owner, "GET", `/api/posts/${detail.sharedPost!.id}`)).json();
    expect((await request(owner, "DELETE", `/api/wishlist/${wishId}`)).statusCode).toBe(204);
    expect((await request(owner, "GET", `/api/posts/${post.id}`)).statusCode).toBe(404);
    expect(await storageFiles(owner.id)).not.toContain(fileName(post.mediaUrl));
  });

  it("suppression du compte qui a reçu une pièce : la copie de son image est supprimée aussi", async () => {
    const piece = (await received(stranger))[0]!;
    expect(await storageFiles(owner.id)).toContain(fileName(piece.imageUrl));
    expect((await request(stranger, "DELETE", "/api/me")).statusCode).toBe(204);
    expect(await storageFiles(owner.id)).not.toContain(fileName(piece.imageUrl));
  });
});
