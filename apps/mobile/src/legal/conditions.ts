// Conditions d'utilisation — PROJET rédigé par Claude Code d'après le
// fonctionnement réel de l'app (Lot Q, bloc 5, décision 3). À faire valider
// par un professionnel. Aucune information sur l'éditeur n'est inventée : les
// champs « [À compléter : …] » sont à remplir par le fondateur. Toute
// modification du texte ⇒ changer la version dans LEGAL_DOCUMENT_VERSIONS
// (packages/shared-types).
import type { LegalDocument } from "./types";

export const termsOfUse: LegalDocument = {
  type: "terms",
  title: "Conditions d'utilisation",
  sections: [
    {
      title: "Qui édite Spotto",
      blocks: [
        "Spotto est édité par [À compléter : nom et prénom, ou dénomination et forme juridique de la société, capital le cas échéant, adresse du domicile ou du siège social, numéro d'immatriculation (RCS ou répertoire des métiers) ou SIRET].",
        "Directeur de la publication : [À compléter : nom et prénom].",
        "Contact : [À compléter : adresse e-mail de contact] — téléphone : [À compléter : numéro de téléphone].",
        "Hébergement du serveur et du site : Render Services, Inc., [À compléter : adresse et numéro de téléphone de Render].",
        "Hébergement des données et des photos : Supabase, Inc., [À compléter : adresse et numéro de téléphone de Supabase] ; données stockées en Irlande.",
      ],
    },
    {
      title: "Objet",
      blocks: [
        "Ces conditions encadrent votre utilisation de Spotto, sur l'application et sur le site. En créant votre compte, vous les acceptez, ainsi que la politique de confidentialité.",
      ],
    },
    {
      title: "Votre compte",
      blocks: [
        [
          "Vous devez avoir au moins [À décider : âge minimum — 15 ans proposé] pour créer un compte.",
          "Les informations que vous donnez doivent être exactes. Votre mot de passe est personnel : gardez-le confidentiel.",
          "Vous pouvez supprimer votre compte à tout moment : Réglages → Supprimer mon compte. La suppression est immédiate et définitive.",
        ],
      ],
    },
    {
      title: "Ce que fait Spotto",
      blocks: [
        "Spotto propose, à partir d'une image ou d'un lien que vous soumettez, des pièces de mode qui y ressemblent. Ces propositions viennent d'une recherche visuelle automatique : elles peuvent être inexactes ou incomplètes, et une pièce proposée n'est pas forcément celle de l'image.",
        "Les prix, la disponibilité et les caractéristiques affichés viennent des marchands et peuvent avoir changé : seules font foi les informations du site du marchand.",
        "Spotto ne vend rien. Si vous achetez une pièce, vous le faites directement auprès du marchand, selon ses propres conditions ; Spotto n'est pas partie à cet achat.",
        "Le nombre d'identifications peut être limité dans le temps, pour garantir le service à tous.",
      ],
    },
    {
      title: "Liens vers les marchands",
      blocks: [
        "Les liens marqués « Lien affilié » peuvent, à l'avenir, rapporter une commission à Spotto lorsque vous achetez, sans aucun surcoût pour vous. À la date de cette version, aucun programme d'affiliation n'est actif : Spotto ne perçoit aucune commission.",
      ],
    },
    {
      title: "Vos contenus",
      blocks: [
        "Vous restez propriétaire des photos, textes et commentaires que vous publiez. Pour que Spotto puisse les héberger et les montrer aux personnes que vous avez choisies, vous accordez à l'éditeur, gratuitement et pour le monde entier, le droit de les stocker, de les reproduire (y compris en taille réduite) et de les afficher dans Spotto, selon la visibilité que vous avez choisie. Ce droit prend fin quand vous supprimez le contenu ou votre compte.",
        "Vous garantissez disposer des droits nécessaires sur ce que vous publiez, notamment l'accord des personnes reconnaissables sur vos photos.",
      ],
    },
    {
      title: "Règles de conduite",
      blocks: [
        "Il est interdit de publier ou d'envoyer :",
        [
          "des contenus illégaux, haineux, violents, discriminatoires ou à caractère sexuel ;",
          "du harcèlement, des menaces ou des insultes ;",
          "des photos d'une personne sans son accord, ou des informations personnelles sur autrui ;",
          "des contenus qui portent atteinte aux droits d'autrui (droit d'auteur, marques, image) ;",
          "du spam, des arnaques ou de la publicité non sollicitée.",
        ],
        "Il est également interdit d'utiliser Spotto de façon automatisée (robots, collecte massive de données) ou de tenter d'en contourner les protections.",
      ],
    },
    {
      title: "Signaler, bloquer, modérer",
      blocks: [
        "Vous pouvez signaler une publication, un commentaire ou un compte, et bloquer un compte : il ne voit plus vos publications ni votre profil, et vous ne voyez plus les siens.",
        "L'éditeur examine les signalements et peut retirer un contenu contraire à ces conditions ou à la loi, et suspendre ou supprimer le compte concerné. [À compléter : délais de traitement et manière dont l'auteur du contenu et l'auteur du signalement sont informés de la décision et de ses motifs.]",
      ],
    },
    {
      title: "Propriété intellectuelle",
      blocks: [
        "Le nom Spotto, l'application, son design et ses textes appartiennent à l'éditeur. Les images et noms des pièces proposées appartiennent à leurs titulaires (marques, marchands) ; elles sont affichées depuis leurs propres sites.",
      ],
    },
    {
      title: "Disponibilité et responsabilité",
      blocks: [
        "L'éditeur s'efforce de rendre Spotto disponible et fiable, mais le service peut être interrompu, notamment pour maintenance, et évoluer. [À vérifier : clauses de responsabilité, à faire valider par un professionnel.]",
        "L'éditeur n'est pas responsable des sites des marchands ni des achats que vous y faites.",
      ],
    },
    {
      title: "Suspension de votre compte",
      blocks: [
        "En cas de manquement grave ou répété à ces conditions, l'éditeur peut suspendre ou supprimer votre compte. [À compléter : procédure d'information préalable et de contestation.]",
      ],
    },
    {
      title: "Modifications",
      blocks: [
        "Ces conditions peuvent évoluer. Chaque version est datée ; l'app enregistre la version que vous avez acceptée et vous signale, dans les Réglages, lorsqu'une nouvelle version est en vigueur.",
      ],
    },
    {
      title: "Droit applicable et litiges",
      blocks: [
        "Ces conditions sont soumises au droit français. En cas de litige, contactez-nous d'abord : [À compléter : adresse e-mail de contact]. [À vérifier : médiateur de la consommation éventuel et tribunal compétent.]",
      ],
    },
  ],
};
