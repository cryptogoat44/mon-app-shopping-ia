import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import {
  ACCOUNT_DELETION_WORDS,
  CONSENT_VERSIONS,
  type AppNotification,
  type ModerationPage,
  type Post,
  type ReceivedPiece,
} from "@monapp/shared-types";

// Parcours complet (point 23 de la feuille de route V1) : UNE personne, de
// l'inscription à la suppression de son compte, et à chaque étape la preuve
// que le serveur fait ce qu'il promet. Personnes : A (le parcours), B (une
// autre personne : fil, commentaire, signalement, blocage) et une
// administratrice (file de modération).
//
// À lancer sur le Mac, contre spotto-dev-2 (jamais la production : le fichier
// le revérifie lui-même avant toute requête, en plus de test:ci). Aucun appel
// payant : recherche visuelle, Google Shopping, IA et téléchargements
// extérieurs sont simulés, comme dans spotterFlow.test.ts et
// wishSharing.test.ts ; la garde des tests (setup/noPaidCalls.ts) refuse de
// toute façon serpapi.com et anthropic.com. Le stockage et la base sont réels.
// Les étapes se suivent et partagent leur état : si l'une échoue, les
// suivantes sont sautées (au lieu d'échouer en cascade). Les comptes et leurs
// fichiers sont TOUJOURS effacés à la fin, même en cas d'échec.
vi.mock("../src/services/visualSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/visualSearch.js")>();
  return { ...original, searchProductsByImageUrl: vi.fn() };
});
vi.mock("../src/services/oembed.js", () => ({
  detectPlatform: () => "tiktok",
  fetchOfficialPreview: vi.fn(async () => ({ ok: true, thumbnailUrl: "https://p16-common-sign.tiktokcdn-eu.com/vignette.jpeg" })),
}));
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn(), searchCapacityBeforeComplementAi: vi.fn() };
});
vi.mock("../src/lib/imageProcessing.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/imageProcessing.js")>();
  return { ...original, downloadThumbnail: vi.fn() };
});
// Voie C et IA coupées, quel que soit le .env du Mac : le chemin d'une photo
// importée est alors Lens seul (simulé ci-dessus).
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false } };
});
vi.mock("../src/services/serpapi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/serpapi.js")>();
  return { ...original, callShopping: vi.fn(), serpApiTextProvider: { name: "serpapi", searchByText: vi.fn() } };
});
vi.mock("../src/services/shoppingQueryAi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/shoppingQueryAi.js")>();
  return { ...original, askShoppingQuery: vi.fn() };
});
// Copie de l'image d'une envie partagée : téléchargement simulé (aucun site extérieur).
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});

import { searchProductsByImageUrl, type VisualMatch, type VisualSearchResult } from "../src/services/visualSearch.js";
import { releaseReservation, reserveSearch } from "../src/lib/searchCapacity.js";
import { downloadPublicImage } from "../src/lib/publicImage.js";
import { env } from "../src/env.js";
import { USER_STORAGE_BUCKETS } from "../src/lib/storage.js";
import { assertDevSupabaseUrl } from "../scripts/lib/dev-database.js";
import { migration0029Applied } from "./migration0029.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const searchMock = vi.mocked(searchProductsByImageUrl);
const reserveMock = vi.mocked(reserveSearch);
const releaseMock = vi.mocked(releaseReservation);
const downloadMock = vi.mocked(downloadPublicImage);

// Photo importée dans le Spotter : 400 × 600, comme dans spotterFlow.test.ts.
const IMAGE = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#6b4a3a" } }).jpeg().toBuffer();
// Photo de profil, du Vault, de la publication, et image « téléchargée » d'une envie.
const PHOTO = await sharp({ create: { width: 60, height: 80, channels: 3, background: "#456" } }).jpeg().toBuffer();
const OUR_STORAGE = `${env.SUPABASE_URL}/storage/v1/object/public/post-media/`;

