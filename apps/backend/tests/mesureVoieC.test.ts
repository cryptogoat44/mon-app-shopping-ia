import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { CAS_PAR_COMPTE, GardeBudget, lirePlafond, plafondsServeur, planMesure } from "../scripts/lib/mesure-voie-c/budget.js";
import {
  CLE_SERPAPI_A_BLANC,
  emplacementsParDefaut,
  environnementEffectif,
  environnementServeur,
  lireOptions,
  masquerSecrets,
  secretsDe,
  verifierHorsDuDepot,
  verifierSpottoDev2,
  type OptionsMesure,
} from "../scripts/lib/mesure-voie-c/environnement.js";
import { cadreEnProportions, chargerJeu, ecartsCadres, lireCadres, lireReponses, motsDeLApp, type JeuCharge } from "../scripts/lib/mesure-voie-c/jeu-de-verite.js";
import { jugeDuCas, jugerListe, lireJugementsFondateur, motsImportants, normaliser, paliers, semblePiece, type EtatJugements } from "../scripts/lib/mesure-voie-c/jugement.js";
import { lancerMesure, refaireRapport, type CompteEssai, type EntreeMesure, type PortsMesure, type ServeurLocal } from "../scripts/lib/mesure-voie-c/mesure.js";
import { construireRapport, mediane, secondes } from "../scripts/lib/mesure-voie-c/rapport.js";
import { portsReels } from "../scripts/lib/mesure-voie-c/reel.js";
import {
  creditsDuCas,
  lireLigneJournal,
  lireReponse,
  resumerJournal,
  type LigneJournal,
  type LigneRecherche,
  type MetaMesure,
  type ResultatCas,
} from "../scripts/lib/mesure-voie-c/resultats.js";

// Mesure de la voie C (outil du fondateur, novembre 2026) : tout est vérifié
// ici SANS réseau — faux ports à la place du serveur, de spotto-dev-2, de
// SerpApi et d'Anthropic. Données de marques et de modèles inventées.

const REPONSES = [
  "cas01.png;Maison Exemple;Veste Alpha (bleue);;2;la veste;oui;veste bleue;;oui;",
  "cas02.png;;Pull torsadé Beta;;1;le pull;non;pull torsadé crème;;non;",
  "cas03.png;Marque Zeta;Sac Gamma;;3;le sac;oui;sac noir;;non;",
].join("\n");

const CADRES = "1 ; 27 28 73 53 ; la veste\n\n3 ; 80 10 40 30 ; le sac (la ceinture reste hors du cadre)\n";

const ENV_FACTICE = { SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_ANON_KEY: "x", SERPAPI_KEY: "x" };
const ENV_DEV = {
  SUPABASE_URL: "https://sedfepcpmhilaxbrgdif.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "cle-de-service-tres-secrete",
  SUPABASE_ANON_KEY: "cle-anonyme-publique-0001",
  SERPAPI_KEY: "cle-serpapi-tres-secrete",
  SENTRY_DSN: "https://abc@o1.ingest.de.sentry.io/2",
  ANTHROPIC_PHOTO_ENABLED: "true",
  NODE_ENV: "test",
};

function jeuFait(): JeuCharge {
  const cas = lireReponses(REPONSES);
  const cadres = lireCadres(CADRES, "cadres-traces.txt");
  return { dossier: "/jeu", cas, cadres, cheminCadres: "/jeu/cadres-traces.txt", avertissements: ecartsCadres(cas, cadres) };
}

