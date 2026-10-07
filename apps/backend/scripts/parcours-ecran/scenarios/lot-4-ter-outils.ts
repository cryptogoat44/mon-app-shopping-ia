// Lot 4 ter — textes et outils du parcours unique (site), partagés par
// lot-4-ter.ts et lot-4-ter-etapes.ts.
import type { Page } from "playwright-core";
import sharp from "sharp";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { rgb, SEGMENTS } from "../../lib/videos-essai.js";
import type { Combo, Locale } from "./lot-3.js";
import { check, controlerAffichage, visible } from "./spotter-outils.js";

const FR = {
  ajouterVideo: "Ajouter une vidéo",
  ajouterPhoto: "Ajouter une photo",
  question: "Que cherchez-vous ?",
  exemple: "ex. veste en daim marron, sac noir",
  description: "veste en daim marron",
  lancer: "Lancer",
  accord: "Analyse automatique de la vidéo",
  accepter: "Accepter",
  moiMeme: "Choisir l'image moi-même",
  attenteVideo: "Spotto repère la pièce…",
  attenteBoutiques: "Spotto parcourt les boutiques…",
  meilleure: "Meilleure proposition",
  pasLaBonne: "Ce n'est pas la bonne pièce ?",
  recadrer: "Recadrer",
  essayerDeux: "Essayer un autre moment (2 restants)",
  essayerUn: "Essayer un autre moment (1 restant)",
  echec: "La recherche n'a pas abouti",
  reessayer: "Réessayer",
  curseur: "Choisissez l'image",
  utiliser: "Utiliser cette image",
  ciblage: "Entourez la pièce",
  zone: "Zone analysée",
  reinitialiser: "Réinitialiser le cadre",
  nonReperee: "Pièce non repérée",
  modifier: "Modifier la description",
  interrompue: "Analyse automatique interrompue",
  lienQuestion: "Vous avez un lien TikTok, Instagram ou Pinterest ?",
  lienTitre: "Une vidéo ne se lit pas depuis un lien",
  choisirImage: "Choisir l'image",
  desactivee: "Analyse automatique désactivée : vous choisirez l'image vous-même.",
  activer: "Activer l'analyse automatique",
  interrupteur: "Analyse automatique des vidéos par une IA",
  retire: "Désactivée : aucune image de vos vidéos n'est envoyée",
  nouvelleVersion: "Nouvelle version disponible.",
  recharger: "Recharger",
  tropLongue: "Cette vidéo dure 1:05",
  tropLourde: "Cette vidéo pèse 101 Mo",
  illisible: "Ce navigateur ne sait pas lire cette vidéo",
  etape: /Étape \d sur \d/,
  lienAncien: "Collez ou tapez un lien",
  fermer: "Fermer",
};
export type Textes = typeof FR;

export const TEXTES: Record<Locale, Textes> = {
  fr: FR,
  en: {
    ajouterVideo: "Add a video",
    ajouterPhoto: "Add a photo",
    question: "What are you looking for?",
    exemple: "e.g. brown suede jacket, black bag",
    description: "brown suede jacket",
    lancer: "Search",
    accord: "Automatic video analysis",
    accepter: "Accept",
    moiMeme: "Choose the frame myself",
    attenteVideo: "Spotto is finding the piece…",
    attenteBoutiques: "Spotto is browsing the boutiques…",
    meilleure: "Best suggestion",
    pasLaBonne: "Not the right piece?",
    recadrer: "Reframe",
    essayerDeux: "Try another moment (2 left)",
    essayerUn: "Try another moment (1 left)",
    echec: "The search didn't go through",
    reessayer: "Try again",
    curseur: "Choose the frame",
    utiliser: "Use this frame",
    ciblage: "Frame the piece",
    zone: "Area to analyze",
    reinitialiser: "Reset the frame",
    nonReperee: "Piece not spotted",
    modifier: "Edit the description",
    interrompue: "Automatic analysis interrupted",
    lienQuestion: "Have a TikTok, Instagram or Pinterest link?",
    lienTitre: "A video can't be read from a link",
    choisirImage: "Choose the frame",
    desactivee: "Automatic analysis is off: you'll choose the frame yourself.",
    activer: "Turn on automatic analysis",
    interrupteur: "Automatic video analysis by an AI",
    retire: "Off: no frame from your videos is sent",
    nouvelleVersion: "A new version is available.",
    recharger: "Reload",
    tropLongue: "This video lasts 1:05",
    tropLourde: "This video is 101 MB",
    illisible: "This browser cannot read this video",
    etape: /Step \d of \d/,
    lienAncien: "Paste or type a link",
    fermer: "Close",
  },
};

/** Fonds des plans de la vidéo d'essai (de 4 à 8 s : « Veste » ; de 8 à 12 s : « Chaussures »). */
export const VESTE = rgb(SEGMENTS[1].fond);
export const CHAUSSURES = rgb(SEGMENTS[2].fond);

