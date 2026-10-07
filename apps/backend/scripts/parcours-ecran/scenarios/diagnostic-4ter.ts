// Lot 4 ter — étape 0, diagnostic (demande du fondateur, 2026-10-07) : rejeu
// du parcours « une vidéo et quelques mots » tel qu'il existe aujourd'hui
// (version 4 bis, en production), depuis l'ouverture de Spotter jusqu'aux
// résultats, au premier usage : une capture par écran, chaque action comptée.
//
//   pnpm --filter backend parcours-ecran diagnostic-4ter
//
// IA SIMULÉE (aucun appel réel) ; clé SerpApi invalide (aucun crédit) : le
// dernier écran montre l'échec de l'identification à la place des pièces.
// Deux réponses du serveur local sont ralenties de 3 s, le temps de
// photographier les écrans d'attente.
import { rmSync } from "node:fs";
import type { Page } from "playwright-core";
import type { Parcours } from "../boite-a-outils.js";
import { genererVideosEssai } from "../../lib/videos-essai.js";
import { COMBOS } from "./lot-3.js";
import { ouvrirSpotter, TEXTES, type Envoi } from "./lot-4.js";

export const name = "Lot 4 ter — diagnostic du parcours vidéo actuel (site)";
export const outputDir = "lot-4-ter-diagnostic";
// Clé PostHog FACTICE : les envois sont interceptés, rien ne sort.
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };
export const simulatedAi = true;

async function ralentir(page: Page, motif: string): Promise<void> {
  await page.route(motif, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
}

export async function run(p: Parcours): Promise<void> {
  const combo = COMBOS[0]!;
  const videos = await genererVideosEssai();
  const envois: Envoi[] = [];
  const actions: string[] = [];
  try {
    await p.step("Parcours actuel « vidéo + quelques mots », premier usage (fr, clair)", async () => {
      const compte = await p.createAccount("diag", "Louise (test)", { settled: true });
      const page = await ouvrirSpotter(p, compte, combo, envois);
      await p.capture(page, "01-spotter");
      const [selecteur] = await Promise.all([page.waitForEvent("filechooser"), page.getByText(TEXTES.fr.importer).click()]);
      actions.push("toucher « Importer une vidéo »");
      await selecteur.setFiles(videos.courte);
      actions.push("choisir la vidéo dans la fenêtre du système (non photographiable)");
      await page.getByRole("heading", { name: "Que cherchez-vous ?", exact: true }).waitFor({ timeout: 30_000 });
      await p.capture(page, "02-que-cherchez-vous");
      await page.getByPlaceholder("ex. veste en daim marron").fill("veste en daim marron");
      actions.push("taper la description");
      await ralentir(page, "**/api/video-moments");
      await page.getByText("Trouver la pièce", { exact: true }).click();
      actions.push("toucher « Trouver la pièce »");
      await page.getByText("Analyse automatique de la vidéo").waitFor({ timeout: 15_000 });
      await p.capture(page, "03-accord");
      await ralentir(page, "**/api/searches/*/run");
      await page.getByText("Accepter", { exact: true }).click();
      actions.push("toucher « Accepter » (premier usage seulement)");
      await page.getByText("Recherche de la pièce…").waitFor({ timeout: 15_000 });
      await p.capture(page, "04-attente-analyse");
      await page.getByText("Spotto parcourt les boutiques…").waitFor({ timeout: 60_000 });
      await p.capture(page, "05-identification");
      await page.getByText("La recherche n'a pas abouti").waitFor({ timeout: 90_000 });
      await p.capture(page, "06-resultats");
      await page.context().close();
    });
    process.stdout.write(`  actions demandées : ${actions.length}\n${actions.map((action, index) => `    ${index + 1}. ${action}`).join("\n")}\n`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
