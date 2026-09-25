// Politique de confidentialité — PROJET rédigé par Claude Code à partir des
// données réellement collectées par l'app (Lot Q, bloc 5, décision 3).
// À faire valider par un professionnel. Aucune information sur l'éditeur
// n'est inventée : les champs « [À compléter : …] » sont à remplir par le
// fondateur. Toute modification du texte ⇒ changer la version dans
// LEGAL_DOCUMENT_VERSIONS (packages/shared-types).
import type { LegalDocument } from "./types";

export const privacyPolicy: LegalDocument = {
  type: "privacy_policy",
  title: "Politique de confidentialité",
  sections: [
    {
      title: "En bref",
      blocks: [
        "Spotto vous aide à identifier des pièces de mode à partir d'une image, à garder celles que vous possédez dans votre Vault et à partager vos publications avec les personnes de votre choix.",
        [
          "Nous ne vendons pas vos données et n'affichons aucune publicité.",
          "Votre Vault et vos Envies ne sont visibles que par vous.",
          "L'image que vous faites analyser est supprimée de nos serveurs dès que le résultat est connu.",
          "Vous pouvez à tout moment télécharger vos données ou supprimer votre compte, depuis les Réglages.",
        ],
      ],
    },
    {
      title: "Qui est responsable de vos données",
      blocks: [
        "Le responsable du traitement est l'éditeur de Spotto : [À compléter : nom et prénom, ou dénomination et forme juridique de la société, adresse du domicile ou du siège social, numéro d'immatriculation ou SIRET].",
        "Pour toute question sur vos données ou pour exercer vos droits : [À compléter : adresse e-mail de contact].",
      ],
    },
    {
      title: "Les données que nous utilisons",
      blocks: [
        "Votre compte : votre adresse e-mail et votre mot de passe. Le mot de passe n'est jamais conservé en clair : nous ne le connaissons pas.",
        "Votre profil : nom d'utilisateur, nom affiché, bio, photo de profil, vos abonnés et vos abonnements.",
        "Vos recherches (Spotter) : l'image ou le lien (TikTok, Instagram, Pinterest) que vous soumettez, la zone que vous sélectionnez, le texte que vous ajoutez éventuellement, puis les résultats proposés (nom de la pièce, image, prix, marchand, lien). L'historique de vos recherches est conservé pour vous les remontrer (« Récemment spottées »).",
        "Votre Vault et vos Envies : les pièces que vous y ajoutez (nom, catégorie, photo, lien vers la pièce d'origine).",
        "Vos publications et interactions : photos, légendes, visibilité choisie, commentaires, « j'aime », notifications, comptes bloqués et signalements que vous faites.",
        "Vos clics vers les marchands : la pièce concernée, l'endroit de l'app d'où vous avez cliqué, la date, et l'identification technique de votre navigateur ou de votre téléphone (« user agent »).",
        "Vos consentements : la date et la version des documents que vous avez acceptés.",
        "Des données techniques : comme tout serveur web, le nôtre reçoit votre adresse IP et des informations techniques à chaque requête ; elles figurent dans ses journaux, utilisés pour la sécurité et la correction des erreurs.",
        "Les photos que vous envoyez sont réduites et débarrassées de leurs métadonnées, y compris la position GPS éventuellement enregistrée par votre téléphone.",
      ],
    },
    {
      title: "Pourquoi, et sur quelle base",
      blocks: [
        [
          "Fournir le service que vous demandez (compte, identification des pièces, Vault, Envies, publications, abonnements, notifications) : exécution du contrat qui nous lie (les conditions d'utilisation).",
          "Assurer la sécurité du service, prévenir les abus et traiter les signalements : notre intérêt légitime.",
          "Mesurer les clics vers les marchands, pour comprendre quelles pièces intéressent et, le jour où des liens affiliés seront actifs, calculer les commissions : notre intérêt légitime.",
          "Conserver la preuve de votre acceptation des documents : notre obligation de pouvoir la démontrer.",
        ],
        "[À vérifier : bases légales retenues, à faire valider par un professionnel.]",
      ],
    },
    {
      title: "Qui peut voir quoi dans Spotto",
      blocks: [
        [
          "Votre Vault et vos Envies : vous seul.",
          "Vos publications : selon la visibilité que vous choisissez pour chacune — tout le monde, vos abonnés, ou vous seul. Vous pouvez la modifier à tout moment.",
          "Votre profil (nom d'utilisateur, nom affiché, photo, bio, nombre d'abonnés et d'abonnements) : les autres utilisateurs, sauf ceux que vous avez bloqués.",
        ],
        "Les photos sont stockées à une adresse web longue et aléatoire, impossible à deviner. Mais une personne qui a pu voir une photo et en a conservé l'adresse peut continuer à l'ouvrir, même si vous changez ensuite la visibilité de la publication.",
      ],
    },
    {
      title: "Nos prestataires et les services tiers",
      blocks: [
        "Nous faisons appel à des prestataires qui traitent des données pour notre compte, uniquement pour faire fonctionner Spotto :",
        [
          "Supabase (Supabase, Inc., États-Unis) : base de données, stockage des photos et authentification. Vos données y sont hébergées dans l'Union européenne (Irlande).",
          "Render (Render Services, Inc., États-Unis) : hébergement de notre serveur et du site. Toutes les requêtes de l'app passent par ce serveur. [À vérifier : région d'hébergement du serveur.]",
          "SerpApi (SerpApi, LLC, États-Unis) : reçoit un lien temporaire (valable 5 minutes) vers l'image à analyser, et le texte éventuellement ajouté ; il les transmet à la recherche visuelle de Google (Google Lens, Google LLC, États-Unis), qui télécharge l'image pour trouver les pièces correspondantes. Aucune autre donnée vous concernant (nom, e-mail, identifiant) ne leur est transmise.",
        ],
        "Quand vous collez un lien TikTok ou Instagram, notre serveur demande à TikTok ou à Meta l'aperçu public de la vidéo : seul le lien leur est transmis, jamais votre identité.",
        "Les images des pièces proposées sont affichées directement depuis les sites des marchands et de Google. Votre téléphone ou votre navigateur les télécharge chez eux : ils reçoivent donc votre adresse IP et les informations techniques habituelles d'une requête web. Quand vous ouvrez un lien vers un marchand, vous quittez Spotto : sa propre politique de confidentialité s'applique.",
        "Nous pouvons enfin communiquer des données aux autorités lorsque la loi nous y oblige.",
      ],
    },
    {
      title: "Transferts hors de l'Union européenne",
      blocks: [
        "Certaines données quittent ou peuvent quitter l'Union européenne :",
        [
          "l'image que vous faites analyser et le texte éventuellement ajouté : envoyés à SerpApi puis à Google, aux États-Unis ;",
          "les données traitées par notre serveur (toutes les requêtes de l'app, dont votre adresse IP) : chez Render, société américaine [À vérifier : région d'hébergement du serveur — si elle est hors de l'Union européenne, toutes ces données y transitent] ;",
          "les données hébergées chez Supabase : stockées en Irlande, mais Supabase étant une société américaine, un accès depuis les États-Unis (maintenance, assistance) ne peut pas être exclu ;",
          "votre adresse IP : reçue par les sites des marchands et par Google lorsque l'app affiche leurs images, où qu'ils soient établis.",
        ],
        "[À vérifier : garanties encadrant chacun de ces transferts — certification « Data Privacy Framework » de la société, ou clauses contractuelles types de la Commission européenne signées avec elle — et situation de Google, qui reçoit l'image par l'intermédiaire de SerpApi sans contrat direct avec l'éditeur.]",
      ],
    },
    {
      title: "Combien de temps",
      blocks: [
        [
          "L'image que vous faites analyser : supprimée de nos serveurs dès la réponse de la recherche, qu'elle ait réussi ou non (quelques secondes).",
          "Votre compte et tout ce qui s'y rattache : tant que votre compte existe. [À décider : durée de conservation de l'historique des recherches, et sort des comptes inactifs.]",
          "Les journaux techniques du serveur : [À vérifier : durée de conservation chez notre hébergeur].",
        ],
        "Quand vous supprimez votre compte, vos données et vos photos sont effacées immédiatement et définitivement : profil, recherches, Vault, Envies, publications, commentaires, « j'aime », abonnements, notifications, clics vers les marchands, consentements.",
      ],
    },
    {
      title: "Sur votre téléphone ou dans votre navigateur",
      blocks: [
        "Spotto enregistre sur votre appareil votre session de connexion, pour que vous n'ayez pas à vous reconnecter, ainsi qu'une copie des images déjà affichées, pour les montrer plus vite. Ces éléments sont indispensables au fonctionnement de l'app.",
        "Spotto n'utilise à ce jour aucun outil de mesure d'audience, aucun traceur publicitaire et aucun cookie publicitaire.",
      ],
    },
    {
      title: "Vos droits",
      blocks: [
        "Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de vos données, ainsi que du droit de définir des directives sur leur sort après votre décès.",
        [
          "Télécharger toutes vos données (fichier lisible par un ordinateur) : Réglages → Exporter mes données.",
          "Corriger votre profil : Réglages → Modifier le profil.",
          "Tout effacer : Réglages → Supprimer mon compte.",
          "Pour toute autre demande : [À compléter : adresse e-mail de contact].",
        ],
        "Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (cnil.fr).",
      ],
    },
    {
      title: "Âge minimum",
      blocks: ["Spotto est réservé aux personnes âgées d'au moins [À décider : âge minimum — 15 ans proposé, âge du consentement numérique en France]."],
    },
    {
      title: "Sécurité",
      blocks: [
        "Les échanges avec Spotto sont chiffrés (HTTPS). Chaque accès est contrôlé par notre serveur : propriété des contenus, visibilité choisie, comptes bloqués. Les mots de passe ne sont jamais conservés en clair.",
      ],
    },
    {
      title: "Modifications",
      blocks: [
        "Nous pouvons faire évoluer cette politique. Chaque version est datée ; l'app enregistre la version que vous avez acceptée et vous signale, dans les Réglages, lorsqu'une nouvelle version est en vigueur.",
      ],
    },
  ],
};
