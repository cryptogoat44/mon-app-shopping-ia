// Lot 4 ter, étape 2 (demande du fondateur, 2026-10-07) : mesurer ce que
// Google Lens (SerpApi) renvoie pour UNE photo selon la zone envoyée, le texte
// et les réglages — sans deviner. Au plus 4 crédits SerpApi ; chaque essai est
// annoncé avant d'être lancé.
//
//   pnpm --filter backend essai-photo "<photo>" [--zone x,y,largeur,hauteur]             plan seul (aucun appel)
//   pnpm --filter backend essai-photo "<photo>" [--zone x,y,largeur,hauteur] --confirmer  appels réels
//
// Chemin exact de l'app : photo réduite comme à l'import (1 600 px, JPEG 0,85),
// puis préparation du serveur (orientation, zone, 1 600 px, JPEG 0,88 —
// prepareImageForAnalysis), envoi dans le stockage de spotto-dev, adresse
// signée de 5 minutes, UN appel SerpApi (callSerpApi, filtres du serveur),
// image effacée aussitôt. Cadrage par l'IA (essai 0, ≈ 0,01 $, clé d'ESSAI
// d'Anthropic) : même consigne et même seuil que pour une vidéo, sur la photo
// réduite à 512 px. La photo, les zones et les réponses restent dans un dossier
// temporaire du Mac, jamais dans le dépôt (elle peut montrer une personne).
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { VIDEO_AI, type CropRect } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { prepareImageForAnalysis } from "../src/lib/imageProcessing.js";
import { askVideoMoments, VIDEO_AI_SETTINGS } from "../src/services/videoMoments.js";
import { callSerpApi, isExcludedMerchant, toVisualMatches } from "../src/services/visualSearch.js";
import { cleEssaiEventuelle } from "./lib/anthropic-essai.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";
import { analyserZone, CREDITS_SERPAPI, ESSAIS, ZONE_APP, type Essai, type Resultat } from "./lib/essai-photo.js";

