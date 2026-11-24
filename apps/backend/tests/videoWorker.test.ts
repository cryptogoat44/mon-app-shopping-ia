import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeVideoLink, type VideoLink } from "@monapp/shared-types";
import {
  AI_KEY_MISSING,
  CONFIG_WARNING,
  VIDEO_WORKER_ERROR_CODES,
  VIDEO_WORKER_MAX_FRAMES,
  VIDEO_WORKER_MAX_RESPONSE_BYTES,
  VideoWorkerError,
  WORKER_ERROR_BY_STATUS,
  fetchVideoFrames,
  isPrivateNetworkHost,
  logVideoWorkerConfigState,
  readVideoWorkerConfig,
  wipeFrames,
  workerVideoUrl,
  type VideoWorkerConfig,
  type VideoWorkerEnvSource,
} from "../src/lib/videoWorker.js";

// Lot « vidéo auto » : réglages et client du service vidéo séparé
// (lib/videoWorker.ts). Sans base, sans réseau : le service vidéo est imité
// par un petit serveur local (http, 127.0.0.1) ; aucune plateforme n'est
// jamais appelée.

const SECRET = "s".repeat(24) + "-secret-de-test-0123456789";
const ID = "7412345678901234567";
const CANONICAL = `https://www.tiktok.com/@scout2015/video/${ID}`;

function source(values: Partial<VideoWorkerEnvSource>): VideoWorkerEnvSource {
  return { VIDEO_LINK_ANALYSIS_ENABLED: false, VIDEO_WORKER_URL: undefined, VIDEO_WORKER_SECRET: undefined, ...values };
}

async function jpeg(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 82 }).toBuffer();
}

