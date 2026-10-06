// Comparaison des modèles pour l'analyse automatique (lot 4, temps 1 bis) :
// Claude Haiku 4.5 (retenu) et Claude Sonnet 5.5, sur les MÊMES images de
// quelques vidéos d'essai fournies par le fondateur.
//
//   pnpm --filter backend comparer-modeles-video <dossier>               estimation seule (aucun appel)
//   pnpm --filter backend comparer-modeles-video <dossier> --confirmer   appels réels (clé d'ESSAI)
//
// <dossier> : hors du dépôt, avec les vidéos et un fichier descriptions.json :
//   { "veste.mov": { "description": "veste en daim marron", "attendu": [4, 8] }, … }
//   (« attendu », facultatif : les secondes où la pièce est bien visible).
// Images : 12, réparties sur la vidéo, réduites à 512 px comme dans l'app,
// extraites par ffmpeg sur le Mac (l'app, elle, écarte en plus les images
// floues et les doublons). Requête et lecture de la réponse : exactement
// celles du serveur (src/services/videoMoments.ts). Coûts : d'après les
// jetons réellement facturés (« usage » de chaque réponse), aux prix vérifiés
// le 2026-10-05. Résultats dans docs/lot-4-auto-comparaison/ (rapport,
// planches avec les cadres de chaque modèle). La clé n'est jamais affichée.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import { VIDEO_AI } from "@monapp/shared-types";
import { askVideoMoments, VIDEO_AI_MODEL, VideoAiError, type FrameForAi, type VideoMomentsResult } from "../src/services/videoMoments.js";
import { lireCleEssai } from "./lib/anthropic-essai.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SORTIE = join(ROOT, "docs", "lot-4-auto-comparaison");

const MODELES = [
  { nom: "Claude Haiku 4.5", model: VIDEO_AI_MODEL, lowEffort: false, prixEntree: 1, prixSortie: 5 },
  { nom: "Claude Sonnet 5.5", model: "claude-sonnet-5-5", lowEffort: true, prixEntree: 2, prixSortie: 10 },
] as const;

const DESCRIPTIONS = z.record(
  z.union([z.string().min(2), z.object({ description: z.string().min(2), attendu: z.tuple([z.number(), z.number()]).optional() })])
);

interface Essai {
  fichier: string;
  description: string;
  attendu: [number, number] | null;
  temps: number[];
  images: FrameForAi[];
}

interface Resultat {
  modele: (typeof MODELES)[number];
  essai: Essai;
  issue: VideoMomentsResult | { erreur: string };
  secondes: number;
}

