// Essayage virtuel photo, app iPhone : la disponibilité lue sur le serveur,
// gardée en mémoire (tryon-status.web.ts, reprise telle quelle : un chemin
// .web écrit en entier se résout aussi sur iPhone). Un seul module, donc un
// seul état, partagé par le bouton « Essayer », la fenêtre de l'essayage et
// la ligne des Réglages ; remis à « éteint » au changement de compte.
export * from "./tryon-status.web";
