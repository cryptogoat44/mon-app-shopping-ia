// Contrôle à lancer à la main (jamais par la CI), version de la branche de
// l'app iPhone avec l'essayage virtuel photo (feature/essayage-virtuel-mobile,
// jamais fusionnée). Ici, l'essayage est ATTENDU dans l'app iPhone : ce
// script compile, comme pour un vrai build, le paquet JavaScript de l'app
// iPhone et celui du site, puis cherche dans chacun les traces de l'essayage :
// - paquet iPhone : toutes les traces attendues (contrôle positif), plus
//   celles des écrans propres à l'iPhone (photo, fichiers temporaires,
//   enregistrement dans Photos) : le paquet soumis à Apple contient bien la
//   fonction décrite dans les notes pour la validation ;
// - paquet du site : toutes les traces attendues, aucune trace propre à
//   l'iPhone (le site ne reçoit jamais le code de l'iPhone), aucune trace dans
//   les pages HTML rendues à l'avance (rien ne s'affiche avant la réponse du
//   serveur) ;
// - dans les deux : aucune adresse de FASHN (l'app et le site n'appellent que
//   notre serveur, la clé reste sur le serveur).
// Rien n'est contacté : compilation hors ligne, avec les adresses publiques
// factices de la CI (.github/workflows/verifications.yml). Les paquets sont
// écrits dans un dossier temporaire hors du dépôt, effacé à la fin.
//
// Usage, depuis apps/mobile (compter 3 à 5 minutes) :
//   node scripts/verifier-essayage-paquets.js
//   node scripts/verifier-essayage-paquets.js --garder   (garde les paquets, affiche leur dossier)
// Code de sortie : 0 si tout est conforme, 1 sinon.
//
// Sur la branche principale, la version de ce script attend au contraire un
// paquet iPhone sans aucune trace (règle 2.5.19 d'Apple : pas de fonction
// cachée ou dormante dans l'app soumise).
// Sans dépendance : seulement les modules de Node (et Expo, lancé par npx).
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MOBILE = path.join(__dirname, "..");

/** Adresses publiques exigées par l'app pour compiler (celles de la CI) : rien n'est contacté. */
const ENV_FACTICE = {
  EXPO_PUBLIC_API_URL: "http://localhost:3000",
  EXPO_PUBLIC_SUPABASE_URL: "https://sedfepcpmhilaxbrgdif.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_factice-ci",
};

/** Traces de l'essayage, cherchées telles quelles (casse comprise : « tryOn »
 * se cache dans des noms de bibliothèques, comme « RegistryOnAndroid »).
 * « tryon » et « Tryon » seuls : un nom de fonction ou une valeur ; aucune
 * bibliothèque du paquet iPhone ne les contient (vérifié le 14 novembre 2026
 * sur l'export iPhone de la branche principale : 0 et 0), ils ne viennent
 * donc ici que de l'essayage. */
const MARQUEURS = ["/api/tryon", "essayage", "Essayage", "FASHN", "tryon_", "attestSelf", "try-on", "tryon", "Tryon"];
/** Traces des modules propres à l'iPhone : des noms exportés, gardés par la
 * compilation (ce sont des noms de propriétés). Attendues dans le paquet
 * iPhone, jamais dans le site (vérifié le 14 novembre 2026 sur l'export
 * iPhone : 2, 2, 3 et 6). */
const MARQUEURS_IPHONE = ["pickTryonPhoto", "saveImageToPhotos", "sweepTryonFiles", "tryonIphoneText"];
/** Interdits partout : une adresse de FASHN. */
const INTERDITS = [/fashn\.ai/gi];

/** Tous les fichiers d'un dossier dont le nom finit par `extension`. */
function fichiers(dossier, extension) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) return fichiers(chemin, extension);
    return entree.name.endsWith(extension) ? [chemin] : [];
  });
}

function occurrences(textes, marqueur) {
  return textes.reduce((total, texte) => total + texte.split(marqueur).length - 1, 0);
}

function interdits(textes) {
  return INTERDITS.reduce((total, motif) => total + textes.reduce((n, texte) => n + (texte.match(motif) || []).length, 0), 0);
}

