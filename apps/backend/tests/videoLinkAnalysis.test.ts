import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « vidéo auto » : POST /api/video-links/analyze et son statut
// (routes/videoLinkAnalysis.ts). Sans base ni réseau : fausse base en
// mémoire (consentements, plafond des recherches), faux service vidéo
// (fonction fetch injectée), fausse IA (askVideoMoments injectée), TikTok
// simulé pour les liens courts. Aucun appel à TikTok, Instagram, Meta ni
// Anthropic.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { ...original, env: { ...original.env, ANTHROPIC_API_KEY: "cle-factice-des-tests" } };
});
// Compteurs de l'IA (lib/aiQuota.ts) : les vrais par défaut (toujours permis
// sous Vitest), remplacés au cas par cas pour les refus.
vi.mock("../src/lib/aiQuota.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/aiQuota.js")>();
  return { ...original, aiQuotaFor: vi.fn(original.aiQuotaFor) };
});

import { ACCEPTED_CONSENT_VERSIONS, CONSENT_VERSIONS, VIDEO_LINK_CONSENT_VERSIONS, type ConsentStatus, type CropRect, type VideoLinkAnalysisResponse } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { aiQuotaFor } from "../src/lib/aiQuota.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { resetShortLinkCache } from "../src/lib/videoLinks.js";
import { VIDEO_WORKER_ERROR_CODES, type VideoWorkerConfigState, type VideoWorkerErrorCode, type VideoWorkerFetch } from "../src/lib/videoWorker.js";
import { resetAlertsForTests } from "../src/lib/alerts.js";
import { resetMemberQuotasProbe } from "../src/lib/memberQuotas.js";
import { hasCurrentConsent } from "../src/lib/consents.js";
import { MASKED_DATA, scrubLogLine } from "../src/lib/logPrivacy.js";
import { scrubEvent } from "../src/lib/sentry.js";
import rateLimitPlugin, { registerHit } from "../src/plugins/rateLimit.js";
import accountRoutes from "../src/routes/account.js";
import videoLinkAnalysisRoutes, { MAX_PARALLEL_ANALYSES, WORKER_FAILURE_REPLIES, type VideoLinkAnalysisOptions } from "../src/routes/videoLinkAnalysis.js";
import { VideoAiError, type askVideoMoments, type FrameForAi } from "../src/services/videoMoments.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";

const aiQuotaMock = vi.mocked(aiQuotaFor);

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CAROL = "c0000000-0000-4000-8000-000000000003";
const DAVE = "d0000000-0000-4000-8000-000000000004";
const ERIN = "e0000000-0000-4000-8000-000000000005";
/** Ancien texte de l'accord : vidéo du téléphone seulement (encore valable pour elle). */
const PHONE_ONLY_VERSION = "analyse-video-ia-2026-10-06";
const ID = "7412345678901234567";
const CANONICAL = `https://www.tiktok.com/@scout2015/video/${ID}`;
const TIKTOK_LINK = { platform: "tiktok", videoKey: ID, canonicalUrl: CANONICAL, creatorHandle: "scout2015" };
const SHARED_TEXT = `Regardez ça https://www.tiktok.com/@Scout2015/video/${ID}?_r=1&_t=8abc&utm_source=copy !`;
const QUERY = "la veste en cuir de la fille à gauche";
const WORKER = "http://spotto-video:10000";
const SECRET = "secret-partage-des-tests-0123456789abcdef";
const READY: VideoWorkerConfigState = { state: "ready", config: { baseUrl: WORKER, secret: SECRET } };
const BOX_A: CropRect = { x: 0.1, y: 0.35, width: 0.5, height: 0.4 };
const BOX_B: CropRect = { x: 0.2, y: 0.4, width: 0.6, height: 0.5 };

/** Couleurs des trois images de la fausse vidéo, et l'instant de chacune. */
const COLORS = ["#2F3E4E", "#5A4632", "#8A3B2C"] as const;
const TIMES = [1.5, 4, 9] as const;
let frames: Buffer[] = [];

async function jpeg(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 82 }).toBuffer();
}

