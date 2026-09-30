import type { Locale } from "./locale.js";
import { COMMENT_MAX_LENGTH } from "@monapp/shared-types";
import { RATE_LIMITED_MESSAGE } from "../plugins/rateLimit.js";

// Messages d'erreur renvoyés à l'app, dans la langue de l'utilisateur (lot 3).
// Les routes écrivent leurs messages en français ; juste avant l'envoi, un
// crochet (app.ts) les remplace par leur version anglaise si l'app a demandé
// l'anglais. L'app envoie la langue du profil dans l'en-tête Accept-Language.
// Un test vérifie que chaque message français du serveur a sa traduction.

export const GENERIC_CLIENT_ERROR = "Requête invalide.";
export const GENERIC_SERVER_ERROR = "Une erreur est survenue.";

export const EN_MESSAGES: Readonly<Record<string, string>> = {
  "Action impossible entre ces deux comptes.": "This action isn't possible between these two accounts.",
  "Ce document a été mis à jour. Relisez-le, puis acceptez-le à nouveau.":
    "This document has been updated. Please read it again, then accept it.",
  "Ce nom d'utilisateur est déjà pris.": "This username is already taken.",
  "Cette image n'a pas pu être lue, ou la zone choisie est trop petite.":
    "This image couldn't be read, or the selected area is too small.",
  "Cette image n'est pas autorisée.": "This image isn't allowed.",
  "Cette photo n'a pas pu être lue.": "This photo couldn't be read.",
  "Cette pièce est déjà partagée dans votre fil. Pour changer qui la voit, modifiez la visibilité de cette publication (depuis la publication).":
    "This piece is already shared in your feed. To change who can see it, edit that post's visibility (from the post itself).",
  "Cette recherche a déjà été lancée.": "This search has already been started.",
  "Commentaire introuvable.": "Comment not found.",
  "Commentaire invalide.": "Invalid comment.",
  "Contexte de clic invalide.": "Invalid link context.",
  "Curseur de pagination invalide.": "Invalid pagination cursor.",
  "Données invalides.": "Invalid data.",
  "Envie introuvable.": "Wishlist item not found.",
  "Identifiant invalide.": "Invalid identifier.",
  "Importez une capture de la pièce.": "Please import a screenshot of the piece.",
  "Impossible de se bloquer soi-même.": "You can't block yourself.",
  "Impossible de se suivre soi-même.": "You can't follow yourself.",
  "Jeton d'authentification invalide ou expiré.": "Your session is invalid or has expired.",
  "Jeton d'authentification manquant.": "You are not signed in.",
  "L'envoi de l'image a échoué, réessayez.": "The image couldn't be uploaded. Please try again.",
  "L'envoi de la photo a échoué.": "The photo couldn't be uploaded.",
  "L'export a échoué, réessayez.": "The export failed. Please try again.",
  "L'image de la vidéo n'est plus disponible. Importez une capture de la pièce.":
    "The video's image is no longer available. Please import a screenshot of the piece.",
  "La suppression a échoué.": "Deletion failed.",
  "Le commentaire est vide.": "The comment is empty.",
  [`Le commentaire est trop long (${COMMENT_MAX_LENGTH} caractères maximum).`]: `The comment is too long (${COMMENT_MAX_LENGTH} characters maximum).`,
  "Le fichier doit être une image.": "The file must be an image.",
  "Le fichier est trop volumineux (10 Mo maximum).": "The file is too large (10 MB maximum).",
  "Le texte est trop long (280 caractères maximum).": "The text is too long (280 characters maximum).",
  "Le titre est trop long (120 caractères maximum).": "The title is too long (120 characters maximum).",
  "Lien invalide.": "Invalid link.",
  "Lien marchand introuvable.": "Retailer link not found.",
  "Merci d'envoyer une image.": "Please send an image.",
  "Objet du vault introuvable.": "Vault item not found.",
  "Objet du vault manquant.": "Vault item missing.",
  "Objet introuvable.": "Item not found.",
  "Paramètre de liste invalide.": "Invalid list parameter.",
  "Pièces taguées invalides.": "Invalid tagged pieces.",
  "Produit introuvable.": "Product not found.",
  "Profil introuvable.": "Profile not found.",
  "Publication introuvable.": "Post not found.",
  "Recherche introuvable.": "Search not found.",
  "Requête de recherche invalide.": "Invalid search request.",
  [GENERIC_CLIENT_ERROR]: "Invalid request.",
  "Seul un consentement facultatif peut être refusé ou retiré.": "Only an optional consent can be declined or withdrawn.",
  "Signalement invalide.": "Invalid report.",
  "Titre et catégorie sont obligatoires.": "A title and a category are required.",
  "Type de publication invalide.": "Invalid post type.",
  "Une erreur est survenue, réessayez.": "Something went wrong. Please try again.",
  [GENERIC_SERVER_ERROR]: "Something went wrong.",
  "Une photo est obligatoire.": "A photo is required.",
  "Une pièce taguée est introuvable.": "A tagged piece could not be found.",
  "Visibilité invalide.": "Invalid visibility.",
  "Zone de recadrage invalide.": "Invalid crop area.",
  "Zone de recadrage ou texte invalide.": "Invalid crop area or text.",
  "3 à 20 caractères : lettres minuscules, chiffres, underscore.": "3 to 20 characters: lowercase letters, numbers, underscore.",
  [RATE_LIMITED_MESSAGE]: "Too many attempts in a short time. Please try again in a moment.",
};

/** Message dans la langue voulue. Un message inconnu (par exemple un texte
 * technique d'une bibliothèque, en anglais) n'est jamais montré tel quel :
 * il devient le message générique de sa catégorie. */
export function localizeMessage(message: string, statusCode: number, locale: Locale): string {
  const known = message in EN_MESSAGES ? message : statusCode >= 500 ? GENERIC_SERVER_ERROR : GENERIC_CLIENT_ERROR;
  return locale === "en" ? EN_MESSAGES[known]! : known;
}

export function isErrorBody(payload: unknown): payload is { error: string; message: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    "message" in payload &&
    typeof payload.message === "string"
  );
}
