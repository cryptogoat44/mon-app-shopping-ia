import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createClient } from "@supabase/supabase-js";
import type { ConversationThread, SendMessageResponse } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Messages, plus de confort (migration 0044), sur la vraie base de
// développement (spotto-dev-2, sur le Mac du fondateur) : ce que la fausse
// base ne peut pas prouver. La nouvelle règle de la table accepte un message
// supprimé et un message qui ne porte qu'une publication ; la suppression de
// la publication laisse le message valide ; les « j'aime » partent avec le
// message, la conversation et le compte. Sauté tant que 0044 n'est pas
// appliquée sur la base des tests. Les règles de confidentialité, une à une :
// messagerieConfort.test.ts (sans base).

const probeClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const migrated =
  !(await probeClient.from("messages").select("reply_to_id, post_id, shared_post, deleted_at, updated_at").limit(0)).error &&
  !(await probeClient.from("message_reactions").select("message_id").limit(0)).error;

describe.skipIf(!migrated)("messages, plus de confort, sur la base de développement (0044)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // amie de Bruno (chacun suit l'autre)
  let bruno: TestUser;
  let chloe: TestUser; // ne suit personne
  let postId: string;
  let conversationId: string;

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const send = async (from: TestUser, to: TestUser, body: { text?: string; postId?: string; replyToId?: string }): Promise<SendMessageResponse> => {
    const res = await request(from, "POST", "/api/messages?v=2", { recipientId: to.id, ...body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const thread = async (user: TestUser, query = ""): Promise<ConversationThread> => (await request(user, "GET", `/api/conversations/${conversationId}?v=2${query}`)).json();
  const row = async (id: string) => {
    const { data, error } = await app.supabaseAdmin.from("messages").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as Record<string, unknown> | null;
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [alice, bruno, chloe] = await Promise.all([createTestUser(app, "cfa"), createTestUser(app, "cfb"), createTestUser(app, "cfc")]);
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
    // Une publication publique d'Alice, écrite directement (aucun envoi d'image).
    const { data, error } = await app.supabaseAdmin
      .from("posts")
      .insert({ user_id: alice.id, type: "lifestyle", media_kind: "photo", caption: "Légende de la publication", media_url: `${env.SUPABASE_URL}/storage/v1/object/public/post-media/${alice.id}/essai.jpg`, privacy: "public" })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Publication de test non créée");
    postId = (data as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    for (const user of [alice, bruno, chloe]) if (user) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("la messagerie dit que les actions sont disponibles", async () => {
    expect((await request(alice, "GET", "/api/messages/status")).json()).toMatchObject({ enabled: true, actions: true });
  });

  it("un message qui ne porte qu'une publication est accepté par la base, sans rien recopier d'elle", async () => {
    const sent = await send(alice, bruno, { postId });
    conversationId = sent.conversationId;
    expect(sent.message.post).toMatchObject({ available: true, id: postId, caption: "Légende de la publication" });
    expect(await row(sent.message.id)).toMatchObject({ body: null, wish_title: null, post_id: postId, shared_post: true, deleted_at: null });
    // Chloé ne fait pas partie de la conversation.
    expect((await request(chloe, "GET", `/api/conversations/${conversationId}?v=2`)).statusCode).toBe(404);
  });

  it("la règle de la table refuse toujours un message sans texte, sans carte, sans publication et non supprimé", async () => {
    const { error } = await app.supabaseAdmin.from("messages").insert({ conversation_id: conversationId, sender_id: alice.id });
    expect(error?.code).toBe("23514");
    const deleted = await app.supabaseAdmin.from("messages").insert({ conversation_id: conversationId, sender_id: alice.id, deleted_at: new Date().toISOString() }).select("id").single();
    expect(deleted.error).toBeNull();
    await app.supabaseAdmin.from("messages").delete().eq("id", (deleted.data as { id: string }).id);
  });

  it("répondre, aimer, relire ce qui a changé ; un « j'aime » ne touche ni « non lu » ni l'aperçu", async () => {
    const first = await send(alice, bruno, { text: "Tu as vu ce sac ?" });
    const reply = await send(bruno, alice, { text: "Oui !", replyToId: first.message.id });
    expect(reply.message.replyTo).toEqual({ id: first.message.id, mine: false, kind: "text", excerpt: "Tu as vu ce sac ?" });
    expect((await request(alice, "POST", `/api/conversations/${conversationId}/read`)).statusCode).toBe(204);
    const before = await thread(alice);
    const liked = await request(bruno, "PUT", `/api/messages/${first.message.id}/reaction`, { liked: true });
    expect(liked.statusCode).toBe(200);
    expect(liked.json().message.liked).toEqual({ mine: true, theirs: false });
    expect((await request(bruno, "PUT", `/api/messages/${first.message.id}/reaction`, { liked: true })).statusCode).toBe(200);
    const { count } = await app.supabaseAdmin.from("message_reactions").select("message_id", { count: "exact", head: true }).eq("message_id", first.message.id);
    expect(count).toBe(1);
    expect((await request(alice, "GET", "/api/messages/status")).json().unreadCount).toBe(0);
    const polled = await thread(alice, `&after=${encodeURIComponent(reply.message.createdAt)}&changedSince=${encodeURIComponent(before.syncedAt!)}`);
    expect(polled.messages).toEqual([]);
    expect(polled.changed?.map((message) => message.id)).toEqual([first.message.id]);
    expect(polled.changed?.[0]?.liked).toEqual({ mine: false, theirs: true });
    expect((await request(chloe, "PUT", `/api/messages/${first.message.id}/reaction`, { liked: true })).statusCode).toBe(404);
  });

  it("supprimer : le contenu est effacé de la base, les « j'aime » aussi ; signalé avant, il est conservé mais ne sort plus", async () => {
    const erased = await send(alice, bruno, { text: "À effacer" });
    expect((await request(bruno, "PUT", `/api/messages/${erased.message.id}/reaction`, { liked: true })).statusCode).toBe(200);
    expect((await request(bruno, "DELETE", `/api/messages/${erased.message.id}`)).statusCode).toBe(404);
    expect((await request(alice, "DELETE", `/api/messages/${erased.message.id}`)).statusCode).toBe(204);
    expect(await row(erased.message.id)).toMatchObject({ body: null, post_id: null, reply_to_id: null, shared_post: false });
    expect((await row(erased.message.id))?.deleted_at).toEqual(expect.any(String));
    const { count } = await app.supabaseAdmin.from("message_reactions").select("message_id", { count: "exact", head: true }).eq("message_id", erased.message.id);
    expect(count).toBe(0);

    const kept = await send(alice, bruno, { text: "Signalé avant d'être supprimé" });
    expect((await request(bruno, "POST", "/api/reports", { targetType: "message", targetId: kept.message.id, reason: "harassment" })).statusCode).toBe(204);
    expect((await request(alice, "DELETE", `/api/messages/${kept.message.id}`)).statusCode).toBe(204);
    expect(await row(kept.message.id)).toMatchObject({ body: "Signalé avant d'être supprimé" });
    for (const user of [alice, bruno]) {
      const res = await request(user, "GET", `/api/conversations/${conversationId}?v=2&changedSince=2020-01-01T00:00:00.000Z`);
      expect(res.body).not.toContain("Signalé avant d'être supprimé");
      expect(res.body).not.toContain("À effacer");
    }
    // L'export de Bruno (qui l'a reçu) n'a pas le contenu conservé ; celui d'Alice (qui l'a écrit) l'a.
    const exportOf = async (user: TestUser) => (await request(user, "GET", "/api/me/export")).body;
    expect(await exportOf(bruno)).not.toContain("Signalé avant d'être supprimé");
    expect(await exportOf(alice)).toContain("Signalé avant d'être supprimé");
    // Un message supprimé peut encore être signalé.
    expect((await request(bruno, "POST", "/api/reports", { targetType: "message", targetId: erased.message.id, reason: "spam" })).statusCode).toBe(204);
  });

  it("la publication supprimée : le message reste valide (post_id vidé, shared_post vrai) et l'app reçoit « indisponible »", async () => {
    const shared = await send(alice, bruno, { text: "Regarde", postId });
    const { error } = await app.supabaseAdmin.from("posts").delete().eq("id", postId);
    expect(error).toBeNull();
    expect(await row(shared.message.id)).toMatchObject({ body: "Regarde", post_id: null, shared_post: true });
    for (const user of [alice, bruno]) {
      const message = (await thread(user)).messages.find((entry) => entry.id === shared.message.id);
      expect(message?.post).toEqual({ available: false });
    }
  });

  it("la suppression du compte emporte la conversation, ses messages et leurs « j'aime »", async () => {
    const last = await send(bruno, alice, { text: "Dernier message" });
    expect((await request(alice, "PUT", `/api/messages/${last.message.id}/reaction`, { liked: true })).statusCode).toBe(200);
    await deleteTestUser(app, bruno.id);
    const messages = await app.supabaseAdmin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
    expect(messages.count).toBe(0);
    const reactions = await app.supabaseAdmin.from("message_reactions").select("message_id", { count: "exact", head: true }).eq("user_id", alice.id);
    expect(reactions.count).toBe(0);
  });
});
