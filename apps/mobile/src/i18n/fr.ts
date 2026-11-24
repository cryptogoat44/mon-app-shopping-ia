// Tous les textes de l'interface. Aucun texte en dur dans les composants.
// Vouvoiement, phrases courtes, verbes d'action. Voir la section 6 du brief
// pour les règles complètes.

import { MINIMUM_AGE, SEARCH_QUERY_MAX_LENGTH } from "@monapp/shared-types";
import { APP_FILE_SLUG, APP_NAME_DISPLAY as BRAND } from "../constants/brand";

export const fr = {
  common: {
    back: "Retour",
    cancel: "Annuler",
    close: "Fermer",
    retry: "Réessayer",
    moreOptions: "Plus d'options",
    viewProfile: (name: string) => `Voir le profil de ${name}`,
    genericError: "Une erreur est survenue, réessayez.",
    unknownServerError: "Erreur inconnue du serveur.",
    /** Texte cité (ex. ce que la personne cherche), avec les guillemets de la langue. */
    quoted: (text: string) => `« ${text} »`,
    photoUnavailable: "Cette photo n'a pas pu être récupérée. Si elle est stockée sur iCloud, vérifiez votre connexion, puis réessayez.",
    offline: "Vous semblez hors ligne. Vérifiez votre connexion internet, puis réessayez.",
    /** Lot 5, partie B : image copiée retirée par la modération. */
    imageUnavailable: "Image indisponible",
  },
  tabs: {
    feed: "Fil",
    profile: "Profil",
    unread: (label: string, n: number) => `${label}, ${n} non lue${n > 1 ? "s" : ""}`,
  },
  preferences: {
    language: "Langue",
    languageNames: { fr: "Français", en: "English" },
    appearance: "Apparence",
    themeNames: { system: "Système", light: "Clair", dark: "Sombre" },
    appearanceHint: "« Système » suit le réglage de votre appareil.",
  },
  welcome: {
    baseline: "L'identification discrète des pièces qui comptent.",
    explain: `Ajoutez une vidéo ou une photo. ${BRAND} retrouve la pièce et vous dit où l'acheter.`,
    cta: "Commencer",
    login: "Déjà un compte ? Se connecter",
    terms: "Conditions d'utilisation",
    privacy: "Confidentialité",
  },
  vaultLabels: {
    categories: {
      clothing: "Vêtements",
      watches: "Montres",
      accessories: "Accessoires",
      shoes: "Chaussures",
      bags: "Sacs",
      home: "Maison",
      other: "Autre",
    },
    privacy: { public: "Public", followers: "Abonnés", private: "Privé" },
  },
  post: {
    photoBy: (name: string) => `Photo publiée par ${name}`,
    like: "Aimer",
    unlike: "Je n'aime plus",
    viewPieceAt: (piece: string, merchant: string) => `Voir ${piece} chez ${merchant}`,
    shareMessage: (name: string, caption: string | null) => `${name} sur ${BRAND}${caption ? ` : « ${caption} »` : ""}`,
    // Lot 5 : publication « envie » (jamais un achat).
    wishLabel: "Envie",
    wishBy: (name: string) => `Envie de ${name}`,
  },
  crop: {
    label: "Zone analysée",
    // Lot entourer la pièce : sans tracer (VoiceOver, motricité), le bouton choisit l'image entière.
    hint: (instruction: string, button: string) => `${instruction}, ou touchez « ${button} ».`,
    value: (width: number, height: number) => `${width} % de la largeur, ${height} % de la hauteur`,
    none: "Pièce pas encore entourée",
    whole: "Toute l'image",
  },
  peopleSearch: {
    placeholder: "Nom ou @pseudo",
    label: "Rechercher un profil",
    empty: "Aucun profil trouvé.",
    error: "La recherche a échoué.",
    following: "Suivi(e)",
    // Retours du build 2 : titre de l'écran, à côté de « ‹ ».
    title: "Rechercher un profil",
  },
  completeProfile: {
    title: "Dernière étape",
    subtitle: "Choisissez comment on vous reconnaît sur l'app.",
    continue: "Continuer",
  },
  merchant: {
    viewAt: (merchant: string | null) => (merchant ? `Voir chez ${merchant}` : "Voir chez le marchand"),
  },
  spotter: {
    title: "Spotter",
    close: "Fermer",
    lead: "Retrouvez une pièce vue dans une vidéo ou sur une photo.",
    linkPlaceholder: "Collez ou tapez un lien",
    paste: "Coller",
    pasteEmpty: "Le presse-papiers ne contient pas de lien.",
    pasteDenied: "Collez le lien directement dans le champ.",
    clearLink: "Effacer le lien",
    preparing: "Préparation…",
    addVideo: "Ajouter une vidéo",
    addPhoto: "Ajouter une photo",
    otherVideo: "Choisir une autre vidéo",
    latestVideo: "Votre dernière vidéo",
    latestVideoLabel: (duration: string) => `Aperçu de votre dernière vidéo, ${duration}`,
    latestVideoAsk: "Proposer automatiquement ma dernière vidéo ?",
    latestVideoAskBody:
      `${BRAND} peut afficher ici la dernière vidéo de votre galerie, prête à être analysée. iOS vous demandera alors l'accès à vos photos. La vidéo reste sur votre iPhone : seules quelques images en partent, quand vous appuyez sur « Lancer ».`,
    latestVideoYes: "Oui, me la proposer",
    latestVideoNo: "Non merci",
    latestVideoAskNote: "Votre réponse ne change rien d'autre : « Ajouter une vidéo » reste disponible. Modifiable à tout moment dans Réglages.",
    latestVideoNoAccess:
      `Sans l'accès complet à vos photos, ${BRAND} ne peut pas repérer votre dernière vidéo : choisissez-la avec « Ajouter une vidéo ». L'accès se modifie dans les Réglages de l'iPhone.`,
    latestVideoEmpty: "Aucune vidéo dans votre galerie pour l'instant : la plus récente apparaîtra ici.",
    latestVideoChoiceFailed: "Votre réponse n'a pas pu être enregistrée. Réessayez.",
    recentlySpotted: "Récemment spottées",
    detected: {
      tiktok: "Vidéo TikTok reconnue",
      instagram: "Publication Instagram reconnue",
      pinterest: "Épingle Pinterest reconnue",
    },
    platformName: { tiktok: "TikTok", instagram: "Instagram", pinterest: "Pinterest" },
    notALink: "Ce texte n'est pas un lien. Dans TikTok, Instagram ou Pinterest, touchez « Partager » puis « Copier le lien », et collez-le ici.",
    notAVideo: {
      tiktok: "Ce lien mène à un profil ou à une page TikTok, pas à une vidéo. Ouvrez la vidéo, touchez « Partager » puis « Copier le lien ».",
      instagram: "Ce lien mène à un profil ou à une page Instagram, pas à une publication. Ouvrez la publication ou le reel, touchez « Partager » puis « Copier le lien ».",
      pinterest: "Ce lien mène à un tableau ou à une page Pinterest, pas à une épingle. Ouvrez l'épingle, touchez « Partager » puis « Copier le lien ».",
    },
    unsupportedLink:
      `Ce lien n'est pas pris en charge. ${BRAND} reconnaît les liens TikTok, Instagram et Pinterest ; pour tout autre site, importez une capture d'écran.`,
    prepareError: "La préparation a échoué. Vérifiez votre connexion, puis réessayez.",
    networkError: "Connexion impossible. Vérifiez votre connexion internet, puis réessayez.",
    serverError: `${BRAND} ne répond pas pour le moment. Réessayez dans une minute.`,
    // Retours du build 2 : la carte « Votre dernière vidéo » repliée sur une ligne, et sa croix
    // (elle éteint la proposition, exactement comme l'interrupteur de Réglages).
    latestVideoExpand: "Rechercher dans cette vidéo",
    latestVideoDismiss: "Ne plus proposer ma dernière vidéo",
    latestVideoDismissed: "C'est noté : votre dernière vidéo ne vous sera plus proposée. Vous pouvez réactiver cette proposition dans Réglages.",
    latestVideoSettingsLink: "Ouvrir Réglages",
  },
  // Lot 4 : choix d'une image dans une vidéo importée (la vidéo reste sur l'appareil).
  video: {
    title: "Choisissez l'image",
    caption: "Faites glisser le curseur jusqu'au moment où la pièce est bien visible.",
    privacy: "La vidéo reste sur votre appareil : seule l'image choisie est envoyée.",
    preparing: "Préparation de la vidéo…",
    scrubber: "Moment de la vidéo",
    position: (current: string, total: string) => `${current} sur ${total}`,
    frameLabel: (time: string) => `Image de la vidéo à ${time}`,
    stepBack: "Reculer d'un dixième de seconde",
    stepForward: "Avancer d'un dixième de seconde",
    stepBackShort: "− 0,1 s",
    stepForwardShort: "+ 0,1 s",
    /** Séparateur des dixièmes de seconde (« 0:06,2 »). */
    decimalSeparator: ",",
    use: "Utiliser cette image",
    using: "Préparation de l'image…",
    another: "Choisir une autre vidéo",
    frameError: "Cette image n'a pas pu être extraite. Réessayez, ou choisissez un autre moment.",
    loadError: "La vidéo n'a pas pu être préparée.",
    tooLong: (duration: string) => `Cette vidéo dure ${duration} : choisissez une vidéo de 60 secondes au plus, ou raccourcissez-la d'abord.`,
    tooLarge: (megabytes: number) => `Cette vidéo pèse ${megabytes} Mo : 100 Mo au plus. Raccourcissez-la, ou ajoutez plutôt une capture d'écran du bon moment.`,
    unreadable: "Cette vidéo n'a pas pu être lue. Essayez une autre vidéo, ou ajoutez plutôt une capture d'écran du bon moment.",
    unavailable: "Cette vidéo n'a pas pu être récupérée. Si elle est stockée sur iCloud, vérifiez votre connexion, puis réessayez.",
    unreadableWeb:
      "Ce navigateur ne sait pas lire cette vidéo (les vidéos HEVC des iPhone, par exemple, ne s'ouvrent pas partout). Essayez avec Safari, ou ajoutez plutôt une capture d'écran du bon moment.",
  },
  // Analyse automatique d'une vidéo (lot 4, temps 1 bis) : accord, replis.
  videoAuto: {
    chooseMyself: "Choisir l'image moi-même",
    privacyNote: `La vidéo reste sur votre appareil. Avec votre accord, quelques images réduites sont analysées par une IA, sans être conservées par ${BRAND}.`,
    checkFailed: "L'analyse automatique n'a pas pu être préparée. Vérifiez votre connexion, puis réessayez.",
    consentTitle: "Analyse automatique de la vidéo",
    // Texte commun aux deux écrans d'accord (vidéo du téléphone, lien TikTok
    // ou Instagram), version « analyse-video-ia-2026-11-15 » : à changer avec
    // CONSENT_VERSIONS.analyse_video_ia (shared-types), jamais seul.
    consentBody: [
      `Pour trouver la pièce à votre place, ${BRAND} envoie quelques images réduites de la vidéo et votre description à un prestataire d'intelligence artificielle, Anthropic, situé aux États-Unis.`,
      "Vidéo de votre téléphone : 12 images au plus, extraites sur votre appareil. La vidéo entière ne quitte jamais votre appareil.",
      `Lien TikTok ou Instagram : le service vidéo de ${BRAND} récupère la vidéo publique de ce lien le temps de l'analyse, sans la conserver, et en tire 16 images au plus.`,
      `Ces images servent uniquement à repérer la pièce. ${BRAND} ne les conserve pas ; Anthropic ne peut pas s'en servir pour entraîner ses modèles et les supprime automatiquement, sous 30 jours au plus (exceptions décrites dans la politique de confidentialité).`,
      "Vous pouvez retirer votre accord à tout moment dans Réglages.",
    ],
    consentPolicy: "Lire la politique de confidentialité",
    accept: "Accepter",
    consentFailed: "Votre accord n'a pas pu être enregistré. Vérifiez votre connexion, puis réessayez.",
    notFoundTitle: "Pièce non repérée",
    notFound: "La pièce n'a pas été repérée dans la vidéo. Précisez votre description, ou choisissez l'image vous-même.",
    editQuery: "Modifier la description",
    failedTitle: "Analyse automatique interrompue",
    failure: {
      disabled: "L'analyse automatique n'est pas disponible pour le moment. Choisissez l'image vous-même.",
      user_limit: "Vous avez atteint la limite quotidienne d'analyses automatiques. Choisissez l'image vous-même, ou réessayez demain.",
      global_limit: "L'analyse automatique est très demandée aujourd'hui et momentanément indisponible. Choisissez l'image vous-même.",
      unavailable: "L'analyse automatique n'a pas abouti. Réessayez, ou choisissez l'image vous-même.",
      network: "Connexion impossible. Vérifiez votre connexion, puis réessayez.",
      video: "Cette vidéo n'a pas pu être analysée sur votre appareil. Choisissez l'image vous-même.",
    },
    tryAnother: (remaining: number) => `Essayer un autre moment (${remaining} restant${remaining > 1 ? "s" : ""})`,
  },
  // Parcours unique (lot 4 ter) : après le choix d'une vidéo ou d'une photo.
  launch: {
    title: "Que cherchez-vous ?",
    placeholder: "ex. veste en daim marron, sac noir",
    launch: "Lancer",
    chooseImage: "Choisir l'image",
    declinedNote: "Analyse automatique désactivée : vous choisirez l'image vous-même.",
    enableAi: "Activer l'analyse automatique",
    // Texte du fondateur (2026-10-25) : les mots ne servent qu'à l'IA.
    wordsHelpAi: "Ces mots aident l'IA à retrouver la pièce dans la vidéo.",
    // Photo (petit lot 2, décision du fondateur du 2026-10-27).
    photoLabel: "Quelle pièce ? (facultatif)",
    photoPlaceholder: "ex. la veste en cuir noir",
    // Texte du document pour l'avocat (2026-11-05, point 4.1), vrai interrupteurs coupés comme allumés.
    photoWordsNote:
      "Vos mots servent seulement à trier les propositions : ils ne partent pas avec l'image vers la recherche. Ils ne sont envoyés à un moteur de recherche que si vous lancez vous-même une recherche avec vos mots.",
    // Moment d'un lien vidéo analysé : la description (décision du fondateur
    // du 17 novembre 2026, recherche automatique quand rien n'a de prix).
    linkWordsNote:
      "Votre description trie les propositions : elle ne part pas avec l'image vers la recherche. Si aucune proposition n'affiche de prix, elle est envoyée à Google Shopping par notre prestataire SerpApi pour trouver des boutiques, sans votre nom ni votre e-mail.",
    // Montré tant que la pièce n'est pas entourée (rien de tracé, ou toute
    // l'image), avec ou sans mots (lots « premier essai » et « entourer la pièce »).
    frameHint: `Entourez la pièce seule, sans visage ni texte autour : ${BRAND} la retrouvera plus facilement.`,
    videoPreview: (duration: string) => `Aperçu de votre vidéo, ${duration}`,
    photoPreview: "Votre photo",
    // Titre de la vidéo sans l'analyse automatique (texte du fondateur, 2026-10-25).
    yourVideo: "Votre vidéo",
    waitingVideo: `${BRAND} repère la pièce…`,
    usualVideo: "Cela prend en général 15 à 30 secondes.",
  },
  // Site (lot 4 ter) : un onglet resté ouvert propose la version en ligne.
  siteVersion: {
    available: "Nouvelle version disponible.",
    reload: "Recharger",
  },
  // Lien collé (lot 4 ter) : une vidéo ne se lit pas depuis un lien, et son
  // image de couverture n'est jamais demandée.
  linkNotice: {
    title: "Une vidéo ne se lit pas depuis un lien",
    body: (how: string) =>
      `${BRAND} ne peut pas lire la vidéo à partir de son lien. Enregistrez votre écran pendant qu'elle passe (${how}), puis ajoutez cet enregistrement.`,
    how: {
      ios: "sur iPhone, depuis le Centre de contrôle",
      android: "sur Android, depuis les Réglages rapides",
      computer: "sur Mac : Cmd + Maj + 5 ; sur PC : Outil Capture d'écran",
    },
    addVideo: "Ajouter une vidéo",
  },
  // Lot « partager vers Spotto » : ce que la feuille de partage d'iOS remet à
  // Spotto. Textes à valider par le fondateur.
  share: {
    signInFirst: "Connectez-vous : ce que vous avez partagé s'ouvrira ensuite dans Spotter.",
    // Partage reçu pendant une recherche, une saisie ou une page à part : on
    // ne quitte pas l'écran, et rien ne s'ouvre tout seul ensuite ; l'onglet
    // Spotter porte une pastille en attendant (à valider).
    waiting: "Votre partage vous attend dans Spotter.",
    // VoiceOver : onglet Spotter marqué de cette pastille (à valider).
    tabWaiting: (label: string) => `${label}, un partage vous attend`,
    several: `${BRAND} ouvre un seul élément à la fois : partagez une seule photo ou une seule vidéo.`,
    unsupported: `${BRAND} ne peut pas ouvrir ce contenu. Partagez un lien TikTok, Instagram ou Pinterest, une capture d'écran, une photo ou une vidéo.`,
    unreadable: "Ce que vous avez partagé n'a pas pu être ouvert. Réessayez, ou ajoutez la photo ou la vidéo ci-dessous.",
    imageUnreadable: (button: string) => `Cette image n'a pas pu être ouverte. Réessayez, ou ajoutez-la avec « ${button} ».`,
  },
  // Lot « premier essai » : le bon geste (la capture d'écran d'abord),
  // « Comment ça marche », les Envies après « Garder », la boutique à
  // l'étranger et l'inscription. Textes à valider par le fondateur. Espaces
  // insécables avant « : » et « ? », dans « … » et avant « s » : jamais de
  // ponctuation seule en début de ligne.
  firstTry: {
    linkHelp: {
      title: "Le plus simple : une capture d'écran",
      lead: `${BRAND} ne peut pas lire une vidéo à partir de son lien. Montrez-lui plutôt la pièce :`,
      // Dernière étape, après les trois premières de preview.captureSteps.
      lastStep: (button: string) => `Revenez ici et touchez « ${button} ».`,
      addScreenshot: "Ajouter une capture d'écran",
      recording: (how: string) => `Vous préférez la vidéo ? Enregistrez votre écran pendant qu'elle passe (${how}), puis ajoutez l'enregistrement.`,
    },
    howItWorks: {
      title: "Comment ça marche",
      steps: (addPhoto: string) => [
        "Mettez la vidéo en pause quand la pièce est bien visible, et faites une capture d'écran.",
        `Ajoutez-la avec « ${addPhoto} », puis entourez la pièce.`,
        `${BRAND} vous montre où l'acheter, en 10 à 20 secondes.`,
      ],
    },
    kept: "Ajoutée à vos Envies",
    viewWishlist: "Voir mes Envies",
    foreignShop: "Boutique à l'étranger",
    signUp: {
      passwordHint: "Au moins 8 caractères",
      missing: (items: string) => `Pour continuer, il reste à ${items}.`,
      missingItem: {
        email: "indiquer votre e-mail",
        password: "choisir un mot de passe",
        confirmPassword: "confirmer le mot de passe",
        age: "certifier votre âge",
        consent: "accepter les conditions",
      },
      // Fin d'une liste : « a, b et c ».
      lastItem: (items: string, last: string) => `${items} et ${last}`,
      notReceived: "Rien reçu après quelques minutes ? Vérifiez les courriers indésirables, puis renvoyez l'e-mail.",
      resend: "Renvoyer l'e-mail",
      resending: "Envoi…",
      resendIn: (seconds: number) => `Renvoyer l'e-mail dans ${seconds} s`,
      resent: "E-mail renvoyé. Pensez à regarder aussi dans les courriers indésirables.",
    },
    // Parcours 3 (décision A1 du fondateur) : « Garder » allume l'alerte de
    // baisse de prix de la pièce ; la baisse se voit dans les Envies, même
    // interrupteur « Alertes prix et stock » coupé.
    keptWithAlert: "Ajoutée à vos Envies. Si son prix baisse, vous le verrez dans vos Envies.",
    turnOffAlert: "Couper l'alerte",
    alertTurnedOff: "Alerte coupée.",
  },
  // Mission « liens vidéo » : la vidéo TikTok ou Instagram, partagée ou
  // collée, s'ouvre dans son lecteur officiel (app iPhone) ; « Spotter ce
  // moment » prend l'instantané de ce que la vue montre. Sur le site, ou
  // lecteur coupé : l'écran « Spottez cette vidéo ». TEXTES À VALIDER PAR LE
  // FONDATEUR. Espaces insécables avant « : » et « ? », et dans « … ».
  player: {
    linkLabel: "Lien TikTok ou Instagram",
    linkHintWeb: "Les pièces déjà repérées dans cette vidéo s'affichent ici, avec la marche à suivre.",
    open: "Ouvrir la vidéo",
    opening: "Ouverture de la vidéo…",
    instruction: "Mettez la vidéo en pause quand la pièce est bien visible.",
    frameTitle: (platform: string) => `Vidéo ${platform}`,
    videoBy: (platform: string, handle: string) => `Vidéo ${platform} de @${handle}`,
    spot: "Spotter ce moment",
    taking: `${BRAND} prend l'image…`,
    privacy: (platform: string) => `Vidéo lue par ${platform}, sans téléchargement. Seule l'image de ce moment est envoyée, puis effacée de votre téléphone.`,
    tapToPlay: "Touchez la vidéo pour la lancer.",
    leaveLink: (platform: string) => `Ce lien s'ouvre dans ${platform}.`,
    openIn: (platform: string) => `Ouvrir dans ${platform}`,
    reloaded: "Le lecteur a redémarré : retrouvez le bon moment.",
    gate: {
      body: (platform: string) => `Cette vidéo est lue par ${platform}, qui peut utiliser ses propres traceurs.`,
      play: "Lire la vidéo ici",
      refuse: "Non merci",
      // Retours du build 2 : analyse allumée, « Non merci » mène à la recherche automatique.
      refuseAuto: "Non merci, chercher automatiquement",
    },
    howItWorksSteps: (spot: string) => [
      `Partagez la vidéo TikTok ou Instagram vers ${BRAND}, ou collez son lien.`,
      `Mettez-la en pause sur la pièce, touchez « ${spot} », puis entourez la pièce (si la vidéo ne peut pas être lue ici, ${BRAND} vous propose un autre moyen).`,
      `${BRAND} vous montre où l'acheter, en 10 à 20 secondes.`,
    ],
    linkNotice: {
      title: `Ce lien peut s'ouvrir dans ${BRAND}`,
      body: `Ouvrez-le ici : ${BRAND} vous aide à trouver la pièce de la vidéo.`,
      bodyWeb: "Ouvrez-le ici : vous verrez les pièces déjà repérées dans la vidéo, et comment la spotter.",
    },
    settings: {
      title: `Vidéos lues dans ${BRAND}`,
      on: "Vous avez accepté que les vidéos TikTok ou Instagram soient lues ici, dans leur lecteur officiel.",
      withdraw: "Retirer mon accord",
      withdrawn: "Accord retiré : la question vous sera reposée à la prochaine vidéo.",
    },
  },
  // Mission « liens vidéo » : écran de secours, pièces déjà repérées par
  // d'autres membres (jamais qui), lien en attente. TEXTES À VALIDER.
  videoLink: {
    fallbackTitle: "Spottez cette vidéo",
    fallbackLead: {
      notHere: "Cette vidéo ne peut pas être lue ici. Trois gestes suffisent :",
      refused: "La vidéo ne sera pas lue ici. Trois gestes suffisent :",
      snapshot: `${BRAND} n'a pas pu prendre l'image de ce moment. Trois gestes suffisent :`,
      unchecked: "Cette vidéo n'a pas pu être vérifiée pour le moment. Trois gestes suffisent :",
    },
    steps: [
      "Faites une capture d'écran quand la pièce est bien visible.",
      `Touchez « Recherche d'image » (iPhone compatibles, iOS 26 et suivants) ou Partager → ${BRAND}.`,
      "Entourez la pièce.",
    ],
    held: "Pendant 10 minutes, votre prochaine recherche sera associée à cette vidéo.",
    productsTitle: "Pièces déjà repérées dans cette vidéo",
    confirm: "C'est bien cette pièce",
    thanks: "Merci",
    confirmFailed: "Votre confirmation n'a pas pu être envoyée. Réessayez dans un instant.",
    firstToSpot: "Aucune pièce n'a encore été repérée dans cette vidéo : à vous de commencer.",
    attached: (handle: string) => `Associée à la vidéo de @${handle}`,
    attachedPlatform: (platform: string) => `Associée à la vidéo ${platform}`,
    detach: "Ne plus associer cette recherche à la vidéo",
    sharedAnonymously: "Les pièces trouvées seront ajoutées, sans votre nom, aux pièces repérées de cette vidéo.",
    webInstruction: "Faites une capture de la vidéo au bon moment, puis glissez-déposez ou collez l'image ici.",
    dropHint: "Sur ordinateur, vous pouvez aussi glisser-déposer une image sur cette page, ou la coller (Ctrl+V ou ⌘V).",
    notAnImage: "Ce fichier n'est pas une image. Déposez ou collez une capture d'écran.",
  },
  // Lot « vidéo auto » (décision du fondateur, 14 et 15 novembre 2026) : un
  // lien TikTok ou Instagram et ce que vous cherchez. La vidéo publique est
  // récupérée sans être gardée, l'IA trouve le moment ; la capture reste le repli.
  videoLinkAuto: {
    title: "Que cherchez-vous dans cette vidéo ?",
    placeholder: "ex. la veste en cuir beige de la fille à gauche",
    help: "Décrivez la pièce et, si besoin, où elle se trouve : l'IA s'en sert pour la retrouver dans la vidéo.",
    find: "Trouver la pièce",
    // Lien vidéo sans prix (17 novembre 2026) : la description peut aussi partir vers Google Shopping.
    // Lot « propositions » (21 novembre 2026) : la description devient facultative, et le nom de la pièce choisie suit le même chemin.
    privacy: `${BRAND} récupère la vidéo publique le temps de l'analyse, sans la conserver. Avec votre accord, quelques images, et votre description si vous en écrivez une, sont analysées par une IA. Si les résultats n'affichent aucun prix, votre description (ou le nom de la pièce choisie) est aussi envoyée à Google Shopping par notre prestataire SerpApi pour trouver des boutiques.`,
    query: {
      too_short: "Décrivez la pièce en quelques mots.",
      too_long: `Votre description est trop longue : ${SEARCH_QUERY_MAX_LENGTH} caractères au plus.`,
      link: "Décrivez la pièce avec des mots, sans lien.",
    },
    player: (platform: string) => `Regarder la vidéo dans le lecteur ${platform}`,
    capture: "Faire une capture à la place",
    captureLead: "Trois gestes suffisent :",
    backToAuto: "Trouver la pièce automatiquement",
    // Accord « analyse_video_ia » : le texte commun (videoAuto.consentBody) ; ici, seulement le refus.
    consentDecline: "Non merci, faire une capture",
    waiting: {
      title: "Analyse de la vidéo",
      steps: ["On récupère la vidéo…", "L'IA cherche la pièce…"],
      usual: "Cela prend en général 10 à 25 secondes.",
      slow: "C'est plus long que d'habitude. Patientez encore un peu, ou annulez pour faire une capture.",
      stepLabel: (step: string, current: boolean) => (current ? `${step} (en cours)` : step),
    },
    moments: {
      title: (count: number) => (count > 1 ? `${count} moments trouvés` : "Moment trouvé"),
      lead: (count: number) => (count > 1 ? "Le plus probable est sélectionné. Touchez un autre moment pour le choisir." : "Vérifiez que le cadre entoure bien la pièce."),
      choose: (rank: number, time: string) => `Moment ${rank}, à ${time}`,
      search: "Lancer la recherche",
      editQuery: "Modifier la description",
    },
    failedTitle: "La vidéo n'a pas pu être analysée",
    notFoundTitle: "Pièce non repérée",
    // Plan B en un geste (lot « recherche confiance ») : une phrase calme, sans
    // détail technique, puis un seul bouton : la capture d'écran, avec le lien
    // et la description gardés.
    privateTitle: "Vidéo privée ou supprimée",
    refused: {
      title: (platform: string) => `${platform} a refusé l'accès`,
      message: (platform: string) => `${platform} n'a pas laissé ${BRAND} récupérer cette vidéo, comme cela arrive parfois : une capture d'écran fera aussi bien l'affaire.`,
    },
    platformFallback: "TikTok ou Instagram",
    planB: {
      capture: "Faire une capture d'écran",
      kept: "Votre lien et votre description sont gardés.",
      keptQuery: (query: string) => `Votre description sera reprise avec la capture : « ${query} »`,
    },
    failure: {
      disabled: "L'analyse automatique des liens n'est pas disponible pour le moment : une capture d'écran fera l'affaire.",
      invalid_link: `Ce lien ne mène pas à une vidéo que ${BRAND} peut analyser : une capture d'écran fera l'affaire.`,
      invalid_query: `Décrivez la pièce en quelques mots, sans lien (${SEARCH_QUERY_MAX_LENGTH} caractères au plus).`,
      unavailable: "Cette vidéo n'a pas pu être récupérée pour le moment : une capture d'écran fera l'affaire.",
      private: `Cette vidéo est privée, réservée à certains comptes ou supprimée : ${BRAND} ne peut pas l'ouvrir, mais une capture d'écran suffit si vous la voyez encore.`,
      too_long: "Cette vidéo est trop longue pour l'analyse automatique : une capture d'écran du bon moment fera l'affaire.",
      timeout: "La vidéo a mis trop de temps à arriver : une capture d'écran fera l'affaire.",
      busy: "L'analyse automatique est très demandée en ce moment : une capture d'écran fera l'affaire.",
      no_moment: "La pièce n'a pas été repérée dans la vidéo : précisez votre description, ou faites une capture d'écran.",
      user_limit: "Vous avez atteint la limite quotidienne d'analyses automatiques : une capture d'écran fera l'affaire.",
      global_limit: "L'analyse automatique est très demandée aujourd'hui : une capture d'écran fera l'affaire.",
      rate_limited: "Trop de demandes d'un coup : une capture d'écran fera l'affaire, ou réessayez dans quelques minutes.",
      network: "Connexion impossible : vérifiez votre connexion, puis réessayez.",
    },
    // Lot « propositions » (Parcours 2, 21 novembre 2026) : « Voir les
    // propositions de l'IA » — l'IA nomme les pièces qu'elle voit, sans vos
    // mots (interrupteur VIDEO_PIECES_ENABLED). « Repérée » est évité : sous
    // l'analyse, « Pièces déjà repérées » désigne la mémoire collective.
    pieces: {
      lead: "L'IA peut vous proposer les pièces qu'elle voit dans la vidéo.",
      show: "Voir les propositions de l'IA",
      or: "ou décrivez la pièce :",
      title: (count: number) => (count > 1 ? "Quelle pièce cherchez-vous ?" : "Une pièce proposée"),
      hint: (count: number) => (count > 1 ? "L'IA propose ces pièces. Touchez celle que vous cherchez." : "Vérifiez que le cadre entoure bien la pièce."),
      // Nom du groupe de pastilles, lu par VoiceOver et les lecteurs d'écran du site.
      group: "Pièces proposées par l'IA",
      describe: "Décrire la pièce autrement",
      noneTitle: "Aucune pièce proposée",
      noneMessage: "L'IA n'a vu aucune pièce nette dans cette vidéo : décrivez celle que vous cherchez, ou faites une capture d'écran.",
      waitingSteps: ["On récupère la vidéo…", "L'IA regarde les pièces…"],
      // Sous la capture proposée après un échec, quand rien n'a été écrit.
      keptLink: "Votre lien est gardé.",
    },
    // Retours du build 2 (« la vidéo d'abord ») : le lecteur n'a pas pu servir, l'IA prend le relais.
    playerLead: {
      notHere: "La vidéo n'a pas pu être lue ici : l'IA peut chercher la pièce pour vous.",
      snapshot: `${BRAND} n'a pas pu prendre l'image de ce moment : l'IA peut chercher la pièce pour vous.`,
    },
  },
  // Recherche d'image d'iOS (iOS 26 et suivants) : carte montrée une fois.
  visualSearchTip: {
    title: "Astuce",
    body: `Dans n'importe quelle app, faites une capture, touchez Recherche d'image, puis ${BRAND} (iPhone compatibles).`,
    dismiss: "J'ai compris",
  },
  // Guide de la première recherche (lot « recherche confiance ») : trois étapes, une seule fois par appareil.
  firstRunGuide: {
    title: `Bienvenue sur ${BRAND}`,
    stepOf: (step: number, total: number) => `Étape ${step} sur ${total}`,
    steps: ["Partagez la vidéo depuis TikTok ou Instagram, ou collez son lien", "Entourez la pièce", "Comparez les boutiques et les prix, créez une alerte"],
    next: "Suivant",
    skip: "Passer",
    skipLabel: "Passer le guide",
    start: "Lancer ma première recherche",
    startHint: "Choisissez une capture d'écran ou une photo de la pièce.",
  },
  // Étapes de la capture d'écran (aide d'un lien collé ou partagé, lecteur) et
  // messages d'un parcours qui n'existe plus (page rechargée).
  preview: {
    captureSteps: (platform: string, shortcut: string) => [
      `Ouvrez la vidéo dans ${platform}.`,
      "Mettez-la en pause quand la pièce est bien visible.",
      `Faites une capture d'écran (${shortcut}).`,
    ],
    screenshotShortcut: {
      ios: "bouton latéral + bouton volume haut",
      android: "bouton marche + bouton volume bas",
      web: "Cmd + Maj + 4 sur Mac, Windows + Maj + S sur PC",
    },
    theApp: "l'application",
    missing: "Ce parcours n'est plus disponible. Recommencez depuis Spotter.",
    back: "Retour à Spotter",
  },
  // Lot entourer la pièce (décision du fondateur : entourer seulement) : la
  // pièce s'entoure au doigt, ou à la souris sur un ordinateur. Textes à valider.
  targeting: {
    title: "Entourez la pièce",
    caption: "Seule la zone entourée sera analysée. Pour corriger, entourez à nouveau la pièce.",
    // Moment d'une vidéo choisi après l'analyse d'un lien : le cadre de l'IA est déjà tracé.
    aiCaption: "L'IA a entouré la pièce. Lancez la recherche, ou entourez-la vous-même pour corriger.",
    // Consigne avant le premier tracé.
    instruction: {
      finger: "Entourez la pièce avec votre doigt",
      mouse: "Entourez la pièce avec la souris ou le doigt",
    },
    // Le tracé n'est pas retenu : un toucher, un trait, un balayage, ou une
    // boucle trop petite ou pas refermée. À valider.
    tooSmall: "Faites un tour complet, un peu plus large que la pièce.",
    wholeImage: "Utiliser toute l'image",
    launch: "Lancer l'identification",
  },
  analysis: {
    title: `${BRAND} parcourt les boutiques…`,
    usual: "Cela prend en général 10 à 20 secondes.",
    slow: "C'est plus long que d'habitude : le service redémarre peut-être. Merci de patienter.",
    cancel: "Annuler",
  },
  // Recherche coupée (réseau perdu, retour sur une autre app, « Annuler ») :
  // le serveur va au bout, l'app relit la recherche au lieu de la repayer.
  searchRecovery: {
    notStartedTitle: "Votre recherche n'est pas partie",
    notStartedText: "Elle a été interrompue avant l'analyse de l'image et n'a pas été comptée. Relancez-la quand vous voulez.",
    unreachableTitle: "Votre recherche continue peut-être",
    unreachableText:
      `${BRAND} ne répond pas pour l'instant. Si votre recherche est partie, elle continue de notre côté : vérifiez à nouveau dans un instant pour voir son résultat, sans rien relancer.`,
    runningTitle: "Votre recherche continue…",
    stillRunningText: "Elle prend plus de temps que d'habitude. Vérifiez à nouveau dans un instant pour voir son résultat, sans rien relancer.",
    runningTip: "Si elle aboutit, son résultat apparaîtra dans « Récemment spottées », sur l'accueil de Spotter.",
    relaunch: "Relancer",
    checkAgain: "Vérifier à nouveau",
    cancelled:
      "Recherche annulée. Elle a pu continuer de notre côté : relancez-la sans changer la zone ni les mots, et son résultat s'affichera s'il existe déjà.",
  },
  result: {
    title: "Résultats",
    reframe: "Recadrer",
    count: (n: number, query: string | null | undefined) =>
      `${n} proposition${n > 1 ? "s" : ""}${query ? ` pour « ${query} »` : ""}`,
    sortedByWords: "Triées selon vos mots",
    // Prix d'abord : la première proposition remontée par vos mots n'a pas de
    // prix, elle est repliée plus bas (relecture F4, à valider).
    sortedByWordsPriceFirst: "Avec prix d'abord, puis selon vos mots",
    bestProposal: "Meilleure proposition",
    // Prix d'abord : la grande carte proposée d'office quand ce n'est pas la
    // première de la recherche (relecture E4, à valider).
    bestWithPrice: "Meilleure proposition avec prix",
    otherProposal: "Autre proposition",
    otherProposals: "Autres propositions",
    showMore: (n: number) => `Voir plus (${n})`,
    // Lot résultats lisibles : textes à valider par le fondateur.
    yourPiece: "Votre pièce",
    showLargeHint: "Affiche cette proposition en grand, en haut de l'écran.",
    shownAbove: (name: string) => `Proposition affichée en grand en haut de l'écran : ${name}`,
    // Texte du fondateur (2026-10-25) : ne promet pas un prix que le site n'affiche peut-être pas.
    priceOnSite: "Prix à vérifier chez le marchand",
    viewAt: (merchant: string) => (merchant ? `Voir chez ${merchant}` : "Voir la pièce"),
    affiliateDisclosure: "Lien affilié",
    // Aligné sur les conditions d'utilisation (projet, bloc 5 du Lot Q) —
    // à revoir le jour où un programme d'affiliation sera actif.
    affiliateExplanation:
      `Si vous achetez en passant par ce lien, ${BRAND} pourra à l'avenir percevoir une commission du marchand, sans surcoût pour vous. Aucun programme d'affiliation n'est actif à ce jour.`,
    affiliateHint: "Affiche ce que signifie « lien affilié ».",
    keep: "Garder",
    kept: "Gardée",
    keepError: "L'ajout à vos Envies a échoué.",
    markAsBought: "Je l'ai achetée",
    bought: "Ajoutée au Vault",
    boughtToast: "Ajoutée à votre Vault",
    boughtError: "L'ajout au Vault a échoué.",
    categoryTitle: "Dans quelle catégorie ?",
    share: "Partager",
    // La mention seulement pour un vrai lien affilié (lot garde-fous, lib/affiliate-link.ts).
    shareMessage: (name: string, url: string, affiliate: boolean) => `${name}\n${url}${affiliate ? " (lien affilié)" : ""}\n\nRepérée avec ${BRAND}.`,
    linkCopied: "Message copié, avec le lien",
    merchantLinkBlocked: "Votre navigateur a bloqué l'ouverture. Touchez ici pour continuer vers le marchand.",
    loading: "Chargement du résultat",
    loadErrorTitle: "Impossible d'afficher ce résultat.",
    loadErrorTip: "Vérifiez votre connexion, puis réessayez. Aucune nouvelle recherche ne sera lancée.",
    missingTitle: "Ce résultat n'est plus disponible.",
    missingTip: "Relancez une identification depuis Spotter.",
    retry: "Réessayer",
    backToSpotter: "Retour à Spotter",
    notRight: "Ce n'est pas la bonne pièce ?",
    correctionsLead: `Montrez la pièce autrement à ${BRAND} :`,
    // Prix d'abord : avant les corrections, qui relancent une recherche, voir
    // gratuitement les propositions repliées sans prix (relecture ORD-5, à valider).
    notRightWithoutPriceLead: "Elle est peut-être parmi les propositions sans prix :",
    // Sans nom de fournisseur (décision du fondateur, 2026-10-21). Lot « premier
    // essai » : ne pousse plus à relancer la même image (même résultat, une
    // recherche de plus).
    noMatchTitle: "Notre recherche visuelle n'a rien trouvé sur cette image.",
    noMatchTip:
      "Relancer la même image donnerait le même résultat. Essayez plutôt d'entourer la pièce seule, de choisir un autre moment de la vidéo où elle se voit bien ou, pour une vidéo, de préciser vos mots.",
    // Aucune proposition gardée n'a de prix (textes validés le 2026-10-21 ; la
    // fin de noPriceText parle d'entourer, plus de cadre : à valider).
    noPriceTitle: "Aucune de ces propositions n'affiche de prix.",
    noPriceText:
      "Ce sont des pièces qui ressemblent à la vôtre, trouvées par notre recherche visuelle. Elles ne sont pas forcément en vente : ouvrez-les pour vérifier, ou entourez la pièce autrement.",
    // Prix d'abord (décision du fondateur du 2026-11-03) : les propositions
    // sans prix rangées en dernier, derrière un bouton. Textes à valider.
    // Titre de la section, au-dessus du bouton (relecture E5, à valider).
    withoutPriceTitle: "Sans prix affiché",
    showWithoutPrice: (n: number) => (n > 1 ? `Voir les ${n} propositions sans prix` : "Voir la proposition sans prix"),
    hideWithoutPrice: (n: number) => (n > 1 ? "Masquer les propositions sans prix" : "Masquer la proposition sans prix"),
    // VoiceOver, après le bouton : la liste apparaît ou disparaît dessous (à valider).
    withoutPriceShown: (n: number) => (n > 1 ? `${n} propositions sans prix, affichées ci-dessous.` : "La proposition sans prix est affichée ci-dessous."),
    withoutPriceHidden: (n: number) => (n > 1 ? "Propositions sans prix masquées." : "Proposition sans prix masquée."),
    technicalTitle: "La recherche n'a pas abouti",
    // Panne du service, pas de la connexion de la personne (lot recherche coupée).
    technicalTip: "Le service de recherche n'a pas répondu. Réessayez dans un instant.",
    rateLimitedTitle: "Trop de recherches d'un coup",
    rateLimitedTip: "Vous avez atteint la limite de 10 identifications par heure. Réessayez un peu plus tard.",
    // Plafond des recherches (lot 4 quater, textes du fondateur, 2026-10-08 et
    // 2026-10-11) : jour et mois pour tout le service — pour le mois, la date
    // du prochain renouvellement de SerpApi —, part de la personne.
    capacityDayTitle: "Le service de recherche est très sollicité aujourd'hui.",
    capacityDayTip: "Réessayez demain.",
    capacityMonthTitle: "Le service de recherche a atteint sa limite mensuelle.",
    capacityMonthTip: (date: string) => `Réessayez à partir du ${date}.`,
    capacityMonthLater: "Réessayez dans quelques jours.",
    capacityUserTitle: "Vous avez atteint votre limite de recherches pour aujourd'hui.",
    capacityUserTip: "Réessayez demain.",
    previewUnavailableTitle: "L'image de la vidéo n'est plus disponible",
    previewUnavailableTip: "Importez une capture d'écran de la pièce pour continuer.",
    // Lot garde-fous : recherche en pause, notre fournisseur est en panne (disjoncteur). À relire.
    pausedTitle: "La recherche est momentanément en pause",
    pausedTip: "Notre fournisseur de recherche rencontre une panne et nous sommes prévenus. Cette tentative n'a pas été comptée. Réessayez dans quelques minutes.",
    // Bouton « Résultat incohérent » (fiabilité des résultats, motifs validés
    // par le fondateur le 2026-10-15).
    reportMenuLabel: "Signaler un résultat incohérent",
    reportTitle: "Résultat incohérent",
    reportQuestion: "Qu'est-ce qui ne va pas ?",
    feedbackReasons: {
      image_title_mismatch: "L'image et le titre ne correspondent pas",
      wrong_item: "Ce n'est pas la pièce cherchée (autre type, autre couleur, autre modèle)",
      not_for_sale: "Impossible à acheter (la page ne vend rien)",
      wrong_price: "Prix faux ou absent",
      duplicate: "Doublon d'une autre proposition",
    },
    reportSend: "Envoyer",
    reportSending: "Envoi…",
    reportCancel: "Annuler",
    reportWithdraw: "Retirer mon signalement",
    reportThanks: "Merci, c'est noté.",
    reportWithdrawn: "Signalement retiré.",
    reportedLine: (reason: string) => `Signalé : ${reason}`,
    reportedHint: "Modifier ou retirer votre signalement",
    reportError: "Le signalement n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.",
    reportWithdrawError: "Le signalement n'a pas pu être retiré. Vérifiez votre connexion, puis réessayez.",
    // Voie C (lot c) : sections sous les propositions de la recherche
    // visuelle, puis la recherche par les mots (« Que cherchez-vous ? »).
    // Textes à valider par le fondateur ; sans nom de fournisseur. La requête
    // des boutiques dit qu'elle est écrite par une IA (document pour l'avocat
    // du 2026-11-05, point 4.3).
    complementTitleAi: "Cette pièce dans d'autres boutiques",
    complementTitleWords: "Résultats pour vos mots",
    complementQuery: (query: string) => `Recherche écrite par une IA : “${query}”`,
    // Boutiques ensuite (2026-11-08) : les résultats s'affichent tout de suite ;
    // cette ligne discrète attend « Cette pièce dans d'autres boutiques », puis
    // disparaît (sans message si rien n'est trouvé). Texte à valider.
    shopsPending: "Recherche dans d'autres boutiques…",
    // Tri des résultats (2026-11-08, lib/result-sort.ts). Textes à valider.
    sortLabel: "Trier les résultats",
    sortRelevance: "Pertinence",
    sortPriceAsc: "Prix croissant",
    sortPriceDesc: "Prix décroissant",
    withPriceOnly: "Avec prix seulement",
    withPriceOnlyHint: "Masque les propositions sans prix.",
    // Offres avec un prix dans la devise la plus fréquente ; le prix le plus bas, sans conversion.
    offersSummary: (n: number, price: string) => (n > 1 ? `${n} offres · à partir de ${price}` : `1 offre · ${price}`),
    cheapestBadge: "Le moins cher",
    // Boutiques douteuses (lot « recherche confiance ») : mentions neutres et factuelles,
    // jamais une accusation ; touchées, une explication courte. Ordre des boutiques
    // (décision du fondateur, 21 novembre 2026) : aucune marque mise en avant ; seule la
    // section « Cette pièce dans d'autres boutiques » est rangée par les mentions, et la
    // feuille le dit (elle s'ouvre aussi depuis les autres sections) : seule la boutique de
    // la marque de la pièce y passe en premier, seulement quand le serveur a vérifié qu'elle
    // est celle de la marque de cette pièce (jamais sans la migration 0054) : la mention seule
    // ne suffit pas, et la phrase le dit.
    offerMark: {
      official_shop: "Boutique officielle de la marque",
      known_shop: "Boutique connue",
      unusual_price: "Prix inhabituellement bas",
      hint: "Explique cette mention.",
      explanation: `${BRAND} signale les boutiques officielles des marques, les boutiques connues et les prix inhabituellement bas. Dans « Cette pièce dans d'autres boutiques », la boutique officielle de la marque de la pièce passe en premier seulement quand ${BRAND} a pu vérifier qu'elle est bien celle de la marque de cette pièce, ce qui n'est pas toujours le cas, même quand elle porte la mention ; les autres boutiques officielles et les boutiques connues remontent un peu, et les prix inhabituellement bas passent en dernier. Vérifiez toujours la boutique avant de payer.`,
      close: "J'ai compris",
    },
    // « Avec prix seulement » et aucune proposition avec prix : retirer le filtre.
    showAllProposals: "Afficher aussi les propositions sans prix",
    // Proposition sans lien direct vers le marchand : le lien ouvre la page produit de Google.
    viewOffer: "Voir l'offre",
    textSearchIntro: "Pas tout à fait ça ?",
    textSearchButton: "Chercher",
    // Option A du document pour l'avocat (2026-11-05, point 4.2), comme la politique « projet-2026-11-05 ».
    textSearchNote:
      `Vos mots seront envoyés à Google Shopping par notre prestataire SerpApi, sans votre nom ni votre e-mail. ${BRAND} ne les garde pas ; il garde les pièces trouvées avec votre recherche.`,
    textSearchRunning: "Recherche en cours…",
    textSearchAlreadyUsed: "La recherche avec vos mots a déjà été lancée pour cette photo.",
    textSearchEmpty: "Aucune proposition pour vos mots.",
    textSearchFailed: "La recherche avec vos mots n'a pas abouti.",
    textSearchError: "La recherche n'a pas abouti. Vérifiez votre connexion, puis réessayez.",
    // Mots refusés par le serveur : rien ne reste une fois retirés les opérateurs et la ponctuation.
    textSearchInvalidWords: "Décrivez la pièce en quelques mots.",
    // Parcours 3 (décision B1 du fondateur) : « Vous l'avez achetée ? » au
    // retour de la boutique, après au moins 30 s ; une seule feuille, dont le
    // contenu change d'étape (components/purchase-question-sheet.tsx).
    purchaseQuestion: {
      title: "Vous l'avez achetée ?",
      // Annoncé par VoiceOver à l'ouverture de la feuille (iPhone).
      announcement: (name: string) => `Vous l'avez achetée ? ${name}`,
      yes: "Oui, je l'ai achetée",
      no: "Non, pas encore",
      later: "Plus tard",
      shareTitle: "La partager dans votre fil ?",
      share: "Partager…",
      keepAndFollow: "Garder la pièce et suivre son prix ?",
      // Sans alerte possible : sans parler de prix.
      keepOnly: "Garder la pièce ?",
      noThanks: "Non merci",
      follow: "Suivre son prix ? Une baisse s'affichera dans vos Envies.",
      turnOnAlert: "Activer l'alerte",
    },
    // Stock affiché (lot « stock visible ») : ce que Google disait au moment de
    // la recherche, sur les cartes (components/stock-note.tsx) ; rien quand
    // c'est inconnu. Le filtre « En stock seulement » garde les offres au stock
    // inconnu (components/result-sort-bar.tsx).
    stock: {
      inStock: "En stock",
      soldOut: "Épuisée",
      // Lu par VoiceOver après « En stock » ou « Épuisée ».
      source: "d'après Google, au moment de la recherche",
      hint: "Explique d'où vient cette information.",
      explanation: "D'après Google, au moment de la recherche. Le stock a pu changer depuis : vérifiez-le sur le site de la boutique avant d'acheter.",
      close: "J'ai compris",
    },
    inStockOnly: "En stock seulement",
    inStockOnlyHint: "Masque les offres que Google disait épuisées au moment de la recherche. Celles dont le stock est inconnu restent.",
    // « En stock seulement » choisi et plus rien à montrer : retirer les filtres.
    filtersEmpty: "Aucune proposition ne correspond à ces filtres pour l'instant.",
    showAllWithoutFilters: "Afficher toutes les propositions",
    // Le verdict (lot « verdict », serveur lib/verdict.ts) : une phrase en tête
    // de l'écran Résultat, touchable (components/verdict-line.tsx). Toujours
    // « d'après les titres des boutiques » quand elle affirme quelque chose ;
    // une fourchette de prix dit d'où (les boutiques) et de quand (au moment
    // de la recherche) elle vient. Rien quand le serveur ne sait pas.
    verdict: {
      identified: (shops: number) => `Pièce identifiée, d'après les titres des boutiques : ${shops} boutiques.`,
      identifiedWithPrices: (shops: number, low: string, high: string) =>
        `Pièce identifiée, d'après les titres des boutiques : ${shops} boutiques, de ${low} à ${high} au moment de la recherche.`,
      // Le même prix partout.
      identifiedOnePrice: (shops: number, price: string) => `Pièce identifiée, d'après les titres des boutiques : ${shops} boutiques, toutes à ${price} au moment de la recherche.`,
      close: "Pièce probablement trouvée, d'après les titres des boutiques : vérifiez le modèle avant d'acheter.",
      lookalikes: "Pas de pièce exacte trouvée : voici les plus proches.",
      hint: `Explique comment ${BRAND} décide.`,
      sheetTitle: "D'après les titres des boutiques",
      how: `${BRAND} lit les titres des offres de « Cette pièce dans d'autres boutiques ». Seuls comptent les boutiques connues et les sites officiels des marques, sans les places de marché ni les sites de revente, où chaque vendeur écrit son titre. « Pièce identifiée » : au moins deux de ces boutiques, différentes, y nomment la même marque et le même modèle. « Pièce probablement trouvée » : une seule le fait. Sinon, les propositions sont seulement des pièces qui se ressemblent.`,
      limits: `${BRAND} ne vérifie ni qu'une pièce est d'origine, ni son état, et cette phrase ne change pas l'ordre des propositions. Les prix sont ceux affichés par les boutiques au moment de la recherche. Vérifiez toujours avant d'acheter.`,
      closeButton: "J'ai compris",
    },
    // Seconde main de luxe (lot « seconde main de luxe », components/luxury-resale.tsx).
    // Si un jour un lien de cette liste devient affilié, la phrase `leave` devient fausse : la changer,
    // ajouter la mention « Lien affilié » (components/affiliate-mention.tsx) et la phrase des conditions.
    luxuryResale: {
      entry: "Seconde main de luxe",
      entryLabel: (house: string) => `Seconde main de luxe : chercher cette pièce ${house} sur des sites de revente`,
      entryHint: "Ouvre la liste des sites de revente.",
      sheetTitle: "Seconde main de luxe",
      intro: (house: string) =>
        `D'après les boutiques trouvées, cette pièce semble venir de la maison ${house}. Vous pouvez la chercher d'occasion sur ces sites de revente, choisis par ${BRAND} et rangés par ordre alphabétique.`,
      words: (words: string) => `Recherche déjà remplie : “${words}”`,
      site: (name: string) => `Chercher sur ${name}`,
      siteLabel: (name: string, host: string) => `Chercher sur ${name}, ${host}, s'ouvre hors de ${BRAND}`,
      limits: `${BRAND} ne voit pas les pièces de ces sites, ni leur prix, ni leur état : c'est le site de revente qui les présente et en répond, selon ses propres conditions. Vérifiez avant d'acheter.`,
      leave: `Vous allez quitter ${BRAND} : le site s'ouvre dans votre navigateur. Aucun de ces liens n'est affilié : ${BRAND} ne touche rien sur ces achats.`,
      close: "Fermer",
    },
  },
  wishlistItem: {
    back: "Envies",
    backLabel: "Retour aux Envies",
    remove: "Retirer de mes Envies",
    removeConfirm: "Retirer cette pièce de vos Envies ?",
    removing: "Retrait…",
    removed: "Retirée de vos Envies",
    removeError: "Le retrait a échoué. Réessayez.",
    notFound: "Cette envie n'est plus disponible.",
    cancel: "Annuler",
    confirm: "Retirer",
    removeConfirmWithPost: "Retirer cette pièce de vos Envies ? Sa publication sur votre profil sera supprimée aussi.",
    // Lot 5 : partager une envie, toujours par un geste volontaire.
    shareTitle: "Partager cette envie",
    shareHint: "Vos Envies restent privées : rien n'est partagé sans votre accord.",
    republishVisibility: "Republier sur mon profil, visible par :",
    republish: "Republier sur mon profil",
    republishing: "Publication…",
    republished: "Envie republiée sur votre profil",
    republishError: "La republication a échoué. Réessayez.",
    sharedState: (privacy: string) => `Sur votre profil · ${privacy}`,
    viewPost: "Voir la publication",
    shareAgainHint:
      "Pour changer qui la voit, modifiez la visibilité depuis la publication. Pour obtenir une nouvelle image, supprimez la publication puis republiez l'envie.",
    sendToSomeone: `Envoyer à quelqu'un sur ${BRAND}`,
    shareOutside: `Partager hors de ${BRAND}`,
    linkCopied: "Lien copié",
    shareMessage: (title: string, merchant: string | null) => `Une pièce repérée sur ${BRAND} : ${title}${merchant ? ` chez ${merchant}` : ""}`,
    affiliateMention: "(lien affilié)",
  },
  // Lot « Retrouver ses pièces » : toutes les recherches récentes (« Tout
  // voir ») et « Je l'ai achetée » depuis la fiche d'une envie.
  retrouverPieces: {
    seeAll: "Tout voir",
    seeAllLabel: "Voir toutes vos pièces récemment spottées",
    recentLead: "Rouvrir un résultat ne compte pas dans vos recherches du jour.",
    recentEmpty: "Aucune recherche réussie pour l'instant. Les pièces que vous retrouvez avec Spotter s'afficheront ici.",
    recentLoadError: "Impossible d'afficher vos recherches récentes. Vérifiez votre connexion, puis réessayez.",
    recentLimitNote: (n: number) => `Seules vos ${n} dernières recherches réussies s'affichent ici. Pour retrouver une pièce plus tard, gardez-la dans vos Envies.`,
    today: "Aujourd'hui",
    yesterday: "Hier",
    alreadyInVault: "Déjà dans votre Vault",
  },
  // Lot 5 : envoyer une envie à une personne sur Spotto.
  sendPiece: {
    title: "Envoyer à…",
    back: "Retour",
    searchLabel: "Rechercher une personne",
    hint: "La personne retrouvera la pièce dans ses Envies, onglet « Reçues ». Certaines personnes n'acceptent que les pièces des comptes qu'elles suivent.",
    empty: "Aucun profil trouvé.",
    searchError: "La recherche a échoué. Réessayez.",
    send: "Envoyer",
    sending: "Envoi…",
    sendTo: (name: string) => `Envoyer à ${name}`,
    sent: (name: string) => `Envoyée à ${name}`,
    sendError: "L'envoi a échoué. Réessayez.",
  },
  // Lot messages : messages privés entre membres (entrée « Messages » de
  // l'Activité, bouton « Message » des profils, envie jointe).
  messages: {
    entry: "Messages",
    entryLabel: (n: number) => (n === 0 ? "Messages" : `Messages, ${n} conversation${n > 1 ? "s" : ""} non lue${n > 1 ? "s" : ""}`),
    title: "Messages",
    back: "Retour",
    invitations: "Invitations",
    invitationsHint: "Ces personnes vous écrivent sans que vous vous suiviez l'un l'autre. Elles ne savent rien de votre choix tant que vous n'acceptez pas.",
    conversations: "Conversations",
    empty: "Aucune conversation pour l'instant. Pour écrire à quelqu'un, ouvrez son profil et touchez « Message ».",
    loadError: "Impossible de charger vos messages.",
    loadMore: "Afficher les conversations plus anciennes",
    unread: "Non lu",
    rowLabel: (name: string, preview: string, unread: boolean) => `${name}${unread ? ", non lu" : ""}. ${preview}`,
    previewMine: (text: string) => `Vous : ${text}`,
    previewWish: "Envie partagée",
    previewInvitationSent: "Invitation envoyée, en attente de réponse",
    hiddenMessage: "Message indisponible",
    messageButton: "Message",
    messageButtonLabel: (name: string) => `Écrire à ${name}`,
    placeholder: "Écrire un message…",
    send: "Envoyer",
    sending: "Envoi…",
    sendError: "L'envoi a échoué. Réessayez.",
    attachWish: "Joindre une envie",
    removeWish: "Retirer l'envie jointe",
    attachedWish: (title: string) => `Envie jointe : ${title}`,
    invitationNotice: (name: string) =>
      `Ce premier message est une invitation : ${name} pourra l'accepter ou la refuser. Vous ne pourrez plus écrire avant sa réponse.`,
    waitingNotice: (name: string) => `Invitation envoyée. Vous pourrez écrire de nouveau quand ${name} l'aura acceptée.`,
    notAllowedNotice: (name: string) => `${name} ne reçoit pas de messages de votre part pour le moment.`,
    answerNotice: (name: string) => `${name} vous invite à discuter. Acceptez pour lui répondre.`,
    accept: "Accepter",
    decline: "Refuser",
    block: "Bloquer",
    accepted: "Invitation acceptée",
    declined: "Invitation refusée",
    declineConfirm: "Refuser cette invitation ? Elle disparaîtra de vos messages, sans que cette personne en soit prévenue.",
    declineConfirmCta: "Refuser l'invitation",
    cancel: "Annuler",
    actionError: "L'action a échoué. Réessayez.",
    loadConversationError: "Impossible de charger cette conversation.",
    notFound: "Cette conversation n'est pas disponible.",
    loadOlder: "Afficher les messages précédents",
    emptyThread: "Aucun message pour l'instant.",
    // Lot « messages vus » : sous votre dernier message d'une conversation
    // ouverte. « Vu » : l'autre membre a ouvert la conversation depuis.
    receiptSeen: "Vu",
    receiptSent: "Envoyé",
    // Lus par VoiceOver à la place de « Vu » et « Envoyé ».
    receiptSeenLabel: (name: string) => `Votre dernier message a été vu par ${name}`,
    receiptSentLabel: "Votre dernier message est envoyé",
    messageOptions: "Options pour ce message",
    // Lu par VoiceOver après le nom du bouton « ••• » d'un message reçu.
    messageOptionsHint: "Signaler ce message ou bloquer cette personne",
    reportMessage: "Signaler ce message",
    more: "Signaler ou bloquer",
    wishLabel: (title: string) => `Envie : ${title}`,
    sendToConversation: "Envoyer dans une conversation",
    chooseTitle: "Envoyer dans…",
    chooseHint: "Choisissez une conversation : l'envie y sera jointe, et vous pourrez ajouter un mot avant d'envoyer.",
    chooseEmpty: "Aucune conversation ouverte pour l'instant. Cherchez une personne ci-dessous pour lui écrire.",
    chooseLabel: (name: string) => `Envoyer à ${name}`,
    pickerTitle: "Joindre une envie",
    pickerEmpty: "Aucune envie pour l'instant. Gardez une pièce depuis un résultat pour pouvoir la partager.",
    pickerError: "Impossible de charger vos Envies.",
    pickerClose: "Fermer",
    pickWish: (title: string) => `Joindre ${title}`,
    // « Envoyer à un ami » depuis l'écran Résultat : une proposition d'une de
    // vos recherches part dans une conversation, sans être gardée dans vos Envies.
    sendToFriend: "Envoyer à un ami",
    sendToFriendLabel: (title: string) => `Envoyer ${title} à un ami`,
    chooseHintPiece: "Choisissez une conversation : la pièce y sera jointe, et vous pourrez ajouter un mot avant d'envoyer.",
    chooseSomeoneElse: "Écrire à une autre personne",
    chooseSearchLabel: "Rechercher une personne",
    chooseSearchEmpty: "Aucun profil trouvé.",
    chooseSearchError: "La recherche a échoué. Réessayez.",
    attachedPiece: (title: string) => `Pièce jointe : ${title}`,
    attachedPieceFallback: "Pièce de votre recherche",
    removePiece: "Retirer la pièce jointe",
    pieceSent: (name: string) => `Pièce envoyée à ${name}`,
    pieceSentInvitation: (name: string) => `Invitation envoyée à ${name}, avec la pièce`,
  },
  // Lot notifications : être prévenu des nouveaux messages sur l'iPhone
  // (feuille d'explication avant l'autorisation d'iOS, interrupteur des Réglages).
  push: {
    offerTitle: "Être prévenu de vos nouveaux messages ?",
    offerBody:
      `${BRAND} peut vous envoyer une notification quand quelqu'un vous écrit ou vous invite à discuter. Elle dit seulement qui vous écrit, jamais ce qu'il vous écrit.`,
    offerSettingsHint: "Vous pourrez les arrêter à tout moment dans les Réglages.",
    offerAccept: "Activer les notifications",
    offerLater: "Plus tard",
    offerClose: "Fermer",
    enabling: "Activation…",
    enabled: "Notifications activées",
    deniedHint:
      `Les notifications de ${BRAND} sont coupées dans les Réglages de l'iPhone. Pour les recevoir, ouvrez Réglages, puis ${BRAND}, puis Notifications.`,
    openSettings: "Ouvrir les Réglages de l'iPhone",
    openSettingsFailed: `Les Réglages de l'iPhone n'ont pas pu s'ouvrir : passez par l'app Réglages, puis ${BRAND}.`,
    failed: "Les notifications n'ont pas pu être activées. Vérifiez votre connexion, puis réessayez.",
    settingTitle: "Notifications de messages",
    settingSwitchLabel: "Recevoir une notification pour chaque nouveau message",
    settingOn: "Activées : une notification vous prévient d'un nouveau message ou d'une invitation, avec le nom de la personne, jamais le contenu.",
    settingOff: `Désactivées : vous voyez vos nouveaux messages en ouvrant ${BRAND}.`,
    settingLoading: "Chargement de votre choix…",
    settingFailed: "Votre choix n'a pas pu être enregistré. Réessayez.",
  },
  // Lot 2 : alertes prix et stock (cloche des envies, Réglages, « Plus
  // disponible »). « Épuisé » est construit mais caché (SOLD_OUT_ALERTS_VISIBLE).
  wishAlerts: {
    kinds: { price_drop: "Baisse de prix", restock: "Retour en stock", sold_out: "Épuisé" },
    kindsInline: { price_drop: "baisse de prix", restock: "retour en stock", sold_out: "épuisé" },
    kindHints: {
      price_drop: "Quand son prix passe sous le seuil que vous choisissez, dans cette boutique.",
      restock: "Quand elle revient en stock dans cette boutique.",
      sold_out: "Quand elle est épuisée dans cette boutique.",
    },
    lastJoin: (first: string, last: string) => `${first} et ${last}`,
    bellOff: "Créer une alerte",
    bellOn: (kinds: string) => `Alerte : ${kinds}`,
    bellOffLabel: (title: string) => `Créer une alerte pour ${title}`,
    bellOnLabel: (title: string, kinds: string) => `Alerte activée pour ${title} : ${kinds}. Toucher pour la modifier`,
    sheetTitle: "Alerte pour cette pièce",
    sheetIntro:
      `${BRAND} vous prévient tout de suite quand une recherche faite dans ${BRAND} montre cette pièce dans la même boutique, sous votre prix ou de nouveau en stock. Personne ne sait qui l'a cherchée, ni qui la suit.`,
    // Nouvelle version (0041) : « Prévenez-moi si le prix passe sous [ ] € ».
    targetLabel: "Prévenez-moi si le prix passe sous",
    targetFieldLabel: (currency: string) => `Seuil de prix, en ${currency}`,
    targetHintLast: "Pré-rempli avec le dernier prix vu. Vous pouvez le baisser.",
    targetHintNone: "Sans prix indiqué, le premier prix vu servira de seuil.",
    // Revue : chaque indication dit d'où vient le prix affiché.
    targetHintSaved: "Votre seuil enregistré.",
    targetHintSavedWithLast: (price: string) => `Votre seuil enregistré. Dernier prix vu : ${price}.`,
    targetHintEmptyLast: (price: string) => `Sans prix indiqué, le dernier prix vu (${price}) servira de seuil.`,
    targetHintNoCountry:
      "Le premier prix vu en France, au Royaume-Uni, en Suisse ou aux États-Unis servira de seuil ; vous pourrez ensuite le baisser.",
    targetInvalid: "Indiquez un prix, par exemple 89,90.",
    keyboardDone: "OK",
    // La fiche d'une envie dit ce qui a changé (la notification reste générique).
    lastSeenPrice: (price: string) => `Dernier prix vu : ${price}`,
    stockAvailable: "Disponible",
    stockSoldOut: "Épuisée",
    switchTurnsOn: "Cela active aussi « Alertes prix et stock » dans les Réglages.",
    pushSoon: "Les alertes sont enregistrées ; les notifications seront bientôt disponibles.",
    iphoneOnly: `Les notifications des alertes arrivent sur l'app ${BRAND} pour iPhone.`,
    save: "Enregistrer",
    saving: "Enregistrement…",
    cancel: "Annuler",
    saved: "Alerte enregistrée",
    removed: "Alerte retirée",
    saveError: "Votre choix n'a pas pu être enregistré. Vérifiez votre connexion, puis réessayez.",
    notTrackable: "Cette pièce ne peut pas être suivie : sa boutique ou son produit n'est pas reconnu.",
    bought: "Cette pièce est dans votre Vault : aucune alerte ne partira pour elle.",
    tooManyChanges: "Vous avez modifié beaucoup d'alertes : réessayez dans un moment.",
    pushOfferTitle: "Être prévenu sur cet iPhone ?",
    pushOfferBody:
      `${BRAND} peut vous envoyer une notification quand une envie que vous suivez passe sous votre prix ou revient en stock. Elle ne dit ni la pièce, ni la boutique, ni le prix : vous voyez le détail en l'ouvrant. Jamais qui l'a cherchée.`,
    settingTitle: "Alertes prix et stock",
    settingSwitchLabel: "Recevoir les alertes prix et stock de vos envies",
    settingOn: `Activées : ${BRAND} vous prévient pour les envies dont vous avez allumé la cloche.`,
    settingOff: "Désactivées : aucune alerte ne vous est envoyée. Pour suivre une envie, touchez sa cloche.",
    settingFailed: "Votre choix n'a pas pu être enregistré. Réessayez.",
    // Nouvelle version (0041) : un réglage à part, allumé par défaut.
    helpOthersTitle: "Aider les autres membres",
    helpOthersSwitchLabel: "Aider les alertes des autres membres avec vos recherches et vos signalements",
    helpOthersOn: "Vos recherches et vos signalements « Plus disponible » aident, sans votre nom, les alertes des autres membres.",
    helpOthersOff: "Désactivé : vos recherches et vos signalements ne servent qu'à vos propres envies. Vos alertes continuent de marcher.",
    devicePushOff: "Les notifications des alertes sont coupées sur cet iPhone.",
    devicePushTurnOn: "Recevoir les notifications sur cet iPhone",
    reportLink: "Plus disponible ?",
    reportLinkLabel: (title: string) => `Signaler que ${title} n'est plus disponible`,
    reportTitle: "Cette pièce n'est plus disponible ?",
    // Nouvelle version (0041) : un signalement seul ne change que vos envies ;
    // celles des autres une fois la pièce signalée par trois membres d'affilée.
    reportBody:
      "Vous indiquez qu'elle n'est plus en vente dans cette boutique. Elle est notée épuisée dans vos envies, et dans celles des membres qui la suivent une fois que trois membres l'ont signalée d'affilée. Personne ne saura que c'est vous.",
    reportConfirm: "Oui, plus disponible",
    reportSending: "Envoi…",
    reportCancel: "Annuler",
    reportDone: "Merci, c'est noté",
    reportLimit: "Vous avez signalé beaucoup de pièces aujourd'hui. Réessayez demain.",
    reportNotTrackable: "Cette pièce ne peut pas être signalée : sa boutique ou son produit n'est pas reconnu.",
    reportNotFound: "Cette pièce est introuvable.",
    reportError: "Le signalement n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.",
    // Parcours 3 : la baisse de prix se voit dans l'app (grille des Envies,
    // fiche d'une Envie), même interrupteur « Alertes prix et stock » coupé.
    priceDrop: "Baisse de prix",
    priceDropAt: (price: string) => `Baisse de prix · ${price}`,
    // Lot « alertes visibles » : les nouveautés en tête de vos Envies. Chaque
    // ligne dit le prix vu, son jour et sa boutique ; l'écart est celui avec
    // votre seuil (jamais « promotion » ni prix barré).
    newsTitle: (count: number) => (count === 1 ? "1 nouveauté" : `${count} nouveautés`),
    newsSource: `Repérées dans les recherches faites dans ${BRAND}.`,
    newsPriceDrop: (title: string, price: string, gap: string, day: string, shop: string | null) =>
      shop ? `${title} : ${price}, ${gap} sous votre seuil · prix vu le ${day} chez ${shop}` : `${title} : ${price}, ${gap} sous votre seuil · prix vu le ${day}`,
    newsRestock: (title: string, day: string, shop: string | null) =>
      shop ? `De nouveau disponible : ${title} · vu le ${day} chez ${shop}` : `De nouveau disponible : ${title} · vu le ${day}`,
    newsOpenHint: "Ouvre cette envie",
    newsHide: "Masquer",
    newsHideLabel: "Masquer les nouveautés",
    newsTabLabel: (tab: string) => `${tab}, avec des nouveautés`,
  },
  // Lot collections : collections d'envies, privées ou montrées aux amis
  // (puces de l'écran Envies, « Ajouter à une collection », profil d'un ami).
  collections: {
    all: "Toutes",
    chipsLabel: "Afficher une collection",
    chipLabel: (name: string, shared: boolean) => (shared ? `${name}, visible par vos amis` : name),
    sharedBadge: "Amis",
    newCollection: "Nouvelle collection",
    nameLabel: "Nom de la collection",
    namePlaceholder: "Ex. : Cadeaux, Été, Pour la maison",
    nameCounter: (n: number, max: number) => `${n} / ${max} caractères`,
    create: "Créer",
    creating: "Création…",
    created: "Collection créée",
    save: "Enregistrer",
    saving: "Enregistrement…",
    renamed: "Collection renommée",
    cancel: "Annuler",
    close: "Fermer",
    saveError: "L'enregistrement a échoué. Réessayez.",
    actionError: "L'action a échoué. Réessayez.",
    loadError: "Impossible de charger vos collections.",
    empty: "Aucune envie dans cette collection pour l'instant. Ouvrez une envie et touchez « Ajouter à une collection ».",
    privateState: "Privée : vous seul la voyez.",
    friendsState: "Visible par vos amis (les membres que vous suivez et qui vous suivent).",
    manage: "Gérer",
    manageLabel: (name: string) => `Gérer la collection ${name}`,
    visibilityTitle: "Qui la voit",
    visibilityPrivate: "Privée",
    visibilityFriends: "Mes amis",
    shareConfirmTitle: "Montrer cette collection à vos amis ?",
    shareConfirm:
      "Vos amis, c'est-à-dire les membres que vous suivez et qui vous suivent, verront le nom de la collection et, pour chaque envie, son titre, son image, son prix et le lien vers la boutique. Jamais vos notes. Vous pourrez la rendre privée à tout moment.",
    shareConfirmCta: "Montrer à mes amis",
    shared: "Collection visible par vos amis",
    madePrivate: "Collection redevenue privée",
    delete: "Supprimer la collection",
    deleteConfirm: "Supprimer cette collection ? Vos envies restent dans vos Envies.",
    deleteConfirmCta: "Supprimer",
    deleted: "Collection supprimée",
    addToCollection: "Ajouter à une collection",
    sheetTitle: "Ajouter à une collection",
    sheetHint: "Une envie peut être dans plusieurs collections. Celles marquées « Amis » sont visibles par vos amis.",
    sheetEmpty: "Aucune collection pour l'instant : créez la première.",
    sheetDone: "Valider",
    saved: "Collections enregistrées",
    friendSection: "Collections",
    friendSectionHint: (name: string) => `Les envies que ${name} montre à ses amis.`,
    itemCount: (n: number) => `${n} envie${n > 1 ? "s" : ""}`,
    openCollection: (name: string, n: number) => `${name}, ${n} envie${n > 1 ? "s" : ""}`,
    back: "Retour",
    by: (name: string) => `Collection de ${name}`,
    notFound: "Cette collection n'est pas disponible.",
    friendEmpty: "Aucune envie dans cette collection pour l'instant.",
    loadMore: "Afficher la suite",
    loadMoreError: "La suite n'a pas pu être chargée. Réessayez.",
    keep: "Garder",
    keepLabel: (title: string) => `Garder ${title} dans mes Envies`,
    kept: "Ajoutée à vos Envies",
    alreadyKept: "Déjà dans vos Envies",
    keepError: "L'ajout a échoué. Réessayez.",
    talk: "En parler",
    talkLabel: (title: string, name: string) => `Parler de ${title} avec ${name}`,
    // Lot modération des collections : signaler la collection d'un ami ; la sienne, masquée par la modération.
    report: "Signaler cette collection",
    options: "Options de la collection",
    optionsLabel: (name: string) => `Options de la collection ${name} : la signaler, bloquer ce compte`,
    hiddenBadge: "Masquée",
    hiddenChipLabel: (name: string) => `${name}, masquée par la modération`,
    hiddenState: "Masquée par la modération : vos amis ne la voient plus.",
    hiddenCannotShare: "Cette collection a été masquée par la modération : vous ne pouvez pas la montrer à vos amis.",
    // Retours du build 2 (Envies compactes) : le bouton « … » au bout des puces, pour la collection choisie.
    ownOptionsLabel: (name: string) => `Options de la collection ${name}`,
    ownOptionsPosts: "Publications rangées ici",
    // Étagères des amis : collection privée quand « Montrer mes Envies à mes amis » est allumé.
    privateStateFriendsSeeWishes: "Nom privé : vos amis voient ses envies (réglage « Montrer mes Envies à mes amis »), pas son nom.",
  },
  // Lot 5 : pièces reçues (onglet « Reçues » des Envies).
  received: {
    title: "Pièces reçues",
    back: "Retour",
    empty: "Aucune pièce reçue pour l'instant. Quand une personne vous enverra une pièce, elle apparaîtra ici.",
    loadError: "Impossible de charger les pièces reçues.",
    loadMore: "Afficher la suite",
    loadMoreError: "La suite n'a pas pu être chargée. Réessayez.",
    from: (name: string) => `De ${name}`,
    options: (title: string) => `Options pour ${title}`,
    report: "Signaler cette pièce",
    remove: "Retirer cette pièce",
    removeConfirm: "Retirer cette pièce ? Elle sera définitivement supprimée.",
    removeCancel: "Annuler",
    removeConfirmCta: "Retirer",
    removed: "Pièce retirée",
    removeError: "Le retrait a échoué. Réessayez.",
  },
  feed: {
    emptyTitle: "Votre fil est encore calme",
    emptyBody:
      "Il réunira vos publications et celles des personnes que vous suivez. Commencez par identifier une pièce, partager une photo, ou trouver des profils à suivre.",
    emptySpot: "Spotter une pièce",
    emptyPublish: "Publier une photo",
    emptyFind: "Rechercher des profils",
    title: "Fil",
    loadError: "Impossible de charger le fil.",
    // Retours du build 2 : la pastille en forme de champ de recherche, en haut du Fil (elle remplace « Profils »).
    searchProfiles: "Rechercher un profil",
    searchProfilesHint: "Ouvre la recherche de membres par nom ou @pseudo",
  },
  comments: {
    title: "Commentaires",
    countLabel: (n: number) => (n === 0 ? "Commenter" : `${n} commentaire${n > 1 ? "s" : ""}`),
    placeholder: "Ajouter un commentaire…",
    send: "Publier",
    sending: "Envoi…",
    empty: "Aucun commentaire pour l'instant.",
    delete: "Supprimer",
    deleteConfirm: "Supprimer ce commentaire ?",
    deleted: "Commentaire supprimé",
    error: "L'envoi a échoué. Réessayez.",
    loadError: "Impossible de charger les commentaires.",
    more: "Plus d'options sur ce commentaire",
    share: "Partager la publication",
    linkCopied: "Lien de la publication copié",
    showMore: "Voir les commentaires suivants",
  },
  postDetail: {
    title: "Publication",
    visibility: "Qui peut voir cette publication",
    visibilityChanged: (label: string) => `Visibilité : ${label}`,
    visibilityError: "La modification a échoué. Réessayez.",
    delete: "Supprimer la publication",
    deleteConfirm: "Supprimer définitivement cette publication ? Ses « j'aime » seront aussi supprimés.",
    deleteConfirmPurchase: "Supprimer définitivement cette publication ? La pièce restera dans votre Vault.",
    deleteConfirmWish: "Supprimer définitivement cette publication ? La pièce restera dans vos Envies.",
    deleting: "Suppression…",
    deleted: "Publication supprimée",
    deleteError: "La suppression a échoué. Réessayez.",
    notFound: "Cette publication n'est pas disponible.",
    cancel: "Annuler",
    confirm: "Supprimer",
  },
  userProfile: {
    posts_count: (n: number) => `${n} publication${n > 1 ? "s" : ""}`,
    followers: (n: number) => `${n} abonné${n > 1 ? "s" : ""}`,
    following: (n: number) => `${n} abonnement${n > 1 ? "s" : ""}`,
    follow: "Suivre",
    unfollow: "Ne plus suivre",
    followError: "L'action a échoué. Réessayez.",
    posts: "Publications",
    noPosts: "Aucune publication visible pour le moment.",
    notFound: "Ce profil n'est pas disponible.",
    loadError: "Impossible de charger ce profil.",
    more: "Signaler ou bloquer",
    // Lot « étagères des amis » : l'état vide nomme la personne (vrai aussi quand ses publications sont privées).
    noPostsNamed: (name: string) => `${name} n'a encore rien publié.`,
  },
  wishlist: {
    title: "Envies",
    empty: "Aucune envie pour l'instant. Spottez une première pièce pour commencer.",
    emptyCta: "Spotter une pièce",
    loadError: "Impossible de charger vos envies.",
    privateNote: "Vos Envies sont privées : rien n'est partagé sans votre accord.",
    // Lot collections : quand les collections sont disponibles.
    privateNoteCollections: "Vos Envies sont privées, sauf celles que vous rangez dans une collection montrée à vos amis.",
    tabsLabel: "Afficher",
    mine: "Mes envies",
    received: "Reçues",
    // Recherche, tri et total (2026-11-09, lib/wishlist-view.ts). Textes à valider.
    searchPlaceholder: "Rechercher par nom ou boutique",
    searchLabel: "Rechercher dans vos envies, par nom ou par boutique",
    clearSearch: "Effacer la recherche",
    searchEmpty: (query: string, inCollection: boolean) =>
      inCollection ? `Aucune envie de cette collection ne correspond à « ${query} ».` : `Aucune envie ne correspond à « ${query} ».`,
    sortLabel: "Trier vos envies",
    sortRecent: "Récentes",
    sortPriceAsc: "Prix croissant",
    sortPriceDesc: "Prix décroissant",
    // Total des envies affichées, dans la devise la plus fréquente, sans conversion.
    totalLine: (n: number, total: string, scope: "all" | "collection" | "search") =>
      `${n} ${n > 1 ? "envies" : "envie"}${scope === "search" ? (n > 1 ? " trouvées" : " trouvée") : scope === "collection" ? " dans cette collection" : ""} · total ${total}`,
    noPriceLine: (n: number, scope: "all" | "collection" | "search") =>
      `${n} ${n > 1 ? "envies" : "envie"}${scope === "search" ? (n > 1 ? " trouvées" : " trouvée") : scope === "collection" ? " dans cette collection" : ""} · aucun prix indiqué`,
    totalOtherCurrency: (n: number) => (n > 1 ? `+ ${n} dans d'autres devises` : "+ 1 dans une autre devise"),
    totalWithoutPrice: (n: number) => `+ ${n} sans prix`,
    totalLoading: "Calcul du total…",
    // Au-delà de 500 envies, ou si une page n'a pas pu être lue.
    partialNote: (n: number) => `Calculé sur les ${n} envies chargées : faites défiler pour voir les suivantes.`,
    // Retours du build 2 (Envies compactes) : la phrase de confidentialité derrière un cadenas, la recherche
    // derrière une loupe, le tri dans un bouton. Titre neutre : il restera vrai le jour où vos amis pourront voir vos Envies.
    privacyTitle: "Qui voit vos Envies",
    privacyOk: "Compris",
    searchClose: "Fermer la recherche",
    sortShort: { recent: "Récentes", price_asc: "Prix ↑", price_desc: "Prix ↓" },
    sortButtonLabel: (current: string) => `Trier, actuellement : ${current}`,
    // Lot « étagères des amis » : la phrase quand « Montrer mes Envies à mes amis » est allumé.
    privateNoteFriends: "Vos amis voient toutes vos Envies (réglage « Montrer mes Envies à mes amis »), sauf celles d'une collection masquée par la modération. Vous pouvez les rendre privées dans Réglages.",
  },
  profile: {
    vault: "Vault",
    lifestyle: "Lifestyle",
    posts: "Publications",
    verified: "Achat vérifié",
    publish: "Publier",
    follow: "Suivre",
    following: "Abonné",
    followers: "Abonnés",
    followingCount: "Abonnements",
    emptyVault: "Aucune pièce dans votre Vault. Ajoutez-en une avec sa photo, ou confirmez un achat depuis Spotter.",
    emptyVaultCta: "Spotter une pièce",
    addPiece: "Ajouter une pièce",
    avatarUpdated: "Photo de profil mise à jour",
    avatarError: "L'envoi de la photo a échoué.",
    emptyLifestyle: "Aucune publication lifestyle pour l'instant.",
    lifestylePhoto: "Photo publiée",
    emptyLifestyleCta: "Publier une photo",
    loadError: "Impossible de charger cette section.",
    changeAvatar: "Changer la photo de profil",
  },
  vaultItem: {
    back: "Vault",
    backLabel: "Retour au vault",
    changePhoto: "Changer la photo",
    changingPhoto: "Envoi de la photo…",
    photoChanged: "Photo mise à jour",
    changePhotoError: "Le changement de photo a échoué. Réessayez.",
    privateNote: "Votre Vault est privé : personne d'autre que vous ne le voit. Pour montrer cette pièce, partagez-la dans votre fil.",
    shareVisibility: "Publication visible par",
    share: "Partager dans mon fil",
    sharing: "Partage…",
    shared: "Partagée dans votre fil",
    sharedState: (visibility: string) => `Partagée dans votre fil · ${visibility}`,
    viewPost: "Voir la publication",
    shareAgainHint: "Pour changer qui la voit, modifiez la visibilité depuis la publication.",
    remove: "Retirer du vault",
    removeConfirm: "Retirer définitivement cette pièce ?",
    removeConfirmWithPost: "Cette pièce apparaît dans une publication. La retirer supprimera aussi cette publication.",
    removeConfirmWithPosts: (count: number) =>
      `Cette pièce apparaît dans ${count} publications. La retirer supprimera aussi ces publications.`,
    removedToast: "Retiré du vault",
    removing: "Suppression…",
    confirm: "Confirmer",
    cancel: "Annuler",
    loadError: "Impossible de charger cette pièce.",
    updateError: "La mise à jour a échoué.",
    shareError: "Le partage a échoué.",
    removeError: "La suppression a échoué.",
    // Lot 2 (Vault) : « Modifier » le titre et la catégorie.
    edit: "Modifier",
    editLabel: "Modifier le titre et la catégorie",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Modifications enregistrées",
  },
  // Lot 2 (Vault) : ajout d'une pièce à la main (photo, titre, catégorie).
  // Libellés et messages repris par « Modifier », sur l'écran de la pièce.
  vaultForm: {
    title: "Ajouter une pièce",
    cancel: "Annuler",
    privateNote: "Votre Vault est privé : personne d'autre que vous ne verra cette pièce.",
    addPhoto: "Ajouter une photo",
    changePhoto: "Changer la photo",
    photoLabel: "Photo de la pièce",
    titleLabel: "Titre",
    titlePlaceholder: "Ex. : veste en daim camel",
    categoryLabel: "Catégorie",
    submit: "Ajouter",
    submitting: "Ajout en cours…",
    added: "Pièce ajoutée à votre Vault",
    addError: "L'ajout a échoué. Réessayez.",
    photoRequired: "Ajoutez une photo de la pièce.",
    titleRequired: "Indiquez un titre.",
    titleTooLong: (max: number) => `Le titre est trop long (${max} caractères maximum).`,
    categoryRequired: "Choisissez une catégorie.",
    photoTooLarge: "Cette photo est trop lourde (10 Mo maximum). Choisissez-en une autre.",
  },
  publish: {
    title: "Nouvelle publication",
    cancel: "Annuler",
    publish: "Publier",
    addPhoto: "Ajouter une photo",
    selectedPhoto: "Photo sélectionnée",
    captionPlaceholder: "Écrivez une légende…",
    piecesLabel: "Pièces identifiées",
    addPiece: "Identifier une pièce",
    published: "Publié",
    visibility: "Qui peut voir cette publication",
    noRecentPieces: "Aucune pièce récente. Spottez-en une d'abord depuis l'onglet Spotter.",
    closePicker: "Fermer",
    modePhoto: "Une photo",
    modeVault: "Une pièce de mon Vault",
    vaultHint: "Choisissez la pièce à montrer : elle apparaîtra comme un achat, avec sa photo.",
    vaultEmpty: "Votre Vault est vide. Ajoutez-y une pièce depuis un résultat du Spotter (« Je l'ai achetée »).",
    vaultLoadError: "Impossible de charger votre Vault.",
    choosePiece: "Choisissez une pièce de votre Vault.",
    photoRequired: "Ajoutez une photo.",
    error: "La publication a échoué, réessayez.",
    publishing: "Publication en cours",
    changePhoto: "Changer la photo",
    captionLabel: "Légende de la publication",
    removePiece: (name: string) => `Retirer ${name}`,
  },
  settings: {
    title: "Réglages",
    account: "Compte",
    editProfile: "Modifier le profil",
    privacy: "Profil public ou privé",
    exportData: "Exporter mes données",
    deleteAccount: "Supprimer mon compte",
    deleteConfirm: "Cette action est définitive. Toutes vos données seront supprimées sans possibilité de récupération.",
    terms: "Conditions d'utilisation",
    privacyPolicy: "Politique de confidentialité",
    // Titre de l'explication dépliée sous « Lien affilié » (components/affiliate-mention.tsx).
    howWeEarn: `Comment ${BRAND} se rémunère`,
    signOut: "Se déconnecter",
    documents: "Documents",
    analyticsTitle: "Statistiques d'usage",
    analyticsOn: "Vous partagez des statistiques d'usage (jamais vos contenus, votre nom ni votre e-mail). Merci !",
    analyticsOff: "Vous ne partagez pas de statistiques d'usage.",
    analyticsLoading: "Chargement de votre choix…",
    analyticsFailed: "Votre choix n'a pas pu être enregistré. Réessayez.",
    analyticsSwitchLabel: "Partager des statistiques d'usage",
    videoAiTitle: "Analyse automatique des vidéos",
    videoAiSwitchLabel: "Analyse automatique des vidéos par une IA",
    videoAiOn:
      `Activée : quand vous la lancez, quelques images réduites de la vidéo (de votre téléphone, ou d'un lien TikTok ou Instagram récupéré le temps de l'analyse) et votre description sont envoyées à Anthropic (États-Unis) pour trouver la pièce, sans être conservées par ${BRAND}.`,
    videoAiOff: "Désactivée : aucune image de vos vidéos n'est envoyée ; vous choisissez l'image vous-même.",
    videoAiFailed: "Votre choix n'a pas pu être enregistré. Réessayez.",
    latestVideoTitle: "Proposer ma dernière vidéo",
    latestVideoSwitchLabel: "Proposer automatiquement ma dernière vidéo dans Spotter",
    latestVideoOn: "Activé : Spotter vous propose la dernière vidéo de votre galerie, prête à être analysée.",
    latestVideoOnNoAccess:
      `Activé, mais ${BRAND} n'a pas l'accès complet à vos photos : la dernière vidéo ne peut pas être repérée. Vous la choisissez avec « Ajouter une vidéo ».`,
    latestVideoOff: `Désactivé : vous choisissez la vidéo avec « Ajouter une vidéo », sans que ${BRAND} lise votre galerie.`,
    latestVideoAccessLeft: `${BRAND} a encore accès à vos photos, sans s'en servir : vous pouvez le lui retirer dans les Réglages de l'iPhone.`,
    latestVideoOpenSettings: "Ouvrir les Réglages de l'iPhone",
    latestVideoFailed: "Votre choix n'a pas pu être enregistré. Réessayez.",
    latestVideoUnavailable: "Réglage indisponible pour le moment.",
    latestVideoOpenFailed: `Les Réglages de l'iPhone n'ont pas pu s'ouvrir : passez par l'app Réglages, puis ${BRAND}.`,
    consentLoading: "Statut de votre acceptation en cours de chargement…",
    consentFailed: "Statut de votre acceptation indisponible pour le moment.",
    acceptedOn: (date: string) => `Version en vigueur acceptée le ${date}.`,
    acceptedEarlier: (date: string) => `Acceptée le ${date} ; la dernière mise à jour ne demande pas de nouvelle acceptation.`,
    notAccepted: "Version en vigueur pas encore acceptée : ouvrez le document pour la lire et l'accepter.",
    dataSection: "Vos données",
    // Lot 5 : « Qui peut m'envoyer des pièces ».
    pieceSendsTitle: "Qui peut m'envoyer des pièces",
    pieceSendsFollowing: "Comptes que je suis",
    pieceSendsEveryone: "Tout le monde",
    pieceSendsNobody: "Personne",
    pieceSendsHint: "Un compte que vous avez bloqué ne peut jamais vous en envoyer.",
    pieceSendsError: "Ce réglage n'a pas pu être enregistré. Réessayez.",
    // Lot messages : « Qui peut m'écrire » (invitations des autres membres).
    messagesFromTitle: "Qui peut m'écrire",
    messagesFromEveryone: "Tout le monde",
    messagesFromFollowing: "Comptes que je suis",
    messagesFromNobody: "Mes amis seulement",
    messagesFromHint:
      "Vos amis (vous vous suivez l'un l'autre) peuvent toujours vous écrire. Les autres vous envoient une seule invitation, que vous acceptez ou refusez. Un compte bloqué ne peut jamais vous écrire.",
    messagesFromError: "Ce réglage n'a pas pu être enregistré. Réessayez.",
    // Lot « messages vus » : « Confirmations de lecture » (réciproque).
    readReceiptsTitle: "Confirmations de lecture",
    readReceiptsSwitchLabel: "Montrer quand j'ai lu un message, et voir quand les miens sont lus",
    readReceiptsHint:
      "Dans une conversation, « Vu » s'affiche sous le dernier message envoyé quand l'autre membre l'a lu. Si vous désactivez ce réglage, l'autre membre ne voit plus « Vu » pour vos lectures, et vous ne voyez plus les siennes. Ce que vous lisez pendant qu'il est désactivé n'est jamais montré ensuite, même si vous le réactivez.",
    readReceiptsError: "Ce réglage n'a pas pu être enregistré. Réessayez.",
    exporting: "Préparation de l'export…",
    exportError: "L'export a échoué, réessayez.",
    // Lot 5 : le format se choisit à chaque export (fichier lisible ou JSON).
    exportChoiceIntro: "Une copie de toutes les données de votre compte, dans le format de votre choix. Ce fichier est personnel : gardez-le en lieu sûr.",
    exportReadable: "Fichier lisible",
    exportReadableHint: "S'ouvre dans votre navigateur, tout y est expliqué simplement. La version technique est incluse à la fin.",
    exportJson: "Format technique (JSON)",
    exportJsonHint: "Pour transférer vos données vers un autre service.",
    exportFileBase: `${APP_FILE_SLUG}-mes-donnees`,
    exportDone: "Fichier téléchargé : ouvrez-le depuis vos téléchargements.",
    dangerZone: "Zone sensible",
    deleting: "Suppression…",
    confirmDelete: "Confirmer la suppression",
    deleteError: "La suppression a échoué. Vérifiez votre connexion, puis réessayez.",
    deleteTypeWord: (word: string) => `Pour confirmer, tapez ${word} ci-dessous.`,
    deleteWordLabel: (word: string) => `Mot de confirmation : ${word}`,
  },
  // « Nous contacter » (Réglages, écran d'accueil) : adresse de l'éditeur,
  // lue à la construction (lib/contact.ts). Sans adresse réelle, rien ne
  // s'affiche.
  contact: {
    settingsSection: "Aide",
    link: "Nous contacter",
    linkHint: "Ouvre votre messagerie pour nous écrire.",
    openFailed: "Votre messagerie n'a pas pu s'ouvrir : copiez l'adresse ci-dessus pour nous écrire.",
  },
  // Chantier 3 (comptes et modération) : page « Aide et contact » (/aide),
  // publique, connecté ou non. Elle sert aussi d'adresse d'assistance
  // (« Support URL ») de la fiche App Store.
  help: {
    title: "Aide et contact",
    entry: "Aide et contact",
    intro: "Les réponses aux questions les plus fréquentes, et le moyen de nous écrire.",
    faqTitle: "Questions fréquentes",
    faq: [
      {
        q: "Comment retrouver une pièce ?",
        a: `Dans le Spotter, importez une photo, une capture d'écran ou une vidéo, puis entourez la pièce si besoin. ${BRAND} cherche la même pièce, ou les plus proches, et vous indique où l'acheter quand il trouve une boutique et un prix.`,
      },
      {
        q: "Combien de recherches puis-je lancer ?",
        a: "Le nombre de recherches est limité chaque jour, pour chaque personne et pour l'ensemble du service. Le compteur repart chaque jour.",
      },
      {
        q: "J'ai oublié mon mot de passe",
        a: "Sur l'écran de connexion, touchez « Mot de passe oublié ? » et indiquez votre adresse e-mail. Vous recevrez un lien valable une heure : ouvrez-le sur l'appareil où vous avez fait la demande (le même téléphone, ou le même navigateur).",
      },
      {
        q: "Je n'ai pas reçu l'e-mail de confirmation",
        a: "Regardez dans vos courriers indésirables. Sur l'écran d'inscription, vous pouvez renvoyer l'e-mail au bout d'une minute.",
      },
      {
        q: "Signaler un contenu, bloquer un compte",
        a: `Ouvrez le menu d'une publication, d'un commentaire, d'un profil ou d'une pièce reçue, puis choisissez « Signaler » ou « Bloquer ce compte ». Ce que vous signalez disparaît aussitôt de votre fil. Chaque signalement est examiné par l'équipe de ${BRAND} ; un contenu signalé par plusieurs personnes est masqué en attendant cet examen. Vos comptes bloqués se gèrent dans les Réglages.`,
      },
      {
        q: "Quels contenus sont interdits ?",
        a: "Les insultes, les propos haineux, le harcèlement et les contenus sexuels ou violents, comme le détaillent les conditions d'utilisation. Un texte qui contient un mot interdit ne peut pas être publié.",
      },
      {
        q: "Mes données et mon compte",
        a: "Dans les Réglages, vous pouvez télécharger toutes vos données et supprimer votre compte. La suppression est définitive.",
      },
    ],
    contactTitle: "Nous écrire",
    contactBody: "Une question, un problème, un contenu à nous signaler : écrivez-nous à cette adresse.",
    write: "Écrire un e-mail",
    documentsTitle: "Documents",
  },
  legal: {
    draftBanner: "Projet — à faire valider par un professionnel.",
    version: (label: string) => `Version : ${label}`,
    draftVersion: (date: string) => `projet du ${date}`,
    accept: "J'accepte cette version",
    ageDeclaration: `Je certifie avoir au moins ${MINIMUM_AGE} ans.`,
    accepting: "Enregistrement…",
    accepted: (date: string) => `Vous avez accepté cette version le ${date}.`,
    acceptedEarlier: (date: string) =>
      `Vous avez accepté ce document le ${date}. Sa dernière mise à jour est une simple information : elle ne demande pas de nouvelle acceptation.`,
    acceptedToast: "Votre acceptation est enregistrée.",
    acceptFailed: "Votre acceptation n'a pas pu être enregistrée. Réessayez.",
    statusFailed: "Impossible de vérifier votre acceptation de ce document.",
    retry: "Réessayer",
    analyticsPrompt:
      `Aidez-nous à améliorer ${BRAND} : acceptez-vous de partager des statistiques d'usage ? Jamais vos contenus, votre nom ni votre e-mail. Modifiable à tout moment dans les Réglages.`,
    analyticsPromptYes: "Oui, volontiers",
    analyticsPromptNo: "Non merci",
    // Information de la version « projet-2026-11-05 » (POLICY_UPDATE_NOTICE, shared-types).
    updateNotice:
      "Notre politique de confidentialité a été mise à jour : elle décrit les nouvelles recherches dans d'autres boutiques et avec vos mots. Une IA lit les titres des résultats, jamais votre photo.",
    updateNoticeRead: "Lire la politique",
    updateNoticeDismiss: "OK",
    updateNoticeDismissLabel: "Fermer cette information",
    readTerms: "Lire les conditions d'utilisation",
    readPrivacy: "Lire la politique de confidentialité",
  },
  editProfile: {
    title: "Modifier le profil",
    username: "Nom d'utilisateur",
    displayName: "Nom affiché",
    bio: "Bio",
    bioPlaceholder: "Quelques mots sur vous…",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Profil mis à jour",
    usernameError: "Le nom d'utilisateur doit faire 3 à 20 caractères : lettres minuscules, chiffres, underscore.",
    usernameTaken: "Ce nom d'utilisateur est déjà pris.",
    displayNameError: "Le nom affiché est obligatoire.",
    saveError: "Une erreur est survenue, réessayez.",
    // Lot « profil et icône des réglages ».
    bioHint: (max: number, lines: number) => `${max} caractères et ${lines} lignes au plus.`,
    bioCounterLabel: (count: number, max: number) => `${count} caractères sur ${max}`,
    bioTooLong: (max: number) => `Votre bio dépasse ${max} caractères : raccourcissez-la pour enregistrer.`,
    bioTooManyLines: (lines: number) => `Votre bio dépasse ${lines} lignes : raccourcissez-la pour enregistrer.`,
    changePhoto: "Changer la photo",
    addPhoto: "Ajouter une photo",
  },
  // Photo de profil : choix, recadrage, suppression (lot « profil et icône des réglages »).
  avatarPhoto: {
    menuTitle: "Photo de profil",
    chooseFromLibrary: "Choisir dans la galerie",
    chooseFile: "Choisir un fichier",
    takePhoto: "Prendre une photo",
    remove: "Supprimer ma photo",
    removeConfirm: `Votre photo de profil sera effacée de ${BRAND}. Vos initiales s'afficheront à la place.`,
    cancel: "Annuler",
    cropTitle: "Cadrez votre photo",
    cropHint: "Faites glisser la photo pour la placer dans le cercle. Pincez pour zoomer.",
    cropHintWeb: "Faites glisser la photo pour la placer dans le cercle.",
    cropArea: "Zone de recadrage de la photo",
    zoomIn: "Zoomer",
    zoomOut: "Dézoomer",
    preview: "Aperçu",
    validate: "Valider",
    sending: "Envoi…",
    deleting: "Suppression…",
    removed: "Photo de profil supprimée",
    sendError: "L'envoi de la photo a échoué. Réessayez.",
    removeError: "La photo n'a pas pu être supprimée. Réessayez.",
    refusedFormat: "Format non accepté : choisissez une photo JPEG, PNG ou HEIC.",
    refusedHeicBrowser: `Ce navigateur ne sait pas ouvrir les photos HEIC. Choisissez une photo JPEG ou PNG, ou utilisez Safari ou l'app ${BRAND} sur iPhone.`,
    refusedTooLarge: (max: number) => `Cette photo est trop lourde (${max} Mo maximum). Choisissez-en une autre.`,
    refusedUnreadable: "Cette photo n'a pas pu être ouverte. Choisissez-en une autre.",
  },
  notifications: {
    title: "Activité",
    empty: "Aucune notification pour l'instant.",
    follow: "a commencé à vous suivre.",
    like: "a aimé votre publication.",
    comment: "a commenté votre publication.",
    pieceReceived: "vous a envoyé une pièce.",
    loadError: "Impossible de charger les notifications.",
    loadMore: "Afficher les notifications plus anciennes",
    loadMoreError: "La suite n'a pas pu être chargée. Réessayez.",
    // Lot 5 : décisions de la modération (jamais le nom d'un administrateur).
    reportHandled: "Votre signalement a été traité. Merci.",
    reportHandledAbout: { post: "Votre signalement d'une publication a été traité. Merci.", comment: "Votre signalement d'un commentaire a été traité. Merci.", user: "Votre signalement d'un profil a été traité. Merci.", piece: "Votre signalement d'une pièce reçue a été traité. Merci.", message: "Votre signalement d'un message a été traité. Merci.", collection: "Votre signalement d'une collection a été traité. Merci." },
    moderationHiddenPost: "Votre publication a été masquée par la modération.",
    moderationHiddenComment: "Votre commentaire a été masqué par la modération.",
    moderationHiddenPiece: "Une pièce que vous avez envoyée a été masquée par la modération.",
    // Lot messages : un message envoyé.
    moderationHiddenMessage: "Un message que vous avez envoyé a été masqué par la modération.",
    moderationRestoredMessage: "Un message que vous avez envoyé a été rétabli.",
    moderationSuspended:
      "Votre compte a été suspendu : vous ne pouvez plus publier, commenter, suivre, réagir ni modifier votre profil. Votre bio et votre photo de profil ne sont plus montrées aux autres membres.",
    moderationRestoredPost: "Votre publication a été rétablie.",
    moderationRestoredComment: "Votre commentaire a été rétabli.",
    moderationRestoredPiece: "Une pièce que vous avez envoyée a été rétablie.",
    moderationUnsuspended: "La suspension de votre compte a été levée.",
    moderationImageRemovedPost: "L'image de votre publication « envie » a été retirée par la modération. La publication reste visible, sans son image.",
    moderationImageRemovedPiece: "L'image d'une pièce que vous avez envoyée a été retirée par la modération. La pièce reste visible, sans son image.",
    // Lot modération des collections : une de vos collections montrées aux amis.
    moderationHiddenCollection: "Une de vos collections a été masquée par la modération : vos amis ne la voient plus.",
    moderationRestoredCollection: "Une de vos collections n'est plus masquée par la modération.",
    moderationImageRemovedCollection: "L'image d'une envie de votre collection a été retirée par la modération. Vos amis voient l'envie sans son image.",
    // Lot « conformité Apple » (migration 0037) : la bio ou la photo du profil.
    moderationBioRemoved: "Votre bio a été retirée par la modération, avec le lien de votre profil s'il y en avait un.",
    moderationAvatarRemoved: "Votre photo de profil a été retirée par la modération : son fichier est effacé.",
    moderationOther: "Une décision de la modération vous concerne.",
    moderationReason: (reason: string) => `Motif : ${reason}`,
    moderationNote: (note: string) => `Précision : ${note}`,
  },
  // Lot limites annoncées (2026-11-03) : les limites dites AVANT l'effort
  // (accueil du Spotter, écran de cadrage), et le chiffre et l'heure de
  // reprise dans les messages de limite. Heures et dates à l'heure de
  // l'appareil (la reprise est à minuit, heure de Paris).
  searchLimits: {
    pausedTitle: (until: string) => `Spotter fait une pause ${until}.`,
    usedUpTitle: (limit: number) => (limit === 1 ? "Vous avez utilisé votre recherche du jour." : `Vous avez utilisé vos ${limit} recherches du jour.`),
    retryFrom: (from: string) => `Réessayez ${from}.`,
    remaining: (n: number) => (n === 1 ? "Il vous reste 1 recherche aujourd'hui." : `Il vous reste ${n} recherches aujourd'hui.`),
    until: {
      midnight: "jusqu'à minuit",
      time: (time: string) => `jusqu'à ${time}`,
      tomorrow: (time: string) => `jusqu'à demain, ${time}`,
      date: (date: string) => `jusqu'au ${date}`,
      dateTime: (date: string, time: string) => `jusqu'au ${date}, ${time}`,
    },
    from: {
      midnight: "à partir de minuit",
      time: (time: string) => `à partir de ${time}`,
      tomorrow: (time: string) => `demain à partir de ${time}`,
      date: (date: string) => `à partir du ${date}`,
      dateTime: (date: string, time: string) => `à partir du ${date}, ${time}`,
    },
  },
  moderation: {
    reportUser: "Signaler ce profil",
    reportPost: "Signaler cette publication",
    block: "Bloquer ce compte",
    blockConfirm: "Bloquer ce compte ? Vous ne verrez plus ses publications et il ne pourra plus vous suivre.",
    blockConfirmCta: "Confirmer le blocage",
    blockSuccess: "Compte bloqué.",
    blockError: "Le blocage a échoué.",
    reportSuccess: "Signalement envoyé. Merci.",
    reportError: "Le signalement a échoué.",
    cancel: "Annuler",
    reasonSpam: "Spam",
    reasonInappropriate: "Contenu inapproprié",
    reasonHarassment: "Harcèlement",
    reasonOther: "Autre",
    /** Motif neutre du retrait d'une image copiée (lot 5, partie B) : jamais proposé dans « Signaler ». */
    reasonImageRights: "Droits sur l'image",
  },
  // Lot 5 : écran réservé aux administrateurs (entrée discrète des Réglages).
  moderationQueue: {
    settingsEntry: "Modération",
    title: "Modération",
    tabs: "Signalements",
    open: "À traiter",
    handled: "Traités",
    emptyOpen: "Aucun signalement à traiter.",
    emptyHandled: "Aucun signalement traité pour l'instant.",
    refresh: "Actualiser",
    loadError: "Impossible de charger les signalements.",
    loadMore: "Afficher la suite",
    target: { post: "Publication", comment: "Commentaire", user: "Profil", piece: "Pièce envoyée", message: "Message privé", collection: "Collection d'envies" },
    reportCount: (n: number) => `${n} signalement${n > 1 ? "s" : ""}`,
    lastReport: (ago: string) => `Dernier signalement ${ago}`,
    reasons: "Motifs signalés",
    notes: "Précisions des signalements",
    missing: "Ce contenu n'existe plus : il a été supprimé depuis.",
    hidden: "Masqué",
    suspended: "Compte suspendu",
    dismiss: "Classer sans suite",
    hidePost: "Masquer la publication",
    hideComment: "Masquer le commentaire",
    hidePiece: "Masquer la pièce",
    hideMessage: "Masquer le message",
    suspend: "Suspendre le compte",
    restorePost: "Rétablir la publication",
    restoreComment: "Rétablir le commentaire",
    restorePiece: "Rétablir la pièce",
    restoreMessage: "Rétablir le message",
    // Lot modération des collections : le nom, l'auteur et les dernières envies (titre et copie de l'image).
    hideCollection: "Masquer la collection",
    restoreCollection: "Rétablir la collection",
    collectionVisibility: { private: "Privée : son auteur seul la voit", friends: "Montrée à ses amis" },
    collectionItems: (shown: number, total: number) => `Dernières envies ajoutées (${shown} sur ${total})`,
    collectionEmpty: "Aucune envie dans cette collection.",
    removeItemImageLabel: (title: string) => `Retirer l'image de ${title}`,
    removeItemImageWarning:
      "Retirer l'image de cette envie ? Son fichier sera effacé définitivement : cette décision ne s'annule pas. Les amis verront l'envie avec « Image indisponible », son titre et le lien du marchand. La personne sera prévenue, avec le motif « droits sur l'image ».",
    // Lot messages : seulement le message signalé et quelques messages autour.
    messageContext: "Extrait de la conversation (le message signalé est marqué)",
    messageReported: "Message signalé",
    messageWish: (title: string) => `Envie jointe : ${title}`,
    unsuspend: "Lever la suspension",
    reason: "Motif de la décision",
    noteLabel: "Précision pour la personne concernée (facultatif)",
    noteHint: "Elle lui sera montrée avec le motif. Ne mentionnez jamais l'auteur d'un signalement.",
    confirmHide: "Confirmer le masquage",
    suspendWarning:
      "Suspendre ce compte ? Il ne pourra plus publier, commenter, suivre, réagir ni modifier son profil, et n'apparaîtra plus en recherche. Sa bio et sa photo de profil ne seront plus montrées aux autres membres. Vous pourrez lever la suspension.",
    confirmSuspend: "Confirmer la suspension",
    saved: "Décision enregistrée.",
    undone: "Décision annulée.",
    saveError: "La décision n'a pas pu être enregistrée.",
    // Retirer l'image copiée d'une envie partagée (lot 5, partie B).
    removeImage: "Retirer l'image",
    removeImageWarning:
      "Retirer l'image ? Son fichier sera effacé définitivement : cette décision ne s'annule pas. Le contenu restera visible avec « Image indisponible », son titre et le lien du marchand. La personne sera prévenue, avec le motif « droits sur l'image ».",
    confirmRemoveImage: "Confirmer le retrait",
    imageRemoved: "Image retirée",
    imageRemovedSaved: "Image retirée : son fichier est effacé.",
    // Lot « conformité Apple » (migration 0037) : retirer la bio ou la photo d'un profil signalé.
    removeBio: "Retirer la bio",
    removeAvatar: "Retirer la photo de profil",
    removeBioWarning:
      "Retirer la bio de ce profil ? Elle sera effacée : cette décision ne s'annule pas. La personne sera prévenue, avec le motif choisi. Elle pourra en écrire une autre, sauf si son compte est suspendu.",
    removeAvatarWarning:
      "Retirer la photo de ce profil ? Son fichier sera effacé définitivement : cette décision ne s'annule pas. La personne sera prévenue, avec le motif choisi. Elle pourra en choisir une autre, sauf si son compte est suspendu.",
    bioRemovedSaved: "Bio retirée.",
    avatarRemovedSaved: "Photo de profil retirée : son fichier est effacé.",
    history: "Décisions",
    actions: {
      dismiss: "Classé sans suite",
      hide: "Masqué",
      suspend: "Compte suspendu",
      restore: "Rétabli",
      unsuspend: "Suspension levée",
      remove_image: "Image retirée",
      remove_bio: "Bio retirée",
      remove_avatar: "Photo de profil retirée",
    },
    by: (username: string) => `par @${username}`,
  },
  blockedUsers: {
    title: "Comptes bloqués",
    empty: "Aucun compte bloqué.",
    unblock: "Débloquer",
    unblockError: "Le déblocage a échoué.",
    loadError: "Impossible de charger les comptes bloqués.",
  },
  // Chantier 3 (comptes et modération) : lien « mot de passe oublié » ouvert
  // sur un autre appareil (échange PKCE), contenu signalé retiré du fil,
  // masquage automatique vu par un administrateur.
  accountSafety: {
    resetOtherDeviceTitle: "Ouvrez ce lien sur le bon appareil",
    resetOtherDeviceBody:
      "Pour votre sécurité, ce lien ne fonctionne que sur l'appareil où vous avez demandé un nouveau mot de passe (le même téléphone, ou le même navigateur). Ouvrez-le là-bas, ou refaites la demande ici.",
    emailConfirmed: "Votre adresse e-mail est confirmée. Connectez-vous pour continuer.",
    reportedHidden: "Signalement envoyé. Ce contenu ne vous sera plus montré.",
    autoHidden: "Masqué automatiquement",
    autoHiddenHint:
      "Masqué après les signalements de plusieurs personnes, en attente de votre décision : confirmez le masquage, ou classez sans suite pour le rétablir.",
    automatic: "automatique (plusieurs signalements)",
    confirmAutoHide: "Confirmer le masquage",
    dismissAndRestore: "Classer sans suite et rétablir",
  },
  connection: {
    connectingTitle: `Connexion à ${BRAND}…`,
    // Après quelques secondes d'attente (demande du fondateur, 2026-10-16) :
    // le serveur gratuit se met en veille ; réveils mesurés de 37 à 60 s.
    wakingTitle: `${BRAND} se réveille…`,
    wakingBody: "Après un moment sans visite, le serveur se met en veille. Il lui faut jusqu'à une minute pour redémarrer.",
    failedTitle: `${BRAND} est momentanément injoignable.`,
    failedBody: "Vérifiez votre connexion internet, puis réessayez. Vos données sont intactes.",
    retry: "Réessayer",
    signOut: "Se déconnecter",
  },
  auth: {
    errors: {
      invalidCredentials: "E-mail ou mot de passe incorrect.",
      emailNotConfirmed: "Confirmez votre e-mail avant de vous connecter (vérifiez votre boîte de réception, y compris les courriers indésirables).",
      alreadyRegistered: "Un compte existe déjà avec cet e-mail.",
      passwordTooShort: "Le mot de passe est trop court.",
      samePassword: "Choisissez un mot de passe différent de l'ancien.",
      linkExpired: "Ce lien n'est plus valable. Demandez un nouveau lien.",
      invalidEmail: "Adresse e-mail invalide.",
      rateLimited: "Trop de tentatives, réessayez dans quelques minutes.",
      network: "Connexion impossible, vérifiez votre réseau.",
      signupsClosed: "Les inscriptions ne sont pas ouvertes pour le moment.",
    },
    continueWithApple: "Continuer avec Apple",
    continueWithEmail: "Continuer avec un e-mail",
    email: "Email",
    password: "Mot de passe",
    signIn: {
      title: "Bon retour",
      subtitle: "Connectez-vous pour retrouver votre vault.",
      cta: "Se connecter",
      ctaLoading: "Connexion…",
      noAccount: "Pas encore de compte ? Créez-en un",
      forgot: "Mot de passe oublié ?",
    },
    forgot: {
      title: "Mot de passe oublié",
      subtitle: "Indiquez l'adresse e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.",
      cta: "Envoyer le lien",
      ctaLoading: "Envoi…",
      sentTitle: "Vérifiez votre boîte mail",
      sentBody: (email: string) =>
        `Si un compte existe pour ${email}, un e-mail vient de partir. Ouvrez le lien qu'il contient, sur cet appareil de préférence (pensez à vérifier les courriers indésirables). Le lien est valable une heure.`,
      back: "Retour à la connexion",
    },
    reset: {
      title: "Nouveau mot de passe",
      subtitle: "Choisissez un mot de passe d'au moins 8 caractères.",
      password: "Nouveau mot de passe",
      confirm: "Confirmez le mot de passe",
      cta: "Enregistrer",
      ctaLoading: "Enregistrement…",
      tooShort: "Le mot de passe doit contenir au moins 8 caractères.",
      mismatch: "Les deux mots de passe ne sont pas identiques.",
      done: "Mot de passe modifié",
      checking: "Vérification du lien…",
      expiredTitle: "Ce lien n'est plus valable",
      expiredBody: "Il a expiré (au bout d'une heure) ou a déjà servi. Demandez un nouveau lien.",
      invalidTitle: "Lien incomplet",
      invalidBody: "Ouvrez directement le lien reçu par e-mail, sans le modifier, ou demandez-en un nouveau.",
      newLink: "Demander un nouveau lien",
    },
    signUp: {
      title: "Créer un compte",
      // La promesse plutôt qu'un « vault » encore inconnu (lot « premier essai »).
      subtitle: "Retrouvez où acheter les pièces que vous repérez.",
      confirmPassword: "Confirmez le mot de passe",
      consent: "J'accepte les conditions d'utilisation et la politique de confidentialité.",
      ageDeclaration: `Je certifie avoir au moins ${MINIMUM_AGE} ans.`,
      consentRequired: "Merci d'accepter les conditions d'utilisation et la politique de confidentialité pour continuer.",
      analyticsConsent: `Facultatif : aider à améliorer ${BRAND} en partageant des statistiques d'usage (jamais vos contenus, votre nom ni votre e-mail).`,
      ageRequired: `${BRAND} est réservé aux personnes âgées d'au moins ${MINIMUM_AGE} ans : merci de le certifier pour continuer.`,
      cta: "Créer mon compte",
      ctaLoading: "Création…",
      hasAccount: "Déjà un compte ? Connectez-vous",
      confirmTitle: "Vérifiez votre boîte mail",
      confirmBody: (email: string) =>
        `Nous avons envoyé un lien de confirmation à ${email}. Cliquez dessus pour activer votre compte, puis revenez vous connecter.`,
      backToSignIn: "Retour à la connexion",
    },
  },
  // Lot « app iPhone prête » (chantier 4) : mise à jour obligatoire (point 11)
  // et bouton appareil photo du Spotter (point 14).
  appUpdate: {
    title: `Mettez à jour ${BRAND}`,
    body: `Cette version de ${BRAND} n'est plus prise en charge. Installez la dernière version depuis l'App Store pour continuer.`,
    openStore: "Ouvrir l'App Store",
    searchStore: `Ouvrez l'App Store, cherchez « ${BRAND} », puis touchez « Mettre à jour ».`,
  },
  cameraCapture: {
    takePhoto: "Prendre une photo",
    denied: `${BRAND} n'a pas accès à l'appareil photo. Pour prendre une photo, autorisez-le dans les Réglages de l'iPhone, puis ${BRAND}.`,
    unavailable: (addPhoto: string) => `L'appareil photo n'a pas pu s'ouvrir. Réessayez, ou choisissez une photo avec « ${addPhoto} ».`,
  },
  // Lot « anti-robots » (point 17) : vérification Cloudflare Turnstile avant
  // connexion, inscription, « mot de passe oublié » et renvoi de l'e-mail.
  robotCheck: {
    checking: "Vérification anti-robots en cours…",
    failed: "Vérification impossible : réessayez.",
    retry: "Réessayer",
    rejected: "La vérification anti-robots a échoué : réessayez.",
    frameTitle: "Vérification anti-robots",
  },
  // Lot « messages, plus de confort » (migration 0044) : aimer un message, y
  // répondre, le supprimer, envoyer une publication dans une conversation.
  messageActions: {
    like: "Aimer",
    unlike: "Ne plus aimer",
    reply: "Répondre",
    delete: "Supprimer",
    report: "Signaler",
    block: "Bloquer",
    deleteConfirm: "Supprimer ce message pour vous deux ?",
    deleted: "Message supprimé",
    replyingTo: (name: string) => `Réponse à ${name}`,
    replyingToSelf: "Réponse à votre message",
    cancelReply: "Annuler la réponse",
    quoteUnavailable: "Message indisponible",
    postUnavailable: "Publication indisponible",
    sendPost: "Envoyer dans un message",
    previewPost: "Publication partagée",
    // Ce que VoiceOver lit, et le reste de l'écran.
    optionsHint: "Aimer ce message, y répondre, le supprimer ou le signaler",
    quoteFromYou: "Vous",
    likedByYou: "Aimé par vous",
    likedBy: (name: string) => `Aimé par ${name}`,
    likedByBoth: (name: string) => `Aimé par vous et ${name}`,
    likeError: "Votre « j'aime » n'a pas pu être enregistré. Réessayez.",
    deleteError: "Ce message n'a pas pu être supprimé. Réessayez.",
    attachedPost: "Publication jointe",
    attachedPostBy: (name: string) => `Publication de ${name}`,
    removePost: "Retirer la publication",
    openPost: (name: string) => `Voir la publication de ${name}`,
    chooseHintPost: "La publication sera jointe à votre message, vous pourrez ajouter un mot. La personne ne la verra que si elle a le droit de la voir.",
    // File de modération : un message supprimé par son auteur.
    deletedByAuthorOn: (date: string) => `Supprimé par son auteur le ${date}`,
    // Feuille des actions : ouvrir la publication reçue (VoiceOver).
    viewPost: "Voir la publication",
  },
  // Lot quotas (migration 0053) : la part du mois d'un compte gratuit,
  // annoncée quand il en reste 20 ou moins, et à 0 avec la date du retour.
  monthlyQuota: {
    remaining: (n: number) => (n === 1 ? "Il vous reste 1 recherche ce mois-ci." : `Il vous reste ${n} recherches ce mois-ci.`),
    // « de novembre », « d'avril », « d'août », « d'octobre ».
    usedUp: (limit: number, month: string) => {
      const ofMonth = `${/^[aeiouâéè]/i.test(month) ? "d'" : "de "}${month}`;
      return limit === 1 ? `Vous avez utilisé votre recherche ${ofMonth}.` : `Vous avez utilisé vos ${limit} recherches ${ofMonth}.`;
    },
    usedUpUnknown: "Vous avez utilisé toutes vos recherches de ce mois-ci.",
    backOn: (day: string) => `Elles reviennent le ${day}.`,
    backSoon: "Elles reviennent au début du mois prochain.",
  },
  // Compte privé et demandes d'abonnement (lot « vie sociale », migration 0045).
  privateAccount: {
    sectionTitle: "Confidentialité du compte",
    settingTitle: "Compte privé",
    settingHelp: "Seuls les abonnés que vous acceptez voient vos publications, vos listes et vos j'aime. Vos abonnés actuels restent abonnés.",
    settingError: "Le réglage n'a pas pu être enregistré. Réessayez.",
    goPublicConfirm:
      "Repasser en compte public ? Tout le monde pourra vous suivre et voir vos publications publiques. Les demandes en attente seront effacées.",
    goPublicYes: "Repasser en public",
    goPublicNo: "Rester en privé",
    shellNotice: "Ce compte est privé. Abonnez-vous pour voir ses publications.",
    lockLabel: "Compte privé",
    requested: "Demandé",
    requestedHint: "Touchez pour annuler",
    cancelRequest: "Annuler la demande",
    requestsTitle: "Demandes d'abonnement",
    requestsEntry: (n: number) => `Demandes d'abonnement (${n})`,
    accept: "Accepter",
    acceptLabel: (name: string) => `Accepter la demande de ${name}`,
    decline: "Refuser",
    declineLabel: (name: string) => `Refuser la demande de ${name}`,
    requestsEmpty: "Aucune demande en attente.",
    requestsLoadError: "Impossible de charger les demandes.",
    requestsMore: "Afficher la suite",
    requestActionError: "L'action a échoué. Réessayez.",
    notifRequest: "demande à vous suivre.",
    notifAccepted: "a accepté votre demande.",
    postNote: "Compte privé : seuls vos abonnés voient vos publications.",
  },
  // Listes des abonnés et des abonnements (lot « vie sociale », sans migration).
  memberLists: {
    followersTitle: "Abonnés",
    followingTitle: "Abonnements",
    followersEmpty: "Personne ne vous suit pour l'instant.",
    followersEmptyOther: "Ce compte n'a pas encore d'abonnés.",
    followingEmpty: "Vous ne suivez encore personne.",
    followingEmptyOther: "Ce compte ne suit encore personne.",
    findPeople: "Rechercher des profils",
    loadError: "Impossible de charger cette liste.",
    remove: "Retirer",
    removeLabel: (name: string) => `Retirer ${name} de vos abonnés`,
    removeConfirm: (name: string) => `Retirer ${name} de vos abonnés ? Cette personne ne sera pas prévenue.`,
    removeNotePublic: "Votre compte est public : cette personne pourra se réabonner. Pour l'en empêcher, bloquez-la.",
    removed: "Abonné retiré.",
    removeError: "Le retrait a échoué. Réessayez.",
    openFollowers: (n: number) => `${n} abonné${n > 1 ? "s" : ""}, ouvrir la liste`,
    openFollowing: (n: number) => `${n} abonnement${n > 1 ? "s" : ""}, ouvrir la liste`,
    loadMore: "Voir la suite",
    // Liste « Aimé par » (lot « vie sociale »).
    likesTitle: "Aimé par",
    likesEmpty: "Personne n'a encore aimé cette publication.",
    openLikes: (n: number) => `${n} j'aime, voir qui a aimé`,
    likesPartial: "Certains comptes n'apparaissent pas dans cette liste.",
  },
  // Commentaires : réponses, j'aime, mentions (lot « vie sociale », migration 0046).
  commentThreads: {
    reply: "Répondre",
    replyingTo: (name: string) => `Réponse à ${name}`,
    cancelReply: "Annuler la réponse",
    showReplies: (n: number) => (n === 1 ? "Voir la réponse" : `Voir les ${n} réponses`),
    hideReplies: "Masquer les réponses",
    moreReplies: "Voir les réponses suivantes",
    repliesLoadError: "Impossible de charger les réponses.",
    like: "Aimer ce commentaire",
    unlike: "Ne plus aimer",
    likes: (n: number) => `${n} j'aime`,
    likeError: "Le j'aime n'a pas été enregistré. Réessayez.",
    mentionHint: "Tapez @ pour mentionner un membre",
    suggestionsLabel: "Membres à mentionner",
    suggestionLabel: (name: string) => `Mentionner ${name}`,
    settingTitle: "Qui peut me mentionner",
    settingHelp: "Dans un commentaire ou sur une photo.",
    settingError: "Le réglage n'a pas pu être enregistré. Réessayez.",
    everyone: "Tout le monde",
    following: "Les comptes que je suis",
    nobody: "Personne",
    notifReply: "a répondu à votre commentaire.",
    notifMention: "vous a mentionné(e) dans un commentaire.",
    removeMyMention: "Retirer ma mention",
    mentionRemoved: "Mention retirée",
    mentionRemoveError: "La mention n'a pas pu être retirée. Réessayez.",
  },
  // Plusieurs photos, identifier des personnes (lot « vie sociale », migration 0047).
  carousel: {
    addPhotos: "Ajouter jusqu'à 5 photos",
    addMorePhotos: "Ajouter des photos",
    removePhoto: (i: number) => `Retirer la photo ${i}`,
    uploading: (i: number, n: number) => `Envoi de la photo ${i} sur ${n}…`,
    photoFailed: "Cette photo n'a pas pu être envoyée.",
    photoRefused: "Cette photo ne peut plus être ajoutée à la publication.",
    publishWithout: "Continuer sans cette photo",
    position: (i: number, n: number) => `Photo ${i} sur ${n}`,
    next: "Photo suivante",
    previous: "Photo précédente",
    morePhotos: "Plusieurs photos",
    tagPeople: "Identifier des personnes",
    searchPeople: "Rechercher un membre",
    noPeopleFound: "Aucun membre trouvé.",
    addPerson: (name: string) => `Identifier ${name}`,
    removePerson: (name: string) => `Retirer ${name}`,
    peopleTitle: "Personnes identifiées",
    showPeople: (n: number) => (n === 1 ? "Une personne identifiée, voir la liste" : `${n} personnes identifiées, voir la liste`),
    removeMyTag: "Retirer mon identification",
    tagRemoved: "Identification retirée.",
    tagRemoveError: "L'identification n'a pas pu être retirée. Réessayez.",
    peopleNote: "Une personne n'apparaît que si elle accepte d'être identifiée. 5 personnes au plus.",
    notifTag: "vous a identifié(e) dans une publication.",
    uploadStopped: "Votre publication est publiée, mais certaines photos n'ont pas pu être envoyées.",
  },
  // Publications enregistrées (lot « vie sociale », migration 0048).
  savedPosts: {
    save: "Enregistrer",
    unsave: "Retirer des enregistrées",
    saved: "Enregistrée",
    removed: "Retirée des enregistrées",
    file: "Ranger",
    filed: (name: string) => `Rangée dans « ${name} »`,
    unfiled: "Rangée sans collection",
    sheetTitle: "Ranger dans une collection",
    noCollection: "Sans collection",
    collectionsLoadError: "Vos collections n'ont pas pu être chargées.",
    listTitle: "Publications enregistrées",
    listEmpty: "Vous n'avez encore enregistré aucune publication. Touchez le signet sous une publication pour la retrouver ici.",
    listLoadError: "Vos publications enregistrées n'ont pas pu être chargées.",
    loadMore: "Voir la suite",
    collectionTab: "Publications",
    collectionTabLabel: (name: string) => `Publications enregistrées rangées dans « ${name} »`,
    collectionEmpty: "Aucune publication rangée dans cette collection.",
    privateNote: "Vous seul voyez vos publications enregistrées.",
    savedLabel: "Publication enregistrée",
    notSavedLabel: "Enregistrer la publication",
    savedHint: "Ouvre les choix : la ranger dans une collection, ou la retirer.",
    saveError: "La publication n'a pas pu être enregistrée. Réessayez.",
    unsaveError: "La publication n'a pas pu être retirée. Réessayez.",
  },
  // Épingles et lien en bio (lot « vie sociale », migration 0049).
  profilePins: {
    pin: "Épingler sur mon profil",
    unpin: "Retirer l'épingle",
    pinned: "Publication épinglée.",
    unpinned: "Épingle retirée.",
    pinError: "L'épingle n'a pas pu être changée. Réessayez.",
    pinHint: "Les publications épinglées (3 au plus) s'affichent en premier sur votre profil.",
    pinnedMark: "Épinglée",
    linkLabel: "Lien",
    linkHelp: "Une adresse qui commence par https://. Elle est visible sur votre profil.",
    linkInvalid: "Ce lien n'est pas valide. Il doit commencer par https://.",
    linkTooLong: "Ce lien est trop long (200 caractères au plus).",
    leaveTitle: `Vous allez quitter ${BRAND}`,
    leaveBody:
      `Ce lien a été ajouté par un membre. ${BRAND} ne contrôle pas ce site et ne peut pas vérifier où il mène. Ne saisissez jamais votre mot de passe ${BRAND} ailleurs que dans l'app.`,
    leaveAddress: "Adresse complète",
    open: "Ouvrir le lien",
    cancel: "Annuler",
    linkA11y: (host: string) => `Lien vers ${host}, s'ouvre hors de ${BRAND}`,
    moderationLink: "Lien du profil",
    removeBioAlsoLink: "Le lien du profil sera retiré avec elle.",
    // Profil signalé sans bio, avec un lien : le même retrait, nommé d'après ce qu'il retire.
    removeLinkOnly: "Retirer le lien",
    removeLinkOnlyWarning:
      "Retirer le lien de ce profil ? Il sera effacé : cette décision ne s'annule pas. La personne sera prévenue, avec le motif choisi. Elle pourra en mettre un autre, sauf si son compte est suspendu.",
    linkRemovedSaved: "Lien retiré.",
  },
  // Fil « Pour vous » et suggestions de comptes (lot « découverte », migration 0050).
  forYou: {
    tabFollowing: "Abonnements",
    tabForYou: "Pour vous",
    tabsLabel: "Fil à afficher",
    how: "Des publications publiques récentes de comptes que vous ne suivez pas, classées selon leur date et leur nombre de j'aime et de commentaires. Le classement est le même pour tous les membres.",
    empty: "Rien de nouveau pour l'instant. Revenez un peu plus tard.",
    end: "Vous avez tout vu.",
    loadError: "« Pour vous » n'a pas pu être chargé.",
    suggestionsTitle: "Comptes à découvrir",
    suggestionsHow: "Des comptes suivis par vos abonnements, puis les comptes publics les plus actifs.",
    suggestionsEmpty: "Pas de suggestion pour l'instant.",
    settingTitle: "Proposer mon compte aux autres membres",
    settingHelp:
      "Vos publications publiques peuvent apparaître dans « Pour vous » et votre compte dans les suggestions. Éteint : seuls vos abonnés et les visiteurs de votre profil les voient.",
    settingError: "Le réglage n'a pas pu être enregistré. Réessayez.",
  },
  // Notifications d'activité sur le téléphone (lot « découverte », migration 0051).
  activityPush: {
    title: "Notifications d'activité",
    help: "Sur cet iPhone. Elles disent seulement qui a fait quoi, jamais le contenu.",
    likes: "J'aime",
    comments: "Commentaires et réponses",
    follows: "Abonnés et demandes d'abonnement",
    mentions: "Mentions et identifications",
    offerTitle: "Être prévenu(e) sur votre iPhone ?",
    offerBody: "Recevez une notification quand quelqu'un aime, commente, s'abonne ou vous mentionne. Vous pourrez choisir dans les Réglages.",
    enable: "Activer",
    later: "Plus tard",
    denied: `Les notifications sont refusées pour ${BRAND} dans les Réglages de l'iPhone.`,
  },
  // La page look (lot « page look », migration 0057, décisions du fondateur du
  // 23 novembre 2026) : « Partager le look » crée un lien vers une page en
  // lecture seule, visible sans compte (app/look.tsx). Jamais le nom du membre.
  look: {
    share: "Partager le look",
    creating: "Création du lien…",
    sheetTitle: "Créer un lien vers cette pièce ?",
    sheetBody: (date: string) =>
      `Toute personne qui a le lien verra la pièce, les boutiques et les prix vus le ${date}, sans compte. Jamais votre photo, ni votre nom, ni vos recherches. Le lien disparaît au plus tard 30 jours après sa création ; vous pouvez l'arrêter avant dans Réglages → Vos données.`,
    confirm: "Créer le lien",
    cancel: "Annuler",
    shareMessage: (piece: string) => `Regardez ce que j'ai trouvé avec ${BRAND} : ${piece}`,
    linkCopied: "Lien copié.",
    createError: "Le lien n'a pas pu être créé. Réessayez.",
    shopsPending: "Les boutiques arrivent encore : réessayez dans un instant.",
    limitReached: "Vous avez déjà 30 pages partagées : arrêtez-en une dans Réglages → Vos données.",
    pageTitle: `Une pièce trouvée avec ${BRAND}`,
    priceSeen: (price: string, date: string) => `${price} · vu le ${date}`,
    dateNote: (date: string) => `Prix et stock vus dans les boutiques le ${date}. Ils ont pu changer depuis : vérifiez sur le site de la boutique.`,
    inStock: (date: string) => `En stock, d'après Google le ${date}`,
    soldOut: (date: string) => `Épuisée, d'après Google le ${date}`,
    // Le verdict avec la date à la place de « au moment de la recherche » ; les autres phrases restent celles du résultat.
    verdictIdentifiedWithPrices: (shops: number, low: string, high: string, date: string) =>
      `Pièce identifiée, d'après les titres des boutiques : ${shops} boutiques, de ${low} à ${high} le ${date}.`,
    verdictIdentifiedOnePrice: (shops: number, price: string, date: string) => `Pièce identifiée, d'après les titres des boutiques : ${shops} boutiques, toutes à ${price} le ${date}.`,
    // Lu par VoiceOver sur chaque lien de boutique.
    shopLinkLabel: (shop: string, price: string, date: string) => `Voir chez ${shop}, ${price}, vu le ${date}`,
    shopLinkLabelNoPrice: (shop: string) => `Voir chez ${shop}, prix à vérifier chez le marchand`,
    findMine: "Trouver la mienne",
    findMineHint: `Créez un compte ${BRAND} pour retrouver une pièce vue en vidéo ou en photo.`,
    findMineExplain: `${BRAND} retrouve une pièce vue dans une vidéo ou sur une photo, et les boutiques qui la vendent.`,
    footer: (date: string) => `Page partagée par un membre de ${BRAND}. Elle disparaît au plus tard le ${date}.`,
    report: "Signaler cette page",
    // Objet de l'e-mail du signalement (« Signaler cette page »).
    reportSubject: "Signalement d'une page look",
    goneTitle: "Cette page n'est plus disponible",
    goneBody: "Le lien a expiré ou son auteur a arrêté le partage.",
    discover: `Découvrir ${BRAND}`,
    loading: "Chargement de la page…",
    loadError: "La page n'a pas pu être chargée.",
    settingsEntry: "Pages look partagées",
    createdExpires: (created: string, expires: string) => `Créée le ${created} · disparaît le ${expires}`,
    copyLink: "Copier le lien",
    stop: "Arrêter le partage",
    stopConfirm: "Arrêter ce partage ? Le lien ne marchera plus pour personne.",
    empty: "Aucune page look partagée.",
    moderationField: "Arrêter une page look (collez le lien)",
    moderationStopped: "Page arrêtée.",
    // Site : le navigateur a refusé le partage après l'attente de la création du lien.
    tapToShare: "Le lien est créé : touchez « Partager le look » pour l'envoyer.",
  },
  // Lot « étagères des amis » (migration 0058) : montrer ses Envies et son
  // Vault à ses amis, si on le décide ; onglets en lecture seule sur le profil d'un ami.
  friendShelves: {
    settingWishesTitle: "Montrer mes Envies à mes amis",
    settingWishesHelp: `Éteint au départ. Allumé, vos amis (les membres que vous suivez et qui vous suivent) voient toutes vos Envies (sauf celles d'une collection masquée par la modération), y compris celles rangées dans vos collections privées, sans le nom de ces collections : titre, image (une copie faite par ${BRAND}), prix et lien vers la boutique. Jamais vos notes, vos alertes, les pièces reçues ni vos publications enregistrées.`,
    settingVaultTitle: "Montrer mon Vault à mes amis",
    settingVaultHelp: "Éteint au départ. Allumé, vos amis voient les pièces de votre Vault (sauf une pièce dont la publication d'achat est masquée par la modération) : nom, catégorie et photo, y compris les photos que vous avez prises vous-même. Jamais la date d'ajout ni la mention « Achat vérifié ».",
    confirmWishesTitle: "Montrer vos Envies à vos amis ?",
    confirmWishesBody: "Vos amis verront toutes vos Envies, même celles de vos collections privées (sauf celles d'une collection masquée par la modération). Personne d'autre. Vous pourrez les rendre privées à tout moment.",
    confirmVaultTitle: "Montrer votre Vault à vos amis ?",
    confirmVaultBody: "Vos amis verront toutes les pièces de votre Vault (sauf une pièce dont la publication d'achat est masquée par la modération), avec leurs photos, y compris celles que vous avez prises vous-même : vérifiez ce qu'elles montrent. Personne d'autre. Vous pourrez le rendre privé à tout moment.",
    confirmCta: "Montrer à mes amis",
    cancel: "Annuler",
    wishesShown: "Vos amis voient maintenant vos Envies.",
    vaultShown: "Vos amis voient maintenant votre Vault.",
    wishesPrivateAgain: "Vos Envies sont de nouveau privées.",
    // Avec les collections : celles montrées aux amis le restent.
    wishesPrivateAgainCollections: "Vos amis ne voient plus que les Envies rangées dans une collection montrée à vos amis.",
    vaultPrivateAgain: "Votre Vault est de nouveau privé.",
    settingError: "Le réglage n'a pas pu être enregistré. Réessayez.",
    // Profil d'un ami : les onglets, en lecture seule.
    tabsLabel: "Ce que vous pouvez voir",
    shownBecauseFriends: "Visible parce que vous êtes amis.",
    emptyWishes: "Aucune envie pour le moment.",
    emptyVault: "Aucune pièce pour le moment.",
    loadError: "Impossible de charger ces pièces.",
    loadMoreError: "Impossible de charger la suite.",
    close: "Fermer",
    // Notes « privé » quand le réglage est allumé (fiche d'une pièce du Vault, ajout d'une pièce, fiche d'une envie).
    vaultItemNote: "Votre Vault est montré à vos amis (Réglages) ; personne d'autre ne le voit. Pour montrer cette pièce à d'autres, partagez-la dans votre fil.",
    vaultFormNote: "Votre Vault est montré à vos amis : ils verront cette pièce (Réglages, « Montrer mon Vault à mes amis »).",
    wishShareHint: "Vos amis voient vos Envies (Réglages). Rien d'autre n'est partagé sans votre accord.",
  },
} as const;
