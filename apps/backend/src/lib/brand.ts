// Nom du produit, vu du serveur (lot « nom et identifiants configurables »).
// Le nom de travail CHANGERA : il est écrit à UN seul endroit,
// packages/shared-types/marque.json (chaque ligne est expliquée dans MARQUE.md,
// à la racine du dépôt) ; l'app et la configuration Expo lisent le même
// fichier. Aucun message, titre de notification ni texte de l'export n'écrit
// le nom en dur : un test le vérifie (tests/marque.test.ts).
import { brandFileSlug } from "@monapp/shared-types";
import marque from "@monapp/shared-types/marque.json" with { type: "json" };

/** Nom du produit, tel qu'il est montré aux personnes (« Spotto »). */
export const BRAND: string = marque.nom;
/** Début des noms des fichiers remis à la personne (« spotto-mes-donnees-… »). */
export const BRAND_FILE_SLUG: string = brandFileSlug(marque.nom);
/** Le nom dans un en-tête HTTP (identité annoncée aux boutiques, « Spotto/1.0 ») :
 * lettres et chiffres sans accent, les seuls signes sûrs à cet endroit. */
export const BRAND_HTTP_TOKEN: string =
  marque.nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "") || "App";
/** Adresse publique du site (la même que PUBLIC_WEB_URL dans l'app). */
export const PUBLIC_SITE_URL: string = marque.adresseSite;
/** Adresse du serveur de production (EXPO_PUBLIC_API_URL du site et des
 * builds destinés à Apple ; vérifiée par apps/mobile/scripts/verifier-build.js
 * et par le garde-fou de render-bride). */
export const PRODUCTION_API_URL: string = marque.adresseServeur;
