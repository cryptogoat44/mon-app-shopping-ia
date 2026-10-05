// Vérification de l'app iPhone sur le simulateur (lot 3bis), réutilisable.
//
//   pnpm --filter backend parcours-iphone natif      parcours complet (Maestro) + erreur de test Sentry
//   pnpm --filter backend parcours-iphone preparer   données de test prêtes et session ouverte dans
//                                                    l'app, puis attente (Ctrl+C : nettoyage)
//   pnpm --filter backend parcours-iphone video      lot 4 : vidéo importée, dans les 4 combinaisons
//                                                    (captures : docs/lot-4-iphone-captures/)
//
// Prérequis : Xcode, Maestro (brew), un simulateur iPhone démarré avec l'app
// de développement installée (compilation : voir docs/journal-decisions.md,
// lot 3bis). Captures : docs/lot-3bis-captures/.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import sharp from "sharp";
import { lancerParcours, LIEN_DEV_CLIENT, log, maestro, type Compte, type Outils } from "./boite-a-outils.js";
import { z } from "zod";
import { couleurProche, genererVideosEssai, rgb, SEGMENTS } from "../lib/videos-essai.js";
import { verifierSentry } from "./sentry.js";

const FLOWS = join(import.meta.dirname, "flows");
// Écrans possibles au démarrage, selon l'état laissé par la fois précédente.
const DEMARRAGE = "Commencer|Récemment spottées|Nouveau mot de passe|Connexion à Spotto.*|Spotto est momentanément injoignable.*";