function framesBody(list: Buffer[] = frames, size: [number, number] = [720, 1280]) {
  return {
    durationSeconds: 12,
    frames: list.map((data, index) => ({ timeSeconds: TIMES[index] ?? index, width: size[0], height: size[1], jpegBase64: data.toString("base64") })),
  };
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface WorkerCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

let app: FastifyInstance | null = null;
let fake: ReturnType<typeof fakeSupabase>;
let workerCalls: WorkerCall[] = [];
let workerReply: (init: RequestInit) => Response | Promise<Response>;
let suspended = false;
let capacityRow: Row;
let capacityError = false;
/** Base avec la migration 0053 (quotas par membre) : serpapi_quota_v2 répond. */
let quotasMigration = false;
let rpcCalls: string[] = [];
let logs: string[] = [];
let aiFramesSeen: FrameForAi[] = [];
let shortLinkFetches: string[] = [];

const workerFetch: VideoWorkerFetch = async (url, init) => {
  workerCalls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
  return workerReply(init);
};

const askMock = vi.fn<typeof askVideoMoments>();

function defaultAsk(): void {
  askMock.mockReset();
  askMock.mockImplementation(async (aiFrames) => {
    aiFramesSeen = [...aiFrames];
    return {
      moments: [
        { frame: 2, box: BOX_A },
        { frame: 0, box: BOX_B },
      ],
      candidates: [
        { frame: 2, box: BOX_A, confidence: 0.92 },
        { frame: 0, box: BOX_B, confidence: 0.81 },
        { frame: 1, box: BOX_B, confidence: 0.4 },
      ],
      usage: { inputTokens: 900, outputTokens: 60 },
    };
  });
}

function consent(userId: string, version: string | null, createdAt: string, granted = true): Row {
  return { user_id: userId, type: "analyse_video_ia", granted_at: granted ? createdAt : null, document_version: version, created_at: createdAt };
}

async function buildApp(options: Partial<VideoLinkAnalysisOptions> = {}, db: { missing?: string[]; withAccountRoutes?: boolean } = {}): Promise<FastifyInstance> {
  fake = fakeSupabase({
    missing: db.missing,
    rpc: async (fn) => {
      rpcCalls.push(fn);
      if (fn === "serpapi_quota") return capacityError ? { data: null, error: { message: "panne" } } : { data: [capacityRow], error: null };
      if (quotasMigration && fn === "member_quotas_version") return { data: 1, error: null };
      if (quotasMigration && fn === "serpapi_quota_v2") return { data: [capacityRow], error: null };
      if (fn === "ai_quota") return { data: [{ allowed: true, refused_by: null, day_count: 1, user_day_count: 1 }], error: null };
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
  });
  const consents = fake.table("consents");
  consents.push(consent(ALICE, CONSENT_VERSIONS.analyse_video_ia, "2026-11-15T09:00:00+00:00"));
  // Carol a retiré son accord ; Dave l'a donné sur un texte qui n'est plus en vigueur.
  consents.push(consent(CAROL, CONSENT_VERSIONS.analyse_video_ia, "2026-11-15T09:00:00+00:00"));
  consents.push(consent(CAROL, CONSENT_VERSIONS.analyse_video_ia, "2026-11-15T10:00:00+00:00", false));
  consents.push(consent(DAVE, "analyse-video-ia-ancienne", "2026-11-15T09:00:00+00:00"));
  // Erin l'a donné sur l'écran d'une vidéo du téléphone (ancien texte, sans les liens).
  consents.push(consent(ERIN, PHONE_ONLY_VERSION, "2026-11-15T09:00:00+00:00"));

  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => logs.push(line) } } });
  app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: null };
  });
  app.decorate("requireActiveAccount", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (suspended) return reply.code(403).send({ error: "account_suspended", message: "Votre compte est suspendu : cette action n'est plus possible." });
  });
  await app.register(rateLimitPlugin);
  await app.register(videoLinkAnalysisRoutes, { workerConfig: READY, workerFetch, askMoments: askMock, ...options });
  if (db.withAccountRoutes) await app.register(accountRoutes);
  await app.ready();
  return app;
}

const headersOf = (user: string | null) => (user ? { "x-test-user": user } : {});
const status = (target: FastifyInstance, user: string | null = ALICE) => target.inject({ method: "GET", url: "/api/video-links/analyze/status", headers: headersOf(user) });
const analyze = (target: FastifyInstance, payload: unknown, user: string | null = ALICE) =>
  target.inject({ method: "POST", url: "/api/video-links/analyze", headers: headersOf(user), payload: payload as Record<string, unknown> });

/** Moyenne des couches rouge, verte et bleue d'une image (pour reconnaître l'image renvoyée). */
async function meanColor(data: Buffer): Promise<number[]> {
  const stats = await sharp(data).stats();
  return stats.channels.slice(0, 3).map((channel) => Math.round(channel.mean));
}
function rgb(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

beforeAll(async () => {
  frames = await Promise.all(COLORS.map((color) => jpeg(720, 1280, color)));
});

beforeEach(() => {
  workerCalls = [];
  workerReply = () => jsonResponse(200, framesBody());
  suspended = false;
  capacityRow = { allowed: true, refused_by: null, reservation_id: null, day_count: 3, month_count: 40, user_day_count: 1, next_renewal: "2026-12-03" };
  capacityError = false;
  quotasMigration = false;
  resetMemberQuotasProbe();
  rpcCalls = [];
  logs = [];
  aiFramesSeen = [];
  shortLinkFetches = [];
  env.ANTHROPIC_API_KEY = "cle-factice-des-tests";
  defaultAsk();
  aiQuotaMock.mockClear();
  resetShortLinkCache();
  resetAlertsForTests();
  // Aucun appel sortant attendu, hors des liens courts TikTok (simulés au cas par cas).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      shortLinkFetches.push(String(url));
      throw new Error("aucun appel sortant attendu");
    })
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = null;
});

