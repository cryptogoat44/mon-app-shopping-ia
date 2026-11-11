// Nom du produit et identifiants qui en dépendent. Nom de travail — pas encore
// sécurisé juridiquement (marque, .com, App Store) : il CHANGERA.
// Tout est écrit à UN seul endroit, packages/shared-types/marque.json (chaque
// ligne est expliquée dans MARQUE.md, à la racine du dépôt). Ce fichier ne
// fait que le lire pour l'app ; la configuration Expo (app.config.js) et le
// serveur (apps/backend/src/lib/brand.ts) lisent le même fichier. Aucun nom
// n'est écrit en dur ailleurs : un test le vérifie (tests/marque.test.ts).
import { brandFileSlug } from "@monapp/shared-types";
import marque from "@monapp/shared-types/marque.json";

/** Nom du produit, tel qu'il est montré aux personnes (« Spotto »). */
export const APP_NAME_DISPLAY: string = marque.nom;
/** Le même en minuscules : le mot-symbole de l'écran d'accueil (« spotto »). */
export const APP_NAME: string = marque.nom.toLowerCase();
/** Début des noms des fichiers remis à la personne (« spotto-mes-donnees-… »). */
export const APP_FILE_SLUG: string = brandFileSlug(marque.nom);
/** Schéma des liens qui ouvrent l'app (« spotto:// »). */
export const APP_SCHEME: string = marque.schemaLiens;
/** Groupe d'apps partagé entre l'app et son extension de partage (iOS). */
export const APP_GROUP: string = marque.groupeApple;

export const LEGAL_LINKS = {
  terms: null as string | null,
  privacy: null as string | null,
};

// Adresse publique du site : sert aux liens partagés vers une publication
// (Lot F). Sur le web, l'adresse du site en cours est utilisée à la place.
export const PUBLIC_WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? marque.adresseSite;
