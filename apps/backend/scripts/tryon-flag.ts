// Drapeau de l'essayage virtuel dans la base (feature_flags.tryon, migration
// 0042) : le second interrupteur, avec TRYON_ENABLED chez Render. Les deux
// doivent être allumés pour que l'essayage s'ouvre aux membres ; le serveur
// relit le drapeau toutes les 15 secondes.
//
//   pnpm --filter backend tryon:flag                    état actuel (rien n'est changé)
//   pnpm --filter backend tryon:flag --off              éteint (toujours permis)
//   pnpm --filter backend tryon:flag --on --confirm     allume (après l'accord de l'avocat)
//
// Sans --confirm, --on est refusé, avec l'explication. Si la base visée n'est
// pas spotto-dev-2, --on demande en plus --production. La base visée est
// toujours affichée. Utilise SUPABASE_URL et la clé du serveur de
// apps/backend/.env ; rien de secret n'est affiché.
import "dotenv/config";
import { describeTarget, flagRequest, serviceClient } from "./lib/tryon-admin.js";

async function main(): Promise<void> {
  const { client, project } = serviceClient(process.env);
  console.log(describeTarget(project));
  const request = flagRequest(process.argv.slice(2), project);
  if ("refused" in request) {
    console.error(request.refused);
    process.exitCode = 1;
    return;
  }
  if (request.action === "show") {
    const { data, error } = await client.from("feature_flags").select("enabled, updated_at").eq("key", "tryon").maybeSingle();
    if (error) throw new Error("Lecture du drapeau impossible (la migration 0042 est-elle appliquée ?).");
    if (!data) throw new Error("Le drapeau « tryon » est introuvable : appliquez d'abord la migration 0042.");
    console.log(`Drapeau « tryon » : ${data.enabled ? "ALLUMÉ" : "éteint"} (modifié le ${String(data.updated_at).slice(0, 19).replace("T", " ")} UTC).`);
    console.log("Pour l'éteindre : --off. Pour l'allumer (après l'accord de l'avocat) : --on --confirm.");
    return;
  }
  const enabled = request.action === "on";
  const { data, error } = await client.from("feature_flags").update({ enabled, updated_at: new Date().toISOString() }).eq("key", "tryon").select("enabled");
  if (error) throw new Error("Écriture du drapeau impossible (la migration 0042 est-elle appliquée ?).");
  if (!data || data.length !== 1) throw new Error("Le drapeau « tryon » est introuvable : appliquez d'abord la migration 0042.");
  console.log(enabled ? "Drapeau « tryon » ALLUMÉ." : "Drapeau « tryon » éteint.");
  console.log(
    enabled
      ? "L'essayage ne s'ouvre que si TRYON_ENABLED vaut aussi « true » sur le serveur (Render) ; le serveur relit le drapeau en 15 secondes au plus."
      : "L'essayage est coupé en 15 secondes au plus, quel que soit TRYON_ENABLED."
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