describe("statut et accès", () => {
  it("les deux routes demandent un compte connecté ; rien n'est lu ni demandé sans session", async () => {
    const target = await buildApp();
    expect((await status(target, null)).statusCode).toBe(401);
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY }, null)).statusCode).toBe(401);
    expect(workerCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("statut : allumé seulement avec l'interrupteur, des réglages valides ET la clé d'Anthropic ; jamais gardé en cache", async () => {
    const ready = await buildApp();
    const res = await status(ready);
    expect(res.json()).toEqual({ enabled: true });
    expect(res.headers["cache-control"]).toBe("no-store");
    env.ANTHROPIC_API_KEY = undefined;
    expect((await status(ready)).json()).toEqual({ enabled: false });
    await app!.close();
    env.ANTHROPIC_API_KEY = "cle-factice-des-tests";
    for (const workerConfig of [{ state: "off" }, { state: "invalid", problems: ["VIDEO_WORKER_SECRET : absent"] }] as VideoWorkerConfigState[]) {
      const target = await buildApp({ workerConfig });
      expect((await status(target)).json(), workerConfig.state).toEqual({ enabled: false });
      await app!.close();
    }
  });

  it("interrupteur coupé, réglages invalides ou clé d'Anthropic absente : 503 « video_analysis_disabled », rien n'est lu ni demandé", async () => {
    for (const workerConfig of [{ state: "off" }, { state: "invalid", problems: ["VIDEO_WORKER_URL : absente"] }] as VideoWorkerConfigState[]) {
      const target = await buildApp({ workerConfig });
      const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "video_analysis_disabled", message: "L'analyse automatique des liens n'est pas disponible. Faites une capture de la vidéo." });
      await app!.close();
    }
    const target = await buildApp();
    env.ANTHROPIC_API_KEY = undefined;
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).json().error).toBe("video_analysis_disabled");
    expect(workerCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("réglages invalides au démarrage : un seul avertissement, sans l'adresse ni le secret", async () => {
    await buildApp({ workerConfig: { state: "invalid", problems: ["VIDEO_WORKER_SECRET : forme invalide (32 à 512 caractères visibles, sans espace)"] } });
    const warnings = logs.filter((line) => line.includes("Analyse des liens vidéo coupée"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("VIDEO_WORKER_SECRET : forme invalide");
  });

  it("compte suspendu : 403, rien n'est demandé", async () => {
    suspended = true;
    const target = await buildApp();
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("account_suspended");
    expect(workerCalls).toEqual([]);
  });

  it("limites nommées : par membre (refus compris) et plafond commun des vidéos demandées au service vidéo", () => {
    expect(RATE_LIMITS.videoLinkAnalysis).toMatchObject({ max: 20, windowMs: 60 * 60 * 1000 });
    expect(RATE_LIMITS.videoLinkFetchGlobal).toMatchObject({ max: 200, windowMs: 60 * 60 * 1000, scope: "global" });
  });
});

describe("consentement, texte et lien", () => {
  it("sans consentement, consentement retiré ou donné sur un ancien texte : 403, rien ne part", async () => {
    const target = await buildApp();
    // Erin : accord donné sur le texte d'une vidéo du téléphone, qui ne parle pas des liens.
    for (const user of [BOB, CAROL, DAVE, ERIN]) {
      const res = await analyze(target, { url: SHARED_TEXT, query: QUERY }, user);
      expect(res.statusCode, user).toBe(403);
      expect(res.json()).toEqual({ error: "video_ai_consent_required", message: "Acceptez d'abord l'analyse automatique, ou faites une capture de la vidéo." });
    }
    expect(workerCalls).toEqual([]);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("texte commun (2026-11-15) : seul valable pour un lien ; l'ancien texte reste valable pour une vidéo du téléphone", async () => {
    expect(CONSENT_VERSIONS.analyse_video_ia).toBe("analyse-video-ia-2026-11-15");
    expect(VIDEO_LINK_CONSENT_VERSIONS).toEqual([CONSENT_VERSIONS.analyse_video_ia]);
    expect(ACCEPTED_CONSENT_VERSIONS.analyse_video_ia).toEqual([PHONE_ONLY_VERSION, CONSENT_VERSIONS.analyse_video_ia]);
    const target = await buildApp();
    // Vidéo du téléphone (routes/videoMoments.ts : liste par défaut) : Erin n'a rien à accepter de nouveau.
    expect(await hasCurrentConsent(target, ERIN, "analyse_video_ia")).toBe(true);
    expect(await hasCurrentConsent(target, ERIN, "analyse_video_ia", VIDEO_LINK_CONSENT_VERSIONS)).toBe(false);
    expect(await hasCurrentConsent(target, ALICE, "analyse_video_ia", VIDEO_LINK_CONSENT_VERSIONS)).toBe(true);
  });

  it("app déjà installée (ancien texte) : accord enregistré sous l'ancienne version, valable pour le téléphone, pas pour un lien ; le texte commun ouvre l'analyse", async () => {
    const target = await buildApp({}, { withAccountRoutes: true });
    const record = (version: string, granted = true) =>
      target.inject({ method: "POST", url: "/api/consents", headers: headersOf(BOB), payload: { consents: [{ type: "analyse_video_ia", version, granted }] } });
    const videoConsent = async () => ((await target.inject({ method: "GET", url: "/api/consents", headers: headersOf(BOB) })).json() as ConsentStatus[]).find((item) => item.type === "analyse_video_ia");
    const bobRows = () => fake.table("consents").filter((row) => row.user_id === BOB);

    // Une version inconnue reste refusée, sans rien enregistrer.
    expect((await record("analyse-video-ia-ancienne")).statusCode).toBe(409);
    expect(bobRows()).toEqual([]);

    expect((await record(PHONE_ONLY_VERSION)).statusCode).toBe(204);
    expect(bobRows().at(-1)).toMatchObject({ document_version: PHONE_ONLY_VERSION, revoked_at: null });
    expect(await videoConsent()).toMatchObject({ version: PHONE_ONLY_VERSION, isCurrent: true });
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY }, BOB)).statusCode).toBe(403);
    expect(workerCalls).toEqual([]);

    expect((await record(CONSENT_VERSIONS.analyse_video_ia)).statusCode).toBe(204);
    expect(bobRows().at(-1)).toMatchObject({ document_version: CONSENT_VERSIONS.analyse_video_ia, revoked_at: null });
    expect(await videoConsent()).toMatchObject({ version: CONSENT_VERSIONS.analyse_video_ia, isCurrent: true });
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY }, BOB)).statusCode).toBe(200);
    expect(workerCalls).toHaveLength(1);

    // Un refus envoyé par une app installée est enregistré lui aussi (et l'emporte).
    expect((await record(PHONE_ONLY_VERSION, false)).statusCode).toBe(204);
    expect(bobRows().at(-1)).toMatchObject({ document_version: PHONE_ONLY_VERSION, granted_at: null });
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY }, BOB)).statusCode).toBe(403);
  });

  it("consentement illisible (base en panne) : 500, rien ne part", async () => {
    const target = await buildApp({}, { missing: ["consents"] });
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("internal_error");
    expect(workerCalls).toEqual([]);
  });

  it("texte absent, trop court, trop long ou pas du texte : 400 « invalid_query » (mêmes règles que /api/video-moments)", async () => {
    const target = await buildApp();
    for (const query of [undefined, "a", "  b  ", "x".repeat(61), 42, ["veste"]]) {
      const res = await analyze(target, { url: SHARED_TEXT, query });
      expect(res.statusCode, String(query)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_query", message: "Décrivez la pièce en quelques mots." });
    }
    expect(workerCalls).toEqual([]);
  });

  it("lien absent, profil, autre site, lien de partage Instagram, texte trop long : 400 « invalid_link », sans aucun appel sortant", async () => {
    const target = await buildApp();
    const links: unknown[] = [
      undefined,
      "",
      42,
      "https://www.tiktok.com/@scout2015",
      "https://www.instagram.com/scout2015/",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://tiktok.com.evil.example/@a/video/7412345678901234567",
      "https://www.instagram.com/share/reel/BAabc123xyz/",
      `${"x".repeat(4100)} ${CANONICAL}`,
    ];
    for (const url of links) {
      const res = await analyze(target, { url, query: QUERY });
      expect(res.statusCode, String(url).slice(0, 60)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_link", message: "Ce lien n'est pas celui d'une vidéo TikTok ou Instagram." });
    }
    expect(workerCalls).toEqual([]);
    expect(shortLinkFetches).toEqual([]);
  });
});

