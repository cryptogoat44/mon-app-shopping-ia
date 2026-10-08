// Lot 4 quater — plafond global des recherches SerpApi (site).
//
//   pnpm --filter backend parcours-ecran lot-4-quater
//
// La réponse « plafond atteint » (429) est fabriquée DANS LE NAVIGATEUR, telle
// que le serveur l'envoie (le serveur lui-même est vérifié par
// tests/spotterFlow.test.ts, videoMoments.test.ts et searchCapacity.test.ts) :
// aucune requête ne part vers SerpApi ni vers l'IA. Photo : plafond du jour,
// puis des 31 jours (date de reprise) ; vidéo : plafond atteint avant
// l'analyse par l'IA. Français clair et anglais sombre.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import sharp from "sharp";
import { SEARCH_CAPACITY_ERRORS, type SearchCapacityErrorBody, type SearchCapacityPeriod } from "@monapp/shared-types";
import type { Parcours } from "../boite-a-outils.js";
import { genererVideosEssai } from "../../lib/videos-essai.js";
import { COMBOS, type Combo } from "./lot-3.js";
import { check, choisirFichier, ouvrirSpotter, suivreRequetes, visible, type Envoi } from "./spotter-outils.js";
import { capteur, lancerPhoto, lancerVideo, nouveauCompte, TEXTES } from "./lot-4-ter-outils.js";

export const name = "Lot 4 quater — plafond global des recherches (site)";
export const outputDir = "lot-4-quater-captures";
// Clé PostHog FACTICE : les envois sont interceptés, rien ne sort.
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };
// Analyse automatique active dans le serveur local (IA simulée) ; ses réponses sont de toute façon fabriquées ici.
export const simulatedAi = true;

const FIN_DU_JOUR = "2026-10-09T22:00:00.000Z";
const REPRISE = "2026-11-12T10:31:00.000Z";
const PLAFOND = {
  fr: {
    jour: ["Le service de recherche est très sollicité aujourd'hui.", "Réessayez demain."],
    mois: ["Le service de recherche a atteint sa limite mensuelle.", "Réessayez à partir du 12 novembre 2026."],
    tropDeRecherches: "Trop de recherches d'un coup",
    retour: "Retour à Spotter",
  },
  en: {
    jour: ["The search service is in very high demand today.", "Please try again tomorrow."],
    mois: ["The search service has reached its monthly limit.", "Please try again from November 12, 2026."],
    tropDeRecherches: "Too many searches at once",
    retour: "Back to Spotter",
  },
} as const;

/** Réponse 429 du serveur quand le plafond est atteint, fabriquée dans le navigateur. */
async function plafondAtteint(page: Page, motif: string, period: SearchCapacityPeriod, retryAt: string): Promise<void> {
  const body: SearchCapacityErrorBody = { error: SEARCH_CAPACITY_ERRORS[period], message: "…", retryAt };
  await page.route(motif, (route) => route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "3600" }, body: JSON.stringify(body) }));
}

/** Le message du plafond, seul : ni « trop de recherches d'un coup », ni correction à tenter, et le retour à Spotter. */
async function controlerMessage(page: Page, combo: Combo, period: SearchCapacityPeriod, ecran: string): Promise<void> {
  const T = TEXTES[combo.locale];
  const P = PLAFOND[combo.locale];
  const [titre, conseil] = P[period === "day" ? "jour" : "mois"];
  await page.getByRole("heading", { name: titre, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  check((await visible(page, conseil).count()) === 1, `${ecran} : conseil « ${conseil} »`);
  check((await visible(page, P.tropDeRecherches).count()) === 0, `${ecran} : jamais « ${P.tropDeRecherches} »`);
  for (const correction of [T.reessayer, T.recadrer, T.sansTexte, T.moiMeme]) {
    check((await visible(page, correction).count()) === 0, `${ecran} : « ${correction} » n'est pas proposé`);
  }
  check((await page.getByRole("button", { name: P.retour, exact: true }).filter({ visible: true }).count()) === 1, `${ecran} : « ${P.retour} »`);
}

/** Photo, mots tapés, « Lancer » : le lancement reçoit « plafond atteint » ; aucun réessai automatique. */
async function photoPlafond(p: Parcours, page: Page, combo: Combo, fichier: string, period: SearchCapacityPeriod, ecran: string, problemes: string[]): Promise<void> {
  const suivi = suivreRequetes(page);
  await plafondAtteint(page, "**/api/searches/*/run", period, period === "day" ? FIN_DU_JOUR : REPRISE);
  await lancerPhoto(p, page, TEXTES[combo.locale], fichier, TEXTES[combo.locale].description);
  await controlerMessage(page, combo, period, ecran);
  await page.waitForTimeout(2000);
  check(suivi.lancements.length === 1, `${ecran} : un seul lancement, aucun réessai automatique (${suivi.lancements.length})`);
  await capteur(p, page, combo, problemes)(ecran);
  await page.unroute("**/api/searches/*/run");
}

/** Vidéo, mots, « Lancer », accord (premier usage) : l'analyse reçoit « plafond atteint » ; aucune identification. */
async function videoPlafond(p: Parcours, page: Page, combo: Combo, video: string, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const ecran = "03-video-plafond-jour";
  const suivi = suivreRequetes(page);
  await plafondAtteint(page, "**/api/video-moments", "day", FIN_DU_JOUR);
  await page.goto(`${p.siteUrl}/`);
  await visible(page, T.ajouterVideo).waitFor({ timeout: 30_000 });
  await lancerVideo(page, T, T.description, video, choisirFichier);
  await visible(page, T.accord).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: T.accepter, exact: true }).filter({ visible: true }).click();
  await controlerMessage(page, combo, "day", ecran);
  check((await visible(page, T.interrompue).count()) === 0, `${ecran} : pas « ${T.interrompue} »`);
  check(suivi.analyses === 1 && suivi.recherches === 0, `${ecran} : une analyse demandée, aucune identification (${suivi.analyses} / ${suivi.recherches})`);
  await capteur(p, page, combo, problemes)(ecran);
  await page.unroute("**/api/video-moments");
}

export async function run(p: Parcours): Promise<void> {
  const videos = await genererVideosEssai();
  const photoEssai = join(videos.dossier, "photo.jpg");
  writeFileSync(photoEssai, await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#26262A" } }).jpeg().toBuffer());
  const envois: Envoi[] = [];
  const problemes: string[] = [];
  try {
    for (const combo of [COMBOS[0]!, COMBOS[3]!]) {
      await p.step(`${combo.id} : photo (plafond du jour, puis des 31 jours), vidéo (plafond atteint avant l'IA)`, async () => {
        const compte = await nouveauCompte(p, `q${combo.id.replace("-", "")}`);
        const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
        await photoPlafond(p, page, combo, photoEssai, "day", "01-photo-plafond-jour", problemes);
        await photoPlafond(p, page, combo, photoEssai, "month", "02-photo-plafond-31-jours", problemes);
        await videoPlafond(p, page, combo, videos.courte, problemes);
        await page.context().close();
      });
    }
    check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
