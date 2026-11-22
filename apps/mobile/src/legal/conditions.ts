// Conditions d'utilisation — PROJET rédigé par Claude Code d'après le
// fonctionnement réel de l'app (Lot Q, bloc 5, décision 3). À faire valider
// par un professionnel. Aucune information sur l'éditeur n'est inventée : les
// champs « [À compléter : …] » sont à remplir par le fondateur. Toute
// modification du texte ⇒ changer la version dans LEGAL_DOCUMENT_VERSIONS
// (packages/shared-types).
import { APP_NAME_DISPLAY as BRAND } from "../constants/brand";
import { HOSTS, PUBLISHER } from "./publisher";
import type { LegalDocument } from "./types";

export const termsOfUse: LegalDocument = {
  type: "terms",
  title: "Conditions d'utilisation",
  sections: [
    {
      title: `Qui édite ${BRAND}`,
      blocks: [
        `${BRAND} est édité par ${PUBLISHER.name}, ${PUBLISHER.status}, ${PUBLISHER.address}.`,
        `Directeur de la publication : ${PUBLISHER.name}.`,
        `Contact : ${PUBLISHER.email} — téléphone : ${PUBLISHER.phone}.`,
        `Hébergement du serveur et du site : ${HOSTS.render}.`,
        `Hébergement des données et des photos : ${HOSTS.supabase} ; données stockées en Irlande.`,
      ],
    },
    {
      title: "Objet",
      blocks: [
        `Ces conditions encadrent votre utilisation de ${BRAND}, sur l'application et sur le site. En créant votre compte, vous les acceptez, ainsi que la politique de confidentialité.`,
      ],
    },
    {
      title: "Votre compte",
      blocks: [
        [
          "Vous devez avoir au moins 15 ans pour créer un compte. Vous le certifiez à l'inscription ; aucune vérification d'âge n'est effectuée.",
          "Les informations que vous donnez doivent être exactes. Votre mot de passe est personnel : gardez-le confidentiel.",
          "Vous pouvez supprimer votre compte à tout moment : Réglages → Supprimer mon compte. La suppression est immédiate et définitive.",
          "Un compte sans aucune connexion pendant 3 ans est supprimé, après un e-mail d'avertissement.",
        ],
      ],
    },
    {
      title: `Ce que fait ${BRAND}`,
      blocks: [
        `${BRAND} propose, à partir d'une image ou d'un lien que vous soumettez, des pièces de mode qui y ressemblent. Ces propositions viennent d'une recherche visuelle automatique : elles peuvent être inexactes ou incomplètes, et une pièce proposée n'est pas forcément celle de l'image.`,
        "Les prix, la disponibilité et les caractéristiques affichés viennent des marchands et peuvent avoir changé : seules font foi les informations du site du marchand.",
        `Pour limiter les boutiques douteuses, ${BRAND} peut ne pas afficher certaines offres, et signale les boutiques officielles des marques, les boutiques connues et les prix inhabituellement bas ; dans « Cette pièce dans d'autres boutiques », la boutique officielle de la marque de la pièce passe en premier seulement quand ${BRAND} a reconnu cette boutique, ce qui n'est pas toujours le cas ; les autres boutiques officielles et les boutiques connues remontent un peu, et les offres à prix inhabituellement bas ou à l'adresse douteuse passent en dernier. Ce n'est pas une garantie : vérifiez toujours la boutique avant de payer.`,
        `${BRAND} ne vend rien. Si vous achetez une pièce, vous le faites directement auprès du marchand, selon ses propres conditions ; ${BRAND} n'est pas partie à cet achat.`,
        "Le nombre d'identifications peut être limité dans le temps, pour garantir le service à tous.",
        "Limites de recherche : un compte gratuit peut lancer 100 recherches par mois civil, du 1er à 0 h (heure de Paris) au 1er du mois suivant, et chaque compte 8 recherches par jour. Une recherche, c'est une photo, une capture de vidéo ou un lien que vous envoyez, quel que soit le nombre de boutiques interrogées ensuite ; une recherche servie par notre mémoire des recherches récentes, ou qui échoue pour une raison technique, n'est pas comptée. Quand le service entier est très sollicité, les recherches peuvent aussi être suspendues pour un temps. Quand il vous en reste peu, l'app vous le dit avant de chercher.",
        "Le fil « Pour vous » propose des publications publiques des 14 derniers jours de comptes que vous ne suivez pas, classées selon leur date et leur nombre de j'aime et de commentaires. Le classement est le même pour tous les membres et ne repose sur aucun profil de vos centres d'intérêt. Les comptes à découvrir sont d'abord des comptes suivis par vos abonnements, puis les comptes publics les plus actifs. Le fil « Abonnements » reste rangé par date. Vous pouvez refuser que votre compte et vos publications soient proposés (réglage « Proposer mon compte aux autres membres »). [À vérifier : transparence des systèmes de recommandation, règlement européen sur les services numériques, article 27 ; dispense des micro et petites entreprises (article 19) à confirmer.]",
      ],
    },
    {
      title: "Liens vers les marchands",
      blocks: [
        `Les liens marqués « Lien affilié » peuvent, à l'avenir, rapporter une commission à ${BRAND} lorsque vous achetez, sans aucun surcoût pour vous. À la date de cette version, aucun programme d'affiliation n'est actif : ${BRAND} ne perçoit aucune commission.`,
      ],
    },
    {
      title: "Vos contenus",
      blocks: [
        `Vous restez propriétaire des photos, textes et commentaires que vous publiez. Pour que ${BRAND} puisse les héberger et les montrer aux personnes que vous avez choisies, vous accordez à l'éditeur, gratuitement et pour le monde entier, le droit de les stocker, de les reproduire (y compris en taille réduite) et de les afficher dans ${BRAND}, selon la visibilité que vous avez choisie. Ce droit prend fin quand vous supprimez le contenu ou votre compte.`,
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
        "Ces règles valent aussi pour le lien que vous affichez sur votre profil, comme pour votre bio.",
        `Il est également interdit d'utiliser ${BRAND} de façon automatisée (robots, collecte massive de données) ou de tenter d'en contourner les protections.`,
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
        `Le nom ${BRAND}, l'application, son design et ses textes appartiennent à l'éditeur. Les images et noms des pièces proposées appartiennent à leurs titulaires (marques, marchands) ; elles sont affichées depuis leurs propres sites.`,
      ],
    },
    {
      title: "Disponibilité et responsabilité",
      blocks: [
        `L'éditeur s'efforce de rendre ${BRAND} disponible et fiable, mais le service peut être interrompu, notamment pour maintenance, et évoluer. [À vérifier : clauses de responsabilité, à faire valider par un professionnel.]`,
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
        `Ces conditions sont soumises au droit français. En cas de litige, contactez-nous d'abord : ${PUBLISHER.email}. [À vérifier : médiateur de la consommation éventuel et tribunal compétent.]`,
      ],
    },
  ],
};
