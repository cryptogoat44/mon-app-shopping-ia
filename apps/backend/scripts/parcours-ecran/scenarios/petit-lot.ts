// Petit lot (décisions du fondateur, 2026-10-21 et 2026-10-25), sur le site,
// dans les 4 combinaisons (français/anglais, clair/sombre) :
// - « Recadrer », vidéo sans l'IA : aucun champ de mots ; photo : le champ
//   facultatif du petit lot 2 (2026-10-27), laissé vide ici (scénario petit-lot-2) ;
// - vidéo avec l'IA : le champ reste, expliqué (« Ces mots aident l'IA… ») ;
//   les mots servent à l'IA, mais ne partent jamais avec l'image ;
// - propositions sans aucun prix : le message honnête, au-dessus d'elles ;
// - rien trouvé : le texte sans nom de fournisseur, plus de « Réessayer sans le texte » ;
// - Vault : la confirmation du retrait d'une pièce (en anglais, « piece », plus « item »).
//
//   pnpm --filter backend parcours-ecran petit-lot
//
// IA d'Anthropic SIMULÉE dans le serveur local ; SerpApi : clé invalide (aucun
// crédit). Les réponses de l'identification sont fabriquées DANS LE NAVIGATEUR :
// aucune requête ne part vers SerpApi. Statistiques : clé PostHog FACTICE,
// envois interceptés (rien ne sort).
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { genererVideosEssai } from "../../lib/videos-essai.js";
import { COMBOS, type Combo } from "./lot-3.js";
import { attendreEnvoi, check, choisirFichier, ouvrirSpotter, suivreRequetes, visible, type Envoi } from "./spotter-outils.js";
import { aucunChamp, capteur, champPhotoVide, champPret, lancerPhoto, nouveauCompte, ralentir, simulerResultats, TEXTES } from "./lot-4-ter-outils.js";

export const name = "Petit lot — les mots ne partent plus avec l'image ; message « aucun prix » (site)";
export const outputDir = "petit-lot-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };
export const simulatedAi = true;

const RUN = "**/api/searches/*/run";

/** Le corps du lancement (multipart) ne contient aucun champ « query ». */
const sansMots = (lancement: string): boolean => lancement.length > 0 && !/name="query"/.test(lancement);

