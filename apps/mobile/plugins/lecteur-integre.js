// Lecteur intégré (mission « liens vidéo ») : le module natif local de
// l'instantané (modules/spotto-player-snapshot, « Spotter ce moment ») n'est
// relié à l'app que si au moins un des deux lecteurs est dans le build.
//
// Options du build, même règle que src/lib/features.ts : allumées sauf valeur
// exacte « false » de EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER et
// EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER (fichier .env, réglages du build EAS).
//
// Pourquoi un plugin, et pas app.config.js : expo-modules-autolinking
// (57.0.13, build/commands/autolinkingOptions.js) ne lit ses réglages
// (`exclude`…) que dans package.json (« expo.autolinking », valeur fixe) ou
// dans les arguments de la commande ; il ne lit jamais la configuration de
// l'app. Les arguments, c'est le Podfile qui les donne :
// `use_expo_modules!(exclude: [...])` (scripts/ios/autolinking_manager.rb,
// base_command_args → « --exclude »), repris par la liste des modules, par
// ExpoModulesProvider.swift et par l'étape de build qui le régénère. Le
// dossier ios/ étant regénéré à chaque build (prebuild), ce plugin réécrit
// cette ligne du Podfile quand les deux lecteurs sont coupés. Ligne
// introuvable : le build s'arrête (jamais un module relié sans le vouloir).
// Vérifié sans Xcode par tests/lecteur-integre-config.test.ts.
const { withPodfile } = require("expo/config-plugins");

/** Nom du module local pour l'autolinking : le nom de son dossier (sans package.json). */
const MODULE = "spotto-player-snapshot";

/** Règle de lecture d'une option : allumée sauf valeur exacte « false ». */
function optionAllumee(valeur) {
  return valeur !== "false";
}

/** Les deux lecteurs du build, d'après l'environnement. */
function lecteursDuBuild(env) {
  return {
    tiktokPlayer: optionAllumee(env.EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER),
    instagramPlayer: optionAllumee(env.EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER),
  };
}

/** Le module de l'instantané est relié dès qu'un lecteur est dans le build. */
function moduleRelie(env) {
  const lecteurs = lecteursDuBuild(env);
  return lecteurs.tiktokPlayer || lecteurs.instagramPlayer;
}

const USE_EXPO_MODULES = /^([ \t]*)use_expo_modules!(?:[ \t]*\([ \t]*\))?[ \t]*$/m;

/** Podfile où le module est exclu de l'autolinking. */
function exclureDuPodfile(contenu) {
  if (contenu.includes(`use_expo_modules!(exclude: ['${MODULE}'])`)) return contenu;
  if (!USE_EXPO_MODULES.test(contenu)) {
    throw new Error("plugins/lecteur-integre.js : ligne « use_expo_modules! » introuvable dans le Podfile ; le module de l'instantané ne peut pas être exclu.");
  }
  return contenu.replace(USE_EXPO_MODULES, `$1use_expo_modules!(exclude: ['${MODULE}'])`);
}

function withLecteurIntegre(config) {
  if (moduleRelie(process.env)) return config;
  return withPodfile(config, (etape) => {
    etape.modResults.contents = exclureDuPodfile(etape.modResults.contents);
    return etape;
  });
}

module.exports = withLecteurIntegre;
module.exports.MODULE = MODULE;
module.exports.lecteursDuBuild = lecteursDuBuild;
module.exports.moduleRelie = moduleRelie;
module.exports.exclureDuPodfile = exclureDuPodfile;
