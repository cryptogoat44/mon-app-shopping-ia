import { describe, expect, it } from "vitest";
import { exclusionReason, withoutDuplicates } from "../src/services/matchFilters.js";
import { apercu } from "../scripts/lib/essai-lens.js";
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
  verdictSonde,
  type VerdictSonde,
} from "../scripts/lib/essai-type.js";

// Essai du type de recherche de Google Lens (décisions du fondateur,
// 2026-10-20) : plans, dérogations, relevé sans contenu
// personnel, réponses de test neutralisées, anonymisées et vérifiées (dépôt
// public). Aucun appel dans ces tests.
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

describe("dépense permise : la règle et ses deux dérogations", () => {
  const REUSSIE: VerdictSonde = { reussie: true };
  const RATEE: VerdictSonde = { reussie: false, raison: "la dernière sonde n'a donné aucune proposition gardée par Spotto" };

  it("la règle : seulement si Google Lens est annoncé opérationnel", () => {
    expect(depensePermise("type", "operational", { type: "aucune" })).toEqual({ permis: true });
    expect(depensePermise("type", "degraded_performance", { type: "aucune" }).permis).toBe(false);
    expect(depensePermise("type", "illisible", { type: "aucune" }).permis).toBe(false);
    expect(depensePermise("sonde", "degraded_performance", { type: "aucune" }).permis).toBe(false);
  });

  it("première dérogation : la sonde unique seulement, jamais l'essai complet (même opérationnel)", () => {
    expect(depensePermise("sonde", "degraded_performance", { type: "sonde" })).toEqual({ permis: true });
    expect(depensePermise("sonde", "illisible", { type: "sonde" })).toEqual({ permis: true });
    expect(depensePermise("type", "degraded_performance", { type: "sonde" })).toMatchObject({ permis: false, raison: expect.stringMatching(/sonde unique/) });
    expect(depensePermise("type", "operational", { type: "sonde" }).permis).toBe(false);
  });

  it("seconde dérogation : l'essai complet seulement, et seulement après une sonde réussie", () => {
    expect(depensePermise("type", "degraded_performance", { type: "apres-sonde", verdict: REUSSIE })).toEqual({ permis: true });
    expect(depensePermise("type", "degraded_performance", { type: "apres-sonde", verdict: RATEE })).toMatchObject({ permis: false, raison: expect.stringMatching(/aucune proposition gardée/) });
    expect(depensePermise("sonde", "degraded_performance", { type: "apres-sonde", verdict: REUSSIE })).toMatchObject({ permis: false, raison: expect.stringMatching(/essai complet/) });
  });
});

describe("verdict sur la dernière sonde", () => {
  const maintenant = new Date("2026-10-21T12:00:00Z");
  const ligne = { type: "visual_matches", lanceeLe: "2026-10-21T08:30:05.000Z", issue: "reussie", code: 200, statutSerpApi: "Success", gardees: 12, recues: 60 };

  it("réussie : une recherche visual_matches, code 200, « Success », au moins une proposition gardée, moins de 24 heures", () => {
    expect(verdictSonde([ligne], maintenant)).toEqual({ reussie: true });
  });

  it("non réussie : vide, erreur, panne, ou aucune proposition gardée (que des réseaux sociaux, par exemple)", () => {
    expect(verdictSonde([{ ...ligne, issue: "vide", gardees: 0, recues: 0 }], maintenant).reussie).toBe(false);
    expect(verdictSonde([{ ...ligne, issue: "erreur", code: 400, statutSerpApi: null, gardees: null }], maintenant).reussie).toBe(false);
    expect(verdictSonde([{ ...ligne, issue: "panne", code: null, statutSerpApi: null, gardees: null }], maintenant).reussie).toBe(false);
    expect(verdictSonde([{ ...ligne, gardees: 0 }], maintenant)).toMatchObject({ reussie: false, raison: expect.stringMatching(/aucune proposition gardée/) });
  });

  it("non retenue : plus de 24 heures, plus d'une recherche, autre type, relevé illisible", () => {
    expect(verdictSonde([{ ...ligne, lanceeLe: "2026-10-20T11:00:00.000Z" }], maintenant)).toMatchObject({ reussie: false, raison: expect.stringMatching(/24 heures/) });
    expect(verdictSonde([ligne, ligne], maintenant).reussie).toBe(false);
    expect(verdictSonde([{ ...ligne, type: "products" }], maintenant).reussie).toBe(false);
    expect(verdictSonde({ pas: "une liste" }, maintenant).reussie).toBe(false);
    expect(verdictSonde([{ ...ligne, lanceeLe: "hier" }], maintenant).reussie).toBe(false);
  });
});

