// Vidéos d'essai du lot 4 (vérifications à l'écran, site et iPhone) : le
// contenu de chaque moment est connu, pour contrôler que l'image choisie est
// la bonne. Fabriquées localement (sharp pour les images, ffmpeg pour la
// vidéo), dans un dossier temporaire ; rien n'est envoyé nulle part.
// - courte.mp4 : 12 s, H.264, 720 × 1280 (format d'un écran de téléphone) :
//   « Sac » de 0 à 4 s, « Veste » de 4 à 8 s, « Chaussures » de 8 à 12 s ;
// - courte-hevc.mov : la même en HEVC, format par défaut des iPhone ;
// - longue.mp4 : 65 s, au-delà de la limite de 60 s.
// Nécessite ffmpeg sur le Mac (Homebrew).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export const SEGMENTS = [
  { texte: "Sac", fond: "#2F3E4E" },
  { texte: "Veste", fond: "#5A4632" },
  { texte: "Chaussures", fond: "#4A5A3A" },
] as const;
const SEGMENT_SECONDES = 4;

/** Couleur « #RRGGBB » en rouge, vert, bleu (0 à 255). */
export function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Couleurs voisines à `tolerance` près sur chaque composante (compression de la vidéo, affichage). */
export function couleurProche(a: readonly number[], b: readonly number[], tolerance: number): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tolerance);
}

export interface VideosEssai {
  dossier: string;
  courte: string;
  hevc: string;
  longue: string;
}

async function image(dossier: string, texte: string, fond: string): Promise<string> {
  const svg = `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${fond}"/>
    <text x="50%" y="52%" font-family="Georgia, serif" font-size="120" fill="#FAF9F7" text-anchor="middle">${texte}</text></svg>`;
  const fichier = join(dossier, `${texte.replace(/\s+/g, "-")}.png`);
  await sharp(Buffer.from(svg)).png().toFile(fichier);
  return fichier;
}

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg a échoué : ${(r.stderr || "").slice(-300)}`);
}

export async function genererVideosEssai(): Promise<VideosEssai> {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg est introuvable (brew install ffmpeg).");
  const dossier = mkdtempSync(join(tmpdir(), "spotto-videos-essai-"));
  const images = await Promise.all(SEGMENTS.map((s) => image(dossier, s.texte, s.fond)));
  // Liste « concat » : chaque image tient 4 s ; la dernière est répétée (règle de ffmpeg).
  const liste = join(dossier, "liste.txt");
  writeFileSync(liste, [...images.map((f) => `file '${f}'\nduration ${SEGMENT_SECONDES}`), `file '${images[images.length - 1]}'`].join("\n"));
  const courte = join(dossier, "courte.mp4");
  const total = String(SEGMENTS.length * SEGMENT_SECONDES);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", liste, "-t", total, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-movflags", "+faststart", courte]);
  const hevc = join(dossier, "courte-hevc.mov");
  ffmpeg(["-i", courte, "-c:v", "libx265", "-tag:v", "hvc1", "-x265-params", "log-level=error", "-movflags", "+faststart", hevc]);
  const longue = join(dossier, "longue.mp4");
  ffmpeg(["-loop", "1", "-i", await image(dossier, "Trop longue", "#3A3A3A"), "-t", "65", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-movflags", "+faststart", longue]);
  return { dossier, courte, hevc, longue };
}
