// Supprime les comptes de test orphelins de spotto-dev UNIQUEMENT (e-mails
// @example.com laissés par des passages de tests interrompus), avec leurs
// fichiers de stockage — accord du fondateur, 2026-09-25.
//
//   pnpm --filter backend nettoyer-comptes-test-dev              (liste seulement)
//   pnpm --filter backend nettoyer-comptes-test-dev --supprimer  (suppression)
//
// Refuse de s'exécuter si SUPABASE_URL ne désigne pas spotto-dev (même
// garde-fou que migrer-dev). Épargne les comptes créés il y a moins de
// 15 minutes (un test peut être en cours). Rien de secret n'est affiché.
import "dotenv/config";
import { buildApp } from "../src/app.js";
import { deleteUserStorageFiles } from "../src/lib/storage.js";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";

const TEST_DOMAIN = "@example.com";
const RECENT_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL (apps/backend/.env)");
  const remove = process.argv.includes("--supprimer");
  console.log(`Projet : spotto-dev (${url.hostname}) — ${remove ? "SUPPRESSION" : "liste seulement, rien n'est supprimé"}.`);

  const app = await buildApp({ logger: false });
  try {
    const found: { id: string; email: string; createdAt: string }[] = [];
    for (let page = 1; ; page++) {
      const { data, error } = await app.supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error("Lecture des comptes impossible.");
      for (const user of data.users) {
        if (user.email?.toLowerCase().endsWith(TEST_DOMAIN)) found.push({ id: user.id, email: user.email, createdAt: user.created_at });
      }
      if (data.users.length < 200) break;
    }

    const now = Date.now();
    const targets = found.filter((u) => now - new Date(u.createdAt).getTime() > RECENT_MS);
    console.log(`${found.length} compte(s) ${TEST_DOMAIN} ; ${targets.length} concerné(s) (${found.length - targets.length} récent(s) épargné(s)).`);
    for (const u of targets) console.log(`  - ${u.email} (créé le ${u.createdAt.slice(0, 10)})`);

    if (!remove) {
      console.log("\nRelancer avec --supprimer pour effacer ces comptes et leurs fichiers.");
      return;
    }
    let deleted = 0;
    for (const u of targets) {
      await deleteUserStorageFiles(app, u.id);
      const { error } = await app.supabaseAdmin.auth.admin.deleteUser(u.id);
      if (error) console.log(`  ⚠ ${u.email} : suppression refusée`);
      else deleted++;
    }
    console.log(`\n${deleted} compte(s) supprimé(s), fichiers compris.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
