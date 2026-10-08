// Un essai Google Lens par le chemin exact de l'app, partagé par les outils
// essai-photo et mesure-texte (lot 4 ter) : image réduite comme à l'import
// (1 600 px, JPEG 0,85), préparation du serveur (zone, 1 600 px, JPEG 0,88),
// envoi dans le stockage de spotto-dev, adresse signée de 5 minutes, UN appel
// SerpApi (1 crédit, filtres du serveur), image effacée aussitôt (contrôlé).
// La réponse brute et sa structure (rubriques et tailles) sont gardées dans
// le dossier temporaire de l'essai, hors du dépôt.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CropRect } from "@monapp/shared-types";
import { prepareImageForAnalysis } from "../../src/lib/imageProcessing.js";
import { callSerpApi, isExcludedMerchant, toVisualMatches } from "../../src/services/visualSearch.js";
import { structureReponse, type Essai, type Resultat, type Structure } from "./essai-photo.js";

/** Import d'une photo dans l'app (lib/image-import.ts) : 1 600 px au plus, JPEG 0,85. */
export async function commeImportee(chemin: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(readFileSync(chemin))
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export interface Releve {
  structure: Structure | null;
  /** Réponse brute de SerpApi (gardée dans le dossier temporaire seulement). */
  brut: unknown;
}

/** Chaque réponse de SerpApi, relevée au passage (la réponse elle-même n'est pas modifiée). */
export function releverReponses(): () => Releve {
  let derniere: Releve = { structure: null, brut: null };
  const fetchReel = globalThis.fetch;
  globalThis.fetch = async (entree: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const reponse = await fetchReel(entree, init);
    const adresse = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (adresse.startsWith("https://serpapi.com/")) {
      const brut: unknown = await reponse.clone().json().catch(() => null);
      derniere = { structure: structureReponse(brut), brut };
    }
    return reponse;
  };
  return () => derniere;
}

/** Un appel SerpApi (1 crédit) sur la zone préparée comme par le serveur ; l'image est effacée ensuite. */
export async function essaiLens(admin: SupabaseClient, photo: Buffer, essai: Essai, zone: CropRect | null, dossier: string, releve: () => Releve): Promise<Resultat> {
  const prepared = await prepareImageForAnalysis(photo, zone);
  writeFileSync(join(dossier, `essai-${essai.numero}.jpg`), prepared);
  const chemin = `essais-lot-4-ter/${randomUUID()}.jpg`;
  const envoi = await admin.storage.from("screenshots").upload(chemin, prepared, { contentType: "image/jpeg" });
  if (envoi.error) throw new Error(`Envoi de l'image impossible : ${envoi.error.message}`);
  try {
    const signee = await admin.storage.from("screenshots").createSignedUrl(chemin, 300);
    if (signee.error || !signee.data) throw new Error(`Adresse signée impossible : ${signee.error?.message ?? "?"}`);
    const brutes = await callSerpApi(signee.data.signedUrl, essai.reglages, essai.texte);
    const { structure, brut } = releve();
    writeFileSync(join(dossier, `essai-${essai.numero}.json`), JSON.stringify(brutes, null, 2));
    writeFileSync(join(dossier, `reponse-${essai.numero}.json`), JSON.stringify(brut, null, 2));
    const gardees = toVisualMatches(brutes);
    return {
      essai,
      brutes: brutes.length,
      reseauxSociaux: brutes.filter((m) => m.link && isExcludedMerchant(m.link)).length,
      gardees: gardees.length,
      avecPrix: gardees.filter((m) => m.priceValue !== null).length,
      premiers: gardees.slice(0, 3).map((m) => `${m.productName} — ${m.merchantName ?? "?"}${m.priceValue !== null ? ` (${m.priceValue} ${m.currency ?? ""})` : ""}`),
      structure,
    };
  } finally {
    const effacement = await admin.storage.from("screenshots").remove([chemin]);
    if (effacement.error) console.error(`ATTENTION : image d'essai non effacée (${chemin}) : ${effacement.error.message}`);
  }
}

export function afficher(resultat: Resultat): void {
  const { essai, structure } = resultat;
  console.log(`  Essai ${essai.numero} — ${resultat.brutes} résultat(s) de Google Lens, dont ${resultat.reseauxSociaux} de réseaux sociaux ; ${resultat.gardees} gardé(s) par Spotto, ${resultat.avecPrix} avec un prix.`);
  for (const titre of resultat.premiers) console.log(`    · ${titre}`);
  if (!structure) return;
  const rubriques = Object.entries(structure.rubriques).filter(([cle]) => !cle.startsWith("search_"));
  console.log(`    réponse de SerpApi : ${rubriques.map(([cle, taille]) => `${cle} ${taille}`).join(", ") || "aucune rubrique"}${structure.erreur ? ` ; message : ${structure.erreur}` : ""}`);
}
