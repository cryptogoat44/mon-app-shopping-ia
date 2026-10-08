import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
import { registerHit } from "../src/plugins/rateLimit.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { askVideoMoments, VideoAiError } from "../src/services/videoMoments.js";
import { searchCapacityForVideoAi } from "../src/lib/searchCapacity.js";
import { authHeaders, buildMultipart, createTestUser, deleteTestUser, type MultipartFile, type TestUser } from "./helpers.js";

// Lot 4, temps 1 bis : point d'accès de l'analyse automatique. L'IA est
// SIMULÉE (aucun appel à Anthropic) ; comptes et consentements réels sur
// spotto-dev ; vraies images JPEG.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, ANTHROPIC_API_KEY: "cle-factice-des-tests" } };
});
vi.mock("../src/services/videoMoments.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/videoMoments.js")>();
  return { ...original, askVideoMoments: vi.fn() };
});
const askMock = vi.mocked(askVideoMoments);
// Plafond global des recherches (lot 4 quater) : simulé ici ; la fonction
// réelle de la base est testée dans searchCapacity.test.ts.
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, searchCapacityForVideoAi: vi.fn() };
});
const capacityMock = vi.mocked(searchCapacityForVideoAi);

const QUERY = "veste en daim marron";
const MOMENTS = [
  { frame: 1, box: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 } },
  { frame: 0, box: { x: 0, y: 0, width: 1, height: 1 } },
];

async function jpeg(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}
const FRAME_FILES: MultipartFile[] = await Promise.all(
  ["#2F3E4E", "#5A4632", "#4A5A3A"].map(async (color, index) => ({
    fieldname: "frame",
    filename: `image-${index}.jpg`,
    contentType: "image/jpeg",
    data: await jpeg(720, 1280, color),
  }))
);

const logs: string[] = [];

