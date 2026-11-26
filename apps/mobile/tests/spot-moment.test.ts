import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME_FAILURES, chooseSpotImage, frameFailureReason, frameSeconds, parseVideoLinkFrame, shouldAskServer, snapshotErrorCode } from "../src/lib/spot-moment";

// Retours du build 3 : « Spotter ce moment » — l'image du serveur (TikTok,
// `frame: true`) d'abord, l'instantané contrôlé en secours, sinon le secours.
const SERVER = { image: "data:image/jpeg;base64,/9j/4AAQ", width: 720, height: 1280 };
const SHOT = { uri: "file:///cache/lecteur-instantane/1.jpg", width: 1600, height: 900 };

describe("chooseSpotImage", () => {
  it("image du serveur reçue : elle passe (l'instantané éventuel est effacé par l'appelant)", () => {
    expect(chooseSpotImage({ server: SERVER, snapshot: SHOT, snapshotError: null })).toEqual({ source: "server", ...SERVER });
    expect(chooseSpotImage({ server: SERVER, snapshot: null, snapshotError: "blurry_frame" })).toEqual({ source: "server", ...SERVER });
  });

  it("serveur en échec, instantané net : l'instantané", () => {
    expect(chooseSpotImage({ server: null, snapshot: SHOT, snapshotError: null })).toEqual({ source: "snapshot", ...SHOT });
  });

  it("refusé : serveur en échec et instantané flou → aucune image (snapshot_blurry) ; noir ou autre → snapshot_failed", () => {
    expect(chooseSpotImage({ server: null, snapshot: null, snapshotError: "blurry_frame" })).toEqual({ source: "none", reason: "snapshot_blurry" });
    expect(chooseSpotImage({ server: null, snapshot: null, snapshotError: "blank_frame" })).toEqual({ source: "none", reason: "snapshot_failed" });
    expect(chooseSpotImage({ server: null, snapshot: null, snapshotError: "other" })).toEqual({ source: "none", reason: "snapshot_failed" });
  });
});

describe("shouldAskServer / frameSeconds", () => {
  it("permis : TikTok, serveur qui le permet, temps connu", () => {
    expect(shouldAskServer({ platform: "tiktok", frame: true, lastTime: 3.2 })).toBe(true);
    expect(shouldAskServer({ platform: "tiktok", frame: true, lastTime: 0 })).toBe(true);
  });

  it("refusé : temps inconnu, Instagram, ou `frame` faux (serveur sans le lot 1)", () => {
    expect(shouldAskServer({ platform: "tiktok", frame: true, lastTime: null })).toBe(false);
    expect(shouldAskServer({ platform: "instagram", frame: true, lastTime: 3 })).toBe(false);
    expect(shouldAskServer({ platform: "tiktok", frame: false, lastTime: 3 })).toBe(false);
    expect(shouldAskServer({ platform: "tiktok", frame: true, lastTime: Number.NaN })).toBe(false);
  });

  it("frameSeconds : à la milliseconde, borné à [0, 90]", () => {
    expect(frameSeconds(95)).toBe(90);
    expect(frameSeconds(3.21456)).toBe(3.215);
    expect(frameSeconds(-1)).toBe(0);
  });
});

