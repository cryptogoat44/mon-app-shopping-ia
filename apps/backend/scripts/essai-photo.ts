// Lot 4 ter, étape 2 (demande du fondateur, 2026-10-07) : mesurer ce que
// Google Lens (SerpApi) renvoie pour UNE photo selon la zone envoyée, le texte
// et les réglages — sans deviner. Au plus 4 crédits SerpApi ; chaque essai est
// annoncé avant d'être lancé.
//
//   pnpm --filter backend essai-photo "<photo>" --zone x,y,largeur,hauteur              plan seul (aucun appel)
//   pnpm --filter backend essai-photo "<photo>" --zone x,y,largeur,hauteur --confirmer  appels réels
//
// Chemin exact de l'app : photo réduite comme à l'import (1 600 px, JPEG 0,85),
// puis préparation du serveur (orientation, zone, 1 600 px, JPEG 0,88 —
// prepareImageForAnalysis), envoi dans le stockage de spotto-dev, adresse
// signée de 5 minutes, UN appel SerpApi (callSerpApi, filtres du serveur),
// image effacée aussitôt. Zone du vêtement tracée à la main (--zone) : aucun
// appel à un autre prestataire (décision du fondateur, 2026-10-07 : la photo
// montre le visage d'un tiers). La photo, les zones et les réponses restent
// dans un dossier temporaire du Mac, jamais dans le dépôt.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CropRect } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { prepareImageForAnalysis } from "../src/lib/imageProcessing.js";
import { callSerpApi, isExcludedMerchant, toVisualMatches } from "../src/services/visualSearch.js";
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
    const effacement = await admin.storage.from("screenshots").remove([chemin]);
    if (effacement.error) console.error(`ATTENTION : image d'essai non effacée (${chemin}) : ${effacement.error.message}`);
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
  if (!photo) throw new Error('Indiquez la photo : pnpm --filter backend essai-photo "<photo>" --zone x,y,largeur,hauteur');
  assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  const zoneVetement = lireZone(args);
  if (!zoneVetement) throw new Error("Indiquez la zone du vêtement : --zone x,y,largeur,hauteur (proportions de l'image).");
  const dossier = mkdtempSync(join(tmpdir(), "spotto-essai-photo-"));
  const importee = await commeImportee(photo);
  console.log(`Photo telle qu'importée par l'app : ${importee.width} × ${importee.height} px. Dossier des essais (hors du dépôt) : ${dossier}`);
  if (CREDITS_SERPAPI > 4) throw new Error(`Plan de ${CREDITS_SERPAPI} crédits SerpApi : 4 au plus.`);
  console.log(`Plan (${CREDITS_SERPAPI} crédits SerpApi, aucun autre prestataire) :`);
  for (const essai of ESSAIS) console.log(`  Essai ${essai.numero} — ${essai.titre}`);
  writeFileSync(join(dossier, "zone-app.jpg"), await prepareImageForAnalysis(importee.data, ZONE_APP));
  writeFileSync(join(dossier, "zone-vetement.jpg"), await prepareImageForAnalysis(importee.data, zoneVetement));
  if (!args.includes("--confirmer")) {
    console.log("Aucun appel lancé (ajoutez --confirmer). Zones préparées : zone-app.jpg, zone-vetement.jpg.");
    return;
  }
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const resultats: Resultat[] = [];
  for (const essai of ESSAIS) {
    console.log(`→ Essai ${essai.numero} — ${essai.titre}`);
    resultats.push(await essaiLens(admin, importee.data, essai, essai.zone === "app" ? ZONE_APP : zoneVetement, dossier));
    afficher(resultats.at(-1)!);
  }
  writeFileSync(join(dossier, "resultats.json"), JSON.stringify({ zoneVetement, resultats }, null, 2));
  console.log(`Terminé : ${resultats.length} crédit(s) SerpApi utilisé(s). Détails : ${dossier}`);
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
