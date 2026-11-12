// @fastify/multipart lève cette erreur depuis part.toBuffer() quand un
// fichier dépasse la limite de taille configurée (10 Mo, voir server.ts).
// Elle traverse le pipeline de parsing de Fastify sans passer par
// setErrorHandler (comportement observé, pas documenté) — chaque route qui
// consomme un upload doit donc la reconnaître elle-même pour répondre avec
// un message français plutôt que de laisser fuiter l'erreur brute.
export function isFileTooLargeError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE";
}

/** Envoi refusé tel quel : trop de fichiers, de champs ou de parties
 * (limites posées par la route, ex. 12 images au plus), ou envoi tronqué —
 * au-delà de sa limite de champs, la bibliothèque coupe la lecture
 * (« Premature close », constaté avec @fastify/multipart 9.4). */
export function isTooManyPartsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "FST_FILES_LIMIT" ||
      error.code === "FST_FIELDS_LIMIT" ||
      error.code === "FST_PARTS_LIMIT" ||
      error.code === "ERR_STREAM_PREMATURE_CLOSE")
  );
}

/** Plafonds de tout formulaire avec fichier (app.ts), sauf route qui pose les
 * siens. Revue de sécurité du 12 novembre 2026 : sans plafond de champs, une
 * seule requête pouvait faire garder 1 Go de texte en mémoire au serveur
 * (1 000 champs de 1 Mo, les réglages par défaut de la bibliothèque).
 * L'app envoie un fichier et quelques champs courts (titre, catégorie,
 * recadrage, pièces taguées…) : au plus 20 champs de 64 Ko, soit 1,3 Mo de
 * texte par requête. Au-delà : 413 (FST_FIELDS_LIMIT, FST_PARTS_LIMIT,
 * FST_FILES_LIMIT) ; un champ plus long que 64 Ko est coupé par la
 * bibliothèque, et la route le refuse comme tout champ illisible. */
export const MULTIPART_LIMITS = {
  fileSize: 10 * 1024 * 1024,
  files: 1,
  fields: 20,
  fieldSize: 64 * 1024,
  parts: 24,
} as const;
