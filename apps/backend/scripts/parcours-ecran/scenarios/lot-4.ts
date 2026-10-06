// Lot 4 — vidéo importée dans le Spotter (site), dans les 4 combinaisons.
//
//   pnpm --filter backend parcours-ecran lot-4
//
// Vidéos d'essai fabriquées sur place (scripts/lib/videos-essai.ts) : 12 s
// où « Sac », « Veste » puis « Chaussures » se succèdent toutes les 4 s.
// Dans chaque combinaison (français/anglais, clair/sombre) : bouton
// « Importer une vidéo », choix du moment (6 s : « Veste »), image arrivée
// au ciblage (couleur contrôlée), refus d'une vidéo trop longue ; textes et
// fond contrôlés comme au lot 3. Une fois : identification lancée (clé
// SerpApi invalide : aucun crédit), vidéo trop lourde, illisible, HEVC
// (résultat noté). Statistiques interceptées : rien ne sort.
import { closeSync, ftruncateSync, openSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { z } from "zod";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { couleurProche, genererVideosEssai, rgb, SEGMENTS } from "../../lib/videos-essai.js";
import { BACKGROUND, COMBOS, ENGLISH, FRENCH, LANGUAGE_NAMES, screenText, type Combo, type Locale } from "./lot-3.js";

export const name = "Lot 4 — vidéo importée dans le Spotter (site)";
export const outputDir = "lot-4-captures";
// Clé PostHog FACTICE : les envois sont interceptés, rien ne sort.
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

type Cle = "importer" | "titre" | "curseur" | "avancer" | "reculer" | "utiliser" | "ciblage" | "lancer" | "echec" | "tropLongue" | "tropLourde" | "illisible";
export const TEXTES: Record<Locale, Record<Cle, string>> = {
  fr: {
    importer: "Importer une vidéo",
    titre: "Choisissez l'image",
    curseur: "Moment de la vidéo",
    avancer: "Avancer d'un dixième de seconde",
    reculer: "Reculer d'un dixième de seconde",
    utiliser: "Utiliser cette image",
    ciblage: "Entourez la pièce",
    lancer: "Lancer l'identification",
    echec: "La recherche n'a pas abouti",
    tropLongue: "Cette vidéo dure 1:05",
    tropLourde: "Cette vidéo pèse 101 Mo",
    illisible: "Ce navigateur ne sait pas lire cette vidéo",
  },
  en: {
    importer: "Import a video",
    titre: "Choose the frame",
    curseur: "Moment in the video",
    avancer: "Forward a tenth of a second",
    reculer: "Back a tenth of a second",
    utiliser: "Use this frame",
    ciblage: "Frame the piece",
    lancer: "Identify the piece",
    echec: "The search didn't go through",
    tropLongue: "This video lasts 1:05",
    tropLourde: "This video is 101 MB",
    illisible: "This browser cannot read this video",
  },
};
/** Fond de « Veste » (de 4 à 8 s dans la vidéo d'essai). */
const VESTE = rgb(SEGMENTS[1].fond);
const ENVOI = z.object({ event: z.string().optional(), properties: z.record(z.unknown()).optional() });
const COULEUR = z.array(z.number()).length(3).nullable();
const RECHERCHE = z.object({ source_platform: z.string(), status: z.string() });

export type Envoi = { event: string; properties: Record<string, unknown> };
type Fichiers = { courte: string; longue: string; hevc: string; grande: string; abimee: string };

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

/** Téléphone connecté, sur le Spotter, statistiques interceptées. */
export async function ouvrirSpotter(p: Parcours, compte: TestAccount, combo: Combo, envois: Envoi[]): Promise<Page> {
  const page = await p.newPhone({ locale: combo.browserLocale, colorScheme: combo.deviceScheme });
  await page.route("https://eu.i.posthog.com/**", async (route) => {
    const body = ENVOI.parse(JSON.parse(route.request().postData() ?? "{}"));
    envois.push({ event: body.event ?? "?", properties: body.properties ?? {} });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${p.siteUrl}/bienvenue`);
  if (combo.preference) await page.evaluate(`localStorage.setItem("spotto.apparence", "${combo.preference}")`);
  await compte.signIn(page);
  await page.getByText(TEXTES[combo.locale].importer).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {}); // consentement « statistiques » lu
  return page;
}

export async function choisirVideo(page: Page, combo: Combo, fichier: string): Promise<void> {
  const [selecteur] = await Promise.all([page.waitForEvent("filechooser"), page.getByText(TEXTES[combo.locale].importer).click()]);
  await selecteur.setFiles(fichier);
}

export async function attendreBoutonActif(page: Page, texte: string): Promise<void> {
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="button"]')].some((el) => (el.textContent || "").includes(${JSON.stringify(texte)}) && el.getAttribute("aria-disabled") !== "true")`,
    undefined,
    { timeout: 30_000 }
  );
}

/** Couleur moyenne d'une zone sans texte de l'image du brouillon (adresse locale « blob: »). */
async function couleurImageChoisie(page: Page): Promise<number[] | null> {
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

/** Textes de la bonne langue, fond du bon thème, langue de la page (comme au lot 3). */
export async function controlerAffichage(page: Page, combo: Combo, ecran: string, problemes: string[]): Promise<void> {
  let texte = await screenText(page);
  for (const valeur of LANGUAGE_NAMES) texte = texte.split(valeur).join(" ");
  const fuite = (combo.locale === "en" ? FRENCH : ENGLISH).exec(texte);
  if (fuite) problemes.push(`${combo.id}/${ecran} : « ${fuite[0]} » dans « …${texte.slice(Math.max(0, fuite.index - 40), fuite.index + 40).replace(/\s+/g, " ")}… »`);
  const fond = z.string().parse(await page.evaluate("getComputedStyle(document.body).backgroundColor"));
  if (fond !== BACKGROUND[combo.expected]) problemes.push(`${combo.id}/${ecran} : fond ${fond}, attendu ${BACKGROUND[combo.expected]}`);
  if ((await page.evaluate("document.documentElement.lang")) !== combo.locale) problemes.push(`${combo.id}/${ecran} : langue de la page`);
}

/** Horloge du curseur en dixièmes : « 0:06,2 / 0:12 » (français), « 0:06.2 / 0:12 » (anglais). */
function horloge(dixiemes: number, locale: Locale): string {
  const secondes = Math.floor(dixiemes / 10);
  return `0:${String(secondes).padStart(2, "0")}${locale === "fr" ? "," : "."}${dixiemes % 10} / 0:12`;
}

/** Moment affiché par le curseur, en dixièmes de seconde, une fois dans le
 * plan « Veste » (4 à 8 s) — l'horloge affiche d'abord « 0:00,0 ». */
async function lireHorloge(page: Page): Promise<number> {
  await page.waitForFunction(`/0:0[4-7][,.]\\d \\/ 0:12/.test(document.body.innerText)`, undefined, { timeout: 10_000 });
  const texte = z.string().parse(await page.evaluate("document.body.innerText"));
  const trouve = /0:(\d\d)[,.](\d) \/ 0:12/.exec(texte);
  check(trouve !== null, "horloge du curseur lisible");
  return Number(trouve[1]) * 10 + Number(trouve[2]);
}

/** Vidéo de 12 s → moment 6 s (« Veste ») → image au ciblage. */
async function parcoursVideo(p: Parcours, page: Page, combo: Combo, fichiers: Fichiers, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  const capture = async (nom: string) => {
    await p.capture(page, `${combo.id}-${nom}`);
    await controlerAffichage(page, combo, nom, problemes);
  };
  await capture("01-spotter");
  await choisirVideo(page, combo, fichiers.courte);
  await page.getByText(T.titre).waitFor({ timeout: 30_000 });
  await attendreBoutonActif(page, T.utiliser);
  await capture("02-choix-image");
  const frise = page.getByLabel(T.curseur, { exact: true });
  const zone = await frise.boundingBox();
  check(zone !== null, "frise visible");
  await page.mouse.move(zone.x + zone.width * 0.5, zone.y + zone.height / 2);
  await page.mouse.down();
  await page.mouse.move(zone.x + zone.width * 0.5 + 1, zone.y + zone.height / 2);
  await page.mouse.up();
  // Moment au dixième (« 0:06,0 ») ; puis réglage fin, pas de 0,1 s (temps 1 bis).
  const moment = await lireHorloge(page);
  check(moment >= 40 && moment < 80, `moment dans le plan « Veste » (${moment / 10} s)`);
  for (const [bouton, ecart] of [[T.avancer, 1], [T.avancer, 2], [T.reculer, 1], [T.reculer, 0]] as const) {
    await page.getByLabel(bouton, { exact: true }).click();
    await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(horloge(moment + ecart, combo.locale))})`, undefined, { timeout: 10_000 });
  }
  await page.waitForTimeout(800); // grande image du nouveau moment
  await capture("03-moment-6s");
  await page.getByText(T.utiliser).click();
  await page.getByText(T.ciblage).waitFor({ timeout: 30_000 });
  const couleur = await couleurImageChoisie(page);
  check(couleur !== null && couleurProche(couleur, VESTE, 20), `image choisie = « Veste » à 6 s (couleur ${JSON.stringify(couleur)})`);
  await capture("04-ciblage");
}

/** Messages de refus, sur le Spotter. */
async function refus(p: Parcours, page: Page, combo: Combo, fichier: string, texte: string, nom: string, problemes: string[]): Promise<void> {
  await page.goto(`${p.siteUrl}/`);
  await page.getByText(TEXTES[combo.locale].importer).waitFor({ timeout: 30_000 });
  await choisirVideo(page, combo, fichier);
  await page.getByText(texte, { exact: false }).waitFor({ timeout: 30_000 });
  await p.capture(page, `${combo.id}-${nom}`);
  await controlerAffichage(page, combo, nom, problemes);
}

/** Identification lancée avec l'image choisie : la recherche part comme une photo (clé SerpApi invalide). */
async function identification(p: Parcours, page: Page, compte: TestAccount): Promise<void> {
  await page.getByText(TEXTES.fr.lancer).click();
  await page.getByText(TEXTES.fr.echec).waitFor({ timeout: 60_000 });
  await p.capture(page, "fr-clair-06-identification");
  const { data, error } = await p.admin
    .from("product_searches")
    .select("source_platform, status")
    .eq("user_id", compte.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  check(!error, `recherche lue (${error?.message ?? ""})`);
  const recherche = RECHERCHE.parse(data);
  check(recherche.source_platform === "photo" && recherche.status === "failed", `recherche partie comme une photo (${JSON.stringify(recherche)})`);
}

/** HEVC (format des iPhone) : lu, ou message clair — le résultat dépend du navigateur. */
async function essaiHevc(p: Parcours, page: Page, combo: Combo, fichiers: Fichiers): Promise<string> {
  await page.goto(`${p.siteUrl}/`);
  await page.getByText(TEXTES.fr.importer).waitFor({ timeout: 30_000 });
  await choisirVideo(page, combo, fichiers.hevc);
  const resultat = await Promise.race([
    page.getByText(TEXTES.fr.titre).waitFor({ timeout: 30_000 }).then(() => "lue"),
    page.getByText(TEXTES.fr.illisible, { exact: false }).waitFor({ timeout: 30_000 }).then(() => "refusée avec le message « navigateur »"),
  ]);
  await p.capture(page, "fr-clair-09-hevc");
  return resultat;
}

function controlerStatistiques(envois: Envoi[]): void {
  const autorisees = new Set(["duration_s", "source", "reason", "environment", "platform", "$geoip_disable", "$process_person_profile"]);
  const video = envois.filter((e) => e.event.startsWith("video_"));
  for (const envoi of video) {
    const intrus = Object.keys(envoi.properties).filter((cle) => !autorisees.has(cle));
    check(intrus.length === 0, `${envoi.event} : propriétés hors liste ${intrus.join(", ")}`);
  }
  const de = (event: string) => video.filter((e) => e.event === event);
  check(de("video_imported").some((e) => e.properties.duration_s === 12 && e.properties.source === "file"), "video_imported (12 s, fichier)");
  check(de("video_frame_chosen").length >= COMBOS.length, "video_frame_chosen dans chaque combinaison");
  check(de("video_rejected").some((e) => e.properties.reason === "too_long" && e.properties.duration_s === 65), "video_rejected trop longue (65 s)");
  check(de("video_rejected").some((e) => e.properties.reason === "too_large"), "video_rejected trop lourde");
  check(de("video_rejected").some((e) => e.properties.reason === "unreadable"), "video_rejected illisible");
}

function fichiersRefus(dossier: string): Pick<Fichiers, "grande" | "abimee"> {
  // 101 Mo sans rien écrire (fichier « creux ») : seule la taille compte.
  const grande = join(dossier, "grande.mp4");
  const fd = openSync(grande, "w");
  ftruncateSync(fd, 101_000_000);
  closeSync(fd);
  const abimee = join(dossier, "abimee.mp4");
  writeFileSync(abimee, randomBytes(200_000));
  return { grande, abimee };
}

export async function run(p: Parcours): Promise<void> {
  const videos = await genererVideosEssai();
  const fichiers: Fichiers = { ...videos, ...fichiersRefus(videos.dossier) };
  const compte = await p.createAccount("l4", "Louise (test)", { settled: true });
  const ok = await p.api(compte, "POST", "/api/consents", { consents: [{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted: true }] });
  check(ok.ok, "consentement « statistiques » du compte de test");
  const envois: Envoi[] = [];
  const problemes: string[] = [];
  try {
    for (const combo of COMBOS) {
      await p.step(`${combo.id} : vidéo de 12 s, image à 6 s, refus d'une vidéo trop longue`, async () => {
        const page = await ouvrirSpotter(p, compte, combo, envois);
        await parcoursVideo(p, page, combo, fichiers, problemes);
        if (combo.id === "fr-clair") await identification(p, page, compte);
        await refus(p, page, combo, fichiers.longue, TEXTES[combo.locale].tropLongue, "05-trop-longue", problemes);
        if (combo.id === "fr-clair" || combo.id === "en-sombre") {
          await refus(p, page, combo, fichiers.grande, TEXTES[combo.locale].tropLourde, "07-trop-lourde", problemes);
          await refus(p, page, combo, fichiers.abimee, TEXTES[combo.locale].illisible, "08-illisible", problemes);
        }
        if (combo.id === "fr-clair") process.stdout.write(`  vidéo HEVC dans ce navigateur : ${await essaiHevc(p, page, combo, fichiers)}\n`);
        await page.context().close();
      });
    }
    await p.step("Statistiques : événements vidéo, liste fermée de propriétés", async () => controlerStatistiques(envois));
    check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
