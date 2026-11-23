import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// La page look (migration 0057) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son passage (refus sans 0023, deux fois de
// suite, règles de la table, rôles anon / authenticated refusés, arrêt
// d'urgence et reprise, cascades avec la recherche et le compte, retour en
// arrière) a été essayé sur une base Postgres locale et jetable, jamais
// Supabase. Le serveur, avec et sans elle : looks.test.ts ; sur la vraie base
// de développement : pageLookBase.test.ts (sur le Mac).

const SUPABASE = join(__dirname, "../supabase");
const SQL = readFileSync(join(SUPABASE, "migrations/0057_page_look.sql"), "utf8");
const VERIFICATION = readFileSync(join(SUPABASE, "verifications/0057-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(SUPABASE, "REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires ni ses lignes vides. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("--"))
    .join("\n");
}
const prose = (sql: string) => sql.replace(/\n--\s*/g, " ").replace(/\s+/g, " ");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const STATEMENTS = statements(SQL);
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));

describe("en-tête de 0057", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, ce qu'elle demande, et le retour en arrière d'abord", () => {
    expect(HEADER).toMatch(/^-- 0057 \(lot « page look », décisions du fondateur du 23 novembre 2026\)/);
    for (const words of [
      "AUCUNE fonction ni table n'est ouverte à la clé publique",
      "Retour en arrière",
      "drop table if exists shared_looks;",
      "Arrêt d'urgence de toutes les pages, sans rien perdre",
      "revoke select on table shared_looks from service_role;",
      "grant select on table shared_looks to service_role;",
      "Facultative pour le serveur",
      "le bouton reste « Partager » comme aujourd'hui",
      "À appliquer APRÈS 0001 et 0023",
      "Rejouable sans effet",
      "spotto-dev-2",
      "ne supprime ni ne modifie aucune donnée existante",
    ]) {
      expect(prose(HEADER), words).toContain(words);
    }
    expect(SQL.indexOf("-- Retour en arrière")).toBeLessThan(SQL.indexOf("-- Ce qu'elle ajoute :"));
  });
});

describe("garde : les migrations précédentes requises", () => {
  it("refusé sans 0001 (profils, recherches, propositions) ni 0023 (suspensions) ; la garde passe avant toute création", () => {
    for (const table of ["profiles", "product_searches", "product_matches", "suspensions"]) expect(STATEMENTS).toContain(`to_regclass('public.${table}') is null`);
    expect(STATEMENTS.indexOf("raise exception")).toBeLessThan(STATEMENTS.indexOf("create table"));
  });
});

describe("shared_looks", () => {
  const table = flat(STATEMENTS.slice(STATEMENTS.indexOf("create table if not exists shared_looks"), STATEMENTS.indexOf(");", STATEMENTS.indexOf("create table if not exists shared_looks")) + 2));

  it("une page par membre et par pièce, supprimée avec le compte et avec la recherche ; un jeton de 22 signes ; 16 Ko au plus ; 31 jours au plus", () => {
    expect(table).toContain("user_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("search_id uuid not null references product_searches(id) on delete cascade");
    expect(table).toContain("match_id uuid not null references product_matches(id) on delete cascade");
    expect(table).toContain("token text not null unique check (token ~ '^[A-Za-z0-9_-]{22}$')");
    expect(table).toContain("jsonb_typeof(content) = 'object' and pg_column_size(content) <= 16384");
    expect(table).toContain("expires_at > created_at and expires_at <= created_at + interval '31 days'");
    expect(STATEMENTS).toContain("create unique index if not exists shared_looks_user_match on shared_looks (user_id, match_id);");
  });

  it("la copie de l'image : un nom aléatoire du dossier looks/, jamais le dossier du membre (son identifiant)", () => {
    expect(table).toContain("image_path ~ '^looks/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$'");
    expect(table).not.toContain("user_id::text");
  });

  it("refusé : fermée à la clé publique et aux membres connectés (RLS sans politique, droits retirés) ; permis : le serveur seul", () => {
    expect(STATEMENTS).toContain("alter table shared_looks enable row level security;");
    expect(STATEMENTS).toContain("revoke all on table shared_looks from public, anon, authenticated;");
    expect(STATEMENTS).toContain("grant select, insert, update, delete on table shared_looks to service_role;");
    expect(STATEMENTS).not.toMatch(/create policy/i);
  });

  it("refusé : aucune fonction, aucune vue, aucun droit d'exécution donné à anon (décision du fondateur n° 4)", () => {
    expect(STATEMENTS).not.toMatch(/create (or replace )?(function|view)/i);
    expect(STATEMENTS).not.toMatch(/grant[^;]*\banon\b/i);
    expect(STATEMENTS).not.toMatch(/security definer/i);
    expect(STATEMENTS).not.toContain("look_public");
  });

  it("rejouable : rien qui n'ait son « if not exists »", () => {
    for (const line of STATEMENTS.split("\n").filter((line) => /^create /.test(line))) expect(line).toMatch(/if not exists/);
  });
});

describe("autour de la migration", () => {
  it("vérification : une ligne, six colonnes, lecture seule, dont « aucune fonction » et les deux rôles publics fermés", () => {
    const query = statements(VERIFICATION);
    expect(query.startsWith("select")).toBe(true);
    expect(query).not.toMatch(/(insert into|update \w+ set|delete from|^\s*(create|drop|alter|grant|revoke)\b)/im);
    expect(query.split(";").filter((part) => part.trim() !== "")).toHaveLength(1);
    for (const column of ["table_presente", "rls", "visiteur_ferme", "membre_ferme", "aucune_fonction", "une_page_par_piece"]) expect(query).toContain(`as ${column}`);
  });

  it("registre : 0057 à appliquer, sa vérification, et la phrase « Sans 0057 »", () => {
    expect(REGISTRY).toMatch(/\| 0057 \| Page look :[^\n]*\*\*à appliquer\*\*/);
    expect(REGISTRY).toContain("| 0057 | le fichier de la migration lui-même | `supabase/verifications/0057-verification.sql` (une ligne, six `true`)");
    expect(REGISTRY).toContain("Sans 0057, aucune page look n'est créée");
  });
});
