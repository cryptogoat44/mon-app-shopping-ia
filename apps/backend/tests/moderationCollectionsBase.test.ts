import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { AppNotification, CollectionSummary, ModerationItem, ModerationPage, SharedCollectionPage, SharedCollectionsList, WishlistItem } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { downloadPublicImage } from "../src/lib/publicImage.js";
import { STORAGE_ATTEMPTS } from "../src/lib/storage.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Modération des collections (lot modération des collections, migration
// 0034), sur la vraie base de développement (spotto-dev-2, sur le Mac du
// fondateur) : signaler, file de modération, masquer et rétablir, retirer la
// copie d'une image (vrai stockage), masquage automatique, suspension, avec
// le vrai SQL de 0034 (contraintes, fonctions). Sauté tant que 0034 n'est
// pas appliquée sur la base des tests. Le téléchargement de l'image d'une
// envie est simulé : aucun site extérieur n'est appelé.
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const downloadMock = vi.mocked(downloadPublicImage);

const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const migrated =
  !(await service.from("collections").select("id, hidden_at").limit(0)).error &&
  !(await service.from("collection_image_copies").select("wishlist_item_id, image_removed_at").limit(0)).error;
const OUR_STORAGE = `${env.SUPABASE_URL}/storage/v1/object/public/post-media/`;
const NAME = "Cadeaux modérés";

