// Outil de la série de mesure (décisions du fondateur, 2026-10-24) : plan,
// garde-fous, mesures et relevé. Aucun appel réseau : tout est simulé.
import { afterEach, describe, expect, it } from "vitest";
import { contenusInterdits } from "../scripts/lib/essai-type.js";
import { brancherSerpApi, sansCache, statutDe } from "../scripts/lib/serie-appels.js";
import {
  appelsDuJour, arretDemande, attenteHoraireMinutes, compteurConcorde, decisionReprise, etapeSuivante, jourParis, lireOptions, RELEVE_SERIE, rechercheesAutorisees, reserveSuffisante, servicesDuLot, servicesOperationnels,
  type Compteur, type LigneSerie,
} from "../scripts/lib/serie-garde-fous.js";
import { lireDetections } from "../scripts/lib/serie-images.js";
import { ajoutsRegleDesPrix, mesurerBoutiques, mesurerLens, mesurerShopping, motsSignificatifs, partCommune, pertinenceDouteuse } from "../scripts/lib/serie-mesures.js";
import { etiquette } from "../scripts/lib/serie-planche.js";
import { AUTORISATION_SERIE, PHRASE_SERIE, piecesDeSerie, planSerie, titreEtape, type EtapeSerie } from "../scripts/lib/serie-plan.js";
import type { SerpApiVisualMatch } from "../src/services/visualSearch.js";

const PLAN = planSerie();

function ligne(numero: number, issue: LigneSerie["issue"], options: Partial<LigneSerie> = {}): LigneSerie {
  const etape = PLAN.find((e) => e.numero === numero) as EtapeSerie;
  return { numero, lot: etape.lot, piece: etape.piece, service: etape.service, lanceeLe: "2026-10-25T10:00:00.000Z", issue, code: 200, statutSerpApi: "Success", facturee: issue === "reussie" || issue === "vide" ? "oui" : "non", secondes: 3, mesures: null, message: null, ...options };
}

const compteur = (utilisees: number, restantes = 250 - utilisees): Compteur => ({ utilisees, restantes, lueLe: "2026-10-25T09:00:00.000Z" });

