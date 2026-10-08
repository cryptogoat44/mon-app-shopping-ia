// Lot 4 ter — parcours unique du Spotter (site), dans les 4 combinaisons.
//
//   pnpm --filter backend parcours-ecran lot-4-ter
//
// « Ajouter une vidéo », quelques mots, « Lancer » : tout s'enchaîne. IA
// d'Anthropic SIMULÉE dans le serveur local (aucun appel réel) ; SerpApi :
// clé invalide (aucun crédit). Pour montrer l'écran des résultats, la
// réponse de l'identification est fabriquée DANS LE NAVIGATEUR (aucune
// requête ne part). Chaque geste demandé à la personne est compté
// (docs/lot-4-ter-captures/actions.md). Vidéo d'essai de 12 s : « Sac »,
// « Veste », « Chaussures ».
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import sharp from "sharp";
import type { Parcours } from "../boite-a-outils.js";
import { genererVideosEssai } from "../../lib/videos-essai.js";
import { COMBOS, type Combo } from "./lot-3.js";
import { check, choisirFichier, ouvrirSpotter, suivreRequetes, visible, type Envoi } from "./spotter-outils.js";
import { capteur, champPret, controlerResultatsSobres, fermerFeuille, nouveauCompte, ralentir, simulerResultats, TEXTES } from "./lot-4-ter-outils.js";
import { corrections, identificationReelle, liens, limites, nouvelleVersion, photo, refusEtRetrait, replis, sansResultat } from "./lot-4-ter-etapes.js";

export const name = "Lot 4 ter — parcours unique du Spotter (site)";
export const outputDir = "lot-4-ter-captures";
// Clé PostHog FACTICE : les envois sont interceptés, rien ne sort.
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };
export const simulatedAi = true;

interface Comptage {
  combo: string;
  premierUsage: string[];
  ensuite: string[];
}

/** Premier usage : vidéo → mots → « Lancer » → accord → attente → résultats → corrections. */
async function premierUsage(p: Parcours, page: Page, combo: Combo, video: string, problemes: string[]): Promise<string[]> {
  const T = TEXTES[combo.locale];
  const capture = capteur(p, page, combo, problemes);
  const suivi = suivreRequetes(page);
  const actions: string[] = [];
  await capture("01-spotter");
  check((await page.getByPlaceholder(T.lienAncien).count()) === 0, "plus de champ de lien sur Spotter");
  await choisirFichier(page, T.ajouterVideo, video);
  actions.push(`toucher « ${T.ajouterVideo} »`, "choisir la vidéo (fenêtre du système)");
  await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, T);
  await page.waitForTimeout(800); // aperçu de la vidéo
  await capture("02-question");
  await page.keyboard.type(T.description);
  actions.push("taper les mots (le champ est déjà prêt)");
  await capture("03-mots");
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
  actions.push(`toucher « ${T.lancer} »`);
  await visible(page, T.accord).waitFor({ timeout: 15_000 });
  const avantAccord = suivi.analyses;
  check(avantAccord === 0, "aucune image envoyée avant l'accord");
  await capture("04-accord");
  await ralentir(page, "**/api/video-moments");
  await simulerResultats(page, T.description);
  await page.getByRole("button", { name: T.accepter, exact: true }).filter({ visible: true }).click();
  actions.push(`toucher « ${T.accepter} » (premier usage seulement)`);
  await visible(page, T.attenteVideo).waitFor({ timeout: 15_000 });
  check((await page.getByText(T.etape).count()) === 0, "aucun libellé « Étape … sur 3 »");
  await capture("05-attente", "nuit");
  await visible(page, T.attenteBoutiques).waitFor({ timeout: 30_000 });
  await capture("06-attente-boutiques", "nuit");
  await visible(page, T.meilleure).waitFor({ timeout: 30_000 });
  await controlerResultatsSobres(page, T);
  await capture("07-resultats");
  check(suivi.analyses === 1, `une seule analyse envoyée (${suivi.analyses})`);
  await visible(page, T.pasLaBonne).click();
  await visible(page, T.essayerDeux).waitFor({ timeout: 10_000 });
  await capture("08-corrections");
  await fermerFeuille(page, T);
  return actions;
}

/** Ensuite : plus d'écran d'accord — choisir la vidéo, taper les mots, « Lancer ». */
async function usageSuivant(p: Parcours, page: Page, combo: Combo, video: string, problemes: string[]): Promise<string[]> {
  const T = TEXTES[combo.locale];
  const actions: string[] = [];
  await page.goto(`${p.siteUrl}/`);
  await visible(page, T.ajouterVideo).waitFor({ timeout: 30_000 });
  await choisirFichier(page, T.ajouterVideo, video);
  actions.push(`toucher « ${T.ajouterVideo} »`, "choisir la vidéo (fenêtre du système)");
  await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, T);
  await page.keyboard.type(T.description);
  actions.push("taper les mots");
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
  actions.push(`toucher « ${T.lancer} »`);
  await visible(page, T.meilleure).waitFor({ timeout: 60_000 });
  check((await visible(page, T.accord).count()) === 0, "l'accord n'est plus demandé");
  await capteur(p, page, combo, problemes)("09-relance-resultats");
  return actions;
}

