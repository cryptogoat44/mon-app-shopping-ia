// Comparaison des modèles pour l'analyse automatique (lot 4, temps 1 bis) :
// Claude Sonnet 5.5 (retenu : réglages du serveur) et Claude Haiku 4.5, sur
// les MÊMES images de quelques vidéos d'essai fournies par le fondateur.
//
//   pnpm --filter backend comparer-modeles-video <dossier>               estimation seule (aucun appel)
//   pnpm --filter backend comparer-modeles-video <dossier> --confirmer   appels réels (clé d'ESSAI)
//
// <dossier> : hors du dépôt, avec les vidéos et un fichier descriptions.json,
// sous l'une de ces deux formes :
//   { "veste.mov": { "description": "veste en daim marron", "attendu": [4, 8] }, … }
//   [ { "fichier": "veste.mov", "description": "veste en daim marron", "attendu": [4, 8] },
//     { "fichier": "veste.mov", "description": "chaussures rouges", "attendu": "aucun" }, … ]
// « attendu », facultatif : les secondes où la pièce est bien visible, ou
// « aucun » si elle n'apparaît pas (cas négatif : juste seulement si aucun
// moment n'est retenu).
// Images : 12 par vidéo, réparties sur sa durée, réduites à 512 px comme dans
// l'app, extraites une seule fois par ffmpeg sur le Mac (l'app écarte en plus
// les images floues et les doublons) ; tous les cas d'une vidéo reçoivent les
// mêmes images. Requête, lecture de la réponse et seuil de confiance :
// exactement ceux du serveur (src/services/videoMoments.ts). Coûts : d'après
// les jetons réellement facturés (« usage »), aux prix vérifiés le 2026-10-05
// et le 2026-10-06. Résultats dans docs/lot-4-auto-comparaison/ : rapport,
// planches (en vert les cadres retenus, en orange ceux écartés par le seuil)
// et page index.html qui les réunit, à ouvrir sur le Mac — rien n'est publié.
// La clé n'est jamais affichée.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import { VIDEO_AI } from "@monapp/shared-types";
import {
  askVideoMoments,
  VIDEO_AI_MIN_CONFIDENCE,
  VIDEO_AI_SETTINGS,
  VideoAiError,
  type FrameForAi,
  type VideoMomentsResult,
} from "../src/services/videoMoments.js";
import { lireCleEssai } from "./lib/anthropic-essai.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SORTIE = join(ROOT, "docs", "lot-4-auto-comparaison");

const MODELES = [
  { nom: "Claude Sonnet 5.5", ...VIDEO_AI_SETTINGS, prixEntree: 2, prixSortie: 10 },
  { nom: "Claude Haiku 4.5", model: "claude-haiku-4-5-20251001", lowEffort: false, prixEntree: 1, prixSortie: 5 },
] as const;
type Modele = (typeof MODELES)[number];

const ATTENDU = z.union([z.tuple([z.number(), z.number()]), z.literal("aucun")]);
const CAS = z.object({ fichier: z.string().min(1), description: z.string().min(2), attendu: ATTENDU.optional() });
const DESCRIPTIONS = z.union([
  z.array(CAS).min(1),
  z.record(z.union([z.string().min(2), z.object({ description: z.string().min(2), attendu: ATTENDU.optional() })])),
]);

/** Plage de secondes où la pièce est bien visible ; « aucun » : elle n'apparaît pas dans la vidéo. */
type Attendu = z.infer<typeof ATTENDU>;

interface Cas {
  fichier: string;
  description: string;
  attendu: Attendu | null;
}

interface Essai extends Cas {
  temps: number[];
  images: FrameForAi[];
}

interface Resultat {
  modele: Modele;
  essai: Essai;
  issue: VideoMomentsResult | { erreur: string };
  secondes: number;
  /** Nom du fichier de la planche (cadres proposés), s'il y a au moins un moment. */
  planche: string | null;
}

