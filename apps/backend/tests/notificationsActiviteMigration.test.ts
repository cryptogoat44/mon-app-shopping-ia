import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Notifications d'activité sur le téléphone (lot « découverte », migration
// 0051) : ce que le FICHIER de la migration doit garantir, vérifié sans base.
// Son comportement (garde sans 0036, rejouable, quatre colonnes éteintes pour
// les appareils déjà là comme pour un nouveau, valeur vide refusée, droits
// inchangés, retour en arrière puis de nouveau ; vérification « faux » sans
// erreur avant la migration) a été essayé sur une base PostgreSQL 16 locale et
// jetable (jamais Supabase), puis le sera sur spotto-dev-2 par
// notificationsActiviteBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0051_notifications_activite.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0051-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
const COLUMNS = ["notify_likes", "notify_comments", "notify_follows", "notify_mentions"];

describe("0051 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0051 \(lot « découverte », 2026-11-19\)/);
    for (const words of [
      "Retour en arrière",
      "Ce qu'elle ajoute :",
      "ÉTEINTES au départ",
      "Facultative pour le serveur",
      "même avec PUSH_ENABLED=true",
      "l'app cache leurs interrupteurs",
      "lib/push.ts",
      "Demande 0036",
      "Indépendante de 0045 à 0050",
      "Rejouable sans effet",
      "spotto-dev-2",
      "RLS active",
      "Aucun déclencheur",
      "jamais le texte d'un commentaire, une légende ni une image",
    ]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0036 (alertes prix), avant de changer quoi que ce soit ; n'exige rien du lot « vie sociale »", () => {
    expect(STATEMENTS.trimStart()).toMatch(
      /^do \$\$\s*begin\s*if not exists \(select 1 from information_schema\.columns where table_schema = 'public' and table_name = 'push_tokens' and column_name = 'notify_alerts'\) then\s*raise exception '0051 demande la migration 0036 \(alertes prix\) : appliquez-la d''abord\.';/
    );
    expect(STATEMENTS).not.toMatch(/is_private|follow_requests|mentions_from|post_media|post_people_tags|saved_posts|pinned_at|link_url|discoverable/);
  });

  it("quatre colonnes oui / non, jamais vides, éteintes par défaut ; « if not exists » ; puis le rechargement du schéma", () => {
    const alters = STATEMENTS.match(/^alter table .+$/gm);
    expect(alters).toEqual(COLUMNS.map((column) => `alter table push_tokens add column if not exists ${column} boolean not null default false;`));
    expect(STATEMENTS).not.toMatch(/default true/);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée ; ni table, ni index, ni fonction, ni déclencheur, ni droit, ni règle d'accès", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column|drop function|insert into)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer|create table|create (unique )?index|create policy|^\s*(grant|revoke)\b/im);
  });
});

describe("0051 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière oublie d'abord les appareils gardés pour la seule activité, puis retire les quatre colonnes, et rien d'autre", () => {
    expect(ROLLBACK.match(/^--   .+$/gm)).toEqual([
      "--   delete from push_tokens where notify_messages = false and notify_alerts = false;",
      "--   alter table push_tokens drop column if exists notify_mentions;",
      "--   alter table push_tokens drop column if exists notify_follows;",
      "--   alter table push_tokens drop column if exists notify_comments;",
      "--   alter table push_tokens drop column if exists notify_likes;",
    ]);
  });

  it("la vérification est en lecture seule, rend trois colonnes, ne montre aucun jeton et ne relève aucune erreur avant la migration", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    const columns = ["colonnes", "aucun_appareil_allume", "protegee"];
    expect(statements.match(/\bas [a-z_]+[,;]?/g)).toHaveLength(columns.length);
    for (const column of columns) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
    // Les colonnes : oui / non, jamais vides, éteintes par défaut.
    expect(statements).toContain("data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false') = 4 as colonnes");
    // Une colonne absente n'est jamais lue directement : to_jsonb, après un test d'existence ; seulement un compte.
    for (const column of COLUMNS) expect(statements).toContain(`(to_jsonb(push_tokens) ->> '${column}') <> 'false'`);
    expect(statements).not.toMatch(/select token|push_tokens\.token|where notify_/);
    expect(statements).toContain("not has_table_privilege('authenticated', 'public.push_tokens', 'select')");
    expect(VERIFICATION).toContain("Avant la migration (ou sans elle), sur une base qui a 0035 (déjà en\n-- production) : false | false | true, sans erreur");
  });

  it("le registre cite 0051 « à appliquer » après 0036, son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0051 \| Notifications d'activité sur le téléphone[^|]*éteintes au départ[^|]*\| \*\*à appliquer\*\* \(après 0036/);
    expect(REGISTRY).toContain("`supabase/verifications/0051-verification.sql` (une ligne, trois `true`");
    expect(REGISTRY).toContain(
      "Sans 0051, aucune notification d'activité (« j'aime », commentaires, abonnés, mentions) n'est envoyée, même avec `PUSH_ENABLED=true` : le serveur ignore ces réponses et l'app cache leurs quatre interrupteurs"
    );
    expect(REGISTRY.indexOf("| 0050 | Fil « Pour vous »")).toBeLessThan(REGISTRY.indexOf("| 0051 | Notifications d'activité"));
    expect(REGISTRY.indexOf("| 0050 | le fichier de la migration")).toBeLessThan(REGISTRY.indexOf("| 0051 | le fichier de la migration"));
  });
});