/** Photo : le cadre et son champ facultatif, vide ; propositions sans prix ; « Recadrer » ; rien trouvé. */
async function photo(p: Parcours, page: Page, combo: Combo, fichier: string, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const capture = capteur(p, page, combo, problemes);
  const suivi = suivreRequetes(page);
  await page.goto(`${p.siteUrl}/`);
  await choisirFichier(page, T.ajouterPhoto, fichier);
  await page.getByRole("heading", { name: T.ciblage, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  // Petit lot 2 : le champ facultatif revient (mots qui trient, jamais envoyés à Google Lens).
  check(await champPhotoVide(page, T), "photo : le seul champ est « Quelle pièce ? (facultatif) », vide");
  check((await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).count()) === 0, "photo : plus de question « Que cherchez-vous ? »");
  await capture("01-photo");

  // Propositions sans aucun prix : le message, au-dessus d'elles, visible sans défilement.
  await simulerResultats(page, T.description, { sansPrix: true });
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
  await visible(page, T.aucunPrix).waitFor({ timeout: 30_000 });
  check((await visible(page, T.aucunPrixTexte).count()) === 1, "aucun prix : l'explication est affichée");
  check((await page.getByText(T.prixAVerifier, { exact: false }).filter({ visible: true }).count()) >= 1, `sous la proposition : « ${T.prixAVerifier} »`);
  check((await page.getByText(T.ancienPrixSurSite, { exact: false }).count()) === 0, `plus de « ${T.ancienPrixSurSite} »`);
  const [boite, meilleure] = await Promise.all([visible(page, T.aucunPrix).boundingBox(), visible(page, T.meilleure).boundingBox()]);
  const hauteur = page.viewportSize()?.height ?? 0;
  check(boite !== null && meilleure !== null && boite.y < meilleure.y && boite.y + boite.height <= hauteur, "aucun prix : au-dessus des propositions, visible sans défilement");
  check(sansMots(suivi.lancements.at(-1) ?? ""), "photo sans mots : aucun champ « query » envoyé");
  await capture("02-aucun-prix");

  // « Recadrer » : l'image seule.
  await visible(page, T.pasLaBonne).click();
  await page.getByRole("button", { name: T.recadrer, exact: true }).filter({ visible: true }).last().click();
  await visible(page, T.ciblage).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  check(await aucunChamp(page), "« Recadrer » : aucun champ de mots");
  await capture("03-recadrer-sans-champ");
  await page.unroute(RUN);

  // Rien trouvé : le texte sans nom de fournisseur, sans « Réessayer sans le texte ».
  await simulerResultats(page, T.description, { videsAuDebut: 1 });
  await lancerPhoto(p, page, T, fichier);
  await visible(page, T.rienTrouve).waitFor({ timeout: 30_000 });
  check((await page.getByText(T.sansTexte, { exact: true }).count()) === 0, "« Réessayer sans le texte » n'apparaît plus");
  check((await page.getByText("Google Lens", { exact: false }).count()) === 0, "aucun nom de fournisseur à l'écran");
  await capture("04-rien-trouve");
  await page.unroute(RUN);
}

/** Vidéo avec l'IA : le champ expliqué ; les mots s'affichent pendant l'analyse, jamais pendant l'identification. */
async function videoAvecIa(p: Parcours, page: Page, combo: Combo, video: string, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const capture = capteur(p, page, combo, problemes);
  const suivi = suivreRequetes(page);
  await page.goto(`${p.siteUrl}/`);
  await visible(page, T.ajouterVideo).waitFor({ timeout: 30_000 });
  await choisirFichier(page, T.ajouterVideo, video);
  await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, T);
  check((await visible(page, T.motsIA).count()) === 1, "vidéo avec l'IA : la ligne qui explique les mots");
  await page.waitForTimeout(800); // aperçu de la vidéo
  await capture("05-video-champ-explique");
  await page.keyboard.type(T.description);
  await simulerResultats(page, T.description);
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
  await visible(page, T.accord).waitFor({ timeout: 15_000 });
  await ralentir(page, "**/api/video-moments");
  await page.getByRole("button", { name: T.accepter, exact: true }).filter({ visible: true }).click();
  await visible(page, T.attenteVideo).waitFor({ timeout: 15_000 });
  await visible(page, T.attenteBoutiques).waitFor({ timeout: 30_000 });
  check((await page.getByText(T.description, { exact: false }).filter({ visible: true }).count()) === 0, "attente des boutiques : les mots ne sont plus affichés");
  await capture("06-attente-boutiques-sans-mots", "nuit");
  await visible(page, T.meilleure).waitFor({ timeout: 30_000 });
  check(suivi.analyses === 1, `les mots ont servi à l'IA (${suivi.analyses} analyse)`);
  check(suivi.lancements.length === 1 && sansMots(suivi.lancements[0] ?? ""), "vidéo : aucun mot envoyé avec l'image");
  check((await page.getByText(T.description, { exact: false }).filter({ visible: true }).count()) === 0, "résultats : le nombre de propositions sans les mots");
  await capture("07-video-resultats");
  await page.unroute(RUN);
  await page.unroute("**/api/video-moments");
}

