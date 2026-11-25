import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Épingles et lien en bio (lot « vie sociale », migration 0049) : ce que le
// FICHIER de la migration doit garantir, vérifié sans base. Son comportement
// (garde sans 0037, rejouable, contrainte du lien : http, espace, tabulation,
// 201 caractères refusés, 200 acceptés, vide accepté ; « Retirer la bio »
// qui vide aussi le lien, et qui accepte un profil avec un lien sans bio ;
// 0037 relancée après coup repérée par la vérification ; retour en arrière
// puis de nouveau ; vérification « faux » sans erreur avant la migration) a
// été essayé sur une base PostgreSQL 16 locale et jetable (jamais Supabase),
// puis le sera sur spotto-dev-2 par epinglesLienBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0049_epingles_et_lien.sql"), "utf8");
const SQL_0037 = readFileSync(join(__dirname, "../supabase/migrations/0037_moderation_profil.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0049-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
/** Le corps d'une fonction, entre ses deux « $$ ». */
const body = (sql: string) => {
  const start = sql.indexOf("as $$", sql.indexOf("create or replace function moderation_remove_profile_part("));
  return sql.slice(start, sql.indexOf("$$;", start));
};

describe("0049 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0049 \(lot « vie sociale », 2026-11-19\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active", "Aucun déclencheur", "lib/profileExtras.ts", "3 plus récentes"]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0037 (déjà en production), avant de changer quoi que ce soit", () => {
    // 0049 recrée la fonction de 0037 : sans 0037, le journal de la modération refuserait « remove_bio ».
    expect(SQL_0037).toContain("create or replace function moderation_remove_profile_part(");
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if not exists \(select 1 from pg_proc p join pg_namespace n on n\.oid = p\.pronamespace\s*where n\.nspname = 'public' and p\.proname = 'moderation_remove_profile_part'\) then\s*raise exception '0049 demande la migration 0037/
    );
    // Indépendante de 0045 à 0048 : elle ne nomme aucune de leurs tables ou colonnes.
    expect(STATEMENTS).not.toMatch(/is_private|follow_requests|mentions_from|post_media|post_people_tags|saved_posts|notifications_type_check/);
  });

  it("rejouable : colonnes et index « if not exists », contrainte remplacée par son nom", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*(create (unique )?index|alter table \w+ add column)/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS).toContain("alter table profiles drop constraint if exists profiles_link_url_check;");
    expect(STATEMENTS.indexOf("drop constraint if exists profiles_link_url_check")).toBeLessThan(STATEMENTS.indexOf("add constraint profiles_link_url_check"));
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée, n'ajoute ni table, ni déclencheur, ni droit ; une seule fonction, celle de 0037, recréée", () => {
    // Hors du corps de la fonction (qui ne s'exécute qu'à l'appel de l'administrateur) : rien n'est écrit.
    const outside = STATEMENTS.replace(body(STATEMENTS), "");
    expect(outside).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|drop function)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?trigger|security definer|create table|create policy/i);
    expect(STATEMENTS.match(/create (or replace )?function \w+/g)).toEqual(["create or replace function moderation_remove_profile_part"]);
    // Les mêmes droits qu'en 0037 : le serveur seul.
    expect(outside.match(/^(revoke|grant) .+$/gm)).toEqual([
      "revoke all on function moderation_remove_profile_part(uuid, uuid, text, text, text) from public, anon, authenticated;",
      "grant execute on function moderation_remove_profile_part(uuid, uuid, text, text, text) to service_role;",
    ]);
    expect(STATEMENTS.indexOf("grant execute")).toBeLessThan(STATEMENTS.indexOf("notify pgrst"));
  });
});

