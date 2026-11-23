import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";

// Retours du premier build iPhone (23 novembre 2026, essais du fondateur) :
// - « on ne peut pas faire demi-tour » : sur les écrans où le geste « glisser
//   pour revenir » est coupé (cadre à tracer, frise, lecteur), la petite
//   flèche « ‹ » seule passait inaperçue. Le retour y est écrit en toutes
//   lettres : « ‹ Retour » ;
// - « quand on colle un lien, on ne peut pas le supprimer » : le champ du lien
//   a une croix qui le vide.
const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

/** Les écrans dont le geste de retour est coupé, lus dans la navigation elle-même. */
function screensWithoutBackGesture(): string[] {
  const layout = source("app/(app)/_layout.tsx");
  return [...layout.matchAll(/<Stack\.Screen name="([^"]+)" options=\{\{ gestureEnabled: false \}\} \/>/g)].map((m) => m[1]!);
}

describe("écrans sans geste de retour : le retour est écrit en toutes lettres", () => {
  it("la navigation coupe bien le geste sur les écrans attendus (sinon ce test ne vérifierait rien)", () => {
    expect(screensWithoutBackGesture().sort()).toEqual(["spot/analysis", "spot/ciblage", "spot/lancer", "spot/lecteur", "spot/video"]);
  });

  it("permis : chacun de ces écrans montre « Retour » en toutes lettres ; refusé : la flèche « ‹ » seule", () => {
    for (const screen of screensWithoutBackGesture()) {
      const text = source(`app/(app)/${screen}.tsx`);
      const written = text.includes("‹ {t.common.back}") || text.includes("label: t.common.back");
      expect(written, screen).toBe(true);
      expect(text.includes(">‹</Text>"), screen).toBe(false);
    }
  });

  it("le mot affiché existe en français et en anglais", () => {
    expect(fr.common.back).toBe("Retour");
    expect(en.common.back.length).toBeGreaterThan(0);
  });
});

describe("champ du lien : une croix pour le vider", () => {
  const entry = source("components/link-entry.tsx");

  it("permis : la croix vide le lien et son message, avec un nom pour VoiceOver en français et en anglais", () => {
    expect(entry).toContain("accessibilityLabel={t.spotter.clearLink}");
    expect(entry).toMatch(/function handleClear\(\) \{\s*setLink\(""\);\s*setMessage\(null\);\s*\}/);
    expect(entry).toContain("onPress={handleClear}");
    expect(fr.spotter.clearLink).toBe("Effacer le lien");
    expect(en.spotter.clearLink).toBe("Clear the link");
  });

  it("refusé : pas de croix quand le champ est vide", () => {
    expect(entry).toMatch(/\{link\.length > 0 \? \(\s*<Pressable onPress=\{handleClear\}/);
  });
});
