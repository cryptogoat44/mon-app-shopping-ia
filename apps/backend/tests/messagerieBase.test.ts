import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { ConversationThread, ConversationsPage, ModerationPage, SendMessageResponse, WishlistItem } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { downloadPublicImage } from "../src/lib/publicImage.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Messages privés (lot messages, migration 0032), sur la vraie base de
// développement (spotto-dev-2, sur le Mac du fondateur) : le parcours
// complet avec les vraies tables, le déclencheur (aperçu, « non lu »), la
// suppression en cascade avec un compte, la modération d'un message.
// Sauté tant que 0032 n'est pas appliquée sur la base des tests. Le
// téléchargement de l'image d'une envie est simulé : aucun site extérieur
// n'est appelé.
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const downloadMock = vi.mocked(downloadPublicImage);

const probe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("messages").select("id").limit(0);
const migrated = !probe.error;
const OUR_STORAGE = `${env.SUPABASE_URL}/storage/v1/object/public/post-media/`;

describe.skipIf(!migrated)("messages privés, sur la base de développement (0032)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // amie de Bruno (chacun suit l'autre)
  let bruno: TestUser;
  let chloe: TestUser; // ne suit personne
  let admin: TestUser;
  const extra: TestUser[] = [];

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const send = (from: TestUser, to: TestUser, body: { text?: string; wishId?: string }) => request(from, "POST", "/api/messages", { recipientId: to.id, ...body });
  const unread = async (user: TestUser): Promise<number> => (await request(user, "GET", "/api/messages/status")).json().unreadCount;
  const page = async (user: TestUser): Promise<ConversationsPage> => (await request(user, "GET", "/api/conversations")).json();
  const thread = async (user: TestUser, id: string): Promise<ConversationThread> => (await request(user, "GET", `/api/conversations/${id}`)).json();

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno, chloe, admin] = await Promise.all([createTestUser(app, "msga"), createTestUser(app, "msgb"), createTestUser(app, "msgc"), createTestUser(app, "msgd")]);
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
    const { error } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (error) throw error;
  }, 60_000);

  afterAll(async () => {
    await app.supabaseAdmin.from("admins").delete().eq("user_id", admin.id);
    for (const user of [alice, bruno, chloe, admin, ...extra]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("la messagerie est disponible", async () => {
    expect((await request(alice, "GET", "/api/messages/status")).json()).toEqual({ enabled: true, unreadCount: 0 });
    expect((await request(alice, "GET", "/api/me")).json().messagesFrom).toBe("everyone");
  });

  it("deux amis : conversation ouverte, aperçu et « non lu » tenus par la base, marquée lue à l'ouverture", async () => {
    const res = await send(alice, bruno, { text: "Tu as vu ce sac ?" });
    expect(res.statusCode).toBe(201);
    const sent: SendMessageResponse = res.json();
    expect(sent).toMatchObject({ state: "open", sendMode: "direct" });
    expect(await unread(bruno)).toBe(1);
    const brunoPage = await page(bruno);
    expect(brunoPage.conversations[0]).toMatchObject({ id: sent.conversationId, unread: true, lastMessage: { text: "Tu as vu ce sac ?", mine: false } });
    expect((await thread(bruno, sent.conversationId)).messages.map((m) => m.text)).toEqual(["Tu as vu ce sac ?"]);
    expect((await request(bruno, "POST", `/api/conversations/${sent.conversationId}/read`)).statusCode).toBe(204);
    expect(await unread(bruno)).toBe(0);
    const reply = await send(bruno, alice, { text: "Superbe" });
    expect(reply.json().conversationId).toBe(sent.conversationId);
    // Relecture : seulement le nouveau message.
    const since = await thread(alice, `${sent.conversationId}?after=${encodeURIComponent(sent.message.createdAt)}`);
    expect(since.messages.map((m) => m.text)).toEqual(["Superbe"]);
  });

  it("invitation : une seule, refus discret, pas de nouvelle invitation avant 30 jours", async () => {
    const first = await send(chloe, bruno, { text: "Bonjour, j'aime vos envies" });
    expect(first.json()).toMatchObject({ state: "invitation_sent", sendMode: "waiting" });
    expect((await send(chloe, bruno, { text: "Encore" })).statusCode).toBe(409);
    const id = first.json().conversationId as string;
    expect((await page(bruno)).invitations.map((c) => c.id)).toContain(id);
    expect((await request(bruno, "POST", `/api/conversations/${id}/decline`)).statusCode).toBe(204);
    expect((await page(bruno)).invitations.map((c) => c.id)).not.toContain(id);
    expect((await request(bruno, "GET", `/api/conversations/${id}`)).statusCode).toBe(404);
    expect((await thread(chloe, id)).sendMode).toBe("waiting");
    expect((await send(chloe, bruno, { text: "Toujours là ?" })).statusCode).toBe(409);

    // Refus vieux de 31 jours : une nouvelle invitation, sans l'ancienne pour Bruno.
    const { error } = await app.supabaseAdmin
      .from("conversation_participants")
      .update({ invitation_at: new Date(Date.now() - 31 * 24 * 3_600_000).toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", bruno.id);
    expect(error).toBeNull();
    expect((await send(chloe, bruno, { text: "Nouvelle invitation" })).statusCode).toBe(201);
    expect((await thread(bruno, id)).messages.map((m) => m.text)).toEqual(["Nouvelle invitation"]);
  });

  it("accepter : la conversation s'ouvre pour les deux", async () => {
    const id = (await send(chloe, alice, { text: "Bonjour Alice" })).json().conversationId as string;
    expect((await thread(alice, id)).sendMode).toBe("answer");
    expect((await request(alice, "POST", `/api/conversations/${id}/accept`)).statusCode).toBe(204);
    expect((await thread(chloe, id)).sendMode).toBe("direct");
    expect((await send(chloe, alice, { text: "Merci" })).statusCode).toBe(201);
  });

  it("réglage « Qui peut m'écrire » : seulement mes amis", async () => {
    const dora = await createTestUser(app, "msge");
    extra.push(dora);
    expect((await request(dora, "PUT", "/api/me/messages-from", { messagesFrom: "nobody" })).statusCode).toBe(204);
    expect((await send(chloe, dora, { text: "Bonjour" })).statusCode).toBe(403);
    expect((await request(dora, "GET", "/api/me")).json().messagesFrom).toBe("nobody");
  });

  it("blocage : conversation cachée et envoi refusé, dans les deux sens ; elle revient au déblocage", async () => {
    const id = (await page(alice)).conversations.find((c) => c.other.id === bruno.id)!.id;
    expect((await request(bruno, "POST", `/api/blocks/${alice.id}`)).statusCode).toBe(204);
    for (const user of [alice, bruno]) expect((await request(user, "GET", `/api/conversations/${id}`)).statusCode).toBe(404);
    expect((await send(alice, bruno, { text: "Pourquoi ?" })).statusCode).toBe(404);
    expect((await page(alice)).conversations.map((c) => c.id)).not.toContain(id);
    expect((await request(bruno, "DELETE", `/api/blocks/${alice.id}`)).statusCode).toBe(204);
    expect((await request(alice, "GET", `/api/conversations/${id}`)).statusCode).toBe(200);
  });

  it("envie jointe : la copie de l'image dans notre stockage, jamais l'adresse du marchand", async () => {
    downloadMock.mockResolvedValue(await sharp({ create: { width: 400, height: 500, channels: 3, background: "#806040" } }).jpeg().toBuffer());
    const wish: WishlistItem = (
      await request(alice, "POST", "/api/wishlist", { title: "Sac cabas", imageUrl: "https://images.marchand.test/sac.jpg", merchantName: "Marchand", merchantUrl: "https://marchand.test/sac", priceMin: 129, currency: "EUR" })
    ).json();
    const res = await send(alice, bruno, { wishId: wish.id, text: "Pour toi" });
    expect(res.statusCode).toBe(201);
    const card = res.json().message.wish;
    expect(card.imageUrl.startsWith(`${OUR_STORAGE}${alice.id}/`)).toBe(true);
    expect(card).toMatchObject({ title: "Sac cabas", merchantUrl: "https://marchand.test/sac", priceMin: 129 });
    expect(JSON.stringify(res.json())).not.toContain("images.marchand.test");
  });

  it("signaler un message : la modération voit le message et quelques messages autour, puis peut le masquer", async () => {
    const id = (await page(alice)).conversations.find((c) => c.other.id === chloe.id)!.id;
    const target = (await thread(alice, id)).messages.find((m) => !m.mine)!;
    expect((await request(alice, "POST", "/api/reports", { targetType: "message", targetId: target.id, reason: "harassment" })).statusCode).toBe(204);
    expect((await request(chloe, "POST", "/api/reports", { targetType: "message", targetId: target.id, reason: "spam" })).statusCode).toBe(404);
    const queue: ModerationPage = (await request(admin, "GET", "/api/admin/moderation?status=open")).json();
    const item = queue.items.find((entry) => entry.targetId === target.id)!;
    expect(item.targetType).toBe("message");
    expect(item.preview.kind).toBe("message");
    if (item.preview.kind !== "message") return;
    expect(item.preview.context.some((entry) => entry.reported && entry.text === target.text)).toBe(true);
    expect(item.preview.context.length).toBeLessThanOrEqual(5);
    const decision = await request(admin, "POST", "/api/admin/moderation/actions", { targetType: "message", targetId: target.id, action: "hide", reason: "harassment" });
    expect(decision.statusCode).toBe(200);
    expect((await thread(chloe, id)).messages.map((m) => m.id)).not.toContain(target.id);
  });

  it("export : conversations et messages, avec le @nom de l'autre membre", async () => {
    const body = (await request(alice, "GET", "/api/me/export")).json();
    expect(body.conversations.map((row: { other_username: string }) => row.other_username).sort()).toEqual([bruno.username, chloe.username].sort());
    expect(body.messages.map((row: { body: string | null }) => row.body)).toEqual(expect.arrayContaining(["Tu as vu ce sac ?", "Superbe", "Merci"]));
  });

  it("les tables restent fermées au public (aucune règle d'accès)", async () => {
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const table of ["messages", "conversations", "conversation_participants"]) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? []).toEqual([]);
    }
  });

  it("suppression d'un compte : ses conversations disparaissent pour les deux membres, avec leurs messages", async () => {
    const conversationIds = (await page(chloe)).conversations.map((c) => c.id);
    expect(conversationIds.length).toBeGreaterThan(0);
    expect((await request(chloe, "DELETE", "/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect((await page(alice)).conversations.map((c) => c.other.id)).not.toContain(chloe.id);
    const { count: left } = await app.supabaseAdmin.from("messages").select("id", { count: "exact", head: true }).in("conversation_id", conversationIds);
    expect(left).toBe(0);
    const { count: conversations } = await app.supabaseAdmin.from("conversations").select("id", { count: "exact", head: true }).in("id", conversationIds);
    expect(conversations).toBe(0);
  });
});
