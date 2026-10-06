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
