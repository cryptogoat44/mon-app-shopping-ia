// Purge de l'essayage virtuel (fonction tryon_purge, migration 0042) : efface
// les essais, signalements et alertes de plus de 12 mois, et les essais
// offerts expirés depuis plus de 12 mois. Le serveur la fait déjà au passage
// à chaque réservation d'un essai ; ce script la lance à la demande. Les
// compteurs mensuels du budget (sans membre) sont gardés.
//
//   pnpm --filter backend tryon:purge
//
// La base visée est toujours affichée ; rien de secret n'est affiché.
import "dotenv/config";
import { z } from "zod";
import { describeTarget, serviceClient } from "./lib/tryon-admin.js";

const COUNTS = z.array(z.object({ events: z.number(), reports: z.number(), alerts: z.number(), grants: z.number() })).length(1);

async function main(): Promise<void> {
  const { client, project } = serviceClient(process.env);
  console.log(describeTarget(project));
  const { data, error } = await client.rpc("tryon_purge", { p_months: 12 });
  if (error) throw new Error("Purge impossible (la migration 0042 est-elle appliquée ?).");
  const [counts] = COUNTS.parse(data);
  console.log(
    `Purge faite (plus de 12 mois) : ${counts!.events} essai(s), ${counts!.reports} signalement(s), ${counts!.alerts} alerte(s), ${counts!.grants} commande(s) d'essais offerts expirée(s).`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