describe("cas nominal", () => {
  it("le service vidéo reçoit l'adresse canonique (jamais le texte reçu) ; l'IA reçoit les images en 512 px ; l'app reçoit la vidéo et les moments, image en grand et cadre", async () => {
    const target = await buildApp();
    const res = await analyze(target, { url: SHARED_TEXT, query: `  ${QUERY} ` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    // Une seule demande au service vidéo : l'adresse réglée, le secret, l'adresse canonique.
    expect(workerCalls).toHaveLength(1);
    const call = workerCalls[0]!;
    expect(call.url).toBe(`${WORKER}/frames`);
    expect(call.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(call.init.headers).toMatchObject({ authorization: `Bearer ${SECRET}`, "content-type": "application/json" });
    expect(call.body).toEqual({ url: CANONICAL, platform: "tiktok" });
    expect(String(call.init.body)).not.toMatch(/Scout2015|_r=|utm_|Regardez/);

    // L'IA : les trois images réduites à 512 px, le texte nettoyé, les réglages de l'analyse vidéo.
    expect(askMock).toHaveBeenCalledTimes(1);
    const [aiFrames, query, settings] = askMock.mock.calls[0]!;
    expect(aiFrames.map((frame) => [frame.width, frame.height])).toEqual([
      [288, 512],
      [288, 512],
      [288, 512],
    ]);
    expect(query).toBe(QUERY);
    expect(settings).toEqual({ apiKey: "cle-factice-des-tests", model: "claude-sonnet-5-5", lowEffort: true });
    // Effacées dès la réponse.
    expect(aiFramesSeen.every((frame) => frame.data.every((byte) => byte === 0))).toBe(true);

    // La réponse : la vidéo reconnue et les moments, chacun avec SON image en grand.
    const body = res.json<VideoLinkAnalysisResponse>();
    expect(body.video).toEqual(TIKTOK_LINK);
    expect(body.moments.map((moment) => [moment.timeSeconds, moment.box])).toEqual([
      [9, BOX_A],
      [1.5, BOX_B],
    ]);
    for (const [index, moment] of body.moments.entries()) {
      expect(moment.image.startsWith("data:image/jpeg;base64,")).toBe(true);
      const image = Buffer.from(moment.image.slice("data:image/jpeg;base64,".length), "base64");
      const meta = await sharp(image).metadata();
      expect(meta.format).toBe("jpeg");
      expect([meta.width, meta.height]).toEqual([720, 1280]);
      const expected = rgb(COLORS[index === 0 ? 2 : 0]);
      const actual = await meanColor(image);
      actual.forEach((value, channel) => expect(Math.abs(value - expected[channel]!), `couche ${channel}`).toBeLessThanOrEqual(6));
    }
    // Aucune autre clé : ni confiance, ni numéro d'image, ni adresse de média.
    expect(Object.keys(body).sort()).toEqual(["moments", "video"]);
    expect(Object.keys(body.moments[0]!).sort()).toEqual(["box", "image", "timeSeconds"]);
  });

  it("Instagram : l'adresse canonique du reel, sans « igsh » ni pseudo", async () => {
    const target = await buildApp();
    const res = await analyze(target, { url: "https://instagram.com/scout2015/reel/C8abcDEF123/?igsh=MWQ1ZGUxMzBkMA==", query: QUERY });
    expect(res.statusCode).toBe(200);
    expect(workerCalls[0]!.body).toEqual({ url: "https://www.instagram.com/reel/C8abcDEF123/", platform: "instagram" });
    expect(res.json().video).toMatchObject({ platform: "instagram", videoKey: "C8abcDEF123" });
  });

  it("lien court TikTok : résolu (redirection seulement), puis le service vidéo reçoit l'adresse canonique de la vidéo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        shortLinkFetches.push(String(url));
        if (url === "https://vm.tiktok.com/ZMabcdEFG/") return new Response(null, { status: 301, headers: { location: `${CANONICAL}?_r=1&_t=8abc` } });
        throw new Error("aucun autre appel sortant attendu");
      })
    );
    const target = await buildApp();
    const res = await analyze(target, { url: "https://vm.tiktok.com/ZMabcdEFG/", query: QUERY });
    expect(res.statusCode).toBe(200);
    expect(shortLinkFetches).toEqual(["https://vm.tiktok.com/ZMabcdEFG/"]);
    expect(workerCalls[0]!.body).toEqual({ url: CANONICAL, platform: "tiktok" });
  });

  it("lien court qui ne mène à aucune vidéo : 400 « invalid_link » ; TikTok injoignable : 503 « video_unavailable » (la capture) ; le service vidéo n'est pas appelé", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        shortLinkFetches.push(String(url));
        if (url === "https://vm.tiktok.com/ZMprofil1/") return new Response(null, { status: 302, headers: { location: "https://www.tiktok.com/@scout2015" } });
        // La page d'un profil (jamais lue : seul le code compte).
        if (url === "https://www.tiktok.com/@scout2015") return new Response("<html>profil</html>", { status: 200 });
        throw new TypeError("fetch failed");
      })
    );
    const target = await buildApp();
    const profile = await analyze(target, { url: "https://vm.tiktok.com/ZMprofil1/", query: QUERY });
    expect(profile.statusCode).toBe(400);
    expect(profile.json().error).toBe("invalid_link");
    const down = await analyze(target, { url: "https://vm.tiktok.com/ZMinjoign/", query: QUERY });
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toBe("video_unavailable");
    expect(workerCalls).toEqual([]);
  });

  it("image du service plus grande que promis : l'image renvoyée reste à 1 280 px au plus, sans métadonnées", async () => {
    const big = await sharp({ create: { width: 1800, height: 2400, channels: 3, background: "#8A3B2C" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    workerReply = () => jsonResponse(200, framesBody([frames[0]!, frames[1]!, big]));
    const target = await buildApp();
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(res.statusCode).toBe(200);
    const image = Buffer.from(res.json<VideoLinkAnalysisResponse>().moments[0]!.image.split(",")[1]!, "base64");
    const meta = await sharp(image).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1280);
    expect(meta.exif).toBeUndefined();
  });
});

