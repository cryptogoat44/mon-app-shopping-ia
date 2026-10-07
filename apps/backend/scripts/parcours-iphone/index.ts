// Vérification de l'app iPhone sur le simulateur (lot 3bis), réutilisable.
//
//   pnpm --filter backend parcours-iphone natif      parcours complet (Maestro) + erreur de test Sentry
//   pnpm --filter backend parcours-iphone preparer   données de test prêtes et session ouverte dans
//                                                    l'app, puis attente (Ctrl+C : nettoyage)
//   pnpm --filter backend parcours-iphone parcours-unique
//                                                    lot 4 ter : dernière vidéo de la galerie, quelques
//                                                    mots, « Lancer », dans les 4 combinaisons ; IA et
//                                                    SerpApi simulées (docs/lot-4-ter-iphone-captures/)
//   pnpm --filter backend parcours-iphone relance-session [n]
//                                                    lot 4 ter : n relances (20 par défaut), session
//                                                    contrôlée à chacune (docs/lot-4-ter-relances/)
//   pnpm --filter backend parcours-iphone relance-session-panne [n]
//                                                    idem, avec une coupure simulée de 1,5 s entre le
//                                                    serveur local et Supabase Auth avant chaque relance
//
// Prérequis : Xcode, Maestro (brew), un simulateur iPhone démarré avec l'app
// de développement installée (compilation : voir docs/journal-decisions.md,
// lot 3bis). Captures : docs/lot-3bis-captures/.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { BUNDLE_ID, essaiMaestro, lancerParcours, LIEN_DEV_CLIENT, log, maestro, type Compte, type Outils } from "./boite-a-outils.js";
import { z } from "zod";
import { genererVideosEssai } from "../lib/videos-essai.js";
import { verifierSentry } from "./sentry.js";

const FLOWS = join(import.meta.dirname, "flows");
// Écrans possibles au démarrage, selon l'état laissé par la fois précédente.
const DEMARRAGE = "Commencer|Récemment spottées|Ajouter une photo|Nouveau mot de passe|Connexion à Spotto.*|Spotto est momentanément injoignable.*";

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

/** Vidéos d'essai ajoutées à la photothèque du simulateur. iOS les date
 * d'après la date inscrite dans le fichier : chacune est copiée avec la date
 * de l'instant (une seconde d'écart entre elles), si bien que la dernière de
 * la liste devient la plus récente de la galerie (« Votre dernière vidéo »). */
