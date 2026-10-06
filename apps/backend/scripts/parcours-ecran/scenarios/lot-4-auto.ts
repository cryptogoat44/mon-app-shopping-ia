// Lot 4, temps 1 bis — analyse automatique d'une vidéo (site), dans les 4
// combinaisons.
//
//   pnpm --filter backend parcours-ecran lot-4-auto
//
// IA d'Anthropic SIMULÉE dans le serveur local (scripts/lib/anthropic-simule.ts :
// aucun appel réel) ; clé SerpApi invalide (aucun crédit). Vidéo d'essai de
// 12 s : « Sac », « Veste », « Chaussures ». Dans chaque combinaison, un
// compte neuf : description, consentement au premier usage (aucune image ne
// part avant), analyse, identification du meilleur moment, « Essayer un autre
// moment », curseur manuel. Une fois : image « Veste » contrôlée au cadrage,
// retrait dans les Réglages, refus (« Plutôt le curseur manuel »), pièce non
// repérée, panne, lien (« Ajoutez la vidéo »). Statistiques interceptées.
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { couleurProche, genererVideosEssai, rgb, SEGMENTS } from "../../lib/videos-essai.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { check, choisirVideo, controlerAffichage, ouvrirSpotter, type Envoi } from "./lot-4.js";

export const name = "Lot 4, temps 1 bis — analyse automatique d'une vidéo (site)";
export const outputDir = "lot-4-auto-captures";
// Clé PostHog FACTICE : les envois sont interceptés, rien ne sort.
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };
export const simulatedAi = true;

type Cle =
  | "titre"
  | "description"
  | "trouver"
  | "consentement"
  | "accepter"
  | "refuser"
  | "echec"
  | "autre"
  | "essayer2"
  | "essayer1"
  | "moiMeme"
  | "curseur"
  | "recadrer"
  | "ciblage"
  | "nonReperee"
  | "modifier"
  | "interrompue"
  | "reessayer"
  | "interrupteur"
  | "retire"
  | "ajouterVideo"
  | "lien"
  | "continuer";
const TEXTES: Record<Locale, Record<Cle, string>> = {
  fr: {
    titre: "Que cherchez-vous ?",
    description: "veste en daim marron",
    trouver: "Trouver la pièce",
    consentement: "Analyse automatique de la vidéo",
    accepter: "Accepter",
    refuser: "Plutôt le curseur manuel",
    echec: "La recherche n'a pas abouti",
    // Sous une recherche qui n'a pas abouti (clé SerpApi volontairement invalide).
    autre: "Autres moments de la vidéo",
    essayer2: "Essayer un autre moment (2 restants)",
    essayer1: "Essayer un autre moment (1 restant)",
    moiMeme: "Choisir l'image moi-même",
    curseur: "Choisissez l'image",
    recadrer: "Recadrer",
    ciblage: "Entourez la pièce",
    nonReperee: "Pièce non repérée",
    modifier: "Modifier la description",
    interrompue: "Analyse automatique interrompue",
    reessayer: "Réessayer",
    interrupteur: "Analyse automatique des vidéos par une IA",
    retire: "Désactivée : aucune image de vos vidéos n'est envoyée",
    ajouterVideo: "Ajoutez la vidéo",
    lien: "Collez ou tapez un lien",
    continuer: "Continuer",
  },
  en: {
    titre: "What are you looking for?",
    description: "brown suede jacket",
    trouver: "Find the piece",
    consentement: "Automatic video analysis",
    accepter: "Accept",
    refuser: "Use the manual slider instead",
    echec: "The search didn't go through",
    autre: "Other moments in the video",
    essayer2: "Try another moment (2 left)",
    essayer1: "Try another moment (1 left)",
    moiMeme: "Choose the frame myself",
    curseur: "Choose the frame",
    recadrer: "Reframe",
    ciblage: "Frame the piece",
    nonReperee: "Piece not spotted",
    modifier: "Edit the description",
    interrompue: "Automatic analysis interrupted",
    reessayer: "Try again",
    interrupteur: "Automatic video analysis by an AI",
    retire: "Off: no frame from your videos is sent",
    ajouterVideo: "Add the video",
    lien: "Paste or type a link",
    continuer: "Continue",
  },
};
const VESTE = rgb(SEGMENTS[1].fond);
const CHAUSSURES = rgb(SEGMENTS[2].fond);
const COULEUR = z.array(z.number()).length(3).nullable();
const CONSENT = z.object({ granted_at: z.string().nullable(), revoked_at: z.string().nullable(), document_version: z.string().nullable() });

