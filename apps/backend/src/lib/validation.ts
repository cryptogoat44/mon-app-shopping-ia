import type { FastifyReply } from "fastify";
import { z } from "zod";

// Schémas communs pour valider TOUTES les entrées des routes (audit Lot Q,
// SEC-03) : identifiants d'adresse, curseurs de pagination, corps. Avant,
// plusieurs routes lisaient leurs entrées telles quelles (`request.params as
// ...`) et comptaient sur Postgres pour refuser une valeur absurde — par
// accident, et parfois avec une erreur 500 (POST /api/reports sans corps).

// Identifiants : z.guid() partout dans le serveur (8-4-4-4-12 caractères
// hexadécimaux), la règle exacte du .uuid() de zod 3. Le z.uuid() de zod 4
// est plus strict (numéro de version et variante) : il refuserait des
// identifiants acceptés jusqu'ici.
export const idParamsSchema = z.object({ id: z.guid() });
export const userIdParamsSchema = z.object({ userId: z.guid() });

/** Curseur de pagination : la date de création du dernier élément reçu,
 * normalisée en ISO. */
export const cursorQuerySchema = z.object({
  cursor: z
    .string()
    .max(64)
    .refine((value) => !Number.isNaN(Date.parse(value)))
    .transform((value) => new Date(value).toISOString())
    .optional(),
});

// Caractères de contrôle, n'importe où (tabulation et retour à la ligne
// compris) : le parseur d'URL, comme les navigateurs, les retire en silence
// avant de lire le protocole. Refusés, jamais nettoyés : le lien rangé est
// exactement celui qui a été vérifié.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Vrai seulement pour un lien web ordinaire, écrit tel quel : « http:// » ou
 * « https:// » au tout début (majuscules comprises), un nom de site juste
 * après, aucun identifiant (« nom:mot@site »), aucun espace au début ni à la
 * fin, aucun caractère de contrôle. Tout le reste est refusé : javascript:,
 * data:, vbscript:, file:, blob:, ftp:, un lien sans protocole (« //site »)…
 * Le protocole est lu par le parseur d'URL standard (WHATWG, celui des
 * navigateurs), pas seulement par une recherche de texte. La longueur, elle,
 * n'est limitée qu'à l'entrée (webUrlSchema). */
export function isWebUrl(value: string): boolean {
  if (value.trim() !== value || CONTROL_CHARACTERS.test(value)) return false;
  // Même début exigé que dans l'app (apps/mobile/src/lib/web-url.ts) : tout
  // lien accepté ici s'y ouvre.
  if (!/^https?:\/\/[^/\\]/i.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "" && url.username === "" && url.password === "";
}

/** Longueur maximale d'un lien reçu de l'app : celle que la base impose déjà
 * au lien d'une pièce envoyée (piece_sends.merchant_url, migration 0024). */
export const WEB_URL_MAX_LENGTH = 2048;

/** Lien reçu de l'app : un lien web ordinaire (isWebUrl) de 2 048 caractères
 * au plus, rangé tel qu'il a été envoyé. */
export const webUrlSchema = z.string().max(WEB_URL_MAX_LENGTH).refine(isWebUrl);

/** Le lien s'il est un lien web ordinaire (isWebUrl), sinon null : un lien
 * rangé plus tôt qui n'en serait pas un n'est ni renvoyé ni recopié. */
export function webUrlOrNull(value: string | null): string | null {
  return value !== null && isWebUrl(value) ? value : null;
}

/** Valide `value` avec `schema`. En cas d'échec, répond 400 avec le
 * contrat d'erreur habituel ({ error, message }) et renvoie null : l'appelant
 * n'a plus qu'à `return` immédiatement. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  reply: FastifyReply,
  { error = "invalid_request", message = "Requête invalide." }: { error?: string; message?: string } = {}
): z.infer<S> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    void reply.code(400).send({ error, message });
    return null;
  }
  return parsed.data;
}

/** Lecture de la base impossible, ou réponse d'une forme inattendue. */
export class DatabaseReadError extends Error {}

/** Relit une LISTE lue dans la base avec `schema`. Une erreur ou une forme
 * inattendue relève DatabaseReadError : jamais une liste vide par défaut. */
export function parseDbRows<S extends z.ZodType>(schema: S, result: { data: unknown; error: unknown }, what: string): z.infer<S> {
  if (result.error) throw new DatabaseReadError(`${what} : lecture impossible`);
  const parsed = schema.safeParse(result.data ?? []);
  if (!parsed.success) throw new DatabaseReadError(`${what} : réponse illisible`);
  return parsed.data;
}

export const INVALID_ID = { error: "invalid_params", message: "Identifiant invalide." } as const;
export const INVALID_CURSOR = { error: "invalid_query", message: "Curseur de pagination invalide." } as const;
