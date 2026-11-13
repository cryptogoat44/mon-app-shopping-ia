import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Constaté sur spotto-dev-2 le 13 novembre 2026 : un membre qui avait spotté
// une vidéo ne pouvait plus supprimer son compte (« Database error deleting
// user »). La suppression d'un compte est faite par le système de comptes de
// Supabase (rôle supabase_auth_admin, sans droit sur les tables de l'app) ; un
// déclencheur qui s'exécute pendant cette suppression en cascade avec les
// droits de l'appelant est refusé, et toute la suppression échoue. Reproduit et
// corrigé sur une base Postgres locale jetable. Ce test garde la règle écrite
// dans les migrations : tout déclencheur qui modifie une autre table pendant
// une suppression s'exécute avec les droits de son propriétaire.

const MIGRATIONS = join(__dirname, "../supabase/migrations");
const read = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");

/** Le corps de la définition d'une fonction, de « create or replace function <nom>( » jusqu'à « as $$ ». */
function header(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function ${name}(`);
  expect(start, `définition de ${name}`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf("as $$", start));
}

describe("suppression d'un compte qui a spotté une vidéo", () => {
  it("0038 : le déclencheur du compteur s'exécute avec les droits de son propriétaire", () => {
    const definition = header(read("0038_memoire_videos.sql"), "video_spots_after_delete");
    expect(definition).toContain("security definer");
    expect(definition).toContain("set search_path = public");
  });

  it("0039 : la correction est répétée pour une base où l'ancienne 0038 est déjà appliquée", () => {
    const sql = read("0039_memoire_videos_garde_fous.sql");
    expect(sql).toContain("alter function video_spots_after_delete() security definer;");
    expect(sql).toContain("alter function video_spots_after_delete() set search_path = public;");
  });

  it("aucun autre déclencheur « after delete » n'a été ajouté sans y penser", () => {
    const triggers = ["0038_memoire_videos.sql", "0039_memoire_videos_garde_fous.sql"].flatMap((name) => read(name).match(/after delete on \w+/g) ?? []);
    expect(triggers).toEqual(["after delete on video_spots"]);
  });
});
