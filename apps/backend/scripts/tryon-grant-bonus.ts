// Essais offerts pour un achat confirmé (essayage virtuel, migration 0042) :
// TRYON_BONUS_PER_PURCHASE essais (5 par défaut), valables
// TRYON_BONUS_VALIDITY_DAYS jours (365), utilisés après les essais gratuits,
// ceux qui expirent le plus tôt d'abord. Une commande n'accorde qu'une fois :
// relancer avec la même référence ne change rien (fonction tryon_grant_bonus).
//
//   pnpm --filter backend tryon:grant-bonus --user <identifiant du membre> --order <référence de la commande>
//
// Aujourd'hui, aucun programme d'affiliation ne confirme d'achat (voir le
// rapport du lot) : ce script est le seul moyen d'accorder ces essais, à la
// main, après vérification de la commande. La base visée est toujours
// affichée ; rien de secret n'est affiché.
import "dotenv/config";
import { z } from "zod";
import { readTryonSettings, type TryonEnvSource } from "../src/lib/tryon/config.js";
import { describeTarget, optionValue, serviceClient } from "./lib/tryon-admin.js";

const OPTIONS = z.object({ user: z.guid(), order: z.string().trim().min(1).max(200) });
const RESULT = z.array(z.object({ granted: z.boolean(), expires_at: z.string().nullable() })).length(1);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = OPTIONS.safeParse({ user: optionValue(args, "--user"), order: optionValue(args, "--order") });
  if (!options.success) {
    console.error("Usage : pnpm --filter backend tryon:grant-bonus --user <identifiant du membre> --order <référence de la commande>");
    process.exitCode = 1;
    return;
  }
  const problems: string[] = [];
  const settings = readTryonSettings(process.env as unknown as TryonEnvSource, problems);
  if (problems.length > 0) throw new Error(`Réglages de l'essayage invalides : ${problems.join(" ; ")}`);
  const { client, project } = serviceClient(process.env);
  console.log(describeTarget(project));
  const { data, error } = await client.rpc("tryon_grant_bonus", {
    p_user_id: options.data.user,
    p_order_ref: options.data.order,
    p_quantity: settings.bonusPerPurchase,
    p_validity_days: settings.bonusValidityDays,
  });
  if (error) throw new Error(error.message.includes("membre introuvable") ? "Ce membre est introuvable." : "Accord des essais offerts impossible (la migration 0042 est-elle appliquée ?).");
  const [result] = RESULT.parse(data);
  if (result!.granted) {
    console.log(`${settings.bonusPerPurchase} essais offerts accordés, valables jusqu'au ${result!.expires_at!.slice(0, 10)}.`);
  } else if (result!.expires_at) {
    console.log(`Cette commande a déjà été accordée à ce membre (valable jusqu'au ${result!.expires_at.slice(0, 10)}) : rien de plus.`);
  } else {
    console.log("Cette référence de commande est déjà rattachée à un autre membre : rien n'a été accordé.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
