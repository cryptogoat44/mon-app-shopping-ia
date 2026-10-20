// Essai des migrations 0025 et 0026 et de leurs retours en arrière, sur
// spotto-dev UNIQUEMENT, dans UNE transaction ANNULÉE à la fin : la base n'est
// jamais modifiée (demande du fondateur, 2026-10-16).
//
//   pnpm --filter backend essai-retours-dev
//
// Les fichiers essayés sont ceux que le fondateur copiera en production
// (docs/…), sans leurs lignes « begin; » et « commit; » : la transaction est
// celle de l'essai. Même garde-fou que migrer-dev (lib/dev-database.ts).
// N'affiche que des résultats de vérification, jamais l'adresse de la base.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { z } from "zod";
import { DEV_DATABASE_ENV, assertDevDatabaseUrl, describeDevDatabase } from "./lib/dev-database.js";

const DOCS = resolve(import.meta.dirname, "../../../docs");

/** Valeurs attendues des vérifications (identiques aux en-têtes des fichiers). */
const APRES_0025 = ["16", "1", "0", "2", "true"];
const APRES_0026 = ["2", "true", "true", "true", "true"];
const AVANT_0026 = ["0", "true", "true", "true", "true", "true"];
const AVANT_0025 = ["0", "false"];
/** Listes du journal avant 0026, telles que la base les décrit. */
const LISTE_DECISIONS = "CHECK ((action = ANY (ARRAY['dismiss'::text, 'hide'::text, 'suspend'::text, 'restore'::text, 'unsuspend'::text])))";
const LISTE_MOTIFS = "CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['spam'::text, 'inappropriate'::text, 'harassment'::text, 'other'::text]))))";
const LIGNES = z.array(z.record(z.unknown()));
const CONTROLE = z.object({ pret_pour_les_migrations: z.boolean(), liste_decisions_actuelle: z.string().nullable(), liste_motifs_actuelle: z.string().nullable() });

const lire = (nom: string) => readFileSync(resolve(DOCS, nom), "utf8");

/** Le contenu d'un fichier de production entre « begin; » et « commit; »,
 * seules commandes de transaction acceptées. */
function corps(nom: string): string {
  const texte = lire(nom);
  const lignes = texte.split("\n");
  const debut = lignes.findIndex((l) => l.trim().toLowerCase() === "begin;");
  const fin = lignes.findIndex((l) => l.trim().toLowerCase() === "commit;");
  // Hors des corps de fonctions ($$ … $$), où « end; » appartient à la fonction.
  const horsFonctions = texte.replace(/\$\$[\s\S]*?\$\$/g, "");
  const commandes = horsFonctions.match(/^\s*(begin|commit|rollback|end|abort|start transaction)\s*;/gim) ?? [];
  if (debut < 0 || fin < debut || commandes.length !== 2) throw new Error(`${nom} : « begin; » puis « commit; » attendus, seuls.`);
  return lignes.slice(debut + 1, fin).join("\n");
}

const resultats: string[] = [];
let echecs = 0;

function noter(ok: boolean, quoi: string, detail = ""): void {
  if (!ok) echecs += 1;
  resultats.push(`${ok ? "✓" : "✗"} ${quoi}${detail ? ` — ${detail}` : ""}`);
}

async function verifier(client: pg.Client, nom: string, attendu: string[], quoi: string): Promise<void> {
  const lignes = LIGNES.parse((await client.query(lire(nom))).rows);
  const obtenu = lignes.length === 1 ? Object.values(lignes[0]!).map(String) : [`${lignes.length} lignes`];
  const ok = obtenu.join(" | ") === attendu.join(" | ");
  noter(ok, quoi, `${nom} : ${obtenu.join(" | ")}${ok ? "" : ` (attendu ${attendu.join(" | ")})`}`);
}

