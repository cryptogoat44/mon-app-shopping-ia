// Tous les textes de l'interface. Aucun texte en dur dans les composants.
// Vouvoiement, phrases courtes, verbes d'action. Voir la section 6 du brief
// pour les règles complètes.

export const fr = {
  welcome: {
    baseline: "L'identification discrète des pièces qui comptent.",
    explain: "Collez un lien ou une photo. Spotto retrouve la pièce et vous dit où l'acheter.",
    cta: "Commencer",
    legal: "Conditions d'utilisation · Confidentialité",
  },
  spotter: {
    title: "Spotter",
    question: "Que voulez-vous identifier ?",
    pasteLink: "Coller le lien",
    importPhoto: "Importer une photo",
    recentlySpotted: "Récemment spottées",
    unsupportedLink: "Ce lien n'est pas pris en charge. Spotto fonctionne avec TikTok, Instagram, Pinterest et les sites marchands.",
  },
  analysis: {
    status: "Spotto identifie la pièce…",
    reassurance: "Encore un instant…",
    cancel: "Annuler",
  },
  result: {
    exactMatch: "Correspondance exacte",
    similarPiece: "Pièce similaire",
    multiplePiecesHint: "pièces repérées dans cette image — touchez pour changer.",
    viewAt: (merchant: string) => `Voir chez ${merchant}`,
    keep: "Garder",
    markAsBought: "Je l'ai achetée",
    share: "Partager",
    similarPieces: "Pièces similaires",
    affiliateDisclosure: "Lien affilié",
    failTitle: "Nous n'avons pas pu identifier cette pièce.",
    failTip: "Essayez une image plus nette, ou recadrez sur la pièce uniquement.",
    retry: "Réessayer",
  },
  wishlist: {
    title: "Envies",
    empty: "Aucune envie pour l'instant. Spottez une première pièce pour commencer.",
    emptyCta: "Spotter une pièce",
  },
  profile: {
    vault: "Vault",
    lifestyle: "Lifestyle",
    verified: "Achat vérifié",
    pendingVerification: "En cours de vérification",
    publish: "Publier",
    follow: "Suivre",
    following: "Abonné",
  },
  publish: {
    title: "Nouvelle publication",
    cancel: "Annuler",
    publish: "Publier",
    addPhoto: "Ajouter une photo",
    captionPlaceholder: "Écrivez une légende…",
    piecesLabel: "Pièces identifiées",
    addPiece: "Identifier une pièce",
    published: "Publié",
  },
  settings: {
    title: "Réglages",
    account: "Compte",
    privacy: "Profil public ou privé",
    exportData: "Exporter mes données",
    deleteAccount: "Supprimer mon compte",
    deleteConfirm: "Cette action est définitive. Toutes vos données seront supprimées sans possibilité de récupération.",
    terms: "Conditions d'utilisation",
    privacyPolicy: "Politique de confidentialité",
    howWeEarn: "Comment Spotto se rémunère",
    signOut: "Se déconnecter",
  },
  auth: {
    continueWithApple: "Continuer avec Apple",
    continueWithEmail: "Continuer avec un e-mail",
  },
} as const;
