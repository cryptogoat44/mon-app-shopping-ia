import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Retours du build 3 (lot « lecteur vidéo ») : le bouton Lecture vaut accord
// (rien n'est chargé avant), notre barre de lecture ivoire SOUS la vidéo, la
// zone d'actions mesurée, et l'image du moment demandée au serveur. Tests qui
// lisent le source (style du projet) et appels au serveur simulés (`fetch`
// remplacé : jamais un vrai appel).
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

import { fetchVideoLinkFrame } from "../src/lib/api";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";

const MOBILE = join(__dirname, "..");
const read = (path: string) => readFileSync(join(MOBILE, path), "utf8");
/** Code sans ses commentaires. */
const code = (path: string) =>
  read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const SCREEN = "src/app/(app)/spot/lecteur.tsx";
const CONTROLS = "src/components/player-controls.tsx";

/** Le rendu de l'étape « firstPlay », de son `else if` au suivant. */
function firstPlayBranch(): string {
  const screen = code(SCREEN);
  const start = screen.indexOf('} else if (stage.kind === "firstPlay") {');
  const end = screen.indexOf("} else {", start);
  expect(start).toBeGreaterThan(0);
  return screen.slice(start, end);
}

/** Le rendu de l'étape « player » (le dernier `else`). */
function playerBranch(): string {
  const screen = code(SCREEN);
  const start = screen.indexOf("} else {", screen.indexOf('} else if (stage.kind === "firstPlay") {'));
  return screen.slice(start, screen.indexOf("return (", start));
}

