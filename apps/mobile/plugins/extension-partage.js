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
// Les deux retouches sont testées sur les fichiers que produit le module
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
      return config;
    },
  ]);
}

module.exports = withExtensionPartage;
module.exports.nommer = nommer;
module.exports.declarerGroupe = declarerGroupe;