describe("relevé de chaque recherche", () => {
  const [veste, , , , products] = essaisType(TOUTES);
  const lancee = ligneLancee(veste!, new Date("2026-10-21T08:30:05Z"));

  it("écrit avant l'appel : en cours, heure de Paris et instant exact, rien d'autre", () => {
    expect(lancee).toMatchObject({ numero: 1, piece: "veste-bleu-marine", type: "visual_matches", lancee: "10:30:05", lanceeLe: "2026-10-21T08:30:05.000Z", issue: "en_cours", code: null, factureeSelonSerpApi: "inconnu", recues: null });
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

describe("réponses de test : réduites, neutralisées, anonymisées, vérifiées", () => {
  const BRUT = {
    search_metadata: { id: "6a1b2c", status: "Success", json_endpoint: "https://serpapi.com/searches/6a1b2c/x.json" },
    search_parameters: { engine: "google_lens", type: "visual_matches", url: "https://projet.supabase.co/storage/v1/object/sign/screenshots/essai.jpg?token=jeton-secret", api_key: "cle-secrete" },
    search_information: { images_results_state: "Results for exact image", autre: "?" },
    visual_matches: [
      { position: 1, title: "Veste bleu marine", link: "https://www.boutique.fr/vestes/veste-bleu-marine?couleur=bleu#avis", source: "Boutique", source_icon: "https://icone", thumbnail: "https://encrypted-tbn0.gstatic.com/images?q=1", image: "https://www.boutique.fr/veste.jpg", price: { value: "49 €", extracted_value: 49, currency: "EUR" }, in_stock: true, rating: 4.5, exact_matches: true, serpapi_exact_matches_link: "https://serpapi.com/search.json?engine=google_lens&url=https%3A%2F%2Fprojet.supabase.co%2Fstorage" },
      { position: 2, title: "@prenom.nom porte sa veste", link: "https://www.tiktok.com/@prenom.nom/video/123", source: "TikTok", thumbnail: "https://p16.tiktokcdn.com/x.jpg" },
      { position: 3, title: "Veste bleue taille M", link: "https://www.leboncoin.fr/ad/vetements/2876543210", source: "Leboncoin", thumbnail: "https://img.leboncoin.fr/x.jpg", image: "https://img.leboncoin.fr/y.jpg" },
      { position: 4, title: "Veste", link: "https://www.vinted.fr/items/123456-veste", source: "Vinted" },
    ],
    related_content: [{ query: "veste bleu marine", link: "https://www.google.com/search?q=veste" }, { query: "veste homme" }],
    ai_overview: { page_token: "jeton" },
  };

  it("forme d'une réponse de SerpApi ; titres, marchands, chemins et site peu connu neutres ; prix, extension et paramètres gardés", () => {
    const test = reponseDeTest(BRUT)!;
    expect(test.search_metadata).toEqual({ status: "Success" });
    expect(test.search_information).toEqual({ images_results_state: "Results for exact image" });
    expect(test.related_content).toEqual([{}, {}]);
    expect(test.ai_overview).toEqual({});
    expect(test).not.toHaveProperty("search_parameters");
    expect(test.visual_matches).toEqual([
      { position: 1, title: "Produit 1", link: "https://www.site-1.fr/produit-1?couleur=bleu", source: "Marchand 1", thumbnail: "https://example.invalid/vignette-1.jpg", image: "https://example.invalid/image-1.jpg", price: { value: "49 €", extracted_value: 49, currency: "EUR" }, in_stock: true },
      { position: 2, title: "Publication anonymisée", link: "https://www.tiktok.com/compte-anonyme/0000000002", source: "Marchand 2", thumbnail: "https://example.invalid/vignette-2.jpg" },
      { position: 3, title: "Produit 3", link: "https://www.leboncoin.fr/annonce/0000000003", source: "Marchand 3", thumbnail: "https://example.invalid/vignette-3.jpg", image: "https://example.invalid/image-3.jpg" },
      { position: 4, title: "Produit 4", link: "https://www.vinted.fr/annonce/0000000004", source: "Marchand 4" },
    ]);
  });

  it("les relations dont dépendent les filtres restent vraies : titres égaux (au nom du site près), chemins égaux, doublons", () => {
    const brut = {
      visual_matches: [
        { position: 1, title: "Veste daim - ZALANDO.CH", link: "https://www.zalando.ch/veste-daim.html", source: "Zalando" },
        { position: 2, title: "Camellia veste", link: "https://fr.shein.com/camellia-p-1.html", source: "Shein" },
        { position: 3, title: "Camellia veste", link: "https://www.na-kd.com/fr/camellia", source: "NA-KD" },
        { position: 4, title: "Veste daim - ZALANDO.FR", link: "https://www.zalando.fr/veste-daim.html", source: "Zalando" },
        { position: 5, title: "Autre veste", link: "https://www.zalando.fr/Veste-Daim.html", source: "Zalando" },
      ],
    };
    const test = reponseDeTest(brut)!.visual_matches as { title: string; link: string; source: string }[];
    expect(test.map((m) => m.title)).toEqual(["Produit 1 - ZALANDO.CH", "Produit 2", "Produit 2", "Produit 1 - ZALANDO.FR", "Produit 3"]);
    expect(test.map((m) => m.source)).toEqual(["Marchand 1", "Marchand 2", "Marchand 3", "Marchand 1", "Marchand 1"]);
    expect(test[0]!.link.replace("zalando.ch", "zalando.fr")).toBe(test[3]!.link);
    expect(test[4]!.link).not.toBe(test[3]!.link);
    // Le filtre des doublons garde la même décision avant et après neutralisation.
    const garder = (liste: { title: string; link: string }[]) => withoutDuplicates(liste, "fr").map((m) => liste.indexOf(m));
    expect(garder(test)).toEqual(garder(brut.visual_matches));
  });

  it("paramètres de liens : identifiants de session, de compte ou de clic (jetons de clic compris) remplacés (même valeur, même remplaçant) ; couleur, variante, pays et devise gardés", () => {
    const brut = {
      visual_matches: [
        { position: 1, title: "Veste", link: "https://www.boutique.fr/veste?colour=chocolate&sessionid=abc123&gclid=XYZ&variant=42&country=CH&currency=CHF", source: "Boutique" },
        { position: 2, title: "Veste", link: "https://www.boutique.fr/veste?colour=chocolate&sessionid=abc123&gclid=AUTRE", source: "Boutique" },
        { position: 3, title: "Pull", link: "https://www.boutique.fr/pull?user_id=987&ref=partenaire&srsltid=AfmBOo", source: "Boutique" },
      ],
    };
    const liens = (reponseDeTest(brut)!.visual_matches as { link: string }[]).map((m) => m.link);
    expect(liens).toEqual([
      "https://www.site-1.fr/produit-1?colour=chocolate&sessionid=id-1&gclid=id-2&variant=42&country=CH&currency=CHF",
      "https://www.site-1.fr/produit-1?colour=chocolate&sessionid=id-1&gclid=id-3",
      "https://www.site-1.fr/produit-2?user_id=id-4&ref=id-5&srsltid=id-6",
    ]);
    expect(contenusInterdits(JSON.stringify(liens))).toEqual([]);
    expect(contenusInterdits("https://x.fr/a?sessionid=abc123")).toEqual(["identifiant de session, de compte ou de clic dans un lien"]);
    // Jetons de clic d'une place de marché (constaté dans une réponse réelle du 21 octobre).
    const clic = reponseDeTest({ visual_matches: [{ position: 1, title: "T-shirt", link: "https://www.etsy.com/listing/1/t-shirt?click_key=605da0%3ALT8d&click_sum=ed4a2c55&ls=r", source: "Etsy" }] })!;
    expect((clic.visual_matches as { link: string }[])[0]!.link).toBe("https://www.etsy.com/produit-1?click_key=id-1&click_sum=id-2&ls=r");
    expect(contenusInterdits("https://www.etsy.com/l?click_key=605da0")).toEqual(["identifiant de session, de compte ou de clic dans un lien"]);
    // Jeton opaque sous un autre nom de paramètre (constaté le 2026-10-25) ; un numéro de variante reste.
    const opaque = reponseDeTest({ visual_matches: [{ position: 1, title: "T-shirt", link: "https://www.etsy.com/listing/1/t-shirt?content_source=0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d%3AAB12&variant=43643024900184", source: "Etsy" }] })!;
    expect((opaque.visual_matches as { link: string }[])[0]!.link).toBe("https://www.etsy.com/produit-1?content_source=id-1&variant=43643024900184");
    expect(contenusInterdits("https://x.fr/a?content_source=0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d")).toEqual(["jeton opaque dans un lien"]);
    expect(contenusInterdits("https://x.fr/a?variant=43643024900184&size=XXL")).toEqual([]);
    expect(contenusInterdits("https://x.fr/a?colour=chocolate&variant=42&country=CH&currency=CHF")).toEqual([]);
  });

  it("domaines : sites connus et réseaux sociaux gardés ; sites peu connus fictifs, sous-domaine et extension gardés ; même site sur deux extensions, même nom ; le site d'un titre suit", () => {
    const brut = {
      visual_matches: [
        { position: 1, title: "Maillot - PETITEBOUTIQUE-EXEMPLE.BE", link: "https://www.petiteboutique-exemple.be/maillot", source: "A" },
        { position: 2, title: "Maillot", link: "https://maillots-exemple.com/maillot", source: "B" },
        { position: 3, title: "Maillot", link: "https://maillots-exemple.fr/maillot", source: "B" },
        { position: 4, title: "Veste", link: "https://fr.friperie-exemple.co.uk/veste", source: "C" },
        { position: 5, title: "Veste - ZALANDO.FR", link: "https://www.zalando.fr/veste", source: "Zalando" },
        { position: 6, title: "Veste", link: "https://www2.hm.com/fr_fr/veste", source: "H&M" },
        { position: 7, title: "Vente en gros", link: "https://www.faire.com/veste", source: "Faire" },
        { position: 8, title: "Mon blog", link: "https://monblog.example-perso.net/article", source: "Blog" },
      ],
    };
    const test = reponseDeTest(brut)!.visual_matches as { title: string; link: string }[];
    expect(test.map((m) => new URL(m.link).host)).toEqual(["www.site-1.be", "site-2.com", "site-2.fr", "fr.site-3.co.uk", "www.zalando.fr", "www2.hm.com", "www.faire.com", "monblog.site-4.net"]);
    expect(test[0]!.title).toBe("Produit 1 - SITE-1.BE");
    expect(test[4]!.title).toBe("Produit 2 - ZALANDO.FR");
    expect(JSON.stringify(test)).not.toMatch(/petiteboutique|maillots-exemple|friperie|example-perso/i);
    // Le filtre des doublons et l'exclusion de la vente aux professionnels gardent la même décision.
    const garder = (liste: { title: string; link: string }[]) => withoutDuplicates(liste, "fr").map((m) => liste.indexOf(m));
    expect(garder(test)).toEqual(garder(brut.visual_matches));
    expect(test.map((m) => exclusionReason(m.link))).toEqual(brut.visual_matches.map((m) => exclusionReason(m.link)));
  });

  it("aperçu dans le Terminal : le site et le prix, jamais le titre ni le marchand", () => {
    expect(apercu({ merchantUrl: "https://www.zalando.fr/produit-1", priceValue: 39.99, currency: "EUR" })).toBe("zalando.fr (39.99 EUR)");
    expect(apercu({ merchantUrl: "https://shop.site-6.fr/produit-2", priceValue: 25, currency: null })).toBe("shop.site-6.fr (25)");
    expect(apercu({ merchantUrl: "https://www.instagram.com/compte-anonyme/1", priceValue: null, currency: null })).toBe("instagram.com");
    expect(apercu({ merchantUrl: "pas une adresse", priceValue: null, currency: null })).toBe("site illisible");
  });

  it("le résultat ne contient plus rien à protéger, alors que la réponse brute en contenait", () => {
    expect(contenusInterdits(JSON.stringify(BRUT))).toEqual(["clé d'API", "adresse d'image temporaire de notre serveur", "lien de recherche de SerpApi (il contient l'adresse de l'image)", "jeton opaque dans un lien"]);
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
