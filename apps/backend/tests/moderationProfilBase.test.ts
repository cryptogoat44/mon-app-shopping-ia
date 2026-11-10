import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { AppNotification, ModerationItem, ModerationPage, Profile, UserProfile } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { AVATAR_BUCKET } from "../src/lib/profileModeration.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Modération des profils (lot « conformité Apple », migration 0037), sur la
// vraie base de développement (spotto-dev-2, sur le Mac du fondateur) :
// retirer une bio et une photo de profil avec le vrai SQL de 0037
// (contrainte du journal, fonction, notifications, signalements classés) et
// le vrai stockage ; bio et photo d'un compte suspendu cachées aux autres.
// Sauté tant que 0037 n'est pas appliquée sur la base des tests.

const NOBODY = "00000000-0000-0000-0000-000000000000";
const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// La fonction de 0037, appelée sans administrateur : elle refuse sans rien écrire.
const migrated = !(await service.rpc("moderation_remove_profile_part", { p_admin_id: NOBODY, p_user_id: NOBODY, p_part: "bio", p_reason: null, p_note: null })).error;
const ROUTE = "/api/admin/moderation/remove-profile-part";
const BIO = "Bio à retirer par la modération";

describe.skipIf(!migrated)("modération des profils, sur la base de développement (0037)", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let alice: TestUser; // profil signalé
  let bruno: TestUser; // signale Alice
  let chloe: TestUser; // ne signale rien

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();
  const profileSeenBy = async (viewer: TestUser): Promise<UserProfile> => (await request(viewer, "GET", `/api/users/${alice.id}`)).json();
  const avatarFiles = async () => {
    const { data, error } = await app.supabaseAdmin.storage.from(AVATAR_BUCKET).list(alice.id, { limit: 100 });
    if (error) throw error;
    return (data ?? []).map((file) => file.name);
  };
  async function itemFor(status: "open" | "handled"): Promise<ModerationItem | undefined> {
    const page: ModerationPage = (await request(admin, "GET", `/api/admin/moderation?status=${status}`)).json();
    return page.items.find((item) => item.targetType === "user" && item.targetId === alice.id);
  }
  async function uploadAvatar(): Promise<string> {
    const jpeg = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#406080" } }).jpeg().toBuffer();
    const { payload, headers } = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: jpeg });
    const res = await app.inject({ method: "POST", url: "/api/me/avatar", headers: { ...authHeaders(alice.token), ...headers }, payload });
    expect(res.statusCode).toBe(200);
    return (res.json() as Profile).avatarUrl!;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    const users = await Promise.all(["mpa", "mpl", "mpb", "mpc"].map((label) => createTestUser(app, label)));
    [admin, alice, bruno, chloe] = users as [TestUser, TestUser, TestUser, TestUser];
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    const patched = await request(alice, "PATCH", "/api/me", { username: alice.username, displayName: "Alice", bio: BIO });
    expect(patched.statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    for (const user of [admin, alice, bruno, chloe]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("la file propose « Retirer la bio » et « Retirer la photo de profil » pour un profil signalé qui en a", async () => {
    await uploadAvatar();
    expect(await avatarFiles()).toHaveLength(1);
    expect((await request(bruno, "POST", "/api/reports", { targetType: "user", targetId: alice.id, reason: "inappropriate" })).statusCode).toBe(204);
    const item = await itemFor("open");
    expect(item).toMatchObject({ canRemoveBio: true, canRemoveAvatar: true, preview: { kind: "user", bio: BIO } });
  });

  it("refus du vrai SQL : sans administrateur, entrées invalides, profil inconnu ; rien n'est écrit", async () => {
    const call = async (args: Record<string, unknown>) => {
      const { data, error } = await service.rpc("moderation_remove_profile_part", { p_admin_id: admin.id, p_user_id: alice.id, p_part: "bio", p_reason: "spam", p_note: null, ...args });
      expect(error).toBeNull();
      return (data as { outcome: string; action_id: string | null }[])[0];
    };
    expect(await call({ p_admin_id: bruno.id })).toEqual({ outcome: "not_admin", action_id: null });
    expect(await call({ p_admin_id: null })).toEqual({ outcome: "not_admin", action_id: null });
    expect(await call({ p_part: "username" })).toEqual({ outcome: "invalid", action_id: null });
    expect(await call({ p_reason: null })).toEqual({ outcome: "invalid", action_id: null });
    expect(await call({ p_reason: "image_rights" })).toEqual({ outcome: "invalid", action_id: null });
    expect(await call({ p_user_id: NOBODY })).toEqual({ outcome: "target_not_found", action_id: null });
    const { data } = await app.supabaseAdmin.from("moderation_actions").select("id").eq("target_id", alice.id);
    expect(data).toEqual([]);
    expect((await request(bruno, "POST", ROUTE, { userId: alice.id, part: "bio", reason: "spam" })).statusCode).toBe(404);
  });

  it("retirer la bio : vidée, décision au journal (la base accepte « remove_bio »), personne prévenue, signalement classé", async () => {
    const res = await request(admin, "POST", ROUTE, { userId: alice.id, part: "bio", reason: "harassment", note: "Propos visant une personne." });
    expect(res.statusCode).toBe(200);
    const { actionId } = res.json() as { actionId: string };
    const { data: stored } = await app.supabaseAdmin.from("profiles").select("bio, avatar_url").eq("id", alice.id).single();
    expect(stored).toMatchObject({ bio: null });
    expect(stored!.avatar_url).not.toBeNull();
    const { data: actions } = await app.supabaseAdmin.from("moderation_actions").select("id, admin_id, action, target_type, target_id, target_user_id, reason, note").eq("id", actionId);
    expect(actions).toEqual([{ id: actionId, admin_id: admin.id, action: "remove_bio", target_type: "user", target_id: alice.id, target_user_id: alice.id, reason: "harassment", note: "Propos visant une personne." }]);
    const mine = await notifications(alice);
    expect(mine[0]).toMatchObject({ type: "moderation", actor: null, moderation: { action: "remove_bio", targetType: "user", reason: "harassment", note: "Propos visant une personne." } });
    expect((await notifications(bruno))[0]).toMatchObject({ type: "report_handled", reportedType: "user" });
    expect(await notifications(chloe)).toEqual([]);
    expect(await itemFor("open")).toBeUndefined();
    const handled = await itemFor("handled");
    expect(handled).toMatchObject({ canRemoveBio: false, canRemoveAvatar: true });
    expect(handled!.history[0]).toMatchObject({ id: actionId, action: "remove_bio", reason: "harassment", adminUsername: admin.username });
    const again = await request(admin, "POST", ROUTE, { userId: alice.id, part: "bio", reason: "harassment" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "nothing_to_remove" });
  });

  it("retirer la photo : le fichier quitte le vrai stockage, l'adresse est vidée, la décision ne s'annule pas", async () => {
    const res = await request(admin, "POST", ROUTE, { userId: alice.id, part: "avatar", reason: "inappropriate" });
    expect(res.statusCode).toBe(200);
    const { actionId } = res.json() as { actionId: string };
    expect(await avatarFiles()).toEqual([]);
    const { data: stored } = await app.supabaseAdmin.from("profiles").select("avatar_url").eq("id", alice.id).single();
    expect(stored).toEqual({ avatar_url: null });
    expect((await notifications(alice))[0]).toMatchObject({ type: "moderation", moderation: { action: "remove_avatar", targetType: "user", reason: "inappropriate" } });
    expect((await profileSeenBy(chloe)).avatarUrl).toBeNull();
    // moderation_undo (0026) : ni un masquage ni une suspension.
    const undo = await request(admin, "POST", `/api/admin/moderation/actions/${actionId}/undo`, {});
    expect(undo.statusCode).toBe(404);
    expect(undo.json()).toMatchObject({ error: "target_not_found" });
    // Alice peut remettre une bio et une photo (elle n'est pas suspendue).
    expect((await request(alice, "PATCH", "/api/me", { username: alice.username, displayName: "Alice", bio: "Nouvelle bio" })).statusCode).toBe(200);
    await uploadAvatar();
  });

  it("compte suspendu : bio et photo cachées aux autres, visibles de lui-même et de l'administrateur dans la file ; elles reviennent à la levée", async () => {
    expect(await profileSeenBy(chloe)).toMatchObject({ bio: "Nouvelle bio" });
    expect((await profileSeenBy(chloe)).avatarUrl).not.toBeNull();
    expect((await request(chloe, "POST", "/api/reports", { targetType: "user", targetId: alice.id, reason: "spam" })).statusCode).toBe(204);
    const suspended = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "user", targetId: alice.id, action: "suspend", reason: "spam" });
    expect(suspended.statusCode).toBe(200);
    expect(await profileSeenBy(chloe)).toMatchObject({ username: alice.username, bio: null, avatarUrl: null });
    expect(await profileSeenBy(alice)).toMatchObject({ bio: "Nouvelle bio", isMe: true });
    expect((await profileSeenBy(alice)).avatarUrl).not.toBeNull();
    const item = await itemFor("handled");
    expect(item).toMatchObject({ canRemoveBio: true, canRemoveAvatar: true, preview: { kind: "user", bio: "Nouvelle bio", author: { suspended: true } } });
    // Rien n'a été effacé : la levée de la suspension les remontre.
    expect(await avatarFiles()).toHaveLength(1);
    const undo = await request(admin, "POST", `/api/admin/moderation/actions/${(suspended.json() as { actionId: string }).actionId}/undo`, {});
    expect(undo.statusCode).toBe(200);
    expect(await profileSeenBy(chloe)).toMatchObject({ bio: "Nouvelle bio" });
    expect((await profileSeenBy(chloe)).avatarUrl).not.toBeNull();
  });
});
