import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Le verdict (migration 0055) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son passage (refus clair sans la table des
// propositions, deux fois de suite, ligne d'avant laissée vide, 0, 1, 2 et
// vide acceptés, 3 et -1 refusés, retour en arrière puis de nouveau ;
// vérification « false | false | false » sans erreur avant la migration,
// « true | true | true » après) a été essayé sur une base PostgreSQL 16
// locale et jetable (jamais Supabase). Sur la vraie base de développement :
// verdictBase.test.ts (sur le Mac, sauté sans 0055).

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0055_verdict.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0055-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le texte sans ses commentaires. */
const statements = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
const STATEMENTS = statements(SQL);

describe("0055 : le palier du titre sur la ligne de la proposition, rien d'autre", () => {
  it("permis : une colonne 0 / 1 / 2 / vide sur les propositions, rejouable, gardée par la présence de 0001, puis le rechargement du schéma ; l'en-tête dit pourquoi, et ce que fait le serveur sans elle", () => {
    expect(SQL).toMatch(/^-- 0055 \(lot « verdict », 2026-11-22\)\. Aucune donnée personnelle de plus\./);
    for (const words of ["jamais enregistrés", "Facultative pour le serveur", "lib/verdictColumn.ts", "lib/verdict.ts", "spotto-dev-2", "Rejouable sans effet", "Retour en arrière"]) {
      expect(SQL, words).toContain(words);
    }
    expect(STATEMENTS).toContain("if to_regclass('public.product_matches') is null then");
    expect(STATEMENTS).toContain("raise exception '0055 demande la migration 0001");
    expect(STATEMENTS.match(/^alter table .+$/gm)).toEqual(["alter table product_matches"]);
    expect(STATEMENTS).toContain("add column if not exists title_tier smallint check (title_tier between 0 and 2);");
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("refusé : aucune donnée supprimée ni modifiée, aucune autre table, ni marque, ni modèle, ni requête, ni membre rangés, aucune valeur d'office ; le retour en arrière ne retire que la colonne", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function|table|policy)|create (unique )?index|security definer|^\s*(grant|revoke)\b|\bdefault\b|\bnot null\b/im);
    expect(STATEMENTS).not.toMatch(/\b(text|varchar|timestamptz|user_id|url|brand|model|query)\b/i);
    expect(SQL.slice(SQL.indexOf("-- Retour en arrière")).match(/^--   .+$/gm)).toEqual(["--   alter table product_matches drop column if exists title_tier;"]);
  });
});

describe("0055 : vérification et registre", () => {
  it("la vérification est en lecture seule et rend trois colonnes, chacune expliquée", () => {
    const body = statements(VERIFICATION);
    expect(body.trimStart().startsWith("select")).toBe(true);
    expect(body.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i);
    expect(body.match(/\bas [a-z_]+[,;]?/g)).toEqual(["as colonne,", "as vide_par_defaut,", "as trois_valeurs;"]);
    for (const column of ["colonne", "vide_par_defaut", "trois_valeurs"]) expect(VERIFICATION).toContain(`--   ${column} = true`);
    expect(VERIFICATION).toContain("Résultat attendu : une seule ligne, true | true | true");
  });

  it("le registre a sa ligne « à appliquer », ses fichiers, et ce que fait le serveur sans elle ; entre 0054 et 0056", () => {
    expect(REGISTRY).toMatch(/\| 0055 \| Verdict : [^\n]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord ; ne demande que 0001/);
    expect(REGISTRY).toContain("| 0055 | le fichier de la migration lui-même | `supabase/verifications/0055-verification.sql` (une ligne, trois `true`) | en tête du fichier de la migration |");
    expect(REGISTRY).toContain("Sans 0055, aucune phrase de verdict n'est montrée en tête des résultats (sonde du schéma, lib/verdictColumn.ts).");
    const line = REGISTRY.split("\n").find((text) => text.startsWith("| 0055 | Verdict"))!;
    for (const words of ["**Facultative**", "le serveur marche sans elle", "ni la marque ni le modèle ne sont enregistrés", "Pour les membres, avant elle : aucune phrase de verdict", "Après elle :"]) {
      expect(line, words).toContain(words);
    }
    expect(REGISTRY.indexOf("| 0055 | Verdict")).toBeGreaterThan(REGISTRY.indexOf("| 0054 | Ordre des boutiques"));
    expect(REGISTRY.indexOf("| 0055 | Verdict")).toBeLessThan(REGISTRY.indexOf("| 0056 | Stock affiché"));
  });
  it("permis : le registre et l'en-tête disent que les recherches d'avant sans boutiques cherchées ou sans rien trouvé montrent « Pas de pièce exacte trouvée » (lib/verdict.ts), et que les autres n'ont aucune phrase", () => {
    const line = REGISTRY.split("\n").find((text) => text.startsWith("| 0055 | Verdict"))!;
    const header = SQL.split("\n").filter((text) => text.startsWith("--")).map((text) => text.replace(/^-- ?/, "")).join(" ").replace(/\s+/g, " ");
    for (const text of [line, header]) {
      expect(text).toContain("les recherches d'avant où les autres boutiques n'avaient pas été cherchées (pièce sans marque reconnue, IA coupée) ou n'avaient rien renvoyé montrent aussi « Pas de pièce exacte trouvée » ; celles dont les offres dans d'autres boutiques ont été montrées sans palier n'ont aucune phrase");
    }
  });

  it("refusé : jamais « les recherches d'avant n'en ont pas » ni « n'ont jamais de verdict » seuls, qui laisseraient croire que rien ne change pour elles", () => {
    const line = REGISTRY.split("\n").find((text) => text.startsWith("| 0055 | Verdict"))!;
    expect(line).not.toContain("les recherches d'avant n'en ont pas");
    expect(SQL).not.toContain("n'ont jamais de verdict");
  });
});
