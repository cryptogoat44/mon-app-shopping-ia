// Série de mesure sans nouvelles photos (décisions du fondateur, 2026-10-24) :
// lots 10 (en premier), 2, 3, 9, 11 et 7, 46 recherches au plus, enchaînés
// sous UNE phrase tapée par le fondateur (PHRASE_SERIE). Le lot 12 n'en fait pas partie.
//
//   pnpm --filter backend serie-mesure <pieces.json>                       état et plan (aucun appel)
//   pnpm --filter backend serie-mesure <pieces.json> --nouvelle-reference  relit le compteur et le prend pour référence
//   pnpm --filter backend serie-mesure <pieces.json> --confirmer           lance ou reprend la série
//
// Garde-fous (serie-garde-fous.ts) : spotto-dev seulement ; relevé écrit
// avant et après chaque appel (docs/, hors de Git) ; arrêt à la première
// panne ou après 3 réponses vides ; réserve de 30 ; 30 recherches par jour ;
// page d'état relue avant chaque appel ; compteur relu et comparé au relevé
// avant et après chaque lot ; reprise sans refaire une recherche facturée ;
// aucun visage sur une image envoyée ; aucun titre, adresse ni image gardés.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../src/env.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";
import { contenusInterdits, factureeSelonSerpApi } from "./lib/essai-type.js";
import type { Piece } from "./lib/mesure-texte.js";
import { appelBoutiques, appelLens, appelShopping, brancherSerpApi, lireCompteur, lirePageEtat, verifierLien, viderStockage, type Branchement, type ReponseSerpApi } from "./lib/serie-appels.js";
import { appelsDuJour, attenteHoraireMinutes, controlerCompteur, decisionReprise, etapeSuivante, factureesSelonReleve, FIN_SERIE, finOuArret, jourParis, LIMITE_HEURE, lireOptions, PLAFOND_JOUR, RELEVE_SERIE, reserveSuffisante, servicesDuLot, servicesOperationnels, type Compteur, type LigneSerie, type ReleveSerie } from "./lib/serie-garde-fous.js";
import { compilerDetection, imageDeLEtape, sansVisage } from "./lib/serie-images.js";
import { mesurerBoutiques, mesurerLens, mesurerShopping, pertinenceDouteuse, type ProduitChoisi } from "./lib/serie-mesures.js";
import { ecrirePlanche } from "./lib/serie-planche.js";
import { AUTORISATION_SERIE, PHRASE_SERIE, piecesDeSerie, planSerie, titreEtape, type EtapeSerie, type NomPiece } from "./lib/serie-plan.js";

const DOSSIER = fileURLToPath(new URL("../../../docs/serie-mesure/", import.meta.url));
const FICHIER = join(DOSSIER, "releve-serie.json");
const PLAN = planSerie();

/** Arrêt voulu (garde-fou) : le message est pour le fondateur, sans contenu. */
class ArretSerie extends Error {}

interface Contexte {
  admin: SupabaseClient;
  branchement: Branchement;
  travail: string;
  binaireVisages: string;
  pieces: Map<NomPiece, Piece>;
  releve: ReleveSerie;
  /** Produit de Google Shopping Light par pièce : en mémoire seulement. */
  produits: Map<NomPiece, ProduitChoisi>;
}

function lireReleve(): ReleveSerie {
  if (!existsSync(FICHIER)) return { phrase: PHRASE_SERIE, reference: null, lignes: [], lots: [] };
  return RELEVE_SERIE.parse(JSON.parse(readFileSync(FICHIER, "utf8")));
}