const VESTE: VisualMatch = {
  rank: 1,
  productName: "Veste en daim marron",
  imageUrl: "https://encrypted-tbn.example/veste.jpg",
  imageHdUrl: "https://marchand.example/veste-hd.jpg",
  merchantName: "Marchand",
  merchantUrl: "https://marchand.example/veste",
  priceValue: 190,
  currency: "€",
};
const SAC: VisualMatch = {
  rank: 2,
  productName: "Sac en cuir camel",
  imageUrl: "https://encrypted-tbn.example/sac.jpg",
  imageHdUrl: "https://marchand.example/sac-hd.jpg",
  merchantName: "Marchand",
  merchantUrl: "https://marchand.example/sac",
  priceValue: 240,
  currency: "€",
};

/** Ce que rend la recherche visuelle simulée (même forme que spotterFlow.test.ts). */
function found(matches: VisualMatch[]): VisualSearchResult {
  return {
    matches,
    measure: {
      received: matches.length,
      removedIncomplete: 0,
      removedSocial: 0,
      removedProfessional: 0,
      removedDuplicates: 0,
      kept: matches.length,
      keptWithPrice: matches.filter((m) => m.priceValue !== null).length,
      keptOtherCurrency: 0,
      distinctSites: matches.length,
      sections: ["visual_matches"],
      googleState: null,
    },
    addedRanks: [],
    statusCode: 200,
  };
}

// Données privées de B : elles ne doivent jamais apparaître dans l'export de A.
const B_SECRET_WISH = "Envie privée de B, jamais exportée chez A";
const B_REPORT_NOTE = "Note du signalement de B, jamais exportée chez A";

