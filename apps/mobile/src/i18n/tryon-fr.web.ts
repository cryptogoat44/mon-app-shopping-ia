// Essayage virtuel photo : textes du SITE seulement (lot « essayage virtuel »,
// novembre 2026). Catalogue à part, importé uniquement par des fichiers .web :
// fr.ts et en.ts partent aussi dans l'app iPhone, qui ne doit contenir aucune
// trace de l'essayage (règle 2.5.19 d'Apple sur les fonctions cachées). Mêmes
// règles que fr.ts : vouvoiement, phrases courtes, ton sobre ; le nom du
// produit vient toujours de BRAND. L'anglais (tryon-en.web.ts) a exactement
// les mêmes clés : tests/tryon-catalog.test.ts le vérifie.
import type { TryonErrorCode } from "@monapp/shared-types";
import { APP_FILE_SLUG, APP_NAME_DISPLAY as BRAND } from "../constants/brand";
import type { Widen } from "./types";

/** Codes d'erreur qui ont leur message fixe (le quota a le sien, daté). */
export type TryonServerCode = Exclude<TryonErrorCode, "tryon_quota_exhausted"> | "file_too_large";

/** Version des textes de consentement que CE site affiche (consent.body et
 * ses détails, en français et en anglais) : c'est elle que « J'accepte »
 * envoie, jamais celle que le serveur annonce. Un de ces textes change :
 * cette version change avec lui, en même temps que TRYON_CONSENT_VERSION du
 * serveur (apps/backend/src/lib/tryon/config.ts). Jamais dans le contrat
 * partagé, qui part aussi dans l'app iPhone. */
export const TRYON_CONSENT_TEXT_VERSION = "2026-11-v1";

