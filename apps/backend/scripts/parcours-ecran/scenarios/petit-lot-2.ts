// Petit lot 2 (décision du fondateur, 2026-10-27), sur le site, dans les 4
// combinaisons (français/anglais, clair/sombre) :
// - photo : le champ facultatif « Quelle pièce ? (facultatif) », vide, son
//   exemple et la ligne qui dit à quoi servent les mots ; le conseil
//   « Plusieurs pièces… » dès que des mots sont tapés, tant que le cadre n'a
//   pas bougé ;
// - les mots partent vers le serveur de Spotto avec le lancement (champ
//   « query »), qui s'en sert pour trier ; « Triées selon vos mots » au-dessus
//   des résultats quand le serveur l'indique, rien sinon ;
// - « Recadrer » : aucun champ, et les mêmes mots trient la nouvelle recherche ;
// - aucune statistique ne contient les mots ;
// - vidéo avec l'IA : inchangée (« Que cherchez-vous ? » et sa ligne sur l'IA).
//
//   pnpm --filter backend parcours-ecran petit-lot-2
//
// Réponses de l'identification fabriquées DANS LE NAVIGATEUR : aucune requête
// ne part vers SerpApi (aucun crédit). Le tri lui-même est vérifié par les
// tests du serveur (wordSort, spotterFlow). IA d'Anthropic simulée dans le
// serveur local. Statistiques : clé PostHog FACTICE, envois interceptés.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import sharp from "sharp";
import type { Parcours } from "../boite-a-outils.js";
import { genererVideosEssai } from "../../lib/videos-essai.js";
import { COMBOS, type Combo } from "./lot-3.js";
import { check, choisirFichier, ouvrirSpotter, suivreRequetes, visible, type Envoi, type Suivi } from "./spotter-outils.js";
import { aucunChamp, cadrePhoto, capteur, champPhotoVide, champPret, nouveauCompte, simulerResultats, TEXTES, zoneEnvoyee, type Textes } from "./lot-4-ter-outils.js";

export const name = "Petit lot 2 — les mots d'une photo trient les propositions (site)";
export const outputDir = "petit-lot-2-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };
export const simulatedAi = true;

const RUN = "**/api/searches/*/run";

/** Le lancement (multipart) porte les mots dans le champ « query ». */
const avecMots = (lancement: string, mots: string): boolean => /name="query"/.test(lancement) && lancement.includes(mots);

const nbVisibles = (page: Page, texte: string): Promise<number> => visible(page, texte).count();

