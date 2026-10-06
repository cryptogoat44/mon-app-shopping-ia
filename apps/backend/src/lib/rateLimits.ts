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

  // Identification visuelle : seuls les appels SerpApi réellement envoyés
  // (1 crédit chacun) comptent. Une préparation, un lancement refusé (image
  // illisible, recherche déjà lancée…) ou annulé avant l'appel ne comptent
  // pas (voir `rateLimitCheck` / `countRateLimitHit`).
  searchCreate: { max: 10, windowMs: HOUR },
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

  // Analyse automatique d'une vidéo par l'IA (lot 4, temps 1 bis) : chaque
  // appel coûte (≈ un demi-centime avec Claude Haiku 4.5). Seuls les appels
  // réellement envoyés comptent (`rateLimitCheck` / `countRateLimitHit`).
  // Fenêtre de 24 h à partir du premier appel ; compteurs en mémoire, remis à
  // zéro au redémarrage du serveur : le vrai plafond financier est la limite
  // de dépense du compte Anthropic (voir docs/points-de-vigilance.md).
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

  // ---- Limite large, appliquée automatiquement à toutes les autres routes ----
  // Sert de simple filet anti-script — je préfère être trop permissif que
  // bloquer un vrai utilisateur. Voir le plugin rateLimit.ts : appliquée
  // d'office à toute route qui ne déclare pas sa propre limite nommée.
  default: { max: 300, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;
