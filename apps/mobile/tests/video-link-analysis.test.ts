import { afterEach, describe, expect, it } from "vitest";
import type { VideoLinkAnalysisErrorCode } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { ApiError } from "../src/lib/api-error";
import { MAX_DATA_URI_LENGTH, decodeBase64, inMemoryImagePart, jpegSize, parseImageDataUri, readJpegDataUri } from "../src/lib/data-uri";
import { LINK_AI_FAILURES, type LinkAiFailure } from "../src/lib/video-link-failures";
import {
  LINK_ANALYSIS_OFF,
  LINK_FETCH_STEP_MS,
  cleanQuery,
  linkAiFailure,
  linkAnalysisEnabled,
  linkAnalysisRequest,
  linkAnalysisStatus,
  linkFailureView,
  linkModeOf,
  linkPiecesRequest,
  linkWaitingStep,
  linkWaitingSteps,
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

  it("iPhone hors ligne : l'erreur d'expo/fetch (« fetch failed: … ») est un problème de connexion, pas une vidéo indisponible", () => {
    const offline = linkAiFailure(new Error("fetch failed: The Internet connection appears to be offline."));
    expect(offline).toEqual({ failure: "network", capacity: null });
    expect(linkFailureView(offline, "fr")).toMatchObject({ primary: "retry", secondary: "capture", message: fr.videoLinkAuto.failure.network });
  });

  it("échec définitif (publication sans vidéo, direct, serveur plus ancien : 422 ; compte suspendu : 403) : jamais « Réessayer »", () => {
    const gone = linkAiFailure(new ApiError(422, { error: "video_unavailable", message: "x" }));
    expect(gone).toEqual({ failure: "invalid_link", capacity: null });
    expect(linkFailureView(gone, "fr")).toMatchObject({ primary: "capture", secondary: null, message: fr.videoLinkAuto.failure.invalid_link });
    const suspended = linkAiFailure(new ApiError(403, { error: "account_suspended", message: "x" }));
    expect(suspended.failure).toBe("disabled");
    expect(linkFailureView(suspended, "fr")).toMatchObject({ primary: "capture", secondary: null });
    // Une panne du service vidéo (502) ou de l'IA (503) sans cause : la capture d'abord, « Réessayer » en lien discret.
    for (const status of [502, 503]) {
      const outage = linkAiFailure(new ApiError(status, { error: "video_unavailable", message: "x" }));
      expect(outage.failure, String(status)).toBe("unavailable");
      expect(linkFailureView(outage, "fr"), String(status)).toMatchObject({ primary: "capture", secondary: "retry" });
    }
  });

  describe("plan B en un geste (lot « recherche confiance »), selon l'échec", () => {
    const cause = (status: number, error: string, value?: string) => linkAiFailure(new ApiError(status, { error, message: "x", ...(value ? { cause: value } : {}) } as never));

    it("vidéo privée ou supprimée : la même explication, calme, et un seul bouton, la capture d'écran", () => {
      for (const info of [cause(422, "video_private"), cause(422, "video_private", "private_or_removed"), cause(422, "video_unavailable", "private_or_removed")]) {
        expect(info).toEqual({ failure: "private", capacity: null });
        expect(linkFailureView(info, "fr", "Instagram")).toEqual({
          title: "Vidéo privée ou supprimée",
          message: fr.videoLinkAuto.failure.private,
          isError: false,
          primary: "capture",
          secondary: null,
        });
      }
    });

    it("refus de TikTok ou d'Instagram (connexion exigée, accès bloqué) : dit qui a refusé, sans détail technique, un seul bouton", () => {
      const info = cause(502, "video_unavailable", "refused");
      expect(info).toEqual({ failure: "refused", capacity: null });
      expect(linkFailureView(info, "fr", "Instagram")).toEqual({
        title: "Instagram a refusé l'accès",
        message: fr.videoLinkAuto.refused.message("Instagram"),
        isError: false,
        primary: "capture",
        secondary: null,
      });
      expect(fr.videoLinkAuto.refused.message("Instagram")).toMatch(/^Instagram n'a pas laissé .+ récupérer cette vidéo, comme cela arrive parfois : une capture d'écran fera aussi bien l'affaire\.$/);
      setActiveLocale("en");
      expect(linkFailureView(info, "en", "TikTok")).toMatchObject({ title: "TikTok refused access", primary: "capture" });
      setActiveLocale("fr");
      // Plateforme inconnue : les deux noms.
      expect(linkFailureView(info, "fr").title).toBe("TikTok ou Instagram a refusé l'accès");
    });

    it("une cause inconnue, ou sur un autre code, ne change rien (serveur plus récent, réponse inattendue)", () => {
      expect(cause(502, "video_unavailable", "autre_chose").failure).toBe("unavailable");
      expect(cause(422, "video_too_long", "refused").failure).toBe("too_long");
    });

    it("chaque échec : un seul bouton ; la capture d'écran toujours proposée, en bouton ou en lien (jamais d'impasse) ; « Réessayer » seulement s'il peut aboutir", () => {
      const view = (failure: LinkAiFailure) => linkFailureView({ failure, capacity: null }, "fr");
      for (const failure of LINK_AI_FAILURES) {
        const { primary, secondary } = view(failure);
        expect([primary, secondary], failure).toContain("capture");
        expect(primary, failure).not.toBe(secondary);
      }
      for (const failure of ["unavailable", "timeout", "busy"] as const) expect(view(failure), failure).toMatchObject({ primary: "capture", secondary: "retry" });
      for (const failure of ["private", "refused", "too_long", "invalid_link", "disabled", "user_limit", "global_limit", "search_limit", "rate_limited"] as const) {
        expect(view(failure), failure).toMatchObject({ primary: "capture", secondary: null });
      }
      expect(view("network")).toMatchObject({ primary: "retry", secondary: "capture", isError: true });
      expect(view("no_moment")).toMatchObject({ primary: "edit_query", secondary: "capture", isError: false, title: fr.videoLinkAuto.notFoundTitle });
      expect(view("invalid_query")).toMatchObject({ primary: "edit_query", secondary: "capture", isError: true });
    });
  });

  it("chaque échec a son message en français et en anglais : une seule phrase, qui renvoie à la capture quand l'analyse ne peut pas aboutir", () => {
    for (const failure of LINK_AI_FAILURES) {
      const french = linkFailureView({ failure, capacity: null }, "fr").message;
      setActiveLocale("en");
      const english = linkFailureView({ failure, capacity: null }, "en").message;
      setActiveLocale("fr");
      expect(french.length, failure).toBeGreaterThan(10);
      expect(english.length, failure).toBeGreaterThan(10);
      expect(english, failure).not.toBe(french);
      // Une phrase : un seul point final, aucun autre au milieu (les deux-points enchaînent).
      if (failure !== "search_limit") expect(french.replace(/\.$/, ""), failure).not.toMatch(/[.!?]\s/);
    }
    for (const failure of ["disabled", "invalid_link", "unavailable", "private", "too_long", "timeout", "busy", "no_moment", "user_limit", "global_limit", "rate_limited"] as const) {
      expect(fr.videoLinkAuto.failure[failure], failure).toMatch(/capture d'écran/);
      expect(en.videoLinkAuto.failure[failure], failure).toMatch(/screenshot/);
    }
    expect(fr.videoLinkAuto.planB).toMatchObject({ capture: "Faire une capture d'écran", kept: "Votre lien et votre description sont gardés." });
    expect(en.videoLinkAuto.planB).toMatchObject({ capture: "Take a screenshot", kept: "Your link and your description are kept." });
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
    expect(fr.videoLinkAuto.moments.search).toBe("Lancer la recherche");
    expect(en.videoLinkAuto.moments.search).toBe("Start the search");
    expect(fr.targeting.aiCaption).toBe("L'IA a entouré la pièce. Lancez la recherche, ou entourez-la vous-même pour corriger.");
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
    expect(en.videoAuto.consentBody).toHaveLength(fr.videoAuto.consentBody.length);
  });

  it("texte commun de l'accord : vidéo du téléphone (12 images, elle reste sur l'appareil) et lien (vidéo récupérée sans être gardée, 16 images)", () => {
    const french = fr.videoAuto.consentBody;
    const phone = french.find((paragraph) => paragraph.startsWith("Vidéo de votre téléphone"));
    const link = french.find((paragraph) => paragraph.startsWith("Lien TikTok ou Instagram"));
    expect(phone).toContain("12 images au plus");
    expect(phone).toContain("La vidéo entière ne quitte jamais votre appareil");
    expect(link).toContain("récupère la vidéo publique");
    expect(link).toContain("sans la conserver");
    expect(link).toContain("16 images au plus");
    expect(link).not.toContain("ne quitte jamais");
    expect(french.join(" ")).toContain("Anthropic");
    expect(french.join(" ")).toContain("sous 30 jours au plus");
    const english = en.videoAuto.consentBody;
    expect(english.find((paragraph) => paragraph.startsWith("Video from your phone"))).toContain("never leaves your device");
    expect(english.find((paragraph) => paragraph.startsWith("TikTok or Instagram link"))).toContain("16 frames at most");
    expect(english.find((paragraph) => paragraph.startsWith("TikTok or Instagram link"))).not.toContain("never leaves");
    // Plus de texte propre aux liens : une seule version enregistrée pour les deux écrans.
    expect("consentBody" in fr.videoLinkAuto).toBe(false);
    expect("consentBody" in en.videoLinkAuto).toBe(false);
  });
});

// Lot « propositions » (Parcours 2, 21 novembre 2026) : « Voir les propositions
// de l'IA » — l'état, la demande sans mots, la lecture des noms (jamais de
// confiance aveugle dans le réseau), l'échec « aucune pièce » et les textes.
describe("propositions de l'IA (mode « pièces »)", () => {
  const moment = (patch: Record<string, unknown> = {}) => ({ timeSeconds: 12.4, image: jpegDataUri(720, 1280), box: BOX, ...patch });
  const withLabels = (labels: unknown, count = 2) => ({ ...body(Array.from({ length: count }, (_, index) => moment({ timeSeconds: index }))), labels });

  it("état : `pieces` compte seulement s'il vaut exactement `true`, et seulement avec l'analyse allumée", () => {
    expect(linkAnalysisStatus({ enabled: true, pieces: true })).toEqual({ enabled: true, pieces: true, frame: false });
    expect(linkAnalysisStatus({ enabled: true })).toEqual({ enabled: true, pieces: false, frame: false });
    for (const value of ["true", 1, false, null, [true], {}]) expect(linkAnalysisStatus({ enabled: true, pieces: value }), JSON.stringify(value)).toEqual({ enabled: true, pieces: false, frame: false });
    expect(linkAnalysisStatus({ enabled: false, pieces: true })).toEqual({ enabled: false, pieces: false, frame: false });
    expect(linkAnalysisStatus({ enabled: "true", pieces: true })).toEqual({ enabled: false, pieces: false, frame: false });
    for (const value of [null, undefined, "true", [true]]) expect(linkAnalysisStatus(value)).toEqual(LINK_ANALYSIS_OFF);
    expect(LINK_ANALYSIS_OFF).toEqual({ enabled: false, pieces: false, frame: false });
  });

  it("retours du build 3 : `frame` (image du moment, lot 1) seulement pour la valeur exacte `true`, indépendant de l'analyse", () => {
    expect(linkAnalysisStatus({ enabled: false, frame: true })).toEqual({ enabled: false, pieces: false, frame: true });
    expect(linkAnalysisStatus({ enabled: true, frame: true }).frame).toBe(true);
    // Refusé : tout autre valeur, ou absent (serveur sans le lot 1).
    for (const value of ["true", 1, false, null, [true], {}]) expect(linkAnalysisStatus({ enabled: true, frame: value }).frame, JSON.stringify(value)).toBe(false);
    expect(linkAnalysisStatus({ enabled: true }).frame).toBe(false);
  });

  it("demande : le lien seul, aucun texte ; le mode se lit dans la demande", () => {
    expect(linkPiecesRequest(` ${TIKTOK} `)).toEqual({ url: TIKTOK, mode: "pieces" });
    expect(linkModeOf({ url: TIKTOK, mode: "pieces" })).toBe("pieces");
    expect(linkModeOf({ url: TIKTOK, query: "la veste" })).toBe("words");
  });

  it("lecture permise : un nom par moment, dans l'ordre, revérifié", () => {
    const analysis = parseLinkAnalysis(withLabels(["Le manteau camel", "L'écharpe à carreaux"]), "pieces")!;
    expect(analysis.labels).toEqual(["Le manteau camel", "L'écharpe à carreaux"]);
    expect(analysis.moments).toHaveLength(2);
    expect(parseLinkAnalysis(withLabels(["The white sneakers"], 1), "pieces")?.labels).toEqual(["The white sneakers"]);
  });

  it("lecture refusée (traitée comme illisible) : noms manquants, longueurs différentes, chiffre, mot de personne, doublon, 4 pièces, pas du texte, nom non relu", () => {
    for (const [name, value] of [
      ["sans noms", withLabels(undefined)],
      ["noms en texte", withLabels("Le manteau camel")],
      ["un nom pour deux moments", withLabels(["Le manteau camel"])],
      ["trois noms pour deux moments", withLabels(["Le manteau camel", "Le sac noir", "La casquette"])],
      ["un chiffre", withLabels(["Le jean 501", "Le sac noir"])],
      ["un mot de personne", withLabels(["Le sac de la fille", "Le sac noir"])],
      ["un doublon", withLabels(["Le sac noir", "le Sac noir"])],
      ["un nom qui n'est pas du texte", withLabels([42, "Le sac noir"])],
      ["un nom non normalisé", withLabels(["  Le sac noir", "Le manteau"])],
      ["aucune pièce", withLabels([], 0)],
    ] as const) {
      expect(parseLinkAnalysis(value, "pieces"), name).toBeNull();
    }
    const four = { ...body([moment(), moment(), moment(), moment()]), labels: ["Le sac noir", "Le manteau", "La casquette", "Le pull"] };
    expect(parseLinkAnalysis(four, "pieces")).toBeNull();
  });

  it("avec des mots, `labels` est ignoré (rien ne change)", () => {
    const words = parseLinkAnalysis(withLabels(["Le manteau camel", "Le sac noir"]))!;
    expect(words).not.toHaveProperty("labels");
    expect(parseLinkAnalysis(withLabels(["Le jean 501"]), "words")?.moments).toHaveLength(2);
    expect(parseLinkAnalysis(body([]), "words")?.moments).toEqual([]);
  });

  it("échec « aucune pièce » : « Aucune pièce proposée », sa phrase, le geste « décrire » en bouton et la capture en lien", () => {
    const none = { failure: "no_moment", capacity: null } as const;
    expect(linkFailureView(none, "fr", undefined, "pieces")).toEqual({
      title: "Aucune pièce proposée",
      message: "L'IA n'a vu aucune pièce nette dans cette vidéo : décrivez celle que vous cherchez, ou faites une capture d'écran.",
      isError: false,
      primary: "edit_query",
      secondary: "capture",
    });
    setActiveLocale("en");
    expect(linkFailureView(none, "en", undefined, "pieces")).toMatchObject({ title: "No piece suggested", message: en.videoLinkAuto.pieces.noneMessage, primary: "edit_query" });
    setActiveLocale("fr");
    // Avec des mots, l'échec d'avant ; en mode « pièces », les autres échecs gardent leur message.
    expect(linkFailureView(none, "fr")).toMatchObject({ title: fr.videoLinkAuto.notFoundTitle, message: fr.videoLinkAuto.failure.no_moment });
    for (const failure of LINK_AI_FAILURES.filter((item) => item !== "no_moment")) {
      expect(linkFailureView({ failure, capacity: null }, "fr", undefined, "pieces"), failure).toEqual(linkFailureView({ failure, capacity: null }, "fr"));
    }
    expect(fr.videoLinkAuto.pieces.describe).toBe("Décrire la pièce autrement");
    expect(en.videoLinkAuto.pieces.describe).toBe("Describe the piece instead");
  });

  it("attente : en mode « pièces », « L'IA regarde les pièces… » ; avec des mots, les étapes d'avant", () => {
    expect(linkWaitingSteps("pieces")).toEqual(["On récupère la vidéo…", "L'IA regarde les pièces…"]);
    expect(linkWaitingSteps("words")).toEqual(fr.videoLinkAuto.waiting.steps);
    expect(en.videoLinkAuto.pieces.waitingSteps).toEqual(["Fetching the video…", "The AI is looking at the pieces…"]);
  });

  it("les textes demandés, en français avec « vous » et en anglais ; jamais « repérée » (la mémoire collective)", () => {
    const pieces = fr.videoLinkAuto.pieces;
    expect([pieces.lead, pieces.show, pieces.or, pieces.group, pieces.noneTitle]).toEqual([
      "L'IA peut vous proposer les pièces qu'elle voit dans la vidéo.",
      "Voir les propositions de l'IA",
      "ou décrivez la pièce :",
      "Pièces proposées par l'IA",
      "Aucune pièce proposée",
    ]);
    expect([pieces.title(3), pieces.title(1), pieces.hint(2), pieces.hint(1)]).toEqual([
      "Quelle pièce cherchez-vous ?",
      "Une pièce proposée",
      "L'IA propose ces pièces. Touchez celle que vous cherchez.",
      "Vérifiez que le cadre entoure bien la pièce.",
    ]);
    const english = en.videoLinkAuto.pieces;
    expect([english.lead, english.show, english.or, english.group, english.noneTitle, english.title(2), english.title(1), english.hint(3), english.hint(1)]).toEqual([
      "The AI can suggest the pieces it sees in the video.",
      "See the AI's suggestions",
      "or describe the piece:",
      "Pieces suggested by the AI",
      "No piece suggested",
      "Which piece are you looking for?",
      "One piece suggested",
      "The AI suggests these pieces. Tap the one you're looking for.",
      "Check that the frame surrounds the piece.",
    ]);
    const french = JSON.stringify([pieces.lead, pieces.show, pieces.or, pieces.title(2), pieces.title(1), pieces.hint(2), pieces.hint(1), pieces.group, pieces.describe, pieces.noneTitle, pieces.noneMessage, pieces.waitingSteps, pieces.keptLink]);
    expect(french).not.toMatch(/repér/i);
    expect(french).not.toMatch(/\b(tu|ton|ta|tes|toi|te)\b/i);
  });
});
