// Lot 4 ter : mesure de l'effet du texte « Que cherchez-vous ? » sur Google
// Lens (demande du fondateur, 2026-10-08), pièce par pièce, sur SON matériel
// (images de ses vidéos d'essai, capture du maillot Nike) : zone du vêtement,
// visage exclu (contrôlé sur le Mac avant), images envoyées seulement chez
// SerpApi comme dans l'app, aucun appel à Anthropic. Pour chaque pièce : le
// cadre seul, puis le cadre et le texte ; une troisième recherche seulement si
// les deux divergent fortement. 12 crédits au plus, chaque essai annoncé.
//
//   pnpm --filter backend mesure-texte <pieces.json>               plan seul (aucun appel)
//   pnpm --filter backend mesure-texte <pieces.json> --confirmer   appels réels
//
// <pieces.json> : hors de Git ([{ nom, texte, zone, image | video + seconde }]).
// Les images (extraites des vidéos sur le Mac par ffmpeg) et les réponses
// vivent dans un dossier temporaire, EFFACÉ à la fin, même en cas de panne.
// Garde-fous : aucun appel si la page d'état de SerpApi ne dit pas « Lens API »
// opérationnelle (ou ne répond pas) ; à la première panne d'un essai (délai
// dépassé…), arrêt net.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../src/env.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";
import { afficher, commeImportee, essaiLens, releverReponses, type Releve } from "./lib/essai-lens.js";
import { analyserZone, type Essai, type Resultat } from "./lib/essai-photo.js";
import { CREDITS_MESURE_MAX, decision, divergenceForte, essaisDeBase, ETAT_ILLISIBLE, ETAT_SERPAPI, etatLens, moyenne, PIECE, texteNuisible, troisiemeEssai, type Piece } from "./lib/mesure-texte.js";

interface Bilan {
  piece: Piece;
  resultats: Resultat[];
  sansTexte: number;
  avecTexte: number;
}

function lirePieces(manifeste: string): Piece[] {
  const pieces = z.array(PIECE).min(1).parse(JSON.parse(readFileSync(manifeste, "utf8")));
  for (const piece of pieces) analyserZone(piece.zone);
  if (pieces.length * 2 > CREDITS_MESURE_MAX) throw new Error(`${pieces.length} pièces : plus de ${CREDITS_MESURE_MAX} crédits.`);
  return pieces;
}

/** État de Google Lens chez SerpApi (page d'état publique), ou « illisible ». */
async function lireEtatLens(): Promise<string> {
  const reponse = await fetch(ETAT_SERPAPI, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Spotto, outil de mesure)" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return (reponse?.ok ? etatLens(await reponse.json().catch(() => null)) : null) ?? ETAT_ILLISIBLE;
}

/** Image de la pièce : la photo telle quelle, ou l'image de la vidéo à l'instant choisi (ffmpeg, sur le Mac). */
function imageDe(piece: Piece, travail: string): string {
  if (piece.image) return piece.image;
  if (!piece.video || piece.seconde === undefined) throw new Error(`${piece.nom} : ni image, ni vidéo et instant.`);
  const sortie = join(travail, `${piece.nom}.jpg`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", piece.seconde.toFixed(3), "-i", piece.video, "-frames:v", "1", "-q:v", "2", sortie]);
  return sortie;
}

/** Les recherches d'une pièce ; `tiers` : troisièmes recherches encore permises par le plafond ;
 * `credits` : crédits engagés (un essai qui échoue a pu être décompté par SerpApi). */
async function mesurerPiece(piece: Piece, dossier: string, admin: SupabaseClient, releve: () => Releve, tiers: { restants: number }, credits: { engages: number }): Promise<Bilan> {
  const sousDossier = join(dossier, piece.nom);
  mkdirSync(sousDossier, { recursive: true });
  const photo = (await commeImportee(imageDe(piece, dossier))).data;
  const resultats: Resultat[] = [];
  const lancer = async (essai: Essai): Promise<Resultat> => {
    console.log(`→ ${essai.titre}`);
    credits.engages += 1;
    const resultat = await essaiLens(admin, photo, essai, piece.zone, sousDossier, releve);
    afficher(resultat);
    resultats.push(resultat);
    return resultat;
  };
  const [sans, avec] = essaisDeBase(piece);
  const a = await lancer(sans);
  const b = await lancer(avec);
  if (divergenceForte(a.gardees, b.gardees)) {
    if (tiers.restants > 0) {
      tiers.restants -= 1;
      await lancer(troisiemeEssai(piece, a.gardees, b.gardees));
    } else console.log(`  forte divergence, mais plafond de ${CREDITS_MESURE_MAX} crédits atteint : pas de troisième recherche`);
  }
  const gardees = (texte: boolean) => resultats.filter((r) => (r.essai.texte !== null) === texte).map((r) => r.gardees);
  return { piece, resultats, sansTexte: moyenne(gardees(false)), avecTexte: moyenne(gardees(true)) };
}

/** Les recherches réelles, pièce par pièce ; arrêt net à la première panne. */
async function mesurer(pieces: Piece[], dossier: string, tiers: { restants: number }): Promise<Bilan[]> {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const releve = releverReponses();
  const bilans: Bilan[] = [];
  const credits = { engages: 0 };
  try {
    for (const piece of pieces) bilans.push(await mesurerPiece(piece, dossier, admin, releve, tiers, credits));
  } catch (error) {
    throw new Error(`panne pendant la mesure, arrêtée (${credits.engages} crédit(s) engagé(s), pièces terminées : ${bilans.length}) — ${error instanceof Error ? error.message : String(error)}`);
  }
  return bilans;
}

async function main(): Promise<void> {
  const manifeste = process.argv[2];
  if (!manifeste || manifeste.startsWith("--")) throw new Error("Indiquez le fichier des pièces (pieces.json, hors de Git).");
  assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  const pieces = lirePieces(manifeste);
  const tiers = { restants: CREDITS_MESURE_MAX - pieces.length * 2 };
  const etat = await lireEtatLens();
  console.log(`Google Lens chez SerpApi (page d'état) : ${etat}.`);
  console.log(`Plan : ${pieces.length * 2} recherches, plus au plus ${tiers.restants} troisième(s) en cas de forte divergence — ${CREDITS_MESURE_MAX} crédits SerpApi au plus ; aucun autre prestataire.`);
  for (const piece of pieces) for (const essai of essaisDeBase(piece)) console.log(`  ${essai.titre}`);
  if (!process.argv.includes("--confirmer")) {
    console.log("Aucun appel lancé (ajoutez --confirmer).");
    return;
  }
  if (etat !== "operational") throw new Error(`SerpApi n'annonce pas Google Lens opérationnel (« ${etat} ») : mesure reportée, aucun crédit dépensé.`);
  const travail = mkdtempSync(join(tmpdir(), "spotto-mesure-texte-"));
  try {
    const bilans = await mesurer(pieces, travail, tiers);
    for (const b of bilans) console.log(`  ${b.piece.nom} : ${b.sansTexte} gardée(s) sans texte, ${b.avecTexte} avec${texteNuisible(b.sansTexte, b.avecTexte) ? " — texte nuisible" : ""}`);
    console.log(`Règle du fondateur, appliquée telle quelle aux propositions lues par l'app : ${decision(bilans)} d'envoyer le texte.`);
    console.log(`Terminé : ${bilans.reduce((somme, b) => somme + b.resultats.length, 0)} crédit(s) SerpApi utilisé(s).`);
  } finally {
    rmSync(travail, { recursive: true, force: true });
    console.log("Images, zones et réponses effacées du Mac.");
  }
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