function ajouterVideos(o: Outils, fichiers: string[]): void {
  const maintenant = Date.now();
  fichiers.forEach((fichier, rang) => {
    const copie = fichier.replace(/(\.\w+)$/, `-${maintenant}-${rang}$1`);
    const date = new Date(maintenant + rang * 1000).toISOString();
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", fichier, "-c", "copy", "-map_metadata", "-1", "-metadata", `creation_time=${date}`, copie], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Copie datée de la vidéo impossible : ${r.stderr.slice(-200)}`);
    o.xcrun(["simctl", "addmedia", o.udid, copie]);
  });
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

// Libellés de l'app dans chaque langue (le sélecteur d'iOS, lui, suit la langue
// de l'iPhone). Expressions régulières : « ? » échappé. « Ajouter une photo » :
// repère de Spotter, avec ou sans la dernière vidéo proposée.
const LIBELLES = {
  fr: { PROFIL: "Profil", REGLAGES: "Réglages", RETOUR: "Retour", LANGUE: "Français", CLAIR: "Clair", SOMBRE: "Sombre", SYSTEME: "Système", ACCUEIL: "Ajouter une photo", DERNIERE: "Votre dernière vidéo", DESCRIPTION: "veste en daim marron", LANCER: "Lancer", CONSENTEMENT: "Analyse automatique de la vidéo", ACCEPTER: "Accepter", ATTENTE: "Spotto parcourt les boutiques…", MEILLEURE: "Meilleure proposition", PAS_LA_BONNE: "Ce n'est pas la bonne pièce \\?", ESSAYER2: "Essayer un autre moment \\(2 restants\\)", FERMER: "Fermer" },
  en: { PROFIL: "Profile", REGLAGES: "Settings", RETOUR: "Back", LANGUE: "English", CLAIR: "Light", SOMBRE: "Dark", SYSTEME: "System", ACCUEIL: "Add a photo", DERNIERE: "Your latest video", DESCRIPTION: "brown suede jacket", LANCER: "Search", CONSENTEMENT: "Automatic video analysis", ACCEPTER: "Accept", ATTENTE: "Spotto is browsing the boutiques…", MEILLEURE: "Best suggestion", PAS_LA_BONNE: "Not the right piece\\?", ESSAYER2: "Try another moment \\(2 left\\)", FERMER: "Close" },
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
  etape(o, "06-reglages-combinaison", { PROFIL: avant.PROFIL, REGLAGES: avant.REGLAGES, LANGUE: apres.LANGUE, THEME: apres[theme], RETOUR: apres.RETOUR, IMPORTER: apres.ACCUEIL, PREFIXE: prefixe });
}

/** En thème clair, l'heure en haut de l'écran doit être sombre (lisible). Défaut
 * corrigé au lot 4 ter : après une recherche, elle restait blanche sur
 * l'écran des résultats (barre de l'écran d'attente, sombre). Zone de l'heure
 * d'une capture d'iPhone 17 Pro (1206 × 2622). */
async function heureLisible(o: Outils, capture: string): Promise<void> {
  const { data } = await sharp(join(o.sortie, capture)).extract({ left: 120, top: 50, width: 220, height: 90 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const plusSombre = data.reduce((min, valeur) => Math.min(min, valeur), 255);
  if (plusSombre > 110) throw new Error(`${capture} : heure illisible en haut de l'écran (pixel le plus sombre : ${plusSombre} sur 255)`);
}

/** Premier usage de l'analyse automatique (accord jamais donné) : l'accord du compte de test est effacé (spotto-dev). */
async function oublierAccordIa(o: Outils, compte: Compte): Promise<void> {
  const { error } = await o.admin.from("consents").delete().eq("user_id", compte.id).eq("type", "analyse_video_ia");
  if (error) throw new Error(`Accord de test impossible à effacer : ${error.message}`);
}

const ACCORD = z.array(z.object({ granted_at: z.string().nullable(), revoked_at: z.string().nullable() }));

async function accordsIa(o: Outils, compte: Compte): Promise<z.infer<typeof ACCORD>> {
  const lus = await o.admin.from("consents").select("granted_at, revoked_at").eq("user_id", compte.id).eq("type", "analyse_video_ia");
  if (lus.error) throw new Error(`Accords illisibles : ${lus.error.message}`);
  return ACCORD.parse(lus.data);
}

/** Ce que les simulations ont vu et ce qui a été enregistré (spotto-dev) — jamais le contenu des images. */
async function verifierParcoursUnique(o: Outils, compte: Compte): Promise<void> {
  const analyses = o.simulation().filter((ligne) => /^\[simulation Anthropic\] 3 image\(s\), 3 moment\(s\), plan reconnu : oui/.test(ligne)).length;
  // Par combinaison : premier usage et relance ; puis une autre vidéo.
  if (analyses < 2 * COMBINAISONS.length + 1) throw new Error(`Analyses simulées avec le plan « Veste » reconnu : ${analyses}`);
  const lues = await o.admin.from("product_searches").select("source_platform, status").eq("user_id", compte.id);
  if (lues.error) throw new Error(`Recherches illisibles : ${lues.error.message}`);
  const recherches = z.array(z.object({ source_platform: z.string(), status: z.string() })).parse(lues.data);
  const abouties = recherches.filter((r) => r.source_platform === "photo" && r.status === "completed").length;
  // 2 par combinaison, une autre vidéo, une photo ; replis et refus : aucune recherche, donc aucun crédit.
  if (abouties !== 2 * COMBINAISONS.length + 2 || recherches.length !== abouties) {
    throw new Error(`Recherches inattendues : ${abouties} abouties sur ${recherches.length} (attendu : ${2 * COMBINAISONS.length + 2})`);
  }
  const refus = await accordsIa(o, compte);
  if (refus.length !== 1 || refus[0]!.granted_at !== null) throw new Error(`Refus non enregistré : ${JSON.stringify(refus)}`);
  log(`  analyses simulées : ${analyses} avec le bon plan ; identifications abouties (SerpApi simulée) : ${abouties} ; replis et refus : aucune recherche ; refus enregistré`);
}

/** Lot 4 ter : parcours unique sur l'app iPhone, dans les 4 combinaisons — la
 * dernière vidéo de la galerie proposée sur Spotter (option : question posée
 * une fois, accès demandé par iOS seulement après « oui »), quelques mots,
 * « Lancer ». Puis un autre compte répond « Non merci ». IA et SerpApi
 * simulées : aucun appel réel. */
async function parcoursUnique(o: Outils): Promise<void> {
  const louise = await o.creerCompte("u", "Louise (test)");
  const camille = await o.creerCompte("n", "Camille (test)");
  await photosSimulateur(o);
  const videos = await genererVideosEssai();
  try {
    // D'abord, la plus récente est la vidéo de 65 s : refus annoncé sur la carte.
    ajouterVideos(o, [videos.hevc, videos.courte, videos.longue]);
    // Accès aux photos remis à zéro AVANT la première ouverture de Spotter :
    // la question doit venir sans aucune demande d'iOS.
    o.xcrun(["simctl", "privacy", o.udid, "reset", "photos", BUNDLE_ID]);
    await connecter(o, louise, LIBELLES.fr.ACCUEIL);
    etape(o, "13-galerie-accord", { DERNIERE: LIBELLES.fr.DERNIERE });
    // Puis la vidéo de 12 s devient la plus récente (relue au retour sur Spotter).
    ajouterVideos(o, [videos.courte]);
  } finally {
    rmSync(videos.dossier, { recursive: true, force: true });
  }
  let courante: "fr" | "en" = "fr";
  for (const combo of COMBINAISONS) {
    await oublierAccordIa(o, louise);
    regler(o, courante, combo.langue, combo.theme, combo.id);
    courante = combo.langue;
    const l = LIBELLES[combo.langue];
    etape(o, "14-derniere-video", { ...l, PREFIXE: combo.id });
    if (combo.theme === "CLAIR") for (const capture of ["06-resultats", "08-relance-resultats"]) await heureLisible(o, `${combo.id}-${capture}.png`);
    const accords = await accordsIa(o, louise);
    if (!accords.some((a) => a.granted_at !== null)) throw new Error(`${combo.id} : accord non enregistré`);
  }
  regler(o, courante, "fr", "SYSTEME", "fr-systeme");
  etape(o, "15-autre-video-photo");
  etape(o, "16-replis");
  await oublierAccordIa(o, louise);
  etape(o, "17-refus");
  await verifierParcoursUnique(o, louise);
  // « Non merci » (autre compte) : refus sans conséquence, puis option réactivée dans Réglages.
  await connecter(o, camille, LIBELLES.fr.ACCUEIL);
  etape(o, "19-derniere-video-non");
}

/** Attentes avant une relance (secondes) : le serveur local reste inactif plus ou moins longtemps. */
const ATTENTES = [0, 10, 25, 45] as const;

/** Lot 4 ter, décision 5 : la session survit-elle aux relances ? `n` relances
 * contrôlées (Spotter ou accueil), avec les réponses du serveur local (codes
 * seulement) et la présence de la session rangée sur le simulateur. Toutes les
 * 5 relances, connexion fraîche par le lien juste avant, comme lors de
 * l'incident du 2026-10-07. Avec `panne` : coupure simulée de 1,5 s entre le
 * serveur local et Supabase Auth juste avant chaque relance. */
async function relancesSession(o: Outils, panne: boolean): Promise<void> {
  const n = Math.max(1, Number(process.argv[3] ?? 20) || 20);
  const compte = await o.creerCompte("r", "Relance (test)");
  await connecter(o, compte, LIBELLES.fr.ACCUEIL);
  const lignes: string[] = [];
  let perdues = 0;
  for (let i = 1; i <= n; i += 1) {
    const frais = i % 5 === 0;
    if (frais) {
      o.ouvrirLien(await o.lienSession(compte));
      etape(o, "01-nouveau-mot-de-passe");
    }
    const attente = frais ? 0 : ATTENTES[i % ATTENTES.length]!;
    await new Promise((resolve) => setTimeout(resolve, attente * 1000));
    const avant = o.reponsesServeur().length;
    if (panne) o.declencherPanneAuth();
    log(`→ relance ${i}/${n}${frais ? " (juste après une connexion par le lien)" : ` (après ${attente} s)`}`);
    o.relancerApp();
    const essai = essaiMaestro(o.udid, join(FLOWS, "18-relance-controle.yaml"), o.sortie, { ACCUEIL: LIBELLES.fr.ACCUEIL, CAPTURE: `relance-${String(i).padStart(2, "0")}` });
    const reponses = o.reponsesServeur().slice(avant).filter((r) => r.chemin === "/api/me" || r.chemin === "/api/consents");
    const stockee = o.sessionStockee();
    const codes = reponses.map((r) => `${r.chemin} ${r.code} (${r.dureeMs} ms)`).join(" ; ") || "—";
    lignes.push(`| ${i} | ${frais ? "lien, puis relance" : `${attente} s`} | ${essai.ok ? "Spotter" : "**accueil**"} | ${stockee ? "oui" : "**non**"} | ${codes} |`);
    if (!essai.ok) {
      perdues += 1;
      log(`  ⚠ session perdue (session rangée sur le simulateur : ${stockee ? "oui" : "non"}) — reconnexion pour continuer`);
      await connecter(o, compte, LIBELLES.fr.ACCUEIL);
    }
  }
  const titre = panne ? "avec coupure simulée de 1,5 s vers Supabase Auth avant chaque relance" : "conditions réelles";
  const rapport = [
    `# Relances de l'app iPhone — ${titre}`,
    "",
    `${n} relances, ${perdues} session(s) perdue(s). Serveur local et spotto-dev ; captures relance-NN.png.`,
    "",
    "| Relance | Avant | Écran | Session rangée | Réponses du serveur (/api/me, /api/consents) |",
    "|---|---|---|---|---|",
    ...lignes,
    "",
  ].join("\n");
  writeFileSync(join(o.sortie, "relances.md"), rapport);
  log(`  ${perdues} session(s) perdue(s) sur ${n} relances — rapport : relances.md`);
}

const SCENARIOS: Record<string, { run: (o: Outils) => Promise<void>; sortie: string; iaSimulee?: boolean; serpapiSimule?: boolean; panneAuth?: boolean; sentry?: boolean }> = {
  // « natif » envoie volontairement une erreur de test à Sentry (région UE) : seul scénario avec Sentry.
  natif: { run: natif, sortie: "lot-3bis-captures", sentry: true },
  preparer: { run: attendreExploration, sortie: "lot-3bis-captures" },
  "parcours-unique": { run: parcoursUnique, sortie: "lot-4-ter-iphone-captures", iaSimulee: true, serpapiSimule: true },
  "relance-session": { run: (o) => relancesSession(o, false), sortie: "lot-4-ter-relances" },
  "relance-session-panne": { run: (o) => relancesSession(o, true), sortie: "lot-4-ter-relances-panne", panneAuth: true },
};

const nom = process.argv[2] ?? "";
const scenario = SCENARIOS[nom];
if (!scenario) {
  console.error(`Indiquez un scénario : ${Object.keys(SCENARIOS).join(", ")}.`);
  process.exit(1);
}
lancerParcours(scenario.sortie, scenario.run, { iaSimulee: scenario.iaSimulee === true, serpapiSimule: scenario.serpapiSimule === true, panneAuth: scenario.panneAuth === true, sentry: scenario.sentry === true }).catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
