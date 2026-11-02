import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type MultipartFile, type TestUser } from "./helpers.js";

// Lot 2 (Vault) : contrat de l'ajout d'une pièce à la main (POST /api/vault,
// avec une photo) et de « Modifier » (PATCH /api/vault/:id), tel que l'app
// s'en sert (apps/mobile/src/lib/vault-form.ts : mêmes règles, vérifiées
// avant l'envoi). Base de développement réelle ; les photos envoyées sont
// effacées du stockage à la fin, puis le compte de test (ses pièces partent
// avec lui).
describe("Vault : ajout à la main et modification (lot 2)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let photo: Buffer;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "vam");
    photo = await sharp({ create: { width: 24, height: 30, channels: 3, background: "#5A4632" } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    if (app && user) {
      const { data: files } = await app.supabaseAdmin.storage.from("vault-media").list(user.id);
      const paths = (files ?? []).map((file) => `${user.id}/${file.name}`);
      if (paths.length > 0) await app.supabaseAdmin.storage.from("vault-media").remove(paths);
      await deleteTestUser(app, user.id);
    }
    if (app) await app.close();
  });

  function jpeg(data: Buffer): MultipartFile {
    return { fieldname: "file", filename: "piece.jpg", contentType: "image/jpeg", data };
  }

  function addPiece(fields: Record<string, string>, file: MultipartFile | undefined, locale: "fr" | "en") {
    const { payload, headers } = buildMultipart(fields, file);
    return app.inject({
      method: "POST",
      url: "/api/vault",
      headers: { ...authHeaders(user.token), ...headers, "accept-language": locale },
      payload,
    });
  }

  function editPiece(id: string, body: Record<string, unknown>) {
    return app.inject({ method: "PATCH", url: `/api/vault/${id}`, headers: authHeaders(user.token), payload: body });
  }

  async function vaultCount(): Promise<number> {
    const res = await app.inject({ method: "GET", url: "/api/vault", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    return res.json().totalCount as number;
  }

  it("ajout à la main : titre sans espaces autour, photo dans son propre dossier, pièce en tête du Vault", async () => {
    const res = await addPiece({ title: "  Montre Tank  ", category: "watches" }, jpeg(photo), "fr");
    expect(res.statusCode).toBe(200);
    const item = res.json();
    expect(item).toMatchObject({ title: "Montre Tank", category: "watches", verified: false, productMatchId: null, imageHdUrl: null });
    expect(item.imageUrl).toContain(`/vault-media/${user.id}/`);

    const list = await app.inject({ method: "GET", url: "/api/vault", headers: authHeaders(user.token) });
    expect(list.json().items[0].id).toBe(item.id);
  });

  it("120 caractères au plus, comptés sans les espaces autour ; au-delà, 400 sans rien enregistrer", async () => {
    const atMax = await addPiece({ title: ` ${"a".repeat(120)} `, category: "bags" }, jpeg(photo), "fr");
    expect(atMax.statusCode).toBe(200);
    expect(atMax.json().title).toBe("a".repeat(120));

    const before = await vaultCount();
    const tooLong = await addPiece({ title: "a".repeat(121), category: "bags" }, jpeg(photo), "fr");
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual({ error: "invalid_body", message: "Le titre est trop long (120 caractères maximum)." });
    expect(await vaultCount()).toBe(before);
  });

  it("titre vide, catégorie inconnue ou photo absente : 400 invalid_body, message dans la langue de l'app", async () => {
    const before = await vaultCount();

    const blank = await addPiece({ title: "   ", category: "watches" }, jpeg(photo), "fr");
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: "invalid_body", message: "Titre et catégorie sont obligatoires." });

    const unknownCategory = await addPiece({ title: "Bague", category: "bijoux" }, jpeg(photo), "en");
    expect(unknownCategory.statusCode).toBe(400);
    expect(unknownCategory.json()).toEqual({ error: "invalid_body", message: "A title and a category are required." });

    const noPhoto = await addPiece({ title: "Sac", category: "bags" }, undefined, "fr");
    expect(noPhoto.statusCode).toBe(400);
    expect(noPhoto.json()).toEqual({ error: "invalid_body", message: "Une photo est obligatoire." });

    expect(await vaultCount()).toBe(before);
  });

  it("photo refusée : pas une image ou illisible (400 invalid_file), plus de 10 Mo (413 file_too_large)", async () => {
    const before = await vaultCount();

    const text: MultipartFile = { fieldname: "file", filename: "note.txt", contentType: "text/plain", data: Buffer.from("pas une image") };
    const notImage = await addPiece({ title: "Note", category: "other" }, text, "fr");
    expect(notImage.statusCode).toBe(400);
    expect(notImage.json()).toEqual({ error: "invalid_file", message: "Le fichier doit être une image." });

    const unreadable = await addPiece({ title: "Photo abîmée", category: "other" }, jpeg(Buffer.from("ceci n'est pas un JPEG")), "fr");
    expect(unreadable.statusCode).toBe(400);
    expect(unreadable.json()).toEqual({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });

    const heavy = await addPiece({ title: "Trop lourde", category: "other" }, jpeg(Buffer.alloc(10 * 1024 * 1024 + 1024)), "fr");
    expect(heavy.statusCode).toBe(413);
    expect(heavy.json()).toEqual({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });

    expect(await vaultCount()).toBe(before);
  });

  it("« Modifier » : le titre seul (sans espaces autour), puis la catégorie seule ; le reste ne change pas", async () => {
    const created = await addPiece({ title: "Veste", category: "clothing" }, jpeg(photo), "fr");
    expect(created.statusCode).toBe(200);
    const item = created.json();

    const renamed = await editPiece(item.id, { title: "  Veste en daim  " });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ id: item.id, title: "Veste en daim", category: "clothing", imageUrl: item.imageUrl });

    const moved = await editPiece(item.id, { category: "accessories" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ title: "Veste en daim", category: "accessories" });

    const detail = await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(user.token) });
    expect(detail.json()).toMatchObject({ title: "Veste en daim", category: "accessories", imageUrl: item.imageUrl });
  });

  it("« Modifier » refusé (400) : titre vide ou trop long, catégorie inconnue, rien à modifier — la pièce reste telle quelle", async () => {
    const created = await addPiece({ title: "Sac", category: "bags" }, jpeg(photo), "fr");
    expect(created.statusCode).toBe(200);
    const item = created.json();

    const refused: Record<string, unknown>[] = [{ title: "   " }, { title: "a".repeat(121) }, { category: "bijoux" }, {}];
    for (const body of refused) {
      const res = await editPiece(item.id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error, JSON.stringify(body)).toBe("invalid_body");
    }

    const detail = await app.inject({ method: "GET", url: `/api/vault/${item.id}`, headers: authHeaders(user.token) });
    expect(detail.json()).toMatchObject({ title: "Sac", category: "bags" });
  });
});
