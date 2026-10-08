// Lot 4 ter (demandes du fondateur) : mesurer ce que Google Lens (SerpApi)
// renvoie pour UNE photo selon la zone envoyée, le texte et les réglages —
// sans deviner. Au plus 4 crédits SerpApi par passage ; chaque essai est
// annoncé avant d'être lancé. Plans : « nike » (étape 2, 2026-10-07) et
// « texte » (effet du texte « Que cherchez-vous ? », 2026-10-08 : photo SANS
// personne identifiable, fournie par le fondateur).
//
//   pnpm --filter backend essai-photo --plan texte "<photo>" --zone x,y,l,h --texte "…"              plan seul (aucun appel)
//   pnpm --filter backend essai-photo --plan texte "<photo>" --zone x,y,l,h --texte "…" --confirmer  appels réels
//
// Chemin exact de l'app : photo réduite comme à l'import (1 600 px, JPEG 0,85),
// puis préparation du serveur (orientation, zone, 1 600 px, JPEG 0,88 —
// prepareImageForAnalysis), envoi dans le stockage de spotto-dev, adresse
// signée de 5 minutes, UN appel SerpApi (callSerpApi, filtres du serveur),
// image effacée aussitôt. Zone du vêtement tracée à la main (--zone) : aucun
// appel à un autre prestataire (décision du fondateur, 2026-10-07). La
// structure de chaque réponse (rubriques et tailles, jamais leur contenu) est
// relevée : elle dit si des propositions sont arrivées ailleurs que dans la
// rubrique lue par l'app. La photo, les zones et les réponses restent dans un
// dossier temporaire du Mac, jamais dans le dépôt.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { CropRect } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { prepareImageForAnalysis } from "../src/lib/imageProcessing.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";
import { afficher, commeImportee, essaiLens, releverReponses } from "./lib/essai-lens.js";
import { analyserZone, CREDITS_MAX, planEssais, ZONE_APP, type Essai, type Resultat } from "./lib/essai-photo.js";

/** Valeur d'une option de la ligne de commande (« --zone 0.2,… »). */
function option(args: string[], nom: string): string | null {
  const index = args.indexOf(nom);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/** La photo : le seul argument qui n'est ni une option ni la valeur d'une option. */
function photoDe(args: string[]): string | null {
  const valeurs = new Set(["--zone", "--plan", "--texte"].map((nom) => args.indexOf(nom)).filter((index) => index >= 0).map((index) => index + 1));
  return args.find((a, index) => !a.startsWith("--") && !valeurs.has(index)) ?? null;
}

function lireZone(args: string[]): CropRect | null {
  const texte = option(args, "--zone");
  if (texte === null) return null;
  const valeurs = texte.split(",").map(Number);
  const [x, y, width, height] = valeurs;
  if (valeurs.length !== 4 || valeurs.some((v) => !Number.isFinite(v)) || x === undefined || y === undefined || width === undefined || height === undefined) {
    throw new Error("--zone attend quatre nombres entre 0 et 1 : x,y,largeur,hauteur.");
  }
  return analyserZone({ x, y, width, height });
}

/** Les appels réels, un par essai, dans l'ordre annoncé. */
async function lancerEssais(essais: readonly Essai[], photo: Buffer, zoneVetement: CropRect, dossier: string): Promise<Resultat[]> {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const releve = releverReponses();
  const resultats: Resultat[] = [];
  for (const essai of essais) {
    console.log(`→ Essai ${essai.numero} — ${essai.titre}`);
    resultats.push(await essaiLens(admin, photo, essai, essai.zone === "app" ? ZONE_APP : zoneVetement, dossier, releve));
    afficher(resultats.at(-1)!);
  }
  return resultats;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const photo = photoDe(args);
  if (!photo) throw new Error('Indiquez la photo : pnpm --filter backend essai-photo --plan texte "<photo>" --zone x,y,l,h --texte "…"');
  assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  const essais = planEssais(option(args, "--plan"), option(args, "--texte"));
  if (essais.length > CREDITS_MAX) throw new Error(`Plan de ${essais.length} crédits SerpApi : ${CREDITS_MAX} au plus.`);
  const zoneVetement = lireZone(args);
  if (!zoneVetement) throw new Error("Indiquez la zone du vêtement : --zone x,y,largeur,hauteur (proportions de l'image).");
  const dossier = mkdtempSync(join(tmpdir(), "spotto-essai-photo-"));
  const importee = await commeImportee(photo);
  console.log(`Photo telle qu'importée par l'app : ${importee.width} × ${importee.height} px. Dossier des essais (hors du dépôt) : ${dossier}`);
  console.log(`Plan (${essais.length} crédits SerpApi, aucun autre prestataire) :`);
  for (const essai of essais) console.log(`  Essai ${essai.numero} — ${essai.titre}`);
  if (essais.some((essai) => essai.zone === "app")) writeFileSync(join(dossier, "zone-app.jpg"), await prepareImageForAnalysis(importee.data, ZONE_APP));
  writeFileSync(join(dossier, "zone-vetement.jpg"), await prepareImageForAnalysis(importee.data, zoneVetement));
  if (!args.includes("--confirmer")) {
    console.log("Aucun appel lancé (ajoutez --confirmer). Zone(s) préparée(s) dans le dossier des essais.");
    return;
  }
  const resultats = await lancerEssais(essais, importee.data, zoneVetement, dossier);
  writeFileSync(join(dossier, "resultats.json"), JSON.stringify({ zoneVetement, resultats }, null, 2));
  console.log(`Terminé : ${resultats.length} crédit(s) SerpApi utilisé(s). Détails : ${dossier}`);
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
