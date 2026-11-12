// Configuration centrale de toutes les limites de débit (rate limiting).
// Toute nouvelle limite doit être ajoutée ici, jamais codée en dur dans une
// route — c'est la seule liste à relire pour savoir ce qui est limité et à
// quel rythme.
export interface RateLimitRule {
  /** Nombre de requêtes autorisées par fenêtre. */
  max: number;
  /** Durée de la fenêtre glissante, en millisecondes. */
  windowMs: number;
  /** "global" : un seul compteur pour tout le service (plafond commun) ;
   * par défaut, un compteur par utilisateur (ou par adresse IP sans compte). */
  scope?: "user" | "global";
  /** Code et message propres à cette limite (sinon : « Trop de tentatives… »). */
  error?: string;
  message?: string;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  // ---- Limites strictes : actions coûteuses ou sensibles à l'abus ----

  // Identification visuelle : seuls les lancements avec au moins un appel
  // réel (Lens, boutiques ou vos mots) comptent, une fois par lancement, et
  // une fois par recherche avec vos mots (voie C). Une préparation, un
  // lancement refusé (image illisible, recherche déjà lancée…), annulé avant
  // l'appel ou servi entièrement par le cache ne comptent pas (voir
  // `rateLimitCheck` / `countRateLimitHit`).
  searchCreate: { max: 10, windowMs: HOUR },
  // Voie C (lot c, 2026-11-02) : lancements servis entièrement par le cache
  // (aucun appel, donc hors des plafonds) : chacun écrit encore une recherche
  // et ses propositions. Au-delà : 429, comme toute limite.
  searchCacheServed: { max: 30, windowMs: HOUR },
  // Boutiques ensuite (2026-11-08) : POST /api/searches/:id/complement, une
  // demande par lancement en usage normal (10 lancements avec appel + 30
  // servis par le cache par heure, au plus). Chaque demande compte, même sans
  // appel payant (l'étape payante, elle, ne tourne qu'une fois par recherche).
  // Pas la limite searchCreate : le dernier lancement permis de l'heure
  // perdrait ses boutiques ; un appel réel aux boutiques y est compté, comme
  // au lancement. Au-delà : 429, et l'app retire la ligne d'attente sans rien dire.
  searchComplement: { max: 60, windowMs: HOUR },
  // Lecture du compteur des recherches (lot limites annoncées) : gratuite,
  // mais chaque lecture interroge la base. L'app relit au plus toutes les
  // 20 s en usage normal ; au-delà, l'app n'affiche simplement rien.
  searchCapacityRead: { max: 30, windowMs: 10 * MINUTE },
  // Signalement d'un utilisateur ou d'une publication.
  report: { max: 20, windowMs: HOUR },
  // Abonnement à un autre utilisateur — limite un usage abusif type bot de
  // masse-follow.
  follow: { max: 60, windowMs: HOUR },
  // Création d'une publication avec pièces taguées (POST /api/posts) —
  // compte chaque publication, pas chaque pièce à l'intérieur (une
  // publication contient jusqu'à MAX_TAGGED_PIECES pièces en un seul appel).
  pieceTag: { max: 30, windowMs: HOUR },

  // Commentaire sous une publication (POST /api/posts/:id/comments, Lot F).
  comment: { max: 30, windowMs: HOUR },

  // Envoi d'une envie à une personne (lot 5, 5.C) : un geste entre deux
  // personnes, jamais une diffusion de masse. Chaque envoi copie aussi une image.
  pieceSend: {
    max: 20,
    windowMs: HOUR,
    error: "piece_send_limit",
    message: "Vous avez envoyé beaucoup de pièces en peu de temps. Réessayez dans une heure.",
  },

  // Messages privés (lot messages) : chaque message envoyé (texte, envie
  // jointe ou les deux). Large pour une vraie conversation, bloque un script.
  // Une envie jointe compte aussi dans pieceSend (elle copie une image).
  messageSend: {
    max: 120,
    windowMs: HOUR,
    error: "message_send_limit",
    message: "Vous avez envoyé beaucoup de messages en peu de temps. Réessayez dans un moment.",
  },
  // Invitations (premier message à un membre qui n'est pas un ami) : comptées
  // seulement quand une invitation est vraiment créée (consumeRateLimit).
  messageInvite: {
    max: 10,
    windowMs: HOUR,
    error: "invitation_limit",
    message: "Vous avez envoyé beaucoup d'invitations en peu de temps. Réessayez dans une heure.",
  },

  // Notifications sur le téléphone (lot notifications) : enregistrer ou
  // oublier un appareil (PUT et DELETE /api/me/push-token, comptés ensemble).
  // L'app rafraîchit son jeton à l'ouverture et l'oublie à la déconnexion :
  // quelques appels par jour en usage normal ; au-delà, un script.
  pushToken: {
    max: 30,
    windowMs: HOUR,
    error: "push_token_limit",
    message: "Trop de changements des notifications en peu de temps. Réessayez dans une heure.",
  },

