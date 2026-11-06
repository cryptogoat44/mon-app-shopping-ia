// Lien de confirmation reçu par le site (chantier 3, flux PKCE) : après
// l'inscription (ou un changement d'adresse), l'e-mail de Supabase confirme
// l'adresse, puis ramène sur l'adresse du site avec un code à usage unique
// (« ?code=… »). Ouvert dans le navigateur qui a fait l'inscription, ce code
// ouvre la session ; ouvert ailleurs (l'inscription a été faite sur
// l'iPhone, par exemple), l'adresse est quand même confirmée : il reste à se
// connecter. Logique pure, testée.
// Imports relatifs : fichier testé par vitest.
import { RECOVERY_PATH } from "./password-recovery";

export type ConfirmationLink = { kind: "code"; code: string } | { kind: "error" } | { kind: "none" };

const CODE = /^[A-Za-z0-9_-]{8,200}$/;

/** Le lien de l'adresse d'arrivée, hors de la page du nouveau mot de passe
 * (qui lit son propre code). */
export function parseConfirmationUrl(url: string | null | undefined): ConfirmationLink {
  if (!url) return { kind: "none" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "none" };
  }
  if (parsed.pathname === RECOVERY_PATH) return { kind: "none" };
  const hash = new URLSearchParams(parsed.hash.slice(1));
  if (parsed.searchParams.get("error") || hash.get("error")) return { kind: "error" };
  const code = parsed.searchParams.get("code");
  return code && CODE.test(code) ? { kind: "code", code } : { kind: "none" };
}
