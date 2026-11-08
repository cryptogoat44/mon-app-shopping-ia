// Copie des photos : le côté copie, un stockage compatible S3 (Cloudflare
// R2, Backblaze B2, AWS S3…). Voir sauvegarde-photos.ts.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { BackupFile, FileBody, PhotoBackupStore } from "./sauvegarde-photos.js";

/** Garde-fou : au plus 10 000 pages de 1 000 clés. */
const MAX_PAGES = 10_000;

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createS3Client(settings: S3Settings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // Adresse « endpoint/bucket/clé » : comprise par tous les stockages compatibles.
    forcePathStyle: true,
    // Sommes de contrôle seulement quand l'opération l'exige : les sommes
    // ajoutées par défaut ne sont pas acceptées par tous les stockages compatibles.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Le client S3, ou un faux dans les tests. */
export type S3Like = Pick<S3Client, "send">;

export function createS3BackupStore(client: S3Like, bucket: string): PhotoBackupStore {
  return {
    async listAll(prefix: string): Promise<BackupFile[]> {
      const files: BackupFile[] = [];
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const output = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const item of output.Contents ?? []) {
          if (!item.Key || item.Key.endsWith("/")) continue;
          files.push({ key: item.Key, size: item.Size ?? -1, lastModified: item.LastModified?.getTime() ?? 0 });
        }
        if (!output.IsTruncated) return files;
        token = output.NextContinuationToken;
        if (!token) throw new Error("Liste de la copie interrompue.");
      }
      throw new Error("Copie trop grande.");
    },
    async put(key: string, file: FileBody): Promise<void> {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.body, ...(file.contentType ? { ContentType: file.contentType } : {}) })
      );
    },
    async get(key: string): Promise<FileBody> {
      const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!output.Body) throw new Error("Fichier vide.");
      return { body: await output.Body.transformToByteArray(), contentType: output.ContentType ?? null };
    },
    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