describe.skipIf(!migrated)("modération des collections, sur la base de développement (0034)", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let alice: TestUser; // montre ses collections à ses amis
  let bruno: TestUser; // ami ; signale
  let chloe: TestUser; // amie ; ne signale pas la première collection
  let dora: TestUser; // amie
  let eve: TestUser; // suit Alice, sans retour
  let wishes: WishlistItem[] = [];
  let gifts: CollectionSummary;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const report = (user: TestUser, id: string, reason = "inappropriate") => request(user, "POST", "/api/reports", { targetType: "collection", targetId: id, reason });
  const decide = (payload: object) => request(admin, "POST", "/api/admin/moderation/actions", payload);
  const removeImage = (collectionId: string, itemId: string, note?: string) =>
    request(admin, "POST", "/api/admin/moderation/remove-image", { targetType: "collection", targetId: collectionId, itemId, ...(note ? { note } : {}) });
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const ownFiles = async (user: TestUser) => {
    const { data, error } = await app.supabaseAdmin.storage.from("post-media").list(user.id, { limit: 100 });
    if (error) throw error;
    return (data ?? []).map((file) => file.name);
  };
  async function itemFor(status: "open" | "handled", id: string): Promise<ModerationItem | undefined> {
    const page: ModerationPage = (await request(admin, "GET", `/api/admin/moderation?status=${status}`)).json();
    return page.items.find((item) => item.targetType === "collection" && item.targetId === id);
  }
  async function shared(name: string, wishList: WishlistItem[]): Promise<CollectionSummary> {
    const created: CollectionSummary = (await request(alice, "POST", "/api/collections", { name })).json();
    for (const wish of wishList) expect((await request(alice, "PUT", `/api/wishlist/${wish.id}/collections`, { collectionIds: [created.id] })).statusCode).toBe(200);
    return (await request(alice, "PATCH", `/api/collections/${created.id}`, { visibility: "friends" })).json();
  }

  beforeAll(async () => {
    app = await buildTestApp();
    const users = await Promise.all(["mca", "mcl", "mcb", "mcc", "mcd", "mce"].map((label) => createTestUser(app, label)));
    [admin, alice, bruno, chloe, dora, eve] = users as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    // Seuls comptent, pour le masquage automatique, les signalements de comptes d'au moins un jour (0030).
    const aged = await app.supabaseAdmin
      .from("profiles")
      .update({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })
      .in("id", [bruno.id, chloe.id, dora.id]);
    if (aged.error) throw aged.error;
    for (const friend of [bruno, chloe, dora]) {
      await request(alice, "POST", `/api/follows/${friend.id}`);
      await request(friend, "POST", `/api/follows/${alice.id}`);
    }
    await request(eve, "POST", `/api/follows/${alice.id}`);
    downloadMock.mockResolvedValue(await sharp({ create: { width: 400, height: 500, channels: 3, background: "#806040" } }).jpeg().toBuffer());
    for (const title of ["Sac cabas", "Foulard", "Montre"]) {
      wishes.push(
        (
          await request(alice, "POST", "/api/wishlist", {
            title,
            imageUrl: `https://images.marchand.test/${encodeURIComponent(title)}.jpg`,
            merchantName: "Marchand",
            merchantUrl: "https://marchand.test/piece",
            priceMin: 59,
            currency: "EUR",
          })
        ).json()
      );
    }
    gifts = await shared(NAME, wishes.slice(0, 2));
  }, 120_000);

  afterAll(async () => {
    for (const user of [admin, alice, bruno, chloe, dora, eve]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("« Signaler » est annoncé ; seul un ami qui voit la collection peut la signaler (la base accepte le type « collection »)", async () => {
    expect((await request(bruno, "GET", "/api/collections/status")).json()).toEqual({ enabled: true, reportable: true });
    expect((await report(eve, gifts.id)).statusCode).toBe(404);
    expect((await report(alice, gifts.id)).statusCode).toBe(404);
    expect((await report(bruno, gifts.id)).statusCode).toBe(204);
    const { data } = await app.supabaseAdmin.from("reports").select("target_type, target_id").eq("reporter_id", bruno.id);
    expect(data).toEqual([{ target_type: "collection", target_id: gifts.id }]);
  });

  it("signalée : elle disparaît pour Bruno, Chloé la voit encore", async () => {
    expect((await request(bruno, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    expect(((await request(bruno, "GET", `/api/users/${alice.id}/collections`)).json() as SharedCollectionsList).collections).toEqual([]);
    expect((await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(200);
  });

  it("file de modération : nom, auteur, envies avec la copie de leur image", async () => {
    const item = await itemFor("open", gifts.id);
    expect(item?.preview).toMatchObject({ kind: "collection", name: NAME, visibility: "friends", itemCount: 2, hidden: false, author: { id: alice.id } });
    if (item?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    expect(item.preview.items.map((entry) => entry.title)).toEqual(["Foulard", "Sac cabas"]);
    for (const entry of item.preview.items) expect(entry.imageUrl?.startsWith(`${OUR_STORAGE}${alice.id}/`)).toBe(true);
  });

  it("retirer la copie : le stockage refuse, rien n'est changé ; puis fichiers effacés, « Image indisponible », définitif", async () => {
    const item = await itemFor("open", gifts.id);
    if (item?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    const target = item.preview.items[0]!;
    const page: SharedCollectionPage = (await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).json();
    const before = page.items.find((entry) => entry.id === target.id)!;
    const fileOf = (url: string | null) => url!.split("/").pop()!;

    const fileApi = Object.getPrototypeOf(app.supabaseAdmin.storage.from("post-media")) as { remove: (paths: string[]) => Promise<unknown> };
    const failing = vi.spyOn(fileApi, "remove").mockResolvedValue({ data: null, error: new Error("panne simulée") });
    try {
      const refused = await removeImage(gifts.id, target.id);
      expect(refused.statusCode).toBe(503);
      expect(refused.json().error).toBe("storage_failed");
      expect(failing).toHaveBeenCalledTimes(STORAGE_ATTEMPTS);
    } finally {
      failing.mockRestore();
    }
    expect(await ownFiles(alice)).toEqual(expect.arrayContaining([fileOf(before.imageUrl), fileOf(before.imageThumbUrl)]));
    expect((await app.supabaseAdmin.from("moderation_actions").select("id").eq("target_id", gifts.id)).data).toEqual([]);

    const res = await removeImage(gifts.id, target.id, "Droits du photographe");
    expect(res.statusCode).toBe(200);
    const files = await ownFiles(alice);
    expect(files).not.toContain(fileOf(before.imageUrl));
    expect(files).not.toContain(fileOf(before.imageThumbUrl));
    const after: SharedCollectionPage = (await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).json();
    expect(after.items.find((entry) => entry.id === target.id)).toMatchObject({ imageUrl: null, imageThumbUrl: null, title: before.title });
    const { data: copy } = await app.supabaseAdmin.from("collection_image_copies").select("image_url, image_thumb_url, image_removed_at").eq("user_id", alice.id).is("image_url", null).single();
    expect(copy).toMatchObject({ image_url: null, image_thumb_url: null, image_removed_at: expect.any(String) });
    expect((await notifications(alice)).find((n) => n.type === "moderation")?.moderation).toEqual({ action: "remove_image", targetType: "collection", reason: "image_rights", note: "Droits du photographe" });
    expect((await notifications(bruno)).some((n) => n.type === "report_handled" && n.reportedType === "collection")).toBe(true);
    expect((await removeImage(gifts.id, target.id)).json().error).toBe("already_removed");
    expect((await request(admin, "POST", `/api/admin/moderation/actions/${res.json().actionId}/undo`, {})).json().error).toBe("not_undoable");
    // La base refuse une copie à moitié retirée.
    const half = await app.supabaseAdmin.from("collection_image_copies").update({ image_url: "https://exemple.test/x.jpg" }).eq("user_id", alice.id).is("image_url", null);
    expect(half.error?.code).toBe("23514");
  });

  it("masquer : les amis ne la voient plus, l'auteur la voit « masquée » et ne peut pas la remontrer ; rétablir", async () => {
    const hide = await decide({ targetType: "collection", targetId: gifts.id, action: "hide", reason: "inappropriate" });
    expect(hide.statusCode).toBe(200);
    expect((await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(404);
    const own = (await request(alice, "GET", "/api/collections")).json().collections as CollectionSummary[];
    expect(own.find((c) => c.id === gifts.id)).toMatchObject({ hidden: true });
    expect((await request(alice, "PATCH", `/api/collections/${gifts.id}`, { visibility: "private" })).statusCode).toBe(200);
    expect((await request(alice, "PATCH", `/api/collections/${gifts.id}`, { visibility: "friends" })).json().error).toBe("collection_hidden");
    expect((await notifications(alice)).find((n) => n.moderation?.action === "hide")?.moderation).toMatchObject({ targetType: "collection", reason: "inappropriate" });

    expect((await request(admin, "POST", `/api/admin/moderation/actions/${hide.json().actionId}/undo`, {})).statusCode).toBe(200);
    expect((await request(alice, "PATCH", `/api/collections/${gifts.id}`, { visibility: "friends" })).json()).toMatchObject({ visibility: "friends", hidden: false });
    expect((await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).statusCode).toBe(200);
    // L'image retirée n'a pas été recopiée en revenant chez les amis.
    const page: SharedCollectionPage = (await request(chloe, "GET", `/api/collections/${gifts.id}/shared`)).json();
    expect(page.items.filter((entry) => entry.imageUrl === null)).toHaveLength(1);
  });

  it("masquage automatique : 3 amis différents ; « Classer sans suite » le lève", async () => {
    const summer = await shared("Été", [wishes[2]!]);
    for (const friend of [bruno, chloe]) expect((await report(friend, summer.id, "spam")).statusCode).toBe(204);
    expect((await request(alice, "GET", "/api/collections")).json().collections.find((c: CollectionSummary) => c.id === summer.id)).toMatchObject({ hidden: false });
    expect((await report(dora, summer.id, "spam")).statusCode).toBe(204);
    expect((await request(alice, "GET", "/api/collections")).json().collections.find((c: CollectionSummary) => c.id === summer.id)).toMatchObject({ hidden: true });
    expect(await itemFor("open", summer.id)).toMatchObject({ activeHideAutomatic: true, preview: { hidden: true } });
    expect((await decide({ targetType: "collection", targetId: summer.id, action: "dismiss" })).statusCode).toBe(200);
    expect((await request(alice, "GET", "/api/collections")).json().collections.find((c: CollectionSummary) => c.id === summer.id)).toMatchObject({ hidden: false });
  });

  it("suspendre l'auteur depuis la collection, puis lever la suspension", async () => {
    expect((await report(chloe, gifts.id)).statusCode).toBe(204);
    const suspend = await decide({ targetType: "collection", targetId: gifts.id, action: "suspend", reason: "harassment" });
    expect(suspend.statusCode).toBe(200);
    expect((await request(dora, "GET", `/api/users/${alice.id}/collections`)).json()).toEqual({ collections: [] });
    expect((await request(admin, "POST", `/api/admin/moderation/actions/${suspend.json().actionId}/undo`, {})).statusCode).toBe(200);
    expect(((await request(dora, "GET", `/api/users/${alice.id}/collections`)).json() as SharedCollectionsList).collections.map((c) => c.id)).toContain(gifts.id);
  });

  it("export : le signalement chez Bruno, l'image retirée chez Alice", async () => {
    const brunoExport = (await request(bruno, "GET", "/api/me/export")).json();
    expect(brunoExport.reportsSubmitted).toEqual(expect.arrayContaining([expect.objectContaining({ target_type: "collection", target_id: gifts.id })]));
    const aliceExport = (await request(alice, "GET", "/api/me/export")).json();
    expect(aliceExport.collections.find((row: { id: string }) => row.id === gifts.id)).toHaveProperty("hidden_at", null);
    expect(aliceExport.collectionItems.some((row: { friends_image_removed_at: string | null }) => row.friends_image_removed_at !== null)).toBe(true);
  });
});
