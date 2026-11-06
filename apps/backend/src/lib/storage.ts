import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { chunks, readAll } from "./pagedReads.js";

// Liste centrale unique des buckets de stockage contenant des fichiers
// rangés sous `${userId}/...` — tout bucket manquant ici serait oublié
// lors de la suppression de compte et laisserait des fichiers orphelins.
// Un bucket ajouté plus tard doit être ajouté ici.
export const USER_STORAGE_BUCKETS = ["screenshots", "vault-media", "post-media", "avatars"] as const;

const LIST_PAGE_SIZE = 100;
/** Essais par appel au stockage (lecture d'une page, effacement d'un lot). */
export const STORAGE_ATTEMPTS = 3;
/** Garde-fou : au plus 1 000 pages (100 000 fichiers) par dossier. */
const MAX_PAGES = 1000;

/** Ce dont l'effacement a besoin dans un bucket : le client Supabase, ou un
 * faux client dans les tests. */
export interface BucketFiles {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy: { column: "name"; order: "asc" } }
  ): Promise<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

/** Bilan d'un effacement : des nombres, jamais un chemin ni un identifiant. */
export interface StorageCleanup {
  bucket: string;
  removed: number;
  /** Fichiers restés : effacement refusé après STORAGE_ATTEMPTS essais. */
  failed: number;
  /** Dossier illisible : le nombre de fichiers restés est inconnu. */
  unreadable: boolean;
}

/** `call` jusqu'à ce que `succeeded` (au plus STORAGE_ATTEMPTS fois), sinon null. */
async function withAttempts<T>(call: () => Promise<T>, succeeded: (result: T) => boolean): Promise<T | null> {
  for (let attempt = 0; attempt < STORAGE_ATTEMPTS; attempt += 1) {
    try {
      const result = await call();
      if (succeeded(result)) return result;
    } catch {
      // Panne passagère du réseau : essai suivant.
    }
  }
  return null;
}

/** Efface `paths` d'un coup ; vrai si le stockage l'a accepté (STORAGE_ATTEMPTS essais au plus). */
async function removeWithAttempts(files: BucketFiles, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  return (await withAttempts(() => files.remove(paths), (result) => !result.error)) !== null;
}

/** Vide le dossier `userId` d'un bucket. Ne s'arrête jamais sur un fichier
 * qui refuse de s'effacer, et ne boucle jamais : un lot refusé est compté
 * comme resté, puis sauté (il précède les suivants dans l'ordre des noms). */
export async function emptyUserFolder(files: BucketFiles, bucket: string, userId: string): Promise<StorageCleanup> {
  const report: StorageCleanup = { bucket, removed: 0, failed: 0, unreadable: false };
  let previousFirst: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listing = await withAttempts(
      () => files.list(userId, { limit: LIST_PAGE_SIZE, offset: report.failed, sortBy: { column: "name", order: "asc" } }),
      (result) => !result.error && result.data !== null
    );
    if (!listing?.data) return { ...report, unreadable: true };
    const entries = listing.data;
    if (entries.length === 0) return report;
    // Page relue à l'identique (le stockage a dit « effacé » sans effacer) :
    // comptée comme restée, pour avancer quand même.
    const again = entries[0]!.name === previousFirst;
    previousFirst = entries[0]!.name;
    // Un sous-dossier (aucun aujourd'hui) n'est pas un fichier : il reste.
    const paths = entries.filter((entry) => entry.id !== null).map((entry) => `${userId}/${entry.name}`);
    if (!again && (await removeWithAttempts(files, paths))) {
      report.removed += paths.length;
      report.failed += entries.length - paths.length;
    } else {
      report.failed += entries.length;
    }
    if (entries.length < LIST_PAGE_SIZE) return report;
  }
  return { ...report, unreadable: true };
}

// Vide, dans chaque bucket de USER_STORAGE_BUCKETS, tous les fichiers d'un
// utilisateur — appelé à la suppression de compte pour ne laisser aucune
// trace orpheline sur le stockage malgré la suppression en base. Ne lève
// jamais d'erreur de stockage : le bilan dit ce qui est resté. Les images
// analysées rangées sans le compte dans leur nom (dossier « analyses »,
// depuis le lot garde-fous) sont effacées aussi, recherche par recherche.
export async function deleteUserStorageFiles(fastify: FastifyInstance, userId: string): Promise<StorageCleanup[]> {
  const reports: StorageCleanup[] = [];
  for (const bucket of USER_STORAGE_BUCKETS) {
    reports.push(await emptyUserFolder(fastify.supabaseAdmin.storage.from(bucket), bucket, userId));
  }
  reports.push(await deleteUserAnalysisImages(fastify, userId));
  return reports;
}

// ---------------------------------------------------------------------
// Images analysées (Spotter) : l'image recadrée est déposée le temps que le
// fournisseur de recherche la lise, par un lien signé de 5 minutes, puis
// effacée. Depuis le lot garde-fous (2026-11-05), son nom ne contient plus
// l'identifiant du compte (ce lien part chez SerpApi, puis chez Google) :
// « analyses/<recherche>.jpg ». Avant : « <compte>/<recherche>.jpg », encore
// effacé par le balayage du dossier du compte (emptyUserFolder) et par
// markInterrupted.
// ---------------------------------------------------------------------

/** Bucket privé des images analysées. */
export const ANALYSIS_BUCKET = "screenshots";
/** Dossier fixe des images analysées : aucun identifiant de compte dans le chemin. */
export const ANALYSIS_FOLDER = "analyses";
/** Au-delà d'une heure, une image analysée n'est plus lue par personne (lien
 * de 5 minutes, recherche de 15 s au plus) : elle est restée par accident
 * (panne au mauvais moment, mise en ligne pendant une recherche). */