interface Suivi {
  /** Envois d'images à l'analyse automatique, vus par le navigateur. */
  analyses: number;
}

/** Compte neuf (premier usage), statistiques acceptées pour les intercepter. */
async function nouveauCompte(p: Parcours, combo: Combo): Promise<TestAccount> {
  const compte = await p.createAccount(`a${combo.id.replace("-", "")}`.slice(0, 9), "Louise (test)", { settled: true });
  const ok = await p.api(compte, "POST", "/api/consents", { consents: [{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted: true }] });
  check(ok.ok, "consentement « statistiques » du compte de test");
  return compte;
}

function suivreAnalyses(page: Page): Suivi {
  const suivi: Suivi = { analyses: 0 };
  page.on("request", (requete) => {
    if (requete.method() === "POST" && requete.url().endsWith("/api/video-moments")) suivi.analyses += 1;
  });
  return suivi;
}

/** Couleur moyenne d'une zone sans texte de la plus grande image locale (« blob: »). */
async function couleurImage(page: Page): Promise<number[] | null> {
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

async function dernierConsentement(p: Parcours, compte: TestAccount): Promise<z.infer<typeof CONSENT>> {
  const { data, error } = await p.admin
    .from("consents")
    .select("granted_at, revoked_at, document_version")
    .eq("user_id", compte.id)
    .eq("type", "analyse_video_ia")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  check(!error, `consentement lu (${error?.message ?? ""})`);
  return CONSENT.parse(data);
}

/** Vidéo → description → consentement (premier usage) → analyse → identification. */
async function premierUsage(p: Parcours, page: Page, combo: Combo, compte: TestAccount, videoCourte: string, problemes: string[]): Promise<Suivi> {
  const T = TEXTES[combo.locale];
  const capture = async (nom: string) => {
    await p.capture(page, `${combo.id}-${nom}`);
    await controlerAffichage(page, combo, nom, problemes);
  };
  const suivi = suivreAnalyses(page);
  await choisirVideo(page, combo, videoCourte);
  await page.getByText(T.titre).waitFor({ timeout: 30_000 });
  await page.getByPlaceholder(combo.locale === "fr" ? "ex. veste en daim marron" : "e.g. brown suede jacket").fill(T.description);
  await capture("01-description");
  await page.getByText(T.trouver, { exact: true }).click();
  await page.getByText(T.consentement).waitFor({ timeout: 15_000 });
  await capture("02-consentement");
  const avantAccord = suivi.analyses;
  check(avantAccord === 0, "aucune image envoyée avant l'accord");
  const lignesAvant = p.simulation.length;
  await page.getByText(T.accepter, { exact: true }).click();
  await page.getByText(T.echec).waitFor({ timeout: 90_000 });
  await page.getByText(T.autre).waitFor({ timeout: 10_000 });
  await page.getByText(T.essayer2).waitFor({ timeout: 10_000 });
  await capture("03-resultat");
  check(suivi.analyses === 1, `une seule analyse envoyée (${suivi.analyses})`);
  const ligne = p.simulation.slice(lignesAvant).at(-1) ?? "";
  check(/3 image\(s\), 3 moment\(s\), plan reconnu : oui/.test(ligne), `étage 1 : une image par plan, plan « Veste » reconnu (${ligne})`);
  const consentement = await dernierConsentement(p, compte);
  check(consentement.granted_at !== null && consentement.document_version === CONSENT_VERSIONS.analyse_video_ia, "accord enregistré, daté et versionné");
  return suivi;
}

/** Recadrer → l'image envoyée à l'identification est celle attendue. */
async function controlerImage(page: Page, combo: Combo, attendue: number[], plan: string): Promise<void> {
  const T = TEXTES[combo.locale];
  await page.getByText(T.recadrer, { exact: true }).first().click();
  await page.getByText(T.ciblage).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const couleur = await couleurImage(page);
  check(couleur !== null && couleurProche(couleur, attendue, 25), `image identifiée = « ${plan} » (couleur ${JSON.stringify(couleur)})`);
}

/** Essayer le deuxième moment proposé, puis ouvrir le curseur manuel. */
async function autreMoment(p: Parcours, page: Page, combo: Combo, problemes: string[]): Promise<void> {
  const T = TEXTES[combo.locale];
  await page.getByText(T.essayer2).click();
  await page.getByText(T.essayer1).waitFor({ timeout: 90_000 });
  await p.capture(page, `${combo.id}-04-autre-moment`);
  await controlerAffichage(page, combo, "04-autre-moment", problemes);
  // Les écrans précédents restent dans la page (cachés) : le bouton visible seulement.
  await page.getByRole("button", { name: T.moiMeme, exact: true }).click();
  await page.getByRole("heading", { name: T.curseur, exact: true }).waitFor({ timeout: 30_000 });
  // Le curseur repart du moment essayé (2e moment : plan « Chaussures », 8 à 12 s).
  await page.waitForFunction(`/0:(0[89]|1[01])[,.]\\d \\/ 0:12/.test(document.body.innerText)`, undefined, { timeout: 15_000 });
  await p.capture(page, `${combo.id}-05-curseur`);
  await controlerAffichage(page, combo, "05-curseur", problemes);
}

/** Réglages : retrait de l'accord ; la question revient, refus → curseur manuel, rien n'est envoyé. */
async function retraitEtRefus(p: Parcours, page: Page, compte: TestAccount, videoCourte: string, problemes: string[]): Promise<void> {
  const combo = COMBOS[0]!;
  const T = TEXTES.fr;
  await page.goto(`${p.siteUrl}/settings`);
  const interrupteur = page.getByLabel(T.interrupteur, { exact: true });
  await interrupteur.waitFor({ timeout: 30_000 });
  await interrupteur.click();
  await page.getByText(T.retire, { exact: false }).waitFor({ timeout: 15_000 });
  await p.capture(page, "fr-clair-06-reglages-retrait");
  await controlerAffichage(page, combo, "06-reglages-retrait", problemes);
  const retire = await dernierConsentement(p, compte);
  check(retire.granted_at === null && retire.revoked_at !== null, "retrait enregistré");

  await page.goto(`${p.siteUrl}/`);
  const suivi = suivreAnalyses(page);
  await choisirVideo(page, combo, videoCourte);
  await page.getByText(T.titre).waitFor({ timeout: 30_000 });
  await page.getByPlaceholder("ex. veste en daim marron").fill(T.description);
  await page.getByText(T.trouver, { exact: true }).click();
  await page.getByText(T.consentement).waitFor({ timeout: 15_000 });
  await page.getByText(T.refuser, { exact: true }).click();
  await page.getByRole("heading", { name: TEXTES.fr.curseur, exact: true }).waitFor({ timeout: 30_000 });
  await p.capture(page, "fr-clair-07-refus-curseur");
  await controlerAffichage(page, combo, "07-refus-curseur", problemes);
  check(suivi.analyses === 0, "refus : aucune image envoyée");
}

/** Replis : pièce non repérée, puis panne de l'IA (« Réessayer » proposé). */
async function replis(p: Parcours, page: Page, videoCourte: string, problemes: string[]): Promise<void> {
  const combo = COMBOS[0]!;
  const T = TEXTES.fr;
  await page.goto(`${p.siteUrl}/`);
  await choisirVideo(page, combo, videoCourte);
  await page.getByText(T.titre).waitFor({ timeout: 30_000 });
  const champ = page.getByPlaceholder("ex. veste en daim marron");
  await champ.fill("rien de précis");
  await page.getByText(T.trouver, { exact: true }).click();
  await page.getByText(T.accepter, { exact: true }).click();
  await page.getByText(T.nonReperee).waitFor({ timeout: 60_000 });
  await p.capture(page, "fr-clair-08-non-reperee");
  await controlerAffichage(page, combo, "08-non-reperee", problemes);
  await page.getByText(T.modifier, { exact: true }).click();
  await champ.fill("panne simulée");
  await page.getByText(T.trouver, { exact: true }).click();
  await page.getByText(T.interrompue).waitFor({ timeout: 60_000 });
  await page.getByText(T.reessayer, { exact: true }).waitFor();
  await p.capture(page, "fr-clair-09-panne");
  await controlerAffichage(page, combo, "09-panne", problemes);
}

/** Lien TikTok (aperçu simulé dans le navigateur, sans appel à TikTok) : « Ajoutez la vidéo ». */
async function lienAjouterVideo(p: Parcours, page: Page, videoCourte: string, problemes: string[]): Promise<void> {
  const combo = COMBOS[0]!;
  const T = TEXTES.fr;
  const couverture = await sharp({ create: { width: 360, height: 640, channels: 3, background: "#4A5A3A" } }).jpeg().toBuffer();
  const lien = "https://www.tiktok.com/@spotto.essai/video/7300000000000000001";
  await page.route("**/api/searches/prepare", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: randomUUID(),
        sourceUrl: lien,
        sourcePlatform: "tiktok",
        method: "oembed",
        thumbnailUrl: `data:image/jpeg;base64,${couverture.toString("base64")}`,
        status: "pending",
        errorMessage: null,
        query: null,
        createdAt: new Date().toISOString(),
        matches: [],
        previewIssue: null,
      }),
    })
  );
  await page.goto(`${p.siteUrl}/`);
  await page.getByPlaceholder(T.lien).fill(lien);
  await page.getByText(T.continuer, { exact: true }).click();
  await page.getByText(T.ajouterVideo).waitFor({ timeout: 30_000 });
  await p.capture(page, "fr-clair-10-lien-ajouter-video");
  await controlerAffichage(page, combo, "10-lien-ajouter-video", problemes);
  await page.unroute("**/api/searches/prepare");
  const [selecteur] = await Promise.all([page.waitForEvent("filechooser"), page.getByText(T.ajouterVideo).click()]);
  await selecteur.setFiles(videoCourte);
  await page.getByText(T.titre).waitFor({ timeout: 30_000 });
}

