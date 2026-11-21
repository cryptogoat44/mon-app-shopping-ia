import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertFormDataAsync } from "expo/src/winter/fetch/convertFormData";

// Lot « vidéo auto » : l'écran « vidéo partagée » avec l'analyse d'un lien —
// appels au serveur (simulés : `fetch` est remplacé, jamais un vrai appel),
// pièce jointe gardée en mémoire (iPhone et site), et garanties de l'écran :
// l'analyse n'apparaît que si le serveur l'allume, le lecteur officiel et la
// capture d'écran restent là, rien n'est écrit sur l'appareil, aucune
// statistique ne porte le lien.
const { ExpoFile } = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
  class ExpoFile {
    constructor(public uri: string) {}
  }
  return { ExpoFile };
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("expo-file-system", () => ({ File: ExpoFile }));

import { ApiError, analyzeVideoLink, fetchVideoLinkAnalysisStatus } from "../src/lib/api";
import { imageFileFromUri as nativeImageFile } from "../src/lib/image-file";
import { imageFileFromUri as webImageFile } from "../src/lib/image-file.web";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { LINK_AI_FAILURES } from "../src/lib/video-link-failures";
import { jpegBytes, jpegDataUri } from "./fake-jpeg";

const MOBILE = join(__dirname, "..");
const read = (path: string) => readFileSync(join(MOBILE, path), "utf8");
/** Code sans ses commentaires. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TIKTOK = "https://www.tiktok.com/@lea.style/video/7312345678901234567";
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("appels au serveur (contrat partagé)", () => {
  it("état : GET /api/video-links/analyze/status avec la session ; seule la valeur exacte `true` allume", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enabled: true }));
    expect(await fetchVideoLinkAnalysisStatus()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.exemple.test/api/video-links/analyze/status");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jeton-factice");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enabled: "yes" }));
    expect(await fetchVideoLinkAnalysisStatus()).toBe(false);
    // Serveur plus ancien (route absente) : une erreur, que l'écran traduit par « coupée ».
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not_found", message: "Not Found" }));
    await expect(fetchVideoLinkAnalysisStatus()).rejects.toBeInstanceOf(ApiError);
  });

  it("analyse : POST /api/video-links/analyze avec { url, query } en JSON ; la réponse est relue", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { video: { platform: "tiktok", videoKey: "7312345678901234567", canonicalUrl: TIKTOK, creatorHandle: "lea.style" }, moments: [{ timeSeconds: 3, image: jpegDataUri(720, 1280), box: { x: 0, y: 0, width: 1, height: 1 } }] })
    );
    const signal = new AbortController().signal;
    const analysis = await analyzeVideoLink({ url: TIKTOK, query: "veste en cuir" }, signal);
    expect(analysis.moments[0]?.size).toEqual({ width: 720, height: 1280 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.exemple.test/api/video-links/analyze?v=2");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ url: TIKTOK, query: "veste en cuir" });
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init?.signal).toBe(signal);
  });

  it("erreur { error, message } : ApiError avec son code ; réponse illisible : panne « video_unavailable »", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(413, { error: "video_too_long", message: "Trop longue." }));
    await expect(analyzeVideoLink({ url: TIKTOK, query: "veste" })).rejects.toMatchObject({ status: 413, body: { error: "video_too_long" } });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { video: null, moments: [] }));
    await expect(analyzeVideoLink({ url: TIKTOK, query: "veste" })).rejects.toMatchObject({ status: 502, body: { error: "video_unavailable" } });
  });
});

describe("l'image du moment part de la mémoire, sans fichier", () => {
  it("site : un vrai Blob du bon type, sans requête (aucune adresse « blob: » à oublier)", async () => {
    const blob = await webImageFile(jpegDataUri(720, 1280));
    expect(blob.type).toBe("image/jpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(jpegBytes(720, 1280));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("iPhone : jamais de fichier pour une image « data: » ; l'encodeur multipart du fetch d'Expo l'accepte telle quelle", async () => {
    const part = await nativeImageFile(jpegDataUri(720, 1280));
    expect(part).not.toBeInstanceOf(ExpoFile);
    const formData = { entries: () => [["file", part]] } as unknown as FormData;
    const { body } = await convertFormDataAsync(formData, "LIMITE");
    const text = Buffer.from(body).toString("latin1");
    expect(text).toContain('content-disposition: form-data; name="file"; filename="moment.jpg"');
    expect(text).toContain("content-type: image/jpeg");
    expect(Buffer.from(body).includes(Buffer.from(jpegBytes(720, 1280)))).toBe(true);
    // Une photo ordinaire reste lue depuis son fichier, comme avant.
    expect(await nativeImageFile("file:///cache/photo.jpg")).toBeInstanceOf(ExpoFile);
    await expect(nativeImageFile("data:image/jpeg;base64,***")).rejects.toThrow();
  });
});

describe("écran « vidéo partagée » : l'analyse d'abord, quand le serveur l'allume", () => {
  const screen = code("src/app/(app)/spot/lecteur.tsx");

  it("état et vidéo demandés ensemble ; état illisible ou en erreur : coupé, l'écran d'avant", () => {
    expect(screen).toContain("fetchVideoLinkAnalysisStatus().catch(() => false)");
    expect(screen).toContain("setAnalysisEnabled(enabled);");
    expect(screen.match(/if \(enabled\) return setStage\(\{ kind: "auto" \}\);/g)).toHaveLength(2);
    // Sans l'analyse, la décision d'avant (lecteur, écran de secours, site).
    expect(screen).toContain("void decide(response);");
    expect(screen).toContain("const [analysisEnabled, setAnalysisEnabled] = useState(false);");
  });

  it("le lecteur officiel (iPhone) reste proposé, et la consigne du site reste le bloc de repli", () => {
    // Seulement s'il peut s'ouvrir (vidéo reconnue, serveur, build, instantané) : jamais un bouton vers l'écran de secours.
    expect(screen).toContain("const withPlayer = platform !== null && link !== null && playerOffered({ platform, os: Platform.OS, build: features, server: lookup?.players ?? null, snapshotReady: snapshotAvailable });");
    expect(screen).toContain("{t.videoLinkAuto.player(name)}");
    expect(screen).toContain("<EmbeddedPlayer");
    expect(screen).toContain("onPress={() => void spotMoment()}");
    expect(screen).toContain("{t.videoLink.webInstruction}");
  });

  it("plan B en un geste (lot « recherche confiance ») : chaque échec mène à la capture d'écran par un seul bouton, lien et description gardés (app et site)", () => {
    const failed = screen.slice(screen.indexOf('phase.kind === "failed"'), screen.indexOf("} else {", screen.indexOf('phase.kind === "failed"')));
    expect(failed).toContain("<LinkFailureView");
    expect(failed).toContain("onCapture={showCapture}");
    expect(failed).toContain("platformName={name || undefined}");
    // Plus d'empilement de boutons sous l'échec : la capture s'ouvre par le bouton.
    expect(failed).not.toContain("{captureBlock}");
    // Le bouton : la capture d'écran (iPhone : les trois gestes ; site : glisser-déposer ou coller), le lien remis en attente 10 minutes.
    const capture = screen.slice(screen.indexOf("function showCapture()"), screen.indexOf("function backToAuto()"));
    expect(capture).toContain("void pendingVideoLinks.hold({ url: link?.canonicalUrl ?? url, platform, creatorHandle: handle });");
    expect(capture).toContain('setStage({ kind: Platform.OS === "web" ? "web" : "capture" });');
    expect(screen).toContain("webBox(t.videoLinkAuto.capture)");
    expect(screen).toContain("<VideoFallback title={t.videoLinkAuto.capture}");
    // La description écrite pour l'analyse est reprise sous la capture choisie ou déposée, et l'écran le dit.
    const picked = screen.slice(screen.indexOf("async function openPicked("), screen.indexOf("async function addScreenshot("));
    expect(picked.indexOf("keepDescriptionInDraft(queryRef.current);")).toBeGreaterThan(picked.indexOf("await beginPhotoSearch("));
    expect(screen).toContain("queryRef.current = auto.query;");
    // Même chose pour l'instantané du lecteur officiel (iPhone), proposé à côté de la capture.
    const spot = screen.slice(screen.indexOf("async function spotMoment()"), screen.indexOf("async function acceptConsent()"));
    expect(spot.indexOf("keepDescriptionInDraft(queryRef.current);")).toBeGreaterThan(spot.indexOf("beginFromPhoto("));
    expect(screen.match(/\{keptNote\}/g)).toHaveLength(2);
    // Retour à l'analyse après un échec : la question, pas le même échec.
    expect(screen).toContain('if (auto.phase.kind === "failed") auto.editQuery();');
    const view = code("src/components/video-link-analysis.tsx");
    expect(view).toContain("<ActionButtons primary={actionOf(view.primary)} />");
    expect(view).not.toMatch(/<ActionButtons primary=\{actionOf\(view\.primary\)\} secondary=/);
  });

  it("accord manquant ou donné sur l'ancien texte : l'accord « analyse_video_ia », avec le texte commun (une seule version enregistrée)", () => {
    expect(screen).toContain("<ConsentView");
    const consentView = screen.slice(screen.indexOf("<ConsentView"), screen.indexOf("/>", screen.indexOf("<ConsentView")));
    expect(consentView).not.toContain("body=");
    expect(code("src/components/spot-launch-views.tsx")).toContain("t.videoAuto.consentBody.map");
    const hook = code("src/lib/use-video-link-analysis.ts");
    expect(hook).toContain("recordVideoAiChoice(true)");
    expect(hook).toContain("fetchConsentStatus().then(videoLinkAiChoice)");
  });

  it("un seul écran : on entoure la pièce sur l'image du moment choisi (cadre de l'IA déjà tracé), puis la recherche part aussitôt", () => {
    const hook = code("src/lib/use-video-link-analysis.ts");
    // Chaque moment arrive avec le cadre de l'IA tracé ; changer de moment repart de son cadre.
    expect(hook).toContain('return moment ? { kind: "moments", analysis, selected: rank, zone: zoneFromCrop(moment.box), zoneFromAi: true } : null;');
    expect(hook).toContain('current.kind === "moments" && rank !== current.selected ? (momentsPhase(current.analysis, rank) ?? current) : current');
    // Entourée par la personne : sa zone remplace le cadre de l'IA.
    expect(hook).toContain('setPhase((current) => (current.kind === "moments" ? { ...current, zone, zoneFromAi: false } : current));');
    // « Lancer la recherche » : la zone de l'écran, puis l'attente et les résultats sans autre écran.
    // La description part avec le brouillon (lien vidéo sans prix, 17 novembre 2026), jamais dans l'adresse.
    expect(hook).toContain("startMomentSearch(phase.analysis, phase.selected, origin, { crop: phase.zone.crop, byAi: phase.zoneFromAi }, query)");
    expect(hook).toContain('router.push({ pathname: "/spot/lancer", params: { source: "photo", auto: "1" } })');
    const view = code("src/components/video-link-analysis.tsx");
    expect(view).toContain("<PhotoFrame");
    expect(view).toContain("onChange={onZone}");
    expect(view).toContain("caption={zoneFromAi ? t.targeting.aiCaption : t.targeting.caption}");
    // Pendant le tracé, l'écran ne défile pas.
    const screenCode = code("src/app/(app)/spot/lecteur.tsx");
    expect(screenCode).toContain("onDragChange={setDragging}");
    expect(screenCode).toContain("scrollEnabled={!dragging}");
    // Retour sur « Entourez la pièce » (recherche annulée) : la zone déjà choisie est retracée.
    const launch = code("src/app/(app)/spot/lancer.tsx");
    expect(launch).toContain("useState<PieceZone | null>(() => initialZone(media))");
    expect(launch).toContain("return isWholeImage(crop) ? { ...WHOLE_IMAGE_ZONE } : zoneFromCrop(crop);");
  });

  it("lancement automatique d'un lien : les mots partent de la description gardée dans le brouillon, pas de l'adresse (le lancement ne les efface pas)", () => {
    const launch = code("src/app/(app)/spot/lancer.tsx");
    expect(launch).toContain("const [query, setQuery] = useState(() => initialQuery(params.query, media));");
    expect(launch).toContain('if (typeof param === "string") return param;');
    expect(launch).toContain('return media.source === "photo" ? (media.draft?.words ?? "") : "";');
    // Les mots du champ sont ceux du lancement automatique (useSpotLaunch → launchPhoto).
    expect(launch).toContain("const flow = useSpotLaunch({ ...media, preview: preview.source, query,");
    expect(code("src/lib/use-spot-launch.ts")).toContain("await launchPhoto(draft, signal, zone, query)");
    // Jamais de mots dans l'adresse de l'écran ouvert par « Lancer la recherche ».
    const hook = code("src/lib/use-video-link-analysis.ts");
    const push = hook.slice(hook.indexOf('router.push({ pathname: "/spot/lancer"'), hook.indexOf("});", hook.indexOf('router.push({ pathname: "/spot/lancer"')));
    expect(push).not.toContain("query");
  });

  it("lancement automatique une seule fois : « auto » retiré de l'adresse juste après (site : « Précédent » puis « Suivant » ne relance rien)", () => {
    const launch = code("src/app/(app)/spot/lancer.tsx");
    const flowAt = launch.indexOf("const flow = useSpotLaunch(");
    const clearAt = launch.indexOf("if (params.auto !== undefined) router.setParams({ auto: undefined });");
    // Après useSpotLaunch : son effet de lancement passe d'abord (effets dans l'ordre de déclaration).
    expect(flowAt).toBeGreaterThan(0);
    expect(clearAt).toBeGreaterThan(flowAt);
    expect(launch.slice(clearAt, launch.indexOf("}, []);", clearAt))).not.toContain("params.auto ===");
    // Le lancement lui-même ne lit « auto » qu'à l'ouverture.
    expect(code("src/lib/use-spot-launch.ts")).toContain("if (auto) void launch();");
  });
});

describe("rien n'est écrit sur l'appareil ni dans le navigateur", () => {
  const files = ["src/lib/data-uri.ts", "src/lib/video-link-analysis.ts", "src/lib/video-link-run.ts", "src/lib/use-video-link-analysis.ts", "src/lib/video-link-failures.ts", "src/components/video-link-analysis.tsx"];

  it("aucun stockage dans les fichiers de l'analyse d'un lien", () => {
    const forbidden = /AsyncStorage|expo-file-system|localStorage|sessionStorage|indexedDB|createObjectURL|writeAsString|\.write\(|Paths\.|downloadAsync|XMLHttpRequest|\bfetch\(/;
    expect(files.filter((path) => forbidden.test(code(path)))).toEqual([]);
  });

  it("images des moments affichées sans cache ; image du brouillon gardée en mémoire seulement (attente, tracé)", () => {
    expect(code("src/components/video-link-analysis.tsx")).toContain('cachePolicy="none"');
    expect(code("src/components/video-link-analysis.tsx")).not.toMatch(/cachePolicy="(disk|memory-disk)"/);
    expect(code("src/components/spot-waiting.tsx").match(/cachePolicy="memory"/g)).toHaveLength(2);
    expect(code("src/components/piece-tracer.tsx")).toContain('cachePolicy="memory"');
  });

  it("le moment ne passe jamais par l'adresse d'un écran (seulement le brouillon en mémoire)", () => {
    const hook = code("src/lib/use-video-link-analysis.ts");
    expect(hook).not.toMatch(/params: \{[^}]*image/);
  });
});

describe("statistiques : jamais le lien, les mots ni les images", () => {
  it("seuls des choix et des nombres ; tout le reste est retiré", () => {
    for (const event of ["video_link_ai_started", "video_link_ai_result", "video_link_ai_moment_chosen"] as const) {
      for (const rule of Object.values(ANALYTICS_EVENTS[event]) as { kind: string }[]) expect(["enum", "count"]).toContain(rule.kind);
    }
    expect(sanitizeProps("video_link_ai_result", { platform: "tiktok", outcome: "failed", reason: "private", moments_count: 0, url: TIKTOK, query: "veste" })).toEqual({
      platform: "tiktok",
      outcome: "failed",
      reason: "private",
      moments_count: 0,
    });
    expect(sanitizeProps("video_link_ai_result", { platform: "tiktok", outcome: "found", reason: TIKTOK })).toEqual({ platform: "tiktok", outcome: "found" });
    expect(sanitizeProps("video_link_ai_moment_chosen", { platform: "instagram", rank: 2, moments_count: 3, image: "data:image/jpeg;base64,AAAA" })).toEqual({
      platform: "instagram",
      rank: 2,
      moments_count: 3,
    });
    expect(sanitizeProps("video_link_ai_started", { platform: "youtube" })).toEqual({});
    expect(LINK_AI_FAILURES).toContain("search_limit");
  });
});
