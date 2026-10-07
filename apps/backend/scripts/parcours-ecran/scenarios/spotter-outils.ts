// Outils communs des parcours du Spotter (lots 4 et 4 ter) : téléphone
// connecté avec statistiques interceptées, choix d'un fichier, contrôle de
// l'affichage (langue, thème), couleur de l'image locale, requêtes suivies.
import type { Page } from "playwright-core";
import { z } from "zod";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { BACKGROUND, ENGLISH, FRENCH, LANGUAGE_NAMES, screenText, type Combo } from "./lot-3.js";

const ENVOI = z.object({ event: z.string().optional(), properties: z.record(z.unknown()).optional() });
const COULEUR = z.array(z.number()).length(3).nullable();

export type Envoi = { event: string; properties: Record<string, unknown> };

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

/** Téléphone connecté, sur le Spotter (attend `texteAccueil`), statistiques interceptées. */
export async function ouvrirSpotter(p: Parcours, compte: TestAccount, combo: Combo, envois: Envoi[], texteAccueil: string): Promise<Page> {
  const page = await p.newPhone({ locale: combo.browserLocale, colorScheme: combo.deviceScheme });
  await page.route("https://eu.i.posthog.com/**", async (route) => {
    const body = ENVOI.parse(JSON.parse(route.request().postData() ?? "{}"));
    envois.push({ event: body.event ?? "?", properties: body.properties ?? {} });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${p.siteUrl}/bienvenue`);
  if (combo.preference) await page.evaluate(`localStorage.setItem("spotto.apparence", "${combo.preference}")`);
  await compte.signIn(page);
  await page.getByText(texteAccueil, { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {}); // consentement « statistiques » lu
  return page;
}

/** Attend qu'un événement de statistiques soit parti (le navigateur les envoie
 * par lots, avec un léger délai) : sinon, changer de page pourrait le perdre. */
export async function attendreEnvoi(page: Page, envois: Envoi[], event: string, proprietes: Record<string, unknown>): Promise<void> {
  const trouve = () => envois.some((e) => e.event === event && Object.entries(proprietes).every(([cle, valeur]) => e.properties[cle] === valeur));
  for (let essai = 0; essai < 100 && !trouve(); essai += 1) await page.waitForTimeout(100);
  check(trouve(), `statistique « ${event} » envoyée`);
}

/** Texte exact VISIBLE : les écrans précédents restent dans la page, cachés
 * (pile de navigation du site), avec parfois les mêmes textes. */
export function visible(page: Page, texte: string) {
  return page.getByText(texte, { exact: true }).filter({ visible: true });
}

/** Touche le bouton `texte` et choisit `fichier` dans la fenêtre du système. */
export async function choisirFichier(page: Page, texte: string, fichier: string): Promise<void> {
  const [selecteur] = await Promise.all([page.waitForEvent("filechooser"), page.getByText(texte, { exact: true }).first().click()]);
  await selecteur.setFiles(fichier);
}

export async function attendreBoutonActif(page: Page, texte: string): Promise<void> {
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="button"]')].some((el) => (el.textContent || "").includes(${JSON.stringify(texte)}) && el.getAttribute("aria-disabled") !== "true")`,
    undefined,
    { timeout: 30_000 }
  );
}

/** Un champ de saisie contient exactement `valeur`. */
export async function champContient(page: Page, valeur: string): Promise<boolean> {
  return z.boolean().parse(await page.evaluate(`[...document.querySelectorAll("input, textarea")].some((el) => el.value === ${JSON.stringify(valeur)})`));
}

/** Textes de la bonne langue, fond du bon thème, langue de la page (comme au lot 3). */
export async function controlerAffichage(page: Page, combo: Combo, ecran: string, problemes: string[], fond: "theme" | "nuit" = "theme"): Promise<void> {
  let texte = await screenText(page);
  for (const valeur of LANGUAGE_NAMES) texte = texte.split(valeur).join(" ");
  const fuite = (combo.locale === "en" ? FRENCH : ENGLISH).exec(texte);
  if (fuite) problemes.push(`${combo.id}/${ecran} : « ${fuite[0]} » dans « …${texte.slice(Math.max(0, fuite.index - 40), fuite.index + 40).replace(/\s+/g, " ")}… »`);
  if (fond === "theme") {
    const couleur = z.string().parse(await page.evaluate("getComputedStyle(document.body).backgroundColor"));
    if (couleur !== BACKGROUND[combo.expected]) problemes.push(`${combo.id}/${ecran} : fond ${couleur}, attendu ${BACKGROUND[combo.expected]}`);
  }
  if ((await page.evaluate("document.documentElement.lang")) !== combo.locale) problemes.push(`${combo.id}/${ecran} : langue de la page`);
}

/** Couleur moyenne d'une zone sans texte de la plus grande image locale (« blob: »). */
export async function couleurImageLocale(page: Page): Promise<number[] | null> {
  return COULEUR.parse(await page.evaluate(`(async () => {
    const images = [...document.querySelectorAll("img")].filter((img) => img.src.startsWith("blob:"));
    const img = images.sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
    if (!img) return null;
    await img.decode().catch(() => undefined);
    const canvas = document.createElement("canvas");
    canvas.width = 40; canvas.height = 40;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, img.naturalWidth * 0.1, img.naturalHeight * 0.1, img.naturalWidth * 0.3, img.naturalHeight * 0.2, 0, 0, 40, 40);
    const data = ctx.getImageData(0, 0, 40, 40).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
    return sum.map((v) => Math.round(v / (data.length / 4)));
  })()`));
}

export interface Suivi {
  /** Envois d'images à l'analyse automatique, vus par le navigateur. */
  analyses: number;
  /** Préparations et identifications : les seules requêtes qui peuvent dépenser du SerpApi. */
  recherches: number;
  /** Corps des identifications lancées (zone, mots), pour contrôle. */
  lancements: string[];
}

export function suivreRequetes(page: Page): Suivi {
  const suivi: Suivi = { analyses: 0, recherches: 0, lancements: [] };
  page.on("request", (requete) => {
    if (requete.method() !== "POST") return;
    if (requete.url().endsWith("/api/video-moments")) suivi.analyses += 1;
    if (requete.url().includes("/api/searches")) suivi.recherches += 1;
    if (/\/api\/searches\/[^/]+\/run$/.test(requete.url())) suivi.lancements.push(requete.postDataBuffer()?.toString("latin1") ?? "");
  });
  return suivi;
}