describe("jeu de vérité et cadres", () => {
  it("lit les 11 champs ; le numéro du cas est le rang de la ligne ; oui/non lus", () => {
    const cas = lireReponses(`﻿${REPONSES.replace(/\n/g, "\r\n")}\r\n\r\n`);
    expect(cas).toHaveLength(3);
    expect(cas[0]).toMatchObject({ numero: 1, fichier: "cas01.png", marque: "Maison Exemple", modele: "Veste Alpha (bleue)", cadre: true, mots: "veste bleue", marqueVisible: true });
    expect(cas[1]).toMatchObject({ numero: 2, marque: "", cadre: false, marqueVisible: false });
    expect(lireReponses(";Marque;Modèle;;1;x;non;mots;;non;")[0]!.fichier).toBe("cas01.png");
  });

  it("refuse une ligne mal formée, avec son numéro", () => {
    expect(() => lireReponses("cas01.png;Marque;Modèle;;1;x;oui;mots;;oui")).toThrow(/ligne 1 : 10 champ\(s\) au lieu de 11/);
    expect(() => lireReponses(`${REPONSES.split("\n")[0]}\n\n${REPONSES.split("\n")[1]}`)).toThrow(/ligne 2 vide/);
    expect(() => lireReponses("cas01.png;M;Mo;;1;x;peut-être;mots;;oui;")).toThrow(/ligne 1 : « cadre » doit valoir oui ou non/);
    expect(() => lireReponses("../cas01.png;M;Mo;;1;x;oui;mots;;oui;")).toThrow(/simple nom/);
    expect(() => lireReponses("\n\n")).toThrow(/vide/);
  });

  it("cadres : pourcentages → proportions, bornées à l'image", () => {
    const cadres = lireCadres(CADRES, "cadres-traces.txt");
    expect([...cadres.keys()]).toEqual([1, 3]);
    expect(cadres.get(3)!.rappel).toBe("le sac (la ceinture reste hors du cadre)");
    const veste = cadreEnProportions(cadres.get(1)!);
    expect(veste.x).toBeCloseTo(0.27);
    expect(veste.width).toBeCloseTo(0.73);
    expect(veste.x + veste.width).toBeLessThanOrEqual(1.001);
    // 80 + 40 dépasse l'image : la largeur est ramenée à 20 %.
    expect(cadreEnProportions(cadres.get(3)!)).toMatchObject({ x: 0.8, y: 0.1 });
    expect(cadreEnProportions(cadres.get(3)!).width).toBeCloseTo(0.2);
    expect(lireCadres("2 ; 10,5 20 30 40 ; virgule acceptée", "c").get(2)!.gauche).toBe(10.5);
  });

  it("cadres : une ligne mal formée est refusée avec un message clair", () => {
    expect(() => lireCadres("1 ; 27 28 73 ; la veste", "cadres-traces.txt")).toThrow(/cadres-traces\.txt, ligne 1 : il faut quatre nombres/);
    expect(() => lireCadres("1 ; 27 28 73 53", "c")).toThrow(/trois champs/);
    expect(() => lireCadres("un ; 27 28 73 53 ; x", "c")).toThrow(/numéro de cas illisible/);
    expect(() => lireCadres("1 ; 27 28 173 53 ; x", "c")).toThrow(/de 0 à 100/);
    expect(() => lireCadres("1 ; 27 28 0 53 ; x", "c")).toThrow(/plus grandes que 0/);
    expect(() => lireCadres("1 ; 1 1 2 2 ; a\n1 ; 1 1 2 2 ; b", "c")).toThrow(/ligne 2 : deuxième cadre pour le cas 1/);
    expect(() => cadreEnProportions({ numero: 4, gauche: 98, haut: 10, largeur: 30, hauteur: 30, rappel: "" })).toThrow(/moins de 5 %/);
  });

  it("écarts entre la colonne « cadre » et les cadres tracés ; cadre d'un cas inconnu refusé", () => {
    const jeu = jeuFait();
    expect(jeu.avertissements).toEqual([]);
    const cas = lireReponses(REPONSES);
    expect(ecartsCadres(cas, lireCadres("2 ; 10 10 50 50 ; le pull", "c"))).toEqual([
      "cas 1 : le jeu dit « cadre : oui », mais aucun cadre n'est tracé : image entière.",
      "cas 2 : cadre tracé alors que le jeu dit « cadre : non » : le cadre est utilisé.",
      "cas 3 : le jeu dit « cadre : oui », mais aucun cadre n'est tracé : image entière.",
    ]);
    expect(() => ecartsCadres(cas, lireCadres("9 ; 10 10 50 50 ; x", "c"))).toThrow(/cas 9, absent du jeu de vérité/);
  });

  it("vos mots : comme le champ de l'app (sans espaces autour, 60 caractères au plus)", () => {
    expect(motsDeLApp("  veste bleue ")).toEqual({ mots: "veste bleue", tronques: false });
    expect(motsDeLApp("   ")).toEqual({ mots: null, tronques: false });
    const long = motsDeLApp("a".repeat(75));
    expect(long.mots).toHaveLength(60);
    expect(long.tronques).toBe(true);
  });

  it("chargement : chaque photo doit être là, et le fichier des cadres aussi", () => {
    const dossier = mkdtempSync(join(tmpdir(), "mesure-voie-c-jeu-"));
    try {
      writeFileSync(join(dossier, "reponses.txt"), REPONSES);
      writeFileSync(join(dossier, "cadres.txt"), CADRES);
      writeFileSync(join(dossier, "cas01.png"), "x");
      expect(() => chargerJeu(dossier, join(dossier, "cadres.txt"))).toThrow(/cas02\.png \(cas 2\), cas03\.png \(cas 3\)/);
      writeFileSync(join(dossier, "cas02.png"), "x");
      writeFileSync(join(dossier, "cas03.png"), "x");
      expect(() => chargerJeu(dossier, join(dossier, "absent.txt"))).toThrow(/Fichier des cadres introuvable/);
      expect(chargerJeu(dossier, join(dossier, "cadres.txt")).cas).toHaveLength(3);
      expect(() => chargerJeu(join(dossier, "ailleurs"), join(dossier, "cadres.txt"))).toThrow(/Jeu de vérité introuvable/);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

describe("garde du budget", () => {
  it("plan : 2 crédits SerpApi et 1 appel d'IA au plus par cas ; plafond strict ; 8 cas par compte", () => {
    const plan = planMesure(25, { lesDeux: false, plafond: 60 });
    expect(plan).toMatchObject({ creditsPremierePasse: 50, creditsAuPlus: 50, appelsIaAuPlus: 25, comptes: 4, casCoupesParLePlafond: 0, passes: 1 });
    const lesDeux = planMesure(25, { lesDeux: true, plafond: 60 });
    expect(lesDeux).toMatchObject({ creditsAuPlus: 60, creditsSecondePasseAuPire: 50, comptes: 8, passes: 2 });
    expect(planMesure(25, { lesDeux: false, plafond: 30 }).casCoupesParLePlafond).toBe(10);
    expect(CAS_PAR_COMPTE).toBeLessThan(10);
  });

  it("un cas ne part que s'il tient, au pire, dans le plafond ; au-delà, arrêt net", () => {
    const garde = new GardeBudget(5);
    let lances = 0;
    while (garde.peutLancer()) {
      garde.compter(2);
      lances += 1;
    }
    expect(lances).toBe(2);
    expect(garde.depenses).toBe(4);
    expect(() => garde.compter(2)).toThrow(/Arrêt net : 6 crédits/);
  });

  it("plafonds du serveur local : déjà comptés + budget, rien de plus", () => {
    expect(plafondsServeur({ jour: 7, mois: 120 }, 50)).toEqual({ SERPAPI_DAILY_CAP: "57", SERPAPI_MONTHLY_CAP: "170", SERPAPI_USER_DAILY_CAP: String(CAS_PAR_COMPTE) });
  });

  it("options : plafond borné, option inconnue refusée, emplacements par défaut", () => {
    expect(lirePlafond("12")).toBe(12);
    for (const faux of ["1", "abc", "500", "6.5", undefined]) expect(() => lirePlafond(faux)).toThrow(/--plafond-credits/);
    const options = lireOptions([], "/Users/fondateur", "/tmp");
    expect(options).toMatchObject({ confirmer: false, plafond: 60, mots: "avec", refaireRapport: null, ...emplacementsParDefaut("/Users/fondateur") });
    expect(options.jeu).toBe("/Users/fondateur/Downloads/spotto-jeu-de-verite");
    expect(options.sortie).toBe("/Users/fondateur/Downloads/spotto-mesure-voie-c");
    expect(options.cadres).toBe("/Users/fondateur/Desktop/Spotto/mon-app-shopping-ia/docs/banc-jeu-de-verite/cadres-traces.txt");
    expect(lireOptions(["--confirmer", "--les-deux", "--plafond-credits", "40", "--jeu", "jeu"], "/m", "/ici")).toMatchObject({ confirmer: true, mots: "les-deux", plafond: 40, jeu: "/ici/jeu" });
    expect(lireOptions(["--sans-mots"], "/m", "/").mots).toBe("sans");
    expect(() => lireOptions(["--confirmmer"], "/m", "/")).toThrow(/Option inconnue : --confirmmer/);
    expect(() => lireOptions(["--sans-mots", "--les-deux"], "/m", "/")).toThrow(/s'excluent/);
    expect(() => lireOptions(["--sortie"], "/m", "/")).toThrow(/attend une valeur/);
  });

  it("les sorties restent hors du dépôt Git", () => {
    expect(() => verifierHorsDuDepot("/depot/apps/backend/sorties", "/depot")).toThrow(/dans le dépôt Git/);
    expect(() => verifierHorsDuDepot("/depot", "/depot")).toThrow(/dans le dépôt Git/);
    expect(() => verifierHorsDuDepot("/Users/fondateur/Downloads/spotto-mesure-voie-c", "/depot")).not.toThrow();
  });
});

describe("refus si la base n'est pas spotto-dev-2", () => {
  it("variables factices, production, base d'une autre adresse, clé manquante : refus net", () => {
    expect(() => verifierSpottoDev2(ENV_FACTICE)).toThrow(/ne désigne pas spotto-dev-2/);
    expect(() => verifierSpottoDev2({ ...ENV_DEV, SUPABASE_URL: "https://selhqdqfrflsqivgxypf.supabase.co" })).toThrow(/PRODUCTION/);
    expect(() => verifierSpottoDev2({ ...ENV_DEV, SUPABASE_URL: undefined })).toThrow(/absente/);
    expect(() => verifierSpottoDev2({ ...ENV_DEV, DEV_DATABASE_URL: "postgresql://postgres:mdp@db.selhqdqfrflsqivgxypf.supabase.co:5432/postgres" })).toThrow(/PRODUCTION/);
    expect(() => verifierSpottoDev2({ ...ENV_DEV, SERPAPI_KEY: "" })).toThrow(/SERPAPI_KEY manque/);
    expect(verifierSpottoDev2(ENV_DEV).hostname).toBe("sedfepcpmhilaxbrgdif.supabase.co");
  });

  it("la mesure s'arrête avant tout : ni jeu lu, ni page d'état, ni serveur", async () => {
    const faux = fauxPorts();
    const chargerJeuEspion = vi.fn(jeuFait);
    await expect(lancerMesure(entreeFaite({ environnement: ENV_FACTICE, chargerJeu: chargerJeuEspion, options: { confirmer: true } }), faux.ports)).rejects.toThrow(/ne désigne pas spotto-dev-2/);
    expect(chargerJeuEspion).not.toHaveBeenCalled();
    expect(faux.appels).toEqual([]);
  });

  it("l'environnement effectif : apps/backend/.env, et par-dessus le Terminal (comme le serveur)", () => {
    const effectif = environnementEffectif("SUPABASE_URL=https://sedfepcpmhilaxbrgdif.supabase.co\nSERPAPI_KEY=du-fichier\n", { SERPAPI_KEY: "du-terminal", AUTRE: undefined });
    expect(effectif).toEqual({ SUPABASE_URL: "https://sedfepcpmhilaxbrgdif.supabase.co", SERPAPI_KEY: "du-terminal" });
  });

  it("serveur local : voie C et IA allumées, Sentry, photo et NODE_ENV retirés, plafonds, .env non relu", () => {
    const env = environnementServeur(ENV_DEV, { port: 4321, cleAnthropic: "sk-ant-essai-secrete", cleSerpApi: null, plafonds: { SERPAPI_DAILY_CAP: "57" }, envAbsent: "/tmp/absent" });
    expect(env).toMatchObject({ PORT: "4321", VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-essai-secrete", SERPAPI_KEY: ENV_DEV.SERPAPI_KEY, SERPAPI_DAILY_CAP: "57", DOTENV_CONFIG_PATH: "/tmp/absent" });
    for (const retiree of ["SENTRY_DSN", "ANTHROPIC_PHOTO_ENABLED", "NODE_ENV"]) expect(env).not.toHaveProperty(retiree);
    const aBlanc = environnementServeur({ ...ENV_DEV, ANTHROPIC_API_KEY: "venue-d-ailleurs" }, { port: 1, cleAnthropic: null, cleSerpApi: CLE_SERPAPI_A_BLANC, plafonds: {}, envAbsent: "/x" });
    expect(aBlanc.SERPAPI_KEY).toBe(CLE_SERPAPI_A_BLANC);
    expect(aBlanc).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("aucune clé affichée ni écrite : les secrets sont masqués, même encodés dans une adresse", () => {
    const secrets = secretsDe({ ...ENV_DEV, DEV_DATABASE_URL: "postgresql://postgres.sedfepcpmhilaxbrgdif:mot%2Fde%2Fpasse@hote:5432/postgres" });
    expect(secrets).toContain("mot/de/passe");
    const texte = `https://serpapi.com/search?api_key=${ENV_DEV.SERPAPI_KEY} et mot%2Fde%2Fpasse et ${ENV_DEV.SUPABASE_SERVICE_ROLE_KEY}`;
    const masque = masquerSecrets(texte, secrets);
    expect(masque).not.toContain(ENV_DEV.SERPAPI_KEY);
    expect(masque).not.toContain("mot%2Fde%2Fpasse");
    expect(masque).not.toContain(ENV_DEV.SUPABASE_SERVICE_ROLE_KEY);
    expect(masque).toContain("[masqué]");
  });
});

describe("jugement « bonne pièce » (règle du banc)", () => {
  it("normalise : minuscules, sans accents ni ponctuation", () => {
    expect(normaliser("Levi's — Jean 501® Délavé")).toBe("levis jean 501 delave");
    expect(normaliser("H&M T-Shirt")).toBe("hm tshirt");
    expect(motsImportants("Air Force 1 (blanc) Low")).toEqual(["air", "force", "low"]);
  });

  it("marque : la moitié de ses mots ; modèle : la moitié de ses mots importants", () => {
    const attendu = { marque: "Maison Exemple", modele: "Veste Alpha (bleue)" };
    expect(semblePiece("MAISON EXEMPLE veste Alpha en laine", attendu)).toBe(true);
    expect(semblePiece("Exemple — Alpha jacket", attendu)).toBe(true);
    expect(semblePiece("Veste Alpha en laine", attendu)).toBe(false);
    expect(semblePiece("Maison Exemple manteau Omega", attendu)).toBe(false);
  });

  it("un mot compte s'il commence pareil, ou par une traduction (noir ↔ black, pull ↔ sweater)", () => {
    expect(semblePiece("Zeta black leather bag", { marque: "Zeta", modele: "Sac noir" })).toBe(true);
    expect(semblePiece("Zeta jeans slim", { marque: "Zeta", modele: "Jean slim" })).toBe(true);
    expect(semblePiece("Zeta cable-knit sweater", { marque: "Zeta", modele: "Pull torsadé" })).toBe(true);
    expect(semblePiece("Zeta sacoche cuir", { marque: "Zeta", modele: "Sac cuir" })).toBe(true);
    expect(semblePiece("Zeta sacoche", { marque: "Zeta", modele: "Sac cuir" })).toBe(false);
  });

  it("sans marque : au moins 2 mots du modèle ; un modèle vide n'est jamais une bonne pièce", () => {
    expect(semblePiece("Pull torsadé beta crème", { marque: "", modele: "Pull torsadé Beta" })).toBe(true);
    expect(semblePiece("Pull en laine", { marque: "", modele: "Pull torsadé Beta" })).toBe(false);
    expect(semblePiece("Zeta", { marque: "Zeta", modele: "" })).toBe(false);
    expect(semblePiece("Zeta xl", { marque: "Zeta", modele: "XL" })).toBe(false);
  });

  it("place de la première bonne pièce, et paliers 1re / 3 premières / 10 premières / n'importe où", () => {
    const titres = ["Autre chose", "Zeta sac gamma noir", "Zeta Gamma", "Rien"];
    const liste = jugerListe(
      titres.map((titre, index) => ({ position: index + 1, titre, site: null, origine: "lens" as const })),
      (p) => semblePiece(p.titre, { marque: "Marque Zeta", modele: "Sac Gamma" })
    );
    expect(liste).toEqual({ premiere: 2, bonnes: [2, 3] });
    expect(paliers(2)).toEqual({ premiere: false, troisPremieres: true, dixPremieres: true, nimporteOu: true });
    expect(paliers(12)).toEqual({ premiere: false, troisPremieres: false, dixPremieres: false, nimporteOu: true });
    expect(paliers(null).nimporteOu).toBe(false);
  });

  it("le jugement du fondateur passe avant la règle ; sans avis, la règle décide", () => {
    const attendu = { marque: "Zeta", modele: "Sac Gamma" };
    const fondateur: EtatJugements = { etat: "lu", chemin: "jugements.txt", juge: (cas, p) => (cas === 3 && p.position === 1 ? true : p.position === 2 ? false : null) };
    const juge = jugeDuCas(3, attendu, fondateur);
    expect(juge({ position: 1, titre: "Rien à voir", site: null, origine: "lens" })).toBe(true);
    expect(juge({ position: 2, titre: "Zeta sac Gamma", site: null, origine: "lens" })).toBe(false);
    expect(juge({ position: 3, titre: "Zeta sac Gamma", site: null, origine: "lens" })).toBe(true);
    expect(jugeDuCas(3, attendu, { etat: "format-a-venir", chemin: "x" })({ position: 1, titre: "Rien", site: null, origine: "lens" })).toBe(false);
  });

  it("jugements.txt : absent aujourd'hui ; présent, son format reste à venir (point d'entrée)", () => {
    const dossier = mkdtempSync(join(tmpdir(), "mesure-voie-c-jugement-"));
    try {
      expect(lireJugementsFondateur(dossier)).toEqual({ etat: "absent" });
      writeFileSync(join(dossier, "jugements.txt"), "?");
      expect(lireJugementsFondateur(dossier)).toEqual({ etat: "format-a-venir", chemin: join(dossier, "jugements.txt") });
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

describe("relevés d'un cas : réponse, journal du serveur, crédits", () => {
  it("la réponse : Lens dans l'ordre affiché, puis les boutiques (origine « shopping »)", () => {
    const lue = lireReponse(reponseFaite(["Zeta sac Gamma", "Autre"], ["Zeta Gamma bag"]));
    expect(lue?.lens.map((p) => [p.position, p.titre, p.site, p.prix])).toEqual([
      [1, "Zeta sac Gamma", "boutique.example", 120],
      [2, "Autre", "boutique.example", null],
    ]);
    expect(lue?.boutiques.map((p) => [p.position, p.rang])).toEqual([[1, 3]]);
    expect(lue?.complement?.query).toBe("zeta gamma");
    expect(lireReponse({ pas: "une recherche" })).toBeNull();
  });

  it("le journal : seules les lignes de mesure, sans la machine ni la requête ; les erreurs, leur seul message", () => {
    const ligne = lireLigneJournal(JSON.stringify({ level: 30, time: 1, pid: 9, hostname: "mac-du-fondateur", reqId: "r1", msg: "Mesure complément", status: "shown", aiMs: 800 }));
    expect(ligne).toEqual({ msg: "Mesure complément", champs: { status: "shown", aiMs: 800 } });
    expect(lireLigneJournal(JSON.stringify({ level: 30, msg: "incoming request", req: { url: "/api/searches/x/run" } }))).toBeNull();
    expect(lireLigneJournal(JSON.stringify({ level: 50, msg: "Échec d'enregistrement", error: { message: "détail" } }))).toEqual({ msg: "erreur : Échec d'enregistrement", champs: {} });
    expect(lireLigneJournal("pas du JSON")).toBeNull();
    const journal = resumerJournal(journalFait({ rendue: true }));
    expect(journal).toMatchObject({ reservations: { search: 1, shopping: 1 }, placesRendues: 1, refusPlafond: 0 });
    expect(journal.complement).toMatchObject({ status: "shown" });
  });

  it("crédits : Lens appelé + Google Shopping ; cache, refus rendu ou lancement arrêté avant l'appel : 0 ; ligne illisible : le pire", () => {
    expect(creditsDuCas(ligneFaite(), resumerJournal(journalFait()))).toMatchObject({ lens: 1, shopping: 1, total: 2, selonJournal: 2, estime: false });
    expect(creditsDuCas(ligneFaite({ lens_from_cache: true, shopping_calls: 0 }), resumerJournal([]))).toMatchObject({ total: 0 });
    expect(creditsDuCas(ligneFaite({ failure_kind: "provider_refused", shopping_calls: 0 }), null)).toMatchObject({ lens: 0, total: 0 });
    expect(creditsDuCas(ligneFaite({ status: "pending", shopping_calls: 0 }), null).total).toBe(0);
    // Le journal compte davantage (place réservée non vue dans la ligne) : le plus grand est gardé.
    expect(creditsDuCas(ligneFaite({ shopping_calls: 0 }), resumerJournal(journalFait())).total).toBe(2);
    expect(creditsDuCas(null, null)).toMatchObject({ total: 2, estime: true });
  });
});

describe("rapport", () => {
  it("tableau par cas, totaux comparés au banc, durées, crédits ; les cadres à valider ; aucun secret", () => {
    const resultats = [
      resultatFait(1, { lens: ["Maison Exemple veste Alpha", "Autre"], boutiques: ["Exemple Alpha jacket"], dureeMs: 8800, marqueVisible: true }),
      resultatFait(2, { lens: ["Rien"], boutiques: [], statut: "no_query", dureeMs: 15_200, marqueVisible: false, modele: "Pull torsadé Beta", marque: "" }),
      resultatFait(3, { lens: [], boutiques: [], issue: "refus", erreur: "search_capacity_day", marqueVisible: false }),
    ];
    const rapport = construireRapport({ meta: metaFaite(), resultats, jugements: { etat: "absent" } });
    expect(rapport).toContain("tracés par Claude le 30 octobre et À VALIDER par le fondateur");
    expect(rapport).toContain("| Bonne pièce, marque visible | 1/1 | 9/9 | 1/1 | 8/9 | 1/1 |");
    expect(rapport).toContain("| Bonne pièce, autres cas | 0/2 | 11/16 | 0/2 | 10/16 | 0/2 |");
    expect(rapport).toContain("médiane 12,0 s ; 1/2 sous 14 s ; 1/2 sous 15 s");
    expect(rapport).toContain("Crédits SerpApi dépensés : 4 (Lens 2, Google Shopping 2)");
    expect(rapport).toContain("| 1 | oui | oui | oui | 2 (1) | 1re | shown | 1 (1) | 1re | zeta gamma | 8,8 s | 2 |");
    expect(rapport).toContain("non mesuré : search_capacity_day");
    expect(rapport).toContain("| 2 | non | image entière | oui |");
    expect(rapport).toContain("# Mesure de la voie C — 5 novembre 2026 à 09:00 (heure de Paris)");
    expect(rapport).toContain("relancée avant le 6 novembre 2026 à 09:00");
    expect(rapport).toContain("Issues du complément : shown 1, no_query 1.");
    expect(rapport).toContain("code du serveur identique à main en ligne, 9ad5420");
    expect(rapport).not.toMatch(/jeton-secret|cle-serpapi/);
  });

  it("deux passes : l'effet de vos mots sur l'ordre de Lens, et la preuve du cache", () => {
    const avec = resultatFait(1, { lens: ["Maison Exemple veste Alpha"], boutiques: [], passe: "avec-mots", marqueVisible: true });
    const sans = resultatFait(1, { lens: ["Autre", "Maison Exemple veste Alpha"], boutiques: [], passe: "sans-mots", marqueVisible: true, lensDuCache: true });
    const rapport = construireRapport({ meta: { ...metaFaite(), mots: "les-deux" }, resultats: [avec, sans], jugements: { etat: "absent" } });
    expect(rapport).toContain("## Passe 1 — avec vos mots");
    expect(rapport).toContain("## Passe 2 — sans vos mots (servie par le cache)");
    expect(rapport).toContain("- Bonne pièce en 1re place : 1 avec vos mots, 0 sans.");
    expect(rapport).toContain("réponse de Lens lue dans le cache à la 2e passe : 1/1");
  });

  it("médiane et secondes à la française", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
    expect(mediane([])).toBeNull();
    expect(secondes(8800)).toBe("8,8 s");
    expect(secondes(null)).toBe("—");
  });

  it("le rapport se refait à partir des JSON, sans aucun appel", () => {
    const fichiers = new Map<string, string>([
      ["/m/mesure.json", JSON.stringify(metaFaite())],
      ["/m/cas-01.json", JSON.stringify(resultatFait(1, { lens: ["Maison Exemple veste Alpha"], boutiques: [], marqueVisible: true }))],
      ["/m/notes.txt", "à ignorer"],
    ]);
    const chemin = refaireRapport("/m", { etat: "absent" }, {
      lire: (c) => fichiers.get(c)!,
      lister: () => [...fichiers.keys()].map((c) => c.slice(3)),
      ecrire: (c, t) => fichiers.set(c, t),
    });
    expect(chemin).toBe("/m/rapport.md");
    expect(fichiers.get("/m/rapport.md")).toContain("| Bonne pièce, marque visible | 1/1 |");
  });
});

describe("déroulé : essai à blanc, mesure réelle, nettoyage", () => {
  it("sans --confirmer : aucun lancement ; serveur avec une clé SerpApi invalide et sans clé d'Anthropic ; tout est supprimé", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: false } }), faux.ports);
    expect(faux.ports.lancer).not.toHaveBeenCalled();
    expect(faux.envServeur()?.SERPAPI_KEY).toBe(CLE_SERPAPI_A_BLANC);
    expect(faux.envServeur()).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(faux.envServeur()?.VOIE_C_ENABLED).toBe("true");
    expect(faux.appels).toEqual(["etatLens", "verifierCleAnthropic", "lireCompteurs", "demarrer", "creer 1", "preparer", "sonder", "supprimer compte-1", "arreter"]);
    expect(faux.ecrits.has("/sorties/2026-11-05_09-00-00-essai-a-blanc/zones/cas-03.jpg")).toBe(true);
    expect(faux.texte()).toContain("Essai à blanc terminé : aucun crédit dépensé");
    expect(faux.texte()).toContain("Voie C en service sur le serveur local");
  });

  it("avec --confirmer : refus si Google Lens n'est pas annoncé opérationnel, ou sans clé d'essai d'Anthropic", async () => {
    const enPanne = fauxPorts({ etatLens: "major_outage" });
    await expect(lancerMesure(entreeFaite({ options: { confirmer: true } }), enPanne.ports)).rejects.toThrow(/aucun crédit dépensé/);
    expect(enPanne.ports.demarrerServeur).not.toHaveBeenCalled();
    const sansCle = fauxPorts();
    const entree = entreeFaite({ options: { confirmer: true } });
    entree.lireCleAnthropic = () => {
      throw new Error("Aucune clé d'essai");
    };
    await expect(lancerMesure(entree, sansCle.ports)).rejects.toThrow(/Aucune clé d'essai/);
    expect(sansCle.ports.demarrerServeur).not.toHaveBeenCalled();
  });

  it("avec --confirmer : parcours de l'app (préparer, lancer avec cadre, photo et mots), JSON par cas, rapport, nettoyage", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports);
    expect(faux.ports.lancer).toHaveBeenCalledTimes(3);
    const premier = vi.mocked(faux.ports.lancer).mock.calls[0]![3];
    expect(premier).toMatchObject({ nomFichier: "cas-01.jpg", mots: "veste bleue" });
    expect(premier.cadre?.x).toBeCloseTo(0.27);
    // Sans cadre tracé : l'image entière, comme l'app quand le cadre couvre toute la photo.
    expect(vi.mocked(faux.ports.lancer).mock.calls[1]![3].cadre).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(faux.envServeur()).toMatchObject({ VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-cle-d-essai", SERPAPI_DAILY_CAP: "9", SERPAPI_MONTHLY_CAP: "46", SERPAPI_USER_DAILY_CAP: "8" });
    expect([...faux.ecrits.keys()].filter((c) => c.endsWith(".json")).sort()).toEqual([
      "/sorties/2026-11-05_09-00-00/cas-01.json",
      "/sorties/2026-11-05_09-00-00/cas-02.json",
      "/sorties/2026-11-05_09-00-00/cas-03.json",
      "/sorties/2026-11-05_09-00-00/mesure.json",
    ]);
    const cas1 = JSON.parse(faux.ecrits.get("/sorties/2026-11-05_09-00-00/cas-01.json") as string) as ResultatCas;
    expect(cas1).toMatchObject({ issue: "mesure", credits: { total: 2 }, durees: { lancementMs: 8200 } });
    expect(cas1.journal?.complement).toMatchObject({ status: "shown" });
    expect(faux.ecrits.get("/sorties/2026-11-05_09-00-00/rapport.md")).toContain("Crédits SerpApi dépensés : 6");
    expect(faux.appels.slice(-3)).toEqual(["supprimer compte-1", "arreter", "lireCompteurs"]);
    expect(faux.texte()).not.toContain("jeton-secret");
  });

  it("avec --confirmer : arrêt net avant le cas qui pourrait dépasser le plafond", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: true, plafond: 4 } }), faux.ports);
    expect(faux.ports.lancer).toHaveBeenCalledTimes(2);
    const meta = JSON.parse(faux.ecrits.get("/sorties/2026-11-05_09-00-00/mesure.json") as string) as MetaMesure;
    expect(meta.arret).toMatch(/plafond de 4 crédits : le cas 3/);
    expect(faux.envServeur()?.SERPAPI_DAILY_CAP).toBe("7");
  });

  it("avec --confirmer : voie C pas en service (sonde) → arrêt avant toute dépense, nettoyage", async () => {
    const faux = fauxPorts({ sonde: { statut: 404, erreur: "text_search_unavailable" } });
    await expect(lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports)).rejects.toThrow(/pas en service/);
    expect(faux.ports.lancer).not.toHaveBeenCalled();
    expect(faux.appels).toContain("supprimer compte-1");
    expect(faux.appels).toContain("arreter");
  });

  it("nettoyage appelé après une erreur : comptes supprimés, serveur arrêté, rapport écrit", async () => {
    const faux = fauxPorts({ preparerEchoueAu: 3 });
    await expect(lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports)).rejects.toThrow(/réseau coupé/);
    expect(faux.appels).toContain("supprimer compte-1");
    expect(faux.appels).toContain("arreter");
    const meta = JSON.parse(faux.ecrits.get("/sorties/2026-11-05_09-00-00/mesure.json") as string) as MetaMesure;
    expect(meta).toMatchObject({ arret: "réseau coupé", nettoyage: { comptes: 1, supprimes: 1, restes: [] } });
    expect(faux.ecrits.get("/sorties/2026-11-05_09-00-00/rapport.md")).toContain("Mesure arrêtée avant la fin : réseau coupé");
  });

  it("Ctrl-C : le nettoyage tourne une seule fois, même rappelé à la fin", async () => {
    const faux = fauxPorts({ interrompreAu: 2 });
    await lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports);
    expect(faux.appels.filter((a) => a === "supprimer compte-1")).toHaveLength(1);
    expect(faux.appels.filter((a) => a === "arreter")).toHaveLength(1);
    const meta = JSON.parse(faux.ecrits.get("/sorties/2026-11-05_09-00-00/mesure.json") as string) as MetaMesure;
    expect(meta.arret).toBe("interrompue (Ctrl-C)");
  });

  it("deux passes : nouveaux comptes pour la seconde, sans vos mots ; compteurs relus entre les passes", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: true, mots: "les-deux" } }), faux.ports);
    const envois = vi.mocked(faux.ports.lancer).mock.calls.map((appel) => [appel[1].numero, appel[3].mots]);
    expect(envois).toEqual([
      [1, "veste bleue"],
      [1, "pull torsadé crème"],
      [1, "sac noir"],
      [2, null],
      [2, null],
      [2, null],
    ]);
    expect(faux.ecrits.has("/sorties/2026-11-05_09-00-00/cas-01-sans-mots.json")).toBe(true);
    const meta = JSON.parse(faux.ecrits.get("/sorties/2026-11-05_09-00-00/mesure.json") as string) as MetaMesure;
    expect(meta.compteurs.entrePasses).not.toBeNull();
  });
});

