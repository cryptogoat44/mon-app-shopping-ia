import { describe, expect, it } from "vitest";
import { chooseSpotImage, frameFailureReason, frameSeconds, parseVideoLinkFrame, shouldAskServer, snapshotErrorCode } from "../src/lib/spot-moment";

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
