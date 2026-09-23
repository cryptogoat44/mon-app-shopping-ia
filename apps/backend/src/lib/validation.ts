import type { FastifyReply } from "fastify";
import { z } from "zod";

// Schémas communs pour valider TOUTES les entrées des routes (audit Lot Q,
// SEC-03) : identifiants d'adresse, curseurs de pagination, corps. Avant,
// plusieurs routes lisaient leurs entrées telles quelles (`request.params as
// ...`) et comptaient sur Postgres pour refuser une valeur absurde — par
// accident, et parfois avec une erreur 500 (POST /api/reports sans corps).

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const userIdParamsSchema = z.object({ userId: z.string().uuid() });

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

/** Valide `value` avec `schema`. En cas d'échec, répond 400 avec le
 * contrat d'erreur habituel ({ error, message }) et renvoie null : l'appelant
 * n'a plus qu'à `return` immédiatement. */
export function parseInput<S extends z.ZodTypeAny>(
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

export const INVALID_ID = { error: "invalid_params", message: "Identifiant invalide." } as const;
export const INVALID_CURSOR = { error: "invalid_query", message: "Curseur de pagination invalide." } as const;
