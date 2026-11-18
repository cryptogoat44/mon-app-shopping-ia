import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Publications enregistrées (lot « vie sociale », migration 0048) : ce que le
// FICHIER de la migration doit garantir, vérifié sans base. Son comportement
// (garde, rejouable, une ligne par membre et par publication, la collection
// d'un autre membre refusée, collection supprimée → « sans collection »,
// cascades, table fermée au public, retour en arrière, variante sans
// PostgreSQL 15, vérification « faux » sans erreur avant la migration) a été
// essayé sur une base Postgres locale et jetable (jamais Supabase), puis le
// sera sur spotto-dev-2 par publicationsEnregistreesBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0048_publications_enregistrees.sql"), "utf8");
const SQL_0033 = readFileSync(join(__dirname, "../supabase/migrations/0033_collections.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0048-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
const TABLE = STATEMENTS.slice(STATEMENTS.indexOf("create table if not exists saved_posts ("), STATEMENTS.indexOf("\n);", STATEMENTS.indexOf("create table if not exists saved_posts (")));

describe("0048 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0048 \(lot « vie sociale », 2026-11-18\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique", "Aucun déclencheur", "APRÈS 0033", "PostgreSQL 15"]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0033, avant de créer quoi que ce soit", () => {
    expect(SQL_0033).toContain("create table if not exists collections (");
    // La clé (id, user_id) des collections, sur laquelle s'appuie la règle « même membre ».
    expect(SQL_0033).toMatch(/create table if not exists collections \([\s\S]*unique \(id, user_id\)/);
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if to_regclass\('public\.collections'\) is null then\s*raise exception '0048 demande la migration 0033 \(collections\) : appliquez-la d''abord/
    );
    // Indépendante de 0045, 0046 et 0047 : elle ne nomme aucune de leurs tables ou colonnes.
    expect(STATEMENTS).not.toMatch(/is_private|follow_requests|mentions_from|post_media|post_people_tags|notifications/);
  });

  it("rejouable : table et index « if not exists », contrainte posée une seule fois (par son nom)", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*create (unique )?index/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS.match(/create table/g)).toHaveLength(1);
    expect(STATEMENTS.match(/create table if not exists/g)).toHaveLength(1);
    expect(STATEMENTS).toMatch(/if not exists \(\s*select 1 from pg_constraint\s*where conrelid = to_regclass\('public\.saved_posts'\) and conname = 'saved_posts_collection_fkey'\s*\) then/);
    expect(STATEMENTS.match(/add constraint saved_posts_collection_fkey/g)).toHaveLength(2);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée, n'ajoute ni déclencheur ni fonction", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer/i);
  });
});

describe("0048 : ce qu'elle ajoute", () => {
  it("une ligne par membre et par publication, effacée avec la publication ou le compte ; rien de la publication n'est recopié", () => {
    expect(TABLE).toContain("user_id uuid not null references profiles(id) on delete cascade");
    expect(TABLE).toContain("post_id uuid not null references posts(id) on delete cascade");
    expect(TABLE).toContain("collection_id uuid,");
    expect(TABLE).toContain("created_at timestamptz not null default now()");
    expect(TABLE).toContain("primary key (user_id, post_id)");
    // Ni légende, ni image, ni auteur : relus à chaque lecture.
    expect(TABLE).not.toMatch(/caption|media|author|privacy/);
    expect(TABLE.split("\n").filter((line) => /^\s+[a-z_]+ (uuid|timestamptz|text)/.test(line))).toHaveLength(4);
    expect(STATEMENTS).toContain("create index if not exists saved_posts_list_idx on saved_posts (user_id, created_at desc);");
    expect(STATEMENTS).toContain("create index if not exists saved_posts_post_idx on saved_posts (post_id);");
    expect(STATEMENTS).toContain("create index if not exists saved_posts_collection_idx on saved_posts (collection_id) where collection_id is not null;");
  });

  it("la collection est celle du même membre (PostgreSQL 15 et plus) ; supprimée, la publication reste « sans collection »", () => {
    expect(STATEMENTS).toContain("if current_setting('server_version_num')::integer >= 150000 then");
    expect(STATEMENTS).toContain("'foreign key (collection_id, user_id) references collections (id, user_id) on delete set null (collection_id)'");
    // Base plus ancienne : la clé simple, même effet à la suppression (le serveur vérifie « même membre »).
    expect(STATEMENTS).toContain("'foreign key (collection_id) references collections (id) on delete set null'");
    // Jamais « on delete cascade » sur la collection : la publication enregistrée ne part pas avec elle.
    expect(STATEMENTS).not.toMatch(/references collections[^;]*on delete cascade/);
  });

  it("la table est réservée au serveur : RLS active, aucune politique, aucun droit pour les visiteurs ni les comptes connectés", () => {
    expect(STATEMENTS).not.toMatch(/create policy/i);
    expect(STATEMENTS).toContain("alter table saved_posts enable row level security;");
    expect(STATEMENTS).toContain("revoke all on table saved_posts from public, anon, authenticated;");
    expect(STATEMENTS).toContain("grant select, insert, update, delete on table saved_posts to service_role;");
  });
});

describe("0048 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire la table, et elle seule", () => {
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual(["--   drop table if exists saved_posts;"]);
  });

  it("la vérification est en lecture seule, rend quatre colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    // Hors des textes entre apostrophes (noms de droits : 'insert', 'delete').
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["enregistrees", "collection_du_meme_membre", "protegee", "fermee_au_public"];
    expect(statements.match(/\bas [a-z_]+[,;]/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    // Une table absente n'est jamais nommée par « ::regclass » (erreur) : to_regclass rend vide.
    expect(statements).not.toContain("::regclass");
    expect(statements).toContain("case when to_regclass('public.saved_posts') is null then false else");
    // Ni confdelsetcols (absente avant PostgreSQL 15) : la vérification marche partout.
    expect(statements).not.toContain("confdelsetcols");
    expect(VERIFICATION).toContain("false | false | false | false");
  });

  it("le registre cite 0048 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0048 \| Publications enregistrées[^|]*\| \*\*à appliquer\*\* \(après 0033/);
    expect(REGISTRY).toContain("`supabase/verifications/0048-verification.sql` (une ligne, quatre `true`");
    expect(REGISTRY).toContain("Sans 0048, personne ne peut enregistrer de publication");
    // Les lignes du tableau restent dans l'ordre des numéros.
    expect(REGISTRY.indexOf("| 0047 | Plusieurs photos")).toBeLessThan(REGISTRY.indexOf("| 0048 | Publications enregistrées"));
  });
});