/** Vidéo sans l'IA (accord retiré dans Réglages) : titre « Votre vidéo », aucun champ. */
async function videoSansIa(p: Parcours, page: Page, combo: Combo, video: string, envois: Envoi[], problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  await page.goto(`${p.siteUrl}/settings`);
  const interrupteur = page.getByLabel(T.interrupteur, { exact: true });
  await interrupteur.waitFor({ timeout: 30_000 });
  // Page rechargée : les statistiques ne partent qu'une fois l'accord « statistiques » relu.
  await page.waitForLoadState("networkidle").catch(() => {});
  await interrupteur.click();
  await page.getByText(T.retire, { exact: false }).waitFor({ timeout: 15_000 });
  await attendreEnvoi(page, envois, "video_ai_consent", { decision: "withdrawn", context: "settings" });
  await page.goto(`${p.siteUrl}/`);
  await choisirFichier(page, T.ajouterVideo, video);
  await page.getByRole("heading", { name: T.votreVideo, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await visible(page, T.desactivee).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: T.choisirImage, exact: true }).filter({ visible: true }).waitFor();
  check(await aucunChamp(page), "vidéo sans l'IA : aucun champ de mots");
  check((await visible(page, T.motsIA).count()) === 0, "vidéo sans l'IA : pas de ligne sur les mots");
  await page.waitForTimeout(800); // aperçu de la vidéo
  await capteur(p, page, combo, problemes)("08-video-sans-ia");
}

const VAULT = {
  fr: { titre: "Veste en daim", retirer: "Retirer du vault", confirmation: "Retirer définitivement cette pièce ?", annuler: "Annuler" },
  en: { titre: "Suede jacket", retirer: "Remove from the Vault", confirmation: "Remove this piece permanently?", annuler: "Cancel" },
} as const;

/** Vault : la confirmation du retrait d'une pièce, affichée sans rien retirer. */
async function vaultRetrait(p: Parcours, page: Page, combo: Combo, compte: TestAccount, image: Buffer, problemes: string[]): Promise<void> {
  const V = VAULT[combo.locale];
  const form = new FormData();
  form.append("title", V.titre);
  form.append("category", "clothing");
  form.append("file", new Blob([image], { type: "image/jpeg" }), "veste.jpg");
  const ajout = await p.api(compte, "POST", "/api/vault", form);
  check(ajout.ok, `pièce ajoutée au Vault (${ajout.status})`);
  const { id } = z.object({ id: z.string() }).parse(await ajout.json());
  await page.goto(`${p.siteUrl}/vault-item/${id}`);
  await page.getByRole("button", { name: V.retirer, exact: true }).filter({ visible: true }).click();
  await visible(page, V.confirmation).waitFor({ timeout: 15_000 });
  check((await page.getByText("item", { exact: false }).filter({ visible: true }).count()) === 0, "Vault : plus aucun « item » à l'écran");
  // La confirmation est en bas de la page : on y descend pour la photographier.
  await page.getByRole("button", { name: V.annuler, exact: true }).filter({ visible: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await capteur(p, page, combo, problemes)("09-vault-retrait");
}

export async function run(p: Parcours): Promise<void> {
  const videos = await genererVideosEssai();
  const photoEssai = join(videos.dossier, "photo.jpg");
  writeFileSync(photoEssai, await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#26262A" } }).jpeg().toBuffer());
  const imageVault = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#8A5A3C" } }).jpeg().toBuffer();
  const envois: Envoi[] = [];
  const problemes: string[] = [];
  try {
    for (const combo of COMBOS) {
      await p.step(`${combo.id} : photo (champ vide), aucun prix, « Recadrer », rien trouvé ; vidéo avec l'IA ; vidéo sans l'IA ; retrait du Vault`, async () => {
        const compte = await nouveauCompte(p, `pl${combo.id.replace("-", "")}`);
        const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
        await photo(p, page, combo, photoEssai, problemes);
        await videoAvecIa(p, page, combo, videos.courte, problemes);
        await videoSansIa(p, page, combo, videos.courte, envois, problemes);
        await vaultRetrait(p, page, combo, compte, imageVault, problemes);
        await page.context().close();
      });
    }
    await p.step("Statistiques : « spot_launched » sans aucune propriété sur le texte", async () => {
      const lancements = envois.filter((envoi) => envoi.event === "spot_launched");
      check(lancements.length >= COMBOS.length * 3, `lancements comptés (${lancements.length})`);
      check(lancements.every((envoi) => !("query_added" in envoi.properties)), "plus aucune propriété « query_added »");
    });
    check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
