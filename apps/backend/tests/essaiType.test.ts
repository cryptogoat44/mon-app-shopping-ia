import { describe, expect, it } from "vitest";
import { PIECE } from "../scripts/lib/mesure-texte.js";
import {
  bilanFacturation,
  contenusInterdits,
  CREDITS_MAX,
  depensePermise,
  essaisType,
  factureeSelonSerpApi,
  ligneLancee,
  ligneTerminee,
  PIECES_ESSAI_TYPE,
  planEssaiType,
  reponseDeTest,
} from "../scripts/lib/essai-type.js";

// Essai du type de recherche de Google Lens (décisions du fondateur,
// 2026-10-20) : « visual_matches » sur les 4 pièces choisies, puis « products »
// (erreur attendue) ; sonde unique ; relevé sans contenu personnel ; réponses de
// test anonymisées et vérifiées. Aucun appel dans ces tests.
const piece = (nom: string) => PIECE.parse({ nom, texte: "pièce d'essai", image: `/tmp/${nom}.jpg`, zone: { x: 0, y: 0.5, width: 1, height: 0.4 } });
const TOUTES = ["maillot-nike", "veste-bleu-marine", "tshirt-blanc", "pull-blanc", "pull-noir"].map(piece);

describe("plans de l'essai du type de recherche", () => {
  it("essai complet : visual_matches sur les 4 pièces choisies, dans l'ordre du fondateur, cadre seul, en français ; products en dernier", () => {
    const plan = essaisType(TOUTES);
    expect(plan.map((e) => [e.essai.numero, e.piece.nom, e.essai.reglages.type, e.erreurAttendue])).toEqual([
      [1, "veste-bleu-marine", "visual_matches", false],
      [2, "tshirt-blanc", "visual_matches", false],
      [3, "pull-noir", "visual_matches", false],
      [4, "maillot-nike", "visual_matches", false],
      [5, "veste-bleu-marine", "products", true],
    ]);
    expect(plan.every((e) => e.essai.zone === "vetement" && e.essai.texte === null && e.essai.reglages.locale?.country === "fr" && e.essai.reglages.locale.hl === "fr")).toBe(true);
    expect(PIECES_ESSAI_TYPE).toHaveLength(4);
    expect(CREDITS_MAX.type).toBe(5);
  });

  it("sonde unique : une seule recherche visual_matches, sans texte, 1 crédit au plus", () => {
    const sonde = planEssaiType("sonde", TOUTES);
    expect(sonde.map((e) => [e.piece.nom, e.essai.reglages.type, e.essai.texte, e.erreurAttendue])).toEqual([["veste-bleu-marine", "visual_matches", null, false]]);
    expect(CREDITS_MAX.sonde).toBe(1);
  });

  it("une pièce manquante : refus avant tout appel", () => {
    expect(() => essaisType(TOUTES.filter((p) => p.nom !== "pull-noir"))).toThrow(/pull-noir/);
  });
});

describe("dépense permise", () => {
  it("par défaut, seulement si Google Lens est annoncé opérationnel", () => {
    expect(depensePermise("type", "operational", false)).toEqual({ permis: true });
    expect(depensePermise("type", "degraded_performance", false).permis).toBe(false);
    expect(depensePermise("type", "illisible", false).permis).toBe(false);
    expect(depensePermise("sonde", "degraded_performance", false).permis).toBe(false);
  });

  it("malgré la page d'état : la sonde unique seulement, jamais l'essai complet (même opérationnel)", () => {
    expect(depensePermise("sonde", "degraded_performance", true)).toEqual({ permis: true });
    expect(depensePermise("sonde", "illisible", true)).toEqual({ permis: true });
    expect(depensePermise("type", "degraded_performance", true)).toMatchObject({ permis: false, raison: expect.stringMatching(/sonde unique/) });
    expect(depensePermise("type", "operational", true).permis).toBe(false);
  });
});

