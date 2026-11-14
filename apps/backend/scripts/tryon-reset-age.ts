// Remet à zéro le statut d'âge d'un membre pour l'essayage virtuel (fonction
// tryon_reset_age, migration 0042). Le membre ne peut pas changer ce statut
// lui-même : seul ce script le peut, par exemple après une erreur de saisie
// prouvée. Il repassera la porte d'âge à son prochain essai. Son
// consentement n'est pas touché.
//
//   pnpm --filter backend tryon:reset-age --user <identifiant du membre> --confirm
//
// Sans --confirm : refusé, avec l'explication. La base visée est toujours
// affichée ; rien de secret n'est affiché.
import "dotenv/config";
import { z } from "zod";
import { describeTarget, hasFlag, optionValue, serviceClient } from "./lib/tryon-admin.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const user = z.guid().safeParse(optionValue(args, "--user"));
  if (!user.success) {
    console.error("Usage : pnpm --filter backend tryon:reset-age --user <identifiant du membre> --confirm");
    process.exitCode = 1;
    return;
  }
  const { client, project } = serviceClient(process.env);
  console.log(describeTarget(project));
  if (!hasFlag(args, "--confirm")) {
    console.error(
      "Refusé : le statut d'âge (majeur ou mineur) ne se change qu'après vérification. Le membre devra repasser la porte d'âge. Relancez avec --confirm pour confirmer."
    );
    process.exitCode = 1;
    return;
  }
  const { data, error } = await client.rpc("tryon_reset_age", { p_user_id: user.data });
  if (error || typeof data !== "boolean") throw new Error("Remise à zéro impossible (la migration 0042 est-elle appliquée ?).");
  console.log(data ? "Statut d'âge effacé : le membre repassera la porte d'âge." : "Aucun statut d'âge enregistré pour ce membre : rien à effacer.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
