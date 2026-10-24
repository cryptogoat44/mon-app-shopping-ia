// Planches des lots 2 et 3 (décision du fondateur, 2026-10-24) : les
// propositions qu'ajouterait la règle des prix, pour juger si elles sont
// encore pertinentes. Sur le Mac seulement (Téléchargements, hors iCloud et
// hors Git), supprimées le 2 novembre. Aucune image de personne (détection
// d'Apple) ni de réseau social (déjà écartés par les filtres du serveur).
// Étiquettes : rang chez Google, domaine, devise — jamais un titre.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { detecter } from "./serie-images.js";
import type { Ajout } from "./serie-mesures.js";

export const DOSSIER_PLANCHES = join(homedir(), "Downloads", "spotto-essais-photo", "planches");

const COTE = 220;
const BANDEAU = 34;
const PAR_LIGNE = 5;

function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Étiquette d'une vignette : rang, domaine, devise (sans titre). */
export function etiquette(ajout: Pick<Ajout, "rang" | "domaine" | "devise">): string {
  return `rang ${ajout.rang} · ${ajout.domaine.slice(0, 28)}${ajout.devise ? ` · ${ajout.devise}` : ""}`;
}

async function vignette(adresse: string): Promise<Buffer | null> {
  try {
    const reponse = await fetch(adresse, { signal: AbortSignal.timeout(10_000) });
    if (!reponse.ok) return null;
    return await sharp(Buffer.from(await reponse.arrayBuffer())).resize(COTE, COTE, { fit: "contain", background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

function bandeau(texte: string): Buffer {
  return Buffer.from(`<svg width="${COTE}" height="${BANDEAU}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#1f1f1f"/><text x="6" y="22" font-family="Helvetica" font-size="13" fill="#ffffff">${echapper(texte)}</text></svg>`);
}

/** Compose et écrit la planche ; renvoie le nombre d'images montrées et écartées (personne, illisible). */
export async function ecrirePlanche(nom: string, ajouts: readonly Ajout[], binaireVisages: string, travail: string): Promise<{ montrees: number; ecartees: number }> {
  const candidates: { ajout: Ajout; image: Buffer; chemin: string }[] = [];
  for (const [index, ajout] of ajouts.entries()) {
    const image = ajout.vignette ? await vignette(ajout.vignette) : null;
    if (!image) continue;
    const chemin = join(travail, `vignette-${index}.jpg`);
    writeFileSync(chemin, image);
    candidates.push({ ajout, image, chemin });
  }
  const detections = detecter(binaireVisages, candidates.map((c) => c.chemin));
  for (const { chemin } of candidates) rmSync(chemin, { force: true });
  const gardees = candidates.filter((_, i) => detections[i]?.visages === 0 && detections[i]?.personnes === 0);
  if (gardees.length === 0) return { montrees: 0, ecartees: ajouts.length };
  const lignes = Math.ceil(gardees.length / PAR_LIGNE);
  const largeur = Math.min(gardees.length, PAR_LIGNE) * COTE;
  const morceaux = gardees.flatMap(({ ajout, image }, i) => {
    const left = (i % PAR_LIGNE) * COTE;
    const top = Math.floor(i / PAR_LIGNE) * (COTE + BANDEAU);
    return [{ input: image, left, top }, { input: bandeau(etiquette(ajout)), left, top: top + COTE }];
  });
  const planche = await sharp({ create: { width: largeur, height: lignes * (COTE + BANDEAU), channels: 3, background: "#ffffff" } }).composite(morceaux).jpeg({ quality: 85 }).toBuffer();
  mkdirSync(DOSSIER_PLANCHES, { recursive: true });
  writeFileSync(join(DOSSIER_PLANCHES, `${nom}.jpg`), planche);
  return { montrees: gardees.length, ecartees: ajouts.length - gardees.length };
}
