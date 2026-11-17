// Réglages du service vidéo, lus une seule fois au démarrage, dans
// l'environnement (jamais dans un fichier). Un réglage invalide est signalé
// par son nom et une raison fixe, jamais par sa valeur.
import { createHash, timingSafeEqual } from "node:crypto";

export const DEFAULT_PORT = 10000;
/** Même règle que le serveur principal (env.ts puis lib/videoWorker.ts) : les
 * espaces et retours à la ligne autour de la valeur sont retirés (une valeur
 * collée telle quelle dans les deux services vaut la même chose des deux
 * côtés), puis 32 à 512 caractères visibles, sans espace. */
const SECRET_SHAPE = /^[\x21-\x7e]{32,512}$/;
const BEARER = /^Bearer ([\x21-\x7e]{1,1024})$/;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ port: number, secret: string | null, problems: string[] }}
 */
export function readConfig(env) {
  const problems = [];
  let secret = null;
  // Valeur vide après nettoyage : « absent », comme sur le serveur principal.
  const raw = env.VIDEO_WORKER_SECRET?.trim();
  if (!raw) problems.push("VIDEO_WORKER_SECRET : absent (toutes les demandes d'images seront refusées)");
  else if (!SECRET_SHAPE.test(raw)) problems.push("VIDEO_WORKER_SECRET : forme invalide, 32 à 512 caractères visibles sans espace (toutes les demandes d'images seront refusées)");
  else secret = raw;

  let port = DEFAULT_PORT;
  const rawPort = env.PORT?.trim();
  if (rawPort) {
    const parsed = Number(rawPort);
    if (/^\d{1,5}$/.test(rawPort) && parsed >= 1 && parsed <= 65535) port = parsed;
    else problems.push(`PORT : nombre de 1 à 65535 attendu (port ${DEFAULT_PORT} utilisé)`);
  }
  return { port, secret, problems };
}

/**
 * Vérification du secret en temps constant. Sans secret valide, tout est
 * refusé (fermé par défaut). Les deux valeurs sont d'abord réduites à leur
 * empreinte SHA-256 : même longueur, quelle que soit celle reçue.
 * @param {string | null} secret
 * @returns {(header: string | undefined) => boolean}
 */
export function createAuthorizer(secret) {
  if (!secret) return () => false;
  const expected = createHash("sha256").update(secret, "utf8").digest();
  return (header) => {
    const match = typeof header === "string" ? BEARER.exec(header) : null;
    const given = createHash("sha256")
      .update(match ? match[1] : "", "utf8")
      .digest();
    const same = timingSafeEqual(given, expected);
    return same && match !== null;
  };
}
