// Comparaison des modèles pour l'analyse automatique (lot 4, temps 1 bis) :
// Claude Haiku 4.5 (retenu) et Claude Sonnet 5.5, sur les MÊMES images de
// quelques vidéos d'essai fournies par le fondateur.
//
//   pnpm --filter backend comparer-modeles-video <dossier>               estimation seule (aucun appel)
//   pnpm --filter backend comparer-modeles-video <dossier> --confirmer   appels réels (clé d'ESSAI)
//
// <dossier> : hors du dépôt, avec les vidéos et un fichier descriptions.json :
//   { "veste.mov": { "description": "veste en daim marron", "attendu": [4, 8] },
//     "plage.mov": { "description": "chapeau de paille", "attendu": "aucun" }, … }
//   (« attendu », facultatif : les secondes où la pièce est bien visible, ou
//   « aucun » pour une vidéo où elle n'apparaît pas — juste si aucun moment).
// Images : 12, réparties sur la vidéo, réduites à 512 px comme dans l'app,
// extraites par ffmpeg sur le Mac (l'app, elle, écarte en plus les images
// floues et les doublons). Requête et lecture de la réponse : exactement
// celles du serveur (src/services/videoMoments.ts). Coûts : d'après les
// jetons réellement facturés (« usage » de chaque réponse), aux prix vérifiés
// le 2026-10-05. Résultats dans docs/lot-4-auto-comparaison/ (rapport,
// planches avec les cadres de chaque modèle, page index.html qui les réunit,
// à ouvrir sur le Mac : rien n'est publié). La clé n'est jamais affichée.
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

const ATTENDU = z.union([z.tuple([z.number(), z.number()]), z.literal("aucun")]);
const DESCRIPTIONS = z.record(z.union([z.string().min(2), z.object({ description: z.string().min(2), attendu: ATTENDU.optional() })]));

/** Plage de secondes où la pièce est bien visible ; « aucun » : elle n'apparaît pas dans la vidéo. */
type Attendu = z.infer<typeof ATTENDU>;

interface Essai {
  fichier: string;
  description: string;
  attendu: Attendu | null;
  temps: number[];
  images: FrameForAi[];
}

interface Resultat {
  modele: (typeof MODELES)[number];
  essai: Essai;
  issue: VideoMomentsResult | { erreur: string };
  secondes: number;
  /** Nom du fichier de la planche (cadres choisis), s'il y a au moins un moment. */
  planche: string | null;
}

/** Le moment à l'instant `seconde` est-il juste ? (pièce absente : aucun moment n'est juste) */
function dansLaPlage(attendu: Attendu, seconde: number): boolean {
  return attendu !== "aucun" && seconde >= attendu[0] && seconde <= attendu[1];
}

/** Verdict sur la réponse : le meilleur moment (le premier, celui identifié aussitôt) tombe-t-il
 * dans la plage indiquée ? Pièce absente : juste seulement si le modèle ne propose aucun moment. */
function verdict(essai: Essai, issue: VideoMomentsResult): "oui" | "non" | "non noté" {
  if (essai.attendu === null) return "non noté";
  if (essai.attendu === "aucun") return issue.moments.length === 0 ? "oui" : "non";
  const premier = issue.moments[0];
  return premier && dansLaPlage(essai.attendu, essai.temps[premier.frame]!) ? "oui" : "non";
}

/** « 4.5 s ✓, 9.5 s ✗ » (✓ : dans la plage indiquée), ou « aucun moment ». */
function momentsLisibles(essai: Essai, issue: VideoMomentsResult): string {
  if (issue.moments.length === 0) return "aucun moment";
  return issue.moments
    .map(({ frame }) => {
      const seconde = essai.temps[frame]!;
      const marque = essai.attendu === null ? "" : dansLaPlage(essai.attendu, seconde) ? " ✓" : " ✗";
      return `${seconde.toFixed(1)} s${marque}`;
    })
    .join(", ");
}

function plageLisible(attendu: Attendu | null): string {
  if (attendu === null) return "non indiquée";
  return attendu === "aucun" ? "pièce absente de la vidéo" : `de ${attendu[0]} à ${attendu[1]} s`;
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
    return { modele, essai, issue, secondes: (Date.now() - debut) / 1000, planche: null };
  } catch (error) {
    const erreur = error instanceof VideoAiError ? `${error.kind}${error.status ? ` (${error.status})` : ""}` : "erreur inattendue";
    return { modele, essai, issue: { erreur }, secondes: (Date.now() - debut) / 1000, planche: null };
  }
}

/** Planche : les images choisies par un modèle, avec ses cadres, dans l'ordre proposé.
 * Renvoie le nom du fichier, ou null s'il n'y a rien à montrer. */
async function dessinerPlanche(resultat: Resultat, nom: string): Promise<string | null> {
  if ("erreur" in resultat.issue || resultat.issue.moments.length === 0) return null;
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
  await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: "#888888" } }).composite(calques).png().toFile(join(SORTIE, nom));
  return nom;
}

