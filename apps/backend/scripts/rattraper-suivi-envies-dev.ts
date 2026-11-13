// Alertes prix et stock (lot 2, migration 0036) : crée le suivi des envies
// déjà là avant 0036 (clé « même pièce », sans prix de référence), et
// recalcule la clé des envies dont la version est plus ancienne. Sur
// spotto-dev-2 UNIQUEMENT (même garde-fou que migrer-dev et
// nettoyer-comptes-test-dev) ; rejouable sans effet.
//
//   pnpm --filter backend rattraper-suivi-envies-dev
//
// Demande la migration 0036 sur la base visée. N'affiche que des nombres :
// ni compte, ni titre, ni adresse, ni rien de secret.
import "dotenv/config";
import { buildApp } from "../src/app.js";
import { backfillWishTracking, wishAlertsReady } from "../src/lib/wishAlerts.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";

async function main(): Promise<void> {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL (apps/backend/.env)");
  console.log(`Projet : spotto-dev-2 (${url.hostname}).`);
  const app = await buildApp({ logger: false });
  try {
    if (!(await wishAlertsReady(app))) {
      console.error("Les migrations 0036 et 0040 (garde-fous) ne sont pas toutes deux appliquées sur cette base : rien à faire.");
      process.exitCode = 1;
      return;
    }
    const summary = await backfillWishTracking(app);
    console.log(`${summary.scanned} envie(s) lue(s) : ${summary.created} suivi(s) créé(s), ${summary.updated} clé(s) recalculée(s), ${summary.unchanged} déjà à jour.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
