// Essai du type de recherche de Google Lens (décisions du fondateur, 2026-10-20).
// SerpApi a abandonné « products » le 2026-10-09 ; on essaie « visual_matches »
// sur le matériel du fondateur (pièces d'essai, zones sans visage du
// 2026-10-08), par le chemin exact de l'app : image réduite, zone, stockage de
// spotto-dev, adresse signée de 5 minutes, UN appel SerpApi, image effacée
// aussitôt. Cadre seul, sans texte. Aucun appel à Anthropic.
//
//   pnpm --filter backend essai-type-recherche <pieces.json>               plan seul (aucun appel)
//   pnpm --filter backend essai-type-recherche <pieces.json> --confirmer   essai complet :
//     « visual_matches » sur 4 pièces, puis « products » (erreur attendue) ; 5 crédits au plus
//   pnpm --filter backend essai-type-recherche <pieces.json> --sonde [--malgre-page-etat] --confirmer
//     sonde unique : 1 recherche « visual_matches », 1 crédit au plus
//
// Garde-fous :
// - aucun appel sans --confirmer ;
// - aucun appel si la page d'état de SerpApi n'annonce pas Google Lens
//   opérationnel, SAUF la sonde unique avec --malgre-page-etat, lancée
//   seulement après la phrase tapée par le fondateur ; jamais l'essai complet ;
// - relevé de chaque recherche (sans contenu personnel) écrit AVANT l'appel,
//   complété après, dans docs/ (hors de Git) ;
// - essai complet seulement : réponses de test réduites, anonymisées et
//   vérifiées (ni clé, ni adresse e-mail, ni adresse d'image temporaire, ni
//   lien de SerpApi) avant d'être écrites dans tests/fixtures/serpapi ;
// - arrêt net à la première panne inattendue ; images effacées du stockage et du Mac.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../src/env.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";
import { afficher, commeImportee, essaiLens, releverReponses, type Releve } from "./lib/essai-lens.js";
import { imageDe, lireEtatLens, lirePiecesDe } from "./lib/essai-pieces.js";
import type { Resultat } from "./lib/essai-photo.js";
import { bilanFacturation, contenusInterdits, CREDITS_MAX, depensePermise, ligneLancee, ligneTerminee, planEssaiType, reponseDeTest, type EssaiType, type LigneReleve, type PlanType } from "./lib/essai-type.js";
import type { Piece } from "./lib/mesure-texte.js";

/** Relevés (sans contenu personnel) : dans docs/, hors de Git. */
const DOSSIER_RELEVES = fileURLToPath(new URL("../../../docs/lot-lens-type-recherche-reponses/", import.meta.url));
/** Réponses de test, versées au dépôt après relecture. */
const DOSSIER_REPONSES_DE_TEST = fileURLToPath(new URL("../tests/fixtures/serpapi/", import.meta.url));

interface Contexte {
  admin: SupabaseClient;
  releve: () => Releve;
  travail: string;
  lignes: LigneReleve[];
  fichierReleve: string;
  /** Essai complet : les réponses deviennent des réponses de test. La sonde n'en garde aucune. */
  garderReponses: boolean;
}

function ecrireReleve(contexte: Contexte): void {
  writeFileSync(contexte.fichierReleve, `${JSON.stringify(contexte.lignes, null, 2)}\n`);
}

function nomReponseDeTest({ piece, essai }: EssaiType, code: number | null): string {
  return essai.reglages.type === "products" ? `lens-products-abandonne-${code ?? "sans-code"}.json` : `lens-visual-${piece.nom}.json`;
}

/** Réponse de test écrite seulement si aucune donnée à protéger n'y reste. */
function enregistrerReponseDeTest(etape: EssaiType, reponse: Releve): void {
  const corps = reponseDeTest(reponse.brut);
  if (!corps) {
    console.log("  réponse de test : réponse illisible, rien d'enregistré.");
    return;
  }
  const texte = `${JSON.stringify(corps, null, 2)}\n`;
  const problemes = contenusInterdits(texte);
  if (problemes.length > 0) {
    console.log(`  réponse de test NON enregistrée (${problemes.join(", ")}).`);
    return;
  }
  const nom = nomReponseDeTest(etape, reponse.statut);
  writeFileSync(join(DOSSIER_REPONSES_DE_TEST, nom), texte);
  console.log(`  réponse de test enregistrée (anonymisée, vérifiée) : tests/fixtures/serpapi/${nom}`);
}

/** Un appel : relevé AVANT, appel, relevé complété. L'erreur attendue de
 * « products » est relevée, pas propagée ; toute autre panne arrête l'essai. */
