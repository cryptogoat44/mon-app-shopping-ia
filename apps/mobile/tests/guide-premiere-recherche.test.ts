import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { FIRST_RUN_GUIDE_KEY, FIRST_RUN_GUIDE_STEPS, claimFirstRunGuide, nextGuideStep, skipFirstRunGuide, type GuideStore } from "../src/lib/first-run-guide";

// Lot « recherche confiance » : le guide de la première recherche (trois
// étapes, une seule fois par appareil). Logique pure et lecture du code des
// écrans (aucun rendu).

const SRC = join(__dirname, "../src");
/** Code sans ses commentaires. */
const code = (path: string) =>
  readFileSync(join(SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** Stockage factice (AsyncStorage) : une table en mémoire, qui peut tomber en panne. */
function fakeStore(options: { failRead?: boolean; failWrite?: boolean } = {}): GuideStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => {
      if (options.failRead) throw new Error("stockage indisponible");
      return values.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (options.failWrite) throw new Error("stockage plein");
      values.set(key, value);
    }),
  };
}

describe("guide de la première recherche", () => {
  it("montré une seule fois par appareil, même s'il n'a pas été fermé ; jamais à quelqu'un qui a déjà spotté", async () => {
    const store = fakeStore();
    expect(await claimFirstRunGuide(store)).toBe(true);
    expect(store.values.get(FIRST_RUN_GUIDE_KEY)).toBe("1");
    expect(await claimFirstRunGuide(store)).toBe(false);
    const experienced = fakeStore();
    await skipFirstRunGuide(experienced);
    expect(await claimFirstRunGuide(experienced)).toBe(false);
    // Convention des marques « déjà vu » de l'app : une clé « spotto.… » sans accent.
    expect(FIRST_RUN_GUIDE_KEY).toMatch(/^spotto\.[a-z-]+$/);
  });

  it("stockage illisible ou plein : pas de guide (plutôt que de le montrer à chaque ouverture)", async () => {
    expect(await claimFirstRunGuide(fakeStore({ failRead: true }))).toBe(false);
    expect(await claimFirstRunGuide(fakeStore({ failWrite: true }))).toBe(false);
    await expect(skipFirstRunGuide(fakeStore({ failWrite: true }))).resolves.toBeUndefined();
  });

  it("trois étapes, dans l'ordre demandé, en français et en anglais ; la dernière lance une vraie recherche", () => {
    expect(FIRST_RUN_GUIDE_STEPS).toBe(3);
    expect(fr.firstRunGuide.steps).toEqual(["Partagez la vidéo depuis TikTok ou Instagram, ou collez son lien", "Entourez la pièce", "Comparez les boutiques et les prix, créez une alerte"]);
    expect(en.firstRunGuide.steps).toHaveLength(3);
    expect([nextGuideStep(0), nextGuideStep(1), nextGuideStep(2)]).toEqual([1, 2, null]);
    expect(fr.firstRunGuide.start).toBe("Lancer ma première recherche");
    const screen = code("app/(app)/(tabs)/index.tsx");
    expect(screen).toContain("const guide = useFirstRunGuide(recentLoaded ? recent.length === 0 : null);");
    const shown = screen.slice(screen.indexOf('guide.state === "shown" ? ('), screen.indexOf("<SearchLimitsNotice"));
    expect(shown).toContain("onClose={guide.close}");
    expect(shown).toContain("entries.addPhoto();");
    // Jamais deux cartes de bienvenue : « Comment ça marche » et l'astuce attendent le guide.
    expect(screen).toContain('recentLoaded && recent.length === 0 && guide.state !== "shown" ? <HowItWorksCard /> : null');
    expect(screen).toContain('guide.state === "hidden" ? <VisualSearchTip /> : null');
  });

  it("accessible et à nous : dessins décoratifs masqués, étape lue et annoncée, aucun fondu avec « Réduire les animations », aucune image ni vidéo d'un tiers", () => {
    const guide = code("components/first-run-guide.tsx");
    expect(guide).toContain('importantForAccessibility="no-hide-descendants" accessibilityElementsHidden');
    expect(guide).toContain("AccessibilityInfo.announceForAccessibility(`${stepLabel}. ${text}`);");
    expect(guide).toContain("if (reduceMotion) return;");
    expect(guide).toContain("accessibilityLabel={t.firstRunGuide.skipLabel}");
    expect(guide).toContain('accessibilityRole="header"');
    expect(guide).not.toMatch(/expo-image|expo-video|<Image|https?:\/\//);
    // Aucune hauteur fixe sur un texte (grandes tailles de texte de l'iPhone) : seulement des hauteurs minimales.
    expect(guide).not.toMatch(/\bheight: \d+, (?:font|line)/);
    expect(code("lib/use-first-run-guide.ts")).toContain("claimFirstRunGuide(AsyncStorage)");
  });
});
