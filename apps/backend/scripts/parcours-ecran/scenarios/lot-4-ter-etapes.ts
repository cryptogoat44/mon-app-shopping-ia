// Lot 4 ter — étapes du parcours unique vérifiées une fois (site, fr-clair
// sauf mention) : corrections, identification réelle (sans crédit), replis,
// liens, photo, bannière de nouvelle version, refus et retrait de l'accord,
// limites de la vidéo.
import { closeSync, ftruncateSync, openSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { z } from "zod";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { couleurProche } from "../../lib/videos-essai.js";
import { COMBOS, type Combo } from "./lot-3.js";
import { attendreBoutonActif, attendreEnvoi, champContient, check, choisirFichier, couleurImageLocale, ouvrirSpotter, suivreRequetes, visible, type Envoi } from "./spotter-outils.js";
import { CHAUSSURES, capteur, champPret, lancerVideo, nouveauCompte, ralentir, TEXTES, VESTE } from "./lot-4-ter-outils.js";

const FR = TEXTES.fr;
const COMBO = COMBOS[0]!;
const RECHERCHE = z.object({ source_platform: z.string(), status: z.string() });
const CONSENT = z.object({ granted_at: z.string().nullable(), revoked_at: z.string().nullable(), document_version: z.string().nullable() });

async function dernierConsentement(p: Parcours, compte: TestAccount): Promise<z.infer<typeof CONSENT>> {
  const { data, error } = await p.admin
    .from("consents")
    .select("granted_at, revoked_at, document_version")
    .eq("user_id", compte.id)
    .eq("type", "analyse_video_ia")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  check(!error, `accord lu (${error?.message ?? ""})`);
  return CONSENT.parse(data);
}

/** Retour à Spotter, puis vidéo + mots + « Lancer ». */
async function depuisSpotter(p: Parcours, page: Page, mots: string, video: string): Promise<void> {
  await page.goto(`${p.siteUrl}/`);
  await visible(page, FR.ajouterVideo).waitFor({ timeout: 30_000 });
  await lancerVideo(page, FR, mots, video, choisirFichier);
}

/** Moment affiché par le curseur, en dixièmes de seconde (« 0:09,5 / 0:12 » → 95). */
async function horloge(page: Page, motif: string): Promise<number> {
  await page.waitForFunction(`/${motif}[,.]\\d \\/ 0:12/.test(document.body.innerText)`, undefined, { timeout: 15_000 });
  const trouve = /0:(\d\d)[,.](\d) \/ 0:12/.exec(z.string().parse(await page.evaluate("document.body.innerText")));
  check(trouve !== null, "horloge du curseur lisible");
  return Number(trouve[1]) * 10 + Number(trouve[2]);
}

/** Sous les résultats : autre moment, curseur (parti du moment essayé), recadrage (image et mots). */
export async function corrections(p: Parcours, page: Page, combo: Combo, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const capture = capteur(p, page, combo, problemes);
  await visible(page, T.pasLaBonne).click();
  await visible(page, T.essayerDeux).click();
  await visible(page, T.attenteBoutiques).waitFor({ timeout: 15_000 });
  await visible(page, T.meilleure).waitFor({ timeout: 30_000 });
  await capture("10-autre-moment");
  await visible(page, T.pasLaBonne).click();
  await visible(page, T.essayerUn).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: T.moiMeme, exact: true }).filter({ visible: true }).last().click();
  await page.getByRole("heading", { name: T.curseur, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  // 2e moment essayé : plan « Chaussures » (8 à 12 s) ; le curseur en repart.
  const moment = await horloge(page, "0:(0[89]|1[01])");
  check(moment >= 80, `curseur reparti du moment essayé (${moment / 10} s)`);
  await capture("11-curseur-correction");
  await page.goBack();
  await visible(page, T.meilleure).waitFor({ timeout: 15_000 });
  await visible(page, T.pasLaBonne).click();
  await page.getByRole("button", { name: T.recadrer, exact: true }).filter({ visible: true }).last().click();
  await visible(page, T.ciblage).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const couleur = await couleurImageLocale(page);
  check(couleur !== null && couleurProche(couleur, CHAUSSURES, 25), `image recadrée = moment essayé, « Chaussures » (couleur ${JSON.stringify(couleur)})`);
  check(await champContient(page, T.description), "les mots tapés suivent jusqu'au recadrage");
  await capture("12-recadrer");
}

/** Identification réelle par le serveur local (clé SerpApi invalide : aucun crédit) : échec annoncé comme tel. */
export async function identificationReelle(p: Parcours, page: Page, compte: TestAccount, video: string, problemes: string[]): Promise<void> {
  await depuisSpotter(p, page, FR.description, video);
  await visible(page, FR.echec).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: FR.reessayer, exact: true }).filter({ visible: true }).waitFor();
  await page.getByRole("button", { name: FR.moiMeme, exact: true }).filter({ visible: true }).waitFor();
  await capteur(p, page, COMBO, problemes)("13-echec-identification");
  const { data, error } = await p.admin.from("product_searches").select("source_platform, status").eq("user_id", compte.id).order("created_at", { ascending: false }).limit(1).single();
  check(!error, `recherche lue (${error?.message ?? ""})`);
  const recherche = RECHERCHE.parse(data);
  check(recherche.source_platform === "photo" && recherche.status === "failed", `image identifiée comme une photo (${JSON.stringify(recherche)})`);
}

