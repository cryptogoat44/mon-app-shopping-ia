import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createClient } from "@supabase/supabase-js";
import type { Post } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { flushPushes, resetPushCollapse } from "../src/lib/push.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Notifications d'activité sur le téléphone (lot « découverte », migration
// 0051), sur la vraie base de développement (spotto-dev-2, sur le Mac du
// fondateur) : ce que seule une vraie base prouve — les quatre colonnes
// éteintes par défaut, leurs droits, un vrai « j'aime » qui ne prévient que
// l'appareil où les « j'aime » sont allumés, et l'appareil oublié quand ses six
// réponses sont coupées. L'interrupteur est allumé ici seulement ; le service
// d'Expo est simulé : aucune vraie notification ne part (tests/setup/noPaidCalls.ts
// refuse exp.host).
// Sans 0051 (aujourd'hui « à appliquer »), seul le test « sans 0051 » tourne :
// l'app n'est pas prévenue, les quatre réponses sont ignorées, rien ne part.
// Sauté entièrement sans 0035 ou 0036. Les règles, cas par cas :
// notificationsActivite.test.ts (hors base).
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, PUSH_ENABLED: true, EXPO_ACCESS_TOKEN: undefined } };
});

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [pushProbe, activityProbe, alertsProbe] = await Promise.all([
  admin.from("push_tokens").select("token").limit(0),
  admin.from("push_tokens").select("notify_likes, notify_comments, notify_follows, notify_mentions").limit(0),
  admin.rpc("wish_alerts_version"),
]);
const withDevices = !pushProbe.error && !alertsProbe.error && typeof alertsProbe.data === "number" && alertsProbe.data >= 1;
const migrated = withDevices && !activityProbe.error;

const PHOTO = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3C4A5A" } }).jpeg().toBuffer();
const CAPTION = "Légende privée du test";
const token = (label: string) => `ExponentPushToken[act${label}${Date.now().toString(36)}]`;

describe.skipIf(!withDevices)("notifications d'activité, sur la base de développement (0051)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // aime
  let bruno: TestUser; // reçoit
  let post: Post;
  const sent: Record<string, unknown>[][] = [];

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const devices = async (userId: string) => {
    const { data, error } = await app.supabaseAdmin.from("push_tokens").select("*").eq("user_id", userId).order("token");
    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  };
  const forgetDevices = async (userId: string) => {
    const { error } = await app.supabaseAdmin.from("push_tokens").delete().eq("user_id", userId);
    if (error) throw error;
  };
  /** « J'aime », puis « je n'aime plus » : la notification de l'onglet Activité est retirée, l'essai suivant repart de zéro. */
  const likeThenUnlike = async () => {
    const liked = await request(alice, "POST", `/api/posts/${post.id}/react`);
    expect(liked.json()).toMatchObject({ viewerHasReacted: true });
    await flushPushes();
    const unliked = await request(alice, "POST", `/api/posts/${post.id}/react`);
    expect(unliked.json()).toMatchObject({ viewerHasReacted: false });
  };

  beforeAll(async () => {
    // Seul exp.host est simulé ; Supabase passe par le vrai fetch.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith("https://exp.host/")) {
        const messages = JSON.parse(String(init?.body)) as Record<string, unknown>[];
        sent.push(messages);
        return Response.json({ data: messages.map(() => ({ status: "ok", id: "x" })) });
      }
      return realFetch(input, init);
    });
    app = await buildTestApp();
    [alice, bruno] = await Promise.all([createTestUser(app, "acta"), createTestUser(app, "actb")]);
    const body = buildMultipart({ type: "lifestyle", privacy: "public", caption: CAPTION }, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: PHOTO });
    const published = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(bruno.token), ...body.headers }, payload: body.payload });
    expect(published.statusCode).toBe(200);
    post = published.json() as Post;
  }, 120_000);

  beforeEach(async () => {
    resetPushCollapse();
    sent.length = 0;
    await forgetDevices(bruno.id);
  });

  afterAll(async () => {
    await flushPushes();
    for (const user of [alice, bruno]) if (user) await deleteTestUser(app, user.id);
    await app?.close();
    vi.unstubAllGlobals();
  }, 120_000);

  it.skipIf(migrated)("sans 0051 : l'app n'est pas prévenue, les quatre réponses sont ignorées, un « j'aime » ne part pas", async () => {
    expect((await request(alice, "GET", "/api/messages/status")).json()).toMatchObject({ activityPush: false });
    const phone = token("a");
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios", messages: true, likes: true })).statusCode).toBe(204);
    expect(Object.keys((await devices(bruno.id))[0]!)).not.toContain("notify_likes");
    await likeThenUnlike();
    expect(sent).toEqual([]);
  });

  it.skipIf(!migrated)("l'app est prévenue ; un nouvel appareil a les quatre sortes éteintes ; ni les visiteurs ni les comptes connectés ne les lisent", async () => {
    expect((await request(alice, "GET", "/api/messages/status")).json()).toMatchObject({ push: true, activityPush: true });
    const phone = token("b");
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios" })).statusCode).toBe(204);
    expect(await devices(bruno.id)).toEqual([
      expect.objectContaining({ token: phone, notify_messages: true, notify_alerts: false, notify_likes: false, notify_comments: false, notify_follows: false, notify_mentions: false }),
    ]);
    const asBruno = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? "", {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${bruno.token}` } },
    });
    const { data, error } = await asBruno.from("push_tokens").select("notify_likes");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it.skipIf(!migrated)("un vrai « j'aime » ne prévient que l'appareil où les « j'aime » sont allumés : le nom et une phrase fixe, jamais la légende", async () => {
    const phone = token("c");
    const tablet = token("d");
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios", messages: false, alerts: false, likes: true })).statusCode).toBe(204);
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: tablet, platform: "ios", messages: true, comments: true, follows: true, mentions: true })).statusCode).toBe(204);
    await likeThenUnlike();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((message) => message.to)).toEqual([phone]);
    expect(sent[0]![0]).toMatchObject({ title: "Spotto", body: `@${alice.username} a aimé votre publication`, data: { postId: post.id } });
    expect(JSON.stringify(sent)).not.toContain(CAPTION);
  });

  it.skipIf(!migrated)("les quatre interrupteurs coupés, sans messages ni alertes : l'appareil est oublié", async () => {
    const phone = token("e");
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios", messages: false, alerts: false, mentions: true })).statusCode).toBe(204);
    expect(await devices(bruno.id)).toHaveLength(1);
    expect((await request(bruno, "PUT", "/api/me/push-token", { token: phone, platform: "ios", mentions: false })).statusCode).toBe(204);
    expect(await devices(bruno.id)).toEqual([]);
  });
});
