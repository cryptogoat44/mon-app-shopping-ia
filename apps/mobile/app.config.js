// Configuration Expo de l'app : app.json, complété par le fichier unique de la
// marque, packages/shared-types/marque.json (voir MARQUE.md à la racine du dépôt).
//
// Le nom du produit CHANGERA : rien de ce qui en dépend n'est écrit dans
// app.json ni dans locales/*.json. À la place, un repère entre accolades
// désigne une ligne de marque.json :
//   {nom}                          nom montré aux personnes (sous l'icône,
//                                  feuille de partage, phrases d'autorisation)
//   {slugExpo}                     nom du projet chez Expo
//   {schemaLiens}                  schéma des liens qui ouvrent l'app
//   {identifiantApple}             identifiant de l'app chez Apple
//   {groupeApple}                  groupe d'apps (app + extension de partage)
//   {identifiantExtensionPartage}  identifiant de l'extension de partage
// Ce fichier remplace chaque repère par sa valeur. C'est le mécanisme prévu
// par Expo : quand app.config.js exporte une fonction, Expo lui remet le
// contenu d'app.json (« config ») et utilise ce qu'elle renvoie.
//
// Les textes d'iOS traduits (locales/fr.json, locales/en.json) sont lus ici et
// remis à Expo déjà complétés, à la place du chemin des fichiers : Expo accepte
// les deux formes, et l'app construite est la même.
//
// Vérifié par tests/marque.test.ts : avec les valeurs d'aujourd'hui, la
// configuration obtenue est exactement celle d'avant ce lot.
const fs = require("node:fs");
const path = require("node:path");

const lireJson = (chemin) => JSON.parse(fs.readFileSync(path.join(__dirname, chemin), "utf8"));

/** Remplace, partout dans `valeur`, chaque repère « {ligne} » par la ligne de marque.json du même nom. */
function completer(valeur, marque) {
  if (typeof valeur === "string") {
    return valeur.replace(/\{([A-Za-z]+)\}/g, (repere, ligne) => (typeof marque[ligne] === "string" ? marque[ligne] : repere));
  }
  if (Array.isArray(valeur)) return valeur.map((element) => completer(element, marque));
  if (valeur !== null && typeof valeur === "object") {
    // Sur place : l'ordre des réglages et les marques internes d'Expo sont gardés.
    for (const cle of Object.keys(valeur)) valeur[cle] = completer(valeur[cle], marque);
  }
  return valeur;
}

module.exports = ({ config }) => {
  const marque = lireJson("../../packages/shared-types/marque.json");
  const locales = {};
  for (const [langue, textes] of Object.entries(config.locales ?? {})) {
    locales[langue] = typeof textes === "string" ? lireJson(textes) : textes;
  }
  if (config.locales) config.locales = locales;
  return completer(config, marque);
};

module.exports.completer = completer;