/** Pièce non repérée (liste vide, puis moments sous le seuil) : message clair, choix manuel, aucun crédit ; puis panne. */
export async function replis(p: Parcours, page: Page, video: string, problemes: string[]): Promise<void> {
  const capture = capteur(p, page, COMBO, problemes);
  await page.goto(`${p.siteUrl}/`);
  const suivi = suivreRequetes(page);
  await depuisSpotter(p, page, "rien de précis", video);
  await visible(page, FR.nonReperee).waitFor({ timeout: 60_000 });
  await capture("14-non-reperee");
  const lignesAvant = p.simulation.length;
  await page.getByRole("button", { name: FR.modifier, exact: true }).filter({ visible: true }).click();
  await champPret(page, FR);
  check(await champContient(page, "rien de précis"), "les mots restent pour être modifiés");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("veste incertaine");
  await page.getByRole("button", { name: FR.lancer, exact: true }).filter({ visible: true }).click();
  await visible(page, FR.nonReperee).waitFor({ timeout: 60_000 });
  const ligne = p.simulation.slice(lignesAvant).at(-1) ?? "";
  check(/3 moment\(s\).*confiance 0\.3/.test(ligne), `moments sous le seuil proposés par l'IA simulée (${ligne})`);
  await page.getByRole("button", { name: FR.moiMeme, exact: true }).filter({ visible: true }).click();
  await page.getByRole("heading", { name: FR.curseur, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await attendreBoutonActif(page, FR.utiliser);
  await capture("15-curseur-repli");
  const frise = await page.getByLabel("Moment de la vidéo", { exact: true }).boundingBox();
  check(frise !== null, "frise visible");
  await page.mouse.click(frise.x + frise.width * 0.5, frise.y + frise.height / 2);
  await horloge(page, "0:0[4-7]");
  await visible(page, FR.utiliser).click();
  await visible(page, FR.ciblage).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const couleur = await couleurImageLocale(page);
  check(couleur !== null && couleurProche(couleur, VESTE, 20), `image choisie = « Veste » (couleur ${JSON.stringify(couleur)})`);
  check(await champContient(page, "veste incertaine"), "les mots suivent jusqu'au recadrage");
  await capture("16-ciblage-mots");
  check(suivi.analyses === 2, `deux analyses envoyées (${suivi.analyses})`);
  check(suivi.recherches === 0, `pièce non repérée : aucune recherche lancée, aucun crédit (${suivi.recherches})`);
  await depuisSpotter(p, page, "panne simulée", video);
  await visible(page, FR.interrompue).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: FR.reessayer, exact: true }).filter({ visible: true }).waitFor();
  await page.getByRole("button", { name: FR.moiMeme, exact: true }).filter({ visible: true }).waitFor();
  await capture("17-panne");
}

/** Lien : aide discrète sur Spotter ; lien collé dans le champ → explication, « Lancer » inactif. */
export async function liens(p: Parcours, page: Page, video: string, problemes: string[]): Promise<void> {
  const capture = capteur(p, page, COMBO, problemes);
  await page.goto(`${p.siteUrl}/`);
  await visible(page, FR.lienQuestion).click();
  await visible(page, FR.lienTitre).waitFor({ timeout: 10_000 });
  await capture("18-aide-lien");
  await choisirFichier(page, FR.ajouterVideo, video);
  await page.getByRole("heading", { name: FR.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, FR);
  await page.keyboard.type("https://vm.tiktok.com/ZMabc123/");
  await visible(page, FR.lienTitre).waitFor({ timeout: 10_000 });
  const lancer = page.getByRole("button", { name: FR.lancer, exact: true }).filter({ visible: true });
  check((await lancer.getAttribute("aria-disabled")) === "true", "« Lancer » inactif avec un lien dans la description");
  await capture("19-lien-colle");
}

/** Photo : même parcours, sans IA ni accord ; zone centrale et mots envoyés à l'identification. */
export async function photo(p: Parcours, page: Page, fichier: string, problemes: string[]): Promise<void> {
  const capture = capteur(p, page, COMBO, problemes);
  await page.goto(`${p.siteUrl}/`);
  const suivi = suivreRequetes(page);
  await choisirFichier(page, FR.ajouterPhoto, fichier);
  await page.getByRole("heading", { name: FR.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, FR);
  check(suivi.recherches === 0, "le choix d'une photo n'appelle pas le serveur");
  await capture("20-photo-question");
  await page.keyboard.type("t-shirt noir");
  await ralentir(page, "**/api/searches/*/run");
  await page.getByRole("button", { name: FR.lancer, exact: true }).filter({ visible: true }).click();
  await visible(page, FR.attenteBoutiques).waitFor({ timeout: 15_000 });
  await capture("21-photo-attente", "nuit");
  await visible(page, FR.echec).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: FR.reessayer, exact: true }).filter({ visible: true }).waitFor();
  await page.getByRole("button", { name: FR.recadrer, exact: true }).filter({ visible: true }).waitFor();
  await capture("22-photo-echec");
  await page.unroute("**/api/searches/*/run");
  check(suivi.analyses === 0, "photo : aucune analyse par l'IA");
  const lancement = suivi.lancements.at(-1) ?? "";
  check(lancement.includes('{"x":0.15,"y":0.15,"width":0.7,"height":0.7}') && lancement.includes("t-shirt noir"), "photo : zone centrale et mots envoyés");
}