/** Contrôle préalable (docs/avant-0025-0026-controle.sql) : « prêt » attendu, et, avant 0025, les listes d'origine. */
async function controle(client: pg.Client, pretAttendu: boolean, listes: boolean, quoi: string): Promise<void> {
  const lignes = LIGNES.parse((await client.query(lire("avant-0025-0026-controle.sql"))).rows);
  const ligne = lignes.length === 1 ? CONTROLE.parse(lignes[0]) : null;
  const listesOk = !listes || (ligne?.liste_decisions_actuelle === LISTE_DECISIONS && ligne.liste_motifs_actuelle === LISTE_MOTIFS);
  const ok = ligne !== null && ligne.pret_pour_les_migrations === pretAttendu && listesOk;
  noter(ok, quoi, `pret_pour_les_migrations : ${String(ligne?.pret_pour_les_migrations)}${listes ? `, listes d'origine : ${listesOk ? "oui" : "NON"}` : ""}`);
}

/** Exécute `sql` dans un point de sauvegarde annulé ; vrai s'il échoue avec `motif`. */
async function echoue(client: pg.Client, sql: string, motif: RegExp): Promise<string | null> {
  await client.query("savepoint essai");
  try {
    await client.query(sql);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return motif.test(message) ? message : `erreur inattendue : ${message}`;
  } finally {
    await client.query("rollback to savepoint essai");
  }
}

async function essais(client: pg.Client): Promise<void> {
  const m25 = corps("0025-migration.sql");
  const m26 = corps("0026-migration.sql");
  const r25 = corps("0025-retour.sql");
  const r26 = corps("0026-retour.sql");

  await verifier(client, "0025-verification.sql", APRES_0025, "état de départ : 0025 appliquée");
  await verifier(client, "0026-verification.sql", APRES_0026, "état de départ : 0026 appliquée");
  await controle(client, false, false, "contrôle préalable : voit que les migrations sont déjà là");

  for (let fois = 1; fois <= 2; fois += 1) {
    await client.query(m25);
    await client.query(m26);
  }
  await verifier(client, "0025-verification.sql", APRES_0025, "0025 rejouée deux fois sans erreur");
  await verifier(client, "0026-verification.sql", APRES_0026, "0026 rejouée deux fois sans erreur");

  // Une image retirée bloque le retour de 0026, sans rien changer.
  await client.query("savepoint image_retiree");
  await client.query(
    "insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason) values (null, 'remove_image', 'post', gen_random_uuid(), null, 'image_rights')"
  );
  const refus = await echoue(client, r26, /Retour en arrière refusé/);
  noter(refus !== null && !refus.startsWith("erreur inattendue"), "retour de 0026 refusé quand une image a été retirée", refus ?? "aucun refus");
  await client.query("rollback to savepoint image_retiree");
  await verifier(client, "0026-verification.sql", APRES_0026, "après ce refus, rien n'a changé");

  await client.query(r26);
  await verifier(client, "0026-retour-verification.sql", AVANT_0026, "retour de 0026 : l'état d'avant 0026");
  await client.query(r26);
  await verifier(client, "0026-retour-verification.sql", AVANT_0026, "retour de 0026 rejoué sans erreur");
  await verifier(client, "0025-verification.sql", APRES_0025, "0025 intacte après le retour de 0026");

  // 0025 réussie, 0026 en échec : rien de 0026 ne reste.
  const panne = await echoue(client, `${m26}\nselect 1 / 0;`, /division by zero/);
  noter(panne !== null && !panne.startsWith("erreur inattendue"), "0026 en échec (panne provoquée à la fin)", panne ?? "aucune panne");
  await verifier(client, "0026-retour-verification.sql", AVANT_0026, "après l'échec de 0026 : rien de 0026 ne reste");
  await verifier(client, "0025-verification.sql", APRES_0025, "après l'échec de 0026 : 0025 intacte");

  await client.query(m26);
  await verifier(client, "0026-verification.sql", APRES_0026, "0026 de nouveau appliquée après son retour");

  await client.query(r26);
  await client.query(r25);
  await verifier(client, "0025-retour-verification.sql", AVANT_0025, "retour de 0025 : l'état d'avant 0025");
  await controle(client, true, true, "contrôle préalable avant 0025 : prêt, listes d'origine");
  await client.query(r25);
  await verifier(client, "0025-retour-verification.sql", AVANT_0025, "retour de 0025 rejoué sans erreur");
  await client.query(m25);
  await client.query(m26);
  await verifier(client, "0025-verification.sql", APRES_0025, "0025 de nouveau appliquée après son retour");
  await verifier(client, "0026-verification.sql", APRES_0026, "0026 de nouveau appliquée ensuite");
}

async function main() {
  const url = process.env[DEV_DATABASE_ENV];
  const parsed = assertDevDatabaseUrl(url); // refuse tout ce qui n'est pas spotto-dev
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  await client.connect();
  console.log(`Base visée : ${describeDevDatabase(parsed)} — tout dans une transaction annulée à la fin.`);
  try {
    await client.query("begin");
    await essais(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(resultats.join("\n"));
  console.log(echecs === 0 ? "Tous les essais sont conformes. spotto-dev n'a pas été modifié (transaction annulée)." : `${echecs} essai(s) non conforme(s).`);
  if (echecs > 0) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erreur : ${message.replace(/postgres(ql)?:\/\/\S+/g, "[adresse masquée]")}`);
  process.exit(1);
});
