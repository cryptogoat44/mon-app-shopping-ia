// Configuration centrale de toutes les limites de débit (rate limiting).
// Toute nouvelle limite doit être ajoutée ici, jamais codée en dur dans une
// route — c'est la seule liste à relire pour savoir ce qui est limité et à
// quel rythme.
export interface RateLimitRule {
  /** Nombre de requêtes autorisées par fenêtre. */
  max: number;
  /** Durée de la fenêtre glissante, en millisecondes. */
  windowMs: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  // ---- Limites strictes : actions coûteuses ou sensibles à l'abus ----

  // Lancement d'une identification visuelle (POST /api/searches et
  // POST /api/searches/:id/screenshot) — chacune peut déclencher un appel
  // SerpApi payant.
  searchCreate: { max: 10, windowMs: HOUR },
  // Signalement d'un utilisateur ou d'une publication.
  report: { max: 20, windowMs: HOUR },
  // Abonnement à un autre utilisateur — limite un usage abusif type bot de
  // masse-follow.
  follow: { max: 60, windowMs: HOUR },

  // ---- Réservées au Lot 5, pas encore branchées sur une route ----

  // Commentaire sous une publication.
  comment: { max: 30, windowMs: HOUR },
  // Ajout d'un tag de pièce sur une publication.
  pieceTag: { max: 30, windowMs: HOUR },

  // ---- Limite large, appliquée automatiquement à toutes les autres routes ----
  // Sert de simple filet anti-script — je préfère être trop permissif que
  // bloquer un vrai utilisateur. Voir le plugin rateLimit.ts : appliquée
  // d'office à toute route qui ne déclare pas sa propre limite nommée.
  default: { max: 300, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;
