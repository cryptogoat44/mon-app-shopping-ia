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

const probeClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const probe = await probeClient.from("messages").select("id").limit(0);
const migrated = !probe.error;
// Lot « messages vus » : le réglage « Confirmations de lecture » et la date
// depuis laquelle les lectures peuvent être montrées (migration 0043, deux colonnes).
const receiptsMigrated = migrated && !(await probeClient.from("profiles").select("read_receipts, read_receipts_since").limit(0)).error;
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
    // `push` dépend de PUSH_ENABLED et de la migration 0035 sur cette base (lot notifications).
    expect((await request(alice, "GET", "/api/messages/status")).json()).toEqual({ enabled: true, unreadCount: 0, push: expect.any(Boolean) });
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

// Confirmations de lecture (lot « messages vus », migration 0043), sur la
// vraie base de développement : les colonnes de 0043, les vraies dates
// (messages et profils datés par la base, lectures par le serveur), le
// parcours d'une invitation, et jamais une lecture faite réglage éteint.
// Sauté tant que 0032 n'est pas appliquée ; chaque essai dit
// s'il demande 0043 ou son absence. Les règles elles-mêmes, cas par cas :
// confirmationsLecture.test.ts (sans base).
describe.skipIf(!migrated)("confirmations de lecture, sur la base de développement (0043)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // amie de Bruno (chacun suit l'autre)
  let bruno: TestUser;
  let chloe: TestUser; // ne suit personne

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const send = async (from: TestUser, to: TestUser, text: string): Promise<SendMessageResponse> => {
    const res = await request(from, "POST", "/api/messages", { recipientId: to.id, text });
    expect(res.statusCode).toBe(201);
    return res.json();
  };
  const thread = async (user: TestUser, id: string, after?: string): Promise<ConversationThread> =>
    (await request(user, "GET", `/api/conversations/${id}${after ? `?after=${encodeURIComponent(after)}` : ""}`)).json();
  const open = async (user: TestUser, id: string) => expect((await request(user, "POST", `/api/conversations/${id}/read`)).statusCode).toBe(204);
  const since = async (user: TestUser): Promise<string> => {
    const { data, error } = await app.supabaseAdmin.from("profiles").select("read_receipts_since").eq("id", user.id).single();
    expect(error).toBeNull();
    return (data as { read_receipts_since: string }).read_receipts_since;
  };
  const lastReadAt = async (user: TestUser, id: string): Promise<string | null> => {
    const { data, error } = await app.supabaseAdmin.from("conversation_participants").select("last_read_at").eq("conversation_id", id).eq("user_id", user.id).single();
    expect(error).toBeNull();
    return (data as { last_read_at: string | null }).last_read_at;
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno, chloe] = await Promise.all([createTestUser(app, "vua"), createTestUser(app, "vub"), createTestUser(app, "vuc")]);
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
  }, 60_000);

  afterAll(async () => {
    for (const user of [alice, bruno, chloe]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  it.skipIf(receiptsMigrated)("sans 0043 : rien n'est renvoyé, le réglage n'est pas proposé, la messagerie fonctionne", async () => {
    const sent = await send(alice, bruno, "Tu as vu ce sac ?");
    expect(sent).toMatchObject({ state: "open", sendMode: "direct", readReceipts: null });
    await open(bruno, sent.conversationId);
    expect(await lastReadAt(bruno, sent.conversationId)).not.toBeNull();
    expect((await thread(alice, sent.conversationId)).readReceipts).toBeNull();
    expect((await thread(alice, sent.conversationId, sent.message.createdAt)).readReceipts).toBeNull();
    expect((await request(alice, "GET", "/api/me")).json()).not.toHaveProperty("readReceipts");
    const refused = await request(alice, "PUT", "/api/me/read-receipts", { readReceipts: false });
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error).toBe("read_receipts_unavailable");
  });

  it.skipIf(!receiptsMigrated)("deux amis : « Envoyé », puis « Vu » une fois la conversation ouverte par l'autre (vraies dates de la base et du serveur)", async () => {
    expect((await request(alice, "GET", "/api/me")).json().readReceipts).toBe(true);
    const sent = await send(alice, bruno, "Tu as vu ce sac ?");
    const id = sent.conversationId;
    expect(sent.readReceipts).toEqual({ seenAt: null });
    expect((await thread(alice, id)).readReceipts).toEqual({ seenAt: null });
    await open(bruno, id);
    const seenAt = (await thread(alice, id)).readReceipts?.seenAt;
    expect(typeof seenAt).toBe("string");
    // La lecture couvre le message, même si l'horloge de ce Mac retarde sur celle de la base…
    const firstRead = (await lastReadAt(bruno, id))!;
    expect(Date.parse(firstRead)).toBeGreaterThanOrEqual(Date.parse(sent.message.createdAt));
    // … et Alice reçoit la date de SON message, jamais l'heure de la lecture de Bruno.
    expect(Date.parse(seenAt!)).toBe(Date.parse(sent.message.createdAt));
    // La relecture de l'app (aucun nouveau message) la renvoie aussi.
    const poll = await thread(alice, id, sent.message.createdAt);
    expect(poll.messages).toEqual([]);
    expect(poll.readReceipts).toEqual({ seenAt });
    // Bruno rouvre la conversation plus tard : sa lecture est datée dans la base, la réponse faite à Alice ne bouge pas.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await open(bruno, id);
    expect(Date.parse((await lastReadAt(bruno, id))!)).toBeGreaterThanOrEqual(Date.parse(firstRead));
    expect((await thread(alice, id)).readReceipts).toEqual({ seenAt });
    expect((await thread(alice, id, sent.message.createdAt)).readReceipts).toEqual({ seenAt });
    // Un nouveau message : « Envoyé » tant que Bruno n'a pas rouvert la conversation.
    const second = await send(alice, bruno, "Il te plaît ?");
    expect(second.readReceipts).toEqual({ seenAt: null });
    // Bruno, lui, ne reçoit que la lecture d'Alice (jamais marquée) : rien encore.
    expect((await thread(bruno, id)).readReceipts).toEqual({ seenAt: null });
  });

  it.skipIf(!receiptsMigrated)("réciproque : éteint chez l'un des deux, aucun des deux ne reçoit rien ; rallumé, aucune lecture d'avant ne revient (ni les siennes, ni celles de l'autre), celles d'après sont montrées", async () => {
    const id = (await send(alice, bruno, "Encore un mot")).conversationId;
    await open(bruno, id);
    // Bruno écrit, Alice lit : « Vu » sous le message de Bruno, tant que les deux réglages sont allumés.
    const reply = await send(bruno, alice, "Je suis là");
    await open(alice, id);
    expect(Date.parse((await thread(bruno, id)).readReceipts!.seenAt!)).toBe(Date.parse(reply.message.createdAt));
    const sinceBefore = await since(bruno);
    expect((await request(bruno, "PUT", "/api/me/read-receipts", { readReceipts: false })).statusCode).toBe(204);
    expect((await request(bruno, "GET", "/api/me")).json().readReceipts).toBe(false);
    // Éteindre ne déplace pas la date.
    expect(await since(bruno)).toBe(sinceBefore);
    for (const user of [alice, bruno]) expect((await thread(user, id)).readReceipts).toBeNull();
    expect((await send(alice, bruno, "Vous êtes là ?")).readReceipts).toBeNull();
    // Bruno lit, réglage éteint : la lecture est datée comme avant (non-lus), jamais montrée ensuite.
    await open(bruno, id);
    const whileOff = (await lastReadAt(bruno, id))!;
    expect((await request(bruno, "PUT", "/api/me/read-receipts", { readReceipts: "non" })).statusCode).toBe(400);
    expect((await request(bruno, "PUT", "/api/me/read-receipts", { readReceipts: true })).statusCode).toBe(204);
    // Rallumé : « depuis » est passé APRÈS tout ce que Bruno a lu jusque-là.
    const sinceAfter = await since(bruno);
    expect(Date.parse(sinceAfter)).toBeGreaterThan(Date.parse(whileOff));
    expect(Date.parse(sinceAfter)).toBeGreaterThan(Date.parse(sinceBefore));
    // Alice ne voit aucune des lectures d'avant de Bruno (« Envoyé »). Réciproque : Bruno ne voit plus
    // la lecture qu'Alice a faite avant qu'il rallume.
    const forAlice = await thread(alice, id);
    expect(forAlice.readReceipts).toEqual({ seenAt: null });
    expect((await thread(bruno, id)).readReceipts).toEqual({ seenAt: null });
    // Un message de Bruno, lu par Alice pendant que les deux réglages sont allumés : « Vu ».
    const again = await send(bruno, alice, "Toujours là");
    expect(again.readReceipts).toEqual({ seenAt: null });
    await open(alice, id);
    expect(Date.parse((await thread(bruno, id)).readReceipts!.seenAt!)).toBe(Date.parse(again.message.createdAt));
    // Rallumer une seconde fois ne déplace pas la date.
    expect((await request(bruno, "PUT", "/api/me/read-receipts", { readReceipts: true })).statusCode).toBe(204);
    expect(await since(bruno)).toBe(sinceAfter);
    // Un nouveau message, lu réglage allumé : « Vu ».
    const next = await send(alice, bruno, "Et maintenant ?");
    expect(next.readReceipts).toEqual({ seenAt: null });
    await open(bruno, id);
    const seenAt = (await thread(alice, id)).readReceipts?.seenAt;
    expect(typeof seenAt).toBe("string");
    expect(Date.parse(seenAt!)).toBe(Date.parse(next.message.createdAt));
    expect(Date.parse((await lastReadAt(bruno, id))!)).toBeGreaterThanOrEqual(Date.parse(sinceAfter));
    // Le réglage et sa date figurent dans l'export des données.
    const exported = (await request(bruno, "GET", "/api/me/export")).json().profile;
    expect(exported.read_receipts).toBe(true);
    expect(Date.parse(exported.read_receipts_since)).toBe(Date.parse(sinceAfter));
  });

  // Chloé, la personne invitée, n'a jamais touché au réglage : ses lectures
  // comptent depuis la création de son profil.
  it.skipIf(!receiptsMigrated)("invitation : rien pour la personne qui invite, même une fois l'invitation regardée ; acceptée, jamais la date d'avant", async () => {
    const sent = await send(bruno, chloe, "Bonjour, j'aime vos envies");
    const id = sent.conversationId;
    expect(sent).toMatchObject({ state: "invitation_sent", readReceipts: null });
    const before = await thread(bruno, id);
    expect(before.readReceipts).toBeNull();
    // Chloé regarde l'invitation : son app la marque comme lue.
    await open(chloe, id);
    const looked = await lastReadAt(chloe, id);
    expect(looked).not.toBeNull();
    expect(await thread(bruno, id)).toEqual(before);
    expect((await thread(chloe, id)).readReceipts).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await request(chloe, "POST", `/api/conversations/${id}/accept`)).statusCode).toBe(204);
    const accepted = await thread(bruno, id);
    expect(accepted.state).toBe("open");
    // « Vu » par la lecture datée de l'acceptation (jamais celle d'avant) ; Bruno reçoit la date de son propre message.
    expect(Date.parse((await lastReadAt(chloe, id))!)).toBeGreaterThan(Date.parse(looked!));
    expect(Date.parse(accepted.readReceipts!.seenAt!)).toBe(Date.parse(sent.message.createdAt));
  });

  it.skipIf(!receiptsMigrated)("un nouveau profil : réglage allumé, et « depuis » = sa création (jamais vide)", async () => {
    const { data, error } = await app.supabaseAdmin.from("profiles").select("read_receipts, read_receipts_since, created_at").eq("id", chloe.id).single();
    expect(error).toBeNull();
    const row = data as { read_receipts: boolean; read_receipts_since: string; created_at: string };
    expect(row.read_receipts).toBe(true);
    expect(Date.parse(row.read_receipts_since)).toBe(Date.parse(row.created_at));
  });

  it.skipIf(!receiptsMigrated)("les colonnes de 0043 restent fermées au public (aucune règle d'accès)", async () => {
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data } = await anon.from("profiles").select("id, read_receipts, read_receipts_since").limit(1);
    expect(data ?? []).toEqual([]);
  });
});