describe("relevé de chaque recherche", () => {
  const [veste, , , , products] = essaisType(TOUTES);
  const lancee = ligneLancee(veste!, new Date("2026-10-21T08:30:05Z"));

  it("écrit avant l'appel : en cours, heure de Paris, rien d'autre", () => {
    expect(lancee).toMatchObject({ numero: 1, piece: "veste-bleu-marine", type: "visual_matches", lancee: "10:30:05", issue: "en_cours", code: null, factureeSelonSerpApi: "inconnu", recues: null });
  });

  it("facturée d'après SerpApi : « Success » oui ; code d'erreur ou « Error » non ; sans réponse, inconnu", () => {
    expect(factureeSelonSerpApi(200, "Success")).toBe("oui");
    expect(factureeSelonSerpApi(400, null)).toBe("non");
    expect(factureeSelonSerpApi(503, "Error")).toBe("non");
    expect(factureeSelonSerpApi(200, "Error")).toBe("non");
    expect(factureeSelonSerpApi(200, null)).toBe("inconnu");
    expect(factureeSelonSerpApi(null, null)).toBe("inconnu");
  });

  it("complétée après l'appel : réussie, vide, erreur ou panne ; rubriques et durée, sans contenu", () => {
    const structure = { rubriques: { search_metadata: "objet" as const, visual_matches: 60, related_content: 3 }, etat: "Success", erreur: null };
    expect(ligneTerminee(lancee, { code: 200, structure, secondes: 4 }, { recues: 60, gardees: 30, avecPrix: 12 }, 5)).toMatchObject({
      issue: "reussie", code: 200, statutSerpApi: "Success", factureeSelonSerpApi: "oui", recues: 60, gardees: 30, avecPrix: 12, rubriques: ["visual_matches (60)", "related_content (3)"], secondes: 4,
    });
    const vide = { rubriques: { search_information: "objet" as const, error: "texte" as const }, etat: "Success", erreur: "Google Lens hasn't returned any results for this query." };
    expect(ligneTerminee(lancee, { code: 200, structure: vide, secondes: 3 }, { recues: 0, gardees: 0, avecPrix: 0 }, 3)).toMatchObject({ issue: "vide", factureeSelonSerpApi: "oui", message: "Google Lens hasn't returned any results for this query." });
    const erreur = { rubriques: { error: "texte" as const }, etat: null, erreur: "Unsupported value for `type`" };
    expect(ligneTerminee(ligneLancee(products!, new Date()), { code: 400, structure: erreur, secondes: 1 }, null, 1)).toMatchObject({ issue: "erreur", code: 400, factureeSelonSerpApi: "non", recues: null, message: "Unsupported value for `type`" });
    expect(ligneTerminee(lancee, null, null, 15)).toMatchObject({ issue: "panne", code: null, factureeSelonSerpApi: "inconnu", secondes: 15 });
  });

  it("un message qui contiendrait une donnée à protéger est retiré ; il est coupé à 160 caractères", () => {
    const fuite = { rubriques: {}, etat: "Error", erreur: "Invalid api_key for compte@exemple.fr" };
    expect(ligneTerminee(lancee, { code: 401, structure: fuite, secondes: 0 }, null, 0).message).toBe("(message retiré : contenu à protéger)");
    const long = { rubriques: {}, etat: "Error", erreur: "x".repeat(300) };
    expect(ligneTerminee(lancee, { code: 503, structure: long, secondes: 0 }, null, 0).message).toHaveLength(160);
  });

  it("bilan de facturation, pour lire l'écart du compteur", () => {
    const succes = { rubriques: {}, etat: "Success", erreur: null };
    const lignes = [
      ligneTerminee(lancee, { code: 200, structure: succes, secondes: 3 }, { recues: 60, gardees: 30, avecPrix: 10 }, 3),
      ligneTerminee(lancee, { code: 200, structure: succes, secondes: 3 }, { recues: 0, gardees: 0, avecPrix: 0 }, 3),
      ligneTerminee(lancee, { code: 400, structure: null, secondes: 1 }, null, 1),
      ligneTerminee(lancee, null, null, 15),
    ];
    expect(bilanFacturation(lignes)).toEqual({ oui: 2, non: 1, inconnu: 1 });
  });
});

