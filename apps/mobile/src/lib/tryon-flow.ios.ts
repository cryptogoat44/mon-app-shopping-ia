// Essayage virtuel photo, app iPhone : les étapes du parcours et leurs
// messages, les mêmes que sur le site (tryon-flow.web.ts, logique pure sans
// rien de propre au navigateur), reprises telles quelles : un chemin .web
// écrit en entier se résout aussi sur iPhone. Seule différence d'affichage :
// l'étape « consent_reload » (texte plus récent que celui de l'app) demande
// une mise à jour de l'app au lieu d'un rechargement de la page
// (components/tryon-steps.ios.tsx).
export * from "./tryon-flow.web";