describe("le bouton Lecture vaut accord (plus d'écran d'accord)", () => {
  it("la constante est à true ; l'ancien écran reste joignable en la changeant (les deux chemins présents)", () => {
    expect(code("src/lib/spot-flags.ts")).toContain("export const PLAYER_CONSENT_BY_PLAY_BUTTON = true;");
    expect(code("src/lib/spot-flags.ts")).toContain("export const PLAYER_CONSENT_GATE = true;");
    const screen = code(SCREEN);
    expect(screen).toContain('if (decision.kind === "consent") return setStage(PLAYER_CONSENT_BY_PLAY_BUTTON ? { kind: "firstPlay" } : { kind: "consent" });');
    // L'écran d'accord d'avant n'est pas supprimé.
    expect(screen).toContain('} else if (stage.kind === "consent") {');
    expect(screen).toContain("t.player.gate.body(name)");
  });

  it("refusé : avant le premier appui, rien n'est chargé chez TikTok ni chez Instagram (ni lecteur, ni code d'intégration, ni image)", () => {
    const branch = firstPlayBranch();
    for (const forbidden of ["startPlayer", "fetchInstagramEmbed", "tiktokHostPage", "instagramHostPage", "EmbeddedPlayer", "<Image", "SpotImage", "uri:"]) {
      expect(branch, forbidden).not.toContain(forbidden);
    }
  });

  it("permis : le premier appui enregistre l'accord, PUIS charge le lecteur (decide avec l'accord)", () => {
    const screen = code(SCREEN);
    const fn = screen.slice(screen.indexOf("async function firstPlay()"), screen.indexOf("async function acceptConsent()"));
    expect(fn).toContain('track("player_consent", { platform, choice: "play", link_platform: platform });');
    expect(fn.indexOf("await grantPlayerConsent(platform);")).toBeGreaterThan(0);
    expect(fn.indexOf("void decide(lookup, true)")).toBeGreaterThan(fn.indexOf("await grantPlayerConsent(platform);"));
    // Le disque central ET le bouton de la barre au repos mènent au même premier appui.
    expect(firstPlayBranch().match(/void firstPlay\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("la première fois : bouton de lecture avec libellé et indice, phrase-lien vers Réglages (« Réglages » souligné), « Spotter » grisé, « Trouver la pièce » utilisable", () => {
    const branch = firstPlayBranch();
    expect(branch).toContain("accessibilityLabel={t.player.firstPlay.play(name)}");
    expect(branch).toContain("accessibilityHint={t.player.firstPlay.hint}");
    expect(branch).toContain('onPress={() => router.push("/settings")}');
    expect(branch).toContain('accessibilityRole="link"');
    expect(branch).toContain("<Text style={styles.consentLink}>{t.player.firstPlay.lineLink}</Text>");
    expect(code(SCREEN)).toMatch(/consentLink: \{ \.\.\.lienSouligne,/);
    expect(branch).toMatch(/style=\{\[styles\.primary, styles\.primaryDisabled\]\} disabled accessibilityRole="button" accessibilityState=\{\{ disabled: true \}\}/);
    expect(branch).toContain("onPress={playerToAuto}");
    // Analyse coupée : il reste un chemin sans lecteur (la capture d'écran).
    expect(branch).toContain("captureLink");
  });

  it("Réglages : après retrait, le texte dit que la prochaine vidéo ne sera chargée qu'au toucher de Lecture", () => {
    expect(code("src/components/player-consent-setting.tsx")).toContain("PLAYER_CONSENT_BY_PLAY_BUTTON ? t.player.settings.withdrawnPlay : t.player.settings.withdrawn");
  });
});

describe("le lecteur : actions visibles, barre de lecture sous la vidéo", () => {
  it("« Spotter ce moment » désactivé tant que la vidéo n'est pas lancée ; « Trouver la pièce automatiquement » sans lien avec `ready`", () => {
    const branch = playerBranch();
    expect(branch).toContain("const spotDisabled = !ready || busy !== null;");
    expect(branch).toContain("disabled={spotDisabled}");
    const find = branch.slice(branch.indexOf("onPress={playerToAuto}") - 120, branch.indexOf("onPress={playerToAuto}") + 40);
    expect(find).not.toMatch(/disabled|ready/);
  });

  it("la zone d'actions est mesurée (onLayout) et sa hauteur donne la taille de la vidéo", () => {
    const screen = code(SCREEN);
    expect(screen.match(/<View style=\{styles\.actions\} onLayout=\{\(event\) => setActionsHeight\(Math\.ceil\(event\.nativeEvent\.layout\.height\)\)\}>/g)).toHaveLength(2);
    expect(screen).toContain("actionsHeight ?? estimatedActionsHeight({ analysis: analysisEnabled, firstPlay: stage.kind === \"firstPlay\", controls: ourControls })");
    expect(screen).toMatch(/playerLayout\(\s*screen\.width,\s*screen\.height - insets\.top - insets\.bottom,\s*actionsHeight/);
  });

  it("refusé : rien de posé sur le lecteur (ni dégradé, ni vue par-dessus) ; notre barre vient APRÈS lui, hors de son cadre", () => {
    const branch = playerBranch();
    expect(branch).not.toContain("LinearGradient");
    expect(code(CONTROLS)).not.toContain("LinearGradient");
    expect(branch).toMatch(/onCrash=\{onCrash\}\s*\/>/);
    expect(branch.indexOf("<PlayerControls")).toBeGreaterThan(branch.indexOf("<EmbeddedPlayer"));
    expect(branch).not.toMatch(/position: "absolute"/);
    expect(code("src/components/embedded-player.tsx")).not.toContain("PlayerControls");
  });

  it("notre barre seulement pour TikTok, tant qu'elle n'est pas remplacée par le repli", () => {
    expect(playerBranch()).toContain('{isTikTokPlayer && controlsMode === "ours" ? (');
  });

  it("repli honnête : sans temps 5 s après la première lecture, le lecteur est rechargé UNE fois avec les commandes de TikTok", () => {
    const screen = code(SCREEN);
    expect(screen).toContain("const CONTROLS_FALLBACK_MS = 5_000;");
    expect(screen).toContain('if (!alive.current || gotDuration.current || !sawPlaying.current || controlsModeRef.current !== "ours") return;');
    expect(screen).toContain('controlsModeRef.current = "tiktok";');
    expect(screen).toContain('controlsModeRef.current === "tiktok" ? TIKTOK_PLAYER_PARAMS_NATIVE : undefined');
  });

  it("phrase de confidentialité : celle d'avant, sauf quand le serveur donne l'image du moment (TikTok)", () => {
    expect(playerBranch()).toContain('{frameEnabled && platform === "tiktok" ? t.player.privacyFrame(name) : t.player.privacy(name)}');
  });

  it("vidéo et fond de la première fois arrondis à 14, courbe continue", () => {
    expect(code("src/components/embedded-player.tsx")).toContain('frame: { backgroundColor: color.nuit, overflow: "hidden", borderRadius: VIDEO_RADIUS, borderCurve: "continuous" },');
    expect(read("src/components/embedded-player.tsx")).toContain("const VIDEO_RADIUS = 14;");
    expect(code(SCREEN)).toContain('poster: { backgroundColor: color.nuit, borderRadius: VIDEO_RADIUS, borderCurve: "continuous"');
  });
});

describe("components/player-controls.tsx", () => {
  const controls = code(CONTROLS);

  it("PanResponder et Animated de React Native ; jamais gesture-handler ni Reanimated", () => {
    expect(controls).toContain("PanResponder.create(");
    expect(controls).not.toMatch(/react-native-gesture-handler|react-native-reanimated/);
  });

  it("le trait est réglable pour VoiceOver (± 2 s), avec sa position en toutes lettres", () => {
    expect(controls).toContain('accessibilityRole="adjustable"');
    expect(controls).toContain("accessibilityLabel={t.player.controls.position}");
    expect(controls).toContain('accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}');
    expect(controls).toContain("const ACCESSIBILITY_STEP_S = 2;");
    expect(controls).toContain("t.player.controls.positionValue(");
  });

  it("aucune couleur en dur : jetons seulement (piste filet, partie lue et rond encre, temps et son acier)", () => {
    expect(controls).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(controls).toContain("backgroundColor: color.filet");
    expect(controls).toContain("backgroundColor: color.encre");
    expect(controls).toContain('fontVariant: ["tabular-nums"]');
  });

  it("éteinte tant qu'aucune durée n'est arrivée : le trait ne prend pas le doigt, ni rond ni temps", () => {
    expect(controls).toContain("const enabled = fraction !== null && !p.idle;");
    expect(controls).toContain("onStartShouldSetPanResponder: () => live.current.enabled,");
    expect(controls).toContain("{enabled ? <Animated.View");
  });

  it("un seekTo au plus toutes les 250 ms pendant le glissé, un dernier au lâcher ; les temps plus anciens ignorés 400 ms", () => {
    expect(controls).toContain("const SEEK_THROTTLE_MS = 250;");
    expect(controls).toContain("const SEEK_SETTLE_MS = 400;");
    expect(controls).toContain("seekTo(target, false);");
    expect(controls).toContain("seekTo(target, true);");
  });

  it("le son : un bouton toujours là, trois états, libellés « Son », « Couper le son », « Activer le son »", () => {
    expect(controls).toContain('p.sound === "on" ? t.player.controls.mute : p.sound === "muted" ? t.player.controls.unmute : t.player.controls.sound');
    const screen = code(SCREEN);
    expect(screen).toContain('const next: PlayerSound = sound === "on" ? "muted" : "on";');
    expect(screen).toContain('sendCommand(playerCommand(next === "muted" ? "mute" : "unMute"));');
  });
});

describe("« Spotter ce moment » : l'image du serveur, puis l'instantané contrôlé", () => {
  const screen = code(SCREEN);

  it("l'image du serveur et l'instantané demandés en même temps, seulement si shouldAskServer", () => {
    expect(screen).toContain("shouldAskServer({ platform, frame: frameEnabled, lastTime: time })");
    expect(screen).toContain("await Promise.allSettled([");
    expect(screen).toContain("fetchVideoLinkFrame({ url: video.canonicalUrl, atSeconds: frameSeconds(time) }, controller.signal)");
  });

  it("l'instantané qui n'a pas servi est toujours effacé ; écran quitté : la demande est abandonnée", () => {
    expect(screen).toContain("if (shot) discardLocalFile(shot.uri);");
    expect(screen).toContain("spotAbort.current?.abort();");
  });

  it("après « pause » : l'état « en pause » du lecteur ou 400 ms au plus", () => {
    expect(screen).toContain("const PAUSE_WAIT_MS = 400;");
    expect(screen).toContain('if (hostMessage.state === "paused") pauseWaiter.current?.();');
  });
});

describe("statistiques (ajouts seulement)", () => {
  it("player_spot.image_source : server ou snapshot ; autre valeur jetée", () => {
    expect(sanitizeProps("player_spot", { platform: "tiktok", link_platform: "tiktok", image_source: "server" })).toMatchObject({ image_source: "server" });
    expect(sanitizeProps("player_spot", { image_source: "data:image/jpeg;base64,xx" })).toEqual({});
  });

  it("player_unavailable.reason gagne snapshot_blurry ; les anciennes valeurs restent", () => {
    expect(sanitizeProps("player_unavailable", { reason: "snapshot_blurry" })).toEqual({ reason: "snapshot_blurry" });
    expect(sanitizeProps("player_unavailable", { reason: "snapshot_failed" })).toEqual({ reason: "snapshot_failed" });
  });

  it("player_frame_failed : la raison et link_platform seulement ; jamais l'adresse, le temps ni « platform »", () => {
    expect(Object.keys(ANALYTICS_EVENTS.player_frame_failed).sort()).toEqual(["link_platform", "reason"]);
    expect(sanitizeProps("player_frame_failed", { reason: "timeout", link_platform: "tiktok", url: "https://www.tiktok.com/x", atSeconds: 3.2 })).toEqual({ reason: "timeout", link_platform: "tiktok" });
    expect(sanitizeProps("player_frame_failed", { reason: "https://www.tiktok.com/x" })).toEqual({});
  });
});

describe("POST /api/video-links/frame (simulé)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("permis : { url, atSeconds } en JSON avec la session ; la réponse vérifiée est rendue", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { image: "data:image/jpeg;base64,/9j/4AAQ", width: 720, height: 1280, timeSeconds: 3.2 }));
    const frame = await fetchVideoLinkFrame({ url: "https://www.tiktok.com/@a/video/7312345678901234567", atSeconds: 3.215 });
    expect(frame).toEqual({ image: "data:image/jpeg;base64,/9j/4AAQ", width: 720, height: 1280, timeSeconds: 3.2 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.exemple.test/api/video-links/frame");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ url: "https://www.tiktok.com/@a/video/7312345678901234567", atSeconds: 3.215 });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jeton-factice");
  });

  it("refusé : réponse qui n'est pas une image JPEG en « data: » → erreur « invalid_frame » ; erreur du serveur → ApiError", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { image: "https://exemple.test/a.jpg", width: 720, height: 1280 }));
    await expect(fetchVideoLinkFrame({ url: "u", atSeconds: 1 })).rejects.toMatchObject({ status: 502, body: { error: "invalid_frame" } });
    fetchMock.mockResolvedValueOnce(json(503, { error: "video_frame_disabled", message: "m" }));
    await expect(fetchVideoLinkFrame({ url: "u", atSeconds: 1 })).rejects.toMatchObject({ status: 503, body: { error: "video_frame_disabled" } });
  });

  it("délai de l'app : 30 s, puis une erreur reconnaissable (« frame_timeout »)", () => {
    const api = code("src/lib/api.ts");
    expect(api).toContain("export const VIDEO_LINK_FRAME_TIMEOUT_MS = 30_000;");
    expect(api).toContain('if (wasTimedOut(controller.signal)) throw new Error("frame_timeout");');
  });
});
