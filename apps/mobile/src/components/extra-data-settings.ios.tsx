// App iPhone, Réglages → Vos données : « Essayage virtuel : retirer mon
// consentement ». La ligne du site (extra-data-settings.web.tsx) est reprise
// telle quelle : des composants React Native et les mêmes appels au serveur,
// sans rien de propre au navigateur (un chemin .web écrit en entier se résout
// aussi sur iPhone). Même règle que sur le site : la ligne est là dès qu'un
// consentement est donné, essayage allumé ou éteint, car le droit de retrait
// prime ; le retrait passe par une confirmation. Elle partage l'état de
// l'essayage avec le bouton « Essayer » des fiches (lib/tryon-status.ios.ts).
export { ExtraDataSettings } from "./extra-data-settings.web";
