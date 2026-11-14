// Recherche d'image d'iOS (« Visual Intelligence », iOS 26) — mission « liens
// vidéo », étape 7. Le dossier ios/ est généré à chaque compilation : ce
// plugin y ajoute, dans la cible principale de l'app, le fichier Swift
// plugins/recherche-image/SpottoRechercheImage.swift (la requête appelée par
// iOS avec l'image d'une capture, et l'ouverture de l'app), et écrit dans
// Info.plist le groupe d'apps et le schéma des liens que ce Swift relit.
//
// Dans app.json :
//   ["./plugins/recherche-image.js", { "groupe": "{groupeApple}", "schema": "{schemaLiens}" }]
// Les deux valeurs viennent du fichier unique de la marque (app.config.js les
// complète) : rien n'est figé ici.
//
// Le groupe d'apps lui-même (droit « application-groups » de l'app) est déjà
// posé par l'extension de partage (expo-share-intent).
// Les retouches sont testées sans Xcode (tests/recherche-image-config.test.ts).
const fs = require("node:fs");
const path = require("node:path");
const { withInfoPlist, withXcodeProject, withDangerousMod, IOSConfig } = require("expo/config-plugins");

/** Le fichier Swift ajouté à la cible principale. */
const FICHIER = "SpottoRechercheImage.swift";
const SOURCE = path.join(__dirname, "recherche-image", FICHIER);
/** Clés d'Info.plist relues par le Swift. */
const CLE_GROUPE = "SpottoAppGroup";
const CLE_SCHEMA = "SpottoScheme";

/** Vérifie les deux réglages ; une valeur absente ou restée entre accolades arrête la compilation. */
function reglages(props) {
  const { groupe, schema } = props ?? {};
  for (const [nom, valeur] of [
    ["groupe", groupe],
    ["schema", schema],
  ]) {
    if (typeof valeur !== "string" || valeur === "" || /[{}]/.test(valeur)) {
      throw new Error(`plugins/recherche-image.js : réglage « ${nom} » absent (attendu dans app.json, complété par app.config.js).`);
    }
  }
  return { groupe, schema };
}

/** Info.plist avec les deux clés relues par le Swift. */
function completerInfoPlist(infoPlist, { groupe, schema }) {
  return { ...infoPlist, [CLE_GROUPE]: groupe, [CLE_SCHEMA]: schema };
}

function withRechercheImage(config, props) {
  const valeurs = reglages(props);

  config = withInfoPlist(config, (etape) => {
    etape.modResults = completerInfoPlist(etape.modResults, valeurs);
    return etape;
  });

  // Le fichier Swift est copié dans le dossier de l'app…
  config = withDangerousMod(config, [
    "ios",
    (etape) => {
      const nom = IOSConfig.XcodeUtils.getProjectName(etape.modRequest.projectRoot);
      fs.copyFileSync(SOURCE, path.join(etape.modRequest.platformProjectRoot, nom, FICHIER));
      return etape;
    },
  ]);

  // … puis inscrit parmi les sources de la cible principale (une seule fois).
  config = withXcodeProject(config, (etape) => {
    const nom = IOSConfig.XcodeUtils.getProjectName(etape.modRequest.projectRoot);
    const chemin = path.join(nom, FICHIER);
    if (!etape.modResults.hasFile(chemin)) {
      etape.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: chemin, groupName: nom, project: etape.modResults });
    }
    return etape;
  });

  return config;
}

module.exports = withRechercheImage;
module.exports.FICHIER = FICHIER;
module.exports.SOURCE = SOURCE;
module.exports.CLE_GROUPE = CLE_GROUPE;
module.exports.CLE_SCHEMA = CLE_SCHEMA;
module.exports.reglages = reglages;
module.exports.completerInfoPlist = completerInfoPlist;
