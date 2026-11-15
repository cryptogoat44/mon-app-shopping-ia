import { afterEach, describe, expect, it } from "vitest";
import type { VideoLinkAnalysisErrorCode } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { ApiError } from "../src/lib/api-error";
import { MAX_DATA_URI_LENGTH, decodeBase64, inMemoryImagePart, jpegSize, parseImageDataUri, readJpegDataUri } from "../src/lib/data-uri";
import { LINK_AI_FAILURES, type LinkAiFailure } from "../src/lib/video-link-failures";
import {
  LINK_FETCH_STEP_MS,
  cleanQuery,
  linkAiFailure,
  linkAnalysisEnabled,
  linkAnalysisRequest,
  linkFailureView,
  linkWaitingStep,
  momentClock,
  parseLinkAnalysis,
  queryProblemMessage,
} from "../src/lib/video-link-analysis";
import { jpegBytes, jpegDataUri } from "./fake-jpeg";

// Lot « vidéo auto » : analyse d'une vidéo TikTok ou Instagram à partir de son
// lien, vue de l'app — logique pure (aucun appel réseau, aucun écran).

const TIKTOK = "https://www.tiktok.com/@lea.style/video/7312345678901234567";
const BOX = { x: 0.1, y: 0.2, width: 0.4, height: 0.5 };

function body(moments: unknown[], video: unknown = { platform: "tiktok", videoKey: "7312345678901234567", canonicalUrl: TIKTOK, creatorHandle: "lea.style" }) {
  return { video, moments };
}

afterEach(() => setActiveLocale("fr"));