function ligne(resultat: Resultat): string {
  const { modele, essai, issue, secondes } = resultat;
  const debut = `| ${essai.fichier} | ${plageLisible(essai.attendu)} | ${modele.nom}`;
  if ("erreur" in issue) return `${debut} | échec : ${issue.erreur} | — | — | — | ${secondes.toFixed(1)} s |`;
  const prix = cout(modele, issue.usage.inputTokens, issue.usage.outputTokens);
  return `${debut} | ${momentsLisibles(essai, issue)} | ${verdict(essai, issue)} | ${issue.usage.inputTokens} / ${issue.usage.outputTokens} | ${prix.toFixed(4)} $ | ${secondes.toFixed(1)} s |`;
}

function synthese(resultats: readonly Resultat[]): string[] {
  return MODELES.map((modele) => {
    const siens = resultats.filter((r) => r.modele === modele);
    const reussis = siens.flatMap((r) => ("erreur" in r.issue ? [] : [{ r, issue: r.issue }]));
    const couts = reussis.map(({ issue }) => cout(modele, issue.usage.inputTokens, issue.usage.outputTokens));
    const notes = reussis.map(({ r, issue }) => verdict(r.essai, issue)).filter((v) => v !== "non noté");
    const justes = notes.filter((v) => v === "oui").length;
    const moyenne = couts.length ? couts.reduce((a, b) => a + b, 0) / couts.length : 0;
    const duree = siens.length ? siens.reduce((a, r) => a + r.secondes, 0) / siens.length : 0;
    return `- **${modele.nom}** : ${reussis.length}/${siens.length} réponses ; réponse juste : ${notes.length ? `${justes}/${notes.length}` : "non noté"} ; coût moyen ${moyenne.toFixed(4)} $ par vidéo (≈ ${(moyenne * 1000).toFixed(2)} $ pour 1 000) ; ${duree.toFixed(1)} s en moyenne.`;
  });
}

function echapper(texte: string): string {
  return texte.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Une vidéo : sa description, la plage indiquée, puis pour chaque modèle ses moments et sa planche. */
function blocHtml(essai: Essai, siens: readonly Resultat[]): string {
  const modeles = siens.map((r) => {
    if ("erreur" in r.issue) return `<h3>${echapper(r.modele.nom)}</h3><p>Échec : ${echapper(r.issue.erreur)}</p>`;
    const prix = cout(r.modele, r.issue.usage.inputTokens, r.issue.usage.outputTokens);
    const image = r.planche ? `<img src="${encodeURI(r.planche)}" alt="Cadres choisis par ${echapper(r.modele.nom)}">` : "";
    const details = `${echapper(momentsLisibles(essai, r.issue))} · ${prix.toFixed(4)} $ · ${r.secondes.toFixed(1)} s`;
    return `<h3>${echapper(r.modele.nom)} — réponse juste : ${verdict(essai, r.issue)}</h3><p>${details}</p>${image}`;
  });
  return `<section><h2>${echapper(essai.fichier)} — « ${echapper(essai.description)} »</h2><p>Plage indiquée : ${echapper(plageLisible(essai.attendu))}</p>${modeles.join("")}</section>`;
}

/** Page locale (jamais publiée) qui réunit le résumé et les planches, à ouvrir dans le navigateur du Mac. */
function pageHtml(resultats: readonly Resultat[], syntheses: readonly string[]): string {
  const essais = [...new Set(resultats.map((r) => r.essai))];
  const resume = syntheses.map((s) => `<li>${echapper(s.replace(/\*\*/g, "").replace(/^- /, ""))}</li>`).join("");
  const style = "body{font-family:-apple-system,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#222}img{max-width:100%;border:1px solid #ccc}section{border-top:1px solid #ddd;margin-top:2rem}";
  const blocs = essais.map((essai) => blocHtml(essai, resultats.filter((r) => r.essai === essai))).join("");
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Comparaison Haiku 4.5 / Sonnet 5.5</title><style>${style}</style><h1>Comparaison Haiku 4.5 / Sonnet 5.5</h1><p>✓ : moment dans la plage indiquée. Le premier moment est celui qui est identifié aussitôt.</p><ul>${resume}</ul>${blocs}</html>`;
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
    await ecrireResultats(resultats);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}

/** Planches, rapport (docs/lot-4-auto-comparaison/rapport.md) et page locale index.html. */
async function ecrireResultats(resultats: Resultat[]): Promise<void> {
  mkdirSync(SORTIE, { recursive: true });
  for (const [index, resultat] of resultats.entries()) {
    resultat.planche = await dessinerPlanche(resultat, `${index + 1}-${resultat.essai.fichier}-${resultat.modele.model}.png`);
  }
  const syntheses = synthese(resultats);
  const rapport = [
    "# Comparaison Haiku 4.5 / Sonnet 5.5 — analyse automatique (lot 4, temps 1 bis)",
    "",
    `Date : ${new Date().toISOString().slice(0, 10)}. Mêmes 12 images par vidéo, même requête que le serveur. ✓ : moment dans la plage indiquée ; le premier est celui identifié aussitôt.`,
    "",
    "| Vidéo | Plage indiquée | Modèle | Moments proposés | Réponse juste | Jetons lus / écrits | Coût | Durée |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...resultats.map(ligne),
    "",
    ...syntheses,
    "",
  ].join("\n");
  writeFileSync(join(SORTIE, "rapport.md"), rapport);
  writeFileSync(join(SORTIE, "index.html"), pageHtml(resultats, syntheses));
  console.log(rapport);
  console.log("Planches, rapport et page à ouvrir sur le Mac : docs/lot-4-auto-comparaison/index.html");
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
