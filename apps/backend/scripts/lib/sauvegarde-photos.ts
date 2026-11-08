// Copie hebdomadaire des photos (point 10 de la feuille de route V1) : la
// logique, sans réseau. Les deux côtés (le stockage de Supabase, la copie
// S3) arrivent par des interfaces : les vrais clients dans
// sauvegarde-photos-supabase.ts et sauvegarde-photos-s3.ts, des faux dans
// les tests.
//
// Règles :
// - la copie est un miroir : une photo absente de Supabase (compte supprimé,
//   publication effacée) disparaît de la copie au passage suivant ;
// - jamais d'effacement sur une lecture incomplète : un bucket illisible
//   n'efface rien ;
// - garde-fou : un passage qui effacerait beaucoup de photos d'un coup
//   (Supabase vidé par erreur, mauvais projet) n'efface rien et s'arrête en
//   erreur, sauf --autoriser-purge ;
// - le journal ne contient que des nombres, jamais un chemin ni un
//   identifiant de compte.
//
// Aucun import de src/ : src/env.ts exige les réglages du serveur (SerpApi…),
// inutiles ici. Les tests vérifient que la liste ci-dessous suit
// USER_STORAGE_BUCKETS (src/lib/storage.ts).

/** Les buckets copiés : tous ceux des comptes, sauf les images analysées
 * (« screenshots »), effacées dans l'heure et jamais à garder. */
export const PHOTO_BUCKETS = ["vault-media", "post-media", "avatars"] as const;
export type PhotoBucket = (typeof PHOTO_BUCKETS)[number];

/** Les buckets volontairement laissés hors de la copie. */
export const BUCKETS_NOT_BACKED_UP = ["screenshots"] as const;

/** Une photo dans Supabase. */
export interface SourceFile {
  /** Chemin dans le bucket, par exemple « <compte>/<photo>.jpg ». */
  path: string;
  size: number;
  /** Dernière modification, en millisecondes ; null si inconnue. */
  updatedAt: number | null;
  contentType: string | null;
}

/** Une photo dans la copie. */
export interface BackupFile {
  /** Clé dans la copie : « <bucket>/<chemin> ». */
  key: string;
  size: number;
  /** Date d'écriture dans la copie, en millisecondes. */
  lastModified: number;
}

export interface FileBody {
  body: Uint8Array;
  contentType: string | null;
}

/** Le stockage de Spotto (Supabase). */
export interface PhotoSource {
  /** Toutes les photos d'un bucket. Lève une erreur si la lecture est incomplète. */
  listAll(bucket: PhotoBucket): Promise<SourceFile[]>;
  download(bucket: PhotoBucket, path: string): Promise<FileBody>;
  /** Dépose une photo SANS jamais en remplacer une (restauration). */
  uploadNew(bucket: PhotoBucket, path: string, file: FileBody): Promise<void>;
}

/** La copie (un stockage compatible S3). */
export interface PhotoBackupStore {
  /** Toutes les clés sous « <prefix> ». Lève une erreur si la lecture est incomplète. */
  listAll(prefix: string): Promise<BackupFile[]>;
  put(key: string, file: FileBody): Promise<void>;
  get(key: string): Promise<FileBody>;
  delete(key: string): Promise<void>;
}

/** Journal : des nombres seulement. */
export interface BackupLog {
  info(message: string): void;
  warn(message: string): void;
}

export function backupKey(bucket: PhotoBucket, path: string): string {
  return `${bucket}/${path}`;
}

/** En dessous de ce nombre, une purge passe toujours. */
export const PURGE_ALWAYS_ALLOWED = 50;
/** Au-delà de cette part de la copie d'un bucket (et de PURGE_ALWAYS_ALLOWED), la purge est bloquée. */
export const PURGE_MAX_SHARE = 0.1;

export interface BucketPlan {
  toCopy: SourceFile[];
  /** Clés à effacer de la copie. Vide si la purge est bloquée. */
  toDelete: string[];
  unchanged: number;
  /** Raison du blocage de la purge, ou null. */
  purgeBlocked: string | null;
  /** Nombre de photos que la purge aurait effacées (même bloquée). */
  wouldDelete: number;
}

