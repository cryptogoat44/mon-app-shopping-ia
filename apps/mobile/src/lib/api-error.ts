import type { ApiErrorBody } from "@monapp/shared-types";

/** Réponse d'erreur de notre serveur ({ error, message }). Module à part :
 * utilisable (et testable) sans la configuration réseau de lib/api.ts. */
export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}
