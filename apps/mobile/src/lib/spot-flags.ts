// Analyse de l'image de couverture d'un lien TikTok, Instagram ou Pinterest
// (Lot S) : DÉSACTIVÉE au lot 4 ter, décision du fondateur (2026-10-07) — un
// lien ne permet pas de lire la vidéo, la pièce manquait souvent sur la
// couverture. Le code reste dans le dépôt (champ de lien, écran Aperçu) pour
// pouvoir la rétablir ici, d'un seul changement ; un lien collé affiche à la
// place comment ajouter la vidéo (enregistrement de l'écran).
export const LINK_COVER_ENABLED = false;

// Lecteur intégré (lot « lecteur intégré », souhait du fondateur du
// 2026-11-03) : sur l'app iPhone, un lien TikTok ou Instagram, collé ou
// partagé, ouvre la vidéo dans Spotto, dans le lecteur officiel ; « Spotter
// ce moment » prend l'image affichée. Le site n'est jamais concerné
// (lib/player-capture.web.ts).
// COUPÉ (false) sur cette branche : sans accord écrit de TikTok et de Meta, le
// lecteur ne doit pas partir dans un build App Store. Ce sont des constantes
// figées dans l'app, JAMAIS un interrupteur à distance (règle App Store
// 2.5.19). Coupé, l'app se comporte exactement comme avant le lot (aide
// « capture d'écran d'abord »). Essais sur iPhone : build de développement
// avec LINK_PLAYER_ENABLED = true. Soumission sans accord écrit : constante
// à false ET dossier apps/mobile/modules/spotto-frame-capture retiré.
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