/** Une photo de Supabase doit être (re)copiée si la copie n'en a pas, si la
 * taille diffère, ou si elle a changé après sa copie (photo de profil
 * remplacée sous le même nom). */
function needsCopy(file: SourceFile, copy: BackupFile | undefined): boolean {
  if (!copy) return true;
  if (copy.size !== file.size) return true;
  return file.updatedAt !== null && file.updatedAt > copy.lastModified;
}

/** Ce qu'il faut faire pour un bucket. `source` null : bucket illisible. */
export function planBucket(
  bucket: PhotoBucket,
  source: SourceFile[] | null,
  backup: BackupFile[],
  options: { allowLargePurge: boolean }
): BucketPlan {
  const prefix = `${bucket}/`;
  const copies = new Map(backup.filter((file) => file.key.startsWith(prefix)).map((file) => [file.key, file]));
  if (source === null) {
    return { toCopy: [], toDelete: [], unchanged: 0, purgeBlocked: "bucket illisible dans Supabase", wouldDelete: 0 };
  }
  const toCopy: SourceFile[] = [];
  let unchanged = 0;
  const present = new Set<string>();
  for (const file of source) {
    const key = backupKey(bucket, file.path);
    present.add(key);
    if (needsCopy(file, copies.get(key))) toCopy.push(file);
    else unchanged += 1;
  }
  const extra = [...copies.keys()].filter((key) => !present.has(key)).sort();
  let purgeBlocked: string | null = null;
  if (extra.length > 0 && !options.allowLargePurge) {
    if (source.length === 0) {
      purgeBlocked = "Supabase ne contient aucune photo dans ce bucket alors que la copie en a";
    } else if (extra.length > PURGE_ALWAYS_ALLOWED && extra.length > copies.size * PURGE_MAX_SHARE) {
      purgeBlocked = `la purge effacerait ${extra.length} photos sur ${copies.size} (plus de ${Math.round(PURGE_MAX_SHARE * 100)} %)`;
    }
  }
  return { toCopy, toDelete: purgeBlocked ? [] : extra, unchanged, purgeBlocked, wouldDelete: extra.length };
}

export interface BucketReport {
  bucket: PhotoBucket;
  /** Photos lues dans Supabase (null : illisible). */
  sourceFiles: number | null;
  copied: number;
  copyFailed: number;
  unchanged: number;
  deleted: number;
  deleteFailed: number;
  wouldDelete: number;
  purgeBlocked: string | null;
  /** La copie n'a pas pu être lue : rien n'a été fait pour ce bucket. */
  backupUnreadable: boolean;
}