/** Les deux formes de descriptions.json → une liste de cas. */
function lireCas(dossier: string): Cas[] {
  const brut = DESCRIPTIONS.parse(JSON.parse(readFileSync(join(dossier, "descriptions.json"), "utf8")));
  if (Array.isArray(brut)) return brut.map((c) => ({ fichier: c.fichier, description: c.description, attendu: c.attendu ?? null }));
  return Object.entries(brut).map(([fichier, valeur]) =>
    typeof valeur === "string"
      ? { fichier, description: valeur, attendu: null }
      : { fichier, description: valeur.description, attendu: valeur.attendu ?? null }
  );
}

/** Le moment à l'instant `seconde` est-il juste ? (pièce absente : aucun moment n'est juste) */
function dansLaPlage(attendu: Attendu, seconde: number): boolean {
  return attendu !== "aucun" && seconde >= attendu[0] && seconde <= attendu[1];
}

/** Verdict sur ce que l'app recevrait (moments retenus) : le premier — identifié aussitôt —
 * tombe-t-il dans la plage indiquée ? Pièce absente : juste seulement si aucun moment n'est retenu. */
function verdict(essai: Essai, issue: VideoMomentsResult): "oui" | "non" | "non noté" {
  if (essai.attendu === null) return "non noté";
  if (essai.attendu === "aucun") return issue.moments.length === 0 ? "oui" : "non";
  const premier = issue.moments[0];
  return premier && dansLaPlage(essai.attendu, essai.temps[premier.frame]!) ? "oui" : "non";
}

/** « 4.5 s ✓ (0.92), 9.5 s ✗ (0.40, écarté) » : tous les moments proposés, avec leur confiance. */
function momentsLisibles(essai: Essai, issue: VideoMomentsResult): string {
  if (issue.candidates.length === 0) return "aucun moment";
  return issue.candidates
    .map(({ frame, confidence }) => {
      const seconde = essai.temps[frame]!;
      const marque = essai.attendu === null ? "" : dansLaPlage(essai.attendu, seconde) ? " ✓" : " ✗";
      const ecarte = confidence < VIDEO_AI_MIN_CONFIDENCE ? ", écarté" : "";
      return `${seconde.toFixed(1)} s${marque} (${confidence.toFixed(2)}${ecarte})`;
    })
    .join(", ");
}

function retenusLisibles(issue: VideoMomentsResult): string {
  return issue.moments.length === 0 ? "aucun moment" : `${issue.moments.length} retenu${issue.moments.length > 1 ? "s" : ""}`;
}

