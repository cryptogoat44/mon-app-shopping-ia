import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MENTIONS_FROM, MENTIONS_FROM, NOTIFICATION_TYPES } from "@monapp/shared-types";

// Commentaires : réponses, « j'aime », mentions (lot « vie sociale »,
// migration 0046) : ce que le FICHIER de la migration doit garantir, vérifié
// sans base. Son comportement (garde, rejouable, un « j'aime » et une mention
// par membre et par commentaire, jamais soi-même, cascades, tables fermées au
// public, retour en arrière) a été essayé sur une base Postgres locale et
// jetable (jamais Supabase), puis le sera sur spotto-dev-2 par
// commentairesBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0046_commentaires_reponses.sql"), "utf8");
const SQL_0045 = readFileSync(join(__dirname, "../supabase/migrations/0045_compte_prive.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0046-verification.sql"), "utf8");
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

describe("0046 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0046 \(lot « vie sociale », 2026-11-18\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique", "Aucun déclencheur", "APRÈS 0045"]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0045, avant de créer ou de modifier quoi que ce soit", () => {
    expect(SQL_0045).toContain("create table if not exists follow_requests (");
    expect(STATEMENTS.trimStart()).toMatch(/^do \$\$\s*begin\s*if to_regclass\('public\.follow_requests'\) is null then\s*raise exception '0046 demande la migration 0045 \(compte privé\) : appliquez-la d''abord/);
    // 0045 porte déjà les deux types de notification : 0046 ne touche pas à cette règle.
    expect(SQL_0045).toMatch(/'reply', 'mention'/);
    expect(STATEMENTS).not.toContain("notifications");
    expect(NOTIFICATION_TYPES).toContain("reply");
    expect(NOTIFICATION_TYPES).toContain("mention");
  });

  it("rejouable : colonnes, tables et index « if not exists », règle retirée « if exists » avant d'être reposée", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*alter table .* add column/.test(text))) expect(line).toContain("add column if not exists");
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*create (unique )?index/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS.match(/create table/g)).toHaveLength(2);
    expect(STATEMENTS.match(/create table if not exists/g)).toHaveLength(2);
    expect(STATEMENTS).toMatch(/alter table profiles drop constraint if exists profiles_mentions_from_check;\s*alter table profiles add constraint profiles_mentions_from_check/);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée, n'ajoute ni déclencheur ni fonction", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer/i);
  });
});

describe("0046 : ce qu'elle ajoute", () => {
  it("une réponse désigne son commentaire et disparaît avec lui ; un commentaire existant reste un commentaire ordinaire", () => {
    expect(STATEMENTS).toContain("alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;");
    // Facultative, sans valeur par défaut : rien ne devient une réponse.
    expect(STATEMENTS).not.toMatch(/parent_id uuid not null/);
    expect(STATEMENTS).toContain("create index if not exists comments_parent_idx on comments (parent_id, created_at) where parent_id is not null;");
  });

  it("un « j'aime » par membre et par commentaire, effacé avec le commentaire ou avec le compte", () => {
    const table = tableSql("comment_reactions");
    expect(table).toContain("comment_id uuid not null references comments(id) on delete cascade");
    expect(table).toContain("user_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("primary key (comment_id, user_id)");
  });

  it("une mention par membre et par commentaire, jamais soi-même, pseudo en minuscules, effacée avec le commentaire ou l'un des deux comptes", () => {
    const table = tableSql("comment_mentions");
    expect(table).toContain("comment_id uuid not null references comments(id) on delete cascade");
    expect(table).toContain("user_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("author_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("handle text not null check (handle ~ '^[a-z0-9_]{3,20}$')");
    expect(table).toContain("primary key (comment_id, user_id)");
    expect(table).toContain("check (user_id <> author_id)");
    // Un blocage retire les mentions entre deux comptes : l'index qui sert cette suppression.
    expect(STATEMENTS).toContain("create index if not exists comment_mentions_author_idx on comment_mentions (author_id, user_id);");
    expect(STATEMENTS).toContain("create index if not exists comment_mentions_user_idx on comment_mentions (user_id);");
  });

  it("les deux tables sont réservées au serveur : RLS active, aucune politique, aucun droit pour les visiteurs ni les comptes connectés", () => {
    expect(STATEMENTS).not.toMatch(/create policy/i);
    for (const table of ["comment_reactions", "comment_mentions"]) {
      expect(STATEMENTS, table).toContain(`alter table ${table} enable row level security;`);
      expect(STATEMENTS, table).toContain(`revoke all on table ${table} from public, anon, authenticated;`);
      expect(STATEMENTS, table).toContain(`grant select, insert, update, delete on table ${table} to service_role;`);
    }
  });

  it("« Qui peut me mentionner » : un nouveau profil, comme un profil existant, démarre à « les comptes que je suis »", () => {
    expect(DEFAULT_MENTIONS_FROM).toBe("following");
    expect(STATEMENTS).toContain(`alter table profiles add column if not exists mentions_from text not null default '${DEFAULT_MENTIONS_FROM}';`);
    const allowed = /check \(mentions_from in \(([^)]*)\)\)/.exec(STATEMENTS)?.[1] ?? "";
    expect([...allowed.matchAll(/'([a-z]+)'/g)].map((match) => match[1]).sort()).toEqual([...MENTIONS_FROM].sort());
  });
});

describe("0046 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire les deux tables, la colonne des réponses et le réglage", () => {
    for (const line of [
      "drop table if exists comment_mentions;",
      "drop table if exists comment_reactions;",
      "alter table comments drop column if exists parent_id;",
      "alter table profiles drop constraint if exists profiles_mentions_from_check;",
      "alter table profiles drop column if exists mentions_from;",
    ]) {
      expect(ROLLBACK, line).toContain(line);
    }
  });

  it("la vérification est en lecture seule et rend sept colonnes", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    // Hors des textes entre apostrophes (noms de droits : 'insert', 'delete').
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["reponses", "aucune_reponse_creee", "jaime", "mentions", "protegees", "fermees_au_public", "reglage"];
    expect(statements.match(/\bas [a-z_]+[,;]/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
  });

  it("le registre cite 0046 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0046 \| Commentaires, suite[^|]*\| \*\*à appliquer\*\* \(après 0045/);
    expect(REGISTRY).toContain("`supabase/verifications/0046-verification.sql` (une ligne, sept `true`)");
    expect(REGISTRY).toContain("Sans 0046, les commentaires restent à plat comme avant");
  });
});