async function image(texte: string, fond: string, largeur = 900, hauteur = 1200): Promise<Buffer> {
  const svg = `<svg width="${largeur}" height="${hauteur}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${fond}"/>
    <text x="50%" y="52%" font-family="Georgia, serif" font-size="96" fill="#FAF9F7" text-anchor="middle">${texte}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function ok(reponse: Response, quoi: string): Promise<Response> {
  if (!reponse.ok) throw new Error(`${quoi} impossible (${reponse.status})`);
  return reponse;
}

export interface Donnees {
  louise: Compte;
  camille: Compte;
  rechercheId: string;
  envieId: string;
  publicationId: string;
}

/** Données neutres : une pièce, une publication photo commentée par Camille,
 * une Envie avec lien marchand, un résultat du Spotter (aucun appel SerpApi). */
async function preparer(o: Outils): Promise<Donnees> {
  const louise = await o.creerCompte("l", "Louise (test)");
  const camille = await o.creerCompte("c", "Camille (test)");
  const piece = new FormData();
  piece.append("title", "Kelly 28");
  piece.append("category", "bags");
  piece.append("file", new Blob([new Uint8Array(await image("Kelly 28", "#6B4A3A"))], { type: "image/jpeg" }), "piece.jpg");
  const kelly = (await (await ok(await o.api(louise, "POST", "/api/vault", piece), "Ajout au Vault")).json()) as { id: string; imageUrl: string };
  const photo = new FormData();
  photo.append("type", "lifestyle");
  photo.append("privacy", "public");
  photo.append("caption", "Marais ✦");
  photo.append("file", new Blob([new Uint8Array(await image("✦", "#7A8B6F"))], { type: "image/jpeg" }), "photo.jpg");
  const publication = (await (await ok(await o.api(louise, "POST", "/api/posts", photo), "Publication")).json()) as { id: string };
  await ok(await o.api(camille, "POST", `/api/follows/${louise.id}`), "Abonnement");
  await ok(await o.api(camille, "POST", `/api/posts/${publication.id}/comments`, { body: "✦✦✦" }), "Commentaire");
  const envie = (await (
    await ok(
      await o.api(louise, "POST", "/api/wishlist", { title: "Kelly 28", imageUrl: kelly.imageUrl, priceMin: 1250, currency: "EUR", merchantName: "Example", merchantUrl: "https://example.com/kelly" }),
      "Envie"
    )
  ).json()) as { id: string };
  const { data: recherche, error } = await o.admin
    .from("product_searches")
    .insert({ user_id: louise.id, source_platform: "photo", method: "manual_screenshot", status: "completed" })
    .select("id")
    .single();
  if (error || !recherche) throw new Error(`Recherche de démonstration impossible : ${error?.message ?? "?"}`);
  const correspondance = { search_id: recherche.id, image_url: kelly.imageUrl, merchant_name: "Example" };
  const { data: matches, error: errMatches } = await o.admin
    .from("product_matches")
    .insert([
      { ...correspondance, rank: 1, product_name: "Kelly 28", price_min: 1250, price_max: 1250, currency: "EUR", merchant_url: "https://example.com/kelly" },
      { ...correspondance, rank: 2, product_name: "Tank 2024", price_min: 89.5, price_max: 89.5, currency: "USD", merchant_url: "https://example.com/tank" },
    ])
    .select("id, merchant_url");
  if (errMatches || !matches) throw new Error(`Propositions de démonstration impossibles : ${errMatches?.message ?? "?"}`);
  // Comme une vraie recherche : un lien « direct » par proposition (suivi des clics).
  const { error: errLiens } = await o.admin
    .from("affiliate_links")
    .insert(matches.map((m) => ({ product_match_id: m.id, network: "direct", affiliate_url: m.merchant_url })));
  if (errLiens) throw new Error(`Liens marchands de démonstration impossibles : ${errLiens.message}`);
  return { louise, camille, rechercheId: String(recherche.id), envieId: envie.id, publicationId: publication.id };
}

/** Deux photos dans la photothèque du simulateur (pour le choix de photo). */
async function photosSimulateur(o: Outils): Promise<void> {
  const dossier = mkdtempSync(join(tmpdir(), "parcours-iphone-"));
  for (const [nom, texte, fond] of [["veste", "Veste", "#5A4632"], ["sac", "Sac", "#2F3E4E"]] as const) {
    const fichier = join(dossier, `${nom}.jpg`);
    writeFileSync(fichier, await image(texte, fond, 1200, 1600));
    o.xcrun(["simctl", "addmedia", o.udid, fichier]);
  }
  rmSync(dossier, { recursive: true, force: true });
}

/** Lot 4 : trois vidéos d'essai dans la photothèque du simulateur. Le
 * sélecteur range de la plus ancienne à la plus récente : la longue, puis
 * la HEVC, puis la courte (H.264). */
async function videosSimulateur(o: Outils): Promise<void> {
  const videos = await genererVideosEssai();
  try {
    for (const fichier of [videos.longue, videos.hevc, videos.courte]) o.xcrun(["simctl", "addmedia", o.udid, fichier]);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
}

function etape(o: Outils, flow: string, variables: Record<string, string> = {}): void {
  const precision = variables.CAPTURE ?? variables.PREFIXE;
  log(`→ ${flow}${precision ? ` (${precision})` : ""}`);
  maestro(o.udid, join(FLOWS, `${flow}.yaml`), o.sortie, variables);
}

/** Connexion par le lien « mot de passe oublié » (ouvert par l'outil), puis
 * app relancée : la session doit être conservée. */
async function connecter(o: Outils, compte: Compte, ecranConnecte = "Récemment spottées"): Promise<void> {
  o.relancerApp();
  etape(o, "00-lien-ouvert", { ATTENDRE: DEMARRAGE, CAPTURE: "00-demarrage" });
  o.ouvrirLien(await o.lienSession(compte));
  etape(o, "01-nouveau-mot-de-passe");
  o.relancerApp();
  etape(o, "00-lien-ouvert", { ATTENDRE: ecranConnecte, CAPTURE: "02-session-conservee-apres-relance" });
}

async function natif(o: Outils): Promise<void> {
  const d = await preparer(o);
  await photosSimulateur(o);
  await connecter(o, d.louise);
  for (const flow of ["02-photo-recadrage", "03-resultat-marchand-partage", "04-fil-profil-reglages"]) etape(o, flow);
  log("→ erreur de test Sentry (compte connecté)");
  await verifierSentry(o, d.louise);
  etape(o, "05-deconnexion");
}

/** Exploration : données prêtes, session ouverte dans l'app, identifiants
 * (rien de secret) dans un fichier temporaire privé, attente jusqu'à l'arrêt. */
async function attendreExploration(o: Outils): Promise<void> {
  const d = await preparer(o);
  await photosSimulateur(o);
  await connecter(o, d.louise);
  const dossier = mkdtempSync(join(tmpdir(), "parcours-iphone-ctx-"));
  process.on("exit", () => rmSync(dossier, { recursive: true, force: true }));
  const fichier = join(dossier, "contexte.json");
  writeFileSync(fichier, JSON.stringify({ LIEN_DEV: LIEN_DEV_CLIENT, RECHERCHE: d.rechercheId, ENVIE: d.envieId, PUBLICATION: d.publicationId, LOUISE: d.louise.id }));
  chmodSync(fichier, 0o600);
  log(`Contexte des commandes d'exploration : ${fichier}`);
  log("Données prêtes, Louise (test) connectée. Arrêt (Ctrl+C ou signal) : nettoyage complet.");
  await new Promise(() => {});
}

// Lot 4 : libellés de l'app dans chaque langue (le sélecteur d'iOS, lui, suit la langue de l'iPhone).
const LIBELLES = {
  fr: { PROFIL: "Profil", REGLAGES: "Réglages", RETOUR: "Retour", LANGUE: "Français", CLAIR: "Clair", SOMBRE: "Sombre", SYSTEME: "Système", IMPORTER: "Importer une vidéo", UTILISER: "Utiliser cette image", CIBLAGE: "Entourez la pièce", FERMER: "Fermer", AVANCER: "Avancer d'une demi-seconde", RECULER: "Reculer d'une demi-seconde" },
  en: { PROFIL: "Profile", REGLAGES: "Settings", RETOUR: "Back", LANGUE: "English", CLAIR: "Light", SOMBRE: "Dark", SYSTEME: "System", IMPORTER: "Import a video", UTILISER: "Use this frame", CIBLAGE: "Frame the piece", FERMER: "Close", AVANCER: "Forward half a second", RECULER: "Back half a second" },
} as const;
const COMBINAISONS = [
  { id: "fr-clair", langue: "fr", theme: "CLAIR" },
  { id: "fr-sombre", langue: "fr", theme: "SOMBRE" },
  { id: "en-clair", langue: "en", theme: "CLAIR" },
  { id: "en-sombre", langue: "en", theme: "SOMBRE" },
] as const;

