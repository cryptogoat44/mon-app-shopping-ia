// Politique de confidentialité — PROJET rédigé par Claude Code à partir des
// données réellement collectées par l'app (Lot Q, bloc 5, décision 3).
// À faire valider par un professionnel. Aucune information sur l'éditeur
// n'est inventée : les champs « [À compléter : …] » sont à remplir par le
// fondateur. Toute modification du texte ⇒ changer la version dans
// LEGAL_DOCUMENT_VERSIONS (packages/shared-types).
// Version « projet-2026-11-05 » : la voie C (autres boutiques, « Que
// cherchez-vous ? », cache de 24 h) est décrite interrupteurs allumés, avec
// les textes « Proposé » du document pour l'avocat du 2026-11-05 (variante B
// pour SerpApi : aucun identifiant du compte dans le lien de l'image).
// Lot 2 (alertes prix et stock, 2026-11-09) : un paragraphe « [À vérifier] »
// ajouté SANS changer LEGAL_DOCUMENT_VERSIONS (consigne du fondateur) : la
// nouvelle version sera datée après relecture, avant la mise en ligne des alertes.
import { PUBLISHER } from "./publisher";
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
          "Votre Vault n'est visible que par vous. Vos Envies aussi, sauf celles que vous rangez dans une collection montrée à vos amis.",
          "L'image que vous faites analyser est supprimée de nos serveurs dès que le résultat est connu.",
          "Si vous importez une vidéo, elle reste sur votre appareil : seule l'image que vous y choisissez est envoyée — ou, si vous acceptez l'analyse automatique, quelques images réduites de la vidéo, analysées par une IA et jamais conservées par Spotto.",
          "Pour élargir les résultats, Spotto peut chercher la même pièce dans d'autres boutiques : une IA lit les titres et les noms de sites des premiers résultats, jamais votre image ni vos mots, et écrit une courte recherche. Si vous lancez « Que cherchez-vous ? », vos mots sont envoyés à un moteur de recherche, sans votre nom ni votre e-mail.",
          "Le partage de statistiques d'usage est facultatif, et se retire à tout moment.",
          "Vous pouvez à tout moment télécharger vos données ou supprimer votre compte, depuis les Réglages.",
        ],
      ],
    },
    {
      title: "Qui est responsable de vos données",
      blocks: [
        `Le responsable du traitement est l'éditeur de Spotto : ${PUBLISHER.name}, ${PUBLISHER.status}, ${PUBLISHER.address}.`,
        `Pour toute question sur vos données ou pour exercer vos droits : ${PUBLISHER.email}.`,
      ],
    },
    {
      title: "Les données que nous utilisons",
      blocks: [
        "Votre compte : votre adresse e-mail et votre mot de passe. Le mot de passe n'est jamais conservé en clair : nous ne le connaissons pas.",
        "Votre profil : nom d'utilisateur, nom affiché, bio, photo de profil, vos abonnés et vos abonnements.",
        "Vos recherches (Spotter) : l'image ou le lien (TikTok, Instagram, Pinterest) que vous soumettez, la zone que vous sélectionnez, puis les résultats proposés (nom de la pièce, image, prix, marchand, lien), y compris ceux trouvés dans d'autres boutiques ou avec vos mots, avec leur origine. L'historique de vos recherches vous est remontré (« Récemment spottées ») ; il est conservé 12 mois (voir « Combien de temps »). Sous une photo, les mots que vous tapez servent seulement à trier les propositions : notre serveur ne les envoie pas avec l'image à la recherche visuelle, et ne les enregistre pas. Quand rien de sûr n'est trouvé, Spotto peut vous proposer, sur l'écran des résultats, la question « Que cherchez-vous ? ». Si vous lancez cette recherche, les mots du champ (il peut être déjà rempli avec ceux tapés sous la photo ; vous pouvez les modifier) sont envoyés par notre serveur à SerpApi, puis à Google Shopping (voir « Nos prestataires et les services tiers »). Spotto n'enregistre pas ces mots : ni avec la recherche, ni dans les journaux du serveur, ni dans son cache (voir « Combien de temps »). Il garde seulement l'heure et l'issue de cette recherche, et les pièces trouvées, enregistrées avec la recherche comme les autres résultats. Pour compléter les résultats, Spotto peut aussi chercher la même pièce dans d'autres boutiques : une IA (Anthropic) lit les titres et les noms de sites des premiers résultats, jamais votre image ni vos mots, et écrit une courte recherche, envoyée à Google Shopping par SerpApi. Les recherches faites jusqu'au 27 octobre 2026 gardent le texte que vous aviez éventuellement ajouté, jusqu'à leur suppression (voir « Combien de temps »). Si vous importez une vidéo (60 secondes et 100 Mo au plus), elle est lue uniquement sur votre appareil : la vidéo n'est jamais envoyée à nos serveurs ni conservée par Spotto ; seule l'image choisie est envoyée, comme une photo. Si vous acceptez l'analyse automatique, votre appareil choisit au plus 12 images nettes de la vidéo, réduites (512 pixels de côté), et les envoie avec votre description à notre serveur, qui les transmet à Anthropic pour repérer les meilleurs moments et la pièce (voir « Nos prestataires et les services tiers »). Ces images et votre description ne sont jamais enregistrées par Spotto : notre serveur les efface dès la réponse.",
        "Votre Vault et vos Envies : les pièces que vous y ajoutez (nom, catégorie, photo, lien vers la pièce d'origine).",
        "Vos publications et interactions : photos, légendes, visibilité choisie, commentaires, « j'aime », notifications, comptes bloqués et signalements que vous faites.",
        "Vos messages privés : le texte de vos messages, l'envie que vous y joignez (son titre, son prix, le lien vers la boutique et une copie de son image faite par Spotto), leur date, et l'état de vos conversations (invitation envoyée, acceptée ou refusée, messages lus). Seuls vous et la personne avec qui vous échangez les voyez. L'équipe de modération ne lit que les messages signalés, avec quelques messages autour pour comprendre le contexte. Ils sont conservés jusqu'à la suppression de votre compte, ou de celui de la personne avec qui vous échangez : la conversation disparaît alors pour vous deux. [À vérifier : base légale retenue (exécution du contrat), durée de conservation, et information de la personne qui reçoit une invitation.]",
        "Vos collections d'Envies : leur nom, qui les voit et les Envies que vous y rangez. Une collection reste privée tant que vous ne choisissez pas « Mes amis ». Vos amis, c'est-à-dire les membres que vous suivez et qui vous suivent, voient alors son nom et, pour chaque Envie, son titre, une copie de son image faite par Spotto, son prix et le lien vers la boutique ; jamais vos notes. Un compte bloqué, dans un sens ou dans l'autre, ne voit rien. La copie de l'image est effacée dès que l'Envie n'est plus montrée à vos amis, et tout part avec la suppression de votre compte. Un ami peut signaler une collection : l'équipe de modération voit alors son nom et ses dernières Envies (titre et copie de l'image), et peut la masquer à vos amis ou retirer la copie d'une image ; vous en êtes prévenu, avec le motif. [À vérifier : base légale retenue (exécution du contrat), et information des amis qui voient ces collections.]",
        "Vos alertes prix et stock : les Envies dont vous allumez la cloche et ce que vous choisissez de suivre (baisse de prix, retour en stock), l'interrupteur « Alertes prix et stock » des Réglages (coupé par défaut) et vos signalements « Plus disponible ». Pour détecter une baisse de prix ou un retour en stock dans la même boutique, les résultats des recherches et des achats faits dans Spotto, et les signalements « Plus disponible » des membres, sont comparés avec les Envies gardées par les autres membres. Une alerte est envoyée tout de suite, dès que la baisse ou le retour en stock est constaté. Personne n'est identifié à personne : une alerte ne dit jamais qui a cherché, acheté ou signalé la pièce, ni qui d'autre la suit, et Spotto ne garde avec une alerte, ni avec le suivi d'une Envie, ni l'auteur de la recherche, ni l'acheteur, ni l'auteur du signalement : aucun membre ne peut savoir qui c'était. Votre Vault reste visible par vous seul : un achat n'est montré aux autres que si vous choisissez de le publier. Pour chaque Envie, Spotto garde seulement une empreinte de la pièce (jamais son lien), le nom de la boutique, le prix de référence et le dernier prix vu (avec leur devise et le pays de la recherche), l'état du stock et leurs dates au jour près, jusqu'à ce que vous retiriez l'Envie ou supprimiez votre compte. Pour envoyer une alerte, Spotto garde en interne l'heure à laquelle elle a été préparée et envoyée. Les alertes sont effacées au bout de 30 jours ; vos signalements « Plus disponible » aussi (ils servent à limiter les abus et figurent dans l'export de vos données). Si vous recevez les notifications des alertes sur votre iPhone, chacune passe par Expo (650 Industries, Inc., États-Unis), puis par le service de notifications d'Apple (Apple Inc., États-Unis) ; elle contient « Spotto », le titre de la pièce, la boutique et le prix (ou « 3 de vos envies ont du nouveau ») et un identifiant de l'Envie, jamais le nom d'un autre membre. [À vérifier : base légale retenue (exécution du contrat, ou intérêt légitime pour la comparaison avec les Envies des autres membres), information des membres dont les recherches et les achats servent à cette comparaison, durées de conservation, et nouvelle version datée de cette politique avant la mise en ligne des alertes.]",
        "Vos clics vers les marchands : la pièce concernée, l'endroit de l'app d'où vous avez cliqué, la date, et l'identification technique de votre navigateur ou de votre téléphone (« user agent »).",
        "Vos consentements : la date et la version des documents que vous avez acceptés, votre déclaration d'avoir au moins 15 ans, et vos choix (accord, refus ou retrait) pour les statistiques d'usage et l'analyse automatique des vidéos.",
        "Des données techniques : comme tout serveur web, le nôtre reçoit votre adresse IP et des informations techniques à chaque requête ; elles figurent dans ses journaux, utilisés pour la sécurité et la correction des erreurs.",
        "Des rapports d'erreur : quand une erreur survient dans l'app ou sur notre serveur, un rapport technique est créé (nature de l'erreur, écran ou fonction concernée, type de navigateur, ou modèle de téléphone et version du système), avec l'identifiant interne de votre compte — jamais votre nom, votre e-mail, vos contenus, ni les paramètres des adresses consultées. Si l'app iPhone se ferme brutalement (plantage), le rapport contient aussi un identifiant d'installation pseudonyme : un code propre à votre téléphone et à l'app, qui ne contient ni votre nom ni votre e-mail.",
        "Des statistiques d'usage, SEULEMENT si vous l'acceptez (case facultative, décochée par défaut) : les actions que vous faites dans l'app (par exemple lancer une recherche, ajouter une pièce, publier, commenter, suivre un compte), avec le seul identifiant interne de votre compte et quelques précisions choisies à l'avance (catégorie, visibilité choisie, nombre de résultats…). Jamais votre nom, votre e-mail, les mots que vous tapez, le texte de vos commentaires ou légendes, ni les adresses de vos images.",
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
          "Détecter et corriger les erreurs (rapports d'erreur) : notre intérêt légitime à assurer le bon fonctionnement du service.",
          "Comprendre comment Spotto est utilisé pour l'améliorer (statistiques d'usage) : votre consentement, que vous pouvez retirer à tout moment (Réglages → Vos données) ; le retrait arrête la collecte immédiatement.",
          "Analyser automatiquement une vidéo (quelques images réduites envoyées à Anthropic) : votre consentement, demandé à la première utilisation, que vous pouvez retirer à tout moment (Réglages → Vos données). Sans lui, aucune image ne part : vous choisissez l'image vous-même.",
          "Chercher la même pièce dans d'autres boutiques (titres et noms de sites des premiers résultats envoyés à Anthropic, courte recherche envoyée à SerpApi et Google) : exécution du contrat qui nous lie. Cet envoi ne contient aucune image et ne dépend pas du consentement à l'analyse des vidéos. [À vérifier : exécution du contrat ou intérêt légitime.]",
          "Chercher avec vos mots, quand vous lancez « Que cherchez-vous ? » : exécution du contrat qui nous lie, à votre demande. [À vérifier : base retenue.]",
          "Garder 24 heures, sans lien avec votre compte, les réponses déjà obtenues, pour ne pas refaire les mêmes recherches et répondre plus vite : notre intérêt légitime. [À vérifier : base retenue.]",
        ],
        "[À vérifier : bases légales retenues, à faire valider par un professionnel — notamment l'intérêt légitime retenu pour les rapports d'erreur, et la base retenue pour l'envoi à Anthropic des titres des résultats, sans consentement.]",
      ],
    },
    {
      title: "Qui peut voir quoi dans Spotto",
      blocks: [
        [
          "Votre Vault : vous seul. Vos Envies : vous seul, sauf celles que vous rangez dans une collection montrée à vos amis.",
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
          "Supabase (Supabase Pte. Ltd., Singapour) : base de données, stockage des photos et authentification. Vos données y sont hébergées dans l'Union européenne (Irlande).",
          "Render (Render Services, Inc., États-Unis) : hébergement de notre serveur, situé dans l'Union européenne (Francfort, Allemagne), et du site. Toutes les requêtes de l'app passent par ce serveur.",
          "SerpApi (SerpApi, LLC, États-Unis) : reçoit un lien temporaire (valable 5 minutes) vers l'image à analyser ; il la transmet à la recherche visuelle de Google (Google Lens, Google LLC, États-Unis), qui télécharge l'image pour trouver les pièces correspondantes. Si la même image, avec le même cadrage, a déjà été analysée dans les 24 heures, la réponse gardée peut être réutilisée sans la renvoyer (voir « Combien de temps »). Pour chercher la pièce dans d'autres boutiques, SerpApi reçoit aussi, en texte, la courte recherche écrite par l'IA (voir Anthropic ci-dessous) et, si vous lancez « Que cherchez-vous ? », vos mots ; il les transmet à Google Shopping (Google LLC, États-Unis). Chaque demande indique aussi le pays et la langue de la recherche : la France et le français si l'app est en français ; si elle est en anglais, la région de votre appareil (à défaut, les États-Unis). Ces demandes partent de notre serveur, sans votre nom, votre e-mail ni votre adresse IP. Aucun identifiant de votre compte ne leur est transmis.",
          "Sentry (Functional Software, Inc., États-Unis) : rapports d'erreur de l'app et du serveur. Données hébergées dans l'Union européenne (Francfort, Allemagne).",
          "PostHog (PostHog Inc., États-Unis) : statistiques d'usage, uniquement avec votre accord. Données hébergées dans l'Union européenne (Francfort, Allemagne).",
          "Expo (650 Industries, Inc., États-Unis) : si vous activez sur votre iPhone les notifications de messages ou celles des alertes prix et stock, notre serveur lui confie chaque notification, qu'il transmet au service de notifications d'Apple (Apple Inc., États-Unis) pour qu'elle s'affiche sur votre iPhone. Une notification de message contient seulement « Spotto », le nom d'utilisateur de la personne qui vous écrit (par exemple « Nouveau message de @alexis ») et un identifiant de la conversation, jamais le texte du message ni l'envie jointe. Une notification d'alerte contient « Spotto », le titre de la pièce, la boutique et le prix (ou « 3 de vos envies ont du nouveau ») et un identifiant de l'Envie, jamais qui a cherché, acheté ou signalé la pièce. Pour cela, Spotto garde l'adresse technique de votre appareil, avec ce qu'il reçoit (messages, alertes), tant que les notifications de messages ou celles des alertes y sont activées ; elle est effacée quand vous coupez les deux, quand vous vous déconnectez ou quand vous supprimez votre compte. [À vérifier : rôle d'Expo (sous-traitant), garanties encadrant ce transfert vers les États-Unis, et durées de conservation chez Expo et Apple.]",
          "Anthropic (Anthropic, PBC, États-Unis) : son IA (Claude) sert à deux choses. Si vous acceptez l'analyse automatique des vidéos, elle reçoit de notre serveur au plus 12 images réduites de la vidéo et votre description, et indique les meilleurs moments et l'emplacement de la pièce. Pour chercher la pièce dans d'autres boutiques, elle reçoit aussi de notre serveur, lors de vos recherches où la recherche visuelle a trouvé des pièces, les titres et les noms de sites des 15 premiers résultats (par exemple « Baskets Marque Exemple X-200 cuir blanc — boutique-b.fr »), avec le pays et la langue de la recherche, et écrit une courte recherche de 2 à 8 mots. Pour cela, elle ne reçoit ni image, ni prix, ni vos mots, et cet envoi ne dépend pas de votre choix sur l'analyse des vidéos. Aucune autre donnée vous concernant (nom, e-mail, identifiant) ne lui est transmise. Anthropic agit pour notre compte, comme sous-traitant, selon son accord de traitement des données. Ce que prévoient ses conditions et sa documentation : il ne peut pas entraîner ses modèles sur ces données ; il les supprime automatiquement de ses systèmes au plus tard 30 jours après leur réception, et pour le modèle utilisé, il ne les conserve pas par défaut. Exceptions : une obligation légale, ou un contenu signalé par ses contrôles automatiques de sécurité, qu'il peut alors conserver jusqu'à 2 ans (et jusqu'à 7 ans les scores attribués par ces contrôles). Ses données sont stockées aux États-Unis ; l'analyse elle-même peut avoir lieu dans un autre pays où Anthropic fait fonctionner ses modèles. [À vérifier : que l'accord de traitement et ces conditions valent aussi pour l'envoi des titres (même compte, même modèle).]",
        ],
        "Quand vous collez un lien TikTok ou Instagram, notre serveur demande à TikTok ou à Meta l'aperçu public de la vidéo : seul le lien leur est transmis, jamais votre identité.",
        "Les images des pièces proposées sont affichées directement depuis les sites des marchands et de Google. Votre téléphone ou votre navigateur les télécharge chez eux : ils reçoivent donc votre adresse IP et les informations techniques habituelles d'une requête web. Quand vous ouvrez un lien vers un marchand, vous quittez Spotto : sa propre politique de confidentialité s'applique. Parmi les pièces trouvées dans d'autres boutiques ou avec vos mots, quand Google ne fournit pas de lien direct vers le marchand, « Voir l'offre » ouvre la page de la pièce sur Google : c'est alors la politique de confidentialité de Google qui s'applique.",
        "Nous pouvons enfin communiquer des données aux autorités lorsque la loi nous y oblige.",
      ],
    },
    {
      title: "Transferts hors de l'Union européenne",
      blocks: [
        "Certaines données quittent ou peuvent quitter l'Union européenne :",
        [
          "l'image que vous faites analyser : envoyée à SerpApi puis à Google, aux États-Unis ;",
          "la courte recherche écrite par l'IA et, si vous lancez « Que cherchez-vous ? », vos mots, avec le pays et la langue de la recherche : envoyés à SerpApi puis à Google (Google Shopping), aux États-Unis ;",
          "les titres et les noms de sites des premiers résultats, avec le pays et la langue de la recherche : envoyés à Anthropic, aux États-Unis, et qui peuvent être traités dans d'autres pays où Anthropic fait fonctionner ses modèles ;",
          "si vous acceptez l'analyse automatique des vidéos : les images réduites et votre description, envoyées à Anthropic, aux États-Unis, et qui peuvent être traitées dans d'autres pays où Anthropic fait fonctionner ses modèles ;",
          "les données qui passent par notre serveur (chaque requête de l'app, avec votre adresse IP, et les données que vous consultez ou envoyez) : le serveur est situé dans l'Union européenne (Francfort), mais Render étant une société américaine, un accès depuis les États-Unis (maintenance, assistance) ne peut pas être exclu ; il en va de même pour les journaux techniques du serveur (adresse IP, informations de la requête), conservés chez Render (voir « Combien de temps ») ;",
          "les données hébergées chez Supabase : stockées en Irlande, mais Supabase étant une société établie à Singapour, un accès depuis l'extérieur de l'Union européenne (maintenance, assistance) ne peut pas être exclu ;",
          "votre adresse IP : reçue par les sites des marchands et par Google lorsque l'app affiche leurs images, où qu'ils soient établis ;",
          "les rapports d'erreur (Sentry) et, si vous les acceptez, les statistiques d'usage (PostHog) : stockés dans l'Union européenne (Francfort), mais ces sociétés étant américaines, un accès depuis les États-Unis (maintenance, assistance) ne peut pas être exclu. Sentry déclare participer au « Data Privacy Framework » UE–États-Unis.",
        ],
        "[À vérifier : garanties encadrant chacun de ces transferts — certification « Data Privacy Framework » de la société, ou clauses contractuelles types de la Commission européenne signées avec elle — et situation de Google, qui reçoit l'image et les textes de recherche par l'intermédiaire de SerpApi sans contrat direct avec l'éditeur. Anthropic : clauses contractuelles types (modules 2 et 3) prévues par son accord de traitement des données ; certification « Data Privacy Framework » non mentionnée dans cet accord ; à confirmer pour l'envoi des titres des résultats.]",
      ],
    },
    {
      title: "Combien de temps",
      blocks: [
        [
          "L'image que vous faites analyser : supprimée de nos serveurs dès la réponse de la recherche, qu'elle ait réussi ou non (quelques secondes).",
          "Les images réduites d'une vidéo envoyées pour l'analyse automatique : jamais enregistrées par Spotto ; notre serveur les garde en mémoire le temps de la réponse (quelques secondes), puis les efface. Chez Anthropic : voir « Nos prestataires et les services tiers ».",
          "Les mots de « Que cherchez-vous ? » : jamais enregistrés par Spotto ; notre serveur les garde en mémoire le temps de la recherche (quelques secondes), puis les efface. Chez SerpApi et Google : [À vérifier : durée de conservation des textes de recherche].",
          "Les réponses déjà obtenues (cache) : pour ne pas refaire les mêmes recherches, notre serveur garde les réponses de la recherche visuelle, de l'IA et de la recherche en boutiques (pièces trouvées, courte recherche écrite par l'IA), avec le pays et la langue de la recherche. Celles de la recherche visuelle sont rangées sous une empreinte de l'image recadrée : un code qui ne permet pas de reconstituer l'image, jamais gardée elle-même. Ces réponses ne sont reliées ni à votre compte ni à votre recherche, et vos mots n'y vont jamais. Si vous, ou une autre personne, relancez la même image avec le même cadrage, la même langue et le même pays dans les 24 heures, elles sont réutilisées. Chaque réponse cesse d'être utilisée au bout de 24 heures, puis elle est effacée lors de la recherche suivante commencée sur Spotto.",
          "L'historique de vos recherches (image analysée exceptée, voir ci-dessus), avec toutes les pièces proposées, y compris celles trouvées dans d'autres boutiques ou avec vos mots : 12 mois. Les recherches plus anciennes sont supprimées, avec leurs résultats et vos clics vers les marchands qui en dépendent, lors de votre recherche suivante. Exception : une recherche dont vous avez gardé une pièce (Vault, Envies, pièce montrée dans une publication) est conservée tant que cette pièce l'est.",
          "Votre compte et tout ce qui s'y rattache : tant que votre compte existe.",
          "Un compte sans aucune connexion pendant 3 ans est supprimé, avec toutes ses données. Un e-mail vous prévient avant la suppression.",
          "Les journaux techniques du serveur : [À vérifier : durée de conservation chez notre hébergeur].",
          "Les rapports d'erreur (Sentry) et les statistiques d'usage (PostHog) : [À vérifier : durées de conservation de ces services pour notre offre, et durée à retenir].",
        ],
        "Quand vous supprimez votre compte, vos données et vos photos sont effacées immédiatement et définitivement : profil, recherches, Vault, Envies, collections, publications, commentaires, « j'aime », abonnements, notifications, clics vers les marchands, consentements. Les réponses du cache, qui ne sont reliées à aucun compte, ne sont pas concernées : elles s'effacent d'elles-mêmes (voir ci-dessus).",
      ],
    },
    {
      title: "Sur votre téléphone ou dans votre navigateur",
      blocks: [
        "Spotto enregistre sur votre appareil votre session de connexion, pour que vous n'ayez pas à vous reconnecter, une copie des images déjà affichées, pour les montrer plus vite, le fait que vous avez déjà vu une information de mise à jour, pour ne pas vous la remontrer, ainsi que la langue et le thème (clair, sombre ou celui de l'appareil) que vous avez choisis. Ces éléments sont indispensables au fonctionnement de l'app. Pendant que vous choisissez une image dans une vidéo, ou que l'analyse automatique s'en sert, l'app iPhone garde une copie temporaire de la vidéo, effacée dès que vous quittez la recherche ; les petites images préparées pour l'analyse automatique sont effacées dès leur envoi. Sur le site, la vidéo est lue par votre navigateur, sans être copiée.",
        "Spotto n'utilise aucun traceur publicitaire ni aucun cookie publicitaire. Les statistiques d'usage, si vous les acceptez, sont envoyées directement, sans cookie ni stockage sur votre appareil, et sans géolocalisation par votre adresse IP.",
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
          "Accepter ou retirer le partage des statistiques d'usage : Réglages → Vos données.",
          "Accepter ou retirer l'analyse automatique des vidéos : Réglages → Vos données.",
          `Pour toute autre demande : ${PUBLISHER.email}.`,
        ],
        "Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (cnil.fr).",
      ],
    },
    {
      title: "Âge minimum",
      blocks: [
        "Spotto est réservé aux personnes âgées d'au moins 15 ans. Vous le certifiez à l'inscription, et cette déclaration est enregistrée avec sa date ; aucune vérification d'âge n'est effectuée.",
      ],
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
        "Nous pouvons faire évoluer cette politique. Chaque version est datée, et l'app enregistre la version que vous avez acceptée. Lorsqu'un changement demande votre accord, l'app vous le signale dans les Réglages. Lorsqu'il s'agit d'une simple information (par exemple un changement du lieu d'hébergement), un court message vous en informe, avec un lien vers cette page. [À vérifier : quels changements exigent une nouvelle acceptation, et lesquels une simple information.]",
      ],
    },
  ],
};
