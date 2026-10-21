// Ce que partagent les outils d'essai réel de Google Lens (mesure-texte,
// essai-type-recherche) : les pièces d'essai du fondateur (hors de Git),
// l'état de Google Lens sur la page d'état publique de SerpApi, et l'image
// d'une pièce (extraite d'une vidéo sur le Mac, par ffmpeg).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { analyserZone } from "./essai-photo.js";
import { ETAT_ILLISIBLE, ETAT_SERPAPI, etatLens, PIECE, type Piece } from "./mesure-texte.js";

/** Les pièces d'un fichier pieces.json (hors de Git), zones contrôlées. */
export function lirePiecesDe(manifeste: string): Piece[] {
  const pieces = z.array(PIECE).min(1).parse(JSON.parse(readFileSync(manifeste, "utf8")));
  for (const piece of pieces) analyserZone(piece.zone);
  return pieces;
}

/** État de Google Lens chez SerpApi (page d'état publique), ou « illisible ». */
export async function lireEtatLens(): Promise<string> {
  const reponse = await fetch(ETAT_SERPAPI, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Spotto, outil de mesure)" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return (reponse?.ok ? etatLens(await reponse.json().catch(() => null)) : null) ?? ETAT_ILLISIBLE;
}

/** Image de la pièce : la photo telle quelle, ou l'image de la vidéo à l'instant choisi (ffmpeg, sur le Mac). */
export function imageDe(piece: Piece, travail: string): string {
  if (piece.image) return piece.image;
  if (!piece.video || piece.seconde === undefined) throw new Error(`${piece.nom} : ni image, ni vidéo et instant.`);
  const sortie = join(travail, `${piece.nom}.jpg`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", piece.seconde.toFixed(3), "-i", piece.video, "-frames:v", "1", "-q:v", "2", sortie]);
  return sortie;
}
