import type { FastifyInstance } from "fastify";

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