describe("réponses de test : réduites, anonymisées, vérifiées", () => {
  const BRUT = {
    search_metadata: { id: "6a1b2c", status: "Success", json_endpoint: "https://serpapi.com/searches/6a1b2c/x.json" },
    search_parameters: { engine: "google_lens", type: "visual_matches", url: "https://projet.supabase.co/storage/v1/object/sign/screenshots/essai.jpg?token=jeton-secret", api_key: "cle-secrete" },
    search_information: { images_results_state: "Results for exact image", autre: "?" },
    visual_matches: [
      { position: 1, title: "Veste bleu marine", link: "https://www.boutique.fr/veste", source: "Boutique", source_icon: "https://icone", thumbnail: "https://encrypted-tbn0.gstatic.com/images?q=1", image: "https://www.boutique.fr/veste.jpg", price: { value: "49 €", extracted_value: 49, currency: "EUR" }, in_stock: true, rating: 4.5, exact_matches: true, serpapi_exact_matches_link: "https://serpapi.com/search.json?engine=google_lens&url=https%3A%2F%2Fprojet.supabase.co%2Fstorage" },
      { position: 2, title: "@marie.dupont porte sa veste", link: "https://www.tiktok.com/@marie.dupont/video/123", source: "TikTok", thumbnail: "https://p16.tiktokcdn.com/x.jpg" },
      { position: 3, title: "Veste bleue taille M", link: "https://www.leboncoin.fr/ad/vetements/2876543210", source: "Leboncoin", thumbnail: "https://img.leboncoin.fr/x.jpg", image: "https://img.leboncoin.fr/y.jpg" },
      { position: 4, title: "Veste", link: "https://www.vinted.fr/items/123456-veste", source: "Vinted" },
    ],
    related_content: [{ query: "veste bleu marine", link: "https://www.google.com/search?q=veste" }, { query: "veste homme" }],
    ai_overview: { page_token: "jeton" },
  };

  it("forme d'une réponse de SerpApi : statut, état de Google, propositions réduites aux champs lus, autres rubriques vides à leur taille", () => {
    const test = reponseDeTest(BRUT)!;
    expect(test.search_metadata).toEqual({ status: "Success" });
    expect(test.search_information).toEqual({ images_results_state: "Results for exact image" });
    expect(test.related_content).toEqual([{}, {}]);
    expect(test.ai_overview).toEqual({});
    expect(test).not.toHaveProperty("search_parameters");
    expect(test.visual_matches).toEqual([
      { position: 1, title: "Veste bleu marine", link: "https://www.boutique.fr/veste", source: "Boutique", thumbnail: "https://example.invalid/vignette-1.jpg", image: "https://example.invalid/image-1.jpg", price: { value: "49 €", extracted_value: 49, currency: "EUR" }, in_stock: true },
      { position: 2, title: "Publication anonymisée", link: "https://www.tiktok.com/compte-anonyme/0000000002", source: "TikTok", thumbnail: "https://example.invalid/vignette-2.jpg" },
      { position: 3, title: "Veste bleue taille M", link: "https://www.leboncoin.fr/annonce/0000000003", source: "Leboncoin", thumbnail: "https://example.invalid/vignette-3.jpg", image: "https://example.invalid/image-3.jpg" },
      { position: 4, title: "Veste", link: "https://www.vinted.fr/annonce/0000000004", source: "Vinted" },
    ]);
  });

  it("le résultat ne contient plus rien à protéger, alors que la réponse brute en contenait", () => {
    expect(contenusInterdits(JSON.stringify(BRUT))).toEqual(["clé d'API", "adresse d'image temporaire de notre serveur", "lien de recherche de SerpApi (il contient l'adresse de l'image)"]);
    expect(contenusInterdits(JSON.stringify(reponseDeTest(BRUT)))).toEqual([]);
  });

  it("contenus interdits : clé, adresse e-mail, adresse d'image temporaire, lien de SerpApi", () => {
    expect(contenusInterdits('{"api_key":"x"}')).toEqual(["clé d'API"]);
    expect(contenusInterdits("contact : prenom.nom@exemple.fr")).toEqual(["adresse e-mail"]);
    expect(contenusInterdits("https://x.supabase.co/storage/v1/object/sign/a.jpg?token=y")).toEqual(["adresse d'image temporaire de notre serveur"]);
    expect(contenusInterdits("https://serpapi.com/search.json?engine=google_lens")).toEqual(["lien de recherche de SerpApi (il contient l'adresse de l'image)"]);
    expect(contenusInterdits("Veste bleu marine — 49 €, @marque sur Instagram")).toEqual([]);
  });

  it("réponse d'erreur : le message de SerpApi gardé ; réponse illisible : rien", () => {
    expect(reponseDeTest({ search_metadata: { id: "x", status: "Error" }, error: "Unsupported value for `type`" })).toEqual({ search_metadata: { status: "Error" }, error: "Unsupported value for `type`" });
    expect(reponseDeTest({ error: "Invalid request" })).toEqual({ error: "Invalid request" });
    expect(reponseDeTest(null)).toBeNull();
    expect(reponseDeTest([1, 2])).toBeNull();
  });
});
