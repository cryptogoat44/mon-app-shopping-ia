// Essayage virtuel photo, app iPhone : les mêmes appels au serveur que le
// site (tryon-api.web.ts, qui n'a rien de propre au navigateur), repris tels
// quels : un chemin .web écrit en entier se résout aussi sur iPhone, et une
// correction de ces appels sur le site arrive donc ici sans rien recopier.
// La photo part de la même façon, dans le corps de la requête : sur iPhone,
// c'est le File d'expo-file-system, un vrai Blob (lib/tryon-photo.ios.ts).
export * from "./tryon-api.web";
