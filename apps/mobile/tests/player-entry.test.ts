import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { detectLink } from "../src/lib/link-detection";
import { linkStep } from "../src/lib/link-step";
import { normalizeSharedLink } from "../src/lib/shared-item";
import { LINK_PLAYER_ENABLED, PLAYER_CONSENT_GATE, PLAYER_INSTAGRAM_ENABLED, PLAYER_TIKTOK_ENABLED } from "../src/lib/spot-flags";

// Lot « lecteur intégré » : le lien entre par le point d'entrée unique
// (link-step.ts) ; le site ne change pas ; statistiques fermées.
const LINKS = [
  "https://vm.tiktok.com/ZMabc123/",
  "Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp",
  "https://www.tiktok.com/@a/video/6718335390845095173",
  "https://www.instagram.com/reel/Cxyz/?igsh=abc",
  "https://www.instagram.com/marvelskies.fc/reel/CWqAgUZgCku/",
  "https://www.instagram.com/share/reel/BAGxyz/",
  "https://www.tiktok.com/@mayelasjourney",
  "https://www.instagram.com/zara/",
  "https://pin.it/4xYz",
  "https://www.zara.com/fr/veste",
  "pas un lien",
];

describe("lecteur coupé sur cette branche : parcours lien inchangé", () => {
  it("LINK_PLAYER_ENABLED vaut false (aucun build App Store avec le lecteur sans accord écrit de TikTok et de Meta)", () => {
    expect(LINK_PLAYER_ENABLED).toBe(false);
  });

  it("constantes par plateforme figées, accord préalable demandé", () => {
    expect(PLAYER_TIKTOK_ENABLED).toBe(true);
    expect(PLAYER_INSTAGRAM_ENABLED).toBe(false);
    expect(PLAYER_CONSENT_GATE).toBe(true);
  });

  it.each(LINKS)("« %s » : sans plateforme ouverte, même décision qu'avant le lot", (text) => {
    expect(linkStep(text, [])).toEqual(linkStep(text));
    const step = linkStep(text);
    expect(step.kind).not.toBe("player");
    const detection = detectLink(text);
    // Avant le lot (analyse coupée) : lien TikTok, Instagram ou Pinterest, vidéo ou profil → l'aide ; le reste → refus.
    expect(step.kind).toBe(detection.kind === "supported" || detection.kind === "not_a_video" ? "help" : "refused");
  });
});

describe("lien → lecteur intégré (app iPhone, lecteur allumé)", () => {
  it.each([
    ["https://vm.tiktok.com/ZMabc123/", "tiktok"],
    ["Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp", "tiktok"],
    ["https://www.instagram.com/reel/Cxyz/?igsh=abc", "instagram"],
    ["https://www.instagram.com/marvelskies.fc/reel/CWqAgUZgCku/", "instagram"],
    ["https://www.instagram.com/share/reel/BAGxyz/", "instagram"],
  ])("« %s » : le lecteur", (text, platform) => {
    const detection = detectLink(text);
    if (detection.kind !== "supported") throw new Error("lien attendu");
    expect(linkStep(text, ["tiktok", "instagram"])).toEqual({ kind: "player", url: detection.url, platform });
  });

  it("une plateforme coupée garde l'aide « capture d'écran d'abord » (contre-expertise n° 6)", () => {
    expect(linkStep("https://www.instagram.com/reel/Cxyz/", ["tiktok"])).toEqual({ kind: "help" });
    expect(linkStep("https://vm.tiktok.com/ZMabc123/", ["tiktok"])).toMatchObject({ kind: "player", platform: "tiktok" });
  });

  it("profil TikTok ou Instagram : refus clair, ni aide ni lecteur", () => {
    expect(linkStep("https://www.tiktok.com/@mayelasjourney", ["tiktok", "instagram"])).toEqual({ kind: "refused", message: fr.spotter.notAVideo.tiktok });
    expect(linkStep("https://www.instagram.com/zara/", ["tiktok", "instagram"])).toEqual({ kind: "refused", message: fr.spotter.notAVideo.instagram });
  });

  it("Pinterest : l'aide, comme aujourd'hui ; autre site : refus", () => {
    expect(linkStep("https://pin.it/4xYz", ["tiktok", "instagram"])).toEqual({ kind: "help" });
    expect(linkStep("https://www.zara.com/fr/veste", ["tiktok", "instagram"])).toEqual({ kind: "refused", message: fr.spotter.unsupportedLink });
  });

  it("lien partagé et lien collé : même décision", () => {
    for (const text of ["https://vm.tiktok.com/ZMabc123/", "https://www.instagram.com/reel/Cxyz/?igsh=abc"]) {
      const shared = normalizeSharedLink(text);
      if (!shared) throw new Error("lien attendu");
      expect(linkStep(shared, ["tiktok", "instagram"])).toEqual(linkStep(text, ["tiktok", "instagram"]));
    }
  });
});

describe("statistiques du lecteur : jamais le lien ni l'image", () => {
  it("valeurs admises seulement", () => {
    expect(sanitizeProps("player_opened", { platform: "tiktok", source: "share", url: "https://vm.tiktok.com/x" })).toEqual({ platform: "tiktok", source: "share" });
    // Plus aucun événement de capture : le module natif est sorti de l'app.
    expect(Object.keys(ANALYTICS_EVENTS)).not.toContain("player_capture");
    expect(sanitizeProps("player_fallback", { platform: "tiktok", choice: "black_reported" })).toEqual({ platform: "tiktok" });
    expect(sanitizeProps("player_unavailable", { platform: "pinterest", reason: "not_public" })).toEqual({ reason: "not_public" });
    expect(sanitizeProps("player_fallback", { platform: "tiktok", choice: "embed" })).toEqual({ platform: "tiktok", choice: "embed" });
    expect(sanitizeProps("player_consent", { platform: "tiktok", choice: "play", text: "libre" })).toEqual({ platform: "tiktok", choice: "play" });
  });
});
