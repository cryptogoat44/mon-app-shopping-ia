// Suppression d'un compte de test par l'app elle-même (DELETE /api/me),
// comme « Supprimer mon compte » : fichiers, publications, commentaires…
// partent avec lui. Lot 5 : le mot de confirmation est obligatoire, et le
// serveur refuse un compte administrateur — le rôle du compte de test est
// alors retiré (spotto-dev uniquement), puis la suppression relancée.
// Utilisé par les vérifications à l'écran (site et iPhone).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_DELETION_WORDS, type DeleteAccountRequest } from "@monapp/shared-types";

const CORPS: DeleteAccountRequest = { confirmation: ACCOUNT_DELETION_WORDS.fr };

/** Vrai si le serveur a supprimé le compte ; sinon, à l'appelant de passer
 * par l'administration (qui, elle, laisse les fichiers). */
export async function supprimerCompteParLApp(apiUrl: string, admin: SupabaseClient, compte: { id: string; jeton: string }): Promise<boolean> {
  const supprimer = () =>
    fetch(`${apiUrl}/api/me`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${compte.jeton}`, "content-type": "application/json" },
      body: JSON.stringify(CORPS),
    }).catch(() => null);
  let reponse = await supprimer();
  if (reponse?.status === 409) {
    await admin.from("admins").delete().eq("user_id", compte.id);
    reponse = await supprimer();
  }
  return Boolean(reponse && (reponse.ok || reponse.status === 204));
}
