import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { __setAnalyticsTestHooks, setAnalyticsUser, track } from "../src/lib/analytics";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";

// Lot « mesure du parcours », décision du responsable : la propriété
// « platform » des événements du lecteur et de l'analyse d'un lien est
// remplacée par l'appareil à l'envoi (analytics.ts) ; la plateforme du lien
// part donc AUSSI en « link_platform ». « platform » reste dans le catalogue
// et aux appels, inchangée (séries existantes). Envoi simulé : rien ne part.
const LINK_EVENTS = ["player_opened", "player_unavailable", "player_fallback", "player_consent", "player_spot", "player_to_ai", "video_link_ai_started", "video_link_ai_moment_chosen"] as const;
const PLAYER_PLATFORM = { kind: "enum", values: ["tiktok", "instagram"] };

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("catalogue fermé : link_platform à côté de l'ancienne platform", () => {
  it("chaque événement du lecteur et de l'analyse d'un lien garde « platform » et ajoute « link_platform » (tiktok ou instagram)", () => {
    for (const event of LINK_EVENTS) {
      const rules: Record<string, unknown> = ANALYTICS_EVENTS[event];
      expect(rules.platform, event).toEqual(PLAYER_PLATFORM);
      expect(rules.link_platform, event).toEqual(PLAYER_PLATFORM);
    }
    // Déjà là avant cette décision.
    expect(ANALYTICS_EVENTS.video_link_ai_result.link_platform).toEqual(PLAYER_PLATFORM);
  });

  it("admis : tiktok ou instagram ; refusé : tout le reste (pas de lien, autre site, l'appareil, un lien)", () => {
    expect(sanitizeProps("player_spot", { platform: "instagram", link_platform: "instagram" })).toEqual({ platform: "instagram", link_platform: "instagram" });
    expect(sanitizeProps("player_unavailable", { platform: "tiktok", reason: "server_off", link_platform: "tiktok" })).toEqual({ platform: "tiktok", reason: "server_off", link_platform: "tiktok" });
    for (const refused of ["none", "youtube", "ios", "https://vm.tiktok.com/ZMabc123/"]) {
      for (const event of LINK_EVENTS) expect(sanitizeProps(event, { link_platform: refused }), `${event} ${refused}`).toEqual({});
    }
  });
});

describe("l'envoi : link_platform arrive, platform reste l'appareil", () => {
  const sent: { event: string; properties: Record<string, unknown> }[] = [];

  beforeEach(() => {
    sent.length = 0;
    __setAnalyticsTestHooks({ apiKey: "phc_test", platform: "ios", sender: (_url, body) => sent.push(JSON.parse(body)) });
  });

  it("avec l'accord : la plateforme du lien en link_platform, l'appareil en platform", () => {
    setAnalyticsUser("u-1", true);
    track("player_consent", { platform: "tiktok", choice: "play", link_platform: "tiktok" });
    track("video_link_ai_moment_chosen", { platform: "instagram", rank: 1, moments_count: 3, link_platform: "instagram" });
    expect(sent.map(({ event, properties }) => [event, properties.link_platform, properties.platform])).toEqual([
      ["player_consent", "tiktok", "ios"],
      ["video_link_ai_moment_chosen", "instagram", "ios"],
    ]);
  });

  it("sans l'accord : rien", () => {
    setAnalyticsUser("u-1", false);
    track("player_spot", { platform: "tiktok", link_platform: "tiktok" });
    expect(sent).toEqual([]);
  });
});

describe("les appels de l'écran « vidéo partagée » et le mode d'emploi", () => {
  it("chaque événement du lecteur envoyé par l'écran porte link_platform, sa « platform » inchangée", () => {
    const screen = read("src/app/(app)/spot/lecteur.tsx");
    const calls = screen.match(/track\("player_[a-z_]+", \{[^}]*\}\)/g) ?? [];
    // Retours du build 2 : + player_to_ai (« Trouver la pièce automatiquement » sous le lecteur).
    // Retours du build 3 : + player_consent au premier appui sur Lecture (firstPlay), + player_frame_failed.
    expect(calls).toHaveLength(9);
    for (const call of calls) expect(call).toMatch(/link_platform: platform \}\)$/);
    // Les événements d'avant gardent leur « platform » ; le nouveau player_frame_failed n'en a pas (règle du catalogue).
    for (const call of calls.filter((c) => !c.startsWith('track("player_frame_failed"'))) expect(call).toMatch(/^track\("player_[a-z_]+", \{ platform, .*link_platform: platform \}\)$/);
    expect(calls.filter((c) => c.startsWith('track("player_frame_failed"'))).toEqual(['track("player_frame_failed", { reason: frameFailureReason(serverResult.reason), link_platform: platform })']);
  });

  it("STATISTIQUES.md dit que l'ancienne « platform » de ces événements montre l'appareil, et de prendre link_platform", () => {
    const guide = read("STATISTIQUES.md").replace(/\s+/g, " ");
    const sentence = guide.slice(guide.indexOf("Dans `player_opened`"), guide.indexOf("`plan_b_screenshot_chosen`.", guide.indexOf("Dans `player_opened`")));
    for (const event of LINK_EVENTS) expect(sentence).toContain(`\`${event}\``);
    expect(sentence).toContain("l'ancienne propriété `platform` montre donc l'appareil : pour TikTok ou Instagram, utilisez `link_platform`");
    expect(guide).not.toContain("(seulement dans `journey_started`, `video_link_ai_result` et `plan_b_screenshot_chosen`)");
  });
});