describe("limites de l'IA et plafond des recherches (comme POST /api/video-moments)", () => {
  it("lecture sans réserver avant tout, place réservée juste avant l'IA", async () => {
    const target = await buildApp();
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).statusCode).toBe(200);
    expect(aiQuotaMock.mock.calls.map((call) => call[2])).toEqual([
      { kind: "video", userId: ALICE, reserve: false },
      { kind: "video", userId: ALICE, reserve: true },
    ]);
    // La sonde des quotas par membre (0053, absente ici) peut précéder, une fois.
    expect(rpcCalls.filter((fn) => fn !== "member_quotas_version")).toEqual(["serpapi_quota"]);
  });

  it("limite de l'IA déjà atteinte (personne ou service) : 429 avec Retry-After, le service vidéo n'est pas appelé", async () => {
    const target = await buildApp();
    aiQuotaMock.mockResolvedValueOnce({ allowed: false, refusedBy: "user" });
    const user = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(user.statusCode).toBe(429);
    expect(user.json()).toEqual({
      error: "video_ai_user_limit",
      message: "Vous avez atteint la limite quotidienne d'analyses automatiques. Faites une capture de la vidéo, ou réessayez demain.",
    });
    expect(Number(user.headers["retry-after"])).toBeGreaterThan(0);
    aiQuotaMock.mockResolvedValueOnce({ allowed: false, refusedBy: "global" });
    const global = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(global.statusCode).toBe(429);
    expect(global.json().error).toBe("video_ai_global_limit");
    expect(workerCalls).toEqual([]);
  });

  it("compteur de l'IA illisible : 503 « video_unavailable », rien ne part", async () => {
    const target = await buildApp();
    aiQuotaMock.mockRejectedValueOnce(new Error("base injoignable"));
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("video_unavailable");
    expect(workerCalls).toEqual([]);
  });

  it("plafond des recherches atteint (jour, mois, part de la personne) : 429 de toujours ; illisible : 503 ; le service vidéo n'est pas appelé", async () => {
    const target = await buildApp();
    capacityRow = { ...capacityRow, allowed: false, refused_by: "day" };
    const day = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(day.statusCode).toBe(429);
    expect(day.json()).toEqual({ error: "search_capacity_day", message: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain." });
    capacityRow = { ...capacityRow, refused_by: "month" };
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).json()).toMatchObject({ error: "search_capacity_month", resumesOn: "2026-12-03" });
    capacityRow = { ...capacityRow, refused_by: "user" };
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).json().error).toBe("search_capacity_user");
    capacityError = true;
    const broken = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(broken.statusCode).toBe(503);
    expect(broken.json().error).toBe("video_unavailable");
    expect(workerCalls).toEqual([]);
  });

  it("part du mois atteinte (0053) : sans v=2, le plafond du mois et le 1er, qu'une app plus ancienne comprend ; avec v=2, la part du mois ; le service vidéo n'est pas appelé", async () => {
    quotasMigration = true;
    capacityRow = { ...capacityRow, allowed: false, refused_by: "user_month", user_month_count: 100, month_resets_on: "2026-12-01" };
    const target = await buildApp();
    const message = "Vous avez utilisé toutes vos recherches de ce mois-ci.";
    const older = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(older.statusCode).toBe(429);
    expect(older.json()).toEqual({ error: "search_capacity_month", message, resumesOn: "2026-12-01" });
    const newer = await target.inject({ method: "POST", url: "/api/video-links/analyze?v=2", headers: headersOf(ALICE), payload: { url: SHARED_TEXT, query: QUERY } });
    expect(newer.statusCode).toBe(429);
    expect(newer.json()).toEqual({ error: "search_capacity_user_month", message, resumesOn: "2026-12-01" });
    expect(rpcCalls.filter((fn) => fn === "serpapi_quota_v2")).toHaveLength(2);
    expect(workerCalls).toEqual([]);
  });

  it("limite atteinte entre-temps (place refusée juste avant l'IA) : 429, l'IA n'est pas appelée", async () => {
    const target = await buildApp();
    aiQuotaMock.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, refusedBy: "global" });
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("video_ai_global_limit");
    expect(workerCalls).toHaveLength(1);
    expect(askMock).not.toHaveBeenCalled();
  });
});

