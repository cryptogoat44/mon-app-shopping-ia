// Serveur local des vérifications à l'écran (parcours-ecran, parcours-iphone) :
// sa clé SerpApi est invalide ou simulée, il ne peut rien dépenser. Plafonds des
// recherches (lot 4 quater) très hauts — global et part de chaque personne —,
// pour que les recherches des vérifications, cumulées sur spotto-dev ou faites
// par un même compte de test, ne bloquent jamais un parcours. Les messages des
// plafonds sont vérifiés par le scénario lot-4-quater (réponses fabriquées).
export const PLAFOND_SERPAPI_PARCOURS = {
  SERPAPI_DAILY_CAP: "1000000",
  SERPAPI_MONTHLY_CAP: "1000000",
  SERPAPI_USER_DAILY_CAP: "1000000",
} as const;
