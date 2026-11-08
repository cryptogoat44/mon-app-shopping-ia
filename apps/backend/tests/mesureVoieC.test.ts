import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { CAS_PAR_COMPTE, GardeBudget, lignesDuPlan, lirePlafond, plafondsServeur, planMesure } from "../scripts/lib/mesure-voie-c/budget.js";
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
import { jugeDuCas, jugerListe, lireJugementsFondateur, motsImportants, normaliser, paliers, REGLE_BONNE_PIECE, semblePiece, type EtatJugements } from "../scripts/lib/mesure-voie-c/jugement.js";
import {
  ARRET_COUPURE,
  lancerMesure,
  mesuresAnterieures,
  nettoyerDossier,
  refaireRapport,
  type CompteCree,
  type CompteEssai,
  type EntreeMesure,
  type EnvoiApp,
  type PortsMesure,
  type ServeurLocal,
} from "../scripts/lib/mesure-voie-c/mesure.js";
import { construireRapport, mediane, secondes } from "../scripts/lib/mesure-voie-c/rapport.js";
import { gardesDuMac, portsReels } from "../scripts/lib/mesure-voie-c/reel.js";
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
const DOSSIER = "/sorties/2026-11-05_09-00-00";
const BACKEND = fileURLToPath(new URL("..", import.meta.url));

