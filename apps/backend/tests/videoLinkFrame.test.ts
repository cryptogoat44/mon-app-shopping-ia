import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Retours du build 3 : l'image du moment, POST /api/video-links/frame, et le
// champ `frame` du statut (routes/videoLinkAnalysis.ts). Sans base ni réseau :
// faux service vidéo (fonction fetch injectée), TikTok simulé pour les liens
// courts. L'IA, ses compteurs, le consentement et le plafond des recherches
// sont remplacés par des faux qui ÉCHOUENT s'ils sont appelés : cette route
// n'en a pas besoin (aucune IA, aucun appel payant).
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { ...original, env: { ...original.env, ANTHROPIC_API_KEY: undefined } };
});
vi.mock("../src/lib/aiQuota.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/aiQuota.js")>();
  return {
    ...original,
    aiQuotaFor: vi.fn(async () => {
      throw new Error("compteur de l'IA lu : interdit pour l'image du moment");
    }),
  };
});
vi.mock("../src/lib/consents.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/consents.js")>();
  return {
    ...original,
    hasCurrentConsent: vi.fn(async () => {
      throw new Error("consentement lu : interdit pour l'image du moment");
    }),
  };
});
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return {
    ...original,
    searchCapacityForVideoAi: vi.fn(async () => {
      throw new Error("plafond des recherches lu : interdit pour l'image du moment");
    }),
  };
});
vi.mock("../src/lib/videoWorker.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/videoWorker.js")>();
  return { ...original, wipeFrames: vi.fn(original.wipeFrames) };
});

import type { VideoLinkFrameResponse } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { aiQuotaFor } from "../src/lib/aiQuota.js";
import { hasCurrentConsent } from "../src/lib/consents.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { searchCapacityForVideoAi } from "../src/lib/searchCapacity.js";
import { resetShortLinkCache } from "../src/lib/videoLinks.js";
import { wipeFrames, type VideoWorkerConfigState, type VideoWorkerFetch, type WorkerFrame } from "../src/lib/videoWorker.js";
import { resetAlertsForTests } from "../src/lib/alerts.js";
import rateLimitPlugin, { registerHit } from "../src/plugins/rateLimit.js";
import videoLinkAnalysisRoutes, { MAX_PARALLEL_ANALYSES, WORKER_FAILURE_REPLIES, type VideoLinkAnalysisOptions } from "../src/routes/videoLinkAnalysis.js";
import { fakeSupabase } from "./fakeSupabase.js";

const ALICE = "a0000000-0000-4000-8000-000000000001";
const ID = "7412345678901234567";
const CANONICAL = `https://www.tiktok.com/@scout2015/video/${ID}`;
const SHARED_TEXT = `Regardez ça https://www.tiktok.com/@Scout2015/video/${ID}?_r=1&_t=8abc&utm_source=copy !`;
const INSTAGRAM = "https://www.instagram.com/reel/C8abcDEF123/";
const WORKER = "http://spotto-video:10000";
const SECRET = "secret-partage-des-tests-0123456789abcdef";
const READY: VideoWorkerConfigState = { state: "ready", config: { baseUrl: WORKER, secret: SECRET } };
/** Instant demandé par les tests : jamais écrit dans le journal. */
const AT = 3.217;

let frame: Buffer;
let app: FastifyInstance | null = null;
let workerCalls: { url: string; body: Record<string, unknown> }[] = [];
let workerReply: () => Response | Promise<Response>;
let suspended = false;
let logs: string[] = [];
let shortLinkFetches: string[] = [];
const askMoments = vi.fn(async () => {
  throw new Error("IA appelée : interdit pour l'image du moment");
});
const askPieces = vi.fn(async () => {
  throw new Error("IA appelée : interdit pour l'image du moment");
});

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function momentBody(data: Buffer = frame, size: [number, number] = [720, 1280]) {
  return { durationSeconds: 7, frames: [{ timeSeconds: 3.2, width: size[0], height: size[1], jpegBase64: data.toString("base64") }] };
}

const workerFetch: VideoWorkerFetch = async (url, init) => {
  workerCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
  return workerReply();
};

async function buildApp(options: Partial<VideoLinkAnalysisOptions> = {}): Promise<FastifyInstance> {
  const fake = fakeSupabase({});
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
  await app.register(videoLinkAnalysisRoutes, { workerConfig: READY, workerFetch, askMoments, askPieces, ...options });
  await app.ready();
  return app;
}