/** Réglages de l'app : libellés de la langue en cours pour y aller, de la nouvelle ensuite. */
function regler(o: Outils, depuis: "fr" | "en", vers: "fr" | "en", theme: "CLAIR" | "SOMBRE" | "SYSTEME", prefixe: string): void {
  const avant = LIBELLES[depuis];
  const apres = LIBELLES[vers];
  etape(o, "06-reglages-combinaison", { PROFIL: avant.PROFIL, REGLAGES: avant.REGLAGES, LANGUE: apres.LANGUE, THEME: apres[theme], RETOUR: apres.RETOUR, IMPORTER: apres.IMPORTER, PREFIXE: prefixe });
}

/** La recherche lancée avec l'image d'une vidéo est partie comme une photo (clé SerpApi invalide : échec). */
async function verifierRecherche(o: Outils, compte: Compte): Promise<void> {
  const { data, error } = await o.admin.from("product_searches").select("source_platform, status").eq("user_id", compte.id).order("created_at", { ascending: false }).limit(1).single();
  if (error) throw new Error(`Recherche introuvable : ${error.message}`);
  const recherche = z.object({ source_platform: z.string(), status: z.string() }).parse(data);
  if (recherche.source_platform !== "photo" || recherche.status !== "failed") throw new Error(`Recherche inattendue : ${JSON.stringify(recherche)}`);
  log("  recherche partie comme une photo (clé SerpApi invalide : échec technique, aucun crédit)");
}

/** Première image (« Sac », vidéo en hauteur) montrée EN ENTIER : de part et
 * d'autre, le fond de la zone, pas l'image. Défaut corrigé au lot 4 : sur
 * iPhone, elle pouvait s'afficher agrandie et rognée. */
async function verifierPremiereImage(capture: string): Promise<void> {
  const { data, info } = await sharp(capture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (fx: number, fy: number): number[] => {
    const debut = (Math.round(fy * info.height) * info.width + Math.round(fx * info.width)) * 3;
    return [...data.subarray(debut, debut + 3)];
  };
  const sac = rgb(SEGMENTS[0].fond);
  // Hauteur 30 % : dans la zone de l'image, au-dessus du mot « Sac ».
  if (!couleurProche(pixel(0.5, 0.3), sac, 25)) throw new Error(`${basename(capture)} : première image absente (${JSON.stringify(pixel(0.5, 0.3))})`);
  if (couleurProche(pixel(0.12, 0.3), sac, 25) || couleurProche(pixel(0.88, 0.3), sac, 25)) {
    throw new Error(`${basename(capture)} : première image agrandie et rognée, au lieu d'être montrée en entier`);
  }
  log("  première image montrée en entier");
}

/** Lot 4 : vidéo importée, dans les 4 combinaisons de langue et de thème. */
async function video(o: Outils): Promise<void> {
  const louise = await o.creerCompte("l", "Louise (test)");
  await videosSimulateur(o);
  await connecter(o, louise, "Importer une vidéo");
  let courante: "fr" | "en" = "fr";
  for (const combo of COMBINAISONS) {
    regler(o, courante, combo.langue, combo.theme, combo.id);
    courante = combo.langue;
    const l = LIBELLES[combo.langue];
    etape(o, "07-video", { IMPORTER: l.IMPORTER, UTILISER: l.UTILISER, CIBLAGE: l.CIBLAGE, FERMER: l.FERMER, AVANCER: l.AVANCER, RECULER: l.RECULER, PREFIXE: combo.id });
    await verifierPremiereImage(join(o.sortie, `${combo.id}-02-choix-image.png`));
  }
  regler(o, courante, "fr", "SYSTEME", "fr-systeme");
  etape(o, "08-video-limites");
  await verifierRecherche(o, louise);
}

const SCENARIOS: Record<string, { run: (o: Outils) => Promise<void>; sortie: string }> = {
  natif: { run: natif, sortie: "lot-3bis-captures" },
  preparer: { run: attendreExploration, sortie: "lot-3bis-captures" },
  video: { run: video, sortie: "lot-4-iphone-captures" },
};

const nom = process.argv[2] ?? "";
const scenario = SCENARIOS[nom];
if (!scenario) {
  console.error(`Indiquez un scénario : ${Object.keys(SCENARIOS).join(", ")}.`);
  process.exit(1);
}
lancerParcours(scenario.sortie, scenario.run).catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
