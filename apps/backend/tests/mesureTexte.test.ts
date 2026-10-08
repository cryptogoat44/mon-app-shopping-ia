import { describe, expect, it } from "vitest";
import { CURRENT_LENS_SETTINGS } from "../src/services/lensSettings.js";
import { CREDITS_MESURE_MAX, decision, divergenceForte, essaisDeBase, moyenne, PIECE, texteNuisible, troisiemeEssai } from "../scripts/lib/mesure-texte.js";

// Lot 4 ter (demande du fondateur, 2026-10-08) : mesure de l'effet du texte sur
// Google Lens — 12 crédits au plus, une troisième recherche seulement en cas
// de forte divergence, et sa règle de décision.
const VESTE = PIECE.parse({ nom: "veste-bleu-marine", texte: "veste bleu marine", image: "/tmp/veste.jpg", zone: { x: 0, y: 0.35, width: 1, height: 0.45 } });

describe("mesure de l'effet du texte", () => {
  it("par pièce : le cadre seul, puis le cadre et le texte, réglages de l'app ; 5 pièces tiennent dans 12 crédits", () => {
    expect(essaisDeBase(VESTE).map((e) => [e.zone, e.texte])).toEqual([
      ["vetement", null],
      ["vetement", "veste bleu marine"],
    ]);
    expect(essaisDeBase(VESTE).every((e) => e.reglages === CURRENT_LENS_SETTINGS)).toBe(true);
    expect(CREDITS_MESURE_MAX).toBe(12);
    expect(5 * 2).toBeLessThanOrEqual(CREDITS_MESURE_MAX);
  });

  it("forte divergence : l'une vide et l'autre ≥ 5, ou au moins le double avec ≥ 10 d'écart", () => {
    expect(divergenceForte(30, 0)).toBe(true);
    expect(divergenceForte(0, 4)).toBe(false);
    expect(divergenceForte(30, 12)).toBe(true);
    expect(divergenceForte(12, 8)).toBe(false);
    expect(divergenceForte(6, 14)).toBe(false);
    expect(divergenceForte(0, 0)).toBe(false);
  });

  it("troisième recherche : on refait la plus pauvre des deux", () => {
    expect(troisiemeEssai(VESTE, 30, 0)).toMatchObject({ numero: 3, texte: "veste bleu marine" });
    expect(troisiemeEssai(VESTE, 0, 30)).toMatchObject({ numero: 3, texte: null });
  });

  it("règle du fondateur : texte nuisible (au moins deux fois moins, ou vide) dans au moins la moitié des pièces → cesser", () => {
    expect(texteNuisible(30, 0)).toBe(true);
    expect(texteNuisible(30, 15)).toBe(true);
    expect(texteNuisible(30, 16)).toBe(false);
    expect(texteNuisible(0, 0)).toBe(false);
    expect(texteNuisible(0, 20)).toBe(false);
    expect(moyenne([30, 0])).toBe(15);
    const piece = (sansTexte: number, avecTexte: number) => ({ sansTexte, avecTexte });
    expect(decision([piece(30, 0), piece(30, 10), piece(30, 25), piece(30, 30), piece(20, 20)])).toBe("garder");
    expect(decision([piece(30, 0), piece(30, 10), piece(30, 15), piece(30, 30), piece(20, 20)])).toBe("cesser");
  });

  it("pièce : nom simple, texte d'au moins deux caractères ; une photo, ou une vidéo et l'instant", () => {
    expect(PIECE.safeParse({ ...VESTE, nom: "Veste bleue" }).success).toBe(false);
    expect(PIECE.safeParse({ ...VESTE, texte: " a " }).success).toBe(false);
    const { image: _image, ...sansImage } = VESTE;
    expect(PIECE.safeParse({ ...sansImage, video: "/tmp/veste.mp4", seconde: 14.256 }).success).toBe(true);
    expect(PIECE.safeParse({ ...sansImage, video: "/tmp/veste.mp4" }).success).toBe(false);
    expect(PIECE.safeParse({ ...VESTE, video: "/tmp/veste.mp4", seconde: 1 }).success).toBe(false);
    expect(PIECE.safeParse(sansImage).success).toBe(false);
  });
});

describe("état de Google Lens chez SerpApi (page d'état publique)", () => {
  it("lit l'état du composant « Lens API » ; réponse inattendue : rien", async () => {
    const { etatLens } = await import("../scripts/lib/mesure-texte.js");
    const page = { components: [{ name: "Search API", status: "partial_outage" }, { name: "Lens API", status: "degraded_performance" }] };
    expect(etatLens(page)).toBe("degraded_performance");
    expect(etatLens({ components: [{ name: "Lens API", status: "operational" }] })).toBe("operational");
    expect(etatLens({ components: [] })).toBeNull();
    expect(etatLens("<html>")).toBeNull();
  });
});
