// « Mot de passe oublié » (Lot Q, bloc 3, UX-05). Logique pure, testée
// directement : lecture du lien reçu par e-mail.
//
// Supabase envoie un lien qui, une fois ouvert, ramène sur
// /nouveau-mot-de-passe avec, dans la partie « # » de l'adresse, soit les
// jetons d'une session de réinitialisation (type=recovery), soit une erreur
// (lien expiré ou déjà utilisé).

export const RECOVERY_PATH = "/nouveau-mot-de-passe";

export type RecoveryLink =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; code: string | null }
  | { kind: "none" };

export function parseRecoveryUrl(url: string | null | undefined): RecoveryLink {
  if (!url) return { kind: "none" };
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  // Les jetons arrivent dans le fragment ; une erreur peut arriver dans le
  // fragment ou dans la requête selon la version de Supabase.
  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 && hashIndex > queryIndex ? hashIndex : undefined) : "";
  const params = new URLSearchParams(fragment);
  const queryParams = new URLSearchParams(query);

  const error = params.get("error") ?? queryParams.get("error");
  if (error) return { kind: "error", code: params.get("error_code") ?? queryParams.get("error_code") };

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken && params.get("type") === "recovery") {
    return { kind: "tokens", accessToken, refreshToken };
  }
  return { kind: "none" };
}

export const MIN_PASSWORD_LENGTH = 8;

export function newPasswordProblem(password: string, confirmation: string): "too_short" | "mismatch" | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password !== confirmation) return "mismatch";
  return null;
}