/** Import d'une photo dans l'app (lib/image-import.ts) : 1 600 px au plus, JPEG 0,85. */
async function commeImportee(chemin: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(readFileSync(chemin))
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Essai 0 : cadre proposé par l'IA (une seule image, réduite comme les images d'une vidéo). */
async function cadrageIa(photo: Buffer, mots: string): Promise<{ zone: CropRect | null; confiance: number | null; dollars: number }> {
  const cle = cleEssaiEventuelle();
  if (!cle) throw new Error("Clé d'essai d'Anthropic absente : pnpm --filter backend configurer-anthropic-essai.");
  const { data, info } = await sharp(photo).resize({ width: VIDEO_AI.frameEdge, height: VIDEO_AI.frameEdge, fit: "inside" }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  const reponse = await askVideoMoments([{ data, width: info.width, height: info.height }], mots, { apiKey: cle, ...VIDEO_AI_SETTINGS });
  const meilleur = reponse.candidates[0] ?? null;
  // Prix de Claude Sonnet 5.5 (vérifiés le 2026-10-06) : 2 $ / 10 $ par million de jetons.
  const dollars = (reponse.usage.inputTokens * 2 + reponse.usage.outputTokens * 10) / 1_000_000;
  return { zone: reponse.moments[0]?.box ?? null, confiance: meilleur?.confidence ?? null, dollars };
}

/** Un appel SerpApi (1 crédit) sur la zone préparée comme par le serveur ; l'image est effacée ensuite. */
async function essaiLens(admin: SupabaseClient, photo: Buffer, essai: Essai, zone: CropRect | null, dossier: string): Promise<Resultat> {
  const prepared = await prepareImageForAnalysis(photo, zone);
  writeFileSync(join(dossier, `essai-${essai.numero}.jpg`), prepared);
  const chemin = `essais-lot-4-ter/${randomUUID()}.jpg`;
  const envoi = await admin.storage.from("screenshots").upload(chemin, prepared, { contentType: "image/jpeg" });
  if (envoi.error) throw new Error(`Envoi de l'image impossible : ${envoi.error.message}`);
  try {
    const signee = await admin.storage.from("screenshots").createSignedUrl(chemin, 300);
    if (signee.error || !signee.data) throw new Error(`Adresse signée impossible : ${signee.error?.message ?? "?"}`);
    const brutes = await callSerpApi(signee.data.signedUrl, essai.reglages, essai.texte);
    writeFileSync(join(dossier, `essai-${essai.numero}.json`), JSON.stringify(brutes, null, 2));
    const gardees = toVisualMatches(brutes);
    return {
      essai,
      brutes: brutes.length,
      reseauxSociaux: brutes.filter((m) => m.link && isExcludedMerchant(m.link)).length,
      gardees: gardees.length,
      avecPrix: gardees.filter((m) => m.priceValue !== null).length,
      premiers: gardees.slice(0, 3).map((m) => `${m.productName} — ${m.merchantName ?? "?"}${m.priceValue !== null ? ` (${m.priceValue} ${m.currency ?? ""})` : ""}`),
    };
  } finally {
    await admin.storage.from("screenshots").remove([chemin]);
  }
}

function lireZone(args: string[]): CropRect | null {
  const index = args.indexOf("--zone");
  if (index < 0) return null;
  const valeurs = (args[index + 1] ?? "").split(",").map(Number);
  const [x, y, width, height] = valeurs;
  if (valeurs.length !== 4 || valeurs.some((v) => !Number.isFinite(v)) || x === undefined || y === undefined || width === undefined || height === undefined) {
    throw new Error("--zone attend quatre nombres entre 0 et 1 : x,y,largeur,hauteur.");
  }
  return analyserZone({ x, y, width, height });
}

function afficher(resultat: Resultat): void {
  const { essai } = resultat;
  console.log(`  Essai ${essai.numero} — ${resultat.brutes} résultat(s) de Google Lens, dont ${resultat.reseauxSociaux} de réseaux sociaux ; ${resultat.gardees} gardé(s) par Spotto, ${resultat.avecPrix} avec un prix.`);
  for (const titre of resultat.premiers) console.log(`    · ${titre}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const indexZone = args.indexOf("--zone");
  const photo = args.find((a, index) => !a.startsWith("--") && (indexZone < 0 || index !== indexZone + 1));
  if (!photo) throw new Error('Indiquez la photo : pnpm --filter backend essai-photo "<photo>"');
  assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  const confirmer = args.includes("--confirmer");
  const zoneManuelle = lireZone(args);
  const dossier = mkdtempSync(join(tmpdir(), "spotto-essai-photo-"));
  const importee = await commeImportee(photo);
  console.log(`Photo telle qu'importée par l'app : ${importee.width} × ${importee.height} px. Dossier des essais (hors du dépôt) : ${dossier}`);
  if (CREDITS_SERPAPI > 4) throw new Error(`Plan de ${CREDITS_SERPAPI} crédits SerpApi : 4 au plus.`);
  console.log(`Plan (${CREDITS_SERPAPI} crédits SerpApi, et l'essai 0 chez Anthropic) :`);
  for (const essai of ESSAIS) console.log(`  Essai ${essai.numero} — ${essai.titre}`);
  writeFileSync(join(dossier, "zone-app.jpg"), await prepareImageForAnalysis(importee.data, ZONE_APP));
  if (!confirmer) {
    console.log("Aucun appel lancé (ajoutez --confirmer). Zone de l'app préparée : zone-app.jpg.");
    return;
  }
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log("→ Essai 0 — cadrage par l'IA (Anthropic)");
  const ia = await cadrageIa(importee.data, "t-shirt Nike noir");
  console.log(`  Zone proposée : ${ia.zone ? JSON.stringify(ia.zone) : "aucune"} ; confiance ${ia.confiance ?? "—"} ; coût ≈ ${ia.dollars.toFixed(4)} $`);
  const zoneVetement = ia.zone ?? zoneManuelle;
  if (!zoneVetement) throw new Error("Aucune zone du vêtement : l'IA n'en propose pas ; indiquez-la avec --zone.");
  const resultats: Resultat[] = [];
  for (const essai of ESSAIS.filter((e) => e.numero > 0)) {
    console.log(`→ Essai ${essai.numero} — ${essai.titre}`);
    const zone = essai.zone === "app" ? ZONE_APP : zoneVetement;
    resultats.push(await essaiLens(admin, importee.data, essai, zone, dossier));
    afficher(resultats.at(-1)!);
  }
  writeFileSync(join(dossier, "resultats.json"), JSON.stringify({ ia, zoneVetement, resultats }, null, 2));
  console.log(`Terminé : ${resultats.length} crédit(s) SerpApi utilisé(s). Détails : ${dossier}`);
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
