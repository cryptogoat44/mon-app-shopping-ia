import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { detectLink } from "../src/lib/link-detection";
import { linkStep } from "../src/lib/link-step";
import { normalizeSharedLink } from "../src/lib/shared-item";
import { PLAYER_CONSENT_GATE } from "../src/lib/spot-flags";

// Mission « liens vidéo » : le lien entre par le point d'entrée unique
// (link-step.ts) ; un lien de vidéo TikTok ou Instagram ouvre l'écran
// « vidéo partagée », sur l'app comme sur le site (qui décide ensuite du
// lecteur ou de l'écran de secours) ; statistiques fermées.

describe("lien → écran « vidéo partagée »", () => {
  it.each([
    ["https://vm.tiktok.com/ZMabc123/", "tiktok"],
    ["Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp", "tiktok"],
    ["https://www.tiktok.com/@a/video/6718335390845095173", "tiktok"],
    ["https://www.instagram.com/reel/Cxyz/?igsh=abc", "instagram"],
    ["https://www.instagram.com/marvelskies.fc/reel/CWqAgUZgCku/", "instagram"],
    ["https://www.instagram.com/share/reel/BAGxyz/", "instagram"],
  ])("« %s » : l'écran vidéo", (text, platform) => {
    const detection = detectLink(text);
    if (detection.kind !== "supported") throw new Error("lien attendu");
    expect(linkStep(text)).toEqual({ kind: "video", url: detection.url, platform });
  });

  it("profil TikTok ou Instagram : refus clair, ni aide ni écran vidéo", () => {
    expect(linkStep("https://www.tiktok.com/@mayelasjourney")).toEqual({ kind: "refused", message: fr.spotter.notAVideo.tiktok });
    expect(linkStep("https://www.instagram.com/zara/")).toEqual({ kind: "refused", message: fr.spotter.notAVideo.instagram });
  });

  it("Pinterest : l'aide « capture d'écran d'abord » ; autre site : refus", () => {
    expect(linkStep("https://pin.it/4xYz")).toEqual({ kind: "help" });
    expect(linkStep("https://www.zara.com/fr/veste")).toEqual({ kind: "refused", message: fr.spotter.unsupportedLink });
  });

  it("lien partagé et lien collé : même décision", () => {
    for (const text of ["https://vm.tiktok.com/ZMabc123/", "https://www.instagram.com/reel/Cxyz/?igsh=abc"]) {
      const shared = normalizeSharedLink(text);
      if (!shared) throw new Error("lien attendu");
      expect(linkStep(shared)).toEqual(linkStep(text));
    }
  });

  it("accord préalable toujours demandé avant le premier lecteur", () => {
    expect(PLAYER_CONSENT_GATE).toBe(true);
  });
});

describe("statistiques du lecteur : jamais le lien ni l'image", () => {
  it("valeurs admises seulement", () => {
    expect(sanitizeProps("player_opened", { platform: "tiktok", source: "share", url: "https://vm.tiktok.com/x" })).toEqual({ platform: "tiktok", source: "share" });
    expect(Object.keys(ANALYTICS_EVENTS)).not.toContain("player_capture");
    expect(sanitizeProps("player_unavailable", { platform: "pinterest", reason: "server_off" })).toEqual({ reason: "server_off" });
    expect(sanitizeProps("player_unavailable", { platform: "tiktok", reason: "libre" })).toEqual({ platform: "tiktok" });
    expect(sanitizeProps("player_fallback", { platform: "tiktok", choice: "embed" })).toEqual({ platform: "tiktok" });
    expect(sanitizeProps("player_consent", { platform: "tiktok", choice: "refuse", text: "libre" })).toEqual({ platform: "tiktok", choice: "refuse" });
    expect(sanitizeProps("player_spot", { platform: "instagram", uri: "file:///x.jpg" })).toEqual({ platform: "instagram" });
  });
});