function jeuFait(nombre = 3): JeuCharge {
  const lignes = REPONSES.split("\n");
  for (let i = lignes.length; i < nombre; i += 1) lignes.push(`cas${String(i + 1).padStart(2, "0")}.png;Marque ${i + 1};Modèle Delta ${i + 1};;1;la pièce;non;mots ${i + 1};;non;`);
  const cas = lireReponses(lignes.join("\n"));
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

  it("cadres : les lignes de commentaire « # » sont ignorées (en-tête du fichier du banc), les numéros de ligne restent justes", () => {
    const texte = "# Cadres tracés par Claude le 30 octobre\n  # deuxième ligne de commentaire ; avec ; des ; points-virgules\n1 ; 27 28 73 53 ; la veste\n";
    expect([...lireCadres(texte, "cadres-traces.txt").keys()]).toEqual([1]);
    expect(() => lireCadres("# en-tête\n1 ; 27 28 73 ; la veste", "cadres-traces.txt")).toThrow(/cadres-traces\.txt, ligne 2 : il faut quatre nombres/);
  });

  it("cadres : une ligne mal formée est refusée avec un message clair", () => {
    expect(() => lireCadres("1 ; 27 28 73 ; la veste", "cadres-traces.txt")).toThrow(/cadres-traces\.txt, ligne 1 : il faut quatre nombres/);
    expect(() => lireCadres("1 ; 27 28 73 53", "c")).toThrow(/trois champs/);
    expect(() => lireCadres("un ; 27 28 73 53 ; x", "c")).toThrow(/numéro de cas illisible/);
    expect(() => lireCadres("1 ; 27 28 173 53 ; x", "c")).toThrow(/de 0 à 100/);
    expect(() => lireCadres("1 ; 27 28 0 53 ; x", "c")).toThrow(/plus grandes que 0/);
    expect(() => lireCadres("1 ; 1 1 2 2 ; a\n1 ; 1 1 2 2 ; b", "c")).toThrow(/ligne 2 : deuxième cadre pour le cas 1/);
    expect(() => cadreEnProportions({ numero: 4, gauche: 100, haut: 10, largeur: 30, hauteur: 30, rappel: "" })).toThrow(/en dehors de l'image/);
  });

  it("cadres : un côté sous 12 % est élargi autour de son milieu, comme l'app de main (jamais moins de 12 %), et signalé", () => {
    // Les lunettes : 10 % × 8 % tracés ; l'app enverrait 12 % × 12 %, centrés sur le même milieu.
    const lunettes = cadreEnProportions({ numero: 7, gauche: 40, haut: 30, largeur: 10, hauteur: 8, rappel: "les lunettes" });
    expect(lunettes.x).toBeCloseTo(0.39);
    expect(lunettes.y).toBeCloseTo(0.28);
    expect(lunettes.width).toBeCloseTo(0.12);
    expect(lunettes.height).toBeCloseTo(0.12);
    // Au bord : élargi vers l'intérieur, sans sortir de l'image.
    const bord = cadreEnProportions({ numero: 4, gauche: 98, haut: 10, largeur: 30, hauteur: 30, rappel: "" });
    expect(bord.x).toBeCloseTo(0.88);
    expect(bord.width).toBeCloseTo(0.12);
    const cas = lireReponses(REPONSES);
    expect(ecartsCadres(cas, lireCadres("1 ; 40 30 10 8 ; les lunettes", "c"))).toContain(
      "cas 1 : cadre de moins de 12 % de côté (10 × 8 %), élargi à 12 % autour de son milieu comme l'app (qui ne peut pas envoyer moins) : c'est cette zone qui est envoyée (zones/)."
    );
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
    expect(plan).toMatchObject({ creditsPremierePasse: 50, creditsAuPlus: 50, appelsIaAuPlus: 25, comptes: 4, casCoupesParLePlafond: 0, passes: 1, dejaDepenses: 0 });
    expect(planMesure(25, { lesDeux: false, plafond: 30 }).casCoupesParLePlafond).toBe(10);
    expect(CAS_PAR_COMPTE).toBeLessThan(10);
  });

  it("--les-deux : la seconde passe tourne IA coupée — 1 crédit au pire par cas (Lens hors cache), jamais d'appel à l'IA", () => {
    const lesDeux = planMesure(25, { lesDeux: true, plafond: 60 });
    expect(lesDeux).toMatchObject({ creditsSecondePasseAuPire: 25, casSecondePasse: 25, creditsAuPlus: 60, appelsIaAuPlus: 25, comptes: 8, passes: 2 });
    const lignes = lignesDuPlan(lesDeux).join("\n");
    expect(lignes).toContain("Seconde passe : serveur local relancé avec l'IA de la voie C coupée (ni IA, ni Google Shopping possibles)");
    expect(lignes).toContain("0 crédit attendu ; au pire 25 (1 par cas, si le cache ne répond pas à temps)");
    expect(lignes).toContain("au plus 25 appels (première passe seulement)");
  });

  it("le plan dit la marge des outils prévue par le serveur (25 sur 250) face à ce que la mesure peut prendre, et demande de vérifier SerpApi avant l'accord", () => {
    const lignes = lignesDuPlan(planMesure(25, { lesDeux: false, plafond: 60 })).join("\n");
    expect(lignes).toContain("Marge des outils prévue par le serveur sur ce compte : 25 sur 250 par mois (src/env.ts) ; cette mesure : jusqu'à 50. Avant l'accord : vérifier sur le tableau de bord de SerpApi les recherches restantes ce mois-ci.");
    expect(lignes).toContain("Toute relance avec --confirmer (y compris --reprendre) demande un nouvel accord écrit du fondateur, cumul du jour compris.");
  });

  it("budget cumulé : ce que les mesures du jour ont déjà dépensé est retranché du plafond", () => {
    const plan = planMesure(25, { lesDeux: false, plafond: 60, dejaDepenses: 54 });
    expect(plan).toMatchObject({ creditsAuPlus: 6, casCoupesParLePlafond: 22, dejaDepenses: 54 });
    expect(lignesDuPlan(plan).join("\n")).toContain("Déjà dépensé aujourd'hui par les mesures précédentes (dossier des sorties) : 54 crédit(s), retranché(s) du plafond : il reste 6.");
    const garde = new GardeBudget(60, 58);
    expect(garde.peutLancer()).toBe(true);
    garde.compter(2);
    expect(garde.peutLancer()).toBe(false);
    expect(garde.peutLancer(1)).toBe(false);
    expect(new GardeBudget(60, 59).peutLancer(1)).toBe(true);
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

  it("options : plafond borné, option inconnue refusée, emplacements par défaut, --reprendre et --nettoyer", () => {
    expect(lirePlafond("12")).toBe(12);
    for (const faux of ["1", "abc", "500", "6.5", undefined]) expect(() => lirePlafond(faux)).toThrow(/--plafond-credits/);
    const options = lireOptions([], "/Users/fondateur", "/tmp");
    expect(options).toMatchObject({ confirmer: false, plafond: 60, mots: "avec", refaireRapport: null, reprendre: null, nettoyer: null, ...emplacementsParDefaut("/Users/fondateur") });
    expect(options.jeu).toBe("/Users/fondateur/Downloads/spotto-jeu-de-verite");
    expect(options.sortie).toBe("/Users/fondateur/Downloads/spotto-mesure-voie-c");
    expect(options.cadres).toBe("/Users/fondateur/Desktop/Spotto/mon-app-shopping-ia/docs/banc-jeu-de-verite/cadres-traces.txt");
    expect(lireOptions(["--confirmer", "--les-deux", "--plafond-credits", "40", "--jeu", "jeu"], "/m", "/ici")).toMatchObject({ confirmer: true, mots: "les-deux", plafond: 40, jeu: "/ici/jeu" });
    expect(lireOptions(["--sans-mots"], "/m", "/").mots).toBe("sans");
    expect(lireOptions(["--confirmer", "--reprendre", "m/2026"], "/m", "/ici").reprendre).toBe("/ici/m/2026");
    expect(lireOptions(["--nettoyer", "m/2026"], "/m", "/ici").nettoyer).toBe("/ici/m/2026");
    expect(() => lireOptions(["--confirmmer"], "/m", "/")).toThrow(/Option inconnue : --confirmmer/);
    expect(() => lireOptions(["--sans-mots", "--les-deux"], "/m", "/")).toThrow(/s'excluent/);
    expect(() => lireOptions(["--sortie"], "/m", "/")).toThrow(/attend une valeur/);
    expect(() => lireOptions(["--reprendre", "d", "--les-deux"], "/m", "/")).toThrow(/garde le mode de la mesure reprise/);
    expect(() => lireOptions(["--nettoyer", "d", "--confirmer"], "/m", "/")).toThrow(/--nettoyer s'emploie seul/);
  });

  it("les sorties restent hors du dépôt Git", () => {
    expect(() => verifierHorsDuDepot("/depot/apps/backend/sorties", "/depot")).toThrow(/dans le dépôt Git de l'outil/);
    expect(() => verifierHorsDuDepot("/depot", "/depot")).toThrow(/dans le dépôt Git/);
    expect(() => verifierHorsDuDepot("/Users/fondateur/Downloads/spotto-mesure-voie-c", "/depot")).not.toThrow();
  });

  it("garde des dossiers : lien symbolique résolu, dossier habituel du fondateur et tout autre dépôt Git refusés", () => {
    const gardes = {
      realpath: (chemin: string) => {
        if (chemin === "/Users/f/Downloads/lien") return "/depot/apps";
        if (chemin === "/" || chemin === "/Users" || chemin === "/Users/f" || chemin === "/Users/f/Downloads" || chemin.startsWith("/depot") || chemin.startsWith("/Users/f/Desktop")) return chemin;
        throw new Error("ENOENT");
      },
      interdits: ["/Users/f/Desktop/Spotto/mon-app-shopping-ia"],
      depotGit: (dossier: string) => (dossier.startsWith("/Users/f/Desktop/projet") ? "/Users/f/Desktop/projet" : null),
    };
    expect(() => verifierHorsDuDepot("/Users/f/Downloads/lien/sorties", "/depot", gardes)).toThrow(/dans le dépôt Git de l'outil/);
    expect(() => verifierHorsDuDepot("/Users/f/Desktop/Spotto/mon-app-shopping-ia/sorties", "/depot", gardes)).toThrow(/dans le dossier habituel du fondateur/);
    expect(() => verifierHorsDuDepot("/Users/f/Desktop/projet/sorties", "/depot", gardes)).toThrow(/dans un dépôt Git \(\/Users\/f\/Desktop\/projet\)/);
    expect(() => verifierHorsDuDepot("/Users/f/Downloads/spotto-mesure-voie-c", "/depot", gardes)).not.toThrow();
  });

  it("garde des dossiers sur un vrai disque : un lien vers un dépôt Git est refusé, un dossier libre accepté", () => {
    const racine = mkdtempSync(join(tmpdir(), "mesure-voie-c-garde-"));
    try {
      const depot = join(racine, "depot");
      mkdirSync(depot);
      expect(spawnSync("git", ["init", "-q", depot]).status).toBe(0);
      symlinkSync(depot, join(racine, "lien"));
      const gardes = gardesDuMac(join(racine, "maison"));
      expect(() => verifierHorsDuDepot(join(racine, "lien", "sorties"), "/depot-de-l-outil", gardes)).toThrow(/dans un dépôt Git/);
      expect(() => verifierHorsDuDepot(join(racine, "libre", "sorties"), "/depot-de-l-outil", gardes)).not.toThrow();
      expect(() => verifierHorsDuDepot(join(racine, "maison", "Desktop", "Spotto", "mon-app-shopping-ia", "x"), "/depot-de-l-outil", gardes)).toThrow(/dossier habituel du fondateur/);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
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
    const chargerJeuEspion = vi.fn(() => jeuFait());
    await expect(lancerMesure(entreeFaite({ environnement: ENV_FACTICE, chargerJeu: chargerJeuEspion, options: { confirmer: true } }), faux.ports)).rejects.toThrow(/ne désigne pas spotto-dev-2/);
    expect(chargerJeuEspion).not.toHaveBeenCalled();
    expect(faux.appels).toEqual([]);
  });

  it("--nettoyer : refus net hors de spotto-dev-2 est fait par la commande ; ici, sans comptes.json ni mesure.json, rien à nettoyer", async () => {
    const faux = fauxPorts();
    await expect(nettoyerDossier("/vide", faux.ports, { etat: "absent" })).rejects.toThrow(/rien à nettoyer ici/);
  });

  it("l'environnement effectif : apps/backend/.env, et par-dessus le Terminal (comme le serveur)", () => {
    const effectif = environnementEffectif("SUPABASE_URL=https://sedfepcpmhilaxbrgdif.supabase.co\nSERPAPI_KEY=du-fichier\n", { SERPAPI_KEY: "du-terminal", AUTRE: undefined });
    expect(effectif).toEqual({ SUPABASE_URL: "https://sedfepcpmhilaxbrgdif.supabase.co", SERPAPI_KEY: "du-terminal" });
  });

  it("serveur local : voie C et IA allumées, Sentry, photo et NODE_ENV retirés, plafonds, .env non relu ; sans clé, l'IA est coupée", () => {
    const env = environnementServeur(ENV_DEV, { port: 4321, cleAnthropic: "sk-ant-essai-secrete", cleSerpApi: null, plafonds: { SERPAPI_DAILY_CAP: "57" }, envAbsent: "/tmp/absent" });
    expect(env).toMatchObject({ PORT: "4321", VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-essai-secrete", SERPAPI_KEY: ENV_DEV.SERPAPI_KEY, SERPAPI_DAILY_CAP: "57", DOTENV_CONFIG_PATH: "/tmp/absent" });
    for (const retiree of ["SENTRY_DSN", "ANTHROPIC_PHOTO_ENABLED", "NODE_ENV"]) expect(env).not.toHaveProperty(retiree);
    const aBlanc = environnementServeur({ ...ENV_DEV, ANTHROPIC_API_KEY: "venue-d-ailleurs" }, { port: 1, cleAnthropic: null, cleSerpApi: CLE_SERPAPI_A_BLANC, plafonds: {}, envAbsent: "/x" });
    expect(aBlanc.SERPAPI_KEY).toBe(CLE_SERPAPI_A_BLANC);
    expect(aBlanc).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(aBlanc.VOIE_C_AI_ENABLED).toBe("false");
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

  it("marque : articles ignorés, mot exact ou son pluriel seulement (ni début de mot, ni traduction)", () => {
    expect(semblePiece("The best leather jacket for men", { marque: "The Kooples", modele: "Blouson cuir" })).toBe(false);
    expect(semblePiece("Veste de costume en laine", { marque: "De Fursac", modele: "Veste Alpha" })).toBe(false);
    expect(semblePiece("Majestic Filatures t-shirt col V", { marque: "Maje", modele: "T-shirt col V" })).toBe(false);
    expect(semblePiece("Maje t-shirt col V blanc", { marque: "Maje", modele: "T-shirt col V" })).toBe(true);
    expect(semblePiece("The Kooples veste Alpha", { marque: "The Kooples", modele: "Veste Alpha" })).toBe(true);
    expect(semblePiece("Zetas sac gamma", { marque: "Zeta", modele: "Sac Gamma" })).toBe(true);
  });

  it("un mot du modèle compte s'il commence pareil, ou par une traduction (noir ↔ black, pull ↔ sweater)", () => {
    expect(semblePiece("Zeta black leather bag", { marque: "Zeta", modele: "Sac noir" })).toBe(true);
    expect(semblePiece("Zeta jeans slim", { marque: "Zeta", modele: "Jean slim" })).toBe(true);
    expect(semblePiece("Zeta cable-knit sweater", { marque: "Zeta", modele: "Pull torsadé" })).toBe(true);
    expect(semblePiece("Zeta sacoche cuir", { marque: "Zeta", modele: "Sac cuir" })).toBe(true);
    expect(semblePiece("Zeta sacoche", { marque: "Zeta", modele: "Sac cuir" })).toBe(false);
  });

  it("sans marque : au moins 2 mots importants du modèle (version stricte, écrite telle quelle dans le rapport) ; un modèle vide n'est jamais une bonne pièce", () => {
    expect(semblePiece("Pull torsadé beta crème", { marque: "", modele: "Pull torsadé Beta" })).toBe(true);
    expect(semblePiece("Pull en laine", { marque: "", modele: "Pull torsadé Beta" })).toBe(false);
    expect(semblePiece("Bob bucket hat en coton beige", { marque: "", modele: "Bob" })).toBe(false);
    expect(REGLE_BONNE_PIECE).toContain("sans marque, au moins 2 mots importants du modèle (un modèle d'un seul mot important n'est donc jamais une bonne pièce sans marque)");
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
  it("tableau par cas, totaux comparés au banc, durées, crédits ; les cadres à valider ; la règle « bonne pièce » écrite ; aucun secret", () => {
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
    expect(rapport).toContain("| 1 | oui | oui | oui | 2 (1) | 1re | shown | 1 (1) | 1re | zeta gamma | non | 8,8 s | 2 |");
    expect(rapport).toContain("non mesuré : search_capacity_day");
    expect(rapport).toContain("| 2 | non | image entière | oui |");
    expect(rapport).toContain("# Mesure de la voie C — 5 novembre 2026 à 09:00 (heure de Paris)");
    expect(rapport).toContain("relancée avant le 6 novembre 2026 à 09:00");
    expect(rapport).toContain("Issues du complément : shown 1, no_query 1.");
    expect(rapport).toContain("code du serveur identique à main en ligne, 3db7dda");
    expect(rapport).toContain(REGLE_BONNE_PIECE);
    expect(rapport).not.toMatch(/jeton-secret|cle-serpapi/);
  });

  it("durées : le temps côté serveur, et l'attente minimale de la personne (préparation + lancement) ; base et envoi", () => {
    const r = [resultatFait(1, { lens: ["x"], boutiques: [], dureeMs: 13_500, preparationMs: 1_200, marqueVisible: true })];
    const rapport = construireRapport({ meta: metaFaite(), resultats: r, jugements: { etat: "absent" } });
    expect(rapport).toContain("- temps côté serveur, vu depuis ce Mac (photo envoyée → résultat final avec le complément) : médiane 13,5 s ; 1/1 sous 14 s ; 1/1 sous 15 s");
    expect(rapport).toContain("- attente minimale de la personne (préparation + lancement : l'app prépare la recherche au moment de « Lancer ») : médiane 14,7 s ; 0/1 sous 14 s ; 1/1 sous 15 s ;");
    expect(rapport).toContain("non mesurés ici : l'envoi de la photo par le réseau mobile et le trajet jusqu'au serveur de Render");
    // total 8 000 ms − Lens 4 s − IA 0,9 s − Google Shopping 1,8 s.
    expect(rapport).toContain("base et envoi (total du serveur − Lens − IA − Google Shopping, à la seconde près) : 1,3 s.");
  });

  it("relance dans les 24 h : les cas servis par le cache sont signalés et exclus des durées et des boutiques (pas des scores Lens)", () => {
    const r = [
      resultatFait(1, { lens: ["Maison Exemple veste Alpha"], boutiques: ["Maison Exemple veste Alpha"], dureeMs: 1_400, marqueVisible: true, lensDuCache: true }),
      resultatFait(2, { lens: ["Maison Exemple veste Alpha"], boutiques: ["Maison Exemple veste Alpha"], dureeMs: 1_600, marqueVisible: true, lensDuCache: true }),
      resultatFait(3, { lens: ["Autre"], boutiques: [], statut: "no_time", dureeMs: 15_500, marqueVisible: true }),
    ];
    const rapport = construireRapport({ meta: metaFaite(), resultats: r, jugements: { etat: "absent" } });
    expect(rapport).toContain("| Bonne pièce, marque visible | 2/3 | 9/9 | 0/1 | 8/9 | 0/1 |");
    expect(rapport).toContain("médiane 15,5 s ; 0/1 sous 14 s ; 0/1 sous 15 s");
    expect(rapport).toContain("Issues du complément : no_time 1.");
    expect(rapport).toContain("⚠ 2 cas servis par le cache (Lens déjà interrogé dans les 24 h) : exclus des durées et des boutiques ; leur premier lancement est dans la mesure précédente.");
    expect(rapport).toContain("- ⚠ 2 cas de cette mesure servis par le cache");
    expect(rapport).toMatch(/\| 1 \| oui \| oui \| oui \| 1 \(1\) \| 1re \| shown \| 1 \(1\) \| 1re \| zeta gamma \| Lens \| 1,4 s \| 2 \|/);
  });

  it("« Lens ou boutiques » : 10 premières de chaque liste ; et ce que la personne voit sans « Voir plus » (12 Lens, 6 boutiques)", () => {
    const boutiques = ["a", "b", "c", "d", "e", "f", "g", "Maison Exemple veste Alpha"];
    const r = resultatFait(1, { lens: ["Autre"], boutiques, dureeMs: 9_000, marqueVisible: true });
    const rapport = construireRapport({ meta: metaFaite(), resultats: [r], jugements: { etat: "absent" } });
    expect(rapport).toContain("| Bonne pièce, marque visible | 0/1 | 9/9 | 1/1 | 8/9 | 1/1 |");
    expect(rapport).toContain("| Bonne pièce visible sans « Voir plus » (Lens : 12 premières ; boutiques : 6 premières) | | | | | 0/1 |");
    expect(rapport).toContain("| | Lens (cette mesure) | A du banc (Lens) | Boutiques de la voie C (cette mesure) | C du banc | Lens ou boutiques (10 premières de chaque) |");
    expect(rapport).toContain("avec la règle 12 stricte (approuvée le 2 novembre), l'IA n'écrit aucune requête quand aucune marque n'apparaît dans au moins deux titres Lens");
    expect(rapport).toContain("la liste Lens d'ici est triée par vos mots (l'ordre de Google est dans la passe 2 de --les-deux)");
  });

  it("le cache laissé sur spotto-dev-2 est annoncé : environ N entrées, sans compte, ignorées après 24 h", () => {
    const r = [resultatFait(1, { lens: ["x"], boutiques: ["y"], marqueVisible: true }), resultatFait(2, { lens: ["x"], boutiques: [], marqueVisible: true, lensDuCache: true })];
    const rapport = construireRapport({ meta: metaFaite(), resultats: r, jugements: { etat: "absent" } });
    // Cas 1 : Lens, requête, Google Shopping ; cas 2 : Lens du cache, mais la requête et les boutiques du faux journal.
    expect(rapport).toContain("Cache du serveur sur spotto-dev-2 : environ 5 entrée(s) laissée(s) (réponses de Lens, requêtes de l'IA, Google Shopping), sans compte ni recherche ; ignorées après 24 h");
  });

  it("deux passes : la passe 2 ne montre que Lens (ordre de Google), liste tout appel payant ; l'effet de vos mots, sans « mêmes boutiques »", () => {
    const avec = resultatFait(1, { lens: ["Maison Exemple veste Alpha"], boutiques: [], passe: "avec-mots", marqueVisible: true });
    const avecPanne = resultatFait(2, { lens: [], boutiques: [], passe: "avec-mots", marqueVisible: false, issue: "panne", erreur: "lancement sans réponse" });
    const sans = resultatFait(1, { lens: ["Autre", "Maison Exemple veste Alpha"], boutiques: [], passe: "sans-mots", marqueVisible: true, lensDuCache: true, statut: "skipped", sansComplementAuJournal: true, credits: 0 });
    const rapport = construireRapport({ meta: { ...metaFaite(), mots: "les-deux" }, resultats: [avec, avecPanne, sans], jugements: { etat: "absent" } });
    expect(rapport).toContain("## Passe 1 — avec vos mots");
    expect(rapport).toContain("## Passe 2 — sans vos mots (IA coupée, Lens servi par le cache)");
    const passe2 = rapport.slice(rapport.indexOf("## Passe 2"), rapport.indexOf("## Effet de vos mots"));
    expect(passe2).toContain("| | Lens, sans vos mots | A du banc (Lens) |");
    expect(passe2).not.toContain("Boutiques de la voie C");
    expect(passe2).not.toMatch(/médiane/);
    expect(passe2).toContain("Cas non relancés (Lens sans réponse en passe 1 : il aurait été refacturé) : 2.");
    expect(passe2).toContain("Appels payants en passe 2 : aucun. Crédits SerpApi de la passe 2 : 0.");
    expect(rapport).toContain("- Bonne pièce en 1re place : 1 avec vos mots, 0 sans.");
    expect(rapport).toContain("réponse de Lens lue dans le cache à la 2e passe : 1/1");
    expect(rapport).not.toContain("mêmes boutiques");
  });

  it("médiane et secondes à la française", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
    expect(mediane([])).toBeNull();
    expect(secondes(8800)).toBe("8,8 s");
    expect(secondes(null)).toBe("—");
  });

  it("le rapport se refait à partir des JSON, sans aucun appel (lancements refaits comptés dans les crédits)", () => {
    const fichiers = new Map<string, string>([
      ["/m/mesure.json", JSON.stringify(metaFaite())],
      ["/m/cas-01.json", JSON.stringify(resultatFait(1, { lens: ["Maison Exemple veste Alpha"], boutiques: [], marqueVisible: true }))],
      ["/m/cas-01.remplace-abc123.json", JSON.stringify(resultatFait(1, { lens: [], boutiques: [], marqueVisible: true, issue: "panne", erreur: "x", credits: 2 }))],
      ["/m/notes.txt", "à ignorer"],
    ]);
    const chemin = refaireRapport("/m", { etat: "absent" }, {
      lire: (c) => fichiers.get(c) ?? null,
      lister: () => [...fichiers.keys()].map((c) => c.slice(3)),
      ecrire: (c, t) => fichiers.set(c, t),
    });
    expect(chemin).toBe("/m/rapport.md");
    expect(fichiers.get("/m/rapport.md")).toContain("| Bonne pièce, marque visible | 1/1 |");
    expect(fichiers.get("/m/rapport.md")).toContain("Crédits SerpApi dépensés : 4 (plafond fixé : 60) — dont 2 pour des lancements refaits ensuite");
  });
});

describe("déroulé : essai à blanc, mesure réelle, nettoyage", () => {
  it("sans --confirmer : aucun lancement ; serveur avec une clé SerpApi invalide et sans clé d'Anthropic ; compte listé dans comptes.json puis supprimé", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: false } }), faux.ports);
    expect(faux.ports.lancer).not.toHaveBeenCalled();
    expect(faux.envServeurs()[0]?.SERPAPI_KEY).toBe(CLE_SERPAPI_A_BLANC);
    expect(faux.envServeurs()[0]).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(faux.envServeurs()[0]?.VOIE_C_ENABLED).toBe("true");
    expect(faux.appels).toEqual(["etatLens", "verifierCleAnthropic", "lireCompteurs", "demarrer", "creer 1", "preparer", "sonder", "supprimer compte-1", "balayer", "arreter"]);
    expect(faux.ecrits.has("/sorties/2026-11-05_09-00-00-essai-a-blanc/zones/cas-03.jpg")).toBe(true);
    expect(faux.premierEcrit("/sorties/2026-11-05_09-00-00-essai-a-blanc/comptes.json")).toContain('"etat": "cree"');
    expect(faux.json("/sorties/2026-11-05_09-00-00-essai-a-blanc/comptes.json")).toMatchObject({ comptes: [{ id: "compte-1", etat: "supprime" }] });
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

  it("avec --confirmer : parcours de l'app (préparer, lancer avec cadre, photo et mots), JSON par cas, comptes.json, mesure.json provisoire dès le début, rapport, nettoyage", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports);
    expect(faux.ports.lancer).toHaveBeenCalledTimes(3);
    const premier = vi.mocked(faux.ports.lancer).mock.calls[0]![3];
    expect(premier).toMatchObject({ nomFichier: "cas-01.jpg", mots: "veste bleue" });
    expect(premier.cadre?.x).toBeCloseTo(0.27);
    // Sans cadre tracé : l'image entière, comme l'app quand le cadre couvre toute la photo.
    expect(vi.mocked(faux.ports.lancer).mock.calls[1]![3].cadre).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(faux.envServeurs()[0]).toMatchObject({ VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-cle-d-essai", SERPAPI_DAILY_CAP: "9", SERPAPI_MONTHLY_CAP: "46", SERPAPI_USER_DAILY_CAP: "8" });
    expect([...faux.ecrits.keys()].filter((c) => c.endsWith(".json")).sort()).toEqual([
      `${DOSSIER}/cas-01.json`,
      `${DOSSIER}/cas-02.json`,
      `${DOSSIER}/cas-03.json`,
      `${DOSSIER}/comptes.json`,
      `${DOSSIER}/mesure.json`,
    ]);
    const cas1 = faux.json(`${DOSSIER}/cas-01.json`) as ResultatCas;
    expect(cas1).toMatchObject({ issue: "mesure", credits: { total: 2 }, durees: { lancementMs: 8200 } });
    expect(cas1.journal?.complement).toMatchObject({ status: "shown" });
    expect(faux.ecrits.get(`${DOSSIER}/rapport.md`)).toContain("Crédits SerpApi dépensés : 6");
    expect(faux.appels.slice(-4)).toEqual(["supprimer compte-1", "balayer", "arreter", "lireCompteurs"]);
    // mesure.json provisoire, écrit avant le serveur : une coupure brutale laisse de quoi refaire le rapport et nettoyer.
    expect(JSON.parse(faux.premierEcrit(`${DOSSIER}/mesure.json`)!)).toMatchObject({ fin: null, arret: ARRET_COUPURE, execution: "abc123" });
    expect(faux.json(`${DOSSIER}/mesure.json`)).toMatchObject({ arret: null, nettoyage: { comptes: 1, supprimes: 1, restes: [] } });
    expect(faux.json(`${DOSSIER}/comptes.json`)).toEqual({ version: 1, comptes: [{ execution: "abc123", numero: 1, id: "compte-1", email: "mesure-voie-c-abc123-1@example.com", etat: "supprime" }] });
    expect(faux.texte()).not.toContain("jeton-secret");
    expect(JSON.stringify([...faux.ecrits.values()].map(String))).not.toContain("jeton-secret");
  });

  it("avec --confirmer : arrêt net avant le cas qui pourrait dépasser le plafond", async () => {
    const faux = fauxPorts();
    await lancerMesure(entreeFaite({ options: { confirmer: true, plafond: 4 } }), faux.ports);
    expect(faux.ports.lancer).toHaveBeenCalledTimes(2);
    expect((faux.json(`${DOSSIER}/mesure.json`) as MetaMesure).arret).toMatch(/plafond de 4 crédits : le cas 3/);
    expect(faux.envServeurs()[0]?.SERPAPI_DAILY_CAP).toBe("7");
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
    expect(faux.json(`${DOSSIER}/mesure.json`)).toMatchObject({ arret: "réseau coupé", nettoyage: { comptes: 1, supprimes: 1, restes: [] } });
    expect(faux.ecrits.get(`${DOSSIER}/rapport.md`)).toContain("Mesure arrêtée avant la fin : réseau coupé");
  });

  it("deux passes : la seconde sur un serveur relancé IA coupée, nouveaux comptes, sans vos mots, seulement les cas dont Lens a répondu en passe 1", async () => {
    const faux = fauxPorts({ lancement: (n) => (n === 2 ? { ligne: ligneFaite({ outcome: "failure", failure_kind: "timeout", shopping_calls: 0, complement_status: null }), statut: 200 } : undefined) });
    await lancerMesure(entreeFaite({ options: { confirmer: true, mots: "les-deux" } }), faux.ports);
    const envois = vi.mocked(faux.ports.lancer).mock.calls.map((appel) => [appel[1].numero, appel[3].mots]);
    expect(envois).toEqual([
      [1, "veste bleue"],
      [1, "pull torsadé crème"],
      [1, "sac noir"],
      [2, null],
      [2, null],
    ]);
    const [premier, second] = faux.envServeurs();
    expect(premier).toMatchObject({ VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-cle-d-essai" });
    expect(second).toMatchObject({ VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "false" });
    expect(second).not.toHaveProperty("ANTHROPIC_API_KEY");
    // Plafonds de la passe 2 : compteurs relus entre les passes + le reste du budget, borné au pire de la passe 2.
    expect(second?.SERPAPI_DAILY_CAP).toBe("6");
    // Le second serveur démarre après l'arrêt du premier.
    expect(faux.appels.indexOf("arreter")).toBeLessThan(faux.appels.lastIndexOf("demarrer"));
    expect(faux.texte()).toContain("cas 02 (sans-mots) : non relancé (Lens sans réponse en passe 1 : il serait refacturé).");
    expect(faux.ecrits.has(`${DOSSIER}/cas-01-sans-mots.json`)).toBe(true);
    expect(faux.ecrits.has(`${DOSSIER}/cas-02-sans-mots.json`)).toBe(false);
    const meta = faux.json(`${DOSSIER}/mesure.json`) as MetaMesure;
    expect(meta.compteurs.entrePasses).not.toBeNull();
    expect(meta.nettoyage).toEqual({ comptes: 2, supprimes: 2, restes: [] });
  });
});

describe("Ctrl-C et autres signaux : plus rien de payant après le signal, chaque compte supprimé, rapport cohérent", () => {
  // Faux réalistes : le signal arrive PENDANT une opération (sans l'attendre),
  // les opérations durent vraiment, le serveur arrêté fait échouer ce qui est
  // en vol, et la fin de l'action simule process.exit (tout appel après est noté).
  const lents = { creer: 30, supprimer: 25, lancer: 40 };

  /** Les opérations payantes ou créatrices notées après le signal. */
  function apresSignal(appels: readonly string[]): string[] {
    return appels.slice(appels.indexOf("SIGNAL SIGINT") + 1).filter((a) => /^(preparer|lancer|creer)/.test(a));
  }

  it("Ctrl-C pendant la création du 2e compte : aucun lancement ensuite, les deux comptes supprimés, nettoyage 2/2", async () => {
    const faux = fauxPorts({ delais: lents, signalA: "creer 2" });
    await lancerMesure(entreeFaite({ options: { confirmer: true }, chargerJeu: () => jeuFait(10) }), faux.ports);
    await faux.fin;
    expect(apresSignal(faux.appels)).toEqual([]);
    expect(faux.ports.lancer).toHaveBeenCalledTimes(8);
    expect(faux.appels.filter((a) => a.startsWith("supprimer")).sort()).toEqual(["supprimer compte-1", "supprimer compte-2"]);
    const meta = faux.json(`${DOSSIER}/mesure.json`) as MetaMesure;
    expect(meta).toMatchObject({ arret: "interrompue (Ctrl-C)", nettoyage: { comptes: 2, supprimes: 2, restes: [] } });
    expect(faux.apresFin).toEqual([]);
    expect(faux.ecrits.get(`${DOSSIER}/rapport.md`)).toContain("Comptes d'essai : 2/2 supprimés");
  });

  it("Ctrl-C au dernier cas d'un compte (cas 8 en vol), suppression lente : ni nouveau compte, ni cas 9 ; le cas coupé est compté au pire", async () => {
    const faux = fauxPorts({ delais: { ...lents, supprimer: 60 }, signalA: "lancer 8" });
    await lancerMesure(entreeFaite({ options: { confirmer: true }, chargerJeu: () => jeuFait(10) }), faux.ports);
    await faux.fin;
    expect(apresSignal(faux.appels)).toEqual([]);
    expect(faux.appels).not.toContain("creer 2");
    const cas8 = faux.json(`${DOSSIER}/cas-08.json`) as ResultatCas;
    expect(cas8).toMatchObject({ credits: { total: 2, estime: true } });
    expect(cas8.erreur).toMatch(/lancement sans réponse/);
    const meta = faux.json(`${DOSSIER}/mesure.json`) as MetaMesure;
    expect(meta.nettoyage).toEqual({ comptes: 1, supprimes: 1, restes: [] });
    // Le rapport est écrit après le rangement du cas coupé : 8 cas, 16 crédits.
    expect(faux.ecrits.get(`${DOSSIER}/rapport.md`)).toContain("Crédits SerpApi dépensés : 16");
    expect(faux.ecrits.get(`${DOSSIER}/rapport.md`)).toContain("Mesure arrêtée avant la fin : interrompue (Ctrl-C)");
    expect(faux.apresFin).toEqual([]);
  });

  it("Ctrl-C pendant un lancement (cas 2), suppression lente : le serveur est arrêté d'abord, puis le compte supprimé par l'administration", async () => {
    const faux = fauxPorts({ delais: { ...lents, supprimer: 80 }, signalA: "lancer 2" });
    await lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports);
    await faux.fin;
    expect(apresSignal(faux.appels)).toEqual([]);
    expect(faux.ports.lancer).toHaveBeenCalledTimes(2);
    const signal = faux.appels.indexOf("SIGNAL SIGINT");
    expect(faux.appels.indexOf("arreter", signal)).toBeLessThan(faux.appels.indexOf("supprimer compte-1", signal));
    expect(vi.mocked(faux.ports.supprimerCompte).mock.calls[0]![1]).toBeNull();
    expect(faux.json(`${DOSSIER}/mesure.json`)).toMatchObject({ nettoyage: { comptes: 1, supprimes: 1, restes: [] } });
    expect(faux.json(`${DOSSIER}/comptes.json`)).toMatchObject({ comptes: [{ id: "compte-1", etat: "supprime" }] });
    expect(faux.apresFin).toEqual([]);
  });

  it("le dernier balayage supprime un compte de l'exécution que l'outil n'aurait pas vu", async () => {
    const faux = fauxPorts({ balayage: [{ numero: 0, id: "compte-x", email: "mesure-voie-c-abc123-ffff@example.com" }] });
    await lancerMesure(entreeFaite({ options: { confirmer: true } }), faux.ports);
    expect(faux.appels).toContain("supprimer compte-x");
    expect(faux.json(`${DOSSIER}/mesure.json`)).toMatchObject({ nettoyage: { comptes: 2, supprimes: 2, restes: [] } });
  });

  it("essai à blanc : Ctrl-C pendant la création du compte → il est attendu, puis supprimé ; rien d'autre ne part", async () => {
    const faux = fauxPorts({ delais: lents, signalA: "creer 1" });
    await lancerMesure(entreeFaite({ options: { confirmer: false } }), faux.ports);
    await faux.fin;
    expect(apresSignal(faux.appels)).toEqual([]);
    expect(faux.appels).not.toContain("sonder");
    expect(faux.appels).toContain("supprimer compte-1");
    expect(faux.json("/sorties/2026-11-05_09-00-00-essai-a-blanc/comptes.json")).toMatchObject({ comptes: [{ id: "compte-1", etat: "supprime" }] });
    expect(faux.apresFin).toEqual([]);
  });

  it("dans un vrai processus lancé par tsx : deux SIGINT au groupe (Ctrl-C deux fois) ne coupent jamais le nettoyage", async () => {
    const { trace, enfant, fin, nettoyer } = lancerFixtureInterruption();
    try {
      await attendreQue(() => lireTexte(trace).includes("prêt"), 30_000);
      process.kill(-enfant.pid!, "SIGINT");
      await attendreQue(() => lireTexte(trace).includes("nettoyage commencé"), 10_000);
      process.kill(-enfant.pid!, "SIGINT");
      const code = await fin;
      expect(lireTexte(trace)).toContain("nettoyage commencé (SIGINT)");
      expect(lireTexte(trace)).toContain("nettoyage fini");
      expect(code).toBe(130);
    } finally {
      nettoyer();
    }
  });

  it("dans un vrai processus lancé par tsx : Terminal fermé (SIGHUP au groupe), puis SIGTERM : le nettoyage va au bout", async () => {
    const { trace, enfant, nettoyer } = lancerFixtureInterruption();
    try {
      await attendreQue(() => lireTexte(trace).includes("prêt"), 30_000);
      process.kill(-enfant.pid!, "SIGHUP");
      await attendreQue(() => lireTexte(trace).includes("nettoyage commencé"), 10_000);
      try {
        process.kill(-enfant.pid!, "SIGTERM");
      } catch {
        // tsx (le parent) est mort au SIGHUP : le groupe peut ne plus avoir que l'outil.
      }
      await attendreQue(() => lireTexte(trace).includes("nettoyage fini"), 10_000);
      expect(lireTexte(trace)).toContain("nettoyage commencé (SIGHUP)");
    } finally {
      nettoyer();
    }
  });
});

describe("reprise, mesures précédentes, nettoyage après coup", () => {
  const HIER = "/sorties/2026-11-04_10-00-00";

  it("mesures précédentes : la dépense du jour (heure de Paris) et les mesures de moins de 24 h ; un essai à blanc ne compte pas", () => {
    const fichiers = new Map<string, string>([
      ["/s/a/mesure.json", JSON.stringify({ ...metaFaite(), debut: "2026-11-05T06:00:00.000Z" })],
      ["/s/a/cas-01.json", JSON.stringify(resultatFait(1, { lens: ["x"], boutiques: [], marqueVisible: true, horodatage: "2026-11-05T06:01:00.000Z" }))],
      ["/s/a/cas-02.json", JSON.stringify(resultatFait(2, { lens: ["x"], boutiques: [], marqueVisible: true, horodatage: "2026-11-05T06:02:00.000Z" }))],
      ["/s/b/mesure.json", JSON.stringify({ ...metaFaite(), debut: "2026-11-03T06:00:00.000Z" })],
      ["/s/b/cas-01.json", JSON.stringify(resultatFait(1, { lens: ["x"], boutiques: [], marqueVisible: true, horodatage: "2026-11-03T06:01:00.000Z" }))],
      ["/s/c-essai-a-blanc/comptes.json", "{}"],
    ]);
    const anterieures = mesuresAnterieures("/s", [], fauxFichiers(fichiers), Date.parse("2026-11-05T08:00:00.000Z"));
    expect(anterieures).toEqual({ depensesDuJour: 4, recentes: [{ dossier: "/s/a", dernier: "2026-11-05T06:02:00.000Z" }] });
  });

  it("une mesure de moins de 24 h : avec --confirmer, refus avant toute dépense (le cache fausserait durées et boutiques) ; sans, un avertissement", async () => {
    const fichiers = new Map<string, string>([
      ["/sorties/2026-11-05_07-00-00/mesure.json", JSON.stringify({ ...metaFaite(), debut: "2026-11-05T06:00:00.000Z" })],
      ["/sorties/2026-11-05_07-00-00/cas-01.json", JSON.stringify(resultatFait(1, { lens: ["x"], boutiques: [], marqueVisible: true, horodatage: "2026-11-05T06:01:00.000Z" }))],
    ]);
    const confirme = fauxPorts({ fichiers });
    await expect(lancerMesure(entreeFaite({ options: { confirmer: true } }), confirme.ports)).rejects.toThrow(/Une mesure a moins de 24 h .* --reprendre \/sorties\/2026-11-05_07-00-00/);
    expect(confirme.ports.demarrerServeur).not.toHaveBeenCalled();
    const aBlanc = fauxPorts({ fichiers });
    await lancerMesure(entreeFaite({ options: { confirmer: false } }), aBlanc.ports);
    expect(aBlanc.texte()).toContain("⚠ Mesure de moins de 24 h : /sorties/2026-11-05_07-00-00");
    expect(aBlanc.texte()).toContain("⚠ Avec --confirmer : refus.");
    expect(aBlanc.texte()).toContain("Déjà dépensé aujourd'hui par les mesures précédentes (dossier des sorties) : 2 crédit(s)");
  });

  it("--reprendre : seuls les cas absents ou en panne sont relancés, dans le même dossier ; l'ancien lancement est gardé ; un seul rapport", async () => {
    const fichiers = new Map<string, string>([
      [`${HIER}/mesure.json`, JSON.stringify({ ...metaFaite(), debut: "2026-11-04T09:00:00.000Z", execution: "0ld0ld", arret: "2 pannes de suite" })],
      [`${HIER}/cas-01.json`, JSON.stringify(resultatFait(1, { lens: ["Maison Exemple veste Alpha"], boutiques: [], marqueVisible: true, horodatage: "2026-11-04T09:01:00.000Z" }))],
      [`${HIER}/cas-02.json`, JSON.stringify(resultatFait(2, { lens: [], boutiques: [], marqueVisible: false, issue: "panne", erreur: "lancement sans réponse", horodatage: "2026-11-04T09:02:00.000Z", credits: 2 }))],
      [`${HIER}/comptes.json`, JSON.stringify({ version: 1, comptes: [{ execution: "0ld0ld", numero: 1, id: "ancien-1", email: "mesure-voie-c-0ld0ld-1@example.com", etat: "supprime" }] })],
    ]);
    const faux = fauxPorts({ fichiers });
    await lancerMesure(entreeFaite({ options: { confirmer: true, reprendre: HIER } }), faux.ports);
    expect(vi.mocked(faux.ports.lancer).mock.calls.map((appel) => appel[3].nomFichier)).toEqual(["cas-02.jpg", "cas-03.jpg"]);
    expect(faux.ecrits.has(`${HIER}/cas-02.remplace-abc123.json`)).toBe(true);
    expect(faux.ecrits.has(`${HIER}/cas-03.json`)).toBe(true);
    expect(faux.ecrits.has(`${DOSSIER}/mesure.json`)).toBe(false);
    const meta = faux.json(`${HIER}/mesure.json`) as MetaMesure;
    expect(meta.reprise).toEqual({ debutPrecedent: "2026-11-04T09:00:00.000Z", casGardes: 1, casRefaits: ["2", "3"] });
    expect(meta.precedentes?.[0]).toMatchObject({ debut: "2026-11-04T09:00:00.000Z", arret: "2 pannes de suite" });
    const rapport = faux.ecrits.get(`${HIER}/rapport.md`) as string;
    expect(rapport).toContain("3 cas dans ce rapport (mesure reprise), chaque photo envoyée comme l'app");
    expect(rapport).toContain("Mesure reprise (--reprendre) : 1 cas gardés de la mesure du 4 novembre 2026 à 10:00, refaits ici : 2, 3.");
    // 1 (gardé) + 2 (refaits) cas mesurés, plus les 2 crédits du lancement en panne refait.
    expect(rapport).toContain("Crédits SerpApi dépensés : 8 (plafond fixé : 60) — dont 2 pour des lancements refaits ensuite");
    expect(faux.json(`${HIER}/comptes.json`)).toMatchObject({ comptes: [{ id: "ancien-1", etat: "supprime" }, { id: "compte-1", execution: "abc123", etat: "supprime" }] });
  });

  it("--reprendre le même jour : le budget repart du déjà dépensé (cumul), jamais d'un plafond neuf", async () => {
    const aujourdhui = "/sorties/2026-11-05_07-00-00";
    const fichiers = new Map<string, string>([
      [`${aujourdhui}/mesure.json`, JSON.stringify({ ...metaFaite(), debut: "2026-11-05T06:00:00.000Z" })],
      [`${aujourdhui}/cas-01.json`, JSON.stringify(resultatFait(1, { lens: ["x"], boutiques: [], marqueVisible: true, horodatage: "2026-11-05T06:01:00.000Z", credits: 56 }))],
    ]);
    const faux = fauxPorts({ fichiers });
    await lancerMesure(entreeFaite({ options: { confirmer: true, reprendre: aujourdhui } }), faux.ports);
    expect(faux.texte()).toContain("Déjà dépensé aujourd'hui par les mesures précédentes (dossier des sorties) : 56 crédit(s), retranché(s) du plafond : il reste 4.");
    expect(faux.ports.lancer).toHaveBeenCalledTimes(2);
    expect((faux.json(`${aujourdhui}/mesure.json`) as MetaMesure).arret).toBeNull();
    expect(faux.envServeurs()[0]?.SERPAPI_DAILY_CAP).toBe("7");
  });

  it("--nettoyer : chaque compte listé et pas encore supprimé, puis le balayage par l'adresse ; comptes.json, mesure.json et rapport mis à jour", async () => {
    const coupe = "/sorties/2026-11-05_07-00-00";
    const fichiers = new Map<string, string>([
      [`${coupe}/mesure.json`, JSON.stringify({ ...metaFaite(), execution: "c0up33", arret: ARRET_COUPURE, nettoyage: { comptes: 2, supprimes: 0, restes: ["c-1", "c-2"] } })],
      [`${coupe}/cas-01.json`, JSON.stringify(resultatFait(1, { lens: ["x"], boutiques: [], marqueVisible: true }))],
      [
        `${coupe}/comptes.json`,
        JSON.stringify({
          version: 1,
          comptes: [
            { execution: "c0up33", numero: 1, id: "c-1", email: "mesure-voie-c-c0up33-1@example.com", etat: "supprime" },
            { execution: "c0up33", numero: 2, id: "c-2", email: "mesure-voie-c-c0up33-2@example.com", etat: "cree" },
          ],
        }),
      ],
    ]);
    const faux = fauxPorts({ fichiers, balayage: [{ numero: 0, id: "c-3", email: "mesure-voie-c-c0up33-3@example.com" }] });
    const bilan = await nettoyerDossier(coupe, faux.ports, { etat: "absent" });
    expect(bilan).toEqual({ supprimes: 3, restes: 0 });
    expect(faux.appels.filter((a) => a.startsWith("supprimer"))).toEqual(["supprimer c-2", "supprimer c-3"]);
    expect(vi.mocked(faux.ports.supprimerCompte).mock.calls.every((appel) => appel[1] === null)).toBe(true);
    expect(faux.json(`${coupe}/mesure.json`)).toMatchObject({ nettoyage: { comptes: 3, supprimes: 3, restes: [] }, arret: "coupure brutale : l'outil s'est arrêté sans finir ; comptes d'essai repris ensuite par --nettoyer" });
    expect(faux.ecrits.get(`${coupe}/rapport.md`)).toContain("Comptes d'essai : 3/3 supprimés");
    expect(faux.ports.lancer).not.toHaveBeenCalled();
  });
});

describe("ports réels, sans réseau : la photo comme l'app l'importe", () => {
  it("1 600 px au plus, JPEG ; zone analysée comme le serveur, avec son empreinte", async () => {
    const dossier = mkdtempSync(join(tmpdir(), "mesure-voie-c-image-"));
    try {
      const photo = join(dossier, "cas01.png");
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toFile(photo);
      const ports = portsReels({ environnement: ENV_FACTICE, secrets: [], execution: "abc123" });
      const image = await ports.imageCommeLApp(photo);
      expect([image.largeur, image.hauteur]).toEqual([1600, 800]);
      expect((await sharp(image.jpeg).metadata()).format).toBe("jpeg");
      const zone = await ports.zoneAnalysee(image.jpeg, { x: 0.27, y: 0.28, width: 0.73, height: 0.53 });
      expect((await sharp(zone.zone).metadata()).width).toBe(1168);
      expect(zone.empreinte).toMatch(/^[0-9a-f]{64}$/);
      expect((await ports.zoneAnalysee(image.jpeg, { x: 0.27, y: 0.28, width: 0.73, height: 0.53 })).empreinte).toBe(zone.empreinte);
      expect(ports.lire(join(dossier, "absent.json"))).toBeNull();
      expect(ports.lister(join(dossier, "absent"))).toEqual([]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

// ---- Faux ----

function lireTexte(chemin: string): string {
  return existsSync(chemin) ? readFileSync(chemin, "utf8") : "";
}

async function attendreQue(condition: () => boolean, delaiMs: number): Promise<void> {
  const limite = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > limite) throw new Error("délai dépassé");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Le gestionnaire réel (interruption.ts) dans un processus lancé par la CLI de tsx, dans son propre groupe (comme un Terminal). */
function lancerFixtureInterruption() {
  const dossier = mkdtempSync(join(tmpdir(), "mesure-voie-c-signaux-"));
  const trace = join(dossier, "trace.txt");
  const cli = createRequire(import.meta.url).resolve("tsx/cli");
  const enfant = spawn(process.execPath, [cli, join(BACKEND, "tests", "fixtures", "mesure-voie-c-interruption.ts"), trace], { cwd: BACKEND, detached: true, stdio: "ignore" });
  const fin = new Promise<number | null>((resolve) => enfant.once("exit", (code) => resolve(code)));
  const nettoyer = () => {
    try {
      process.kill(-enfant.pid!, "SIGKILL");
    } catch {
      // Déjà fini.
    }
    rmSync(dossier, { recursive: true, force: true });
  };
  return { trace, enfant, fin, nettoyer };
}

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
    { msg: "Mesure complément", champs: { status: "shown", calls: 1, aiMs: 900, shoppingMs: 1800, totalMs: 8000, inputTokens: 700, outputTokens: 40 } },
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
  options: {
    lens: string[];
    boutiques: string[];
    statut?: string;
    dureeMs?: number;
    preparationMs?: number;
    marqueVisible: boolean;
    issue?: ResultatCas["issue"];
    erreur?: string;
    passe?: ResultatCas["passe"];
    lensDuCache?: boolean;
    sansComplementAuJournal?: boolean;
    marque?: string;
    modele?: string;
    horodatage?: string;
    credits?: number;
  }
): ResultatCas {
  const lue = lireReponse(reponseFaite(options.lens, options.boutiques, options.statut))!;
  const { lens, boutiques, ...reponse } = lue;
  const mesure = (options.issue ?? "mesure") === "mesure";
  const credits = options.credits ?? (mesure ? 2 : 0);
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
    ligne: mesure ? ligneFaite({ lens_from_cache: options.lensDuCache ?? false, ...(options.sansComplementAuJournal ? { shopping_calls: 0, complement_status: "skipped" } : {}) }) : null,
    journal: mesure ? resumerJournal(options.sansComplementAuJournal ? [{ msg: "Mesure complément", champs: { status: "skipped", calls: 0, aiMs: null, shoppingMs: null, totalMs: 900 } }] : journalFait()) : null,
    durees: { preparationMs: options.preparationMs ?? 300, lancementMs: mesure ? (options.dureeMs ?? 9000) : null },
    credits: { lens: credits > 0 ? 1 : 0, shopping: credits > 1 ? 1 : 0, total: credits, selonJournal: credits, estime: false },
    compte: 1,
    horodatage: options.horodatage ?? "2026-11-05T08:00:00.000Z",
  };
}

function metaFaite(): MetaMesure {
  return {
    version: 1,
    debut: "2026-11-05T08:00:00.000Z",
    fin: "2026-11-05T08:10:00.000Z",
    serveur: { commit: "abc1234", identiqueAMain: true, commitMain: "3db7dda" },
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
    options: { confirmer: false, jeu: "/jeu", cadres: "/jeu/cadres-traces.txt", sortie: "/sorties", plafond: 60, mots: "avec", refaireRapport: null, reprendre: null, nettoyer: null, ...changes.options },
    environnement: changes.environnement ?? ENV_DEV,
    chargerJeu: changes.chargerJeu ?? (() => jeuFait()),
    jugements: { etat: "absent" },
    lireCleAnthropic: () => "sk-ant-cle-d-essai",
    depot: { commit: "abc1234", identiqueAMain: true },
    dossierSortie: DOSSIER,
    envAbsent: "/tmp/absent",
    cadresTracesParClaude: true,
    execution: "abc123",
  };
}

/** Lecture et liste de fichiers, sur une table en mémoire. */
function fauxFichiers(...tables: ReadonlyMap<string, string | Buffer>[]): Pick<PortsMesure, "lire" | "lister"> {
  const tous = () => tables.flatMap((table) => [...table.keys()]);
  return {
    lire: (chemin) => {
      for (const table of tables) {
        const contenu = table.get(chemin);
        if (contenu !== undefined) return contenu.toString();
      }
      return null;
    },
    lister: (dossier) => [...new Set(tous().filter((c) => c.startsWith(`${dossier}/`)).map((c) => c.slice(dossier.length + 1).split("/")[0]!))],
  };
}

interface FauxServeur extends ServeurLocal {
  arrete: boolean;
  enVol: Set<(erreur: Error) => void>;
}

interface Reglages {
  etatLens?: string;
  sonde?: { statut: number; erreur: string | null };
  preparerEchoueAu?: number;
  /** Lancement n (1, 2, …) : sa ligne relue (et son statut) à la place du cas normal. */
  lancement?: (n: number, envoi: EnvoiApp) => { ligne: LigneRecherche; statut: number } | undefined;
  /** Durées réelles (ms) : création, suppression de compte, lancement. */
  delais?: { creer?: number; supprimer?: number; lancer?: number };
  /** Le signal (SIGINT) arrive pendant cet événement (« creer 2 », « lancer 8 »), sans être attendu. */
  signalA?: string;
  /** Fichiers déjà là (mesures précédentes). */
  fichiers?: Map<string, string>;
  /** Comptes de l'exécution trouvés par le balayage. */
  balayage?: CompteCree[];
}

function fauxPorts(reglages: Reglages = {}) {
  const appels: string[] = [];
  const apresFin: string[] = [];
  const affichages: string[] = [];
  const ecrits = new Map<string, string | Buffer>();
  const historique: { chemin: string; contenu: string | Buffer }[] = [];
  const lignes = new Map<string, LigneRecherche>();
  const envs: Record<string, string>[] = [];
  const fichiers = fauxFichiers(ecrits, reglages.fichiers ?? new Map());
  const balayage = [...(reglages.balayage ?? [])];
  let action: ((signal: string) => Promise<void>) | null = null;
  let signalRecu = false;
  let termine = false;
  let resoudreFin: () => void = () => undefined;
  const fin = new Promise<void>((resolve) => (resoudreFin = resolve));
  let preparations = 0;
  let lancements = 0;
  const dormir = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const declencher = async (signal: string) => {
    appels.push(`SIGNAL ${signal}`);
    // Comme le gestionnaire réel : seul le premier signal compte.
    if (!action || signalRecu) return;
    signalRecu = true;
    await action(signal);
    // process.exit simulé : tout appel après est une faute.
    termine = true;
    resoudreFin();
  };
  const noter = (evenement: string) => {
    appels.push(evenement);
    if (termine) apresFin.push(evenement);
    if (reglages.signalA === evenement) setTimeout(() => void declencher("SIGINT"), 1);
  };
  /** Une opération qui dure ; le serveur arrêté fait échouer ce qui est en vol. */
  const enVol = async (serveur: FauxServeur, ms: number) => {
    if (serveur.arrete) throw new Error("serveur arrêté");
    await new Promise<void>((resolve, reject) => {
      const minuterie = setTimeout(() => {
        serveur.enVol.delete(rejeter);
        resolve();
      }, ms);
      const rejeter = (erreur: Error) => {
        clearTimeout(minuterie);
        reject(erreur);
      };
      serveur.enVol.add(rejeter);
    });
  };
  const ports: PortsMesure = {
    maintenant: () => Date.parse("2026-11-05T08:00:00.000Z"),
    afficher: (texte) => affichages.push(texte),
    ecrire: (chemin, contenu) => {
      ecrits.set(chemin, contenu);
      historique.push({ chemin, contenu });
    },
    creerDossier: () => undefined,
    lire: fichiers.lire,
    lister: fichiers.lister,
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
      noter("demarrer");
      envs.push(environnement);
      const serveur: FauxServeur = {
        url: "http://127.0.0.1:4321",
        journal: [],
        arrete: false,
        enVol: new Set(),
        arreter: async () => {
          if (serveur.arrete) return;
          serveur.arrete = true;
          appels.push("arreter");
          for (const rejeter of serveur.enVol) rejeter(new Error("serveur arrêté"));
        },
      };
      return serveur;
    }),
    creerCompte: vi.fn(async (numero: number, surCree: (compte: CompteCree) => void) => {
      noter(`creer ${numero}`);
      const compte = { numero, id: `compte-${numero}`, email: `mesure-voie-c-abc123-${numero}@example.com` };
      surCree(compte);
      await dormir(reglages.delais?.creer ?? 0);
      return { ...compte, jeton: `jeton-secret-${numero}` };
    }),
    supprimerCompte: vi.fn(async (compte: CompteEssai | { id: string }) => {
      noter(`supprimer ${compte.id}`);
      await dormir(reglages.delais?.supprimer ?? 0);
      return true;
    }),
    comptesDeLExecution: vi.fn(async () => {
      noter("balayer");
      return balayage.splice(0);
    }),
    preparer: vi.fn(async (serveur: ServeurLocal) => {
      noter("preparer");
      if ((serveur as FauxServeur).arrete) throw new Error("serveur arrêté");
      preparations += 1;
      if (reglages.preparerEchoueAu === preparations) throw new Error("réseau coupé");
      return { statut: 200, id: `recherche-${preparations}`, erreur: null };
    }),
    sonderVoieC: vi.fn(async () => {
      noter("sonder");
      return reglages.sonde ?? { statut: 409, erreur: "text_search_not_allowed" };
    }),
    lancer: vi.fn(async (serveur: ServeurLocal, _compte: CompteEssai, id: string, envoi: EnvoiApp) => {
      lancements += 1;
      noter(`lancer ${lancements}`);
      const s = serveur as FauxServeur;
      // Le serveur marque la recherche en cours avant d'appeler Lens.
      lignes.set(id, ligneFaite({ status: "processing" }));
      await enVol(s, reglages.delais?.lancer ?? 0);
      const special = reglages.lancement?.(lancements, envoi);
      const iaCoupee = envs[envs.length - 1]?.VOIE_C_AI_ENABLED === "false";
      if (special) {
        lignes.set(id, special.ligne);
        s.journal.push({ msg: "Mesure complément", champs: { status: special.ligne.complement_status, calls: 0, totalMs: 9000 } });
        return { statut: special.statut, corps: reponseFaite(["Autre"], [], special.ligne.complement_status ?? "shown"), dureeMs: 12_000 };
      }
      if (iaCoupee) {
        lignes.set(id, ligneFaite({ lens_from_cache: true, shopping_calls: 0, complement_status: "skipped", served_from_cache: true }));
        s.journal.push({ msg: "Mesure complément", champs: { status: "skipped", lensFromCache: true, calls: 0, aiMs: null, shoppingMs: null, totalMs: 900 } });
        return { statut: 200, corps: reponseFaite(["Maison Exemple veste Alpha", "Autre"], [], "skipped"), dureeMs: 1100 };
      }
      s.journal.push(...journalFait());
      lignes.set(id, ligneFaite());
      return { statut: 200, corps: reponseFaite(["Maison Exemple veste Alpha", "Autre"], ["Exemple Alpha jacket"]), dureeMs: 8200 };
    }),
    lireLigne: async (id) => lignes.get(id) ?? null,
    imageCommeLApp: async () => ({ jpeg: Buffer.from("jpeg"), largeur: 1200, hauteur: 1600 }),
    zoneAnalysee: async () => ({ zone: Buffer.from("zone"), empreinte: "a".repeat(64) }),
    // Durées réelles réduites au centième (5 s → 50 ms) : les bornes d'attente restent dans le bon ordre.
    attendre: (ms) => dormir(Math.ceil(ms / 100)),
    surInterruption: (nouvelle) => {
      action = nouvelle;
      return () => {
        if (!signalRecu) action = null;
      };
    },
  };
  return {
    ports,
    appels,
    apresFin,
    ecrits,
    fin,
    envServeurs: () => envs,
    texte: () => affichages.join("\n"),
    json: (chemin: string): unknown => JSON.parse(String(ecrits.get(chemin))),
    premierEcrit: (chemin: string) => {
      const premier = historique.find((h) => h.chemin === chemin);
      return premier ? String(premier.contenu) : null;
    },
  };
}

