import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import type { AppNotification, ModerationPage, Post, ReceivedPiece } from "@monapp/shared-types";
import { downloadPublicImage } from "../src/lib/publicImage.js";
import { EXPORT_TEXT, MODERATION_ACTION_LABELS, MODERATION_REASON_LABELS } from "../src/lib/exportText.js";
import { STORAGE_ATTEMPTS, deleteUserStorageFiles } from "../src/lib/storage.js";
import { sectionHtml, visibleText } from "./exportFixture.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 5, partie B (décisions du fondateur, 2026-10-15) : « Retirer l'image
// copiée ». Seulement les copies faites par Spotto (publication « envie »,
// pièce envoyée), jamais la photo publiée par une personne ; réservé aux
// administrateurs, journalisé, la personne prévenue avec un motif neutre ; le
// contenu reste, avec « Image indisponible ». Le fichier est effacé D'ABORD
// (3 essais) : si le stockage refuse, rien n'est changé. Le téléchargement de
// l'image du marchand est simulé : aucun site extérieur n'est appelé.
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const downloadMock = vi.mocked(downloadPublicImage);

const ORIGINAL_IMAGE = "https://images.example-shop.test/foulard.jpg";

function fileName(url: string | null): string {
  if (url === null) throw new Error("Image absente");
  return url.split("/").pop()!;
}

