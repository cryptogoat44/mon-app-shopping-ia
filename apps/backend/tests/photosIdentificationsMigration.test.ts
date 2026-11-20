import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, POST_PHOTOS_MAX } from "@monapp/shared-types";

// Plusieurs photos par publication, identifier des personnes (lot « vie
// sociale », migration 0047) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son comportement (garde, rejouable, positions
// 1 à 4 et une seule par publication, jamais s'identifier soi-même, une
// identification par membre et par publication, cascades, tables fermées au
// public, retour en arrière, vérification « faux » sans erreur avant la
// migration) a été essayé sur une base Postgres locale et jetable (jamais
// Supabase), puis le sera sur spotto-dev-2 par photosIdentificationsBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0047_photos_et_identifications.sql"), "utf8");
const SQL_0045 = readFileSync(join(__dirname, "../supabase/migrations/0045_compte_prive.sql"), "utf8");
const SQL_0046 = readFileSync(join(__dirname, "../supabase/migrations/0046_commentaires_reponses.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0047-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
const tableSql = (name: string) => {
  const start = STATEMENTS.indexOf(`create table if not exists ${name} (`);
  return STATEMENTS.slice(start, STATEMENTS.indexOf("\n);", start));
};

describe("0047 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0047 \(lot « vie sociale », 2026-11-18\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique", "Aucun déclencheur", "APRÈS 0046"]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0046, avant de créer quoi que ce soit", () => {
    expect(SQL_0046).toContain("alter table profiles add column if not exists mentions_from");
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if not exists \(\s*select 1 from information_schema\.columns\s*where table_schema = 'public' and table_name = 'profiles' and column_name = 'mentions_from'\s*\) then\s*raise exception '0047 demande la migration 0046 \(commentaires, suite\) : appliquez-la d''abord/
    );
    // 0045 porte déjà le type de notification « tag » : 0047 ne touche pas à cette règle.
    expect(SQL_0045).toMatch(/'reply', 'mention', 'tag'/);
    expect(STATEMENTS).not.toContain("notifications");
    expect(NOTIFICATION_TYPES).toContain("tag");
  });

  it("rejouable : tables et index « if not exists », rien d'autre à reposer", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*create (unique )?index/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS.match(/create table/g)).toHaveLength(2);
    expect(STATEMENTS.match(/create table if not exists/g)).toHaveLength(2);
    expect(STATEMENTS).not.toMatch(/alter table \w+ add (column|constraint)/);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée, n'ajoute ni déclencheur ni fonction", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer/i);
  });
});

describe("0047 : ce qu'elle ajoute", () => {
  it("les photos 2 à 5 : positions 1 à 4, une seule par publication, effacées avec la publication ou le compte", () => {
    const table = tableSql("post_media");
    expect(POST_PHOTOS_MAX).toBe(5);
    expect(table).toContain("user_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("post_id uuid not null references posts(id) on delete cascade");
    expect(table).toContain(`position smallint not null check (position between 1 and ${POST_PHOTOS_MAX - 1})`);
    expect(table).toContain("media_url text not null");
    expect(table).toContain("media_thumb_url text not null");
    expect(table).toContain("unique (post_id, position)");
    expect(STATEMENTS).toContain("create index if not exists post_media_user_idx on post_media (user_id);");
    // La photo 1 reste dans la publication : aucune colonne de `posts` ne change.
    expect(STATEMENTS).not.toMatch(/alter table posts/);
  });

  it("une identification par membre et par publication, jamais l'auteur lui-même, effacée avec la publication ou l'un des deux comptes", () => {
    const table = tableSql("post_people_tags");
    expect(table).toContain("post_id uuid not null references posts(id) on delete cascade");
    expect(table).toContain("user_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("author_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("primary key (post_id, user_id)");
    expect(table).toContain("check (user_id <> author_id)");
    // Blocage, abonnement retiré, compte passé en privé : les index qui servent ces suppressions.
    expect(STATEMENTS).toContain("create index if not exists post_people_tags_author_idx on post_people_tags (author_id, user_id);");
    expect(STATEMENTS).toContain("create index if not exists post_people_tags_user_idx on post_people_tags (user_id);");
  });

  it("les deux tables sont réservées au serveur : RLS active, aucune politique, aucun droit pour les visiteurs ni les comptes connectés", () => {
    expect(STATEMENTS).not.toMatch(/create policy/i);
    for (const table of ["post_media", "post_people_tags"]) {
      expect(STATEMENTS, table).toContain(`alter table ${table} enable row level security;`);
      expect(STATEMENTS, table).toContain(`revoke all on table ${table} from public, anon, authenticated;`);
      expect(STATEMENTS, table).toContain(`grant select, insert, update, delete on table ${table} to service_role;`);
    }
  });
});

describe("0047 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire les deux tables, identifications d'abord", () => {
    expect(ROLLBACK).toMatch(/drop table if exists post_people_tags;\s*--\s+drop table if exists post_media;/);
  });

  it("la vérification est en lecture seule, rend cinq colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    // Hors des textes entre apostrophes (noms de droits : 'insert', 'delete').
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["photos", "identifications", "protegees", "fermees_au_public", "notification_acceptee"];
    expect(statements.match(/\bas [a-z_]+[,;]/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    // Une table absente n'est jamais nommée par « ::regclass » (erreur) : to_regclass rend vide.
    expect(statements).not.toContain("::regclass");
    expect(statements).toContain("case when to_regclass('public.post_media') is null or to_regclass('public.post_people_tags') is null then false else");
  });

  it("le registre cite 0047 appliquée en production le 20 novembre 2026, son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0047 \| Plusieurs photos par publication[^|]*\| appliquée en production \(après 0046/);
    expect(REGISTRY).toContain("`supabase/verifications/0047-verification.sql` (une ligne, cinq `true`)");
    expect(REGISTRY).toContain("Sans 0047, une publication garde une seule photo comme avant");
    // Les lignes du tableau restent dans l'ordre des numéros.
    expect(REGISTRY.indexOf("| 0046 | Commentaires, suite")).toBeLessThan(REGISTRY.indexOf("| 0047 | Plusieurs photos"));
  });
});
