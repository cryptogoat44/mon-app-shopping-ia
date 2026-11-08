// Extension de partage d'iOS (lot « partager vers Spotto »), créée par
// expo-share-intent ; deux retouches, faites une fois tous ses fichiers écrits
// (modification « finale », qui passe après la sienne quel que soit l'ordre
// dans app.json) :
// - le nom affiché dans la feuille de partage : « Spotto ». L'option
//   iosShareExtensionName du module nomme AUSSI la cible Xcode, et « Spotto »
//   y entrerait en conflit avec la cible de l'app : on garde sa cible
//   « ShareExtension » et on ne change que le nom vu par la personne ;
// - le manifeste de confidentialité : l'extension écrit dans les réglages
//   partagés du groupe d'apps, motif « 1C8F.1 » chez Apple (le module ne
//   déclare que « CA92.1 », réglages propres à l'app).
// - le contrôleur de l'extension (lot « app iPhone prête », point 12, repli
//   du partage) : l'adresse d'ouverture est aussi déposée dans le fichier
//   « partage-en-attente.txt » du groupe d'apps, que l'app relit quand on
//   l'ouvre à la main si iOS ne l'a pas rouverte (src/lib/share-intake.ts) ;
//   et le message d'échec, en anglais technique seulement, devient une phrase
//   claire en français ou en anglais (langue de l'iPhone).
// Les retouches sont testées sur les fichiers que produit le module
// (tests/share-config.test.ts).
const fs = require("node:fs");
const path = require("node:path");
const { withFinalizedMod } = require("expo/config-plugins");

const DOSSIER = "ShareExtension";
const NOM_AFFICHE = /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/;
const MOTIF_APP = /([ \t]*)<string>CA92\.1<\/string>/;
const MOTIF_GROUPE = "1C8F.1";

const echapper = (texte) => texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Info.plist de l'extension avec le nom affiché voulu ; null si son format a changé. */
function nommer(infoPlist, nom) {
  if (!NOM_AFFICHE.test(infoPlist)) return null;
  return infoPlist.replace(NOM_AFFICHE, (_, debut, fin) => `${debut}${echapper(nom)}${fin}`);
}

/** Manifeste de l'extension avec le motif « groupe d'apps » ; null si son format a changé. */
function declarerGroupe(manifeste) {
  if (manifeste.includes(`<string>${MOTIF_GROUPE}</string>`)) return manifeste;
  if (!MOTIF_APP.test(manifeste)) return null;
  return manifeste.replace(MOTIF_APP, (ligne, retrait) => `${ligne}\n${retrait}<string>${MOTIF_GROUPE}</string>`);
}

/** Fichier du groupe d'apps lu par l'app (src/lib/shared-item.ts, PENDING_SHARE_FILE). */
const FICHIER_EN_ATTENTE = "partage-en-attente.txt";
const LIGNE_ADRESSE = 'let url = URL(string: "\\(shareProtocol)://dataUrl=\\(sharedKey)?nonce=\\(nonce)#\\(type)")!';
const ALERTE_ANGLAISE = 'title: "Error", message: "Error loading application: \\(message!)", preferredStyle: .alert)';
const MESSAGE_FR = "Spotto n’a pas pu s’ouvrir. Ouvrez Spotto : si votre partage n’y est pas, partagez-le à nouveau.";
const MESSAGE_EN = "Spotto couldn’t open. Open Spotto: if your share isn’t there, share it again.";

/** Contrôleur de l'extension avec le repli et le message traduit ; null si son format a changé. */
function retoucherControleur(swift) {
  if (swift.includes(FICHIER_EN_ATTENTE)) return swift;
  const debut = swift.indexOf(LIGNE_ADRESSE);
  if (debut === -1 || swift.indexOf(LIGNE_ADRESSE, debut + 1) !== -1 || !swift.includes(ALERTE_ANGLAISE)) return null;
  const finLigne = debut + LIGNE_ADRESSE.length;
  const retrait = swift.slice(swift.lastIndexOf("\n", debut) + 1, debut);
  const depot = [
    "",
    "// Spotto (repli du partage) : l'adresse est aussi déposée dans le groupe d'apps ;",
    "// si iOS ne rouvre pas Spotto, l'app la relit quand on l'ouvre à la main.",
    "if let dossier = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: hostAppGroupIdentifier) {",
    `  _ = try? url.absoluteString.write(to: dossier.appendingPathComponent("${FICHIER_EN_ATTENTE}"), atomically: true, encoding: .utf8)`,
    "}",
  ].join(`\n${retrait}`);
  const avecDepot = swift.slice(0, finLigne) + depot + swift.slice(finLigne);
  const alerte = `title: "Spotto", message: Locale.preferredLanguages.first?.hasPrefix("fr") == true ? "${MESSAGE_FR}" : "${MESSAGE_EN}", preferredStyle: .alert)`;
  return avecDepot.replace(ALERTE_ANGLAISE, alerte);
}

/** Réécrit un fichier de l'extension ; s'arrête si le module a changé de format, plutôt que livrer une extension fausse. */
function retoucher(racine, fichier, modifier) {
  const chemin = path.join(racine, DOSSIER, fichier);
  const modifie = modifier(fs.readFileSync(chemin, "utf8"));
  if (modifie === null) throw new Error(`[extension-partage] format inattendu : ${DOSSIER}/${fichier}`);
  fs.writeFileSync(chemin, modifie);
}

function withExtensionPartage(config) {
  return withFinalizedMod(config, [
    "ios",
    async (config) => {
      const racine = config.modRequest.platformProjectRoot;
      retoucher(racine, "ShareExtension-Info.plist", (contenu) => nommer(contenu, config.name));
      retoucher(racine, "PrivacyInfo.xcprivacy", declarerGroupe);
      retoucher(racine, "ShareViewController.swift", retoucherControleur);
      return config;
    },
  ]);
}

module.exports = withExtensionPartage;
module.exports.nommer = nommer;
module.exports.declarerGroupe = declarerGroupe;
module.exports.retoucherControleur = retoucherControleur;
module.exports.FICHIER_EN_ATTENTE = FICHIER_EN_ATTENTE;