describe("analyse automatique d'une vidéo (POST /api/video-moments)", () => {
  let app: FastifyInstance;
  let consenting: TestUser;
  let withoutConsent: TestUser;
  let withdrawn: TestUser;
  let outdated: TestUser;
  const originalNodeEnv = process.env.NODE_ENV;

  function send(user: TestUser | null, fields: Record<string, string>, files: MultipartFile[] = FRAME_FILES) {
    const { payload, headers } = buildMultipart(fields, files);
    return app.inject({ method: "POST", url: "/api/video-moments", payload, headers: { ...headers, ...(user ? authHeaders(user.token) : {}) } });
  }

  async function recordChoice(user: TestUser, granted: boolean) {
    const response = await app.inject({
      method: "POST",
      url: "/api/consents",
      headers: authHeaders(user.token),
      payload: { consents: [{ type: "analyse_video_ia", version: CONSENT_VERSIONS.analyse_video_ia, granted }] },
    });
    expect(response.statusCode).toBe(204);
  }

  beforeAll(async () => {
    app = await buildApp({ logger: { level: "info", stream: { write: (line: string) => logs.push(line) } } });
    await app.ready();
    [consenting, withoutConsent, withdrawn, outdated] = await Promise.all([
      createTestUser(app, "vma"),
      createTestUser(app, "vmb"),
      createTestUser(app, "vmc"),
      createTestUser(app, "vmd"),
    ]);
    await recordChoice(consenting, true);
    await recordChoice(withdrawn, true);
    await recordChoice(withdrawn, false);
    // Accord donné sur un texte qui n'est plus en vigueur.
    const { error } = await app.supabaseAdmin
      .from("consents")
      .insert({ user_id: outdated.id, type: "analyse_video_ia", granted_at: new Date().toISOString(), document_version: "analyse-video-ia-ancienne" });
    expect(error).toBeNull();
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await Promise.all([consenting, withoutConsent, withdrawn, outdated].map((user) => deleteTestUser(app, user.id)));
    await app.close();
  });

  beforeEach(() => {
    askMock.mockReset();
    askMock.mockResolvedValue({ moments: MOMENTS, candidates: MOMENTS.map((moment) => ({ ...moment, confidence: 0.9 })), usage: { inputTokens: 900, outputTokens: 50 } });
    env.ANTHROPIC_API_KEY = "cle-factice-des-tests";
    capacityMock.mockReset();
    capacityMock.mockResolvedValue({ allowed: true });
  });

  it("indique si la fonction est active (clé d'API présente), compte connecté seulement", async () => {
    expect((await app.inject({ method: "GET", url: "/api/video-moments/status" })).statusCode).toBe(401);
    const enabled = await app.inject({ method: "GET", url: "/api/video-moments/status", headers: authHeaders(consenting.token) });
    expect(enabled.json()).toEqual({ enabled: true });
    env.ANTHROPIC_API_KEY = undefined;
    const disabled = await app.inject({ method: "GET", url: "/api/video-moments/status", headers: authHeaders(consenting.token) });
    expect(disabled.json()).toEqual({ enabled: false });
  });

  it("cas nominal : images vérifiées et réduites à 512 px, moments renvoyés, images effacées après la réponse", async () => {
    const response = await send(consenting, { query: `  ${QUERY} ` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ moments: MOMENTS });
    expect(askMock).toHaveBeenCalledTimes(1);
    const [frames, query, options] = askMock.mock.calls[0]!;
    expect(query).toBe(QUERY);
    expect(options).toEqual({ apiKey: "cle-factice-des-tests", model: "claude-sonnet-5-5", lowEffort: true });
    expect(frames.map((frame) => [frame.width, frame.height])).toEqual([
      [288, 512],
      [288, 512],
      [288, 512],
    ]);
    // Effacées dès la réponse : le serveur ne garde rien.
    expect(frames.every((frame) => frame.data.every((byte) => byte === 0))).toBe(true);
  });

  it("sans connexion : 401", async () => {
    expect((await send(null, { query: QUERY })).statusCode).toBe(401);
  });

  it("sans consentement, consentement retiré ou donné sur un ancien texte : 403, aucune image ne part", async () => {
    for (const user of [withoutConsent, withdrawn, outdated]) {
      const response = await send(user, { query: QUERY });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("video_ai_consent_required");
    }
    expect(askMock).not.toHaveBeenCalled();
  });

  it("clé d'API absente : fonction désactivée proprement (503), rien n'est envoyé", async () => {
    env.ANTHROPIC_API_KEY = undefined;
    const response = await send(consenting, { query: QUERY });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("video_ai_disabled");
    expect(askMock).not.toHaveBeenCalled();
  });

  it("entrées invalides : texte trop court ou trop long, aucune image, trop d'images, fichier illisible, champ inattendu, pas un formulaire", async () => {
    const tooMany = Array.from({ length: 13 }, (_, index) => ({ ...FRAME_FILES[0]!, filename: `image-${index}.jpg` }));
    const unreadable = [{ fieldname: "frame", filename: "x.jpg", contentType: "image/jpeg", data: randomBytes(2048) }];
    const tiny = [{ fieldname: "frame", filename: "x.jpg", contentType: "image/jpeg", data: await jpeg(32, 32, "#000000") }];
    const cases: [Record<string, string>, MultipartFile[], string][] = [
      [{ query: "a" }, FRAME_FILES, "invalid_query"],
      [{ query: "x".repeat(61) }, FRAME_FILES, "invalid_query"],
      [{}, FRAME_FILES, "invalid_query"],
      [{ query: QUERY }, [], "invalid_frames"],
      [{ query: QUERY }, tooMany, "invalid_frames"],
      [{ query: QUERY }, unreadable, "invalid_frames"],
      [{ query: QUERY }, tiny, "invalid_frames"],
      [{ query: QUERY, crop: "{}" }, FRAME_FILES, "invalid_frames"],
    ];
    for (const [fields, files, error] of cases) {
      const response = await send(consenting, fields, files);
      expect(response.statusCode, `${error} (${files.length} fichier(s), champs ${Object.keys(fields).join(",")})`).toBe(400);
      expect(response.json().error).toBe(error);
    }
    const json = await app.inject({ method: "POST", url: "/api/video-moments", headers: authHeaders(consenting.token), payload: { query: QUERY } });
    expect(json.statusCode).toBe(400);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("plafond des recherches atteint (lot 4 quater : jour, mois, part de la personne) : aucune image ne part à l'IA, message honnête", async () => {
    capacityMock.mockResolvedValueOnce({ allowed: false, limit: "day" });
    const day = await send(consenting, { query: QUERY });
    expect(day.statusCode).toBe(429);
    expect(day.json()).toEqual({ error: "search_capacity_day", message: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain." });
    // La part de la personne se lit pour celle qui demande l'analyse.
    expect(capacityMock.mock.calls[0]![2]).toBe(consenting.id);
    capacityMock.mockResolvedValueOnce({ allowed: false, limit: "month" });
    expect((await send(consenting, { query: QUERY })).json().error).toBe("search_capacity_month");
    capacityMock.mockResolvedValueOnce({ allowed: false, limit: "user" });
    const user = await send(consenting, { query: QUERY });
    expect(user.statusCode).toBe(429);
    expect(user.json()).toEqual({ error: "search_capacity_user", message: "Vous avez atteint votre limite de recherches pour aujourd'hui. Réessayez demain." });
    expect(askMock).not.toHaveBeenCalled();
  });

  it("plafond illisible (base injoignable) : pas d'analyse, une panne annoncée comme telle (503)", async () => {
    capacityMock.mockRejectedValueOnce(new Error("base injoignable"));
    const response = await send(consenting, { query: QUERY });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("video_ai_unavailable");
    expect(askMock).not.toHaveBeenCalled();
  });

  it("image trop lourde : 413", async () => {
    const heavy = [{ fieldname: "frame", filename: "x.jpg", contentType: "image/jpeg", data: Buffer.concat([FRAME_FILES[0]!.data, randomBytes(600 * 1024)]) }];
    const response = await send(consenting, { query: QUERY }, heavy);
    expect(response.statusCode).toBe(413);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("IA indisponible (limite de dépense, panne, refus) : 503 compréhensible, jamais présenté comme « introuvable »", async () => {
    for (const error of [new VideoAiError("unavailable", 400), new VideoAiError("unavailable", 529), new VideoAiError("refused")]) {
      askMock.mockRejectedValueOnce(error);
      const response = await send(consenting, { query: QUERY });
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe("video_ai_unavailable");
    }
  });

  it("pièce introuvable : 200 et liste vide (un résultat, pas une panne)", async () => {
    askMock.mockResolvedValueOnce({ moments: [], candidates: [], usage: { inputTokens: 900, outputTokens: 10 } });
    const response = await send(consenting, { query: QUERY });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ moments: [] });
  });

  it("moments trop peu sûrs (écartés par le service) : « aucun moment » ; la confiance n'est jamais envoyée à l'app", async () => {
    const unsure = MOMENTS.map((moment) => ({ ...moment, confidence: 0.3 }));
    askMock.mockResolvedValueOnce({ moments: [], candidates: unsure, usage: { inputTokens: 900, outputTokens: 70 } });
    const response = await send(consenting, { query: QUERY });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ moments: [] });
    expect(response.body).not.toContain("confidence");
    askMock.mockResolvedValueOnce({ moments: MOMENTS, candidates: MOMENTS.map((moment) => ({ ...moment, confidence: 0.95 })), usage: { inputTokens: 900, outputTokens: 70 } });
    expect((await send(consenting, { query: QUERY })).body).not.toContain("confidence");
  });

  it("message en anglais si l'app le demande", async () => {
    const { payload, headers } = buildMultipart({ query: QUERY }, FRAME_FILES);
    const response = await app.inject({
      method: "POST",
      url: "/api/video-moments",
      payload,
      headers: { ...headers, ...authHeaders(withoutConsent.token), "accept-language": "en" },
    });
    expect(response.json().message).toBe("Please accept automatic analysis first, or choose the frame with the slider.");
  });

  it("journaux : des compteurs, jamais le texte ni les images", async () => {
    logs.length = 0;
    await send(consenting, { query: QUERY });
    const text = logs.join("\n");
    expect(text).toContain('"frames":3');
    expect(text).toContain('"candidates":2');
    expect(text).toContain('"inputTokens":900');
    expect(text).not.toContain("daim");
    expect(text).not.toContain(FRAME_FILES[0]!.data.toString("base64").slice(0, 40));
  });

  describe("limites quotidiennes (activées pour ces tests)", () => {
    beforeAll(() => {
      process.env.NODE_ENV = "development";
    });
    afterAll(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("par utilisateur : au-delà de 10 analyses, 429 avec un message clair ; un refus ne compte pas", async () => {
      expect((await send(consenting, { query: "a" })).statusCode).toBe(400);
      for (let call = 0; call < RATE_LIMITS.videoAiUser.max; call += 1) {
        expect((await send(consenting, { query: QUERY })).statusCode).toBe(200);
      }
      const blocked = await send(consenting, { query: QUERY });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: "video_ai_user_limit", message: RATE_LIMITS.videoAiUser.message });
      expect(askMock).toHaveBeenCalledTimes(RATE_LIMITS.videoAiUser.max);
    });

    it("plafond commun à tout le service : atteint, plus personne n'envoie d'images", async () => {
      for (let hit = 0; hit < RATE_LIMITS.videoAiGlobal.max; hit += 1) registerHit("videoAiGlobal:global", RATE_LIMITS.videoAiGlobal);
      await recordChoice(withoutConsent, true);
      const blocked = await send(withoutConsent, { query: QUERY });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe("video_ai_global_limit");
      expect(askMock).not.toHaveBeenCalled();
    });
  });
});