/** Exécute `task` sur chaque élément, `concurrency` à la fois ; renvoie le nombre d'échecs. */
async function forEachLimited<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<number> {
  let failed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      try {
        await task(item);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return failed;
}

export interface BackupOptions {
  /** Essai : rien n'est copié ni effacé, seulement compté. */
  dryRun: boolean;
  allowLargePurge: boolean;
  concurrency?: number;
}

/** Le passage hebdomadaire : chaque bucket de PHOTO_BUCKETS vers la copie. */
export async function runBackup(
  source: PhotoSource,
  backup: PhotoBackupStore,
  log: BackupLog,
  options: BackupOptions
): Promise<BucketReport[]> {
  const concurrency = options.concurrency ?? 4;
  const reports: BucketReport[] = [];
  for (const bucket of PHOTO_BUCKETS) {
    const report: BucketReport = {
      bucket,
      sourceFiles: null,
      copied: 0,
      copyFailed: 0,
      unchanged: 0,
      deleted: 0,
      deleteFailed: 0,
      wouldDelete: 0,
      purgeBlocked: null,
      backupUnreadable: false,
    };
    reports.push(report);

    let copies: BackupFile[];
    try {
      copies = await backup.listAll(`${bucket}/`);
    } catch {
      report.backupUnreadable = true;
      log.warn(`${bucket} : copie illisible, bucket sauté.`);
      continue;
    }
    let files: SourceFile[] | null;
    try {
      files = await source.listAll(bucket);
      report.sourceFiles = files.length;
    } catch {
      files = null;
      log.warn(`${bucket} : lecture de Supabase incomplète, rien n'est copié ni effacé.`);
    }

    const plan = planBucket(bucket, files, copies, { allowLargePurge: options.allowLargePurge });
    report.unchanged = plan.unchanged;
    report.wouldDelete = plan.wouldDelete;
    report.purgeBlocked = files === null ? null : plan.purgeBlocked;
    if (report.purgeBlocked) log.warn(`${bucket} : purge bloquée, ${report.purgeBlocked}.`);

    if (options.dryRun) {
      report.copied = plan.toCopy.length;
      report.deleted = plan.toDelete.length;
      continue;
    }

    report.copyFailed = await forEachLimited(plan.toCopy, concurrency, async (file) => {
      const body = await source.download(bucket, file.path);
      await backup.put(backupKey(bucket, file.path), { body: body.body, contentType: body.contentType ?? file.contentType });
    });
    report.copied = plan.toCopy.length - report.copyFailed;

    report.deleteFailed = await forEachLimited(plan.toDelete, concurrency, (key) => backup.delete(key));
    report.deleted = plan.toDelete.length - report.deleteFailed;
  }
  return reports;
}

/** Code de sortie : 0 tout va bien, 2 purge bloquée (à regarder), 1 échec. */
export function backupExitCode(reports: BucketReport[]): number {
  if (reports.some((r) => r.backupUnreadable || r.sourceFiles === null || r.copyFailed > 0 || r.deleteFailed > 0)) return 1;
  if (reports.some((r) => r.purgeBlocked !== null)) return 2;
  return 0;
}

/** Une ligne par bucket, des nombres seulement. */
export function describeBackup(reports: BucketReport[], dryRun: boolean): string[] {
  const verb = dryRun ? "à copier" : "copiées";
  const verbDelete = dryRun ? "à effacer" : "effacées";
  return reports.map((r) => {
    if (r.backupUnreadable) return `${r.bucket} : copie illisible, rien fait.`;
    if (r.sourceFiles === null) return `${r.bucket} : Supabase illisible, rien fait.`;
    const parts = [`${r.sourceFiles} photos dans Supabase`, `${r.copied} ${verb}`, `${r.unchanged} déjà à jour`, `${r.deleted} ${verbDelete}`];
    if (r.copyFailed > 0) parts.push(`${r.copyFailed} copies échouées`);
    if (r.deleteFailed > 0) parts.push(`${r.deleteFailed} effacements échoués`);
    if (r.purgeBlocked) parts.push(`purge bloquée (${r.wouldDelete} à effacer)`);
    return `${r.bucket} : ${parts.join(", ")}.`;
  });
}

// ---------------------------------------------------------------------
// Restauration : remettre dans Supabase les photos de la copie qui y
// manquent. Ne remplace jamais une photo présente.
// ---------------------------------------------------------------------

export interface RestoreOptions {
  /** Essai : rien n'est écrit dans Supabase, seulement compté. */
  dryRun: boolean;
  /** Un seul bucket (sinon les trois). */
  bucket?: PhotoBucket;
  /** Un seul dossier (un compte), par exemple « 1b2c…/ ». */
  folder?: string;
  concurrency?: number;
}

export interface RestoreReport {
  bucket: PhotoBucket;
  inBackup: number;
  missing: number;
  restored: number;
  failed: number;
  /** Fichiers de la copie refusés : chemin ou type inattendu (copie abîmée ou trafiquée). */
  rejected: number;
  unreadable: boolean;
}

/** Types acceptés en restauration : ceux que Spotto enregistre (des JPEG
 * aujourd'hui) et les formats d'image courants. Jamais du HTML ni du SVG,
 * même si la copie a été trafiquée : les buckets de photos sont publics. */
export const RESTORABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"] as const;

/** Une clé de la copie qu'on accepte de remettre dans Supabase :
 * « <bucket>/<compte>/<fichier> », sans « .. » ni caractère inattendu. */
export function restorablePath(bucket: PhotoBucket, key: string): string | null {
  const prefix = `${bucket}/`;
  if (!key.startsWith(prefix)) return null;
  const path = key.slice(prefix.length);
  return /^[0-9A-Za-z-]{1,64}\/[0-9A-Za-z_-][0-9A-Za-z._-]{0,127}$/.test(path) && !path.includes("..") ? path : null;
}

export function restorableType(contentType: string | null): boolean {
  return contentType !== null && (RESTORABLE_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/** Un dossier valide : un seul niveau, lettres, chiffres, tirets (un identifiant de compte). */
export function parseFolder(value: string): string | null {
  const trimmed = value.replace(/\/+$/, "");
  return /^[0-9A-Za-z-]{1,64}$/.test(trimmed) ? trimmed : null;
}

export function parseBucket(value: string): PhotoBucket | null {
  return (PHOTO_BUCKETS as readonly string[]).includes(value) ? (value as PhotoBucket) : null;
}

export async function runRestore(
  source: PhotoSource,
  backup: PhotoBackupStore,
  log: BackupLog,
  options: RestoreOptions
): Promise<RestoreReport[]> {
  const concurrency = options.concurrency ?? 4;
  const buckets = options.bucket ? [options.bucket] : [...PHOTO_BUCKETS];
  const reports: RestoreReport[] = [];
  for (const bucket of buckets) {
    const report: RestoreReport = { bucket, inBackup: 0, missing: 0, restored: 0, failed: 0, rejected: 0, unreadable: false };
    reports.push(report);
    const prefix = options.folder ? `${bucket}/${options.folder}/` : `${bucket}/`;
    let copies: BackupFile[];
    let present: Set<string>;
    try {
      copies = await backup.listAll(prefix);
      present = new Set((await source.listAll(bucket)).map((file) => backupKey(bucket, file.path)));
    } catch {
      report.unreadable = true;
      log.warn(`${bucket} : lecture impossible, rien restauré.`);
      continue;
    }
    report.inBackup = copies.length;
    const missing = copies.filter((copy) => !present.has(copy.key));
    const accepted = missing.filter((copy) => restorablePath(bucket, copy.key) !== null);
    report.rejected = missing.length - accepted.length;
    report.missing = accepted.length;
    if (report.rejected > 0) log.warn(`${bucket} : ${report.rejected} fichiers de la copie refusés (chemin inattendu).`);
    if (options.dryRun) continue;
    let wrongType = 0;
    report.failed = await forEachLimited(accepted, concurrency, async (copy) => {
      const file = await backup.get(copy.key);
      if (!restorableType(file.contentType)) {
        wrongType += 1;
        return;
      }
      await source.uploadNew(bucket, restorablePath(bucket, copy.key)!, file);
    });
    if (wrongType > 0) log.warn(`${bucket} : ${wrongType} fichiers de la copie refusés (type inattendu).`);
    report.rejected += wrongType;
    report.restored = accepted.length - report.failed - wrongType;
  }
  return reports;
}

export function describeRestore(reports: RestoreReport[], dryRun: boolean): string[] {
  return reports.map((r) => {
    if (r.unreadable) return `${r.bucket} : lecture impossible, rien restauré.`;
    const done = dryRun ? `${r.missing} à restaurer` : `${r.restored} restaurées`;
    const failed = r.failed > 0 ? `, ${r.failed} échecs` : "";
    const rejected = r.rejected > 0 ? `, ${r.rejected} refusées (chemin ou type inattendu)` : "";
    return `${r.bucket} : ${r.inBackup} photos dans la copie, ${r.missing} absentes de Supabase, ${done}${failed}${rejected}.`;
  });
}

// ---------------------------------------------------------------------
// Petits outils du script (ici pour être testés sans le lancer).
// ---------------------------------------------------------------------

/** La valeur qui suit `--nom` (ou `--nom=valeur`), sinon null. */
export function argValue(args: string[], name: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    if (arg === name) return args[index + 1] ?? "";
  }
  return null;
}

/** La copie ne doit jamais être dans le projet Supabase qu'elle protège. */
export function sameProject(supabaseUrl: string, endpoint: string): boolean {
  const project = new URL(supabaseUrl).hostname.split(".")[0] ?? "";
  return project.length > 0 && new URL(endpoint).hostname.split(".").includes(project);
}
