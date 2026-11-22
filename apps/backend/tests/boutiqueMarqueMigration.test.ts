import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ordre des boutiques (migration 0054) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son passage (deux fois de suite, ligne d'avant
// laissée vide, « oui » et vide acceptés, « non » refusé par la base, retour
// en arrière puis de nouveau ; vérification « false | false » sans erreur
// avant la migration, « true | true » après) a été essayé sur une base
// PostgreSQL 16 locale et jetable (jamais Supabase). Sur la vraie base de
// développement (le oui écrit par le serveur, la relecture, « non » refusé) :
// boutiqueMarqueBase.test.ts (sur le Mac, sauté sans 0054).

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0054_boutique_de_la_marque.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0054-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le texte sans ses commentaires. */
const statements = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
const STATEMENTS = statements(SQL);

describe("0054 : un « oui » sur la ligne de la boutique de la marque, rien d'autre", () => {
  it("permis : une colonne oui / vide sur les propositions, rejouable, jamais « non », puis le rechargement du schéma ; l'en-tête dit pourquoi, et ce que fait le serveur sans elle", () => {
    expect(SQL).toMatch(/^-- 0054 \(lot « ordre des boutiques », 2026-11-21\)\. Aucune donnée personnelle de plus\./);
    for (const words of ["Je ne veux mettre aucune", "jamais enregistrée", "Facultative pour le serveur", "lib/brandShopColumn.ts", "spotto-dev-2", "Rejouable sans effet", "Retour en arrière"]) {
      expect(SQL, words).toContain(words);
    }
    expect(STATEMENTS.match(/^alter table .+$/gm)).toEqual(["alter table product_matches"]);
    expect(STATEMENTS).toContain("add column if not exists brand_shop boolean check (brand_shop);");
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("refusé : aucune donnée supprimée ni modifiée, aucune autre table, ni la marque ni la requête rangées ; le retour en arrière ne retire que la colonne", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function|table|policy)|create (unique )?index|security definer|^\s*(grant|revoke)\b|\bdefault\b/im);
    expect(STATEMENTS).not.toMatch(/\b(text|varchar|query|brand_name)\b/i);
    expect(SQL.slice(SQL.indexOf("-- Retour en arrière")).match(/^--   .+$/gm)).toEqual(["--   alter table product_matches drop column if exists brand_shop;"]);
  });
});

describe("0054 : vérification et registre", () => {
  it("la vérification est en lecture seule et rend deux colonnes, chacune expliquée", () => {
    const body = statements(VERIFICATION);
    expect(body.trimStart().startsWith("select")).toBe(true);
    expect(body.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i);
    expect(body.match(/\bas [a-z_]+[,;]?/g)).toEqual(["as colonne,", "as jamais_faux;"]);
    for (const column of ["colonne", "jamais_faux"]) expect(VERIFICATION).toContain(`--   ${column} = true`);
    expect(VERIFICATION).toContain("Résultat attendu : une seule ligne, true | true");
  });

  it("le registre a sa ligne « à appliquer », ses fichiers, et ce que fait le serveur sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0054 \| Ordre des boutiques : [^\n]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord ; ne demande que 0001/);
    expect(REGISTRY).toContain("| 0054 | le fichier de la migration lui-même | `supabase/verifications/0054-verification.sql` (une ligne, deux `true`) | en tête du fichier de la migration |");
    expect(REGISTRY).toContain("Sans 0054, aucune boutique officielle ne passe en tête de « Cette pièce dans d'autres boutiques » : chacune garde sa place reçue, avec sa mention");
    expect(REGISTRY.indexOf("| 0054 | Ordre des boutiques")).toBeGreaterThan(REGISTRY.indexOf("| 0053 | Quotas"));
  });
});
