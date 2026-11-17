import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Confirmations de lecture (lot « messages vus ») : ce que le FICHIER de la
// migration 0043 doit garantir, vérifié sans base. Son passage (refus sans
// 0032, deux fois de suite, vérification, retour en arrière) a été essayé sur
// une base Postgres locale et jetable, jamais Supabase. Le comportement du
// serveur, avec et sans elle : confirmationsLecture.test.ts.

const SUPABASE = join(__dirname, "../supabase");
const SQL = readFileSync(join(SUPABASE, "migrations/0043_confirmations_lecture.sql"), "utf8");
const VERIFICATION = readFileSync(join(SUPABASE, "verifications/0043-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(SUPABASE, "REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires ni ses lignes vides. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("--"))
    .join("\n");
}
/** Les commentaires remis en une seule phrase (sans retours à la ligne). */
function prose(sql: string): string {
  return sql.replace(/\n--\s*/g, " ").replace(/\s+/g, " ");
}

const STATEMENTS = statements(SQL);
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

describe("en-tête de 0043", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0043 \(lot « messages vus », 2026-11-17\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique"]) {
      expect(prose(HEADER), words).toContain(words);
    }
    expect(prose(HEADER)).toContain("ne supprime ni ne modifie aucune donnée existante");
  });

  it("dit les règles du réglage : allumé par défaut, réciproque, jamais pour une invitation", () => {
    const words = prose(HEADER);
    expect(words).toContain("allumé par défaut (true)");
    expect(words).toContain("réciproque : il suffit que l'un des deux l'ait éteint");
    expect(words).toContain("jamais pour une invitation en attente ou refusée, ni pour une lecture faite avant que l'invitation soit acceptée");
    // Sans elle, personne n'est exposé : rien n'est montré, et le réglage n'est pas proposé.
    expect(words).toContain("sans elle, personne ne voit « Vu » ni « Envoyé », et l'app ne propose pas le réglage");
    expect(words).toContain("personne n'est exposé avant de pouvoir refuser");
  });

  it("le retour en arrière est en tête, et ne retire que la colonne du réglage", () => {
    expect(SQL.indexOf("-- Retour en arrière")).toBeGreaterThan(0);
    expect(SQL.indexOf("-- Retour en arrière")).toBeLessThan(SQL.indexOf("do $$"));
    const commands = ROLLBACK.split("\n").filter((line) => line.startsWith("--   "));
    expect(commands).toEqual(["--   alter table profiles drop column if exists read_receipts;"]);
    expect(prose(ROLLBACK)).toContain("le serveur actuel fonctionne sans 0043");
    expect(prose(ROLLBACK)).toContain("le choix de chaque membre est alors perdu");
  });
});

describe("ce que 0043 exécute", () => {
  it("refuse de s'appliquer sans les messages privés (0032), avant de modifier quoi que ce soit", () => {
    expect(STATEMENTS).toMatch(/^do \$\$\nbegin\n  if to_regclass\('public\.conversation_participants'\) is null then\n    raise exception '0043 demande la migration 0032 \(messages privés\) : appliquez-la d''abord\.';\n  end if;\nend;\n\$\$;\n/);
  });

  it("une seule colonne, sur profiles : oui ou non, jamais vide, allumée par défaut ; rien d'autre", () => {
    const afterGuard = STATEMENTS.slice(STATEMENTS.indexOf("$$;") + "$$;".length).trim();
    expect(afterGuard).toBe(["alter table profiles add column if not exists read_receipts boolean not null default true;", "notify pgrst, 'reload schema';"].join("\n"));
  });

  it("rejouable, et ne détruit ni ne modifie aucune donnée ; aucune table, règle d'accès, fonction ni déclencheur", () => {
    expect(STATEMENTS).toContain("add column if not exists");
    expect(STATEMENTS).not.toMatch(/\b(drop|truncate|delete|update|insert|grant|revoke)\b/i);
    expect(STATEMENTS).not.toMatch(/create (table|policy|function|or replace|trigger|index)|enable row level security/i);
    // Aucune date nouvelle : celle de la dernière lecture existe depuis 0032.
    expect(STATEMENTS).not.toMatch(/timestamptz|last_read_at/);
    expect(readFileSync(join(SUPABASE, "migrations/0032_messages.sql"), "utf8")).toContain("  last_read_at timestamptz,");
  });

  it("le fichier se termine par un retour à la ligne, et porte le numéro qui suit 0042", () => {
    expect(SQL.endsWith("\n")).toBe(true);
    const numbers = readdirSync(join(SUPABASE, "migrations")).map((name) => name.slice(0, 4));
    expect(numbers.filter((number) => number === "0043")).toHaveLength(1);
    expect(numbers).toContain("0042");
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("contrôle de 0043 et registre des migrations", () => {
  it("le contrôle est en lecture seule : une seule requête « select », quatre réponses", () => {
    const query = statements(VERIFICATION).trim();
    expect(query.startsWith("select")).toBe(true);
    expect(query.match(/;/g)).toHaveLength(1);
    expect(query.endsWith(";")).toBe(true);
    expect(query.replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(create|alter|drop|insert|update|delete|grant|revoke|truncate|notify|do)\b(?!_)/i);
    expect(VERIFICATION).not.toMatch(/^\s*\\/m);
    expect([...VERIFICATION.matchAll(/ as ([a-z_]+)[,;]/g)].map((match) => match[1])).toEqual(["reglage", "allume_par_defaut", "lecture_datee", "fermee_au_public"]);
    expect(VERIFICATION).toContain("Résultat attendu : une seule ligne, true | true | true | true");
  });

  it("le contrôle regarde la colonne créée, sa valeur par défaut, la date de lecture de 0032 et la RLS de profiles", () => {
    expect(VERIFICATION).toContain("table_name = 'profiles' and column_name = 'read_receipts'");
    expect(VERIFICATION).toContain("data_type = 'boolean' and is_nullable = 'NO'");
    expect(VERIFICATION).toContain("column_default = 'true'");
    expect(VERIFICATION).toContain("table_name = 'conversation_participants' and column_name = 'last_read_at'");
    expect(VERIFICATION).toContain("not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles')");
  });

  it("le registre cite 0043 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/^\| 0043 \| Confirmations de lecture des messages privés[^|]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord ; demande 0032, déjà en production\) \| — \|$/m);
    expect(REGISTRY).toContain("| 0043 | le fichier de la migration lui-même (**après 0032**) | `supabase/verifications/0043-verification.sql` (une ligne, quatre `true`) | en tête du fichier de la migration |");
    expect(REGISTRY).toContain("Sans 0043, personne ne voit « Vu » ni « Envoyé » sous ses messages, et l'app ne propose pas le réglage « Confirmations de lecture »");
    // Une seule ligne par tableau.
    expect(REGISTRY.match(/^\| 0043 \|/gm)).toHaveLength(2);
  });
});