describe("retirer l'image copiée (administrateurs seulement)", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let owner: TestUser; // partage son envie : publication « envie » et pièces envoyées
  let recipient: TestUser; // suit `owner`, reçoit les pièces et signale
  let photo: Buffer;
  let wishId = "";
  let wishPost: Post;
  let lookPostId = "";
  let removedPieceId = "";

  const request = (user: TestUser | null, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: user ? authHeaders(user.token) : {}, payload });
  const removeImage = (payload: object, user: TestUser = admin) => request(user, "POST", "/api/admin/moderation/remove-image", payload);
  const storageFiles = async (userId: string): Promise<string[]> =>
    ((await app.supabaseAdmin.storage.from("post-media").list(userId, { limit: 1000 })).data ?? []).map((f) => f.name);
  const received = async (): Promise<ReceivedPiece[]> => (await request(recipient, "GET", "/api/pieces/received")).json().pieces;
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const journal = async (targetId: string) =>
    (await app.supabaseAdmin.from("moderation_actions").select("action, reason, note, target_type").eq("target_id", targetId)).data ?? [];

  async function sendPiece(): Promise<ReceivedPiece> {
    const res = await request(owner, "POST", `/api/wishlist/${wishId}/send`, { recipientId: recipient.id });
    expect(res.statusCode).toBe(201);
    const piece = (await received()).find((p) => p.id === res.json().id);
    if (!piece) throw new Error("Pièce envoyée introuvable");
    return piece;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [admin, owner, recipient] = await Promise.all([createTestUser(app, "ria"), createTestUser(app, "rio"), createTestUser(app, "rir")]);
    photo = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#7a5" } }).jpeg().toBuffer();
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    expect((await request(recipient, "POST", `/api/follows/${owner.id}`)).statusCode).toBe(204);

    downloadMock.mockResolvedValue(photo);
    const wish = await request(owner, "POST", "/api/wishlist", {
      title: "Foulard en soie",
      imageUrl: ORIGINAL_IMAGE,
      merchantName: "Boutique test",
      merchantUrl: "https://example-shop.test/foulard",
      priceMin: 89,
      currency: "EUR",
    });
    expect(wish.statusCode).toBe(200);
    wishId = wish.json().id;
    const republished = await request(owner, "POST", `/api/wishlist/${wishId}/republish`, { privacy: "followers" });
    expect(republished.statusCode).toBe(200);
    wishPost = republished.json();

    // Une photo publiée par la personne elle-même (look) : jamais concernée.
    const mp = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "look.jpg", contentType: "image/jpeg", data: photo });
    const look = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(owner.token), ...mp.headers }, payload: mp.payload });
    expect(look.statusCode).toBe(200);
    lookPostId = look.json().id;
  });

  beforeEach(() => {
    downloadMock.mockReset();
    downloadMock.mockResolvedValue(photo);
  });

  afterAll(async () => {
    for (const user of [admin, owner, recipient]) {
      await deleteUserStorageFiles(app, user.id);
      await deleteTestUser(app, user.id);
    }
    await app.close();
  });

  it("invisible pour un compte qui n'est pas administrateur (404) et sans connexion (401) ; entrée invalide : 400", async () => {
    const payload = { targetType: "post", targetId: wishPost.id };
    const refused = await removeImage(payload, owner);
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error).toBe("not_found");
    expect((await request(null, "POST", "/api/admin/moderation/remove-image", payload)).statusCode).toBe(401);
    for (const invalid of [{ targetType: "comment", targetId: wishPost.id }, { targetType: "post", targetId: "pas-un-identifiant" }, { targetType: "post" }]) {
      expect((await removeImage(invalid)).statusCode, JSON.stringify(invalid)).toBe(400);
    }
    expect((await removeImage({ ...payload, note: "x".repeat(501) })).statusCode).toBe(400);
    expect(await journal(wishPost.id)).toEqual([]);
  });

  it("refusé pour une photo publiée par la personne elle-même (look) : rien n'est effacé", async () => {
    const before = await storageFiles(owner.id);
    const res = await removeImage({ targetType: "post", targetId: lookPostId });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("not_a_copy");
    expect(await storageFiles(owner.id)).toEqual(before);
    expect((await request(owner, "GET", `/api/posts/${lookPostId}`)).json()).toMatchObject({ mediaRemoved: false });
    expect(await journal(lookPostId)).toEqual([]);
  });

  it("contenu introuvable : 404, rien n'est enregistré", async () => {
    const res = await removeImage({ targetType: "piece", targetId: randomUUID() });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("target_not_found");
  });

  it("le stockage refuse l'effacement : 3 essais, refus expliqué, et rien n'est changé (ni journal, ni personne prévenue)", async () => {
    const fileApi = Object.getPrototypeOf(app.supabaseAdmin.storage.from("post-media")) as { remove: (paths: string[]) => Promise<unknown> };
    const failingRemove = vi.spyOn(fileApi, "remove").mockResolvedValue({ data: null, error: new Error("panne simulée") });
    const notificationsBefore = (await notifications(owner)).length;
    try {
      const res = await removeImage({ targetType: "post", targetId: wishPost.id });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: "storage_failed", message: expect.stringContaining("rien n'a été changé") });
      expect(failingRemove).toHaveBeenCalledTimes(STORAGE_ATTEMPTS);
    } finally {
      failingRemove.mockRestore();
    }
    const post: Post = (await request(owner, "GET", `/api/posts/${wishPost.id}`)).json();
    expect(post).toMatchObject({ mediaUrl: wishPost.mediaUrl, mediaRemoved: false });
    expect(await storageFiles(owner.id)).toEqual(expect.arrayContaining([fileName(wishPost.mediaUrl), fileName(wishPost.mediaThumbUrl)]));
    expect(await journal(wishPost.id)).toEqual([]);
    expect(await notifications(owner)).toHaveLength(notificationsBefore);
  });

  it("publication « envie » : seule la copie visée est effacée ; la publication reste, « Image indisponible », titre et lien du marchand", async () => {
    const piece = await sendPiece();
    // Le destinataire avait signalé la publication : son signalement est classé.
    expect((await request(recipient, "POST", "/api/reports", { targetType: "post", targetId: wishPost.id, reason: "other", note: "image d'un autre site" })).statusCode).toBe(204);
    const kept = [fileName(piece.imageUrl), fileName(piece.imageThumbUrl)];
    const lookFiles = (await storageFiles(owner.id)).filter(
      (name) => ![fileName(wishPost.mediaUrl), fileName(wishPost.mediaThumbUrl), ...kept].includes(name)
    );
    expect(lookFiles.length).toBeGreaterThanOrEqual(2);

    const res = await removeImage({ targetType: "post", targetId: wishPost.id, note: "Demande du titulaire des droits" });
    expect(res.statusCode).toBe(200);
    expect(res.json().actionId).toEqual(expect.any(String));

    // Fichiers : seulement les deux de cette publication.
    const files = await storageFiles(owner.id);
    expect(files).not.toContain(fileName(wishPost.mediaUrl));
    expect(files).not.toContain(fileName(wishPost.mediaThumbUrl));
    expect(files).toEqual(expect.arrayContaining([...kept, ...lookFiles]));

    // Partout où la publication apparaît : sans image, avec son titre et son lien.
    const views: Post[] = [
      (await request(owner, "GET", `/api/posts/${wishPost.id}`)).json(),
      (await request(recipient, "GET", `/api/posts/${wishPost.id}`)).json(),
      (await request(recipient, "GET", "/api/feed")).json().posts.find((p: Post) => p.id === wishPost.id),
      (await request(recipient, "GET", `/api/users/${owner.id}/posts`)).json().posts.find((p: Post) => p.id === wishPost.id),
    ];
    for (const view of views) {
      expect(view).toMatchObject({ mediaUrl: null, mediaThumbUrl: null, mediaHdUrl: null, mediaRemoved: true });
      expect(view.wish).toMatchObject({ title: "Foulard en soie", merchantUrl: "https://example-shop.test/foulard" });
    }
    // L'envie elle-même garde l'image d'origine du marchand (décision du fondateur).
    expect((await request(owner, "GET", `/api/wishlist/${wishId}`)).json().imageUrl).toBe(ORIGINAL_IMAGE);
    // La pièce envoyée avec une autre copie garde son image.
    expect((await received()).find((p) => p.id === piece.id)).toMatchObject({ imageUrl: piece.imageUrl, imageRemoved: false });

    // Journal, personne prévenue (motif neutre), signalement classé.
    expect(await journal(wishPost.id)).toEqual([{ action: "remove_image", reason: "image_rights", note: "Demande du titulaire des droits", target_type: "post" }]);
    const notice = (await notifications(owner)).find((n) => n.type === "moderation");
    expect(notice?.moderation).toEqual({ action: "remove_image", targetType: "post", reason: "image_rights", note: "Demande du titulaire des droits" });
    expect((await notifications(recipient)).some((n) => n.type === "report_handled" && n.reportedType === "post")).toBe(true);

    // File de modération : contenu traité, image retirée, plus de bouton.
    const handled: ModerationPage = (await request(admin, "GET", "/api/admin/moderation?status=handled")).json();
    const item = handled.items.find((i) => i.targetId === wishPost.id);
    expect(item?.preview).toMatchObject({ kind: "post", imageUrl: null, imageRemoved: true });
    expect(item?.canRemoveImage).toBe(false);
    expect(item?.history[0]).toMatchObject({ action: "remove_image", reason: "image_rights" });

    // Une seconde fois : refus ; et la décision ne s'annule pas.
    const again = await removeImage({ targetType: "post", targetId: wishPost.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_removed");
    const undo = await request(admin, "POST", `/api/admin/moderation/actions/${res.json().actionId}/undo`, {});
    expect(undo.statusCode).toBe(409);
    expect(undo.json().error).toBe("not_undoable");
  });

  it("pièce envoyée dont le fichier a déjà disparu : le retrait se fait quand même, la pièce reste avec « Image indisponible »", async () => {
    const piece = await sendPiece();
    expect((await request(recipient, "POST", "/api/reports", { targetType: "piece", targetId: piece.id, reason: "spam" })).statusCode).toBe(204);
    const open: ModerationPage = (await request(admin, "GET", "/api/admin/moderation?status=open")).json();
    expect(open.items.find((i) => i.targetId === piece.id)).toMatchObject({ canRemoveImage: true, preview: { kind: "piece", imageRemoved: false } });

    const gone = await app.supabaseAdmin.storage.from("post-media").remove([`${owner.id}/${fileName(piece.imageUrl)}`, `${owner.id}/${fileName(piece.imageThumbUrl)}`]);
    expect(gone.error).toBeNull();

    const res = await removeImage({ targetType: "piece", targetId: piece.id });
    expect(res.statusCode).toBe(200);
    expect((await received()).find((p) => p.id === piece.id)).toMatchObject({
      imageUrl: null,
      imageThumbUrl: null,
      imageRemoved: true,
      title: "Foulard en soie",
      merchantUrl: "https://example-shop.test/foulard",
    });
    expect(await journal(piece.id)).toEqual([{ action: "remove_image", reason: "image_rights", note: null, target_type: "piece" }]);
    const notices = (await notifications(owner)).filter((n) => n.type === "moderation").map((n) => n.moderation);
    expect(notices).toContainEqual({ action: "remove_image", targetType: "piece", reason: "image_rights", note: null });
    removedPieceId = piece.id;
  });

  it("garde-fou : une copie citée par un autre contenu n'est jamais effacée (refus, rien n'est changé)", async () => {
    const piece = await sendPiece();
    // Cas anormal fabriqué à la main : une seconde pièce qui cite les mêmes fichiers.
    const { data: twin, error } = await app.supabaseAdmin
      .from("piece_sends")
      .insert({ sender_id: owner.id, recipient_id: recipient.id, title: "Jumelle", image_url: piece.imageUrl, image_thumb_url: piece.imageThumbUrl })
      .select("id")
      .single();
    if (error || !twin) throw error ?? new Error("Insertion impossible");
    try {
      const res = await removeImage({ targetType: "piece", targetId: piece.id });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("shared_copy");
      expect(await storageFiles(owner.id)).toEqual(expect.arrayContaining([fileName(piece.imageUrl), fileName(piece.imageThumbUrl)]));
      expect((await received()).find((p) => p.id === piece.id)).toMatchObject({ imageUrl: piece.imageUrl, imageRemoved: false });
      expect(await journal(piece.id)).toEqual([]);
    } finally {
      await app.supabaseAdmin.from("piece_sends").delete().eq("id", twin.id);
    }
  });

  it("export : date et motif pour la personne qui avait partagé, « Image indisponible » seulement pour celle qui a reçu la pièce", async () => {
    const exportOf = async (user: TestUser, format: "json" | "html", language = "fr") =>
      app.inject({ method: "GET", url: `/api/me/export?format=${format}`, headers: { ...authHeaders(user.token), "accept-language": language } });

    const data = (await exportOf(owner, "json")).json();
    const post = data.posts.find((p: { id: string }) => p.id === wishPost.id);
    expect(post).toMatchObject({ media_url: null, media_thumb_url: null, media_removed_at: expect.any(String) });
    expect(data.piecesSent.some((p: { image_removed_at: string | null; image_url: string | null }) => p.image_removed_at !== null && p.image_url === null)).toBe(true);

    for (const language of ["fr", "en"] as const) {
      const page = (await exportOf(owner, "html", language)).body;
      const removedLine = EXPORT_TEXT.imageRemovedOn[language].split(" {date}")[0]!;
      expect(visibleText(sectionHtml(page, "posts"))).toContain(removedLine);
      expect(visibleText(sectionHtml(page, "piecesSent"))).toContain(removedLine);
      const text = visibleText(page);
      expect(text).toContain(MODERATION_ACTION_LABELS.remove_image[language]);
      expect(text).toContain(MODERATION_REASON_LABELS.image_rights[language]);

      // Qui a reçu la pièce : « Image indisponible », jamais la décision ni son motif.
      const receivedPage = (await exportOf(recipient, "html", language)).body;
      const receivedText = visibleText(sectionHtml(receivedPage, "piecesReceived"));
      expect(receivedText).toContain(EXPORT_TEXT.imageUnavailable[language]);
      expect(visibleText(receivedPage)).not.toContain(MODERATION_ACTION_LABELS.remove_image[language]);
      expect(visibleText(receivedPage)).not.toContain(MODERATION_REASON_LABELS.image_rights[language]);
    }
  }, 60_000);

  it("sans image, la pièce se retire encore, et la publication « envie » se supprime encore", async () => {
    expect((await request(recipient, "DELETE", `/api/pieces/received/${removedPieceId}`)).statusCode).toBe(204);
    expect((await received()).some((p) => p.id === removedPieceId)).toBe(false);
    expect((await request(owner, "DELETE", `/api/posts/${wishPost.id}`)).statusCode).toBe(204);
    expect((await request(owner, "GET", `/api/posts/${wishPost.id}`)).statusCode).toBe(404);
  });
});