describe("0049 : ce qu'elle ajoute", () => {
  it("une date d'épingle, vide par défaut, et l'index des seules publications épinglées", () => {
    expect(STATEMENTS).toContain("alter table posts add column if not exists pinned_at timestamptz;");
    expect(STATEMENTS).toContain("create index if not exists posts_pinned_idx on posts (user_id, pinned_at desc) where pinned_at is not null;");
    // La limite de 3 est tenue par le serveur, pas par la base.
    expect(STATEMENTS).not.toMatch(/count\(|pinned_at is not null\)\s*<=/);
  });

  it("retirer la bio retire aussi le lien, dans la même transaction ; un profil qui n'a qu'un lien n'est plus « rien à retirer »", () => {
    const now = body(STATEMENTS);
    const before = body(SQL_0037);
    // Mêmes paramètres et même réponse qu'en 0037 (le serveur et sa sonde ne changent pas).
    const signature = (sql: string) => sql.slice(sql.indexOf("create or replace function moderation_remove_profile_part("), sql.indexOf("as $$", sql.indexOf("create or replace function moderation_remove_profile_part(")));
    expect(signature(STATEMENTS)).toBe(signature(SQL_0037.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n")));
    // Le rôle toujours vérifié avant tout verrou (sonde du serveur).
    expect(now.indexOf("'not_admin'")).toBeLessThan(now.indexOf("pg_advisory_xact_lock"));
    // Le lien est lu sous le même verrou de ligne que la bio.
    expect(now).toContain("select true, pr.bio, pr.link_url, pr.avatar_url into v_found, v_bio, v_link, v_avatar\n    from profiles pr where pr.id = p_user_id for update;");
    // « Rien à retirer » : ni bio ni lien.
    expect(now).toContain("if (p_part = 'bio' and (v_bio is null or btrim(v_bio) = '') and v_link is null)");
    expect(before).toContain("if (p_part = 'bio' and (v_bio is null or btrim(v_bio) = ''))");
    // Bio et lien vidés ensemble ; la photo ne touche pas au lien.
    expect(now).toContain("update profiles set bio = null, link_url = null, updated_at = now() where id = p_user_id;");
    expect(now).toContain("update profiles set avatar_url = null, updated_at = now() where id = p_user_id;");
    // Tout le reste à l'identique : journal, notification, signalements classés.
    const rest = (fn: string) => fn.slice(fn.indexOf("insert into moderation_actions"));
    expect(rest(now).replace("set bio = null, link_url = null,", "set bio = null,")).toBe(rest(before));
  });

  it("le lien : un texte vide par défaut ; la base refuse ce qui ne commence pas par https://, un espace, plus de 200 caractères", () => {
    expect(STATEMENTS).toContain("alter table profiles add column if not exists link_url text;");
    expect(STATEMENTS).toContain(
      "check (link_url is null or (char_length(link_url) <= 200 and link_url ~ '^https://[^[:space:]]+$'));"
    );
  });
});

describe("0049 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière remet d'abord la fonction de 0037, puis retire l'index, les deux colonnes et la contrainte, et rien d'autre", () => {
    expect(ROLLBACK).toContain("D'abord relancer le fichier 0037 en entier (rejouable sans effet)");
    expect(SQL_0037).toContain("Rejouable sans effet");
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual([
      "--   drop index if exists posts_pinned_idx;",
      "--   alter table posts drop column if exists pinned_at;",
      "--   alter table profiles drop constraint if exists profiles_link_url_check;",
      "--   alter table profiles drop column if exists link_url;",
    ]);
  });

  it("la vérification est en lecture seule, rend six colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["epingles", "aucune_epingle", "lien", "lien_controle", "retrait_lien", "protegees"];
    expect(statements.match(/\bas [a-z_]+[,;]/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    // Une colonne absente n'est jamais lue directement : to_jsonb, après un test d'existence.
    expect(statements).toContain("(to_jsonb(posts) ->> 'pinned_at') is not null");
    expect(statements).not.toMatch(/where pinned_at|posts\.pinned_at|select link_url/);
    expect(VERIFICATION).toContain("false | false | false | false | false |\n-- true");
    // « retrait_lien » cherche dans la fonction les lignes exactes de 0049, et la repère si 0037 a été relancée.
    for (const line of ["update profiles set bio = null, link_url = null", "and v_link is null"]) {
      expect(statements, line).toContain(`like '%${line}%'`);
      expect(STATEMENTS, line).toContain(line);
      expect(SQL_0037, line).not.toContain(line);
    }
    expect(VERIFICATION).toContain("0037 a été relancée, relancez 0049");
  });

  it("le registre cite 0049 appliquée en production le 20 novembre 2026, son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0049 \| Épingles et lien en bio[^|]*\| appliquée en production \(après 0037/);
    expect(REGISTRY).toContain("`supabase/verifications/0049-verification.sql` (une ligne, six `true`");
    expect(REGISTRY).toContain("Sans 0049, personne ne peut épingler de publication ni afficher de lien sur son profil");
    expect(REGISTRY.indexOf("| 0048 | Publications enregistrées")).toBeLessThan(REGISTRY.indexOf("| 0049 | Épingles et lien en bio"));
    // La date d'état du registre avance à chaque migration appliquée : elle doit exister, pas rester au 20 novembre.
    expect(REGISTRY).toMatch(/État au \d{1,2}(?:er)? [a-zéû]+ 2026\./);
  });
});
