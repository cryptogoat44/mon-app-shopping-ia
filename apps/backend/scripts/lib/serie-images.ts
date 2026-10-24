// Images de la série : extraites des vidéos du fondateur (ffmpeg, sur le Mac),
// préparées comme par le serveur (zone du 8 octobre, sous le menton), et
// contrôlées par la détection de visages d'Apple avant tout envoi. Rien ne
// quitte le dossier temporaire de la série, effacé à la fin.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { prepareImageForAnalysis } from "../../src/lib/imageProcessing.js";
import { commeImportee } from "./essai-lens.js";
import type { Piece } from "./mesure-texte.js";
import type { SourceImage } from "./serie-plan.js";

const SOURCE_VISAGES = fileURLToPath(new URL("./visages.swift", import.meta.url));

/** Compile l'outil de détection (une fois par passage) ; renvoie son chemin. */
export function compilerDetection(travail: string): string {
  const binaire = join(travail, "visages");
  execFileSync("xcrun", ["swiftc", "-O", SOURCE_VISAGES, "-o", binaire], { stdio: "ignore" });
  return binaire;
}

export interface Detection {
  visages: number;
  personnes: number;
}

/** Lit la sortie de l'outil : « <index> <visages> <personnes> » par image ; une ligne illisible compte comme un visage (prudence). */
export function lireDetections(sortie: string, nombre: number): Detection[] {
  const resultats: Detection[] = Array.from({ length: nombre }, () => ({ visages: 1, personnes: 1 }));
  for (const ligne of sortie.split("\n")) {
    const morceaux = /^(\d+) (\d+) (\d+)$/.exec(ligne.trim());
    if (!morceaux) continue;
    const index = Number(morceaux[1]);
    if (index < nombre) resultats[index] = { visages: Number(morceaux[2]), personnes: Number(morceaux[3]) };
  }
  return resultats;
}

/** Visages et personnes sur des images écrites dans le dossier de travail. */
export function detecter(binaire: string, chemins: readonly string[]): Detection[] {
  if (chemins.length === 0) return [];
  return lireDetections(execFileSync(binaire, [...chemins], { encoding: "utf8" }), chemins.length);
}

function extraire(piece: Piece, decalage: number, sortie: string): string {
  if (piece.image) return piece.image;
  if (!piece.video || piece.seconde === undefined) throw new Error(`${piece.nom} : ni image, ni vidéo et instant.`);
  const instant = Math.max(0, piece.seconde + decalage);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", instant.toFixed(3), "-i", piece.video, "-frames:v", "1", "-q:v", "2", sortie]);
  return sortie;
}

async function preparee(chemin: string, piece: Piece, pleineDefinition: boolean): Promise<Buffer> {
  // Pleine définition : la zone est découpée AVANT la réduction à 1 600 px de l'import.
  const source = pleineDefinition ? readFileSync(chemin) : (await commeImportee(chemin)).data;
  return prepareImageForAnalysis(source, piece.zone);
}

export interface ImagePreparee {
  image: Buffer;
  /** Nombres seulement : décalage choisi (s) et netteté (relative), pour le relevé. */
  details: Record<string, number>;
}

const DECALAGES = Array.from({ length: 11 }, (_, i) => Math.round((i - 5) * 10) / 100);

/** L'image envoyée pour une étape, selon sa source. */
export async function imageDeLEtape(piece: Piece, source: SourceImage, travail: string): Promise<ImagePreparee> {
  if (source !== "plus-nette" || !piece.video) {
    const image = await preparee(extraire(piece, 0, join(travail, `${piece.nom}.jpg`)), piece, source === "pleine-definition");
    return { image, details: { nettete: Math.round((await sharp(image).stats()).sharpness * 100) / 100 } };
  }
  let meilleure: ImagePreparee | null = null;
  for (const decalage of DECALAGES) {
    const image = await preparee(extraire(piece, decalage, join(travail, `${piece.nom}-${decalage}.jpg`)), piece, false);
    const nettete = Math.round((await sharp(image).stats()).sharpness * 100) / 100;
    if (!meilleure || nettete > (meilleure.details.nettete ?? 0)) meilleure = { image, details: { nettete, decalage } };
  }
  if (!meilleure) throw new Error(`${piece.nom} : aucune image extraite.`);
  return meilleure;
}

/** Aucun visage sur l'image à envoyer (le corps qui porte le vêtement est attendu). */
export function sansVisage(binaire: string, image: Buffer, travail: string): boolean {
  const chemin = join(travail, "controle-visage.jpg");
  writeFileSync(chemin, image);
  const [detection] = detecter(binaire, [chemin]);
  return detection !== undefined && detection.visages === 0;
}