/** Une capture, avec contrôle de la langue et du thème (« nuit » : écran d'attente, sombre partout). */
export function capteur(p: Parcours, page: Page, combo: Combo, problemes: string[]) {
  return async (nom: string, fond: "theme" | "nuit" = "theme") => {
    await p.capture(page, `${combo.id}-${nom}`);
    await controlerAffichage(page, combo, nom, problemes, fond);
  };
}

/** Compte neuf (premier usage), statistiques acceptées pour les intercepter. */
export async function nouveauCompte(p: Parcours, libelle: string): Promise<TestAccount> {
  const compte = await p.createAccount(libelle.slice(0, 9), "Louise (test)", { settled: true });
  const ok = await p.api(compte, "POST", "/api/consents", { consents: [{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted: true }] });
  check(ok.ok, "consentement « statistiques » du compte de test");
  return compte;
}

/** Ralentit une réponse du serveur local de 3 s, le temps de photographier une attente. */
export async function ralentir(page: Page, motif: string): Promise<void> {
  await page.route(motif, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
}

// Noms neutres (anglais sans mot-clé de l'interface) : le contrôle de la langue
// de l'écran ne doit pas s'arrêter sur un nom de produit, qui vient du marchand.
const PIECES = [
  { nom: "Camel suede jacket", marchand: "Atelier Example", prix: 189, fond: "#8A5A3C" },
  { nom: "Suede bomber", marchand: "Maison Example", prix: 245, fond: "#6E4B32" },
  { nom: "Cropped suede jacket", marchand: "Example Store", prix: 159, fond: "#9C6B48" },
];

async function imagePiece(fond: string): Promise<string> {
  const jpeg = await sharp({ create: { width: 400, height: 500, channels: 3, background: fond } }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Identification réussie, fabriquée dans le navigateur : la requête ne part
 * jamais vers le serveur, donc aucun crédit SerpApi. */
export async function simulerResultats(page: Page, query: string): Promise<void> {
  const images = await Promise.all(PIECES.map((piece) => imagePiece(piece.fond)));
  await page.route("**/api/searches/*/run", async (route) => {
    const id = /\/api\/searches\/([^/]+)\/run/.exec(route.request().url())?.[1] ?? "recherche";
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const matches = PIECES.map((piece, index) => ({
      id: `simulation-${index + 1}`,
      rank: index + 1,
      productName: piece.nom,
      brand: null,
      imageUrl: images[index],
      imageHdUrl: null,
      priceMin: piece.prix,
      priceMax: piece.prix,
      currency: "EUR",
      merchantName: piece.marchand,
      merchantUrl: "https://example.com/piece",
      affiliateUrl: "https://example.com/piece",
    }));
    const recherche = { id, sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot", thumbnailUrl: null, status: "completed", errorMessage: null, query, createdAt: new Date().toISOString(), matches };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recherche) });
  });
}

/** Sous les résultats : aucune correction d'emblée, seulement le lien discret,
 * juste sous la meilleure proposition et visible sans défilement (décision du fondateur). */
export async function controlerResultatsSobres(page: Page, T: Textes): Promise<void> {
  const lien = visible(page, T.pasLaBonne);
  await lien.waitFor({ timeout: 15_000 });
  const [boite, titre] = await Promise.all([lien.boundingBox(), visible(page, T.meilleure).boundingBox()]);
  const hauteur = page.viewportSize()?.height ?? 0;
  const bas = boite ? Math.round(boite.y + boite.height) : -1;
  check(boite !== null && titre !== null && boite.y > titre.y && bas <= hauteur, `« ${T.pasLaBonne} » sous la proposition, visible sans défilement (bas du lien ${bas} px, écran ${hauteur} px)`);
  for (const correction of [T.recadrer, T.moiMeme, T.essayerDeux, T.essayerUn]) {
    check((await visible(page, correction).count()) === 0, `« ${correction} » n'est pas proposé d'emblée`);
  }
}

/** Le champ est prêt à la saisie dès l'ouverture : la personne tape sans le toucher. */
export async function champPret(page: Page, T: Textes): Promise<void> {
  await page.waitForFunction(`document.activeElement?.getAttribute("placeholder") === ${JSON.stringify(T.exemple)}`, undefined, { timeout: 10_000 });
}

/** Ferme la feuille des corrections (fond assombri, dernier « Fermer » de la page) :
 * seul le lien discret reste. */
export async function fermerFeuille(page: Page, T: Textes): Promise<void> {
  await page.getByRole("button", { name: T.fermer, exact: true }).last().click();
  const lien = visible(page, T.pasLaBonne);
  for (let essai = 0; essai < 50 && (await lien.count()) !== 1; essai += 1) await page.waitForTimeout(100);
  check((await lien.count()) === 1, "feuille des corrections refermée");
}

/** Vidéo choisie → mots tapés (le champ est déjà prêt) → « Lancer ». */
export async function lancerVideo(page: Page, T: Textes, mots: string, video: string, choisir: (page: Page, texte: string, fichier: string) => Promise<void>): Promise<void> {
  await choisir(page, T.ajouterVideo, video);
  await page.getByRole("heading", { name: T.question, exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await champPret(page, T);
  await page.keyboard.type(mots);
  await page.getByRole("button", { name: T.lancer, exact: true }).filter({ visible: true }).click();
}
