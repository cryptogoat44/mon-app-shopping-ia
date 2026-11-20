import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fil « Pour vous » (lot « découverte », migration 0050) : ce que le FICHIER de
// la migration doit garantir, vérifié sans base. Son comportement (garde sans
// la table des profils, rejouable, réglage éteint gardé à la seconde
// exécution, nouveau profil proposé d'office, valeur vide refusée, droits
// inchangés, retour en arrière puis de nouveau ; vérification « faux » sans
// erreur avant la migration) a été essayé sur une base PostgreSQL 16 locale et
// jetable (jamais Supabase), puis le sera sur spotto-dev-2 par
// pourVousBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0050_decouverte.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0050-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

describe("0050 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0050 \(lot « découverte », 2026-11-19\)/);
    for (const words of [
      "Retour en arrière",
      "Ce qu'elle ajoute :",
      "Facultative pour le serveur",
      "répondent « indisponible » (404",
      "personne n'est proposé sans",
      "Rejouable sans effet",
      "spotto-dev-2",
      "RLS active",
      "Aucun déclencheur",
      "lib/forYou.ts",
      "article 21",
      "aucune trace de ce qui a été vu",
    ]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans la table des profils, avant de changer quoi que ce soit ; n'exige aucune migration du lot « vie sociale »", () => {
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if not exists \(select 1 from information_schema\.tables where table_schema = 'public' and table_name = 'profiles'\) then\s*raise exception '0050 demande la table des profils/
    );
    expect(STATEMENTS).not.toMatch(/is_private|follow_requests|mentions_from|post_media|post_people_tags|saved_posts|pinned_at|link_url/);
  });

  it("une seule colonne, oui / non, jamais vide, vraie par défaut ; « if not exists » ; puis le rechargement du schéma", () => {
    expect(STATEMENTS).toContain("alter table profiles add column if not exists discoverable boolean not null default true;");
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*(create (unique )?index|alter table \w+ add column)/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS.match(/^alter table .+$/gm)).toEqual(["alter table profiles add column if not exists discoverable boolean not null default true;"]);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée ; ni table, ni index, ni fonction, ni déclencheur, ni droit, ni règle d'accès", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|drop function|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer|create table|create (unique )?index|create policy|^\s*(grant|revoke)\b/im);
  });
});

describe("0050 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière retire la colonne, et rien d'autre", () => {
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual(["--   alter table profiles drop column if exists discoverable;"]);
  });

  it("la vérification est en lecture seule, rend trois colonnes, et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["reglage", "tous_proposes", "protegee"];
    expect(statements.match(/\bas [a-z_]+[,;]?/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    // La colonne : oui / non, jamais vide, vraie par défaut.
    expect(statements).toContain("data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'");
    // Une colonne absente n'est jamais lue directement : to_jsonb, après un test d'existence.
    expect(statements).toContain("(to_jsonb(profiles) ->> 'discoverable') <> 'true'");
    expect(statements).not.toMatch(/where discoverable|profiles\.discoverable|select discoverable/);
    expect(VERIFICATION).toContain("Avant la migration (ou sans elle) : false | false | true, sans erreur");
  });

  it("le registre cite 0050 appliquée en production le 20 novembre 2026, son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0050 \| Fil « Pour vous » et suggestions de comptes[^|]*\| appliquée en production \(après 0001/);
    expect(REGISTRY).toContain("`supabase/verifications/0050-verification.sql` (une ligne, trois `true`");
    expect(REGISTRY).toContain("Sans 0050, le fil « Pour vous » et les suggestions de comptes sont cachés, comme le réglage « Proposer mon compte aux autres membres » : personne n'y est proposé sans pouvoir refuser");
    expect(REGISTRY).not.toContain("tous les comptes publics y sont proposés");
    expect(REGISTRY.indexOf("| 0049 | Épingles et lien en bio")).toBeLessThan(REGISTRY.indexOf("| 0050 | Fil « Pour vous »"));
    expect(REGISTRY).toContain("État au 20 novembre 2026.");
  });
});
