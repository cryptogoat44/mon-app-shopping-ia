// Nettoyage unique des anciennes images analysées (Lot S, RGPD).
//
// Depuis le Lot S, l'image envoyée à la recherche visuelle est supprimée dès
// la réponse de SerpApi. Ce script efface celles stockées AVANT ce
// changement. Il ne touche qu'au bucket « screenshots », jamais aux autres
// (Vault, publications, avatars), ni à la base de données.
//
// Deux temps :
//   pnpm --filter backend nettoyer-captures              → SIMULATION : compte seulement
//   pnpm --filter backend nettoyer-captures --supprimer  → vraie suppression (après accord)
//
// Le projet visé et sa clé secrète sont demandés au lancement : la clé est
// tapée sans s'afficher, et n'est jamais écrite nulle part (ni fichier, ni
// historique du Terminal). Les images de moins de 15 minutes sont laissées
// de côté : une recherche peut être en cours.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const BUCKET = "screenshots";
const PAGE_SIZE = 1000;
const DELETE_BATCH = 100;
const KEEP_RECENT_MS = 15 * 60 * 1000;

const deleteForReal = process.argv.includes("--supprimer");

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}

// Saisie masquée : rien ne s'affiche pendant la frappe ou le collage.
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Lancez ce script depuis un Terminal (saisie masquée impossible)."));
      return;
    }
    // Masquage activé AVANT d'afficher la question (un collage très rapide
    // ne doit jamais apparaître à l'écran).
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    process.stdout.write(question);
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (char === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          process.stdout.write("\nAbandon.\n");
          process.exit(1);
        }
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function listAll(
  supabase: SupabaseClient,
  prefix: string
): Promise<{ name: string; id: string | null; created_at: string | null }[]> {
  const entries: { name: string; id: string | null; created_at: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`Lecture impossible du dossier « ${prefix || "/"} » : ${error.message}`);
    entries.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return entries;
  }
}

async function main() {
  console.log(deleteForReal ? "Mode : VRAIE SUPPRESSION" : "Mode : SIMULATION (rien ne sera supprimé)");
  const projectId = (await ask("Identifiant du projet Supabase visé : ")).trim();
  if (!/^[a-z0-9]{20}$/.test(projectId)) throw new Error("Identifiant de projet invalide (20 lettres minuscules et chiffres).");
  const secretKey = await askHidden("Clé secrète du projet (sb_secret_…, ne s'affiche pas) : ");
  if (!secretKey) throw new Error("Clé manquante.");

  const supabase = createClient(`https://${projectId}.supabase.co`, secretKey, { auth: { persistSession: false } });

  const cutoff = Date.now() - KEEP_RECENT_MS;
  const folders = (await listAll(supabase, "")).filter((entry) => entry.id === null);
  const plan: { folder: string; paths: string[]; kept: number }[] = [];
  for (const folder of folders) {
    const files = (await listAll(supabase, folder.name)).filter((entry) => entry.id !== null);
    const old = files.filter((file) => !file.created_at || Date.parse(file.created_at) < cutoff);
    plan.push({ folder: folder.name, paths: old.map((file) => `${folder.name}/${file.name}`), kept: files.length - old.length });
  }

  const total = plan.reduce((sum, entry) => sum + entry.paths.length, 0);
  const kept = plan.reduce((sum, entry) => sum + entry.kept, 0);
  console.log(`\nProjet : ${projectId} — bucket « ${BUCKET} » uniquement`);
  for (const entry of plan) {
    if (entry.paths.length > 0) console.log(`  dossier ${entry.folder}/ : ${entry.paths.length} fichier(s)`);
  }
  console.log(`Total : ${total} fichier(s) à supprimer, dans ${plan.filter((e) => e.paths.length > 0).length} dossier(s).`);
  if (kept > 0) console.log(`${kept} fichier(s) de moins de 15 minutes laissé(s) de côté.`);

  if (!deleteForReal) {
    console.log("\nSimulation terminée : rien n'a été supprimé.");
    return;
  }
  if (total === 0) return;

  const confirmation = await ask(`\nPour confirmer la suppression DÉFINITIVE, retapez l'identifiant du projet : `);
  if (confirmation.trim() !== projectId) {
    console.log("Identifiant différent : abandon, rien n'a été supprimé.");
    return;
  }

  const paths = plan.flatMap((entry) => entry.paths);
  let deleted = 0;
  for (let i = 0; i < paths.length; i += DELETE_BATCH) {
    const batch = paths.slice(i, i + DELETE_BATCH);
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Suppression interrompue après ${deleted} fichier(s) : ${error.message}`);
    deleted += data?.length ?? 0;
  }
  console.log(`Suppression terminée : ${deleted} fichier(s) supprimé(s) sur ${total}.`);
}

main().catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
