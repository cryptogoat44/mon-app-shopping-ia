// Copie hebdomadaire des photos de Spotto vers un stockage privé compatible
// S3 (point 10 de la feuille de route V1). Mode d'emploi :
// apps/backend/supabase/SAUVEGARDE-PHOTOS.md.
//
//   pnpm --filter backend sauvegarder-photos                 (copie : ce que la tâche planifiée lance)
//   pnpm --filter backend sauvegarder-photos --essai         (compte seulement, rien n'est écrit)
//   pnpm --filter backend sauvegarder-photos --autoriser-purge
//   pnpm --filter backend sauvegarder-photos --restaurer [--bucket vault-media] [--dossier <compte>]
//   pnpm --filter backend sauvegarder-photos --restaurer --confirmer …
//
// Copie les buckets vault-media, post-media et avatars, en miroir : une photo
// absente de Supabase disparaît de la copie (garde-fou contre un effacement
// massif). La restauration remet dans Supabase les photos qui y manquent,
// sans jamais en remplacer une ; sans --confirmer, elle compte seulement.
//
// Réglages lus dans l'environnement (Render, ou apps/backend/.env) :
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PHOTO_BACKUP_S3_ENDPOINT,
// PHOTO_BACKUP_S3_REGION (facultatif, « auto » par défaut), PHOTO_BACKUP_S3_BUCKET,
// PHOTO_BACKUP_S3_ACCESS_KEY_ID, PHOTO_BACKUP_S3_SECRET_ACCESS_KEY.
// Rien de secret n'est affiché ; le journal ne contient que des nombres.
//
// Code de sortie : 0 tout va bien ; 2 purge bloquée par le garde-fou (à
// regarder) ; 1 échec (réglage manquant, lecture ou copie impossible).
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  argValue,
  backupExitCode,
  describeBackup,
  describeRestore,
  parseBucket,
  parseFolder,
  runBackup,
  runRestore,
  sameProject,
  type BackupLog,
} from "./lib/sauvegarde-photos.js";
import { createSupabasePhotoSource } from "./lib/sauvegarde-photos-supabase.js";
import { createS3BackupStore, createS3Client } from "./lib/sauvegarde-photos-s3.js";

const settingsSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PHOTO_BACKUP_S3_ENDPOINT: z.string().url().refine((value) => value.startsWith("https://"), "adresse https:// attendue"),
  PHOTO_BACKUP_S3_REGION: z.string().min(1).default("auto"),
  PHOTO_BACKUP_S3_BUCKET: z.string().min(1),
  PHOTO_BACKUP_S3_ACCESS_KEY_ID: z.string().min(1),
  PHOTO_BACKUP_S3_SECRET_ACCESS_KEY: z.string().min(1),
});

const log: BackupLog = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`⚠ ${message}`),
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const parsed = settingsSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    console.error(`Réglages manquants ou invalides : ${names.join(", ")}. Voir apps/backend/supabase/SAUVEGARDE-PHOTOS.md.`);
    return 1;
  }
  const settings = parsed.data;
  if (sameProject(settings.SUPABASE_URL, settings.PHOTO_BACKUP_S3_ENDPOINT)) {
    console.error("La copie doit être hors du projet Supabase qu'elle protège : PHOTO_BACKUP_S3_ENDPOINT refusé.");
    return 1;
  }

  const supabase = createClient(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const source = createSupabasePhotoSource(supabase.storage);
  const backup = createS3BackupStore(
    createS3Client({
      endpoint: settings.PHOTO_BACKUP_S3_ENDPOINT,
      region: settings.PHOTO_BACKUP_S3_REGION,
      bucket: settings.PHOTO_BACKUP_S3_BUCKET,
      accessKeyId: settings.PHOTO_BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey: settings.PHOTO_BACKUP_S3_SECRET_ACCESS_KEY,
    }),
    settings.PHOTO_BACKUP_S3_BUCKET
  );
  const projectHost = new URL(settings.SUPABASE_URL).hostname;

  if (args.includes("--restaurer")) {
    const bucketArg = argValue(args, "--bucket");
    const folderArg = argValue(args, "--dossier");
    const bucket = bucketArg === null ? undefined : parseBucket(bucketArg);
    const folder = folderArg === null ? undefined : parseFolder(folderArg);
    if (bucket === null) {
      console.error("--bucket : vault-media, post-media ou avatars.");
      return 1;
    }
    if (folder === null) {
      console.error("--dossier : un identifiant de compte (lettres, chiffres, tirets).");
      return 1;
    }
    const dryRun = !args.includes("--confirmer");
    console.log(
      `Restauration vers ${projectHost} — ${dryRun ? "ESSAI : rien n'est écrit (ajouter --confirmer pour restaurer)" : "les photos absentes sont remises, aucune n'est remplacée"}.`
    );
    const reports = await runRestore(source, backup, log, { dryRun, bucket, folder });
    for (const line of describeRestore(reports, dryRun)) console.log(line);
    return reports.some((r) => r.unreadable || r.failed > 0 || r.rejected > 0) ? 1 : 0;
  }

  const dryRun = args.includes("--essai");
  const allowLargePurge = args.includes("--autoriser-purge");
  console.log(
    `Copie des photos de ${projectHost} vers « ${settings.PHOTO_BACKUP_S3_BUCKET} » — ${dryRun ? "ESSAI : rien n'est copié ni effacé" : "copie"}${allowLargePurge ? ", purge autorisée sans garde-fou" : ""}.`
  );
  const started = Date.now();
  const reports = await runBackup(source, backup, log, { dryRun, allowLargePurge });
  for (const line of describeBackup(reports, dryRun)) console.log(line);
  const code = backupExitCode(reports);
  console.log(`Terminé en ${Math.round((Date.now() - started) / 1000)} s.`);
  if (code === 2) {
    console.warn("⚠ Purge bloquée par le garde-fou : rien n'a été effacé de la copie. Voir SAUVEGARDE-PHOTOS.md, « La purge est bloquée ».");
  }
  return code;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Le message seulement : jamais l'objet d'erreur entier (il peut contenir une requête signée).
    console.error(error instanceof Error ? error.message : "Erreur inattendue.");
    process.exitCode = 1;
  });
