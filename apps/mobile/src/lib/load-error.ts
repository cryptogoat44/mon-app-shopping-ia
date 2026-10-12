import { t } from "../i18n";
import { ApiError } from "./api-error";

/** Message d'un chargement en échec (charte, règle 1) : hors ligne quand le
 * réseau n'a pas répondu (fetch échoue alors avec une TypeError), sinon le
 * message du serveur, sinon le texte de repli de l'écran. */
export function loadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return t.common.offline;
  if (error instanceof ApiError) return error.message;
  return fallback;
}