  // Liens de vidéos TikTok et Instagram (mission « liens vidéo ») :
  // - lire ce que la mémoire sait d'une vidéo (chaque lien partagé ou collé) ;
  videoLookup: { max: 120, windowMs: HOUR },
  // - résoudre un lien court TikTok : une demande part vers TikTok (en-têtes
  //   seulement). Comptée seulement quand elle part vraiment (pas pour une
  //   réponse gardée en mémoire), par membre et pour tout le service ;
  videoShortLink: { max: 30, windowMs: HOUR },
  videoShortLinkGlobal: { max: 2_000, windowMs: HOUR, scope: "global" },
  // - code d'intégration Instagram (Meta limite à 1 000 demandes par heure,
  //   le serveur en garde chacun 24 h : lib/instagramEmbed.ts) ;
  videoEmbed: { max: 60, windowMs: HOUR },
  // - noter un spot (une fois par recherche) et « C'est bien cette pièce ».
  videoSpot: { max: 60, windowMs: HOUR },
  videoConfirm: { max: 120, windowMs: HOUR },

  // Photo de profil (revue de sécurité du 12 novembre 2026) : envoyer ou
  // supprimer sa photo (POST et DELETE /api/me/avatar, comptés ensemble,
  // refus compris). Chaque envoi fait décoder une image au serveur : la
  // limite par défaut (300 par minute) ne suffisait pas.
  avatarWrite: {
    max: 20,
    windowMs: HOUR,
    error: "avatar_limit",
    message: "Vous avez changé de photo de profil plusieurs fois en peu de temps. Réessayez dans une heure.",
  },

  // Alertes prix et stock (lot 2) : régler une cloche ou l'interrupteur des
  // Réglages. Large pour un vrai usage, bloque un script.
  wishAlertWrite: {
    max: 120,
    windowMs: HOUR,
    error: "wish_alert_write_limit",
    message: "Vous avez changé beaucoup d'alertes en peu de temps. Réessayez dans un moment.",
  },
  // « Plus disponible » : 20 signalements par jour et par membre. Ici, la
  // limite en mémoire (filet) ; la vraie limite, par jour de Paris, est
  // comptée dans la base (wish_stock_report, migration 0036), où chaque
  // signalement est gardé 30 jours.
  stockReport: {
    max: 20,
    windowMs: DAY,
    error: "stock_report_limit",
    message: "Vous avez signalé beaucoup de pièces aujourd'hui. Réessayez demain.",
  },

  // Collections d'envies (lot collections) : créer, renommer, supprimer une
  // collection, y ranger ou en retirer une envie. Large pour ranger ses
  // envies, bloque un script.
  collectionWrite: {
    max: 120,
    windowMs: HOUR,
    error: "collection_write_limit",
    message: "Vous avez modifié beaucoup de collections en peu de temps. Réessayez dans un moment.",
  },
  // Montrer une collection à ses amis, ou la rendre privée : chaque passage
  // à « Mes amis » copie les images de ses envies (jusqu'à 100). Compté en
  // plus de collectionWrite.
  collectionVisibility: {
    max: 20,
    windowMs: HOUR,
    error: "collection_visibility_limit",
    message: "Vous avez changé souvent la visibilité de vos collections. Réessayez dans une heure.",
  },
  // « Garder » une envie d'une collection d'un ami.
  collectionKeep: {
    max: 60,
    windowMs: HOUR,
    error: "collection_keep_limit",
    message: "Vous avez gardé beaucoup d'envies en peu de temps. Réessayez dans un moment.",
  },

  // Export des données (RGPD) : chaque export relit toutes les tables du
  // compte. Large pour une personne, mais protège la base d'un script. Le
  // fichier lisible et le format technique comptent ensemble.
  dataExport: {
    max: 10,
    windowMs: HOUR,
    error: "export_limit",
    message: "Vous avez demandé plusieurs exports en peu de temps. Réessayez dans une heure.",
  },

  // Analyse automatique d'une vidéo par l'IA (lot 4, temps 1 bis) : chaque
  // appel coûte (jusqu'à 12 images envoyées à Claude Sonnet, de l'ordre de 1 à
  // 3 centimes, services/videoMoments.ts). Seuls les appels réellement
  // envoyés comptent. Depuis le lot garde-fous, comptés dans la base par jour
  // (heure de Paris), lib/aiQuota.ts et migration 0029 : un redémarrage ne
  // remet plus rien à zéro. Sans 0029 : compteurs en mémoire, fenêtre de 24 h
  // à partir du premier appel, comme avant. La limite de dépense du compte
  // Anthropic reste le dernier filet (voir docs/points-de-vigilance.md).
  videoAiUser: {
    max: 10,
    windowMs: DAY,
    error: "video_ai_user_limit",
    message: "Vous avez atteint la limite quotidienne d'analyses automatiques. Choisissez l'image avec le curseur, ou réessayez demain.",
  },
  videoAiGlobal: {
    max: 300,
    windowMs: DAY,
    scope: "global",
    error: "video_ai_global_limit",
    message: "L'analyse automatique est très demandée aujourd'hui et momentanément indisponible. Choisissez l'image avec le curseur.",
  },
  // Requête des boutiques écrite par l'IA (voie C, titres Lens seulement,
  // ≈ 0,25 centime l'appel) : plafond commun à tout le service, compté juste
  // avant l'appel (lib/aiQuota.ts, dans la base depuis le lot garde-fous ;
  // en mémoire sans la migration 0029). Atteint : l'IA est sautée, les
  // résultats Lens sont montrés seuls — jamais de 429.
  shoppingQueryAiGlobal: { max: 300, windowMs: DAY, scope: "global" },

  // ---- Limite large, appliquée automatiquement à toutes les autres routes ----
  // Sert de simple filet anti-script — je préfère être trop permissif que
  // bloquer un vrai utilisateur. Voir le plugin rateLimit.ts : appliquée
  // d'office à toute route qui ne déclare pas sa propre limite nommée.
  default: { max: 300, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;