export const tryonFr = {
  entry: {
    button: "Essayer",
    buttonLabel: (title: string) => `Essayer « ${title} » sur votre photo`,
  },
  sheet: {
    title: "Essayage virtuel",
    close: "Fermer",
    loading: "Chargement…",
    unavailable: "L'essayage virtuel n'est pas disponible pour le moment.",
    retry: "Réessayer",
  },
  age: {
    title: "Votre date de naissance",
    intro: "L'essayage virtuel est réservé aux personnes majeures. Seul votre statut « majeur » ou « mineur » est conservé, jamais votre date de naissance.",
    final: "Une fois enregistré, ce statut ne peut plus être modifié.",
    label: "Date de naissance",
    hint: "Format : AAAA-MM-JJ",
    submit: "Valider",
    submitting: "Vérification…",
    incomplete: "Indiquez une date de naissance complète.",
    invalid: "Cette date n'existe pas. Vérifiez-la, puis réessayez.",
    future: "Cette date est dans le futur.",
    tooOld: "Indiquez une date à partir du 1er janvier 1900.",
  },
  minor: {
    title: "Réservé aux personnes majeures",
    body: "L'essayage virtuel est réservé aux personnes de 18 ans et plus.",
  },
  consent: {
    title: "Votre consentement",
    renewedTitle: "Le texte a changé",
    renewedIntro: "Le texte de consentement de l'essayage a été mis à jour. Relisez-le avant votre prochain essai.",
    reloadTitle: "Le texte a été mis à jour",
    reloadBody: "Le texte de consentement de l'essayage a été mis à jour depuis l'ouverture de cette page. Rechargez la page pour lire la nouvelle version avant de l'accepter.",
    reload: "Recharger la page",
    body: `Pour créer votre essayage, votre photo est envoyée à FASHN (Royaume-Uni) et à ses prestataires, dont certains aux États-Unis et en Asie. Elle n'est ni conservée par ${BRAND} ni utilisée pour entraîner une IA. Utilisez uniquement une photo de vous. L'image produite est générée par IA. Vous pouvez retirer votre consentement à tout moment dans Réglages.`,
    accept: "J'accepte",
    accepting: "Enregistrement…",
    cancel: "Annuler",
    learnMore: "En savoir plus",
    learnLess: "Masquer les détails",
    sentTitle: "Ce qui est envoyé",
    sent: "Seules votre photo et l'image de la pièce sont envoyées à FASHN : ni votre nom, ni votre adresse e-mail. Avant l'envoi, votre photo est convertie en JPEG sur votre appareil, sans ses métadonnées (dont la localisation).",
    keptTitle: "Combien de temps",
    kept: `${BRAND} ne garde ni votre photo ni l'image produite. FASHN supprime sa copie temporaire de votre photo à la fin du traitement, au plus tard sous un jour, et garde l'image produite 60 minutes au plus.`,
    training: "Ni votre photo ni l'image produite ne servent à entraîner une IA.",
    usage: `Pendant 12 mois, ${BRAND} garde seulement des informations d'usage, sans aucune image : la date de chaque essai, la pièce essayée et son résultat.`,
    withdraw: "Vous pouvez retirer votre consentement à tout moment dans Réglages, rubrique « Vos données ».",
    rulesTitle: "Règles d'usage",
    rules: [
      "Utilisez uniquement une photo de vous : jamais celle d'une autre personne, ni celle d'un mineur.",
      "Ne présentez jamais l'image produite comme une vraie photo.",
      "En cas de manquement, votre compte peut être suspendu, puis fermé.",
    ],
  },
  photo: {
    title: "Votre photo",
    tipsTitle: "Pour un bon résultat",
    tips: ["Seul·e sur la photo", "En pied ou à mi-corps", "Une bonne lumière", "Des vêtements ajustés"],
    formats: "JPEG, PNG, WebP ou HEIC. Votre photo est convertie en JPEG sur votre appareil, sans ses métadonnées (dont la localisation), avant l'envoi.",
    choose: "Choisir une photo",
    chooseAnother: "Choisir une autre photo",
    preparing: "Préparation de la photo…",
    previewLabel: "La photo choisie",
    attest: "Cette photo est la mienne",
    launch: "Lancer l'essai",
    refusedFormat: "Format non accepté : choisissez une photo JPEG, PNG, WebP ou HEIC.",
    refusedTooLarge: (megabytes: number) => `Cette photo est trop lourde (${megabytes} Mo maximum). Choisissez-en une autre.`,
    refusedHeicBrowser: "Ce navigateur ne sait pas ouvrir les photos HEIC. Choisissez une photo JPEG ou PNG, ou ouvrez le site dans Safari.",
    refusedUnreadable: "Cette photo n'a pas pu être ouverte. Choisissez-en une autre.",
  },
  running: {
    title: "Création de votre essayage…",
    duration: "Environ 10 secondes.",
    keepOpen: "Gardez cette fenêtre ouverte : un essai interrompu peut tout de même être décompté.",
  },
  result: {
    title: "Votre essayage",
    imageLabel: "Image de votre essayage, générée par IA",
    aiNotice: "Image générée par IA. Ne la présentez jamais comme une vraie photo.",
    save: "Enregistrer l'image",
    report: "Signaler",
    another: "Essayer une autre photo",
    fileBase: `${APP_FILE_SLUG}-essayage`,
    imageError: "L'image n'a pas pu être affichée. Essayez une autre photo.",
  },
  remaining: {
    count: (free: number, bonus: number) => `Il vous reste ${free} essai${free > 1 ? "s" : ""} ce mois-ci${bonus > 0 ? ` (+${bonus} offert${bonus > 1 ? "s" : ""})` : ""}`,
    none: (day: string) => `Vous avez utilisé tous vos essais de ce mois-ci. Les prochains seront disponibles le ${day}.`,
    noneUndated: "Vous avez utilisé tous vos essais de ce mois-ci.",
  },
  report: {
    title: "Signaler ce résultat",
    question: "Qu'est-ce qui ne va pas ?",
    reasons: {
      inappropriate: "Image choquante ou inappropriée",
      wrong_piece: "Ce n'est pas la bonne pièce",
      poor_quality: "Résultat de mauvaise qualité",
      other: "Autre chose",
    },
    commentLabel: "Précisez si vous le souhaitez (facultatif)",
    commentCount: (count: number, max: number) => `${count} / ${max} caractères`,
    noImage: "Aucune image n'est envoyée avec votre signalement.",
    send: "Envoyer",
    sending: "Envoi…",
    cancel: "Annuler",
    thanks: "Merci, votre signalement a été envoyé.",
    error: "Le signalement n'a pas pu être envoyé. Réessayez.",
  },
  // Un message par code d'erreur du serveur (type TryonErrorCode, plus
  // « file_too_large », la limite générale des envois) : TypeScript refuse un
  // code oublié ou inconnu. Le quota épuisé a son propre texte, daté
  // (remaining.none).
  errors: {
    feature_disabled: "L'essayage virtuel n'est pas disponible.",
    tryon_age_required: "Indiquez d'abord votre date de naissance.",
    tryon_minor: "L'essayage virtuel est réservé aux personnes de 18 ans et plus.",
    tryon_age_already_set: "Votre statut d'âge est déjà enregistré.",
    tryon_birth_date_invalid: "Cette date n'est pas valide. Vérifiez-la, puis réessayez.",
    tryon_consent_required: "Acceptez d'abord le texte de consentement.",
    tryon_consent_outdated: "Le texte de consentement a changé : relisez-le et acceptez-le pour continuer.",
    tryon_attest_required: "Cochez « Cette photo est la mienne » pour continuer.",
    tryon_item_not_found: "Cette pièce est introuvable.",
    tryon_item_not_eligible: "Cette pièce ne peut pas être essayée : il lui faut une image et un lien d'achat.",
    tryon_photo_invalid: "Cette photo n'a pas pu être lue. Choisissez une photo JPEG, PNG ou WebP.",
    file_too_large: "Cette photo est trop lourde (10 Mo maximum). Choisissez-en une autre.",
    tryon_in_progress: "Un essai est déjà en cours. Patientez quelques secondes, puis réessayez.",
    tryon_rate_limited: "Vous avez lancé beaucoup d'essais en peu de temps. Réessayez un peu plus tard.",
    tryon_budget_reached: "Les essais sont momentanément indisponibles.",
    tryon_busy: "Le service d'essayage est très sollicité. Réessayez dans un instant.",
    tryon_provider_unavailable: "Le service d'essayage ne répond pas pour le moment. Réessayez plus tard : cet essai n'a pas été décompté.",
    tryon_timeout: "L'essai a pris trop de temps. Réessayez : il n'a pas été décompté.",
    tryon_pose_not_detected: "Votre silhouette n'a pas été reconnue sur cette photo. Essayez avec une autre, en suivant ces conseils :",
    tryon_moderation_blocked: "Cet essai a été refusé par la modération du service : certaines pièces, comme les maillots de bain ou la lingerie, ne peuvent pas être essayées. Choisissez une autre pièce ou une autre photo : cet essai n'a pas été décompté.",
    tryon_image_unreadable: "Une des images n'a pas pu être lue. Essayez avec une autre photo ou une autre pièce : cet essai n'a pas été décompté.",
  } satisfies Record<TryonServerCode, string>,
  // Sans réponse lisible du serveur.
  fallback: {
    offline: "Vous semblez hors ligne. Vérifiez votre connexion internet, puis réessayez.",
    noAnswer: "Le serveur n'a pas répondu à temps. Un essai interrompu peut tout de même être décompté : vérifiez vos essais restants avant de réessayer.",
    generic: "Une erreur est survenue. Réessayez.",
  },
  settings: {
    title: "Essayage virtuel",
    body: "Vous avez accepté que vos photos soient envoyées à FASHN pour créer vos essayages.",
    withdraw: "Retirer mon consentement",
    withdrawLabel: "Essayage virtuel : retirer mon consentement",
    confirm: "Retirer votre consentement ? Sans lui, aucun essai n'est possible ; il vous sera redemandé avant votre prochain essai.",
    confirmWithdraw: "Retirer",
    cancel: "Annuler",
    withdrawing: "Retrait…",
    withdrawn: "Consentement retiré. Il vous sera redemandé avant votre prochain essai.",
    error: "Le retrait n'a pas pu être enregistré. Réessayez.",
  },
} as const;

/** Forme du catalogue : celle du français, avec des textes libres. */
export type TryonCatalog = Widen<typeof tryonFr>;