describe("échecs du service vidéo : chacun ramène à la capture d'écran", () => {
  const EXPECTED: Record<VideoWorkerErrorCode, [number, string]> = {
    private: [422, "video_private"],
    too_long: [422, "video_too_long"],
    busy: [503, "video_busy"],
    timeout: [504, "video_timeout"],
    not_found: [422, "video_unavailable"],
    unsupported: [422, "video_unavailable"],
    blocked: [502, "video_unavailable"],
    unavailable: [502, "video_unavailable"],
    bad_request: [502, "video_unavailable"],
    unauthorized: [502, "video_unavailable"],
  };

  it("chaque code du contrat a sa réponse : private → video_private, too_long → video_too_long, busy → video_busy, timeout → video_timeout, le reste → video_unavailable", async () => {
    const target = await buildApp();
    const statusOf: Record<VideoWorkerErrorCode, number> = {
      bad_request: 400,
      unauthorized: 401,
      unsupported: 422,
      private: 404,
      not_found: 404,
      blocked: 451,
      too_long: 413,
      unavailable: 502,
      busy: 503,
      timeout: 504,
    };
    for (const code of VIDEO_WORKER_ERROR_CODES) {
      workerReply = () => jsonResponse(statusOf[code], { error: code });
      const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
      expect([res.statusCode, res.json().error], code).toEqual(EXPECTED[code]);
      expect(res.json().message).toBe(WORKER_FAILURE_REPLIES[code].body.message);
    }
    expect(askMock).not.toHaveBeenCalled();
  });

  it("service injoignable, réponse hors contrat (JSON invalide, image illisible) : 502 « video_unavailable »", async () => {
    const target = await buildApp();
    const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    const replies: [string, (init: RequestInit) => Response | Promise<Response>][] = [
      [
        "injoignable",
        () => {
          throw new TypeError("fetch failed");
        },
      ],
      ["pas du JSON", () => new Response("<html>", { status: 200 })],
      ["JSON hors contrat", () => jsonResponse(200, { frames: "aucune" })],
      ["image illisible", () => jsonResponse(200, framesBody([frames[0]!, truncated]))],
    ];
    for (const [name, reply] of replies) {
      workerReply = reply;
      const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
      expect([res.statusCode, res.json().error], name).toEqual([502, "video_unavailable"]);
    }
    expect(askMock).not.toHaveBeenCalled();
  });

  it("délai dépassé côté serveur : 504 « video_timeout »", async () => {
    workerReply = (init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("délai dépassé", "AbortError")));
      });
    const target = await buildApp({ workerTimeoutMs: 100 });
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toEqual({ error: "video_timeout", message: "L'analyse de la vidéo a pris trop de temps. Réessayez, ou faites une capture de la vidéo." });
  });

  it("pannes répétées du service vidéo : une alerte « échecs répétés » (source service_video) ; une vidéo privée n'en est pas une", async () => {
    const target = await buildApp();
    workerReply = () => jsonResponse(404, { error: "private" });
    for (let index = 0; index < 6; index++) await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(logs.some((line) => line.includes('"alerte":"echecs_repetes"'))).toBe(false);
    workerReply = () => jsonResponse(502, { error: "unavailable" });
    for (let index = 0; index < 5; index++) await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(logs.filter((line) => line.includes('"alerte":"echecs_repetes"') && line.includes('"source":"service_video"'))).toHaveLength(1);
  });

  it("secret refusé par le service vidéo : journal « mal réglé » (niveau erreur), réponse 502 « video_unavailable »", async () => {
    workerReply = () => jsonResponse(401, { error: "unauthorized" });
    const target = await buildApp();
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).json().error).toBe("video_unavailable");
    const line = logs.find((entry) => entry.includes("service vidéo mal réglé"));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ level: 50, platform: "tiktok", failure: "unauthorized", status: 401 });
  });
});

