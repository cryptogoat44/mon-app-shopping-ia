// Serveur local des vérifications à l'écran (parcours-ecran, parcours-iphone) :
// sa clé SerpApi est invalide ou simulée, il ne peut rien dépenser. Plafond
// global des recherches (lot 4 quater) très haut, pour que les recherches des
// vérifications, cumulées sur spotto-dev, ne bloquent jamais un parcours.
export const PLAFOND_SERPAPI_PARCOURS = { SERPAPI_DAILY_CAP: "1000000", SERPAPI_MONTHLY_CAP: "1000000" } as const;