describe("réponse du serveur vérifiée (parseVideoLinkFrame)", () => {
  it("permis : une image JPEG en « data: », côtés entiers de 1 à 2 000", () => {
    expect(parseVideoLinkFrame({ ...SERVER, timeSeconds: 3.2 })).toEqual({ ...SERVER, timeSeconds: 3.2 });
  });

  it("refusé : autre type d'image, adresse, côtés hors bornes ou non entiers, corps illisible", () => {
    for (const body of [
      { ...SERVER, image: "data:image/png;base64,iVBOR" },
      { ...SERVER, image: "https://exemple.test/a.jpg" },
      { ...SERVER, image: "data:image/jpeg;base64," },
      { ...SERVER, width: 0 },
      { ...SERVER, height: 2001 },
      { ...SERVER, width: 12.5 },
      { ...SERVER, width: "720" },
      null,
      "texte",
    ]) {
      expect(parseVideoLinkFrame(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe("codes d'erreur", () => {
  it("instantané : blank_frame, blurry_frame, sinon other", () => {
    expect(snapshotErrorCode(new Error("blank_frame"))).toBe("blank_frame");
    expect(snapshotErrorCode(new Error("blurry_frame"))).toBe("blurry_frame");
    expect(snapshotErrorCode(new Error("illisible"))).toBe("other");
    expect(snapshotErrorCode("x")).toBe("other");
  });

  it("image du serveur : codes du service, interrupteur coupé, réponse refusée, délai, réseau ; jamais l'adresse", () => {
    const api = (status: number, error: string) => ({ status, body: { error, message: "m" } });
    expect(frameFailureReason(api(422, "video_private"))).toBe("video_private");
    expect(frameFailureReason(api(503, "video_frame_disabled"))).toBe("disabled");
    expect(frameFailureReason(api(502, "invalid_frame"))).toBe("invalid");
    expect(frameFailureReason(api(429, "rate_limited"))).toBe("rate_limited");
    expect(frameFailureReason(api(500, "https://www.tiktok.com/@x/video/1"))).toBe("server");
    expect(frameFailureReason(new Error("frame_timeout"))).toBe("timeout");
    expect(frameFailureReason(new TypeError("Network request failed"))).toBe("network");
  });
});

// Assemblage des retours du build 3 : le contrat entre l'app (lot 2) et le
// serveur (lot 1) pour POST /api/video-links/frame, vérifié des deux côtés.
const ROOT = join(__dirname, "..", "..", "..");
const readRoot = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("contrat de l'image du moment : app (lot 2) ↔ serveur (lot 1)", () => {
  const api = readRoot("apps/mobile/src/lib/api.ts");
  const shared = readRoot("packages/shared-types/src/index.ts");
  const route = readRoot("apps/backend/src/routes/videoLinkAnalysis.ts");

  it("types partagés seulement : plus aucune copie locale dans api.ts", () => {
    expect(api).not.toMatch(/export interface VideoLinkFrame(Request|Response)\b/);
    expect(api).toMatch(/^\s+VideoLinkFrameRequest,$/m);
    expect(api).toMatch(/^\s+VideoLinkFrameResponse,$/m);
    expect(api).toContain("fetchVideoLinkFrame(request: VideoLinkFrameRequest, signal?: AbortSignal): Promise<VideoLinkFrameResponse>");
  });

  it("même route, même méthode, mêmes champs du corps", () => {
    expect(api).toContain('authorizedFetch("/api/video-links/frame", { method: "POST", body: JSON.stringify({ url: request.url, atSeconds: request.atSeconds })');
    expect(route).toMatch(/fastify\.post\(\s*"\/api\/video-links\/frame"/);
    expect(route).toContain("urlField.safeParse(body.url)");
    expect(route).toContain("momentField.safeParse(body.atSeconds)");
    // Le serveur admet 0 à 90 s : l'app n'envoie jamais rien hors de ces bornes.
    expect(route).toContain("const momentField = z.number().finite().min(0).max(90);");
    expect(frameSeconds(90.4)).toBe(90);
    expect(frameSeconds(-1)).toBe(0);
  });

  it("chaque code d'erreur du serveur est traduit d'après le CODE ; un code inconnu : « server »", () => {
    const union = shared.match(/export type VideoLinkFrameErrorCode =([^;]+);/);
    expect(union).not.toBeNull();
    const codes = [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const code of codes) {
      const reason = frameFailureReason({ status: 400, body: { error: code, message: "Message du serveur qui parle d'analyse" } });
      expect(FRAME_FAILURES, code).toContain(reason);
      expect(reason, code).not.toBe("network");
      if (code !== "internal_error") expect(reason, code).not.toBe("server");
    }
    // Refusé : un code que le contrat ne connaît pas.
    expect(frameFailureReason({ status: 502, body: { error: "video_no_moment", message: "m" } })).toBe("server");
    // Plafond par membre : 429 (code commun « rate_limited » du limiteur).
    expect(frameFailureReason({ status: 429, body: { error: "autre", message: "m" } })).toBe("rate_limited");
  });

  it("chaque réponse d'échec de la route porte un code du contrat", () => {
    const frameRoute = route.slice(route.indexOf('"/api/video-links/frame"'));
    const sent = new Set<string>();
    for (const name of frameRoute.matchAll(/send\(([A-Z_]+)\)/g)) {
      const body = route.match(new RegExp(`const ${name[1]}: \\w+ = \\{\\s*error: "([a-z_]+)"`));
      expect(body, name[1]).not.toBeNull();
      sent.add(body![1]);
    }
    expect(sent.size).toBeGreaterThanOrEqual(4);
    const union = shared.match(/export type VideoLinkFrameErrorCode =([^;]+);/)![1];
    for (const code of sent) expect(union, code).toContain(`"${code}"`);
  });

  it("l'app ne montre jamais le message du serveur : seul le code sert, puis l'instantané ou le secours", () => {
    const screen = readRoot("apps/mobile/src/app/(app)/spot/lecteur.tsx");
    const uses = [...screen.matchAll(/serverResult\.reason/g)];
    expect(uses).toHaveLength(1);
    expect(screen).toContain("frameFailureReason(serverResult.reason)");
    expect(screen).toContain("chooseSpotImage({ server, snapshot: shot, snapshotError })");
  });

  it("délais : l'app attend plus longtemps que le service vidéo (25 s) ; le serveur coupe à 30 s", () => {
    const appMs = Number(api.match(/VIDEO_LINK_FRAME_TIMEOUT_MS = ([\d_]+);/)![1].replace(/_/g, ""));
    const workerMs = Number(readRoot("apps/video-worker/src/contract.js").match(/requestDeadlineMs: ([\d_]+),/)![1].replace(/_/g, ""));
    const serverMs = Number(readRoot("apps/backend/src/lib/videoWorker.ts").match(/VIDEO_WORKER_TIMEOUT_MS = ([\d_]+);/)![1].replace(/_/g, ""));
    expect(workerMs).toBe(25_000);
    // Permis : la réponse du service vidéo, même à sa limite, arrive avant que l'app cesse d'attendre.
    expect(appMs).toBeGreaterThan(workerMs);
    // Le serveur n'attend jamais plus longtemps que l'app : sinon il travaillerait pour personne.
    expect(serverMs).toBeLessThanOrEqual(appMs);
  });
});