describe("IA et capacité", () => {
  it("IA en échec : 503 « video_unavailable » ; aucun moment au-dessus du seuil : 422 « video_no_moment »", async () => {
    const target = await buildApp();
    askMock.mockRejectedValueOnce(new VideoAiError("unavailable", 529));
    const failed = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).toBe("video_unavailable");
    askMock.mockResolvedValueOnce({ moments: [], candidates: [{ frame: 1, box: BOX_A, confidence: 0.3 }], usage: { inputTokens: 900, outputTokens: 20 } });
    const none = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toEqual({
      error: "video_no_moment",
      message: "La pièce décrite n'a pas été repérée dans cette vidéo. Précisez votre description, ou faites une capture de la vidéo.",
    });
  });

  it(`${MAX_PARALLEL_ANALYSES} analyses en cours : la suivante reçoit aussitôt 503 « video_busy », sans appel au service vidéo`, async () => {
    const pending: ((response: Response) => void)[] = [];
    workerReply = () => new Promise<Response>((resolve) => pending.push(resolve));
    const target = await buildApp();
    const running = Array.from({ length: MAX_PARALLEL_ANALYSES }, () => analyze(target, { url: SHARED_TEXT, query: QUERY }));
    await vi.waitFor(() => expect(workerCalls).toHaveLength(MAX_PARALLEL_ANALYSES));
    const extra = await analyze(target, { url: SHARED_TEXT, query: QUERY });
    expect(extra.statusCode).toBe(503);
    expect(extra.json().error).toBe("video_busy");
    expect(workerCalls).toHaveLength(MAX_PARALLEL_ANALYSES);
    for (const resolve of pending) resolve(jsonResponse(200, framesBody()));
    for (const res of await Promise.all(running)) expect(res.statusCode).toBe(200);
    // Les places sont rendues : une nouvelle analyse passe.
    workerReply = () => jsonResponse(200, framesBody());
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).statusCode).toBe(200);
  });

  it("limites actives (hors tests) : plafond commun des vidéos atteint → 503 « video_busy » sans appel ; 21e demande d'un membre dans l'heure → 429", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const target = await buildApp();
      for (let index = 0; index < RATE_LIMITS.videoLinkFetchGlobal.max; index++) registerHit("videoLinkFetchGlobal:global", RATE_LIMITS.videoLinkFetchGlobal);
      const busy = await analyze(target, { url: SHARED_TEXT, query: QUERY });
      expect(busy.statusCode).toBe(503);
      expect(busy.json().error).toBe("video_busy");
      expect(workerCalls).toEqual([]);
      await app!.close();

      const off = await buildApp({ workerConfig: { state: "off" } });
      const member = "e0000000-0000-4000-8000-000000000005";
      for (let index = 0; index < RATE_LIMITS.videoLinkAnalysis.max; index++) expect((await analyze(off, { url: SHARED_TEXT, query: QUERY }, member)).statusCode).toBe(503);
      const limited = await analyze(off, { url: SHARED_TEXT, query: QUERY }, member);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: "rate_limited", message: "Vous avez demandé beaucoup d'analyses de liens en peu de temps. Réessayez dans un moment." });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe("rien n'est gardé ni journalisé", () => {
  it("journal : des compteurs et des codes seulement — jamais l'adresse, l'identifiant de la vidéo, le texte, le secret ni une image", async () => {
    const target = await buildApp();
    expect((await analyze(target, { url: SHARED_TEXT, query: QUERY })).statusCode).toBe(200);
    workerReply = () => jsonResponse(451, { error: "blocked" });
    await analyze(target, { url: "https://www.instagram.com/reel/C8abcDEF123/", query: QUERY });
    askMock.mockRejectedValueOnce(new VideoAiError("invalid_output"));
    workerReply = () => jsonResponse(200, framesBody());
    await analyze(target, { url: SHARED_TEXT, query: QUERY });

    const text = logs.join("\n");
    for (const secretText of [ID, "C8abcDEF123", "scout2015", "tiktok.com", "instagram.com", QUERY, "veste", SECRET, "data:image", "base64", frames[0]!.toString("base64").slice(0, 40)]) {
      expect(text, secretText).not.toContain(secretText);
    }
    expect(text).not.toMatch(/[A-Za-z0-9+/]{100,}/);
    const done = logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === "Analyse d'un lien vidéo");
    expect(done).toMatchObject({ platform: "tiktok", frames: 3, candidates: 3, moments: 2, inputTokens: 900, outputTokens: 60 });
    expect(logs.some((line) => line.includes('"failure":"blocked"') && line.includes('"platform":"instagram"'))).toBe(true);
    expect(logs.some((line) => line.includes("IA sans résultat") && line.includes('"kind":"invalid_output"'))).toBe(true);
  });

  it("filet : l'image d'un moment (« data URI ») serait masquée dans le journal et dans Sentry si elle y arrivait", async () => {
    const target = await buildApp();
    const image = (await analyze(target, { url: SHARED_TEXT, query: QUERY })).json<VideoLinkAnalysisResponse>().moments[0]!.image;
    expect(scrubLogLine(JSON.stringify({ msg: "x", image }))).toBe(JSON.stringify({ msg: "x", image: `data:${MASKED_DATA}` }));
    const event = scrubEvent({ type: undefined, message: `réponse ${image}`, extra: { moments: [{ image }] } });
    expect(JSON.stringify(event)).not.toContain(image.slice(40, 120));
    expect(event.message).toBe(`réponse data:${MASKED_DATA}`);
  });

  it("corps trop lourd (plus de 16 Ko) : refusé avant tout traitement", async () => {
    const target = await buildApp();
    const res = await analyze(target, { url: SHARED_TEXT, query: QUERY, padding: "x".repeat(20_000) });
    expect(res.statusCode).toBe(413);
    expect(workerCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });
});