describe("réglages du service vidéo (lus une fois, au démarrage)", () => {
  it("interrupteur : coupé sauf valeur exacte « true » ; coupé, ni l'adresse ni le secret ne sont lus", () => {
    expect(readVideoWorkerConfig(source({}))).toEqual({ state: "off" });
    const untouchable = {
      VIDEO_LINK_ANALYSIS_ENABLED: false,
      get VIDEO_WORKER_URL(): string {
        throw new Error("l'adresse ne doit pas être lue");
      },
      get VIDEO_WORKER_SECRET(): string {
        throw new Error("le secret ne doit pas être lu");
      },
    } as VideoWorkerEnvSource;
    expect(readVideoWorkerConfig(untouchable)).toEqual({ state: "off" });
  });

  it("prêt : adresse interne de Render en http, ou adresse https ; « / » final retiré", () => {
    expect(readVideoWorkerConfig(source({ VIDEO_LINK_ANALYSIS_ENABLED: true, VIDEO_WORKER_URL: "http://spotto-video:10000", VIDEO_WORKER_SECRET: SECRET }))).toEqual({
      state: "ready",
      config: { baseUrl: "http://spotto-video:10000", secret: SECRET },
    });
    expect(readVideoWorkerConfig(source({ VIDEO_LINK_ANALYSIS_ENABLED: true, VIDEO_WORKER_URL: " https://video.example.org/service/ ", VIDEO_WORKER_SECRET: SECRET }))).toEqual({
      state: "ready",
      config: { baseUrl: "https://video.example.org/service", secret: SECRET },
    });
    for (const local of ["http://localhost:4100", "http://127.0.0.1:4100", "http://10.0.3.7:10000", "http://192.168.1.20:10000", "http://172.20.0.5:10000", "http://[::1]:4100"]) {
      expect(readVideoWorkerConfig(source({ VIDEO_LINK_ANALYSIS_ENABLED: true, VIDEO_WORKER_URL: local, VIDEO_WORKER_SECRET: SECRET })).state, local).toBe("ready");
    }
  });

  it("invalide : adresse absente, illisible, avec identifiants ou paramètres, http hors du réseau privé ; secret absent ou trop court. Raisons fixes, jamais la valeur", () => {
    const cases: [Partial<VideoWorkerEnvSource>, string][] = [
      [{ VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : absente"],
      [{ VIDEO_WORKER_URL: "  ", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : absente"],
      [{ VIDEO_WORKER_URL: "spotto-video:10000", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : adresse http ou https"],
      [{ VIDEO_WORKER_URL: "ftp://spotto-video", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : adresse http ou https"],
      [{ VIDEO_WORKER_URL: "http://moi:motdepasse@spotto-video:10000", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : adresse http ou https"],
      [{ VIDEO_WORKER_URL: "http://spotto-video:10000/?cle=1", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : adresse http ou https"],
      [{ VIDEO_WORKER_URL: "http://spotto-video:10000/#x", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : adresse http ou https"],
      [{ VIDEO_WORKER_URL: "http://video.example.org", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : http seulement sur le réseau privé"],
      [{ VIDEO_WORKER_URL: "http://8.8.8.8:10000", VIDEO_WORKER_SECRET: SECRET }, "VIDEO_WORKER_URL : http seulement sur le réseau privé"],
      [{ VIDEO_WORKER_URL: "http://spotto-video:10000" }, "VIDEO_WORKER_SECRET : absent"],
      [{ VIDEO_WORKER_URL: "http://spotto-video:10000", VIDEO_WORKER_SECRET: "court" }, "VIDEO_WORKER_SECRET : forme invalide"],
      [{ VIDEO_WORKER_URL: "http://spotto-video:10000", VIDEO_WORKER_SECRET: `${SECRET} avec espace` }, "VIDEO_WORKER_SECRET : forme invalide"],
    ];
    for (const [values, reason] of cases) {
      const state = readVideoWorkerConfig(source({ VIDEO_LINK_ANALYSIS_ENABLED: true, ...values }));
      expect(state.state, JSON.stringify(values)).toBe("invalid");
      if (state.state !== "invalid") continue;
      expect(state.problems.some((problem) => problem.startsWith(reason)), `${JSON.stringify(values)} → ${state.problems.join(" | ")}`).toBe(true);
      const text = JSON.stringify(state.problems);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("motdepasse");
      expect(text).not.toContain("video.example.org");
    }
  });

  it("une seule ligne d'avertissement au démarrage : réglages invalides, ou clé d'Anthropic absente ; jamais l'adresse ni le secret", () => {
    const warn = vi.fn();
    logVideoWorkerConfigState({ state: "off" }, false, { warn });
    logVideoWorkerConfigState({ state: "ready", config: { baseUrl: "http://spotto-video:10000", secret: SECRET } }, true, { warn });
    expect(warn).not.toHaveBeenCalled();
    const invalid = readVideoWorkerConfig(source({ VIDEO_LINK_ANALYSIS_ENABLED: true, VIDEO_WORKER_URL: "http://video.example.org", VIDEO_WORKER_SECRET: "court" }));
    logVideoWorkerConfigState(invalid, true, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toBe(CONFIG_WARNING);
    expect(warn.mock.calls[0]![0].problems).toHaveLength(2);
    logVideoWorkerConfigState({ state: "ready", config: { baseUrl: "http://spotto-video:10000", secret: SECRET } }, false, { warn });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toEqual({ problems: [AI_KEY_MISSING] });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/spotto-video|video\.example|court|secret-de-test/);
  });

  it("réseau privé : noms internes sans point, localhost, adresses IPv4 locales ou privées", () => {
    for (const host of ["spotto-video", "spotto-video-x7k2", "localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "[::1]"]) {
      expect(isPrivateNetworkHost(host), host).toBe(true);
    }
    for (const host of ["video.example.org", "spotto-video.onrender.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "-spotto"]) {
      expect(isPrivateNetworkHost(host), host).toBe(false);
    }
  });
});

describe("adresse donnée au service vidéo : la canonique, revérifiée", () => {
  it("TikTok (vidéo, sans pseudo), Instagram (reel, publication) : l'adresse canonique reconnue, sans aucun paramètre", () => {
    const tiktok = normalizeVideoLink(`Regardez https://www.tiktok.com/@Scout2015/video/${ID}?_r=1&_t=8abc&utm_source=copy !`)!;
    expect(workerVideoUrl(tiktok)).toBe(CANONICAL);
    const bare = normalizeVideoLink(`https://m.tiktok.com/v/${ID}.html?share=1`)!;
    expect(workerVideoUrl(bare)).toBe(`https://www.tiktok.com/@/video/${ID}`);
    const reel = normalizeVideoLink("https://instagram.com/reel/C8abcDEF123/?igsh=MWQ1ZGUxMzBkMA==")!;
    expect(workerVideoUrl(reel)).toBe("https://www.instagram.com/reel/C8abcDEF123/");
    const post = normalizeVideoLink("https://www.instagram.com/someone/p/C8abcDEF123/")!;
    expect(workerVideoUrl(post)).toBe("https://www.instagram.com/p/C8abcDEF123/");
  });

  it("une vidéo dont l'adresse aurait été modifiée n'est jamais envoyée", () => {
    const link = normalizeVideoLink(CANONICAL)!;
    const tampered: VideoLink[] = [
      { ...link, canonicalUrl: "https://evil.example/@scout2015/video/7412345678901234567" },
      { ...link, canonicalUrl: `${CANONICAL}?x=1` },
      { ...link, canonicalUrl: `http://www.tiktok.com/@scout2015/video/${ID}` },
      { ...link, canonicalUrl: `https://www.tiktok.com/@scout2015/video/${ID}@169.254.169.254` },
      { ...link, videoKey: "7412345678901234999" },
      { ...link, platform: "instagram" },
    ];
    for (const candidate of tampered) expect(workerVideoUrl(candidate), JSON.stringify(candidate)).toBeNull();
  });
});

// ---- Client, face à un faux service vidéo local ----

interface Received {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

describe("client du service vidéo (fetchVideoFrames)", () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let received: Received[];
  let frameA: Buffer;
  let frameB: Buffer;
  const config = () => ({ baseUrl, secret: SECRET }) satisfies VideoWorkerConfig;
  const request = { url: CANONICAL, platform: "tiktok" as const };

  function json(status: number, body: unknown, headers: Record<string, string> = {}): Handler {
    return (_request, response) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(body));
    };
  }

  function framesBody(overrides: Record<string, unknown> = {}) {
    return {
      durationSeconds: 14.2,
      frames: [
        { timeSeconds: 1.5, width: 720, height: 1280, jpegBase64: frameA.toString("base64") },
        { timeSeconds: 6, width: 720, height: 1280, jpegBase64: frameB.toString("base64") },
      ],
      ...overrides,
    };
  }

  async function failure(promise: Promise<unknown>): Promise<VideoWorkerError> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(VideoWorkerError);
    return error as VideoWorkerError;
  }

  beforeAll(async () => {
    frameA = await jpeg(720, 1280, "#2F3E4E");
    frameB = await jpeg(720, 1280, "#8A3B2C");
    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // corps non JSON : gardé tel quel
        }
        received.push({
          method: incoming.method,
          url: incoming.url,
          authorization: incoming.headers.authorization,
          contentType: incoming.headers["content-type"],
          body,
        });
        handler(incoming, response);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    received = [];
    handler = json(200, framesBody());
  });

  it("cas nominal : POST /frames avec le secret et l'adresse canonique ; images décodées, dans l'ordre", async () => {
    const result = await fetchVideoFrames(config(), request);
    expect(received).toEqual([
      { method: "POST", url: "/frames", authorization: `Bearer ${SECRET}`, contentType: "application/json", body: { url: CANONICAL, platform: "tiktok" } },
    ]);
    expect(result.durationSeconds).toBe(14.2);
    expect(result.frames.map((frame) => [frame.timeSeconds, frame.width, frame.height])).toEqual([
      [1.5, 720, 1280],
      [6, 720, 1280],
    ]);
    expect(result.frames[0]!.data.equals(frameA)).toBe(true);
    expect(result.frames[1]!.data.equals(frameB)).toBe(true);
    // Effacées à la demande, une fois utilisées.
    wipeFrames(result.frames);
    expect(result.frames.every((frame) => frame.data.every((byte) => byte === 0))).toBe(true);
  });

  it("chaque erreur du contrat : le code JSON fait foi, quel que soit le statut", async () => {
    for (const code of VIDEO_WORKER_ERROR_CODES) {
      handler = json(code === "private" ? 404 : 500, { error: code });
      const error = await failure(fetchVideoFrames(config(), request));
      expect(error.kind, code).toBe(code);
      expect(error.message).toBe(`video_worker_${code}`);
    }
  });

  it("code absent ou inconnu : déduit du statut (400, 401, 403, 404, 413, 422, 451, 502, 503, 504), sinon « unavailable »", async () => {
    for (const [status, code] of Object.entries(WORKER_ERROR_BY_STATUS)) {
      handler = json(Number(status), { error: "autre_chose" });
      expect((await failure(fetchVideoFrames(config(), request))).kind, status).toBe(code);
    }
    handler = (_request, response) => {
      response.writeHead(500, { "content-type": "text/html" });
      response.end("<h1>panne</h1>");
    };
    const error = await failure(fetchVideoFrames(config(), request));
    expect(error).toMatchObject({ kind: "unavailable", status: 500 });
  });

  it("une redirection n'est jamais suivie : réponse hors contrat, la cible n'est jamais demandée", async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: `${baseUrl}/ailleurs` });
      response.end();
    };
    expect((await failure(fetchVideoFrames(config(), request))).kind).toBe("invalid_response");
    expect(received.map((entry) => entry.url)).toEqual(["/frames"]);
  });

  it("réponse hors contrat : pas du JSON, champs manquants, trop d'images, image trop grande, pas un JPEG, ordre du temps, instant après la fin", async () => {
    const notJpeg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");
    const many = Array.from({ length: VIDEO_WORKER_MAX_FRAMES + 1 }, (_, index) => ({ timeSeconds: index, width: 720, height: 1280, jpegBase64: frameA.toString("base64") }));
    const bodies: [string, Handler][] = [
      [
        "texte",
        (_request, response) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end("pas du json");
        },
      ],
      ["vide", json(200, {})],
      ["sans images", json(200, framesBody({ frames: [] }))],
      ["trop d'images", json(200, framesBody({ durationSeconds: 60, frames: many }))],
      ["trop grande", json(200, framesBody({ frames: [{ timeSeconds: 1, width: 1920, height: 1080, jpegBase64: frameA.toString("base64") }] }))],
      ["pas un JPEG", json(200, framesBody({ frames: [{ timeSeconds: 1, width: 720, height: 1280, jpegBase64: notJpeg }] }))],
      ["pas du base64", json(200, framesBody({ frames: [{ timeSeconds: 1, width: 720, height: 1280, jpegBase64: "@@@@" }] }))],
      [
        "désordre",
        json(
          200,
          framesBody({
            frames: [
              { timeSeconds: 6, width: 720, height: 1280, jpegBase64: frameA.toString("base64") },
              { timeSeconds: 1, width: 720, height: 1280, jpegBase64: frameB.toString("base64") },
            ],
          })
        ),
      ],
      ["après la fin", json(200, framesBody({ durationSeconds: 3, frames: [{ timeSeconds: 9, width: 720, height: 1280, jpegBase64: frameA.toString("base64") }] }))],
      ["durée négative", json(200, framesBody({ durationSeconds: -1 }))],
    ];
    for (const [name, body] of bodies) {
      handler = body;
      expect((await failure(fetchVideoFrames(config(), request))).kind, name).toBe("invalid_response");
    }
  });

  it("une propriété de plus est ignorée ; moins de 6 images (vidéo très courte) sont acceptées", async () => {
    handler = json(200, { ...framesBody({ frames: [{ timeSeconds: 0.4, width: 720, height: 1280, jpegBase64: frameA.toString("base64"), sharpness: 0.9 }] }), version: 2 });
    const result = await fetchVideoFrames(config(), request);
    expect(result.frames).toHaveLength(1);
    wipeFrames(result.frames);
  });

  it("réponse trop lourde (annoncée ou reçue) : abandonnée, hors contrat", async () => {
    const heavy = JSON.stringify(framesBody());
    handler = (_request, response) => {
      // Taille annoncée : refusée avant toute lecture.
      response.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(heavy)) });
      response.end(heavy);
    };
    expect((await failure(fetchVideoFrames(config(), request, { maxResponseBytes: 1024 }))).kind).toBe("invalid_response");
    handler = (_request, response) => {
      // Sans taille annoncée : la lecture s'arrête au plafond.
      response.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
      response.write(JSON.stringify(framesBody()).slice(0, 4000));
      response.end(" ".repeat(4000));
    };
    expect((await failure(fetchVideoFrames(config(), request, { maxResponseBytes: 1024 }))).kind).toBe("invalid_response");
  });

  it("retours du build 2 : le plafond de lecture couvre les images moins compressées du service vidéo, dans n'importe quel ordre de déploiement", () => {
    const contract = readFileSync(join(__dirname, "../../video-worker/src/contract.js"), "utf8");
    const total = Number(/maxTotalFrameBytes: ([\d_]+),/.exec(contract)?.[1]?.replaceAll("_", ""));
    expect(total).toBe(9_000_000);
    const base64 = Math.ceil(total / 3) * 4;
    // Permis : base64 et un peu de JSON tiennent sous le plafond actuel ET sous celui du serveur en ligne (12 Mio).
    expect(base64 + 64 * 1024).toBeLessThan(VIDEO_WORKER_MAX_RESPONSE_BYTES);
    expect(VIDEO_WORKER_MAX_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
    expect(base64 + 64 * 1024).toBeLessThan(12 * 1024 * 1024);
    // Refusé : 11 Mo d'images n'auraient pas tenu sous l'ancien plafond (12 Mio).
    expect(Math.ceil(11_000_000 / 3) * 4).toBeGreaterThan(12 * 1024 * 1024);
    expect(contract).toContain("jpegQscale: 2,");
  });

  it("délai dépassé : « timeout » ; service injoignable : « unreachable »", async () => {
    handler = () => {
      // Ne répond jamais.
    };
    const started = Date.now();
    expect((await failure(fetchVideoFrames(config(), request, { timeoutMs: 150 }))).kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5_000);
    server.closeAllConnections();
    const closed = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
    expect((await failure(fetchVideoFrames({ baseUrl: `http://127.0.0.1:${closed}`, secret: SECRET }, request))).kind).toBe("unreachable");
  });

  it("l'erreur ne dit jamais l'adresse, le secret ni une image (type et statut seulement)", async () => {
    handler = json(451, { error: "blocked", detail: CANONICAL });
    const error = await failure(fetchVideoFrames(config(), request));
    expect(error).toMatchObject({ name: "VideoWorkerError", kind: "blocked", status: 451 });
    expect(`${error.message} ${error.stack ?? ""}`).not.toMatch(/tiktok|secret-de-test|base64/);
  });
});
