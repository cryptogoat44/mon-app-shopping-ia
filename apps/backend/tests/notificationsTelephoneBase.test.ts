import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/env.js";
import { flushPushes, resetPushCollapse } from "../src/lib/push.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Notifications des nouveaux messages (lot notifications, migration 0035),
// sur la vraie base de développement (spotto-dev-2, sur le Mac du
// fondateur) : la vraie table, ses droits, la cascade avec le compte.
// Sauté tant que 0035 (et 0032) ne sont pas appliquées sur la base des tests.
// L'interrupteur est allumé ici seulement ; le service d'Expo est simulé :
// aucune vraie notification ne part (tests/setup/noPaidCalls.ts refuse exp.host).
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, PUSH_ENABLED: true, EXPO_ACCESS_TOKEN: undefined } };
});

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [pushProbe, messagesProbe] = await Promise.all([admin.from("push_tokens").select("token").limit(0), admin.from("messages").select("id").limit(0)]);
const migrated = !pushProbe.error && !messagesProbe.error;
// Lot alertes prix (0036) : l'export dit aussi si l'appareil reçoit les messages, les alertes.
const alertsProbe = await admin.rpc("wish_alerts_version");
// 1 : 0036 seule ; 2 : avec ses garde-fous (0040). Les colonnes des appareils sont celles de 0036.
const alertsMigrated = !alertsProbe.error && typeof alertsProbe.data === "number" && alertsProbe.data >= 1;

const token = (label: string) => `ExponentPushToken[base${label}${Date.now().toString(36)}]`;

describe.skipIf(!migrated)("notifications sur le téléphone, sur la base de développement (0035)", () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bruno: TestUser;
  const sent: Record<string, unknown>[][] = [];
  let reply: (messages: Record<string, unknown>[]) => Response = (messages) => Response.json({ data: messages.map(() => ({ status: "ok", id: "x" })) });

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const devices = async (userId: string) => {
    const { data, error } = await app.supabaseAdmin.from("push_tokens").select("token, platform, last_error").eq("user_id", userId);
    if (error) throw error;
    return data ?? [];
  };

  beforeAll(async () => {
    // Seul exp.host est simulé ; Supabase passe par le vrai fetch.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith("https://exp.host/")) {
        const messages = JSON.parse(String(init?.body)) as Record<string, unknown>[];
        sent.push(messages);
        return reply(messages);
      }
      return realFetch(input, init);
    });
    app = await buildTestApp();
    [alice, bruno] = await Promise.all([createTestUser(app, "psha"), createTestUser(app, "pshb")]);
    await request(alice, "POST", `/api/follows/${bruno.id}`);
    await request(bruno, "POST", `/api/follows/${alice.id}`);
  }, 60_000);

  beforeEach(() => {
    resetPushCollapse();
    sent.length = 0;
  });

  afterAll(async () => {
    await flushPushes();
    for (const user of [alice, bruno]) if (user) await deleteTestUser(app, user.id);
    await app.close();
    vi.unstubAllGlobals();
  });

  it("l'app est prévenue que les notifications sont là", async () => {
    expect((await request(alice, "GET", "/api/messages/status")).json()).toMatchObject({ enabled: true, push: true });
  });

  it("enregistre un appareil sans doublon ; ni les visiteurs ni les comptes connectés ne lisent la table", async () => {
    const phone = token("b");
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios" })).statusCode).toBe(204);
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios" })).statusCode).toBe(204);
    expect(await devices(bruno.id)).toEqual([{ token: phone, platform: "ios", last_error: null }]);
    const asBruno = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? "", {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${bruno.token}` } },
    });
    const { data, error } = await asBruno.from("push_tokens").select("token");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("un message prévient l'appareil de la personne qui reçoit, sans le texte ; « DeviceNotRegistered » l'oublie", async () => {
    const res = await request(alice, "POST", "/api/messages", { recipientId: bruno.id, text: "Texte privé" });
    expect(res.statusCode).toBe(201);
    await flushPushes();
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ title: "Spotto", body: `Nouveau message de @${alice.username}`, data: { conversationId: res.json().conversationId } });
    expect(JSON.stringify(sent)).not.toContain("Texte privé");

    reply = (messages) => Response.json({ data: messages.map(() => ({ status: "error", details: { error: "DeviceNotRegistered" } })) });
    resetPushCollapse();
    await request(alice, "POST", "/api/messages", { recipientId: bruno.id, text: "Encore" });
    await flushPushes();
    expect(await devices(bruno.id)).toEqual([]);
  });

  it("l'export liste l'appareil sans son jeton ; oublier l'appareil le retire", async () => {
    const phone = token("a");
    expect((await request(alice, "PUT", "/api/me/push-token", { token: phone, platform: "ios" })).statusCode).toBe(204);
    const exported = await request(alice, "GET", "/api/me/export");
    expect(exported.json().pushDevices).toEqual([
      { platform: "ios", created_at: expect.any(String), updated_at: expect.any(String), ...(alertsMigrated ? { notify_messages: true, notify_alerts: false } : {}) },
    ]);
    expect(exported.body).not.toContain(phone);
    expect((await request(alice, "DELETE", "/api/me/push-token", { token: phone })).statusCode).toBe(204);
    expect(await devices(alice.id)).toEqual([]);
  });

  it("les appareils partent avec le compte (cascade)", async () => {
    const leaving = await createTestUser(app, "pshc");
    const phone = token("c");
    expect((await request(leaving, "PUT", "/api/me/push-token", { token: phone, platform: "ios" })).statusCode).toBe(204);
    await deleteTestUser(app, leaving.id);
    const { data } = await app.supabaseAdmin.from("push_tokens").select("token").eq("token", phone);
    expect(data).toEqual([]);
  });
});
