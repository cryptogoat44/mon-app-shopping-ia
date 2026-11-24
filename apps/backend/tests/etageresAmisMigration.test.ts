import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Étagères des amis (migration 0058) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son comportement (garde sans la table des
// profils, rejouable, réglage allumé gardé à la seconde exécution, nouveau
// profil éteint d'office, valeur vide refusée, retour en arrière puis de
// nouveau ; vérification « faux » sans erreur avant la migration) a été essayé
// sur une base PostgreSQL locale et jetable (jamais Supabase), puis le sera
// sur spotto-dev-2 par etageresAmisBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0058_etageres_amis.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0058-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

describe("0058 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0058 \(lot « étagères des amis », 2026-11-24\)/);
    for (const words of [
      "éteints au départ",
      "Personne ne devient visible sans son geste",
      "Retour en arrière",
      "Ce qu'elle ajoute :",
      "Facultative pour le serveur",
      "« indisponible » (404",
      "personne n'est montré",
      "Rejouable sans effet",
      "spotto-dev-2",
      "RLS active",
      "Aucun déclencheur",
      "lib/friendShelves.ts",
      "aucune trace de qui a regardé",
    ]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans la table des profils, avant de changer quoi que ce soit", () => {
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if not exists \(select 1 from information_schema\.tables where table_schema = 'public' and table_name = 'profiles'\) then\s*raise exception '0058 demande la table des profils/
    );
  });

  it("deux colonnes, oui / non, jamais vides, FAUSSES par défaut ; « if not exists » ; puis le rechargement du schéma", () => {
    expect(STATEMENTS.match(/^alter table .+$/gm)).toEqual([
      "alter table profiles add column if not exists wishes_shown_to_friends boolean not null default false;",
      "alter table profiles add column if not exists vault_shown_to_friends boolean not null default false;",
    ]);
    expect(STATEMENTS).not.toMatch(/default true/);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée ; ni table, ni index, ni fonction, ni déclencheur, ni droit, ni règle d'accès", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|drop function|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer|create table|create (unique )?index|create policy|^\s*(grant|revoke)\b/im);
  });
});

describe("0058 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire les deux colonnes, et rien d'autre", () => {
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual([
      "--   alter table profiles drop column if exists vault_shown_to_friends;",
      "--   alter table profiles drop column if exists wishes_shown_to_friends;",
    ]);
  });

  it("la vérification est en lecture seule, rend quatre colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["reglage_envies", "reglage_vault", "personne_montre", "protegee"];
    expect(statements.match(/\bas [a-z_]+[,;]?/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    expect(statements.match(/data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'/g)).toHaveLength(2);
    // Une colonne absente n'est jamais lue directement : to_jsonb, après un test d'existence.
    expect(statements).toContain("(to_jsonb(profiles) ->> 'wishes_shown_to_friends') <> 'false'");
    expect(statements).not.toMatch(/where wishes_shown_to_friends|profiles\.wishes_shown_to_friends|select wishes_shown_to_friends/);
    expect(VERIFICATION).toContain("Avant la migration (ou sans elle) : false | false | false | true, sans");
  });

  it("le registre cite 0058 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0058 \| Étagères des amis[^|]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord/);
    expect(REGISTRY).toContain("`supabase/verifications/0058-verification.sql` (une ligne, quatre `true`");
    expect(REGISTRY).toContain("Sans 0058, personne ne montre ses Envies ni son Vault à ses amis : l'app cache les deux réglages");
    expect(REGISTRY.indexOf("| 0057 | Page look")).toBeLessThan(REGISTRY.indexOf("| 0058 | Étagères des amis"));
  });
});