/** Écrit le relevé, après avoir vérifié qu'il ne contient ni adresse, ni clé, ni e-mail. */
function ecrireReleve(releve: ReleveSerie): void {
  const texte = `${JSON.stringify(RELEVE_SERIE.parse(releve), null, 2)}\n`;
  const problemes = [...contenusInterdits(texte), ...(/https?:\/\//i.test(texte) ? ["adresse"] : [])];
  if (problemes.length > 0) throw new ArretSerie(`Relevé NON écrit : ${problemes.join(", ")}. Série arrêtée.`);
  mkdirSync(DOSSIER, { recursive: true });
  writeFileSync(FICHIER, texte);
}

const piece = (contexte: Contexte, nom: NomPiece): Piece => {
  const trouvee = contexte.pieces.get(nom);
  if (!trouvee) throw new ArretSerie(`Pièce absente : ${nom}.`);
  return trouvee;
};

function nouvelleLigne(etape: EtapeSerie): LigneSerie {
  return { numero: etape.numero, lot: etape.lot, piece: etape.piece, service: etape.service, lanceeLe: new Date().toISOString(), issue: "en_cours", code: null, statutSerpApi: null, facturee: "inconnu", secondes: null, mesures: null, message: null };
}

function terminer(ligne: LigneSerie, reponse: ReponseSerpApi, vide: boolean, mesures: LigneSerie["mesures"], message: string | null = null): void {
  ligne.code = reponse.code;
  ligne.statutSerpApi = reponse.statut;
  ligne.facturee = factureeSelonSerpApi(reponse.code, reponse.statut);
  ligne.secondes = reponse.secondes;
  ligne.issue = reponse.code !== null && reponse.code >= 400 ? "erreur" : vide ? "vide" : "reussie";
  ligne.mesures = mesures;
  ligne.message = message;
}

/** Une étape Google Lens : image préparée et contrôlée (aucun visage), appel, mesure. */
async function etapeLens(contexte: Contexte, etape: Extract<EtapeSerie, { service: "lens" }>, ligne: LigneSerie): Promise<void> {
  const p = piece(contexte, etape.piece);
  const { image, details } = await imageDeLEtape(p, etape.image, contexte.travail);
  if (!sansVisage(contexte.binaireVisages, image, contexte.travail)) {
    Object.assign(ligne, { issue: "non_lancee", facturee: "non", message: "visage détecté : image non envoyée" });
    ecrireReleve(contexte.releve);
    throw new ArretSerie(`Visage détecté sur l'image de l'étape ${etape.numero} (${etape.piece}) : rien n'a été envoyé. Série arrêtée.`);
  }
  if (etape.sansCache) contexte.branchement.sansCacheAuProchain();
  const reponse = await appelLens(contexte.admin, image, etape.locale, etape.texte ? p.texte : null);
  const { mesure, domainesGardes, ajouts } = mesurerLens(reponse, etape.locale.country);
  const mesures: NonNullable<LigneSerie["mesures"]> = {
    recues: mesure.received, gardees: mesure.kept, avecPrix: mesure.keptWithPrice, autreDevise: mesure.keptOtherCurrency, sites: mesure.distinctSites,
    rubriques: mesure.sections, domainesGardes: domainesGardes.slice(0, 30), ajouts: ajouts.map(({ rang, domaine, devise }) => ({ rang, domaine, devise })), ...details,
  };
  // La mesure est relevée d'abord : une planche impossible ne doit pas la faire perdre.
  terminer(ligne, contexte.branchement.derniere(), mesure.received === 0, mesures);
  if (!etape.planche || ajouts.length === 0) return;
  try {
    const planche = await ecrirePlanche(`lot-${etape.lot}-etape-${etape.numero}-${etape.piece}`, ajouts, contexte.binaireVisages, contexte.travail);
    Object.assign(mesures, { plancheMontrees: planche.montrees, plancheEcartees: planche.ecartees });
  } catch {
    ligne.message = "planche impossible (la mesure est gardée)";
  }
}

/** Une étape Google Shopping Light : texte seul (les mots du 8 octobre). */
async function etapeShopping(contexte: Contexte, etape: EtapeSerie, ligne: LigneSerie): Promise<void> {
  const texte = piece(contexte, etape.piece).texte;
  const reponse = await appelShopping(texte);
  const mesure = reponse.code !== null && reponse.code < 400 ? mesurerShopping(reponse.json, texte) : null;
  if (!mesure && (reponse.code === null || reponse.code < 400)) throw new Error("Google Shopping Light : réponse illisible");
  if (mesure?.produit) contexte.produits.set(etape.piece, mesure.produit);
  terminer(ligne, reponse, (mesure?.mesures.resultats ?? 0) === 0, mesure?.mesures ?? null, mesure && pertinenceDouteuse(mesure.mesures) ? "pertinence douteuse" : null);
}

/** Domaines gardés par Google Lens pour la pièce (lot 2, dernière mesure) ;
 * null si Lens n'a pas encore tourné (lot 10 en premier) : la comparaison se fait dans le rapport. */
function domainesLensDe(releve: ReleveSerie, nom: NomPiece): string[] | null {
  const ligne = releve.lignes.filter((l) => l.lot === 2 && l.piece === nom && l.service === "lens" && l.issue === "reussie").at(-1);
  const domaines = ligne?.mesures?.domainesGardes;
  return Array.isArray(domaines) ? domaines.filter((d): d is string => typeof d === "string") : null;
}

/** Une étape « lien marchand » : les boutiques du produit choisi, puis la vérification du premier lien. */
async function etapeBoutiques(contexte: Contexte, etape: Extract<EtapeSerie, { service: "immersive" | "product" }>, ligne: LigneSerie): Promise<void> {
  const produit = contexte.produits.get(etape.piece);
  if (!produit) {
    Object.assign(ligne, { issue: "non_lancee", facturee: "non", message: "aucun produit de Google Shopping Light en mémoire" });
    return;
  }
  const reponse = await appelBoutiques(etape.service, produit);
  const mesure = reponse.code !== null && reponse.code < 400 ? mesurerBoutiques(reponse.json, domainesLensDe(contexte.releve, etape.piece)) : null;
  if (!mesure && (reponse.code === null || reponse.code < 400)) throw new Error("Boutiques du produit : réponse illisible");
  const premier = mesure?.liens[0];
  const lien = premier ? await verifierLien(premier) : null;
  const mesures = mesure ? { ...mesure.mesures, lienDomaineFinal: lien?.domaineFinal ?? null, lienCode: lien?.code ?? null } : null;
  terminer(ligne, reponse, (mesure?.mesures.boutiques ?? 0) === 0, mesures);
}

/** Une étape : relevé écrit AVANT tout appel (« en cours »), puis complété après. */
async function faireEtape(contexte: Contexte, etape: EtapeSerie): Promise<LigneSerie> {
  const ligne = nouvelleLigne(etape);
  contexte.branchement.reinitialiser();
  contexte.releve.lignes.push(ligne);
  ecrireReleve(contexte.releve);
  try {
    if (etape.service === "lens") await etapeLens(contexte, etape, ligne);
    else if (etape.service === "shopping") await etapeShopping(contexte, etape, ligne);
    else await etapeBoutiques(contexte, etape, ligne);
  } catch (error) {
    if (error instanceof ArretSerie) throw error;
    const reponse = contexte.branchement.derniere();
    ligne.issue = "panne";
    ligne.code = reponse.code;
    ligne.facturee = factureeSelonSerpApi(reponse.code, reponse.statut);
    ligne.message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[adresse]").slice(0, 160);
  }
  ecrireReleve(contexte.releve);
  return ligne;
}

/** Une ligne restée « en cours » (session interrompue) : le compteur tranche, sans jamais refaire une recherche facturée. */
async function trancherEnCours(releve: ReleveSerie): Promise<void> {
  const enCours = releve.lignes.find((l) => l.issue === "en_cours");
  if (!enCours || !releve.reference) return;
  const decision = decisionReprise(releve.reference, await lireCompteur(), releve.lignes);
  if (decision === "ecart") throw new ArretSerie(`Reprise : le compteur de SerpApi ne correspond pas au relevé (étape ${enCours.numero}). Série arrêtée : à voir ensemble.`);
  enCours.issue = decision === "facturee" ? "interrompue_facturee" : "interrompue_non_facturee";
  enCours.facturee = decision === "facturee" ? "oui" : "non";
  enCours.message = decision === "facturee" ? "session interrompue : facturée, réponse perdue, pas refaite" : "session interrompue : non facturée, refaite";
  ecrireReleve(releve);
}

/** Avant chaque appel : page d'état ; au début d'un lot : compteur (concordance, réserve). */
async function controlerAvant(contexte: Contexte, etape: EtapeSerie): Promise<void> {
  const services = servicesDuLot(etape.lot);
  const { etats, incidents } = await lirePageEtat(services);
  if (!servicesOperationnels(etats, services)) throw new ArretSerie(`Page d'état : ${services.map((s) => `${s} « ${etats[s] ?? "illisible"} »`).join(", ")}. Aucun appel lancé.`);
  const { releve } = contexte;
  if (releve.lots.some((l) => l.lot === etape.lot)) return;
  const compteur = await compteurControle(releve, `avant le lot ${etape.lot}`);
  const restantes = PLAN.filter((e) => e.lot === etape.lot && e.numero >= etape.numero).length;
  if (!reserveSuffisante(compteur, restantes)) throw new ArretSerie(`Réserve : il resterait moins de 30 recherches après le lot ${etape.lot}. Aucun appel lancé.`);
  releve.lots.push({ lot: etape.lot, avant: compteur, apres: null, services: etats, incidents });
  ecrireReleve(releve);
}

/** Après la dernière étape d'un lot : compteur relu et comparé au relevé. */
async function controlerApres(contexte: Contexte, lot: number): Promise<void> {
  const entree = contexte.releve.lots.find((l) => l.lot === lot);
  if (!entree || !contexte.releve.reference) return;
  entree.apres = await compteurControle(contexte.releve, `après le lot ${lot}`);
  ecrireReleve(contexte.releve);
}

const attendre = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Compteur relu et comparé au relevé : relecture (3 fois, 20 s) seulement s'il
 * est en retard de 1 ; plus haut, ou plus de 1 d'écart : arrêt immédiat. */
async function compteurControle(releve: ReleveSerie, moment: string): Promise<Compteur> {
  if (!releve.reference) throw new ArretSerie("Aucune référence de compteur. Aucun appel lancé.");
  const { ok, compteur, relectures } = await controlerCompteur(releve.reference, releve.lignes, () => lireCompteur(), attendre);
  if (relectures > 0) console.log(`  Compteur relu ${relectures} fois ${moment} (retard de SerpApi) : ${ok ? "concordant" : "toujours différent"}.`);
  if (!ok) {
    const depuis = compteur.utilisees - releve.reference.utilisees;
    throw new ArretSerie(`Compteur de SerpApi différent du relevé ${moment} : ${depuis} recherches depuis la référence, ${factureesSelonReleve(releve.lignes)} facturées d'après le relevé. Série arrêtée.`);
  }
  return compteur;
}

function afficherLigne(ligne: LigneSerie): void {
  const m = ligne.mesures ?? {};
  const nombres = Object.entries(m).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k} ${v}`).join(", ");
  const etape = PLAN.find((e) => e.numero === ligne.numero);
  console.log(`  ${ligne.numero}. ${etape ? titreEtape(etape) : ""} → ${ligne.issue}${ligne.message ? ` (${ligne.message})` : ""}${nombres ? ` · ${nombres}` : ""}`);
}

/** Enchaîne les étapes jusqu'à la fin, un garde-fou, ou le plafond du jour. */
async function derouler(contexte: Contexte, plafondJourLeve: boolean): Promise<string> {
  for (;;) {
    await trancherEnCours(contexte.releve);
    const fin = finOuArret(PLAN, contexte.releve.lignes);
    if (fin) return fin;
    const etape = etapeSuivante(PLAN, contexte.releve.lignes);
    if (!etape) return FIN_SERIE;
    // Plafond du jour levé seulement pour ce passage, sur la phrase du fondateur ; le total de 46 et les autres garde-fous restent.
    if (!plafondJourLeve && appelsDuJour(contexte.releve.lignes, jourParis(new Date())) >= PLAFOND_JOUR) return `Plafond du jour atteint (${PLAFOND_JOUR} recherches) : reprise demain.`;
    const attente = attenteHoraireMinutes(contexte.releve.lignes, new Date());
    if (attente > 0) return `Limite horaire de SerpApi (${LIMITE_HEURE} par heure) : attendre ${attente} minutes.`;
    await controlerAvant(contexte, etape);
    afficherLigne(await faireEtape(contexte, etape));
    const suivante = etapeSuivante(PLAN, contexte.releve.lignes);
    if (!suivante || suivante.lot !== etape.lot) await controlerApres(contexte, etape.lot);
  }
}

function afficherEtat(releve: ReleveSerie, compteur: Compteur): void {
  const faites = PLAN.filter((e) => !etapeSuivante([e], releve.lignes)).length;
  console.log(`Phrase : « ${PHRASE_SERIE} » (${AUTORISATION_SERIE} recherches au plus).`);
  console.log(`Compteur de SerpApi : ${compteur.utilisees} utilisées, ${compteur.restantes} restantes. Référence : ${releve.reference ? `${releve.reference.utilisees} utilisées (${releve.reference.lueLe})` : "aucune"}.`);
  console.log(`Étapes faites : ${faites} sur ${PLAN.length} ; appels aujourd'hui : ${appelsDuJour(releve.lignes, jourParis(new Date()))} sur ${PLAFOND_JOUR}.`);
}

async function main(): Promise<void> {
  const [manifeste, ...brutes] = process.argv.slice(2);
  if (!manifeste || manifeste.startsWith("--")) throw new Error("Indiquez le fichier des pièces (pieces.json, hors de Git).");
  const options = lireOptions(brutes);
  assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  const pieces = piecesDeSerie(JSON.parse(readFileSync(manifeste, "utf8")));
  const releve = lireReleve();
  const compteur = await lireCompteur();
  afficherEtat(releve, compteur);
  if (options.mode === "reference") {
    if (releve.lignes.some((l) => l.issue === "en_cours")) throw new Error("Un appel est resté « en cours » : reprenez d'abord la série. Référence inchangée.");
    releve.reference = compteur;
    ecrireReleve(releve);
    console.log(`Nouvelle référence : ${compteur.utilisees} utilisées, ${compteur.restantes} restantes.`);
    return;
  }
  if (options.mode === "etat") return void console.log("Aucun appel lancé (ajoutez --confirmer).");
  if (!releve.reference) throw new Error("Aucune référence de compteur : lancez d'abord --nouvelle-reference. Aucun appel lancé.");
  if (options.plafondJourLeve) console.log(`Plafond du jour levé pour ce passage (phrase du fondateur) ; total de ${AUTORISATION_SERIE} et autres garde-fous inchangés.`);
  await lancer(pieces, releve, options.plafondJourLeve);
}

const VERROU = join(DOSSIER, "passage-en-cours.verrou");

/** Un seul passage à la fois : un second refuse de démarrer tant que le premier tourne. */
function prendreVerrou(): void {
  mkdirSync(DOSSIER, { recursive: true });
  if (existsSync(VERROU)) {
    const pid = Number(readFileSync(VERROU, "utf8"));
    const vivant = (() => {
      try {
        return Number.isInteger(pid) && pid > 0 && process.kill(pid, 0);
      } catch {
        return false;
      }
    })();
    if (vivant) throw new ArretSerie("Un autre passage de la série tourne déjà : aucun appel lancé.");
  }
  writeFileSync(VERROU, String(process.pid));
}

/** En fin de passage (fin, arrêt ou panne) : compteur relu et comparé au relevé, en nombres. */
async function afficherConcordance(releve: ReleveSerie): Promise<void> {
  if (!releve.reference) return;
  try {
    const compteur = await lireCompteur();
    const facturees = releve.lignes.filter((l) => l.facturee === "oui").length;
    const ecart = compteur.utilisees - releve.reference.utilisees;
    console.log(`Compteur de SerpApi : ${compteur.utilisees} utilisées (${ecart} depuis la référence) ; facturées d'après le relevé : ${facturees}${ecart === facturees ? " — concordant." : " — DIFFÉRENT : à voir ensemble."}`);
  } catch {
    console.log("Compteur de SerpApi illisible en fin de passage : à relire.");
  }
}

function codeDeSortie(fin: string): number {
  if (fin === FIN_SERIE) return 0;
  if (fin.startsWith("Plafond du jour")) return 4;
  return fin.startsWith("Limite horaire") ? 5 : 3;
}

async function lancer(pieces: Map<NomPiece, Piece>, releve: ReleveSerie, plafondJourLeve: boolean): Promise<void> {
  prendreVerrou();
  const travail = mkdtempSync(join(tmpdir(), "spotto-serie-"));
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const contexte: Contexte = { admin, branchement: brancherSerpApi(), travail, binaireVisages: compilerDetection(travail), pieces, releve, produits: new Map() };
  try {
    const restees = await viderStockage(admin);
    if (restees > 0) console.log(`Images d'essai restées dans le stockage (interruption) : ${restees}, effacées.`);
    const fin = await derouler(contexte, plafondJourLeve);
    console.log(fin);
    process.exitCode = codeDeSortie(fin);
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ArretSerie ? 3 : 1;
  } finally {
    await afficherConcordance(releve);
    await viderStockage(admin).catch(() => 0);
    rmSync(travail, { recursive: true, force: true });
    rmSync(VERROU, { force: true });
    console.log("Images de travail effacées du Mac et du stockage.");
  }
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
