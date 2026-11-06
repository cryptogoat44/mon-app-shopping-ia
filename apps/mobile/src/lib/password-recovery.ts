// « Mot de passe oublié » (Lot Q, bloc 3, UX-05). Logique pure, testée
// directement : lecture du lien reçu par e-mail.
//
// Supabase envoie un lien qui, une fois ouvert, ramène sur
// /nouveau-mot-de-passe avec :
// - depuis le chantier 3 (point 13, flux PKCE) : un code à usage unique
//   (« ?code=… »), échangé contre une session SEULEMENT par l'appareil qui a
//   fait la demande (il garde la clé secrète de l'échange). Sur iPhone, une
//   autre app qui intercepterait le lien « spotto:// » n'en ferait rien ;
// - avant (liens déjà envoyés) : dans la partie « # », les jetons d'une
//   session de réinitialisation (type=recovery) ;
// - ou une erreur (lien expiré ou déjà utilisé).

export const RECOVERY_PATH = "/nouveau-mot-de-passe";

export type RecoveryLink =
  | { kind: "code"; code: string }
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

  // Flux PKCE : un code opaque, sans espace ni caractère spécial.
  const code = queryParams.get("code");
  if (code && /^[A-Za-z0-9_-]{8,200}$/.test(code)) return { kind: "code", code };

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

/** Échec de l'échange du code (flux PKCE) : « other_device » si la clé de
 * l'échange manque sur cet appareil — le lien a été ouvert sur un autre
 * téléphone ou un autre navigateur que celui de la demande —, sinon
 * « expired » (code expiré, déjà utilisé, ou remplacé par une demande plus
 * récente). */
export function recoveryExchangeProblem(error: { code?: string; name?: string } | null | undefined): "other_device" | "expired" {
  return error?.code === "pkce_code_verifier_not_found" || error?.name === "AuthPKCECodeVerifierMissingError" ? "other_device" : "expired";
}
