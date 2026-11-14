// Lecteur intégré (mission « liens vidéo ») : les lecteurs présents dans le
// build sont décidés par lib/features.ts (options du build) et coupés au
// besoin par le serveur (lib/player-decision.ts). Il ne reste ici que
// l'accord préalable.
//
// Accord préalable (« deux clics », CNIL) avant de charger le premier lecteur
// officiel, qui peut déposer ses propres traceurs. Choix mémorisé par
// plateforme, retirable dans Réglages (components/player-consent-setting.tsx).
export const PLAYER_CONSENT_GATE = true;