function controlerStatistiques(envois: Envoi[]): void {
  const autorisees = new Set(["decision", "context", "frames_count", "duration_s", "outcome", "moments_count", "rank", "environment", "platform", "$geoip_disable", "$process_person_profile"]);
  const ia = envois.filter((e) => e.event.startsWith("video_ai_"));
  for (const envoi of ia) {
    const intrus = Object.keys(envoi.properties).filter((cle) => !autorisees.has(cle));
    check(intrus.length === 0, `${envoi.event} : propriétés hors liste ${intrus.join(", ")}`);
  }
  const de = (event: string, attendu: Record<string, unknown>) =>
    ia.filter((e) => e.event === event && Object.entries(attendu).every(([cle, valeur]) => e.properties[cle] === valeur)).length;
  check(de("video_ai_consent", { decision: "granted", context: "first_use" }) >= COMBOS.length, "accords au premier usage");
  check(de("video_ai_consent", { decision: "withdrawn", context: "settings" }) === 1, "retrait dans les Réglages");
  check(de("video_ai_consent", { decision: "declined", context: "first_use" }) === 1, "refus (curseur manuel)");
  check(de("video_ai_frames_sent", { frames_count: 3, duration_s: 12 }) >= COMBOS.length, "images envoyées : nombre et durée");
  check(de("video_ai_result", { outcome: "found", moments_count: 3 }) >= COMBOS.length, "moments trouvés");
  check(de("video_ai_result", { outcome: "not_found" }) === 1, "pièce non repérée");
  check(de("video_ai_result", { outcome: "unavailable" }) === 1, "panne");
  check(de("video_ai_moment_tried", { rank: 1 }) >= COMBOS.length && de("video_ai_moment_tried", { rank: 2 }) >= COMBOS.length, "moments essayés (1er, 2e)");
}