/** Site : un onglet resté ouvert apprend qu'une nouvelle version est en ligne (page en ligne simulée). */
export async function nouvelleVersion(p: Parcours, page: Page, problemes: string[]): Promise<void> {
  await page.goto(`${p.siteUrl}/`);
  await visible(page, FR.ajouterVideo).waitFor({ timeout: 30_000 });
  const enLigne = (url: URL) => url.pathname === "/" && url.searchParams.has("version");
  await page.route(enLigne, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: '<html><head><script src="/_expo/static/js/web/entry-0000000000000000000000000000beef.js" defer></script></head></html>' })
  );
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await visible(page, FR.nouvelleVersion).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: FR.recharger, exact: true }).filter({ visible: true }).waitFor();
  await capteur(p, page, COMBO, problemes)("23-nouvelle-version");
  await page.unroute(enLigne);
}

/** Retrait dans Réglages : plus d'analyse, le choix manuel est annoncé. Refus au premier usage (autre compte) : curseur, rien n'est envoyé. */
export async function refusEtRetrait(p: Parcours, page: Page, envois: Envoi[], video: string, problemes: string[]): Promise<void> {
  const capture = capteur(p, page, COMBO, problemes);
  await page.goto(`${p.siteUrl}/settings`);
  const interrupteur = page.getByLabel(FR.interrupteur, { exact: true });
  await interrupteur.waitFor({ timeout: 30_000 });
  // Page rechargée : les statistiques ne partent qu'une fois l'accord « statistiques » relu.
  await page.waitForLoadState("networkidle").catch(() => {});
  await interrupteur.click();
  await page.getByText(FR.retire, { exact: false }).waitFor({ timeout: 15_000 });
  await attendreEnvoi(page, envois, "video_ai_consent", { decision: "withdrawn", context: "settings" });
  await capture("24-reglages-retrait");
  await page.goto(`${p.siteUrl}/`);
  await choisirFichier(page, FR.ajouterVideo, video);
  await page.getByRole("heading", { name: FR.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await visible(page, FR.desactivee).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: FR.choisirImage, exact: true }).filter({ visible: true }).waitFor();
  await capture("25-retrait-question");

  const refus = await nouveauCompte(p, "trefus");
  const autre = await ouvrirSpotter(p, refus, COMBO, envois, FR.ajouterVideo);
  const suivi = suivreRequetes(autre);
  await lancerVideo(autre, FR, FR.description, video, choisirFichier);
  await visible(autre, FR.accord).waitFor({ timeout: 15_000 });
  await autre.getByRole("button", { name: FR.moiMeme, exact: true }).filter({ visible: true }).click();
  await autre.getByRole("heading", { name: FR.curseur, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await capteur(p, autre, COMBO, problemes)("26-refus-curseur");
  await attendreEnvoi(autre, envois, "video_ai_consent", { decision: "declined", context: "first_use" });
  check(suivi.analyses === 0, "refus : aucune image envoyée");
  const choix = await dernierConsentement(p, refus);
  check(choix.granted_at === null && choix.document_version === CONSENT_VERSIONS.analyse_video_ia, "refus enregistré, versionné");
  await autre.goBack();
  await visible(autre, FR.desactivee).waitFor({ timeout: 15_000 });
  check((await visible(autre, FR.accord).count()) === 0, "après un refus, l'accord n'est pas redemandé");
  await autre.context().close();
}

/** Vidéo trop longue, trop lourde, illisible : message clair sur Spotter. */
export async function limites(p: Parcours, page: Page, combo: Combo, videos: { dossier: string; longue: string }, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const grande = join(videos.dossier, "grande.mp4");
  const fd = openSync(grande, "w");
  ftruncateSync(fd, 101_000_000); // 101 Mo sans rien écrire : seule la taille compte
  closeSync(fd);
  const abimee = join(videos.dossier, "abimee.mp4");
  writeFileSync(abimee, randomBytes(200_000));
  for (const [fichier, texte, nom] of [
    [videos.longue, T.tropLongue, "27-trop-longue"],
    [grande, T.tropLourde, "28-trop-lourde"],
    [abimee, T.illisible, "29-illisible"],
  ] as const) {
    await page.goto(`${p.siteUrl}/`);
    await visible(page, T.ajouterVideo).waitFor({ timeout: 30_000 });
    await choisirFichier(page, T.ajouterVideo, fichier);
    await page.getByText(texte, { exact: false }).waitFor({ timeout: 30_000 });
    await capteur(p, page, combo, problemes)(nom);
  }
}