function controlerStatistiques(envois: Envoi[]): void {
  const autorisees = new Set(["decision", "context", "frames_count", "duration_s", "outcome", "moments_count", "rank", "source", "reason", "environment", "platform", "$geoip_disable", "$process_person_profile"]);
  const video = envois.filter((e) => e.event.startsWith("video_"));
  for (const envoi of video) {
    const intrus = Object.keys(envoi.properties).filter((cle) => !autorisees.has(cle));
    check(intrus.length === 0, `${envoi.event} : propriétés hors liste ${intrus.join(", ")}`);
  }
  const de = (event: string, attendu: Record<string, unknown>) =>
    video.filter((e) => e.event === event && Object.entries(attendu).every(([cle, valeur]) => e.properties[cle] === valeur)).length;
  check(de("video_imported", { duration_s: 12, source: "file" }) >= COMBOS.length * 2, "vidéos importées (12 s, fichier)");
  check(de("video_ai_consent", { decision: "granted", context: "first_use" }) >= COMBOS.length, "accords au premier usage");
  check(de("video_ai_consent", { decision: "declined", context: "first_use" }) === 1, "refus par le lien discret");
  check(de("video_ai_consent", { decision: "withdrawn", context: "settings" }) === 1, "retrait dans les Réglages");
  check(de("video_ai_frames_sent", { frames_count: 3, duration_s: 12 }) >= COMBOS.length * 2, "images envoyées : nombre et durée");
  check(de("video_ai_result", { outcome: "found", moments_count: 3 }) >= COMBOS.length * 2, "moments trouvés");
  check(de("video_ai_result", { outcome: "not_found", moments_count: 0 }) === 2, "pièce non repérée (liste vide, puis moments sous le seuil)");
  check(de("video_ai_result", { outcome: "unavailable" }) === 1, "panne de l'IA");
}

function rapport(p: Parcours, comptages: Comptage[]): void {
  const lignes = comptages.flatMap(({ combo, premierUsage, ensuite }) => [
    `## ${combo}`,
    `Premier usage : ${premierUsage.length} gestes`,
    ...premierUsage.map((action, index) => `${index + 1}. ${action}`),
    `Ensuite : ${ensuite.length} gestes`,
    ...ensuite.map((action, index) => `${index + 1}. ${action}`),
    "",
  ]);
  p.writeReport("actions.md", `# Lot 4 ter — gestes demandés (site)\n\n${lignes.join("\n")}\n`);
  for (const { combo, premierUsage, ensuite } of comptages) {
    process.stdout.write(`  ${combo} : ${premierUsage.length} gestes au premier usage, ${ensuite.length} ensuite\n`);
  }
}

export async function run(p: Parcours): Promise<void> {
  const videos = await genererVideosEssai();
  const photoEssai = join(videos.dossier, "photo.jpg");
  writeFileSync(photoEssai, await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#26262A" } }).jpeg().toBuffer());
  const envois: Envoi[] = [];
  const problemes: string[] = [];
  const comptages: Comptage[] = [];
  try {
    for (const combo of COMBOS) {
      await p.step(`${combo.id} : vidéo, mots, « Lancer », accord, attente, résultats, corrections ; puis relance sans accord`, async () => {
        const compte = await nouveauCompte(p, `t${combo.id.replace("-", "")}`);
        const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
        const premier = await premierUsage(p, page, combo, videos.courte, problemes);
        if (combo.id === "fr-clair") await corrections(p, page, combo, problemes);
        const ensuite = await usageSuivant(p, page, combo, videos.courte, problemes);
        comptages.push({ combo: combo.id, premierUsage: premier, ensuite });
        if (combo.id === "fr-clair") {
          // Fin des réponses fabriquées : l'interception des statistiques, elle, reste en place.
          await page.unroute("**/api/searches/*/run");
          await page.unroute("**/api/video-moments");
          await identificationReelle(p, page, compte, videos.courte, problemes);
          await replis(p, page, videos.courte, problemes);
          await liens(p, page, videos.courte, problemes);
          await photo(p, page, photoEssai, problemes);
          await sansResultat(p, page, photoEssai, problemes);
          await nouvelleVersion(p, page, problemes);
          await refusEtRetrait(p, page, envois, videos.courte, problemes);
        }
        if (combo.id === "fr-clair" || combo.id === "en-sombre") await limites(p, page, combo, videos, problemes);
        await page.context().close();
      });
    }
    await p.step("Statistiques : événements vidéo, liste fermée", async () => controlerStatistiques(envois));
    rapport(p, comptages);
    check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