describe("images en mémoire (« data: ») : lues sans fichier", () => {
  it("base64 standard, avec ou sans « = » ; un caractère étranger : refusé", () => {
    expect([...decodeBase64("AQID")!]).toEqual([1, 2, 3]);
    expect([...decodeBase64("AQI=")!]).toEqual([1, 2]);
    expect([...decodeBase64("AQ==")!]).toEqual([1]);
    expect([...decodeBase64("AQ")!]).toEqual([1]);
    expect(decodeBase64("AQ*D")).toBeNull();
    expect(decodeBase64("A")).toBeNull();
    const random = Uint8Array.from({ length: 1000 }, (_, index) => (index * 37 + 11) % 256);
    expect([...decodeBase64(Buffer.from(random).toString("base64"))!]).toEqual([...random]);
  });

  it("taille lue dans l'en-tête JPEG ; autre format ou en-tête tronqué : null", () => {
    expect(jpegSize(jpegBytes(720, 1280))).toEqual({ width: 720, height: 1280 });
    expect(jpegSize(jpegBytes(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(jpegBytes(720, 1280).slice(0, 24))).toBeNull();
    expect(jpegSize(jpegBytes(0, 1280))).toBeNull();
  });

  it("seules les images JPEG, PNG ou WebP en base64 sont lues ; trop longue : refusée", () => {
    expect(readJpegDataUri(jpegDataUri(720, 1280))?.size).toEqual({ width: 720, height: 1280 });
    expect(parseImageDataUri("data:image/png;base64,AQID")?.type).toBe("image/png");
    expect(parseImageDataUri("data:text/html;base64,AQID")).toBeNull();
    expect(parseImageDataUri("data:image/svg+xml;base64,AQID")).toBeNull();
    expect(parseImageDataUri("https://cdn.example.test/image.jpg")).toBeNull();
    expect(readJpegDataUri("data:image/png;base64,AQID")).toBeNull();
    expect(parseImageDataUri(`data:image/jpeg;base64,${"A".repeat(MAX_DATA_URI_LENGTH)}`)).toBeNull();
  });

  it("pièce jointe en mémoire : nom, type, taille et octets, sans aucun fichier", async () => {
    const part = inMemoryImagePart(jpegDataUri(720, 1280))!;
    expect(part.name).toBe("moment.jpg");
    expect(part.type).toBe("image/jpeg");
    expect([...(await part.bytes())]).toEqual([...jpegBytes(720, 1280)]);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(jpegBytes(720, 1280));
    expect(part.size).toBe(jpegBytes(720, 1280).length);
    expect(inMemoryImagePart("data:image/jpeg;base64,***")).toBeNull();
  });
});

describe("l'analyse d'un lien n'apparaît que si le serveur l'allume", () => {
  it("seule la valeur exacte `true` compte ; sinon l'écran reste celui d'avant", () => {
    expect(linkAnalysisEnabled({ enabled: true })).toBe(true);
    for (const value of [{ enabled: false }, { enabled: "true" }, { enabled: 1 }, {}, null, undefined, "true", [true]]) {
      expect(linkAnalysisEnabled(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("la demande : le lien et ce que vous cherchez", () => {
  it("mots nettoyés (espaces en trop), lien tel quel", () => {
    expect(linkAnalysisRequest(` ${TIKTOK} `, "  la veste   en cuir beige  ")).toEqual({ request: { url: TIKTOK, query: "la veste en cuir beige" } });
    expect(cleanQuery(" sac\n noir ")).toBe("sac noir");
  });

  it("trop court, trop long ou un lien dans les mots : refusé avant tout envoi, avec un message", () => {
    expect(linkAnalysisRequest(TIKTOK, " a ")).toEqual({ problem: "too_short" });
    expect(linkAnalysisRequest(TIKTOK, "x".repeat(61))).toEqual({ problem: "too_long" });
    expect(linkAnalysisRequest(TIKTOK, "x".repeat(60))).toHaveProperty("request");
    expect(linkAnalysisRequest(TIKTOK, `la veste ${TIKTOK}`)).toEqual({ problem: "link" });
    expect(queryProblemMessage("too_short")).toBe(fr.videoLinkAuto.query.too_short);
    setActiveLocale("en");
    expect(queryProblemMessage("link")).toBe(en.videoLinkAuto.query.link);
  });
});

describe("la réponse est relue : jamais de confiance aveugle dans le réseau", () => {
  const moment = (patch: Record<string, unknown> = {}) => ({ timeSeconds: 12.4, image: jpegDataUri(720, 1280), box: BOX, ...patch });

  it("vidéo reconnue et moments, le meilleur d'abord, avec la taille de chaque image", () => {
    const analysis = parseLinkAnalysis(body([moment(), moment({ timeSeconds: 3, image: jpegDataUri(1280, 720) })]))!;
    expect(analysis.video).toEqual({ platform: "tiktok", videoKey: "7312345678901234567", canonicalUrl: TIKTOK, creatorHandle: "lea.style" });
    expect(analysis.moments.map((item) => [item.timeSeconds, item.size])).toEqual([
      [12.4, { width: 720, height: 1280 }],
      [3, { width: 1280, height: 720 }],
    ]);
    expect(analysis.moments[0]!.box).toEqual(BOX);
  });

  it("aucun moment : la pièce n'a pas été repérée (pas une panne)", () => {
    expect(parseLinkAnalysis(body([]))?.moments).toEqual([]);
  });

  it("Instagram : l'adresse canonique relue ; pseudo donné par le serveur gardé s'il est simple", () => {
    const analysis = parseLinkAnalysis(body([moment()], { platform: "instagram", canonicalUrl: "https://www.instagram.com/reel/C9abcDEF123/", creatorHandle: "lea.style" }))!;
    expect(analysis.video).toMatchObject({ platform: "instagram", videoKey: "C9abcDEF123", creatorHandle: "lea.style" });
    const odd = parseLinkAnalysis(body([moment()], { canonicalUrl: "https://www.instagram.com/reel/C9abcDEF123/", creatorHandle: "<script>" }))!;
    expect(odd.video.creatorHandle).toBeNull();
  });

  it("refusée : image qui n'est pas un JPEG en « data: », cadre hors de l'image, instant impossible, trop de moments, vidéo d'un autre site", () => {
    expect(parseLinkAnalysis(body([moment({ image: "https://cdn.example.test/frame.jpg" })]))).toBeNull();
    expect(parseLinkAnalysis(body([moment({ image: "data:image/png;base64,AQID" })]))).toBeNull();
    expect(parseLinkAnalysis(body([moment({ box: { x: 0.8, y: 0, width: 0.5, height: 0.5 } })]))).toBeNull();
    expect(parseLinkAnalysis(body([moment({ box: { x: 0, y: 0, width: 0, height: 0.5 } })]))).toBeNull();
    expect(parseLinkAnalysis(body([moment({ timeSeconds: -1 })]))).toBeNull();
    expect(parseLinkAnalysis(body([moment({ timeSeconds: Number.NaN })]))).toBeNull();
    expect(parseLinkAnalysis(body([moment(), moment(), moment(), moment()]))).toBeNull();
    expect(parseLinkAnalysis(body([moment()], { canonicalUrl: "https://evil.example.test/@x/video/1" }))).toBeNull();
    expect(parseLinkAnalysis(body("pas une liste" as unknown as unknown[]))).toBeNull();
    expect(parseLinkAnalysis(null)).toBeNull();
  });
});

describe("chaque échec : un message clair, et la capture d'écran toujours proposée", () => {
  const contract: [VideoLinkAnalysisErrorCode, LinkAiFailure][] = [
    ["video_analysis_disabled", "disabled"],
    ["video_ai_consent_required", "consent"],
    ["invalid_query", "invalid_query"],
    ["invalid_link", "invalid_link"],
    ["video_unavailable", "unavailable"],
    ["video_private", "private"],
    ["video_too_long", "too_long"],
    ["video_no_moment", "no_moment"],
    ["video_busy", "busy"],
    ["video_timeout", "timeout"],
    ["video_ai_user_limit", "user_limit"],
    ["video_ai_global_limit", "global_limit"],
  ];

  it("chaque code d'erreur du contrat partagé a son échec", () => {
    for (const [code, failure] of contract) {
      expect(linkAiFailure(new ApiError(400, { error: code, message: "x" })), code).toEqual({ failure, capacity: null });
    }
  });

  it("plafond des recherches, limites par minute, délai, panne inconnue, hors ligne, délai de l'app", () => {
    const capacity = linkAiFailure(new ApiError(429, { error: "search_capacity_month", message: "x", resumesOn: "2026-12-03" } as never));
    expect(capacity).toEqual({ failure: "search_limit", capacity: { reason: "capacity_month", resumesOn: "2026-12-03" } });
    expect(linkAiFailure(new ApiError(429, { error: "rate_limited", message: "x" })).failure).toBe("rate_limited");
    expect(linkAiFailure(new ApiError(429, { error: "autre", message: "x" })).failure).toBe("rate_limited");
    expect(linkAiFailure(new ApiError(504, { error: "gateway", message: "x" })).failure).toBe("timeout");
    expect(linkAiFailure(new ApiError(500, { error: "unknown", message: "x" })).failure).toBe("unavailable");
    expect(linkAiFailure(new ApiError(503, { error: "video_ai_disabled", message: "x" })).failure).toBe("disabled");
    expect(linkAiFailure(new TypeError("Network request failed")).failure).toBe("network");
    expect(linkAiFailure(new Error("abort"), true).failure).toBe("timeout");
    expect(linkAiFailure(new Error("abort")).failure).toBe("unavailable");
  });

  it("« Réessayer » seulement quand un nouvel essai peut aboutir ; « Modifier la description » quand les mots comptent", () => {
    const view = (failure: LinkAiFailure) => linkFailureView({ failure, capacity: null }, "fr");
    for (const failure of ["unavailable", "timeout", "busy", "network"] as const) expect(view(failure).retry, failure).toBe(true);
    for (const failure of ["private", "too_long", "invalid_link", "disabled", "user_limit", "global_limit", "search_limit", "rate_limited", "no_moment"] as const) {
      expect(view(failure).retry, failure).toBe(false);
    }
    expect(view("no_moment")).toMatchObject({ editQuery: true, isError: false, title: fr.videoLinkAuto.notFoundTitle });
    expect(view("invalid_query")).toMatchObject({ editQuery: true, isError: true });
    expect(view("private")).toMatchObject({ editQuery: false, isError: true, title: fr.videoLinkAuto.failedTitle, message: fr.videoLinkAuto.failure.private });
  });

  it("chaque échec a son message en français et en anglais, qui renvoie à la capture quand l'analyse ne peut pas aboutir", () => {
    for (const failure of LINK_AI_FAILURES) {
      const french = linkFailureView({ failure, capacity: null }, "fr").message;
      setActiveLocale("en");
      const english = linkFailureView({ failure, capacity: null }, "en").message;
      setActiveLocale("fr");
      expect(french.length, failure).toBeGreaterThan(10);
      expect(english.length, failure).toBeGreaterThan(10);
      expect(english, failure).not.toBe(french);
    }
    for (const failure of ["disabled", "invalid_link", "unavailable", "private", "too_long", "timeout", "busy", "no_moment", "user_limit", "global_limit", "rate_limited"] as const) {
      expect(fr.videoLinkAuto.failure[failure], failure).toMatch(/capture à la place/);
      expect(en.videoLinkAuto.failure[failure], failure).toMatch(/screenshot instead/);
    }
  });

  it("plafond des recherches : le message du résultat (jour, mois avec la date de reprise, part de la personne)", () => {
    expect(linkFailureView({ failure: "search_limit", capacity: { reason: "capacity_day", resumesOn: null } }, "fr").message).toBe(`${fr.result.capacityDayTitle} ${fr.result.capacityDayTip}`);
    expect(linkFailureView({ failure: "search_limit", capacity: { reason: "capacity_user", resumesOn: null } }, "fr").message).toBe(`${fr.result.capacityUserTitle} ${fr.result.capacityUserTip}`);
    expect(linkFailureView({ failure: "search_limit", capacity: { reason: "capacity_month", resumesOn: "2026-12-03" } }, "fr").message).toContain("3 décembre");
  });
});

describe("l'attente dit honnêtement où l'on en est", () => {
  it("d'abord la récupération de la vidéo, puis l'IA ; durée habituelle 10 à 25 s", () => {
    expect(linkWaitingStep(0)).toBe(0);
    expect(linkWaitingStep(LINK_FETCH_STEP_MS - 1)).toBe(0);
    expect(linkWaitingStep(LINK_FETCH_STEP_MS)).toBe(1);
    expect(fr.videoLinkAuto.waiting.steps).toEqual(["On récupère la vidéo…", "L'IA cherche la pièce…"]);
    expect(fr.videoLinkAuto.waiting.usual).toContain("10 à 25 secondes");
    expect(en.videoLinkAuto.waiting.usual).toContain("10 to 25 seconds");
  });

  it("instant d'un moment lisible", () => {
    expect(momentClock(0)).toBe("0:00");
    expect(momentClock(12.9)).toBe("0:12");
    expect(momentClock(75)).toBe("1:15");
  });
});

describe("textes : français avec « vous », anglais à l'identique", () => {
  const texts = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (typeof node === "function") return texts(node("TikTok", true));
    if (Array.isArray(node)) return node.flatMap(texts);
    if (node && typeof node === "object") return Object.values(node).flatMap(texts);
    return [];
  };

  it("les libellés demandés, en français et en anglais", () => {
    expect(fr.videoLinkAuto.title).toBe("Que cherchez-vous dans cette vidéo ?");
    expect(fr.videoLinkAuto.find).toBe("Trouver la pièce");
    expect(en.videoLinkAuto.find).toBe("Find the piece");
    expect(fr.videoLinkAuto.placeholder).toContain("la veste en cuir beige de la fille à gauche");
    expect(fr.videoLinkAuto.capture).toBe("Faire une capture à la place");
    expect(fr.videoLinkAuto.moments.search).toBe("Rechercher cette pièce");
    expect(fr.videoLinkAuto.moments.title(3)).toBe("3 moments trouvés");
    expect(en.videoLinkAuto.moments.title(1)).toBe("Moment found");
  });

  it("vouvoiement, jamais de tutoiement ; mêmes clés en anglais", () => {
    const french = texts(fr.videoLinkAuto).join("\n");
    expect(french).not.toMatch(/\b(tu|ton|ta|tes|toi|te)\b/i);
    expect(french).toMatch(/\bvous\b|\bvotre\b/);
    const keys = (node: unknown, prefix = ""): string[] =>
      node && typeof node === "object" && !Array.isArray(node) ? Object.entries(node).flatMap(([key, value]) => keys(value, `${prefix}.${key}`)) : [prefix];
    expect(keys(en.videoLinkAuto)).toEqual(keys(fr.videoLinkAuto));
    expect(en.videoLinkAuto.waiting.steps).toHaveLength(fr.videoLinkAuto.waiting.steps.length);
    expect(en.videoLinkAuto.consentBody).toHaveLength(fr.videoLinkAuto.consentBody.length);
  });

  it("l'accord dit, pour un lien, que la vidéo est récupérée sans être gardée (et ne prétend pas qu'elle reste sur l'appareil)", () => {
    const french = fr.videoLinkAuto.consentBody.join(" ");
    expect(french).toContain("récupère la vidéo publique");
    expect(french).toContain("sans la conserver");
    expect(french).toContain("Anthropic");
    expect(french).not.toContain("ne quitte jamais votre appareil");
    expect(en.videoLinkAuto.consentBody.join(" ")).not.toContain("never leaves your device");
  });
});