export const ANALYSIS_IMAGE_MAX_AGE_MS = 60 * 60 * 1000;
/** Fichiers examinés à chaque purge (les plus anciens d'abord). */
const ANALYSIS_PURGE_PAGE = 100;

export function analysisImagePath(searchId: string): string {
  return `${ANALYSIS_FOLDER}/${searchId}.jpg`;
}

/** Ancien nom, dans le dossier du compte : seulement pour effacer une image restée d'avant le lot garde-fous. */
export function legacyAnalysisImagePath(userId: string, searchId: string): string {
  return `${userId}/${searchId}.jpg`;
}

/** Ce dont la purge a besoin du bucket : le client Supabase, ou un faux dans les tests. */
export interface AnalysisFiles {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy: { column: "created_at"; order: "asc" } }
  ): Promise<{ data: { name: string; id: string | null; created_at?: string | null }[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

/** Journal de la purge : des nombres seulement. */
export interface PurgeLog {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Efface les images analysées restées plus d'une heure (au plus 100 par
 * appel, les plus anciennes d'abord), à chaque préparation de recherche,
 * comme la purge du cache. Ne lève jamais d'erreur : un échec est seulement
 * journalisé (des nombres, jamais un chemin), la purge suivante reprendra.
 * Renvoie le nombre d'images effacées. */
export async function purgeStaleAnalysisImages(files: AnalysisFiles, log: PurgeLog, now = Date.now()): Promise<number> {
  try {
    const { data, error } = await files.list(ANALYSIS_FOLDER, { limit: ANALYSIS_PURGE_PAGE, offset: 0, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data) {
      log.warn({ code: null }, "Images analysées restées : dossier illisible, purge remise à plus tard");
      return 0;
    }
    const cutoff = now - ANALYSIS_IMAGE_MAX_AGE_MS;
    const stale = data
      .filter((entry) => entry.id !== null && typeof entry.created_at === "string" && Date.parse(entry.created_at) < cutoff)
      .map((entry) => `${ANALYSIS_FOLDER}/${entry.name}`);
    if (stale.length === 0) return 0;
    const removed = await files.remove(stale);
    if (removed.error) {
      log.warn({ count: stale.length }, "Images analysées restées : effacement refusé, purge remise à plus tard");
      return 0;
    }
    log.info({ removed: stale.length }, "Images analysées restées plus d'une heure : effacées");
    return stale.length;
  } catch {
    log.warn({ code: null }, "Images analysées restées : purge impossible");
    return 0;
  }
}

/** Efface les images analysées des recherches d'un compte (nouveau nom, sans
 * le compte dedans), avant la suppression du compte : la base dit encore
 * quelles recherches sont les siennes. Par lots de 100, avec STORAGE_ATTEMPTS
 * essais ; une image absente n'est pas une erreur. `removed` compte les
 * chemins demandés (la plupart des images sont déjà effacées). */
export async function deleteUserAnalysisImages(fastify: FastifyInstance, userId: string): Promise<StorageCleanup> {
  const report: StorageCleanup = { bucket: ANALYSIS_BUCKET, removed: 0, failed: 0, unreadable: false };
  let searchIds: string[];
  try {
    const rows = await readAll<{ id: string }>(
      "Recherches du compte (images analysées)",
      () => fastify.supabaseAdmin.from("product_searches").select("id", { count: "exact" }).eq("user_id", userId),
      ["id"]
    );
    searchIds = rows.map((row) => row.id);
  } catch {
    return { ...report, unreadable: true };
  }
  const files = fastify.supabaseAdmin.storage.from(ANALYSIS_BUCKET);
  for (const part of chunks(searchIds)) {
    if (await removeWithAttempts(files, part.map(analysisImagePath))) report.removed += part.length;
    else report.failed += part.length;
  }
  return report;
}

/** Efface des fichiers précis (adresses publiques), chacun seulement s'il est
 * bien dans le dossier de son propriétaire, par lots et avec
 * STORAGE_ATTEMPTS essais. Une adresse étrangère à notre stockage est ignorée. */
export async function removeOwnedFiles(
  fastify: FastifyInstance,
  bucket: string,
  files: { ownerId: string; url: string }[]
): Promise<StorageCleanup> {
  const paths = files.map((file) => extractOwnedStoragePath(file.url, bucket, file.ownerId)).filter((path): path is string => path !== null);
  const report: StorageCleanup = { bucket, removed: 0, failed: 0, unreadable: false };
  for (let start = 0; start < paths.length; start += LIST_PAGE_SIZE) {
    const batch = paths.slice(start, start + LIST_PAGE_SIZE);
    if (await removeWithAttempts(fastify.supabaseAdmin.storage.from(bucket), batch)) report.removed += batch.length;
    else report.failed += batch.length;
  }
  return report;
}

/** Ce qui reste à nettoyer après des effacements, pour le journal du serveur :
 * des nombres par bucket, jamais un chemin ni un identifiant. */
export function storageLeftovers(reports: StorageCleanup[]): Omit<StorageCleanup, "removed">[] {
  return reports.filter((report) => report.failed > 0 || report.unreadable).map(({ bucket, failed, unreadable }) => ({ bucket, failed, unreadable }));
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
    // Le bucket seul : jamais l'identifiant du compte ni l'adresse.
    fastify.log.warn({ bucket }, "Suppression de fichier ignorée : l'URL enregistrée ne correspond pas à ce bucket/utilisateur");
    return;
  }

  const { error } = await fastify.supabaseAdmin.storage.from(bucket).remove([path]);
  if (error) {
    fastify.log.error({ error, bucket }, "Échec de la suppression du fichier de stockage");
  }
}
