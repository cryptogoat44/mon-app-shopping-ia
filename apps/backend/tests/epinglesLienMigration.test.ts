import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Épingles et lien en bio (lot « vie sociale », migration 0049) : ce que le
// FICHIER de la migration doit garantir, vérifié sans base. Son comportement
// (garde sans 0026, rejouable, contrainte du lien : http, espace, tabulation,
// 201 caractères refusés, 200 acceptés, vide accepté ; retour en arrière puis
// de nouveau ; vérification « faux » sans erreur avant la migration) a été
// essayé sur une base PostgreSQL 16 locale et jetable (jamais Supabase), puis
// le sera sur spotto-dev-2 par epinglesLienBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0049_epingles_et_lien.sql"), "utf8");
const SQL_0026 = readFileSync(join(__dirname, "../supabase/migrations/0026_retrait_image_copiee.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0049-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

describe("0049 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0049 \(lot « vie sociale », 2026-11-19\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active", "Aucun déclencheur", "lib/profileExtras.ts", "3 plus récentes"]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0026 (déjà en production), avant de changer quoi que ce soit", () => {
    expect(SQL_0026).toContain("alter table posts add column if not exists media_removed_at timestamptz;");
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if not exists \(\s*select 1 from information_schema\.columns\s*where table_schema = 'public' and table_name = 'posts' and column_name = 'media_removed_at'\s*\) then\s*raise exception '0049 demande la migration 0026/
    );
    // Indépendante de 0045 à 0048 : elle ne nomme aucune de leurs tables ou colonnes.
    expect(STATEMENTS).not.toMatch(/is_private|follow_requests|mentions_from|post_media|post_people_tags|saved_posts|notifications/);
  });

  it("rejouable : colonnes et index « if not exists », contrainte remplacée par son nom", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*(create (unique )?index|alter table \w+ add column)/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS).toContain("alter table profiles drop constraint if exists profiles_link_url_check;");
    expect(STATEMENTS.indexOf("drop constraint if exists profiles_link_url_check")).toBeLessThan(STATEMENTS.indexOf("add constraint profiles_link_url_check"));
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée, n'ajoute ni table, ni déclencheur, ni fonction, ni droit", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer|create table|create policy|\bgrant\b|\brevoke\b/i);
  });
});

describe("0049 : ce qu'elle ajoute", () => {
  it("une date d'épingle, vide par défaut, et l'index des seules publications épinglées", () => {
    expect(STATEMENTS).toContain("alter table posts add column if not exists pinned_at timestamptz;");
    expect(STATEMENTS).toContain("create index if not exists posts_pinned_idx on posts (user_id, pinned_at desc) where pinned_at is not null;");
    // La limite de 3 est tenue par le serveur, pas par la base.
    expect(STATEMENTS).not.toMatch(/count\(|pinned_at is not null\)\s*<=/);
  });

  it("le lien : un texte vide par défaut ; la base refuse ce qui ne commence pas par https://, un espace, plus de 200 caractères", () => {
    expect(STATEMENTS).toContain("alter table profiles add column if not exists link_url text;");
    expect(STATEMENTS).toContain(
      "check (link_url is null or (char_length(link_url) <= 200 and link_url ~ '^https://[^[:space:]]+$'));"
    );
  });
});

describe("0049 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire l'index, les deux colonnes et la contrainte, et rien d'autre", () => {
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual([
      "--   drop index if exists posts_pinned_idx;",
      "--   alter table posts drop column if exists pinned_at;",
      "--   alter table profiles drop constraint if exists profiles_link_url_check;",
      "--   alter table profiles drop column if exists link_url;",
    ]);
  });

  it("la vérification est en lecture seule, rend cinq colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["epingles", "aucune_epingle", "lien", "lien_controle", "protegees"];
    expect(statements.match(/\bas [a-z_]+[,;]/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    // Une colonne absente n'est jamais lue directement : to_jsonb, après un test d'existence.
    expect(statements).toContain("(to_jsonb(posts) ->> 'pinned_at') is not null");
    expect(statements).not.toMatch(/where pinned_at|posts\.pinned_at|select link_url/);
    expect(VERIFICATION).toContain("false | false | false | false | true");
  });

  it("le registre cite 0049 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0049 \| Épingles et lien en bio[^|]*\| \*\*à appliquer\*\* \(après 0026/);
    expect(REGISTRY).toContain("`supabase/verifications/0049-verification.sql` (une ligne, cinq `true`");
    expect(REGISTRY).toContain("Sans 0049, personne ne peut épingler de publication ni afficher de lien sur son profil");
    expect(REGISTRY.indexOf("| 0048 | Publications enregistrées")).toBeLessThan(REGISTRY.indexOf("| 0049 | Épingles et lien en bio"));
    expect(REGISTRY).toContain("État au 19 novembre 2026.");
  });
});
