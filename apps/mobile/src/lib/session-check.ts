// Session refusée par le serveur de Spotto (401) : la personne n'est
// déconnectée que si Supabase le confirme lui-même (lot 4 ter, incident du
// 2026-10-07 : une coupure passagère entre le serveur et Supabase avait
// répondu 401, et l'app avait déconnecté la personne — partout). Une panne,
// une réponse illisible ou une erreur 5xx ne déconnectent jamais.
import { isAuthApiError, isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** Réponse explicite de Supabase : jeton refusé, session fermée, compte supprimé. */
export function sessionRejected(error: AuthError | null): boolean {
  if (!error) return false;
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500;
}

/** Demande à Supabase si la session de l'appareil est encore valable. */
export async function sessionRejectedBySupabase(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.getUser();
    return sessionRejected(error);
  } catch {
    // Erreur inattendue (réseau) : rien n'est confirmé, on ne déconnecte pas.
    return false;
  }
}