export async function run(p: Parcours): Promise<void> {
  const videos = await genererVideosEssai();
  const envois: Envoi[] = [];
  const problemes: string[] = [];
  try {
    for (const combo of COMBOS) {
      await p.step(`${combo.id} : description, consentement, analyse, identification, autre moment, curseur`, async () => {
        const compte = await nouveauCompte(p, combo);
        const page = await ouvrirSpotter(p, compte, combo, envois);
        await premierUsage(p, page, combo, compte, videos.courte, problemes);
        if (combo.id === "fr-clair") {
          await controlerImage(page, combo, VESTE, "Veste");
          await page.getByText(TEXTES.fr.ciblage).waitFor();
          await page.goBack();
          await page.getByText(TEXTES.fr.titre).waitFor({ timeout: 15_000 });
          await page.getByText(TEXTES.fr.trouver, { exact: true }).click();
          await page.getByText(TEXTES.fr.essayer2).waitFor({ timeout: 90_000 });
        }
        await autreMoment(p, page, combo, problemes);
        if (combo.id === "fr-clair") {
          await page.goBack();
          await page.getByText(TEXTES.fr.essayer1).waitFor({ timeout: 15_000 });
          await controlerImage(page, combo, CHAUSSURES, "Chaussures");
          await retraitEtRefus(p, page, compte, videos.courte, problemes);
          await replis(p, page, videos.courte, problemes);
          await lienAjouterVideo(p, page, videos.courte, problemes);
        }
        await page.context().close();
      });
    }
    await p.step("Statistiques : événements de l'analyse automatique, liste fermée", async () => controlerStatistiques(envois));
    check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}