function plageLisible(attendu: Attendu | null): string {
  if (attendu === null) return "non indiquée";
  return attendu === "aucun" ? "pièce absente" : `de ${attendu[0]} à ${attendu[1]} s`;
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

/** Chaque vidéo n'est extraite qu'une fois : tous ses cas reçoivent les mêmes images. */
async function preparerEssais(dossier: string, cas: readonly Cas[], travail: string): Promise<Essai[]> {
  const extraits = new Map<string, { temps: number[]; images: FrameForAi[] }>();
  const essais: Essai[] = [];
  for (const c of cas) {
    let extrait = extraits.get(c.fichier);
    if (!extrait) {
      const dossierVideo = join(travail, String(extraits.size));
      mkdirSync(dossierVideo);
      extrait = await extraire(dossier, c.fichier, dossierVideo);
      extraits.set(c.fichier, extrait);
    }
    essais.push({ ...c, ...extrait });
  }
  return essais;
}

function jetonsImages(images: readonly FrameForAi[]): number {
  return images.reduce((somme, image) => somme + Math.ceil(image.width / 28) * Math.ceil(image.height / 28), 0);
}

function cout(modele: Modele, entree: number, sortie: number): number {
  return (entree * modele.prixEntree + sortie * modele.prixSortie) / 1_000_000;
}

async function interroger(modele: Modele, essai: Essai, apiKey: string): Promise<Resultat> {
  const debut = Date.now();
  try {
    const issue = await askVideoMoments(essai.images, essai.description, { apiKey, model: modele.model, lowEffort: modele.lowEffort });
    return { modele, essai, issue, secondes: (Date.now() - debut) / 1000, planche: null };
  } catch (error) {
    const erreur = error instanceof VideoAiError ? `${error.kind}${error.status ? ` (${error.status})` : ""}` : "erreur inattendue";
    return { modele, essai, issue: { erreur }, secondes: (Date.now() - debut) / 1000, planche: null };
  }
}

/** Planche : les images proposées par un modèle, avec ses cadres (vert : retenu ; orange : écarté
 * par le seuil de confiance), dans l'ordre proposé. Renvoie le nom du fichier, ou null. */
async function dessinerPlanche(resultat: Resultat, nom: string): Promise<string | null> {
  if ("erreur" in resultat.issue || resultat.issue.candidates.length === 0) return null;
  const retenus = new Set(resultat.issue.moments.map((moment) => moment.frame));
  const vignettes = await Promise.all(
    resultat.issue.candidates.map(async ({ frame, box }) => {
      const image = resultat.essai.images[frame]!;
      const couleur = retenus.has(frame) ? "#00FF66" : "#FF9900";
      const svg = `<svg width="${image.width}" height="${image.height}"><rect x="${box.x * image.width}" y="${box.y * image.height}" width="${box.width * image.width}" height="${box.height * image.height}" fill="none" stroke="${couleur}" stroke-width="4"/></svg>`;
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
  const debut = `| ${essai.fichier} | ${essai.description} | ${plageLisible(essai.attendu)} | ${modele.nom}`;
  if ("erreur" in issue) return `${debut} | échec : ${issue.erreur} | — | — | — | — | ${secondes.toFixed(1)} s |`;
  const prix = cout(modele, issue.usage.inputTokens, issue.usage.outputTokens);
  const jetons = `${issue.usage.inputTokens} / ${issue.usage.outputTokens}`;
  return `${debut} | ${momentsLisibles(essai, issue)} | ${retenusLisibles(issue)} | ${verdict(essai, issue)} | ${jetons} | ${prix.toFixed(4)} $ | ${secondes.toFixed(1)} s |`;
}

function synthese(resultats: readonly Resultat[]): string[] {
  return MODELES.map((modele) => {
    const siens = resultats.filter((r) => r.modele === modele);
    const reussis = siens.flatMap((r) => ("erreur" in r.issue ? [] : [{ r, issue: r.issue }]));
    const justes = (liste: typeof reussis) => liste.filter(({ r, issue }) => verdict(r.essai, issue) === "oui").length;
    const positifs = reussis.filter(({ r }) => Array.isArray(r.essai.attendu));
    const negatifs = reussis.filter(({ r }) => r.essai.attendu === "aucun");
    const couts = reussis.map(({ issue }) => cout(modele, issue.usage.inputTokens, issue.usage.outputTokens));
    const moyenne = couts.length ? couts.reduce((a, b) => a + b, 0) / couts.length : 0;
    const total = couts.reduce((a, b) => a + b, 0);
    const duree = siens.length ? siens.reduce((a, r) => a + r.secondes, 0) / siens.length : 0;
    return `- **${modele.nom}** : ${reussis.length}/${siens.length} réponses ; cas positifs, premier moment retenu dans la plage : ${justes(positifs)}/${positifs.length} ; cas négatifs, « aucun moment » : ${justes(negatifs)}/${negatifs.length} ; coût moyen ${moyenne.toFixed(4)} $ par analyse (≈ ${(moyenne * 1000).toFixed(2)} $ pour 1 000), ${total.toFixed(4)} $ au total ; ${duree.toFixed(1)} s en moyenne.`;
  });
}

function echapper(texte: string): string {
  return texte.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Un cas : la vidéo, la pièce cherchée, ce qui est attendu, puis pour chaque modèle ses moments et sa planche. */
function blocHtml(essai: Essai, siens: readonly Resultat[]): string {
  const modeles = siens.map((r) => {
    if ("erreur" in r.issue) return `<h3>${echapper(r.modele.nom)}</h3><p>Échec : ${echapper(r.issue.erreur)}</p>`;
    const prix = cout(r.modele, r.issue.usage.inputTokens, r.issue.usage.outputTokens);
    const image = r.planche ? `<img src="${encodeURI(r.planche)}" alt="Cadres proposés par ${echapper(r.modele.nom)}">` : "";
    const details = `${echapper(momentsLisibles(essai, r.issue))} → ${echapper(retenusLisibles(r.issue))} · ${prix.toFixed(4)} $ · ${r.secondes.toFixed(1)} s`;
    return `<h3>${echapper(r.modele.nom)} — réponse juste : ${verdict(essai, r.issue)}</h3><p>${details}</p>${image}`;
  });
  const titre = `${echapper(essai.fichier)} — on cherche « ${echapper(essai.description)} »`;
  return `<section><h2>${titre}</h2><p>Attendu : ${echapper(plageLisible(essai.attendu))}</p>${modeles.join("")}</section>`;
}

/** Page locale (jamais publiée) qui réunit le résumé et les planches, à ouvrir dans le navigateur du Mac. */
function pageHtml(resultats: readonly Resultat[], syntheses: readonly string[]): string {
  const essais = [...new Set(resultats.map((r) => r.essai))];
  const resume = syntheses.map((s) => `<li>${echapper(s.replace(/\*\*/g, "").replace(/^- /, ""))}</li>`).join("");
  const style = "body{font-family:-apple-system,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#222}img{max-width:100%;border:1px solid #ccc}section{border-top:1px solid #ddd;margin-top:2rem}";
  const legende = `Seuil de confiance du serveur : ${VIDEO_AI_MIN_CONFIDENCE}. ✓ : moment dans la plage indiquée. Cadres verts : retenus (le premier est identifié aussitôt) ; orange : écartés par le seuil.`;
  const blocs = essais.map((essai) => blocHtml(essai, resultats.filter((r) => r.essai === essai))).join("");
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Comparaison Sonnet 5.5 / Haiku 4.5</title><style>${style}</style><h1>Comparaison Sonnet 5.5 / Haiku 4.5</h1><p>${echapper(legende)}</p><ul>${resume}</ul>${blocs}</html>`;
}

/** Planches, rapport (docs/lot-4-auto-comparaison/rapport.md) et page locale index.html. */
async function ecrireResultats(resultats: Resultat[]): Promise<void> {
  mkdirSync(SORTIE, { recursive: true });
  for (const [index, resultat] of resultats.entries()) {
    resultat.planche = await dessinerPlanche(resultat, `${index + 1}-${resultat.essai.fichier}-${resultat.modele.model}.png`);
  }
  const syntheses = synthese(resultats);
  const rapport = [
    "# Comparaison Sonnet 5.5 / Haiku 4.5 — analyse automatique (lot 4, temps 1 bis)",
    "",
    `Date : ${new Date().toISOString().slice(0, 10)}. Mêmes 12 images par vidéo, même requête et même seuil de confiance que le serveur (${VIDEO_AI_MIN_CONFIDENCE}). ✓ : moment dans la plage indiquée ; le premier moment retenu est celui identifié aussitôt.`,
    "",
    "| Vidéo | Pièce cherchée | Attendu | Modèle | Moments proposés (confiance) | Retenus | Réponse juste | Jetons lus / écrits | Coût | Durée |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
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

async function main(): Promise<void> {
  const dossier = resolve(process.argv[2] ?? "");
  const confirmer = process.argv.includes("--confirmer");
  if (!process.argv[2] || !existsSync(join(dossier, "descriptions.json"))) throw new Error("Indiquez un dossier contenant les vidéos et descriptions.json.");
  if (dossier.startsWith(ROOT)) throw new Error("Le dossier des vidéos doit être hors du dépôt (aucune vidéo dans Git).");
  const cas = lireCas(dossier);
  const travail = mkdtempSync(join(tmpdir(), "comparaison-modeles-"));
  try {
    const essais = await preparerEssais(dossier, cas, travail);
    for (const essai of essais) {
      const jetons = jetonsImages(essai.images) + 700;
      const estimations = MODELES.map((m) => `${m.nom} ≈ ${cout(m, jetons, 150).toFixed(4)} $`).join(" ; ");
      console.log(`${essai.fichier} — « ${essai.description} » : ${essai.images.length} images, ≈ ${jetons} jetons lus — ${estimations}`);
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

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
