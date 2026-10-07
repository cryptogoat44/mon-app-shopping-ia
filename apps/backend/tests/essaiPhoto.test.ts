import { describe, expect, it } from "vitest";
import { DEFAULT_CROP } from "@monapp/shared-types";
import { CURRENT_LENS_SETTINGS, PREVIOUS_LENS_SETTINGS } from "../src/services/lensSettings.js";
import { analyserZone, CREDITS_MAX, ESSAIS, essaisTexte, planEssais, structureReponse, ZONE_APP } from "../scripts/lib/essai-photo.js";

// Lot 4 ter, étape 2 : essais sur la photo du t-shirt — au plus 4 crédits
// SerpApi (accord du fondateur), réglages réellement comparés.
describe("plan des essais de la photo", () => {
  it("4 crédits SerpApi au plus, un par essai ; aucun essai chez un autre prestataire", () => {
    expect(CREDITS_MAX).toBe(4);
    expect(ESSAIS.length).toBeLessThanOrEqual(CREDITS_MAX);
    expect(ESSAIS.map((e) => e.numero)).toEqual([1, 2, 3, 4]);
    expect(planEssais("nike", null)).toBe(ESSAIS);
  });

  it("essai 1 : exactement l'app — zone centrale, sans texte, réglages actuels (products, fr/fr)", () => {
    const essai = ESSAIS[0]!;
    expect(ZONE_APP).toEqual(DEFAULT_CROP);
    expect(essai).toMatchObject({ zone: "app", texte: null, reglages: { type: "products", locale: { country: "fr", hl: "fr" } } });
    expect(essai.reglages).toBe(CURRENT_LENS_SETTINGS);
  });

  it("essais 2 et 3 : zone du vêtement, sans puis avec « t-shirt Nike noir »", () => {
    expect(ESSAIS[1]).toMatchObject({ zone: "vetement", texte: null });
    expect(ESSAIS[2]).toMatchObject({ zone: "vetement", texte: "t-shirt Nike noir" });
  });

  it("essai 4 : même image que l'essai 1, réglages d'avant le 22 septembre (type « all », sans localisation)", () => {
    expect(ESSAIS[3]).toMatchObject({ zone: "app", texte: null });
    expect(ESSAIS[3]!.reglages).toBe(PREVIOUS_LENS_SETTINGS);
    expect(PREVIOUS_LENS_SETTINGS).toEqual({ type: "all", locale: null });
  });

  it("plan « texte » : zone du vêtement sans texte, puis avec le texte deux fois ; 3 crédits ; texte obligatoire", () => {
    const essais = essaisTexte("  veste en daim marron ");
    expect(essais.length).toBeLessThanOrEqual(CREDITS_MAX);
    expect(essais.map((e) => [e.zone, e.texte])).toEqual([
      ["vetement", null],
      ["vetement", "veste en daim marron"],
      ["vetement", "veste en daim marron"],
    ]);
    expect(essais.every((e) => e.reglages === CURRENT_LENS_SETTINGS)).toBe(true);
    expect(() => essaisTexte(" ")).toThrow("indiquez le texte");
    expect(() => planEssais(null, "veste")).toThrow("Indiquez le plan");
  });

  it("structure d'une réponse : rubriques et tailles, jamais leur contenu", () => {
    const structure = structureReponse({
      search_metadata: { status: "Success", id: "x" },
      visual_matches: [],
      ai_overview: { text_blocks: [{ snippet: "contenu" }] },
      related_content: [{ query: "a" }, { query: "b" }],
      error: "Google Lens hasn't returned any results for this query.",
    });
    expect(structure).toEqual({
      rubriques: { search_metadata: "objet", visual_matches: 0, ai_overview: "objet", related_content: 2, error: "texte" },
      etat: "Success",
      erreur: "Google Lens hasn't returned any results for this query.",
    });
    expect(JSON.stringify(structure)).not.toContain("contenu");
    expect(structureReponse(null)).toEqual({ rubriques: {}, etat: null, erreur: "réponse illisible" });
  });

  it("zone donnée à la main : dans l'image et assez grande", () => {
    expect(analyserZone({ x: 0.3, y: 0.42, width: 0.55, height: 0.58 })).toEqual({ x: 0.3, y: 0.42, width: 0.55, height: 0.58 });
    for (const zone of [
      { x: -0.1, y: 0.2, width: 0.5, height: 0.5 },
      { x: 0.6, y: 0.2, width: 0.5, height: 0.5 },
      { x: 0.2, y: 0.2, width: 0.01, height: 0.5 },
      { x: Number.NaN, y: 0.2, width: 0.5, height: 0.5 },
    ])
      expect(() => analyserZone(zone)).toThrow("Zone invalide");
  });
});