/** Depuis Spotter : photo choisie, écran « Entourez la pièce ». */
async function choisirPhoto(p: Parcours, page: Page, T: Textes, fichier: string): Promise<void> {
  await page.goto(`${p.siteUrl}/`);
  await choisirFichier(page, T.ajouterPhoto, fichier);
  await page.getByRole("heading", { name: T.ciblage, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
}

async function taperMots(page: Page, T: Textes): Promise<void> {
  await page.getByRole("textbox", { name: T.champPhoto, exact: true }).filter({ visible: true }).click();
  await page.keyboard.type(T.motsPhoto);
}

/** Coin en haut à gauche du cadre tiré vers l'intérieur (cadre remonté en haut de l'écran d'abord). */
async function ajusterCadre(page: Page, T: Textes): Promise<void> {
  await page.evaluate(`document.querySelector('[role="slider"][aria-label=${JSON.stringify(T.zone)}]')?.scrollIntoView({ block: "start" })`);
  const depart = await cadrePhoto(page, T);
  await page.mouse.move(depart.x + 2, depart.y + 2);
  await page.mouse.down();
  await page.mouse.move(depart.x + depart.width * 0.3, depart.y + depart.height * 0.25, { steps: 12 });
  await page.mouse.up();
  const tire = await cadrePhoto(page, T);
  check(tire.width < depart.width - 20, `photo : le coin tiré change la zone (largeur ${Math.round(depart.width)} → ${Math.round(tire.width)} px)`);
}

/** Photo choisie : le champ vide et sa ligne ; mots tapés : le conseil, jusqu'à ce que le cadre bouge. */
async function champEtConseil(p: Parcours, page: Page, combo: Combo, fichier: string, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const capture = capteur(p, page, combo, problemes);
  await choisirPhoto(p, page, T, fichier);
  check(await champPhotoVide(page, T), "photo : le seul champ est « Quelle pièce ? (facultatif) », vide, avec son exemple");
  check((await nbVisibles(page, T.champPhoto)) === 1, "photo : le titre du champ est affiché");
  check((await nbVisibles(page, T.motsTri)) === 1, "photo : la ligne qui dit à quoi servent les mots");
  check((await nbVisibles(page, T.conseilCadre)) === 0, "photo sans mots : pas de conseil");
  check((await nbVisibles(page, T.motsIA)) === 0, "photo : pas de ligne sur l'IA");
  check((await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).count()) === 0, "photo : pas de question « Que cherchez-vous ? »");
  await capture("01-photo-champ");

  await taperMots(page, T);
  await visible(page, T.conseilCadre).waitFor({ timeout: 10_000 });
  await capture("02-mots-conseil");

  await ajusterCadre(page, T);
  for (let essai = 0; essai < 30 && (await nbVisibles(page, T.conseilCadre)) > 0; essai += 1) await page.waitForTimeout(100);
  check((await nbVisibles(page, T.conseilCadre)) === 0, "cadre ajusté : le conseil disparaît");
  await capture("03-mots-cadre-ajuste");
}

/** Lancement avec les mots : ils partent vers le serveur de Spotto, avec l'image
 * et sa zone ; « Triées selon vos mots » au-dessus des résultats. */
async function resultatsTries(p: Parcours, page: Page, combo: Combo, suivi: Suivi, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  await simulerResultats(page, T.motsPhoto, { triees: true });
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
  await visible(page, T.meilleure).waitFor({ timeout: 30_000 });
  const lancement = suivi.lancements.at(-1) ?? "";
  check(avecMots(lancement, T.motsPhoto), "les mots partent avec le lancement, vers le serveur de Spotto (champ « query »)");
  const zone = zoneEnvoyee(lancement);
  check(zone !== null && zone.x > 0.2 && zone.width < 0.65, `la zone entourée part aussi (${JSON.stringify(zone)})`);
  const ligne = visible(page, T.triees);
  check((await ligne.count()) === 1, `« ${T.triees} » affiché`);
  const [boite, meilleure] = await Promise.all([ligne.boundingBox(), visible(page, T.meilleure).boundingBox()]);
  check(boite !== null && meilleure !== null && boite.y < meilleure.y, `« ${T.triees} » au-dessus de la meilleure proposition`);
  await capteur(p, page, combo, problemes)("04-resultats-tries");
}

/** « Recadrer » : aucun champ ; la nouvelle recherche est triée par les mêmes mots. */
async function recadrerMemesMots(p: Parcours, page: Page, combo: Combo, suivi: Suivi, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  await visible(page, T.pasLaBonne).click();
  await page.getByRole("button", { name: T.recadrer, exact: true }).filter({ visible: true }).last().click();
  await visible(page, T.ciblage).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  check(await aucunChamp(page), "« Recadrer » : aucun champ de mots");
  const avant = suivi.lancements.length;
  await page.getByRole("button", { name: T.identifier, exact: true }).filter({ visible: true }).click();
  for (let essai = 0; essai < 100 && suivi.lancements.length === avant; essai += 1) await page.waitForTimeout(100);
  await visible(page, T.meilleure).waitFor({ timeout: 30_000 });
  check(suivi.lancements.length === avant + 1, `« Recadrer » : une nouvelle recherche (${suivi.lancements.length - avant})`);
  check(avecMots(suivi.lancements.at(-1) ?? "", T.motsPhoto), "« Recadrer » : les mêmes mots trient la nouvelle recherche");
  check((await nbVisibles(page, T.triees)) === 1, `après « Recadrer » : « ${T.triees} »`);
  await capteur(p, page, combo, problemes)("05-recadrer-tries");
  await page.unroute(RUN);
}

/** Des mots qu'aucune proposition ne contient : l'ordre ne change pas, aucune ligne. */
async function motsSansCorrespondance(p: Parcours, page: Page, combo: Combo, fichier: string, suivi: Suivi, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  await simulerResultats(page, T.motsPhoto);
  await choisirPhoto(p, page, T, fichier);
  check(await champPhotoVide(page, T), "nouvelle photo : le champ repart vide");
  await taperMots(page, T);
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
  await visible(page, T.meilleure).waitFor({ timeout: 30_000 });
  check(avecMots(suivi.lancements.at(-1) ?? "", T.motsPhoto), "les mots partent avec le lancement");
  check((await nbVisibles(page, T.triees)) === 0, `rien ne correspond : pas de « ${T.triees} »`);
  await capteur(p, page, combo, problemes)("06-mots-sans-correspondance");
  await page.unroute(RUN);
}

/** Vidéo avec l'IA : inchangée, le champ « Que cherchez-vous ? » et sa ligne sur l'IA. */
async function videoInchangee(p: Parcours, page: Page, combo: Combo, video: string, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  await page.goto(`${p.siteUrl}/`);
  await choisirFichier(page, T.ajouterVideo, video);
  await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, T);
  check((await nbVisibles(page, T.motsIA)) === 1, "vidéo avec l'IA : la ligne sur l'IA");
  check((await page.getByRole("textbox").filter({ visible: true }).count()) === 1, "vidéo avec l'IA : un seul champ");
  for (const texte of [T.champPhoto, T.motsTri, T.conseilCadre]) check((await nbVisibles(page, texte)) === 0, `vidéo : pas de « ${texte} »`);
  await page.waitForTimeout(800); // aperçu de la vidéo
  await capteur(p, page, combo, problemes)("07-video-inchangee");
}

export async function run(p: Parcours): Promise<void> {
  const videos = await genererVideosEssai();
  const photoEssai = join(videos.dossier, "photo.jpg");
  writeFileSync(photoEssai, await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#26262A" } }).jpeg().toBuffer());
  const envois: Envoi[] = [];
  const problemes: string[] = [];
  try {
    for (const combo of COMBOS) {
      await p.step(`${combo.id} : champ et conseil, résultats triés, « Recadrer », mots sans correspondance, vidéo inchangée`, async () => {
        const compte = await nouveauCompte(p, `p2${combo.id.replace("-", "")}`);
        const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
        const suivi = suivreRequetes(page);
        await champEtConseil(p, page, combo, photoEssai, problemes);
        await resultatsTries(p, page, combo, suivi, problemes);
        await recadrerMemesMots(p, page, combo, suivi, problemes);
        await motsSansCorrespondance(p, page, combo, photoEssai, suivi, problemes);
        await videoInchangee(p, page, combo, videos.courte, problemes);
        check(suivi.analyses === 0, `aucune analyse par l'IA pour les photos (${suivi.analyses})`);
        await page.context().close();
      });
    }
    await p.step("Statistiques : jamais les mots", async () => {
      const mots = COMBOS.map((combo) => TEXTES[combo.locale].motsPhoto);
      check(envois.some((envoi) => envoi.event === "spot_launched"), "lancements comptés");
      check(envois.every((envoi) => !mots.some((m) => JSON.stringify(envoi.properties).includes(m))), "aucune statistique ne contient les mots tapés");
    });
    check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
