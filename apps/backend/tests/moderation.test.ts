import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { AppNotification, ModerationItem, ModerationPage } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 5, section 5.B : modération minimaliste, réservée aux administrateurs
// (table « admins »). File des signalements regroupés par contenu,
// décisions journalisées et réversibles, information des personnes.
describe("modération : file, décisions et annulations (administrateurs seulement)", () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let author: TestUser; // auteur des contenus signalés
  let reporter: TestUser;
  let other: TestUser; // deuxième auteur de signalements
  let photo: Buffer;
  let postId = "";
  let hideActionId = "";

  const request = (user: TestUser | null, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: user ? authHeaders(user.token) : {}, payload });
  const decide = (payload: object, user: TestUser = admin) => request(user, "POST", "/api/admin/moderation/actions", payload);
  const undo = (actionId: string, payload: object = {}) => request(admin, "POST", `/api/admin/moderation/actions/${actionId}/undo`, payload);

  async function queue(status: "open" | "handled", cursor?: string): Promise<ModerationPage> {
    const query = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
    const res = await request(admin, "GET", `/api/admin/moderation?${query.toString()}`);
    expect(res.statusCode).toBe(200);
    return res.json();
  }
  const itemFor = async (status: "open" | "handled", targetId: string): Promise<ModerationItem | undefined> =>
    (await queue(status)).items.find((item) => item.targetId === targetId);

  async function report(user: TestUser, targetType: string, targetId: string, reason = "spam", note?: string) {
    const res = await request(user, "POST", "/api/reports", { targetType, targetId, reason, ...(note ? { note } : {}) });
    expect(res.statusCode).toBe(204);
  }
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications")).json();

  async function publish(user: TestUser, caption: string): Promise<string> {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public", caption }, { fieldname: "file", filename: "p.jpg", contentType: "image/jpeg", data: photo });
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    return res.json().id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [admin, author, reporter, other] = await Promise.all([
      createTestUser(app, "mda"),
      createTestUser(app, "mdu"),
      createTestUser(app, "mdr"),
      createTestUser(app, "mdo"),
    ]);
    photo = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#456" } }).jpeg().toBuffer();
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
    postId = await publish(author, "Publication signalée");
  });

  afterAll(async () => {
    for (const user of [admin, author, reporter, other]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("invisible pour un compte qui n'est pas administrateur (404) et sans connexion (401)", async () => {
    const routes: [InjectOptions["method"], string, object?][] = [
      ["GET", "/api/admin/moderation"],
      ["POST", "/api/admin/moderation/actions", { targetType: "user", targetId: author.id, action: "dismiss" }],
      ["POST", `/api/admin/moderation/actions/${randomUUID()}/undo`, {}],
    ];
    for (const [method, url, payload] of routes) {
      const refused = await request(reporter, method, url, payload);
      expect(refused.statusCode, url).toBe(404);
      expect(refused.json().error).toBe("not_found");
      expect((await request(null, method, url, payload)).statusCode, url).toBe(401);
    }
  });

  it("le profil indique le rôle d'administrateur (entrée « Modération » des Réglages)", async () => {
    expect((await request(admin, "GET", "/api/me")).json().isAdmin).toBe(true);
    expect((await request(reporter, "GET", "/api/me")).json().isAdmin).toBe(false);
  });

  it("refuse les entrées invalides (400)", async () => {
    expect((await request(admin, "GET", "/api/admin/moderation?status=tout")).statusCode).toBe(400);
    expect((await request(admin, "GET", "/api/admin/moderation?cursor=hier")).statusCode).toBe(400);
    const invalid = [
      { targetType: "post", targetId: postId, action: "hide" }, // sans motif
      { targetType: "user", targetId: author.id, action: "suspend" }, // sans motif
      { targetType: "user", targetId: author.id, action: "hide", reason: "spam" }, // un profil ne se masque pas
      { targetType: "post", targetId: "pas-un-identifiant", action: "dismiss" },
      { targetType: "vault", targetId: postId, action: "dismiss" },
      { targetType: "post", targetId: postId, action: "delete", reason: "spam" },
      { targetType: "post", targetId: postId, action: "hide", reason: "spam", note: "x".repeat(501) },
    ];
    for (const payload of invalid) expect((await decide(payload)).statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    expect((await request(admin, "POST", "/api/admin/moderation/actions/abc/undo", {})).statusCode).toBe(400);
    expect((await undo(randomUUID(), { note: "x".repeat(501) })).statusCode).toBe(400);
  });

  it("regroupe les signalements par contenu, sans jamais dire qui a signalé", async () => {
    await report(reporter, "post", postId, "spam", "Note A");
    await report(other, "post", postId, "harassment", "Note B");
    const res = await request(admin, "GET", "/api/admin/moderation?status=open");
    const item = (res.json() as ModerationPage).items.find((entry) => entry.targetId === postId);
    expect(item).toMatchObject({
      targetType: "post",
      reportCount: 2,
      reasons: { spam: 1, harassment: 1 },
      notes: ["Note B", "Note A"],
      activeHideActionId: null,
      activeSuspendActionId: null,
      history: [],
    });
    expect(item?.preview).toMatchObject({ kind: "post", caption: "Publication signalée", hidden: false, author: { id: author.id, suspended: false } });
    for (const secret of [reporter.id, other.id, reporter.username, other.username]) expect(res.body).not.toContain(secret);
  });

  it("masquer : journalisé, signalements traités, motif transmis à la personne concernée, auteurs des signalements informés une fois", async () => {
    await report(reporter, "post", postId, "inappropriate"); // deuxième signalement de la même personne
    const res = await decide({ targetType: "post", targetId: postId, action: "hide", reason: "harassment", note: "Propos insultants." });
    expect(res.statusCode).toBe(200);
    hideActionId = res.json().actionId;

    expect(await itemFor("open", postId)).toBeUndefined();
    const handled = await itemFor("handled", postId);
    expect(handled).toMatchObject({ reportCount: 3, activeHideActionId: hideActionId, preview: { kind: "post", hidden: true } });
    expect(handled?.history[0]).toMatchObject({ id: hideActionId, action: "hide", reason: "harassment", note: "Propos insultants.", adminUsername: admin.username });

    const forAuthor = (await notifications(author)).filter((n) => n.type === "moderation");
    expect(forAuthor).toHaveLength(1);
    expect(forAuthor[0]).toMatchObject({ actor: null, moderation: { action: "hide", targetType: "post", reason: "harassment", note: "Propos insultants." } });
    for (const user of [reporter, other]) {
      const handledNotices = (await notifications(user)).filter((n) => n.type === "report_handled");
      expect(handledNotices).toHaveLength(1);
      expect(handledNotices[0]).toMatchObject({ actor: null, moderation: null, postId: null });
    }
    const authorView = (await request(author, "GET", "/api/notifications")).body;
    for (const secret of [admin.id, admin.username]) expect(authorView).not.toContain(secret);
  });

  it("refuse de masquer deux fois (409)", async () => {
    const res = await decide({ targetType: "post", targetId: postId, action: "hide", reason: "spam" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_hidden");
  });

  it("annuler : la publication revient, la personne en est informée, une seule annulation possible", async () => {
    const res = await undo(hideActionId, { note: "Erreur d'appréciation." });
    expect(res.statusCode).toBe(200);
    expect((await request(other, "GET", `/api/posts/${postId}`)).statusCode).toBe(200);

    const restored = (await notifications(author)).find((n) => n.moderation?.action === "restore");
    expect(restored).toMatchObject({ type: "moderation", actor: null, moderation: { targetType: "post", note: "Erreur d'appréciation." } });
    const handled = await itemFor("handled", postId);
    expect(handled).toMatchObject({ activeHideActionId: null, preview: { kind: "post", hidden: false } });
    expect(handled?.history.map((entry) => entry.action)).toEqual(["restore", "hide"]);

    const again = await undo(hideActionId);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_undone");
  });

  it("classer sans suite : signalements traités, aucun message à la personne concernée, une seule fois", async () => {
    await report(reporter, "user", author.id, "spam");
    const before = (await notifications(author)).length;
    const res = await decide({ targetType: "user", targetId: author.id, action: "dismiss" });
    expect(res.statusCode).toBe(200);
    expect((await notifications(author)).length).toBe(before);
    expect((await notifications(reporter)).filter((n) => n.type === "report_handled")).toHaveLength(2);

    const again = await decide({ targetType: "user", targetId: author.id, action: "dismiss" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_handled");
    // Seuls un masquage ou une suspension s'annulent.
    expect((await undo(res.json().actionId)).statusCode).toBe(404);
  });

  it("contenu supprimé depuis : aperçu « supprimé », seulement classé sans suite", async () => {
    const ghost = randomUUID();
    await report(reporter, "post", ghost, "spam");
    expect((await itemFor("open", ghost))?.preview).toEqual({ kind: "missing" });
    expect((await decide({ targetType: "post", targetId: ghost, action: "hide", reason: "spam" })).statusCode).toBe(404);
    expect((await decide({ targetType: "post", targetId: ghost, action: "dismiss" })).statusCode).toBe(200);
    expect(await itemFor("open", ghost)).toBeUndefined();
    // Rien à traiter sur un identifiant inconnu.
    expect((await decide({ targetType: "comment", targetId: randomUUID(), action: "dismiss" })).statusCode).toBe(404);
  });

  it("file paginée : 20 contenus par page, curseur jusqu'au dernier", async () => {
    const targets = Array.from({ length: 22 }, () => randomUUID());
    const { error } = await app.supabaseAdmin.from("reports").insert(
      targets.map((targetId, index) => ({
        reporter_id: reporter.id,
        target_type: "user",
        target_id: targetId,
        reason: "spam",
        created_at: new Date(Date.UTC(1990, 0, 1, 0, index)).toISOString(),
      }))
    );
    if (error) throw error;
    const first = await queue("open", "1990-12-31T00:00:00Z");
    expect(first.items).toHaveLength(20);
    expect(first.items.map((item) => item.targetId)).toEqual(targets.slice(2).reverse());
    expect(first.nextCursor).not.toBeNull();
    const second = await queue("open", first.nextCursor!);
    expect(second.items.map((item) => item.targetId)).toEqual(targets.slice(0, 2).reverse());
    expect(second.nextCursor).toBeNull();
  });

  it("fonctions et tables de la modération réservées au serveur", async () => {
    const visitor = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${admin.token}` } },
    });
    for (const client of [visitor, signedIn]) {
      const apply = { p_admin_id: admin.id, p_action: "dismiss", p_target_type: "user", p_target_id: author.id, p_reason: null, p_note: null };
      expect((await client.rpc("moderation_apply", apply)).error).not.toBeNull();
      expect((await client.rpc("moderation_undo", { p_admin_id: admin.id, p_action_id: hideActionId, p_note: null })).error).not.toBeNull();
      expect((await client.rpc("moderation_queue", { p_handled: false })).error).not.toBeNull();
      expect((await client.rpc("moderation_set_hidden", { p_target_type: "post", p_target_id: postId, p_at: null })).error).not.toBeNull();
      for (const table of ["admins", "suspensions", "moderation_actions"]) {
        const read = await client.from(table).select("*").limit(1);
        expect(read.data ?? [], table).toEqual([]);
      }
    }
  });
});
