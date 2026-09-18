import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

// Liste centrale unique des buckets de stockage contenant des fichiers
// rangés sous `${userId}/...` — tout bucket manquant ici serait oublié
// lors de la suppression de compte et laisserait des fichiers orphelins.
// Un bucket ajouté plus tard doit être ajouté ici.
export const USER_STORAGE_BUCKETS = ["screenshots", "vault-media", "post-media", "avatars"] as const;

const LIST_PAGE_SIZE = 100;

async function deleteAllUserFilesInBucket(fastify: FastifyInstance, bucket: string, userId: string): Promise<void> {
  // On relit toujours depuis le début (pas d'offset) : chaque page est
  // supprimée avant de relire, donc la page suivante commence là où la
  // précédente s'arrêtait — avancer un offset ferait sauter des fichiers
  // au fur et à mesure qu'on les supprime.
  while (true) {
    const { data: files, error } = await fastify.supabaseAdmin.storage.from(bucket).list(userId, {
      limit: LIST_PAGE_SIZE,
    });
    if (error || !files || files.length === 0) return;

    const paths = files.map((f) => `${userId}/${f.name}`);
    await fastify.supabaseAdmin.storage.from(bucket).remove(paths);

    if (files.length < LIST_PAGE_SIZE) return;
  }
}

// Vide, dans chaque bucket de USER_STORAGE_BUCKETS, tous les fichiers d'un
// utilisateur — appelé à la suppression de compte pour ne laisser aucune
// trace orpheline sur le stockage malgré la suppression en base.
export async function deleteUserStorageFiles(fastify: FastifyInstance, userId: string): Promise<void> {
  for (const bucket of USER_STORAGE_BUCKETS) {
    await deleteAllUserFilesInBucket(fastify, bucket, userId);
  }
}

// Vérifie qu'une URL publique de stockage pointe bien vers NOTRE projet
// Supabase (même origine que SUPABASE_URL), le bucket attendu, ET un chemin
// qui commence par le dossier de l'utilisateur donné (`${userId}/...`).
// Une vraie analyse d'URL (`new URL(...)` + comparaison d'origine), jamais
// une recherche de texte (`indexOf`) : une URL fabriquée contenant la bonne
// sous-chaîne n'importe où (ex. dans un paramètre de requête d'un domaine
// externe) doit être rejetée, pas seulement une URL qui commence mal.
// Retourne le chemin de l'objet dans le bucket si tout correspond, sinon
// `null` — à utiliser aussi bien pour valider une URL reçue du client à la
// création que pour retrouver le chemin à supprimer.
export function extractOwnedStoragePath(imageUrl: string, bucket: string, userId: string): string | null {
  let parsed: URL;
  let expectedOrigin: URL;
  try {
    parsed = new URL(imageUrl);
    expectedOrigin = new URL(env.SUPABASE_URL);
  } catch {
    return null;
  }

  if (parsed.origin !== expectedOrigin.origin) return null;

  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;

  const objectPath = parsed.pathname.slice(prefix.length);
  const ownerPrefix = `${userId}/`;
  if (!objectPath.startsWith(ownerPrefix) || objectPath === ownerPrefix) return null;

  return objectPath;
}

// Supprime UN fichier précis, seulement si son URL prouve qu'il appartient
// bien à `userId` dans `bucket` (voir extractOwnedStoragePath) — sinon ne
// supprime rien et journalise la tentative au lieu d'échouer en silence.
// Vérifie aussi le résultat de l'appel de suppression lui-même.
export async function deleteOwnedStorageFile(
  fastify: FastifyInstance,
  bucket: string,
  userId: string,
  imageUrl: string
): Promise<void> {
  const path = extractOwnedStoragePath(imageUrl, bucket, userId);
  if (!path) {
    fastify.log.warn(
      { bucket, userId },
      "Suppression de fichier ignorée : l'URL enregistrée ne correspond pas à ce bucket/utilisateur"
    );
    return;
  }

  const { error } = await fastify.supabaseAdmin.storage.from(bucket).remove([path]);
  if (error) {
    fastify.log.error({ error, bucket, userId }, "Échec de la suppression du fichier de stockage");
  }
}