describe("plan de la série", () => {
  it("46 recherches : le lot 10 en premier, puis les lots 2, 3, 9, 11 et 7", () => {
    expect(PLAN).toHaveLength(46);
    expect(AUTORISATION_SERIE).toBe(46);
    expect(PLAN.map((e) => e.numero)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
    const tailles = [10, 2, 3, 9, 11, 7].map((lot) => PLAN.filter((e) => e.lot === lot).length);
    expect(tailles).toEqual([9, 6, 10, 8, 5, 8]);
    const ordre = PLAN.map((e) => e.lot).filter((lot, i, tous) => tous.indexOf(lot) === i);
    expect(ordre).toEqual([10, 2, 3, 9, 11, 7]);
  });

  it("planches aux lots 2 et 3 seulement ; lot 9 sans cache ; lot 7 en Suisse et au Royaume-Uni", () => {
    const lens = PLAN.filter((e): e is Extract<EtapeSerie, { service: "lens" }> => e.service === "lens");
    expect(lens.filter((e) => e.planche).every((e) => e.lot === 2 || e.lot === 3)).toBe(true);
    expect(lens.filter((e) => e.lot === 2 || e.lot === 3).every((e) => e.planche)).toBe(true);
    expect(lens.filter((e) => e.lot === 9).every((e) => e.sansCache)).toBe(true);
    expect(lens.filter((e) => e.lot !== 9).some((e) => e.sansCache)).toBe(false);
    expect(new Set(lens.filter((e) => e.lot === 7).map((e) => `${e.locale.country}/${e.locale.hl}`))).toEqual(new Set(["ch/fr", "gb/en"]));
    expect(lens.filter((e) => e.lot === 3).every((e) => e.texte)).toBe(true);
  });

  it("lot 10 : le produit est demandé aux deux API juste après sa recherche, puis les 3 autres pièces", () => {
    const lot10 = PLAN.filter((e) => e.lot === 10).map((e) => `${e.service}:${e.piece}`);
    expect(lot10).toEqual([
      "shopping:maillot-nike", "immersive:maillot-nike", "product:maillot-nike",
      "shopping:veste-bleu-marine", "immersive:veste-bleu-marine", "product:veste-bleu-marine",
      "shopping:tshirt-blanc", "shopping:pull-blanc", "shopping:pull-noir",
    ]);
  });

  it("phrase exacte et titres sans adresse", () => {
    expect(PHRASE_SERIE).toBe("OK série sans nouvelles photos : lots 2, 3, 7, 9, 10 et 11, 46 recherches au plus");
    expect(PLAN.map(titreEtape).some((t) => /https?:/.test(t))).toBe(false);
  });

  it("pièces : les 5 de la série, refus si l'une manque", () => {
    const zone = { x: 0, y: 0.5, width: 1, height: 0.4 };
    const piece = (nom: string) => ({ nom, texte: "mots", zone, video: "/v.mov", seconde: 1 });
    const cinq = ["maillot-nike", "veste-bleu-marine", "tshirt-blanc", "pull-blanc", "pull-noir"].map(piece);
    expect(piecesDeSerie(cinq).size).toBe(5);
    expect(() => piecesDeSerie(cinq.slice(1))).toThrow(/maillot-nike/);
  });
});

describe("garde-fous", () => {
  it("jour de Paris, heure d'été puis d'hiver (25 octobre)", () => {
    expect(jourParis(new Date("2026-10-24T21:59:59Z"))).toBe("2026-10-24");
    expect(jourParis(new Date("2026-10-24T22:00:00Z"))).toBe("2026-10-25");
    expect(jourParis(new Date("2026-10-25T22:59:59Z"))).toBe("2026-10-25");
    expect(jourParis(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  });

  it("plafond par jour : appels partis ce jour-là seulement", () => {
    const lignes = [ligne(1, "reussie"), ligne(2, "interrompue_non_facturee"), ligne(3, "reussie", { lanceeLe: "2026-10-26T10:00:00.000Z" }), ligne(40, "non_lancee")];
    expect(appelsDuJour(lignes, "2026-10-25")).toBe(1);
    expect(appelsDuJour(lignes, "2026-10-26")).toBe(1);
  });

  it("limite horaire de SerpApi (50 par heure glissante) : attente en minutes", () => {
    const debut = new Date("2026-10-24T17:56:00.000Z").getTime();
    const trente = Array.from({ length: 30 }, (_, i) => ligne(i + 1, "reussie", { lanceeLe: new Date(debut + i * 5000).toISOString() }));
    expect(attenteHoraireMinutes(trente, new Date("2026-10-24T18:43:00.000Z"))).toBe(0);
    const cinquante = Array.from({ length: 50 }, (_, i) => ligne((i % 46) + 1, "reussie", { lanceeLe: new Date(debut + i * 60_000).toISOString() }));
    // La plus ancienne (17:56) sort de l'heure à 18:56 : à 18:50, il faut attendre 6 minutes.
    expect(attenteHoraireMinutes(cinquante, new Date("2026-10-24T18:50:00.000Z"))).toBe(6);
    expect(attenteHoraireMinutes(cinquante, new Date("2026-10-24T18:57:00.000Z"))).toBe(0);
  });

  it("options : le plafond du jour ne se lève qu'avec --confirmer, et rien d'inconnu", () => {
    expect(lireOptions([])).toEqual({ mode: "etat" });
    expect(lireOptions(["--nouvelle-reference"])).toEqual({ mode: "reference" });
    expect(lireOptions(["--confirmer"])).toEqual({ mode: "lancer", plafondJourLeve: false });
    expect(lireOptions(["--confirmer", "--plafond-jour-leve"])).toEqual({ mode: "lancer", plafondJourLeve: true });
    expect(() => lireOptions(["--plafond-jour-leve"])).toThrow();
    expect(() => lireOptions(["--confirmer", "--nouvelle-reference"])).toThrow();
    expect(() => lireOptions(["--confirmer", "--confirmer"])).toThrow();
    expect(() => lireOptions(["--confirme"])).toThrow();
  });

  it("autorisation : les recherches non facturées ne comptent pas", () => {
    expect(rechercheesAutorisees([ligne(1, "reussie"), ligne(2, "erreur", { facturee: "non", code: 400 }), ligne(3, "panne", { facturee: "inconnu", code: null })])).toBe(2);
  });

  it("étape suivante : saute les étapes faites, refait une étape interrompue non facturée", () => {
    expect(etapeSuivante(PLAN, [])?.numero).toBe(1);
    expect(etapeSuivante(PLAN, [ligne(1, "reussie"), ligne(2, "vide")])?.numero).toBe(3);
    expect(etapeSuivante(PLAN, [ligne(1, "interrompue_non_facturee")])?.numero).toBe(1);
    expect(etapeSuivante(PLAN, [ligne(1, "interrompue_facturee")])?.numero).toBe(2);
    expect(etapeSuivante(PLAN, PLAN.map((e) => ligne(e.numero, "reussie")))).toBeNull();
  });

  it("arrêts : appel en cours, première panne, 3 vides de suite, autorisation épuisée", () => {
    expect(arretDemande([ligne(1, "en_cours")])?.raison).toBe("en_cours");
    expect(arretDemande([ligne(1, "reussie"), ligne(2, "panne")])?.raison).toBe("panne");
    expect(arretDemande([ligne(1, "erreur", { code: 503 })])?.raison).toBe("panne");
    expect(arretDemande([ligne(1, "vide"), ligne(2, "vide"), ligne(3, "vide")])?.raison).toBe("vides");
    expect(arretDemande([ligne(1, "vide"), ligne(2, "reussie"), ligne(3, "vide"), ligne(4, "vide")])).toBeNull();
    expect(arretDemande(PLAN.map((e) => ligne(e.numero, "reussie")))?.raison).toBe("autorisation");
  });

  it("reprise : le compteur dit si l'appel interrompu a été facturé", () => {
    const lignes = [ligne(1, "reussie"), ligne(2, "reussie"), ligne(3, "en_cours", { facturee: "inconnu" })];
    expect(decisionReprise(compteur(21), compteur(23), lignes)).toBe("non_facturee");
    expect(decisionReprise(compteur(21), compteur(24), lignes)).toBe("facturee");
    expect(decisionReprise(compteur(21), compteur(26), lignes)).toBe("ecart");
  });

  it("compteur, réserve et page d'état", () => {
    expect(compteurConcorde(compteur(21), compteur(23), [ligne(1, "reussie"), ligne(2, "reussie")])).toBe(true);
    expect(compteurConcorde(compteur(21), compteur(24), [ligne(1, "reussie"), ligne(2, "reussie")])).toBe(false);
    expect(reserveSuffisante(compteur(200, 40), 10)).toBe(true);
    expect(reserveSuffisante(compteur(200, 39), 10)).toBe(false);
    expect(servicesDuLot(10)).toEqual(["Shopping Light API", "Immersive Product API"]);
    expect(servicesDuLot(2)).toEqual(["Lens API"]);
    expect(servicesOperationnels({ "Lens API": "operational" }, ["Lens API"])).toBe(true);
    expect(servicesOperationnels({ "Lens API": "degraded_performance" }, ["Lens API"])).toBe(false);
    expect(servicesOperationnels({ "Lens API": null }, ["Lens API"])).toBe(false);
  });

  it("relevé : refuse un titre trop long ou un message trop long", () => {
    const releve = { phrase: PHRASE_SERIE, reference: compteur(21), lignes: [ligne(1, "reussie", { mesures: { recues: 60, domainesGardes: ["asos.com"] } })], lots: [] };
    expect(RELEVE_SERIE.safeParse(releve).success).toBe(true);
    const titre = "Veste en daim marron coupe droite boutons dorés col cranté doublure satinée taille M neuve";
    expect(RELEVE_SERIE.safeParse({ ...releve, lignes: [ligne(1, "reussie", { mesures: { titre } })] }).success).toBe(false);
    expect(RELEVE_SERIE.safeParse({ ...releve, lignes: [ligne(1, "reussie", { message: "x".repeat(161) })] }).success).toBe(false);
  });
});

const match = (position: number, options: Partial<SerpApiVisualMatch> = {}): SerpApiVisualMatch => ({
  position, title: `Article ${position}`, link: `https://boutique${position}.fr/article`, source: `Boutique ${position}`, thumbnail: `https://exemple.invalid/v${position}.jpg`, ...options,
});
const prix = (valeur: number, devise = "€") => ({ value: `${valeur} ${devise}`, extracted_value: valeur, currency: devise });

describe("mesures", () => {
  it("règle des prix : au-delà des 30, avec un prix, 10 au plus, sans réseau social", () => {
    const matches = [
      ...Array.from({ length: 30 }, (_, i) => match(i + 1, i === 0 ? { price: prix(10) } : {})),
      match(31, { link: "https://www.instagram.com/p/abc", price: prix(5) }),
      ...Array.from({ length: 14 }, (_, i) => match(32 + i, i % 2 === 0 ? { price: prix(20 + i) } : {})),
    ];
    const ajouts = ajoutsRegleDesPrix(matches, "fr");
    expect(ajouts.map((a) => a.rang)).toEqual([32, 34, 36, 38, 40, 42, 44]);
    expect(ajouts[0]).toMatchObject({ domaine: "boutique32.fr", devise: "€" });
    const beaucoup = [...Array.from({ length: 30 }, (_, i) => match(i + 1)), ...Array.from({ length: 15 }, (_, i) => match(31 + i, { price: prix(9) }))];
    expect(ajoutsRegleDesPrix(beaucoup, "fr")).toHaveLength(10);
  });

  it("Google Lens : mesure du serveur, domaines gardés et ajouts", () => {
    const matches = Array.from({ length: 35 }, (_, i) => match(i + 1, i === 33 ? { price: prix(42) } : {}));
    const { mesure, domainesGardes, ajouts } = mesurerLens({ matches, received: 35, sections: ["visual_matches"], googleState: null }, "fr");
    expect(mesure.kept).toBe(30);
    expect(mesure.received).toBe(35);
    expect(domainesGardes).toHaveLength(30);
    expect(ajouts.map((a) => a.rang)).toEqual([34]);
  });

  it("Google Shopping Light : nombres seulement, pertinence et produit choisi en mémoire", () => {
    const json = {
      search_metadata: { status: "Success" },
      shopping_results: [
        { title: "Pull noir col rond laine", source: "Zalando", price: "39,99 €", extracted_price: 39.99, product_id: "123", immersive_product_page_token: "jeton" },
        { title: "Pull noir homme", source: "Zalando", price: "25,00 €", extracted_price: 25 },
        { title: "Lampe de bureau", source: "Ikea", price: "$15.00", extracted_price: 15 },
      ],
    };
    const mesure = mesurerShopping(json, "pull noir");
    expect(mesure?.mesures).toEqual({ resultats: 3, avecPrix: 3, enEuros: 2, marchandsDistincts: 2, pertinents: 2 });
    expect(mesure?.produit).toEqual({ productId: "123", pageToken: "jeton" });
    expect(JSON.stringify(mesure?.mesures)).not.toMatch(/Pull|Zalando/);
    expect(pertinenceDouteuse({ resultats: 10, pertinents: 4 })).toBe(true);
    expect(pertinenceDouteuse({ resultats: 10, pertinents: 5 })).toBe(false);
    expect(mesurerShopping("illisible", "pull")).toBeNull();
    expect(motsSignificatifs("T-shirt Nike noir, côte")).toEqual(["shirt", "nike", "noir", "cote"]);
  });

  it("boutiques : liens directs, domaines français, euros, communs avec Google Lens", () => {
    const json = {
      product_results: {
        stores: [
          { name: "A", link: "https://www.zalando.fr/x", price: "39,99 €", extracted_price: 39.99 },
          { name: "B", link: "https://www.google.com/aclk?x", price: "41,00 €" },
          { name: "C", link: "https://shop.example.eu/y", price: "$50" },
        ],
      },
    };
    const mesure = mesurerBoutiques(json, ["zalando.fr", "asos.com"]);
    expect(mesure?.mesures).toMatchObject({ boutiques: 3, liensDirects: 2, domainesFrEu: 2, prixEnEuros: 2, communsAvecLens: 1, domaines: ["zalando.fr", "shop.example.eu"] });
    expect(mesure?.liens).toHaveLength(3);
    expect(mesurerBoutiques({ stores: [] }, [])?.mesures.boutiques).toBe(0);
    // Lot 10 en premier : Google Lens pas encore mesuré, la comparaison attend le rapport.
    expect(mesurerBoutiques(json, null)?.mesures.communsAvecLens).toBeNull();
  });

  it("répétabilité : part de domaines communs", () => {
    expect(partCommune(["a.fr", "b.fr"], ["a.fr", "c.fr"])).toBeCloseTo(1 / 3);
    expect(partCommune([], [])).toBe(1);
  });
});

describe("appels, images et planches (simulés)", () => {
  const fetchOrigine = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOrigine;
  });

  it("no_cache ajouté à la seule recherche suivante, et réinitialisation", async () => {
    const adresses: string[] = [];
    globalThis.fetch = async (entree: Parameters<typeof fetch>[0]) => {
      adresses.push(String(entree));
      return new Response(JSON.stringify({ search_metadata: { status: "Success" } }), { status: 200 });
    };
    const branchement = brancherSerpApi();
    branchement.sansCacheAuProchain();
    await fetch("https://serpapi.com/search?engine=google_lens&url=x");
    await fetch("https://serpapi.com/search?engine=google_lens&url=y");
    expect(adresses[0]).toContain("no_cache=true");
    expect(adresses[1]).not.toContain("no_cache");
    expect(branchement.derniere()).toMatchObject({ code: 200, statut: "Success" });
    branchement.reinitialiser();
    expect(branchement.derniere().code).toBeNull();
  });

  it("statut de SerpApi et adresse sans cache", () => {
    expect(statutDe({ search_metadata: { status: "Error" } })).toBe("Error");
    expect(statutDe(null)).toBeNull();
    expect(sansCache("https://serpapi.com/search?engine=google_lens")).toBe("https://serpapi.com/search?engine=google_lens&no_cache=true");
  });

  it("détections : une ligne absente ou illisible compte comme un visage (prudence)", () => {
    expect(lireDetections("0 0 1\n1 2 2\n", 3)).toEqual([{ visages: 0, personnes: 1 }, { visages: 2, personnes: 2 }, { visages: 1, personnes: 1 }]);
    expect(lireDetections("0 erreur erreur", 1)).toEqual([{ visages: 1, personnes: 1 }]);
  });

  it("étiquette de planche : rang, domaine, devise, sans titre", () => {
    expect(etiquette({ rang: 42, domaine: "asos.com", devise: "€" })).toBe("rang 42 · asos.com · €");
  });

  it("un relevé type ne contient ni adresse, ni clé, ni e-mail", () => {
    const texte = JSON.stringify({ phrase: PHRASE_SERIE, lignes: [ligne(1, "reussie", { mesures: { recues: 60, domainesGardes: ["asos.com", "zalando.fr"], ajouts: [{ rang: 42, domaine: "asos.com", devise: "€" }] } })] });
    expect(contenusInterdits(texte)).toEqual([]);
    expect(/https?:\/\//.test(texte)).toBe(false);
  });
});