/** Compile le paquet d'une plateforme (comme `expo export`), hors ligne. */
function exporter(plateforme, dossier) {
  const options = ["expo", "export", "--platform", plateforme, "--clear", "--output-dir", dossier];
  // iPhone : JavaScript lisible plutôt que le bytecode Hermes, pour y chercher.
  if (plateforme === "ios") options.push("--no-bytecode");
  console.log(`\n— Compilation du paquet ${plateforme === "ios" ? "iPhone" : "du site"}…`);
  execFileSync("npx", options, {
    cwd: MOBILE,
    stdio: "inherit",
    env: { ...process.env, ...ENV_FACTICE, EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1", CI: "1" },
  });
}

/** Ce que contient un paquet compilé : fichiers JavaScript (et pages HTML pour le site). */
function analyser(dossier) {
  const js = fichiers(path.join(dossier, "_expo", "static", "js"), ".js").map((fichier) => fs.readFileSync(fichier, "utf8"));
  const html = fichiers(dossier, ".html").map((fichier) => fs.readFileSync(fichier, "utf8"));
  return {
    fichiersJs: js.length,
    pagesHtml: html.length,
    marqueurs: Object.fromEntries(MARQUEURS.map((marqueur) => [marqueur, occurrences(js, marqueur)])),
    marqueursIphone: Object.fromEntries(MARQUEURS_IPHONE.map((marqueur) => [marqueur, occurrences(js, marqueur)])),
    marqueursHtml: MARQUEURS.reduce((total, marqueur) => total + occurrences(html, marqueur), 0),
    interdits: interdits([...js, ...html]),
  };
}

function afficher(titre, resultat) {
  console.log(`\n${titre} : ${resultat.fichiersJs} fichier(s) JavaScript${resultat.pagesHtml ? `, ${resultat.pagesHtml} page(s) HTML` : ""}`);
  for (const [marqueur, nombre] of Object.entries(resultat.marqueurs)) console.log(`  « ${marqueur} » : ${nombre}`);
  for (const [marqueur, nombre] of Object.entries(resultat.marqueursIphone)) console.log(`  « ${marqueur} » (iPhone seulement) : ${nombre}`);
  if (resultat.pagesHtml) console.log(`  traces dans les pages HTML : ${resultat.marqueursHtml}`);
  console.log(`  adresse de FASHN : ${resultat.interdits}`);
}

/** Les écarts à la règle de cette branche ; vide si tout est conforme. */
function ecarts(ios, site) {
  const liste = [];
  if (ios.fichiersJs === 0) liste.push("paquet iPhone : aucun fichier JavaScript produit");
  if (site.fichiersJs === 0) liste.push("site : aucun fichier JavaScript produit");
  for (const [marqueur, nombre] of Object.entries(ios.marqueurs)) if (nombre === 0) liste.push(`paquet iPhone : « ${marqueur} » absent (contrôle positif en échec)`);
  for (const [marqueur, nombre] of Object.entries(ios.marqueursIphone)) if (nombre === 0) liste.push(`paquet iPhone : « ${marqueur} » absent (écrans de l'iPhone manquants)`);
  for (const [marqueur, nombre] of Object.entries(site.marqueurs)) if (nombre === 0) liste.push(`site : « ${marqueur} » absent (contrôle positif en échec)`);
  for (const [marqueur, nombre] of Object.entries(site.marqueursIphone)) if (nombre > 0) liste.push(`site : « ${marqueur} » trouvé ${nombre} fois (code de l'iPhone dans le site)`);
  if (site.marqueursHtml > 0) liste.push(`site : ${site.marqueursHtml} trace(s) dans les pages HTML rendues à l'avance`);
  if (ios.interdits > 0) liste.push("paquet iPhone : adresse de FASHN trouvée");
  if (site.interdits > 0) liste.push("site : adresse de FASHN trouvée");
  return liste;
}

function main() {
  const garder = process.argv.includes("--garder");
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "verif-essayage-"));
  try {
    exporter("ios", path.join(dossier, "ios"));
    exporter("web", path.join(dossier, "web"));
    const ios = analyser(path.join(dossier, "ios"));
    const site = analyser(path.join(dossier, "web"));
    afficher("Paquet iPhone (toutes les traces attendues, écrans de l'iPhone compris)", ios);
    afficher("Site (traces attendues dans le JavaScript, aucune propre à l'iPhone)", site);
    const liste = ecarts(ios, site);
    if (liste.length > 0) {
      console.error("\nNON CONFORME :");
      for (const ecart of liste) console.error(`  - ${ecart}`);
      process.exitCode = 1;
    } else {
      console.log("\nConforme : l'essayage est dans le paquet iPhone et dans le site, le code de l'iPhone seulement dans l'iPhone, aucune adresse de FASHN.");
    }
  } finally {
    if (garder) console.log(`\nPaquets gardés dans : ${dossier}`);
    else fs.rmSync(dossier, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Erreur inattendue.");
    process.exitCode = 1;
  }
}

module.exports = { MARQUEURS, MARQUEURS_IPHONE, analyser, ecarts };