const headersOf = (user: string | null) => (user ? { "x-test-user": user } : {});
const status = (target: FastifyInstance) => target.inject({ method: "GET", url: "/api/video-links/analyze/status", headers: headersOf(ALICE) });
const frameOf = (target: FastifyInstance, payload: unknown, user: string | null = ALICE) =>
  target.inject({ method: "POST", url: "/api/video-links/frame", headers: headersOf(user), payload: payload as Record<string, unknown> });

function expectNoAiNorQuota(): void {
  expect(askMoments).not.toHaveBeenCalled();
  expect(askPieces).not.toHaveBeenCalled();
  expect(vi.mocked(aiQuotaFor)).not.toHaveBeenCalled();
  expect(vi.mocked(hasCurrentConsent)).not.toHaveBeenCalled();
  expect(vi.mocked(searchCapacityForVideoAi)).not.toHaveBeenCalled();
}

beforeAll(async () => {
  frame = await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#5A4632" } }).jpeg({ quality: 82 }).toBuffer();
});

beforeEach(() => {
  workerCalls = [];
  workerReply = () => jsonResponse(200, momentBody());
  suspended = false;
  logs = [];
  shortLinkFetches = [];
  env.ANTHROPIC_API_KEY = undefined;
  env.VIDEO_LINK_ANALYSIS_ENABLED = false;
  env.VIDEO_LINK_FRAME_ENABLED = true;
  env.VIDEO_PIECES_ENABLED = false;
  askMoments.mockClear();
  askPieces.mockClear();
  vi.mocked(aiQuotaFor).mockClear();
  vi.mocked(hasCurrentConsent).mockClear();
  vi.mocked(searchCapacityForVideoAi).mockClear();
  vi.mocked(wipeFrames).mockClear();
  resetShortLinkCache();
  resetAlertsForTests();
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

describe("statut : le champ frame", () => {
  it("permis : image du moment allumée et service réglé → frame: true ; l'analyse reste coupée (enabled: false), sans clé d'IA", async () => {
    const target = await buildApp();
    const res = await status(target);
    expect(res.json()).toEqual({ enabled: false, frame: true });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refusé : interrupteur coupé ou service mal réglé → champ absent (jamais false) ; l'analyse garde sa règle", async () => {
    env.VIDEO_LINK_FRAME_ENABLED = false;
    const target = await buildApp();
    expect((await status(target)).json()).toEqual({ enabled: false });
    await app!.close();
    env.VIDEO_LINK_FRAME_ENABLED = true;
    for (const workerConfig of [{ state: "off" }, { state: "invalid", problems: ["VIDEO_WORKER_SECRET : absent"] }] as VideoWorkerConfigState[]) {
      const other = await buildApp({ workerConfig });
      expect((await status(other)).json(), workerConfig.state).toEqual({ enabled: false });
      await app!.close();
    }
    // Les deux allumés, clé présente : les deux champs, indépendants.
    env.VIDEO_LINK_ANALYSIS_ENABLED = true;
    env.ANTHROPIC_API_KEY = "cle-factice-des-tests";
    const both = await buildApp();
    expect((await status(both)).json()).toEqual({ enabled: true, frame: true });
  });

  it("refusé : enabled: true sans VIDEO_LINK_ANALYSIS_ENABLED, même clé d'IA présente ; /analyze répond alors 503", async () => {
    env.ANTHROPIC_API_KEY = "cle-factice-des-tests";
    const target = await buildApp();
    expect((await status(target)).json()).toEqual({ enabled: false, frame: true });
    const res = await target.inject({ method: "POST", url: "/api/video-links/analyze", headers: headersOf(ALICE), payload: { url: SHARED_TEXT, query: "la veste en cuir" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("video_analysis_disabled");
    expect(workerCalls).toEqual([]);
  });

  it("image du moment seule, sans clé d'IA : aucun avertissement « clé d'Anthropic absente » au démarrage", async () => {
    await buildApp();
    expect(logs.some((line) => line.includes("ANTHROPIC_API_KEY"))).toBe(false);
  });
});

describe("POST /api/video-links/frame : accès et interrupteur", () => {
  it("refusé : interrupteur coupé (ou service non réglé) → 503 « video_frame_disabled », rien n'est demandé", async () => {
    env.VIDEO_LINK_FRAME_ENABLED = false;
    const target = await buildApp();
    const res = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "video_frame_disabled", message: "L'image de ce moment ne peut pas être préparée par nos serveurs en ce moment." });
    expect(res.headers["cache-control"]).toBe("no-store");
    await app!.close();
    env.VIDEO_LINK_FRAME_ENABLED = true;
    const off = await buildApp({ workerConfig: { state: "off" } });
    expect((await frameOf(off, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(503);
    expect(workerCalls).toEqual([]);
  });

  it("sans connexion : 401 ; compte suspendu : 403 ; rien n'est demandé", async () => {
    const target = await buildApp();
    expect((await frameOf(target, { url: SHARED_TEXT, atSeconds: AT }, null)).statusCode).toBe(401);
    suspended = true;
    const res = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("account_suspended");
    expect(workerCalls).toEqual([]);
  });
});

describe("POST /api/video-links/frame : cas permis", () => {
  it("lien TikTok partagé : le service vidéo reçoit l'adresse canonique, platform tiktok et atSeconds ; l'app reçoit UNE image réencodée, sa taille et son instant", async () => {
    const target = await buildApp();
    const res = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(workerCalls).toEqual([{ url: `${WORKER}/frames`, body: { url: CANONICAL, platform: "tiktok", atSeconds: AT } }]);
    const body = res.json<VideoLinkFrameResponse>();
    expect(Object.keys(body).sort()).toEqual(["height", "image", "timeSeconds", "width"]);
    expect(body.image.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect([body.width, body.height]).toEqual([720, 1280]);
    expect(body.timeSeconds).toBe(3.2);
    const meta = await sharp(Buffer.from(body.image.slice("data:image/jpeg;base64,".length), "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([720, 1280]);
    expectNoAiNorQuota();
  });

  it("image plus grande que promis : réduite à 1 280 px au plus, sans métadonnées, taille exacte rendue", async () => {
    const big = await sharp({ create: { width: 1800, height: 2400, channels: 3, background: "#8A3B2C" } })
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    // Le service promet 1 280 px : la réponse hors contrat est refusée par le client…
    workerReply = () => jsonResponse(200, momentBody(big, [1800, 2400]));
    const target = await buildApp();
    expect((await frameOf(target, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(502);
    // … et une image annoncée à 1 280 px mais plus grande en vrai est réduite par le serveur.
    workerReply = () => jsonResponse(200, momentBody(big, [960, 1280]));
    const res = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(res.statusCode).toBe(200);
    const body = res.json<VideoLinkFrameResponse>();
    expect(Math.max(body.width, body.height)).toBeLessThanOrEqual(1280);
    const meta = await sharp(Buffer.from(body.image.slice("data:image/jpeg;base64,".length), "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([body.width, body.height]);
    expect(meta.exif).toBeUndefined();
  });

  it("bornes : 0 et 90 sont permis", async () => {
    const target = await buildApp();
    for (const atSeconds of [0, 90]) expect((await frameOf(target, { url: SHARED_TEXT, atSeconds })).statusCode, String(atSeconds)).toBe(200);
    expect(workerCalls.map((call) => call.body.atSeconds)).toEqual([0, 90]);
  });

  it("lien court TikTok : résolu (redirection seulement), puis l'adresse canonique part au service vidéo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        shortLinkFetches.push(String(url));
        if (url === "https://vm.tiktok.com/ZMabcdEFG/") return new Response(null, { status: 301, headers: { location: `${CANONICAL}?_r=1&_t=8abc` } });
        throw new Error("aucun autre appel sortant attendu");
      })
    );
    const target = await buildApp();
    const res = await frameOf(target, { url: "https://vm.tiktok.com/ZMabcdEFG/", atSeconds: AT });
    expect(res.statusCode).toBe(200);
    expect(shortLinkFetches).toEqual(["https://vm.tiktok.com/ZMabcdEFG/"]);
    expect(workerCalls[0]!.body).toEqual({ url: CANONICAL, platform: "tiktok", atSeconds: AT });
  });
});

describe("POST /api/video-links/frame : cas refusés", () => {
  it("lien Instagram, profil, autre site, lien absent : 400 « invalid_link », sans aucun appel sortant", async () => {
    const target = await buildApp();
    for (const url of [INSTAGRAM, "https://www.tiktok.com/@scout2015", "https://example.org/video/1", "", undefined, 42]) {
      const res = await frameOf(target, { url, atSeconds: AT });
      expect(res.statusCode, String(url)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_link", message: "Ce lien n'est pas celui d'une vidéo TikTok." });
    }
    expect(workerCalls).toEqual([]);
    expect(shortLinkFetches).toEqual([]);
  });

  it("lien court qui ne mène à aucune vidéo : 400 ; TikTok injoignable : 503 ; le service vidéo n'est pas appelé", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        shortLinkFetches.push(String(url));
        if (url === "https://vm.tiktok.com/ZMprofil1/") return new Response(null, { status: 302, headers: { location: "https://www.tiktok.com/@scout2015" } });
        if (url === "https://www.tiktok.com/@scout2015") return new Response("<html>profil</html>", { status: 200 });
        throw new TypeError("fetch failed");
      })
    );
    const target = await buildApp();
    expect((await frameOf(target, { url: "https://vm.tiktok.com/ZMprofil1/", atSeconds: AT })).json().error).toBe("invalid_link");
    const down = await frameOf(target, { url: "https://vm.tiktok.com/ZMinjoign/", atSeconds: AT });
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toBe("video_unavailable");
    expect(workerCalls).toEqual([]);
  });

  it("atSeconds absent, négatif, plus de 90, texte, null, infini : 400 « invalid_moment », rien n'est demandé", async () => {
    const target = await buildApp();
    for (const atSeconds of [undefined, -1, -0.001, 90.001, 91, "3", null, true, [3]]) {
      const res = await frameOf(target, { url: SHARED_TEXT, atSeconds });
      expect(res.statusCode, String(atSeconds)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_moment", message: "Ce moment de la vidéo n'est pas valable." });
    }
    // « 1e400 » se lit comme l'infini (pas un nombre fini) : refusé aussi.
    const raw = await target.inject({ method: "POST", url: "/api/video-links/frame", headers: { ...headersOf(ALICE), "content-type": "application/json" }, payload: `{"url":"${CANONICAL}","atSeconds":1e400}` });
    expect(raw.statusCode).toBe(400);
    expect(raw.json().error).toBe("invalid_moment");
    expect(workerCalls).toEqual([]);
  });

  it("chaque échec du service vidéo : la réponse de l'analyse (même code et statut) ; une panne compte pour l'alerte, une vidéo privée non", async () => {
    const target = await buildApp();
    for (const [code, status] of [
      ["private", 404],
      ["not_found", 404],
      ["too_long", 413],
      ["unsupported", 422],
      ["blocked", 451],
      ["unavailable", 502],
      ["busy", 503],
      ["timeout", 504],
    ] as const) {
      workerReply = () => jsonResponse(status, { error: code });
      const res = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
      expect(res.statusCode, code).toBe(WORKER_FAILURE_REPLIES[code].status);
      expect(res.json(), code).toEqual(WORKER_FAILURE_REPLIES[code].body);
    }
    // 4xx de la vidéo : aucune alerte.
    resetAlertsForTests();
    logs = [];
    workerReply = () => jsonResponse(404, { error: "private" });
    for (let index = 0; index < 6; index++) await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(logs.some((line) => line.includes('"alerte":"echecs_repetes"'))).toBe(false);
    // 5xx panne : alerte « échecs répétés », source service_video.
    workerReply = () => jsonResponse(502, { error: "unavailable" });
    for (let index = 0; index < 5; index++) await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(logs.filter((line) => line.includes('"alerte":"echecs_repetes"') && line.includes('"source":"service_video"'))).toHaveLength(1);
    expect(logs.some((line) => line.includes("Image du moment d'une vidéo : service vidéo en échec"))).toBe(true);
    expectNoAiNorQuota();
  });

  it("service injoignable, réponse hors contrat : 502 « video_unavailable » ; secret refusé : journal « mal réglé »", async () => {
    const target = await buildApp({
      workerFetch: async (url, init) => {
        workerCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        throw new TypeError("fetch failed");
      },
    });
    expect((await frameOf(target, { url: SHARED_TEXT, atSeconds: AT })).json().error).toBe("video_unavailable");
    await app!.close();
    workerReply = () => jsonResponse(200, { durationSeconds: 7, frames: [] });
    const empty = await buildApp();
    expect((await frameOf(empty, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(502);
    workerReply = () => jsonResponse(401, { error: "unauthorized" });
    expect((await frameOf(empty, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(502);
    expect(logs.some((line) => line.includes("Image du moment d'une vidéo : service vidéo mal réglé"))).toBe(true);
  });

  it(`${MAX_PARALLEL_ANALYSES} demandes en cours (partagées avec l'analyse) : la suivante reçoit aussitôt 503 « video_busy »`, async () => {
    const pending: ((response: Response) => void)[] = [];
    workerReply = () => new Promise<Response>((resolve) => pending.push(resolve));
    const target = await buildApp();
    const running = Array.from({ length: MAX_PARALLEL_ANALYSES }, () => frameOf(target, { url: SHARED_TEXT, atSeconds: AT }));
    await vi.waitFor(() => expect(workerCalls).toHaveLength(MAX_PARALLEL_ANALYSES));
    const extra = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    expect(extra.statusCode).toBe(503);
    expect(extra.json().error).toBe("video_busy");
    for (const resolve of pending) resolve(jsonResponse(200, momentBody()));
    for (const res of await Promise.all(running)) expect(res.statusCode).toBe(200);
    workerReply = () => jsonResponse(200, momentBody());
    expect((await frameOf(target, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(200);
  });
});

describe("rien n'est gardé ni journalisé", () => {
  it("images effacées après la réponse, et même en erreur", async () => {
    const seen: (readonly WorkerFrame[])[] = [];
    vi.mocked(wipeFrames).mockImplementation((frames) => {
      seen.push(frames);
      for (const item of frames) item.data.fill(0);
    });
    const target = await buildApp();
    expect((await frameOf(target, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!).toHaveLength(1);
    expect(seen[0]![0]!.data.every((byte) => byte === 0)).toBe(true);
    // Image illisible (pas une vraie image JPEG malgré son en-tête) : erreur, et l'image reçue est effacée quand même.
    const broken = Buffer.concat([frame.subarray(0, 4), Buffer.alloc(200, 7)]);
    workerReply = () => jsonResponse(200, momentBody(broken));
    expect((await frameOf(target, { url: SHARED_TEXT, atSeconds: AT })).statusCode).toBe(502);
    expect(seen).toHaveLength(2);
    expect(seen[1]![0]!.data.every((byte) => byte === 0)).toBe(true);
    vi.mocked(wipeFrames).mockReset();
  });

  it("journal : « Image du moment d'une vidéo » avec des durées seulement — jamais l'adresse, l'identifiant, l'instant, le secret ni l'image", async () => {
    const target = await buildApp();
    const res = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    const image = res.json<VideoLinkFrameResponse>().image;
    workerReply = () => jsonResponse(451, { error: "blocked" });
    await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
    const line = logs.find((entry) => entry.includes("Image du moment d'une vidéo\""));
    expect(line).toBeDefined();
    expect(Object.keys(JSON.parse(line!))).toEqual(expect.arrayContaining(["platform", "workerMs", "totalMs"]));
    const text = logs.join("\n");
    for (const forbidden of [ID, "scout2015", "tiktok.com/@", String(AT), SECRET, image.slice(30, 90), "atSeconds"]) expect(text, forbidden).not.toContain(forbidden);
  });
});

describe("plafonds", () => {
  it("par membre : 30 par heure ; plafond commun des vidéos (partagé avec l'analyse) : 200 par heure", () => {
    expect(RATE_LIMITS.videoLinkFrame).toMatchObject({ max: 30, windowMs: 60 * 60 * 1000 });
    expect("scope" in RATE_LIMITS.videoLinkFrame).toBe(false);
    expect(RATE_LIMITS.videoLinkFetchGlobal).toMatchObject({ max: 200, windowMs: 60 * 60 * 1000, scope: "global" });
  });

  it("limites actives (hors tests) : 31e demande d'un membre dans l'heure → 429 ; plafond commun atteint → 503 « video_busy » sans appel", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const off = await buildApp({ workerConfig: { state: "off" } });
      const member = "e0000000-0000-4000-8000-000000000005";
      for (let index = 0; index < RATE_LIMITS.videoLinkFrame.max; index++) expect((await frameOf(off, { url: SHARED_TEXT, atSeconds: AT }, member)).statusCode).toBe(503);
      const limited = await frameOf(off, { url: SHARED_TEXT, atSeconds: AT }, member);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: "rate_limited", message: "Vous avez demandé beaucoup d'images de vidéos en peu de temps. Réessayez dans un moment." });
      await app!.close();

      const target = await buildApp();
      for (let index = 0; index < RATE_LIMITS.videoLinkFetchGlobal.max; index++) registerHit("videoLinkFetchGlobal:global", RATE_LIMITS.videoLinkFetchGlobal);
      const busy = await frameOf(target, { url: SHARED_TEXT, atSeconds: AT });
      expect(busy.statusCode).toBe(503);
      expect(busy.json().error).toBe("video_busy");
      expect(workerCalls).toEqual([]);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