async function lancerUnAppel(contexte: Contexte, etape: EssaiType): Promise<void> {
  const { piece, essai, erreurAttendue } = etape;
  const sousDossier = join(contexte.travail, `${essai.numero}-${piece.nom}`);
  mkdirSync(sousDossier, { recursive: true });
  const photo = (await commeImportee(imageDe(piece, contexte.travail))).data;
  console.log(`→ ${essai.titre}`);
  const index = contexte.lignes.push(ligneLancee(etape, new Date())) - 1;
  ecrireReleve(contexte);
  const avant = contexte.releve();
  const debut = Date.now();
  let resultat: Resultat | null = null;
  let echec: unknown = null;
  try {
    resultat = await essaiLens(contexte.admin, photo, essai, piece.zone, sousDossier, contexte.releve);
  } catch (error) {
    echec = error;
  }
  const reponse = contexte.releve();
  const aRepondu = reponse !== avant;
  const comptes = resultat ? { recues: resultat.brutes, gardees: resultat.gardees, avecPrix: resultat.avecPrix } : null;
  contexte.lignes[index] = ligneTerminee(contexte.lignes[index]!, aRepondu ? { code: reponse.statut, structure: reponse.structure, secondes: reponse.secondes } : null, comptes, Math.round((Date.now() - debut) / 1000));
  ecrireReleve(contexte);
  if (resultat) afficher(resultat);
  if (aRepondu && contexte.garderReponses) enregistrerReponseDeTest(etape, reponse);
  if (echec && !(erreurAttendue && aRepondu)) throw echec;
  if (echec) console.log(`  Erreur attendue : code ${reponse.statut ?? "?"}, statut « ${reponse.structure?.etat ?? "?"} ».`);
  else if (erreurAttendue) console.log("  ATTENTION : « products » a répondu sans erreur, contrairement à ce qu'annonce SerpApi.");
}

function afficherBilan(contexte: Contexte): void {
  for (const l of contexte.lignes) {
    console.log(`  ${l.numero}. ${l.piece} (${l.type}), lancée à ${l.lancee} : ${l.issue}, code ${l.code ?? "—"}, ${l.recues ?? "—"} reçue(s), ${l.gardees ?? "—"} gardée(s), ${l.avecPrix ?? "—"} avec prix, ${l.secondes ?? "—"} s ; facturée d'après SerpApi : ${l.factureeSelonSerpApi}`);
  }
  const bilan = bilanFacturation(contexte.lignes);
  console.log(`Écart attendu de votre compteur SerpApi : ${bilan.oui} (facturée(s) d'après SerpApi) ; ${bilan.non} non facturée(s) ; ${bilan.inconnu} incertaine(s).`);
  console.log(`Relevé, sans contenu personnel : ${contexte.fichierReleve}`);
}

/** Le plan annoncé ; les appels seulement avec --confirmer, et si la dépense est permise. */
async function lancerEssai(plan: PlanType, pieces: Piece[], etat: string, malgrePageEtat: boolean): Promise<void> {
  const etapes = planEssaiType(plan, pieces);
  console.log(plan === "sonde" ? `Sonde unique : 1 recherche « visual_matches », ${CREDITS_MAX.sonde} crédit au plus ; aucune réponse de test gardée.` : `Essai complet : ${etapes.length} appels, ${CREDITS_MAX.type} crédits SerpApi au plus (l'erreur de « products » ne devrait pas être facturée).`);
  for (const { essai } of etapes) console.log(`  ${essai.titre}`);
  const autorisation = depensePermise(plan, etat, malgrePageEtat);
  if (!process.argv.includes("--confirmer")) {
    console.log(`Aucun appel lancé (ajoutez --confirmer).${autorisation.permis ? "" : ` Avec --confirmer : refusé — ${autorisation.raison}`}`);
    return;
  }
  if (!autorisation.permis) throw new Error(autorisation.raison);
  mkdirSync(DOSSIER_RELEVES, { recursive: true });
  const horodatage = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const contexte: Contexte = {
    admin: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
    releve: releverReponses(),
    travail: mkdtempSync(join(tmpdir(), "spotto-essai-type-")),
    lignes: [],
    fichierReleve: join(DOSSIER_RELEVES, `releve-${plan}-${horodatage}.json`),
    garderReponses: plan === "type",
  };
  try {
    for (const etape of etapes) await lancerUnAppel(contexte, etape);
  } catch (error) {
    throw new Error(`panne inattendue, essai arrêté — ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(contexte.travail, { recursive: true, force: true });
    console.log("Images et zones effacées du Mac.");
    afficherBilan(contexte);
  }
}

/** Options permises : une option mal tapée ne doit jamais retomber sur l'essai complet. */
const OPTIONS = new Set(["--confirmer", "--sonde", "--malgre-page-etat"]);

async function main(): Promise<void> {
  const [manifeste, ...options] = process.argv.slice(2);
  if (!manifeste || manifeste.startsWith("--")) throw new Error("Indiquez le fichier des pièces (pieces.json, hors de Git).");
  const inconnues = options.filter((option) => !OPTIONS.has(option));
  if (inconnues.length > 0) throw new Error(`Option inconnue (${inconnues.map((o) => `« ${o} »`).join(", ")}) : seules --confirmer, --sonde et --malgre-page-etat existent. Aucun appel lancé.`);
  assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  const plan: PlanType = process.argv.includes("--sonde") ? "sonde" : "type";
  const pieces = lirePiecesDe(manifeste);
  const etat = await lireEtatLens();
  console.log(`Google Lens chez SerpApi (page d'état) : ${etat}.`);
  await lancerEssai(plan, pieces, etat, process.argv.includes("--malgre-page-etat"));
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