describe("ports réels, sans réseau : la photo comme l'app l'importe", () => {
  it("1 600 px au plus, JPEG ; zone analysée comme le serveur, avec son empreinte", async () => {
    const dossier = mkdtempSync(join(tmpdir(), "mesure-voie-c-image-"));
    try {
      const photo = join(dossier, "cas01.png");
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toFile(photo);
      const ports = portsReels({ environnement: ENV_FACTICE, secrets: [] });
      const image = await ports.imageCommeLApp(photo);
      expect([image.largeur, image.hauteur]).toEqual([1600, 800]);
      expect((await sharp(image.jpeg).metadata()).format).toBe("jpeg");
      const zone = await ports.zoneAnalysee(image.jpeg, { x: 0.27, y: 0.28, width: 0.73, height: 0.53 });
      expect((await sharp(zone.zone).metadata()).width).toBe(1168);
      expect(zone.empreinte).toMatch(/^[0-9a-f]{64}$/);
      expect((await ports.zoneAnalysee(image.jpeg, { x: 0.27, y: 0.28, width: 0.73, height: 0.53 })).empreinte).toBe(zone.empreinte);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

// ---- Faux ----

function ligneFaite(changes: Partial<LigneRecherche> = {}): LigneRecherche {
  return {
    status: "completed",
    error_message: null,
    outcome: "found",
    failure_kind: null,
    call_seconds: 4,
    received_count: 40,
    kept_count: 20,
    kept_with_price: 8,
    crop_area_pct: 40,
    provider_status_code: 200,
    complement_status: "shown",
    shopping_calls: 1,
    lens_from_cache: false,
    served_from_cache: false,
    text_suggested: false,
    total_seconds: 8,
    ...changes,
  };
}

function journalFait(options: { rendue?: boolean } = {}): LigneJournal[] {
  return [
    { msg: "Plafond recherches", champs: { step: "search", outcome: "reserved" } },
    { msg: "Mesure recherche", champs: { outcome: "found", callSeconds: 4 } },
    { msg: "Plafond recherches", champs: { step: "shopping", outcome: "reserved" } },
    ...(options.rendue ? [{ msg: "Place rendue", champs: { step: "shopping", released: true } }] : []),
    { msg: "Mesure complément", champs: { status: "shown", aiMs: 900, shoppingMs: 1800, totalMs: 8000, inputTokens: 700, outputTokens: 40 } },
  ];
}

function reponseFaite(lens: string[], boutiques: string[], statut: string = "shown"): unknown {
  const proposition = (titre: string, rang: number, origine?: string) => ({
    id: `p${rang}`,
    rank: rang,
    productName: titre,
    merchantName: "Boutique",
    merchantUrl: `https://www.boutique.example/p/${rang}`,
    priceMin: rang === 1 || origine ? 120 : null,
    currency: "EUR",
    ...(origine ? { origin: origine } : {}),
  });
  return {
    id: "recherche",
    status: "completed",
    errorMessage: null,
    sortedByWords: true,
    complement: { status: statut, query: "zeta gamma", suggestText: false, textStatus: null },
    matches: [...lens.map((t, i) => proposition(t, i + 1)), ...boutiques.map((t, i) => proposition(t, lens.length + i + 1, "shopping"))],
  };
}

function resultatFait(
  cas: number,
  options: { lens: string[]; boutiques: string[]; statut?: string; dureeMs?: number; marqueVisible: boolean; issue?: ResultatCas["issue"]; erreur?: string; passe?: ResultatCas["passe"]; lensDuCache?: boolean; marque?: string; modele?: string }
): ResultatCas {
  const lue = lireReponse(reponseFaite(options.lens, options.boutiques, options.statut))!;
  const { lens, boutiques, ...reponse } = lue;
  const mesure = (options.issue ?? "mesure") === "mesure";
  return {
    version: 1,
    cas,
    passe: options.passe ?? "unique",
    verite: {
      fichier: `cas0${cas}.png`,
      marque: options.marque ?? "Maison Exemple",
      modele: options.modele ?? "Veste Alpha (bleue)",
      nombrePieces: "1",
      pieceDesignee: "la veste",
      cadre: cas === 1,
      mots: "veste bleue",
      marqueVisible: options.marqueVisible,
    },
    envoi: {
      cadre: cas === 1 ? { x: 0.27, y: 0.28, width: 0.73, height: 0.53 } : { x: 0, y: 0, width: 1, height: 1 },
      cadreTrace: cas === 1 ? { gauche: 27, haut: 28, largeur: 73, hauteur: 53, rappel: "la veste" } : null,
      mots: "veste bleue",
      motsTronques: false,
      image: { largeur: 1200, hauteur: 1600, octets: 1000 },
      empreinteZone: "a".repeat(64),
    },
    issue: options.issue ?? "mesure",
    http: { preparation: 200, lancement: mesure ? 200 : 429 },
    erreur: options.erreur ?? null,
    reponse: mesure ? reponse : null,
    propositions: mesure ? { lens, boutiques } : { lens: [], boutiques: [] },
    ligne: mesure ? ligneFaite({ lens_from_cache: options.lensDuCache ?? false }) : null,
    journal: mesure ? resumerJournal(journalFait()) : null,
    durees: { preparationMs: 300, lancementMs: mesure ? (options.dureeMs ?? 9000) : null },
    credits: mesure ? { lens: 1, shopping: 1, total: 2, selonJournal: 2, estime: false } : { lens: 0, shopping: 0, total: 0, selonJournal: null, estime: false },
    compte: 1,
    horodatage: "2026-11-05T08:00:00.000Z",
  };
}

function metaFaite(): MetaMesure {
  return {
    version: 1,
    debut: "2026-11-05T08:00:00.000Z",
    fin: "2026-11-05T08:10:00.000Z",
    serveur: { commit: "abc1234", identiqueAMain: true, commitMain: "9ad5420" },
    jeu: "/jeu",
    cadres: { chemin: "/jeu/cadres-traces.txt", nombre: 2, tracesParClaude: true },
    mots: "avec",
    plan: planMesure(3, { lesDeux: false, plafond: 60 }),
    plafondsServeur: null,
    etatLens: "operational",
    compteurs: { avant: { jour: 3, mois: 40 }, entrePasses: null, apres: { jour: 9, mois: 46 } },
    arret: null,
    nettoyage: { comptes: 1, supprimes: 1, restes: [] },
    avertissements: [],
  };
}

function entreeFaite(changes: { options?: Partial<OptionsMesure>; environnement?: Record<string, string>; chargerJeu?: () => JeuCharge } = {}): EntreeMesure {
  return {
    options: { confirmer: false, jeu: "/jeu", cadres: "/jeu/cadres-traces.txt", sortie: "/sorties", plafond: 60, mots: "avec", refaireRapport: null, ...changes.options },
    environnement: changes.environnement ?? ENV_DEV,
    chargerJeu: changes.chargerJeu ?? jeuFait,
    jugements: { etat: "absent" },
    lireCleAnthropic: () => "sk-ant-cle-d-essai",
    depot: { commit: "abc1234", identiqueAMain: true },
    dossierSortie: "/sorties/2026-11-05_09-00-00",
    envAbsent: "/tmp/absent",
    cadresTracesParClaude: true,
  };
}

function fauxPorts(reglages: { etatLens?: string; sonde?: { statut: number; erreur: string | null }; preparerEchoueAu?: number; interrompreAu?: number } = {}) {
  const appels: string[] = [];
  const affichages: string[] = [];
  const ecrits = new Map<string, string | Buffer>();
  const journal: LigneJournal[] = [];
  const lignes = new Map<string, LigneRecherche>();
  let env: Record<string, string> | null = null;
  let interruption: (() => Promise<void>) | null = null;
  let preparations = 0;
  let lancements = 0;
  const serveur: ServeurLocal = {
    url: "http://127.0.0.1:4321",
    journal,
    arreter: async () => {
      appels.push("arreter");
    },
  };
  const ports: PortsMesure = {
    maintenant: () => Date.parse("2026-11-05T08:00:00.000Z"),
    afficher: (texte) => affichages.push(texte),
    ecrire: (chemin, contenu) => ecrits.set(chemin, contenu),
    creerDossier: () => undefined,
    etatLens: async () => {
      appels.push("etatLens");
      return reglages.etatLens ?? "operational";
    },
    verifierCleAnthropic: async () => {
      appels.push("verifierCleAnthropic");
      return null;
    },
    lireCompteurs: async () => {
      appels.push("lireCompteurs");
      return { jour: 3, mois: 40 };
    },
    portLibre: async () => 4321,
    demarrerServeur: vi.fn(async (environnement: Record<string, string>) => {
      appels.push("demarrer");
      env = environnement;
      return serveur;
    }),
    creerCompte: vi.fn(async (numero: number) => {
      appels.push(`creer ${numero}`);
      return { numero, id: `compte-${numero}`, jeton: `jeton-secret-${numero}` };
    }),
    supprimerCompte: vi.fn(async (compte: CompteEssai) => {
      appels.push(`supprimer ${compte.id}`);
      return true;
    }),
    preparer: vi.fn(async () => {
      appels.push("preparer");
      preparations += 1;
      if (reglages.preparerEchoueAu === preparations) throw new Error("réseau coupé");
      return { statut: 200, id: `recherche-${preparations}`, erreur: null };
    }),
    sonderVoieC: vi.fn(async () => {
      appels.push("sonder");
      return reglages.sonde ?? { statut: 409, erreur: "text_search_not_allowed" };
    }),
    lancer: vi.fn(async (_serveur: ServeurLocal, _compte: CompteEssai, id: string) => {
      lancements += 1;
      if (reglages.interrompreAu === lancements) await interruption?.();
      journal.push(...journalFait());
      lignes.set(id, ligneFaite());
      return { statut: 200, corps: reponseFaite(["Maison Exemple veste Alpha", "Autre"], ["Exemple Alpha jacket"]), dureeMs: 8200 };
    }),
    lireLigne: async (id) => lignes.get(id) ?? null,
    imageCommeLApp: async () => ({ jpeg: Buffer.from("jpeg"), largeur: 1200, hauteur: 1600 }),
    zoneAnalysee: async () => ({ zone: Buffer.from("zone"), empreinte: "a".repeat(64) }),
    attendre: async () => undefined,
    surInterruption: (action) => {
      interruption = action;
      return () => {
        interruption = null;
      };
    },
  };
  return { ports, appels, ecrits, envServeur: () => env, texte: () => affichages.join("\n") };
}