describe.sequential("parcours complet : de l'inscription à la suppression du compte", () => {
  let app: FastifyInstance;
  let a: TestUser; // la personne suivie tout du long
  let b: TestUser; // une autre personne
  let admin: TestUser; // administratrice (table « admins »)

  // État du scénario, rempli d'étape en étape.
  let searchId = "";
  let vesteMatchId = "";
  let sacMatchId = "";
  let vaultFromMatchId = "";
  let vaultManualId = "";
  let wishId = "";
  let wishPostId = "";
  let lifestylePostId = "";
  let aReplyId = "";
  let pieceId = "";
  const bCommentIds: string[] = [];

  // Une étape échouée arrête le scénario : les suivantes sont sautées.
  let stoppedAt: string | null = null;
  function step(title: string, run: () => Promise<void>, timeout = 60_000) {
    it(
      title,
      async (context) => {
        if (stoppedAt) context.skip();
        try {
          await run();
        } catch (error) {
          stoppedAt = title;
          throw error;
        }
      },
      timeout
    );
  }

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...authHeaders(user.token), ...headers }, payload });
  const upload = (user: TestUser, url: string, fields: Record<string, string>, file?: Buffer) => {
    const mp = buildMultipart(fields, file ? { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: file } : undefined);
    return request(user, "POST", url, mp.payload, mp.headers);
  };
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const fromActor = async (user: TestUser, actor: TestUser) => (await notifications(user)).filter((n) => n.actor?.id === actor.id);
  const feed = async (user: TestUser): Promise<Post[]> => {
    const res = await request(user, "GET", "/api/feed");
    expect(res.statusCode).toBe(200);
    return res.json().posts;
  };
  const received = async (user: TestUser): Promise<ReceivedPiece[]> => (await request(user, "GET", "/api/pieces/received")).json().pieces;
  const foundInSearch = async (viewer: TestUser, target: TestUser) =>
    ((await request(viewer, "GET", `/api/users/search?q=${encodeURIComponent(target.username)}`)).json() as { id: string }[]).some((p) => p.id === target.id);
  async function storageFiles(bucket: string, folder: string): Promise<string[]> {
    const { data, error } = await app.supabaseAdmin.storage.from(bucket).list(folder, { limit: 1000 });
    expect(error).toBeNull();
    return (data ?? []).map((file) => file.name);
  }
  async function analysisImageExists(id: string): Promise<boolean> {
    const { data } = await app.supabaseAdmin.storage.from("screenshots").list("analyses", { search: id });
    return (data ?? []).some((file) => file.name === `${id}.jpg`);
  }

  beforeAll(async () => {
    // Jamais la production : refus avant toute requête si la base n'est pas
    // spotto-dev-2 (le message ne recopie jamais l'adresse).
    assertDevSupabaseUrl(env.SUPABASE_URL, "SUPABASE_URL");
    app = await buildTestApp();
    // L'un après l'autre : un compte créé est toujours rangé, donc effacé à la fin.
    b = await createTestUser(app, "pcb");
    admin = await createTestUser(app, "pcm");
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;

    reserveMock.mockResolvedValue({ allowed: true, reservationId: 4242 });
    releaseMock.mockResolvedValue(true);
    searchMock.mockResolvedValue(found([VESTE, SAC]));
    downloadMock.mockResolvedValue(PHOTO);
  });

  afterAll(async () => {
    if (!app) return;
    const quietly = async (work: () => PromiseLike<unknown>) => {
      try {
        await work();
      } catch {
        // Nettoyage : on continue avec le reste, quoi qu'il arrive.
      }
    };
    const accounts = [a, b, admin].filter((user): user is TestUser => Boolean(user));
    // Fichiers de chaque compte (si A n'a pas été supprimé par l'app), puis l'image analysée.
    for (const user of accounts) {
      for (const bucket of USER_STORAGE_BUCKETS) {
        await quietly(async () => {
          const { data } = await app.supabaseAdmin.storage.from(bucket).list(user.id, { limit: 1000 });
          const paths = (data ?? []).map((file) => `${user.id}/${file.name}`);
          if (paths.length > 0) await app.supabaseAdmin.storage.from(bucket).remove(paths);
        });
      }
    }
    if (searchId) await quietly(() => app.supabaseAdmin.storage.from("screenshots").remove([`analyses/${searchId}.jpg`]));
    // Le rôle d'abord (un administrateur ne se supprime pas), puis les comptes.
    if (admin) await quietly(() => app.supabaseAdmin.from("admins").delete().eq("user_id", admin.id));
    for (const user of accounts) await quietly(() => deleteTestUser(app, user.id));
    await app.close();
  });

  step("1. inscription : profil neuf, documents légaux acceptés dans leur version, pseudo et photo de profil choisis", async () => {
    a = await createTestUser(app, "pca");

    const me = await request(a, "GET", "/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: a.id, isAdmin: false, followersCount: 0, followingCount: 0, postsCount: 0, pieceSendsFrom: "following" });

    const before = (await request(a, "GET", "/api/consents")).json() as { grantedAt: string | null }[];
    expect(before.every((c) => c.grantedAt === null)).toBe(true);
    const consents = (["terms", "privacy_policy", "age_declaration"] as const).map((type) => ({ type, version: CONSENT_VERSIONS[type] }));
    expect((await request(a, "POST", "/api/consents", { consents })).statusCode).toBe(204);
    const after = (await request(a, "GET", "/api/consents")).json() as { type: string; isCurrent: boolean; version: string | null }[];
    for (const { type, version } of consents) expect(after.find((c) => c.type === type)).toMatchObject({ isCurrent: true, version });

    const username = `pc_${a.id.replace(/-/g, "").slice(0, 12)}`;
    const patched = await request(a, "PATCH", "/api/me", { username, displayName: "Alice Parcours", bio: "Le parcours complet" });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ username, displayName: "Alice Parcours" });
    a = { ...a, username };
    // Le pseudo est pris : personne d'autre ne peut le choisir.
    expect((await request(b, "PATCH", "/api/me", { username, displayName: "Copie" })).statusCode).toBe(409);

    const avatar = await upload(a, "/api/me/avatar", {}, PHOTO);
    expect(avatar.statusCode).toBe(200);
    expect(avatar.json().avatarUrl).toContain(`/avatars/${a.id}/avatar.jpg`);
  });

  step("2. Spotter : une photo importée, préparée puis lancée ; propositions rangées, image analysée effacée", async () => {
    const prepared = await request(a, "POST", "/api/searches/prepare", {});
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({ status: "pending", sourcePlatform: "photo" });
    searchId = prepared.json().id;
    expect(searchMock).not.toHaveBeenCalled();

    // L'image n'existe que pendant l'appel au fournisseur : lue à ce moment-là.
    let analysed: Buffer | null = null;
    let sentUrl = "";
    searchMock.mockImplementationOnce(async (_fastify, imageUrl) => {
      sentUrl = imageUrl;
      const { data } = await app.supabaseAdmin.storage.from("screenshots").download(`analyses/${searchId}.jpg`);
      analysed = data ? Buffer.from(await data.arrayBuffer()) : null;
      return found([VESTE, SAC]);
    });
    const mp = buildMultipart(
      { crop: JSON.stringify({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }) },
      { fieldname: "file", filename: "capture.jpg", contentType: "image/jpeg", data: IMAGE }
    );
    const run = await request(a, "POST", `/api/searches/${searchId}/run`, mp.payload, mp.headers);
    expect(run.statusCode).toBe(200);
    const body = run.json() as { status: string; matches: { id: string; productName: string }[] };
    expect(body.status).toBe("completed");
    expect(body.matches.map((m) => m.productName)).toEqual([VESTE.productName, SAC.productName]);
    vesteMatchId = body.matches[0]!.id;
    sacMatchId = body.matches[1]!.id;

    // Un seul appel (simulé), une place réservée pour A et cette recherche.
    expect(searchMock).toHaveBeenCalledOnce();
    expect(reserveMock).toHaveBeenCalledOnce();
    expect(reserveMock.mock.calls[0]![2]).toBe(a.id);
    expect(reserveMock.mock.calls[0]![3]).toBe(searchId);
    // La zone choisie a bien été analysée (50 % × 25 % de 400 × 600), sous un nom sans le compte.
    expect(analysed).not.toBeNull();
    const meta = await sharp(analysed!).metadata();
    expect([meta.width, meta.height]).toEqual([200, 150]);
    expect(sentUrl).not.toContain(a.id);

    // Propositions rangées en base, relues par l'app.
    const { data: rows, error } = await app.supabaseAdmin.from("product_matches").select("id").eq("search_id", searchId);
    expect(error).toBeNull();
    expect((rows ?? []).map((r) => r.id).sort()).toEqual([vesteMatchId, sacMatchId].sort());
    const reread = (await request(a, "GET", `/api/searches/${searchId}`)).json();
    expect(reread.matches).toHaveLength(2);
    const recent = (await request(a, "GET", "/api/searches")).json() as { id: string }[];
    expect(recent.map((s) => s.id)).toContain(searchId);

    // L'image analysée n'existe plus, ni sous son nom, ni dans le dossier de A ; rien n'est gardé en base.
    expect(await analysisImageExists(searchId)).toBe(false);
    expect(await storageFiles("screenshots", a.id)).toEqual([]);
    const { data: search } = await app.supabaseAdmin.from("product_searches").select("screenshot_url").eq("id", searchId).single();
    expect(search?.screenshot_url).toBeNull();
  });

  step("3. Vault et envie : « Je l'ai achetée », ajout à la main, « Garder » puis republier l'envie", async () => {
    // Depuis une proposition : l'image vient de la base, pas de la requête ; une seule fois.
    const fromMatch = await upload(a, "/api/vault", { title: "Veste en daim", category: "clothing", productMatchId: vesteMatchId });
    expect(fromMatch.statusCode).toBe(200);
    expect(fromMatch.json()).toMatchObject({ productMatchId: vesteMatchId, imageUrl: VESTE.imageUrl, alreadyInVault: false });
    vaultFromMatchId = fromMatch.json().id;
    const again = await upload(a, "/api/vault", { title: "Veste en daim", category: "clothing", productMatchId: vesteMatchId });
    expect(again.json()).toMatchObject({ id: vaultFromMatchId, alreadyInVault: true });

    // À la main, avec une photo rangée dans le dossier de A.
    const manual = await upload(a, "/api/vault", { title: "Montre Tank", category: "watches" }, PHOTO);
    expect(manual.statusCode).toBe(200);
    expect(manual.json().imageUrl).toContain(`/vault-media/${a.id}/`);
    vaultManualId = manual.json().id;

    const vault = (await request(a, "GET", "/api/vault")).json() as { totalCount: number; items: { id: string }[] };
    expect(vault.totalCount).toBe(2);
    expect(vault.items.map((i) => i.id).sort()).toEqual([vaultFromMatchId, vaultManualId].sort());
    // Le Vault est privé.
    expect((await request(b, "GET", `/api/vault/${vaultManualId}`)).statusCode).toBe(404);

    // « Garder » : une envie, privée par défaut.
    const wish = await request(a, "POST", "/api/wishlist", {
      title: SAC.productName,
      imageUrl: SAC.imageUrl,
      merchantName: SAC.merchantName,
      merchantUrl: SAC.merchantUrl,
      priceMin: 240,
      currency: "EUR",
      productMatchId: sacMatchId,
    });
    expect(wish.statusCode).toBe(200);
    expect(wish.json()).toMatchObject({ productMatchId: sacMatchId, imageUrl: SAC.imageUrl });
    wishId = wish.json().id;
    expect((await request(b, "GET", `/api/wishlist/${wishId}`)).statusCode).toBe(404);

    // Republier l'envie (abonnés) : une copie de l'image dans NOTRE stockage, jamais l'adresse d'origine.
    const republished = await request(a, "POST", `/api/wishlist/${wishId}/republish`, { privacy: "followers" });
    expect(republished.statusCode).toBe(200);
    const post: Post = republished.json();
    expect(post).toMatchObject({ type: "wish", privacy: "followers", author: { id: a.id } });
    expect(post.mediaUrl?.startsWith(`${OUR_STORAGE}${a.id}/`)).toBe(true);
    expect(JSON.stringify(post)).not.toContain(SAC.imageUrl);
    wishPostId = post.id;
    expect((await request(a, "GET", `/api/wishlist/${wishId}`)).json().sharedPost).toMatchObject({ id: wishPostId, privacy: "followers" });
  });

  step(
    "4. publication et vie sociale : B suit A, voit ses publications, commente et aime ; A est notifiée et envoie son envie à B",
    async () => {
      // B a ses propres données privées (elles ne devront jamais sortir chez A).
      const secret = await request(b, "POST", "/api/wishlist", {
        title: B_SECRET_WISH,
        imageUrl: "https://boutique.example/secret.jpg",
        merchantUrl: "https://boutique.example/secret",
      });
      expect(secret.statusCode).toBe(200);

      const published = await upload(a, "/api/posts", { type: "lifestyle", privacy: "followers", caption: "Ma veste du jour" }, PHOTO);
      expect(published.statusCode).toBe(200);
      expect(published.json()).toMatchObject({ type: "lifestyle", author: { id: a.id } });
      expect(published.json().mediaUrl).toContain(`/post-media/${a.id}/`);
      lifestylePostId = published.json().id;

      // « Abonnés » : invisible pour B tant qu'il ne suit pas A.
      expect((await feed(b)).map((p) => p.id)).not.toContain(lifestylePostId);
      expect((await request(b, "GET", `/api/posts/${lifestylePostId}`)).statusCode).toBe(404);

      expect((await request(b, "POST", `/api/follows/${a.id}`)).statusCode).toBe(204);
      expect((await feed(b)).map((p) => p.id)).toEqual(expect.arrayContaining([lifestylePostId, wishPostId]));

      const comment = await request(b, "POST", `/api/posts/${lifestylePostId}/comments`, { body: "Très belle veste" });
      expect(comment.statusCode).toBe(200);
      bCommentIds.push(comment.json().id);
      expect((await request(b, "POST", `/api/posts/${lifestylePostId}/react`)).statusCode).toBe(200);

      // A est notifiée : abonnement, commentaire, « j'aime ».
      const fromB = await fromActor(a, b);
      expect(fromB.map((n) => n.type).sort()).toEqual(["comment", "follow", "like"]);
      expect(fromB.filter((n) => n.type !== "follow").every((n) => n.postId === lifestylePostId && !n.read)).toBe(true);
      expect((await request(a, "GET", "/api/notifications/unread-count")).json().count).toBe(3);

      // A répond sous sa publication (jamais notifiée de son propre commentaire).
      const reply = await request(a, "POST", `/api/posts/${lifestylePostId}/comments`, { body: "Merci !" });
      expect(reply.statusCode).toBe(200);
      aReplyId = reply.json().id;
      expect((await fromActor(a, a)).length).toBe(0);
      const listed = (await request(a, "GET", `/api/posts/${lifestylePostId}/comments`)).json().comments as { id: string }[];
      expect(listed.map((c) => c.id)).toEqual([bCommentIds[0], aReplyId]);

      // B suit A : il accepte ses pièces. A lui envoie son envie ; B la reçoit (copie chez A) et est notifié.
      const sent = await request(a, "POST", `/api/wishlist/${wishId}/send`, { recipientId: b.id });
      expect(sent.statusCode).toBe(201);
      pieceId = sent.json().id;
      const pieces = await received(b);
      expect(pieces.map((p) => p.id)).toEqual([pieceId]);
      expect(pieces[0]).toMatchObject({ title: SAC.productName, sender: { id: a.id } });
      expect(pieces[0]!.imageUrl?.startsWith(`${OUR_STORAGE}${a.id}/`)).toBe(true);
      expect((await fromActor(b, a)).map((n) => n.type)).toEqual(["piece_received"]);
    },
    120_000
  );

  step(
    "5. B signale la publication, l'administratrice la voit ; B bloque A (fil, commentaires, pièces, profils), puis débloque",
    async () => {
      const report = await request(b, "POST", "/api/reports", { targetType: "post", targetId: lifestylePostId, reason: "spam", note: B_REPORT_NOTE });
      expect(report.statusCode).toBe(204);
      // Signalée : elle sort aussitôt du fil de B (l'envie republiée reste).
      const bFeed = (await feed(b)).map((p) => p.id);
      expect(bFeed).not.toContain(lifestylePostId);
      expect(bFeed).toContain(wishPostId);
      // Un seul signalement : la publication n'est pas masquée pour les autres.
      const { data: reported } = await app.supabaseAdmin.from("posts").select("hidden_at").eq("id", lifestylePostId).single();
      expect(reported?.hidden_at).toBeNull();

      // L'administratrice voit le signalement, sans jamais savoir qui l'a fait.
      const queue = await request(admin, "GET", "/api/admin/moderation?status=open");
      expect(queue.statusCode).toBe(200);
      const item = (queue.json() as ModerationPage).items.find((entry) => entry.targetId === lifestylePostId);
      expect(item).toMatchObject({ targetType: "post", reportCount: 1, reasons: { spam: 1 }, notes: [B_REPORT_NOTE] });
      expect(item?.preview).toMatchObject({ kind: "post", hidden: false, author: { id: a.id } });
      for (const secret of [b.id, b.username, b.email]) expect(queue.body).not.toContain(secret);
      // Et personne d'autre n'y a accès.
      expect((await request(b, "GET", "/api/admin/moderation?status=open")).statusCode).toBe(404);

      expect((await request(b, "POST", `/api/blocks/${a.id}`)).statusCode).toBe(204);
      // Fil et publications : plus rien de A pour B (même par le lien direct), ni commentaire possible.
      expect((await feed(b)).some((p) => p.author.id === a.id)).toBe(false);
      for (const postId of [lifestylePostId, wishPostId]) expect((await request(b, "GET", `/api/posts/${postId}`)).statusCode).toBe(404);
      expect((await request(b, "POST", `/api/posts/${lifestylePostId}/comments`, { body: "Après le blocage" })).statusCode).toBe(404);
      // Sous sa propre publication, A ne voit plus le commentaire de B (le sien reste).
      const seenByA = (await request(a, "GET", `/api/posts/${lifestylePostId}/comments`)).json().comments as { id: string }[];
      expect(seenByA.map((c) => c.id)).toEqual([aReplyId]);
      // Abonnement rompu, notifications échangées effacées, dans les deux sens.
      expect((await request(a, "GET", "/api/me")).json().followersCount).toBe(0);
      expect((await request(b, "GET", "/api/me")).json().followingCount).toBe(0);
      expect(await fromActor(a, b)).toEqual([]);
      expect(await fromActor(b, a)).toEqual([]);
      // Pièces (les « messages » de Spotto) : envoi impossible, pièce déjà reçue cachée.
      const resend = await request(a, "POST", `/api/wishlist/${wishId}/send`, { recipientId: b.id });
      expect(resend.statusCode).toBe(404);
      expect(resend.json().error).toBe("recipient_not_found");
      expect(await received(b)).toEqual([]);
      // Profils et recherche : introuvables dans les deux sens ; aucun nouvel abonnement.
      expect((await request(b, "GET", `/api/users/${a.id}`)).statusCode).toBe(404);
      expect((await request(a, "GET", `/api/users/${b.id}`)).statusCode).toBe(404);
      expect(await foundInSearch(b, a)).toBe(false);
      expect((await request(b, "POST", `/api/follows/${a.id}`)).statusCode).toBe(403);

      // Déblocage : le profil et la pièce reçue reviennent ; B suit A à nouveau et commente l'envie.
      expect((await request(b, "DELETE", `/api/blocks/${a.id}`)).statusCode).toBe(204);
      expect((await request(b, "GET", `/api/users/${a.id}`)).statusCode).toBe(200);
      expect((await received(b)).map((p) => p.id)).toEqual([pieceId]);
      expect((await request(b, "POST", `/api/follows/${a.id}`)).statusCode).toBe(204);
      const comment = await request(b, "POST", `/api/posts/${wishPostId}/comments`, { body: "Superbe sac" });
      expect(comment.statusCode).toBe(200);
      bCommentIds.push(comment.json().id);
      expect((await fromActor(a, b)).map((n) => n.type).sort()).toEqual(["comment", "follow"]);
    },
    120_000
  );

  step("6. export des données de A : tout ce que A a créé ou reçu, rien de privé de B", async () => {
    const res = await request(a, "GET", "/api/me/export");
    expect(res.statusCode).toBe(200);
    const exported = res.json();
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

    expect(exported.profile).toMatchObject({ id: a.id, username: a.username, display_name: "Alice Parcours" });
    expect(exported.account).toEqual({ email: a.email });
    expect((exported.consents as { type: string }[]).map((c) => c.type).sort()).toEqual(["age_declaration", "privacy_policy", "terms"]);
    expect(exported.productSearches.find((s: { id: string }) => s.id === searchId)).toMatchObject({ status: "completed", screenshot_url: null });
    expect(ids(exported.productMatches).sort()).toEqual([vesteMatchId, sacMatchId].sort());
    expect(ids(exported.vaultItems).sort()).toEqual([vaultFromMatchId, vaultManualId].sort());
    expect(ids(exported.wishlistItems)).toEqual([wishId]);
    expect(ids(exported.posts).sort()).toEqual([lifestylePostId, wishPostId].sort());
    expect(ids(exported.comments)).toEqual([aReplyId]);
    expect(exported.piecesSent).toHaveLength(1);
    expect(exported.piecesSent[0]).toMatchObject({ id: pieceId, recipient_id: b.id, title: SAC.productName });
    expect(exported.piecesReceived).toEqual([]);
    // Le commentaire reçu (après le déblocage) est dans ses notifications.
    expect(exported.notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "comment", actor_id: b.id, comment_id: bCommentIds[1], post_id: wishPostId })])
    );
    expect(exported.followers).toEqual([expect.objectContaining({ follower_id: b.id })]);

    // Rien de privé de B : ni son adresse, ni ses envies, ni son signalement, ni son blocage.
    expect(exported.reportsSubmitted).toEqual([]);
    expect(exported.blockedAccounts).toEqual([]);
    const text = JSON.stringify(exported);
    for (const secret of [b.email, B_SECRET_WISH, B_REPORT_NOTE]) expect(text).not.toContain(secret);

    // Le fichier lisible : une pièce jointe, avec les données de A et rien de B.
    const page = await request(a, "GET", "/api/me/export?format=html", undefined, { "accept-language": "fr" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(String(page.headers["content-disposition"])).toContain("attachment");
    expect(page.body).toContain("Montre Tank");
    for (const secret of [b.email, B_SECRET_WISH, B_REPORT_NOTE]) expect(page.body).not.toContain(secret);
  });

  step(
    "7. suppression du compte de A : plus aucune ligne ni aucun fichier de A, et B ne voit plus rien de A",
    async () => {
      // Avant : A a bien des fichiers (photo de profil, Vault, publication et copies d'envie).
      expect(await storageFiles("avatars", a.id)).toContain("avatar.jpg");
      expect((await storageFiles("vault-media", a.id)).length).toBeGreaterThan(0);
      expect((await storageFiles("post-media", a.id)).length).toBeGreaterThanOrEqual(6);

      // Sans le mot demandé : refusé, rien n'est effacé.
      expect((await request(a, "DELETE", "/api/me", { confirmation: "oui" })).statusCode).toBe(400);
      expect((await request(a, "GET", "/api/me")).statusCode).toBe(200);

      expect((await request(a, "DELETE", "/api/me", { confirmation: ACCOUNT_DELETION_WORDS.fr })).statusCode).toBe(204);
      expect((await request(a, "GET", "/api/me")).statusCode).toBe(401);
      const { data: auth } = await app.supabaseAdmin.auth.admin.getUserById(a.id);
      expect(auth?.user ?? null).toBeNull();

      // Base : plus aucune ligne de A, dans aucune table qui le cite.
      const columns: [string, string][] = [
        ["profiles", "id"],
        ["product_searches", "user_id"],
        ["vault_items", "user_id"],
        ["wishlist_items", "user_id"],
        ["posts", "user_id"],
        ["comments", "user_id"],
        ["post_reactions", "user_id"],
        ["follows", "follower_id"],
        ["follows", "followee_id"],
        ["blocks", "blocker_id"],
        ["blocks", "blocked_id"],
        ["notifications", "user_id"],
        ["notifications", "actor_id"],
        ["piece_sends", "sender_id"],
        ["piece_sends", "recipient_id"],
        ["consents", "user_id"],
        ["data_export_requests", "user_id"],
        ["reports", "reporter_id"],
        ["affiliate_clicks", "user_id"],
        ["match_feedback", "user_id"],
        ["admins", "user_id"],
        ["suspensions", "user_id"],
        ["moderation_actions", "target_user_id"],
      ];
      if (await migration0029Applied(app)) columns.push(["ai_calls", "user_id"]);
      for (const [table, column] of columns) {
        const { count, error } = await app.supabaseAdmin.from(table).select("*", { count: "exact", head: true }).eq(column, a.id);
        expect(error, `${table}.${column}`).toBeNull();
        expect(count, `${table}.${column}`).toBe(0);
      }
      const { count: matches } = await app.supabaseAdmin.from("product_matches").select("*", { count: "exact", head: true }).eq("search_id", searchId);
      expect(matches).toBe(0);
      // Les commentaires de B sous les publications de A sont partis avec elles.
      const { count: comments } = await app.supabaseAdmin.from("comments").select("*", { count: "exact", head: true }).in("id", bCommentIds);
      expect(comments).toBe(0);

      // Stockage : plus aucun fichier de A, dans aucun dossier utilisé par le serveur.
      for (const bucket of USER_STORAGE_BUCKETS) expect(await storageFiles(bucket, a.id), bucket).toEqual([]);
      expect(await analysisImageExists(searchId)).toBe(false);

      // B ne voit plus rien de A : profil, recherche, fil, publications, pièce reçue, notifications.
      expect((await request(b, "GET", `/api/users/${a.id}`)).statusCode).toBe(404);
      expect(await foundInSearch(b, a)).toBe(false);
      expect((await feed(b)).some((p) => p.author.id === a.id)).toBe(false);
      for (const postId of [lifestylePostId, wishPostId]) expect((await request(b, "GET", `/api/posts/${postId}`)).statusCode).toBe(404);
      expect(await received(b)).toEqual([]);
      expect(await fromActor(b, a)).toEqual([]);
      expect((await request(b, "GET", "/api/me")).json().followingCount).toBe(0);
    },
    120_000
  );
});
