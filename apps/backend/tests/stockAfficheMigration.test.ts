import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Stock affiché (migration 0056) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son passage (refus clair sans la table des
// propositions, deux fois de suite, ligne d'avant laissée vide, oui et non
// acceptés, retour en arrière puis de nouveau ; vérification « false | false »
// sans erreur avant la migration, « true | true » après) a été essayé sur une
// base PostgreSQL 16 locale et jetable (jamais Supabase). Sur la vraie base de
// développement : stockAfficheBase.test.ts (sur le Mac, sauté sans 0056).

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0056_stock_affiche.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0056-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le texte sans ses commentaires. */
const statements = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
const STATEMENTS = statements(SQL);

describe("0056 : le stock dit par Google sur la ligne de la proposition, rien d'autre", () => {
  it("permis : une colonne oui / non / vide sur les propositions, rejouable, gardée par la présence de 0001, puis le rechargement du schéma ; l'en-tête dit pourquoi, et ce que fait le serveur sans elle", () => {
    expect(SQL).toMatch(/^-- 0056 \(lot « stock visible », 2026-11-22\)\. Aucune donnée personnelle de plus\./);
    for (const words of ["au moment de la recherche", "Facultative pour le serveur", "lib/stockColumn.ts", "spotto-dev-2", "Rejouable sans effet", "Retour en arrière"]) {
      expect(SQL, words).toContain(words);
    }
    expect(STATEMENTS).toContain("if to_regclass('public.product_matches') is null then");
    expect(STATEMENTS).toContain("raise exception '0056 demande la migration 0001");
    expect(STATEMENTS.match(/^alter table .+$/gm)).toEqual(["alter table product_matches"]);
    expect(STATEMENTS).toContain("add column if not exists in_stock boolean;");
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("refusé : aucune donnée supprimée ni modifiée, aucune autre table, ni adresse, ni heure, ni membre rangés, aucune valeur d'office ; le retour en arrière ne retire que la colonne", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function|table|policy)|create (unique )?index|security definer|^\s*(grant|revoke)\b|\bdefault\b|\bnot null\b/im);
    expect(STATEMENTS).not.toMatch(/\b(varchar|timestamptz|user_id|url)\b/i);
    expect(SQL.slice(SQL.indexOf("-- Retour en arrière")).match(/^--   .+$/gm)).toEqual(["--   alter table product_matches drop column if exists in_stock;"]);
  });
});

describe("0056 : vérification et registre", () => {
  it("la vérification est en lecture seule et rend deux colonnes, chacune expliquée", () => {
    const body = statements(VERIFICATION);
    expect(body.trimStart().startsWith("select")).toBe(true);
    expect(body.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i);
    expect(body.match(/\bas [a-z_]+[,;]?/g)).toEqual(["as colonne,", "as vide_par_defaut;"]);
    for (const column of ["colonne", "vide_par_defaut"]) expect(VERIFICATION).toContain(`--   ${column} = true`);
    expect(VERIFICATION).toContain("Résultat attendu : une seule ligne, true | true");
  });

  it("le registre a sa ligne « appliquée en production », ses fichiers, et ce que fait le serveur sans elle ; jamais avant 0054", () => {
    expect(REGISTRY).toMatch(/\| 0056 \| Stock affiché : [^\n]*\| appliquée en production \(ne demande que 0001 ; le fichier de la migration, après une copie de secours complète ; vérification juste, [a-z]+ `true`\) \| 24 nov\. 2026 \|/);
    // Appliquée en production le 24 novembre 2026 : plus jamais « à appliquer ».
    expect(REGISTRY).not.toMatch(/\| 0056 \| [^\n]*\*\*à appliquer\*\*/);
    expect(REGISTRY).toContain("| 0056 | le fichier de la migration lui-même | `supabase/verifications/0056-verification.sql` (une ligne, deux `true`) | en tête du fichier de la migration |");
    expect(REGISTRY).toContain("Sans 0056, aucune carte ne montre « En stock » ni « Épuisée », et « En stock seulement » ne retire rien (sonde du schéma, lib/stockColumn.ts).");
    const line = REGISTRY.split("\n").find((text) => text.startsWith("| 0056 | Stock affiché"))!;
    for (const words of ["**Facultative**", "le serveur marche sans elle", "Pour les membres, avant elle : aucune carte ne montre de stock", "Après elle :", "les recherches d'avant ne changent pas"]) {
      expect(line, words).toContain(words);
    }
    expect(REGISTRY.indexOf("| 0056 | Stock affiché")).toBeGreaterThan(REGISTRY.indexOf("| 0054 | Ordre des boutiques"));
  });
});
