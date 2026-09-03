// @fastify/multipart lève cette erreur depuis part.toBuffer() quand un
// fichier dépasse la limite de taille configurée (10 Mo, voir server.ts).
// Elle traverse le pipeline de parsing de Fastify sans passer par
// setErrorHandler (comportement observé, pas documenté) — chaque route qui
// consomme un upload doit donc la reconnaître elle-même pour répondre avec
// un message français plutôt que de laisser fuiter l'erreur brute.
export function isFileTooLargeError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE";
}