function commande(outil: string, args: string[]): string {
  const r = spawnSync(outil, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${outil} a échoué : ${(r.stderr || "").slice(-200)}`);
  return r.stdout;
}

/** 12 images au milieu de 12 tranches de la vidéo, réduites à 512 px. */
async function extraire(dossier: string, fichier: string, travail: string): Promise<{ temps: number[]; images: FrameForAi[] }> {
  const chemin = join(dossier, fichier);
  const duree = Number(commande("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", chemin]).trim());
  if (!Number.isFinite(duree) || duree <= 0) throw new Error(`${fichier} : durée illisible`);
  const temps = Array.from({ length: VIDEO_AI.maxFrames }, (_, index) => ((index + 0.5) / VIDEO_AI.maxFrames) * duree);
  const images: FrameForAi[] = [];
  for (const [index, seconde] of temps.entries()) {
    const sortie = join(travail, `${index}.jpg`);
    commande("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", seconde.toFixed(3), "-i", chemin, "-frames:v", "1", sortie]);
    const { data, info } = await sharp(sortie)
      .rotate()
      .resize({ width: VIDEO_AI.frameEdge, height: VIDEO_AI.frameEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    images.push({ data, width: info.width, height: info.height });
  }
  return { temps, images };
}

function jetonsImages(images: readonly FrameForAi[]): number {
  return images.reduce((somme, image) => somme + Math.ceil(image.width / 28) * Math.ceil(image.height / 28), 0);
}

function cout(modele: (typeof MODELES)[number], entree: number, sortie: number): number {
  return (entree * modele.prixEntree + sortie * modele.prixSortie) / 1_000_000;
}

async function interroger(modele: (typeof MODELES)[number], essai: Essai, apiKey: string): Promise<Resultat> {
  const debut = Date.now();
  try {
    const issue = await askVideoMoments(essai.images, essai.description, { apiKey, model: modele.model, lowEffort: modele.lowEffort });
    return { modele, essai, issue, secondes: (Date.now() - debut) / 1000 };
  } catch (error) {
    const erreur = error instanceof VideoAiError ? `${error.kind}${error.status ? ` (${error.status})` : ""}` : "erreur inattendue";
    return { modele, essai, issue: { erreur }, secondes: (Date.now() - debut) / 1000 };
  }
}

/** Planche : les images choisies par un modèle, avec ses cadres. */
async function planche(resultat: Resultat, chemin: string): Promise<void> {
  if ("erreur" in resultat.issue || resultat.issue.moments.length === 0) return;
  const vignettes = await Promise.all(
    resultat.issue.moments.map(async ({ frame, box }) => {
      const image = resultat.essai.images[frame]!;
      const svg = `<svg width="${image.width}" height="${image.height}"><rect x="${box.x * image.width}" y="${box.y * image.height}" width="${box.width * image.width}" height="${box.height * image.height}" fill="none" stroke="#00FF66" stroke-width="4"/></svg>`;
      return sharp(image.data).composite([{ input: Buffer.from(svg) }]).png().toBuffer({ resolveWithObject: true });
    })
  );
  const largeur = vignettes.reduce((somme, v) => somme + v.info.width + 8, 0);
  const hauteur = Math.max(...vignettes.map((v) => v.info.height));
  let gauche = 0;
  const calques = vignettes.map((v) => {
    const calque = { input: v.data, left: gauche, top: 0 };
    gauche += v.info.width + 8;
    return calque;
  });
  await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: "#888888" } }).composite(calques).png().toFile(chemin);
}

function ligne(resultat: Resultat): string {
  const { modele, essai, issue, secondes } = resultat;
  if ("erreur" in issue) return `| ${essai.fichier} | ${modele.nom} | échec : ${issue.erreur} | — | — | — | ${secondes.toFixed(1)} s |`;
  const moments = issue.moments.map((m) => `${essai.temps[m.frame]!.toFixed(1)} s`).join(", ") || "aucun";
  const premier = issue.moments[0] ? essai.temps[issue.moments[0].frame]! : null;
  const juste = essai.attendu && premier !== null ? (premier >= essai.attendu[0] && premier <= essai.attendu[1] ? "oui" : "non") : "—";
  const prix = cout(modele, issue.usage.inputTokens, issue.usage.outputTokens);
  return `| ${essai.fichier} | ${modele.nom} | ${moments} | ${juste} | ${issue.usage.inputTokens} / ${issue.usage.outputTokens} | ${prix.toFixed(4)} $ | ${secondes.toFixed(1)} s |`;
}

function synthese(resultats: readonly Resultat[]): string[] {
  return MODELES.map((modele) => {
    const siens = resultats.filter((r) => r.modele === modele);
    const reussis = siens.flatMap((r) => ("erreur" in r.issue ? [] : [{ r, issue: r.issue }]));
    const couts = reussis.map(({ issue }) => cout(modele, issue.usage.inputTokens, issue.usage.outputTokens));
    const notes = reussis.filter(({ r }) => r.essai.attendu !== null);
    const justes = notes.filter(({ r, issue }) => {
      const premier = issue.moments[0];
      return premier && r.essai.attendu && r.essai.temps[premier.frame]! >= r.essai.attendu[0] && r.essai.temps[premier.frame]! <= r.essai.attendu[1];
    });
    const moyenne = couts.length ? couts.reduce((a, b) => a + b, 0) / couts.length : 0;
    const duree = siens.length ? siens.reduce((a, r) => a + r.secondes, 0) / siens.length : 0;
    return `- **${modele.nom}** : ${reussis.length}/${siens.length} réponses ; meilleur moment juste : ${notes.length ? `${justes.length}/${notes.length}` : "non noté"} ; coût moyen ${moyenne.toFixed(4)} $ par vidéo (≈ ${(moyenne * 1000).toFixed(2)} $ pour 1 000) ; ${duree.toFixed(1)} s en moyenne.`;
  });
}

async function main(): Promise<void> {
  const dossier = resolve(process.argv[2] ?? "");
  const confirmer = process.argv.includes("--confirmer");
  if (!process.argv[2] || !existsSync(join(dossier, "descriptions.json"))) throw new Error("Indiquez un dossier contenant les vidéos et descriptions.json.");
  if (dossier.startsWith(ROOT)) throw new Error("Le dossier des vidéos doit être hors du dépôt (aucune vidéo dans Git).");
  const descriptions = DESCRIPTIONS.parse(JSON.parse(readFileSync(join(dossier, "descriptions.json"), "utf8")));
  const travail = mkdtempSync(join(tmpdir(), "comparaison-modeles-"));
  try {
    const essais: Essai[] = [];
    for (const [fichier, valeur] of Object.entries(descriptions)) {
      const description = typeof valeur === "string" ? valeur : valeur.description;
      const attendu = typeof valeur === "string" ? null : (valeur.attendu ?? null);
      const dossierEssai = join(travail, String(essais.length));
      mkdirSync(dossierEssai);
      essais.push({ fichier, description, attendu, ...(await extraire(dossier, fichier, dossierEssai)) });
    }
    for (const essai of essais) {
      const jetons = jetonsImages(essai.images) + 600;
      const estimations = MODELES.map((m) => `${m.nom} ≈ ${cout(m, jetons, 150).toFixed(4)} $`).join(" ; ");
      console.log(`${essai.fichier} : ${essai.images.length} images, ≈ ${jetons} jetons lus — ${estimations}`);
    }
    if (!confirmer) {
      console.log("Estimation seule : aucun appel envoyé. Ajoutez --confirmer pour comparer (clé d'ESSAI).");
      return;
    }
    const apiKey = lireCleEssai();
    const resultats: Resultat[] = [];
    for (const essai of essais) for (const modele of MODELES) resultats.push(await interroger(modele, essai, apiKey));
    mkdirSync(SORTIE, { recursive: true });
    for (const [index, resultat] of resultats.entries()) await planche(resultat, join(SORTIE, `${index + 1}-${resultat.essai.fichier}-${resultat.modele.model}.png`));
    const rapport = [
      "# Comparaison Haiku 4.5 / Sonnet 5.5 — analyse automatique (lot 4, temps 1 bis)",
      "",
      `Date : ${new Date().toISOString().slice(0, 10)}. Mêmes 12 images par vidéo, même requête que le serveur.`,
      "",
      "| Vidéo | Modèle | Moments proposés | Meilleur moment juste | Jetons lus / écrits | Coût | Durée |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...resultats.map(ligne),
      "",
      ...synthese(resultats),
      "",
    ].join("\n");
    writeFileSync(join(SORTIE, "rapport.md"), rapport);
    console.log(rapport);
    console.log(`Planches et rapport : docs/lot-4-auto-comparaison/`);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
