// Lecteur intégré (lot « lecteur intégré », souhait du fondateur du
// 2026-11-03) : sur l'app iPhone, un lien TikTok ou Instagram, collé ou
// partagé, ouvre la vidéo dans Spotto, dans le lecteur officiel ; « Spotter
// ce moment » prenait l'image affichée. Le site n'est jamais concerné.
// COUPÉ (false) sur cette branche : sans accord écrit de TikTok et de Meta, le
// lecteur ne doit pas partir dans un build App Store. Ce sont des constantes
// figées dans l'app, JAMAIS un interrupteur à distance (règle App Store
// 2.5.19). Coupé, l'app se comporte exactement comme avant le lot (aide
// « capture d'écran d'abord »). Soumission sans accord écrit : constante à
// false ET dossier apps/mobile/modules/spotto-frame-capture retiré.
// FAIT au lot « nettoyage avant le premier build » (2026-11-10) : le module
// natif de capture et son pont (lib/player-capture.ts) sont sortis de l'app ;
// il ne reste aucun code natif de capture. Sans lui, le lecteur n'est proposé
// nulle part, même constante à true (lib/player-access.ts), et « Spotter ce
// moment » n'existe plus dans l'écran Lecteur. Pour le faire revenir, une fois
// l'accord écrit d'une plateforme reçu : annuler (git revert) le commit de ce
// lot, PUIS passer la constante à true — jamais la constante seule.
export const LINK_PLAYER_ENABLED = false;

// Une constante par plateforme (un avis négatif sur l'une ne coupe pas
// l'autre). Instagram coupé par défaut : les conditions de Meta interdisent
// tout usage du contenu « other than providing a front-end view »
// (contre-expertise n° 6), avis de l'avocat attendu.
export const PLAYER_TIKTOK_ENABLED = true;
export const PLAYER_INSTAGRAM_ENABLED = false;

// Accord préalable (« deux clics ») avant de charger le lecteur officiel, qui
// peut déposer ses propres traceurs (contre-expertise n° 5). Choix mémorisé
// par plateforme, retirable dans Réglages.
export const PLAYER_CONSENT_GATE = true;
