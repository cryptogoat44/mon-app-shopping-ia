import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { featureOn, readFeatures } from "../src/lib/features";

// Mission « liens vidéo » : options du build des deux lecteurs officiels.
// Allumées par défaut ; coupées seulement par la valeur exacte « false ».

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("options du build (lib/features.ts)", () => {
  it("allumées par défaut (variable absente ou vide, ou toute autre valeur que « false »)", () => {
    for (const value of [undefined, "", "true", "1", "0", "False", "FALSE", "non", " false"]) expect(featureOn(value), String(value)).toBe(true);
    expect(readFeatures({ tiktok: undefined, instagram: undefined })).toEqual({ tiktokPlayer: true, instagramPlayer: true });
  });

  it("« false » coupe la plateforme concernée, et elle seule", () => {
    expect(readFeatures({ tiktok: "false", instagram: undefined })).toEqual({ tiktokPlayer: false, instagramPlayer: true });
    expect(readFeatures({ tiktok: "true", instagram: "false" })).toEqual({ tiktokPlayer: true, instagramPlayer: false });
  });

  it("les deux coupées : aucun lecteur dans le build", async () => {
    expect(readFeatures({ tiktok: "false", instagram: "false" })).toEqual({ tiktokPlayer: false, instagramPlayer: false });
    vi.stubEnv("EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER", "false");
    vi.stubEnv("EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER", "false");
    const loaded = await import("../src/lib/features");
    expect(loaded.features).toEqual({ tiktokPlayer: false, instagramPlayer: false });
    expect(loaded.anyPlayerInBuild).toBe(false);
  });

  it("les options de ce build lisent bien les deux variables", async () => {
    vi.stubEnv("EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER", "false");
    const loaded = await import("../src/lib/features");
    expect(loaded.features).toEqual({ tiktokPlayer: false, instagramPlayer: true });
    expect(loaded.anyPlayerInBuild).toBe(true);
  });

  it("écrit pour Metro : process.env.EXPO_PUBLIC_… lu tel quel (valeur écrite au build), jamais par une variable", () => {
    const code = readFileSync(join(__dirname, "../src/lib/features.ts"), "utf8");
    expect(code).toContain('tiktokPlayer: process.env.EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER !== "false"');
    expect(code).toContain('instagramPlayer: process.env.EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER !== "false"');
    expect(code).not.toMatch(/process\.env\[|const \{[^}]*\} = process\.env/);
  });

  it("anciennes constantes figées retirées (LINK_PLAYER_ENABLED, PLAYER_TIKTOK_ENABLED, PLAYER_INSTAGRAM_ENABLED, PLAYER_CAPTURE_IN_BUILD)", () => {
    for (const file of ["../src/lib/spot-flags.ts", "../src/lib/player-access.ts", "../src/lib/player-link.ts"]) {
      expect(readFileSync(join(__dirname, file), "utf8")).not.toMatch(/LINK_PLAYER_ENABLED|PLAYER_TIKTOK_ENABLED|PLAYER_INSTAGRAM_ENABLED|PLAYER_CAPTURE_IN_BUILD/);
    }
  });

  it("les deux variables sont documentées dans .env.example", () => {
    const example = readFileSync(join(__dirname, "../.env.example"), "utf8");
    expect(example).toContain("EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER");
    expect(example).toContain("EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER");
  });
});
