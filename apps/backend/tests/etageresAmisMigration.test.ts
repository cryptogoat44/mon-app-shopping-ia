import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Étagères des amis (migration 0058, réécrite selon le fondateur : réglages
// allumés par défaut, date de l'information vue) : ce que le FICHIER de la
// migration doit garantir, vérifié sans base. Son comportement (garde sans la
// table des profils, rejouable, réglage éteint gardé à la seconde exécution,
// comptes existants et nouveaux allumés d'office mais « pas informés »,
// valeur vide refusée, retour en arrière puis de nouveau ; vérification
// « faux » sans erreur avant la migration) a été essayé sur une base
// PostgreSQL locale et jetable (jamais Supabase), puis le sera sur
// spotto-dev-2 par etageresAmisBase.test.ts.

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
    expect(HEADER).toMatch(/^-- 0058 \(lot « étagères des amis », 2026-11-24, réécrite le 2026-11-25 selon\n-- le fondateur\)/);
    for (const words of [
      "allumés au départ",
      "Personne n'est vu avant d'avoir été prévenu",
      "jamais par le serveur seul",
      "s'il manque une seule des trois\n-- colonnes",
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

  it("deux réglages oui / non, jamais vides, VRAIS par défaut, et la date de l'information, vide ; « if not exists » ; puis le rechargement du schéma", () => {
    expect(STATEMENTS.match(/^alter table .+$/gm)).toEqual([
      "alter table profiles add column if not exists wishes_shown_to_friends boolean not null default true;",
      "alter table profiles add column if not exists vault_shown_to_friends boolean not null default true;",
      "alter table profiles add column if not exists friend_shelves_informed_at timestamptz;",
    ]);
    // Refusé : l'ancienne règle (éteints au départ), ou une date remplie d'office.
    expect(STATEMENTS).not.toMatch(/default false/);
    expect(STATEMENTS).not.toMatch(/friend_shelves_informed_at timestamptz (not null|default)/);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée ; ni table, ni index, ni fonction, ni déclencheur, ni droit, ni règle d'accès", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|drop function|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer|create table|create (unique )?index|create policy|^\s*(grant|revoke)\b/im);
  });
});

describe("0058 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire les trois colonnes, et rien d'autre", () => {
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual([
      "--   alter table profiles drop column if exists friend_shelves_informed_at;",
      "--   alter table profiles drop column if exists vault_shown_to_friends;",
      "--   alter table profiles drop column if exists wishes_shown_to_friends;",
    ]);
  });

  it("la vérification est en lecture seule, rend cinq colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["reglage_envies", "reglage_vault", "information", "personne_informe", "protegee"];
    expect(statements.match(/\bas [a-z_]+[,;]?/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    expect(statements.match(/data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'/g)).toHaveLength(2);
    expect(statements).not.toContain("column_default = 'false'");
    expect(statements).toContain("data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null");
    // Une colonne absente n'est jamais lue directement : to_jsonb, après un test d'existence.
    expect(statements).toContain("(to_jsonb(profiles) ->> 'friend_shelves_informed_at') is not null");
    expect(statements).not.toMatch(/where friend_shelves_informed_at|profiles\.friend_shelves_informed_at|select friend_shelves_informed_at/);
    expect(VERIFICATION).toContain("Avant la migration (ou sans elle) : false | false | false | false | true,");
  });

  it("le registre cite 0058 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0058 \| Étagères des amis[^|]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord/);
    expect(REGISTRY).toContain("`supabase/verifications/0058-verification.sql` (une ligne, cinq `true`");
    expect(REGISTRY).toContain("**allumés pour tout le monde au départ**");
    expect(REGISTRY).not.toContain("éteints pour tout le monde au départ");
    expect(REGISTRY).toContain("Sans 0058 (ou s'il lui manque une seule de ses trois colonnes), personne ne montre ses Envies ni son Vault à ses amis : l'app cache les deux réglages et l'information");
    expect(REGISTRY).toContain("Avec 0058, les étagères d'un membre restent fermées tant qu'il n'a pas vu l'information dans une app à jour.");
    expect(REGISTRY.indexOf("| 0057 | Page look")).toBeLessThan(REGISTRY.indexOf("| 0058 | Étagères des amis"));
  });
});
