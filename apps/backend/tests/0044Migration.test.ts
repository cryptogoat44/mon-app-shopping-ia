import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Messages, plus de confort (migration 0044) : ce que le FICHIER de la
// migration doit garantir, vérifié sans base. Son passage (refus sans 0032,
// deux fois de suite, règle remplacée, publication supprimée, cascade,
// vérification, retour en arrière) a été essayé sur une base Postgres locale
// et jetable, jamais Supabase. Le comportement du serveur, avec et sans
// elle : messagerieConfort.test.ts ; sur la vraie base de développement :
// messagerieConfortBase.test.ts (sur le Mac).

const SUPABASE = join(__dirname, "../supabase");
const SQL = readFileSync(join(SUPABASE, "migrations/0044_messages_confort.sql"), "utf8");
const VERIFICATION = readFileSync(join(SUPABASE, "verifications/0044-verification.sql"), "utf8");
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
const AFTER_GUARD = STATEMENTS.slice(STATEMENTS.indexOf("$$;") + "$$;".length).trim();
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

describe("en-tête de 0044", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et qu'elle ne dépend pas de 0043", () => {
    expect(HEADER).toMatch(/^-- 0044 \(lot « messages, plus de confort », 2026-11-18\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique", "ne supprime ni ne modifie aucune donnée existante"]) {
      expect(prose(HEADER), words).toContain(words);
    }
    expect(prose(HEADER)).toContain("elle ne dépend pas de 0043 (confirmations de lecture) : l'une fonctionne sans l'autre");
    expect(prose(HEADER)).toContain("Aucun déclencheur : aimer ou supprimer un message ne change ni l'aperçu de la conversation, ni son ordre, ni « non lu », et ne prévient personne.");
  });

  it("dit les règles de confidentialité : rien de la publication n'est recopié ; un message supprimé est effacé, sauf s'il avait été signalé (modération seulement)", () => {
    const words = prose(HEADER);
    expect(words).toContain("Rien de la publication n'est recopié dans le message (ni légende, ni image, ni auteur)");
    expect(words).toContain("ne la montre que si elle a le droit de la voir à ce moment-là");
    expect(words).toContain("Son texte et sa carte sont alors effacés de la base, SAUF s'il avait été signalé avant : son contenu reste alors dans la base, pour la modération seulement");
    expect(words).toContain("le serveur ne le renvoie plus jamais aux deux membres, qui voient « Message supprimé »");
  });

  it("le retour en arrière est en tête, prévient qu'il efface des messages, et commence par ceux que l'ancienne règle refuse ou qui redeviendraient visibles", () => {
    expect(SQL.indexOf("-- Retour en arrière")).toBeLessThan(SQL.indexOf("-- Ce qu'elle ajoute :"));
    expect(prose(ROLLBACK)).toContain("ATTENTION, il efface des messages pour de bon, à lancer dans cet ordre");
    expect(prose(ROLLBACK)).toContain("un message supprimé par son auteur redeviendrait visible si son contenu avait été conservé pour la modération");
    const commands = ROLLBACK.split("\n").filter((line) => line.startsWith("--   "));
    expect(commands).toEqual([
      "--   delete from messages where deleted_at is not null or (body is null and wish_title is null);",
      "--   alter table messages drop constraint if exists messages_content_check;",
      "--   alter table messages add check (body is not null or wish_title is not null);",
      "--   drop table if exists message_reactions;",
      "--   alter table messages drop column if exists reply_to_id;",
      "--   alter table messages drop column if exists post_id;",
      "--   alter table messages drop column if exists shared_post;",
      "--   alter table messages drop column if exists deleted_at;",
      "--   alter table messages drop column if exists updated_at;",
    ]);
  });
});

describe("ce que 0044 exécute", () => {
  it("refuse de s'appliquer sans les messages privés (0032), avant de modifier quoi que ce soit ; ne demande pas 0043", () => {
    expect(STATEMENTS.startsWith("do $$\nbegin\n  if to_regclass('public.messages') is null then")).toBe(true);
    expect(STATEMENTS).toContain("raise exception '0044 demande la migration 0032 (messages) : appliquez-la d''abord.';");
    expect(STATEMENTS).not.toContain("read_receipts");
    expect(STATEMENTS).not.toContain("0043");
  });

  it("cinq colonnes sur messages : la réponse et la publication se vident (jamais de cascade), le reste est facultatif", () => {
    expect(AFTER_GUARD).toContain("alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;");
    expect(AFTER_GUARD).toContain("alter table messages add column if not exists post_id uuid references posts(id) on delete set null;");
    expect(AFTER_GUARD).toContain("alter table messages add column if not exists shared_post boolean not null default false;");
    expect(AFTER_GUARD).toContain("alter table messages add column if not exists deleted_at timestamptz;");
    expect(AFTER_GUARD).toContain("alter table messages add column if not exists updated_at timestamptz;");
    expect(AFTER_GUARD.match(/add column/g)).toHaveLength(5);
    // Rien de la publication n'est recopié : aucune colonne pour sa légende, son image ou son auteur.
    expect(AFTER_GUARD).not.toMatch(/post_(caption|image|author|thumb)/);
  });

  it("les « j'aime » : un par membre et par message, supprimés avec le message ou le compte, fermés au public", () => {
    expect(AFTER_GUARD).toContain("create table if not exists message_reactions (");
    expect(AFTER_GUARD).toContain("message_id uuid not null references messages(id) on delete cascade,");
    expect(AFTER_GUARD).toContain("user_id uuid not null references profiles(id) on delete cascade,");
    expect(AFTER_GUARD).toContain("primary key (message_id, user_id)");
    expect(AFTER_GUARD).toContain("alter table message_reactions enable row level security;");
    expect(AFTER_GUARD).toContain("revoke all on table message_reactions from public, anon, authenticated;");
    expect(AFTER_GUARD).toContain("grant select, insert, update, delete on table message_reactions to service_role;");
    expect(AFTER_GUARD).not.toContain("create policy");
  });

  it("la règle sans nom de 0032 est retrouvée par sa définition, retirée, puis remplacée par messages_content_check", () => {
    expect(AFTER_GUARD).toContain("= 'checkbodyisnotnullorwish_titleisnotnull'");
    expect(AFTER_GUARD).toContain("execute format('alter table messages drop constraint %I', v_name);");
    expect(AFTER_GUARD).toContain("alter table messages drop constraint if exists messages_content_check;");
    expect(AFTER_GUARD).toContain("check (body is not null or wish_title is not null or shared_post or deleted_at is not null);");
    // Les colonnes existent avant la règle qui les nomme.
    expect(AFTER_GUARD.indexOf("add column if not exists deleted_at")).toBeLessThan(AFTER_GUARD.indexOf("add constraint messages_content_check"));
  });

  it("rejouable : rien n'est détruit en dehors de la règle remplacée ; aucun déclencheur, aucune fonction ; le schéma est rechargé", () => {
    expect(AFTER_GUARD).not.toMatch(/\bdrop (table|column|index|function|trigger)\b/);
    expect(AFTER_GUARD).not.toMatch(/\b(delete from|truncate|update messages)\b/);
    expect(AFTER_GUARD).not.toMatch(/create (or replace )?(function|trigger)/);
    expect(AFTER_GUARD.match(/create index if not exists/g)).toHaveLength(4);
    expect(AFTER_GUARD).toContain("create index if not exists messages_changed_idx on messages (conversation_id, updated_at) where updated_at is not null;");
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("le fichier se termine par un retour à la ligne, et porte le numéro qui suit 0043", () => {
    expect(SQL.endsWith("\n")).toBe(true);
    const numbers = readdirSync(join(SUPABASE, "migrations")).map((name) => name.slice(0, 4));
    expect(numbers.filter((number) => number === "0044")).toHaveLength(1);
    expect(numbers).toContain("0043");
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("le serveur et la migration parlent des mêmes colonnes", () => {
  const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

  it("la sonde nomme les cinq colonnes et la table créées par 0044, et rien de 0043", () => {
    const lib = source("lib/messaging.ts");
    expect(lib).toContain('export const MESSAGE_ACTION_COLUMNS = "reply_to_id, post_id, shared_post, deleted_at, updated_at";');
    expect(lib).toContain('db.from("messages").select(MESSAGE_ACTION_COLUMNS).limit(0)');
    expect(lib).toContain('db.from("message_reactions").select("message_id, user_id, created_at").limit(0)');
    for (const column of ["reply_to_id", "post_id", "shared_post", "deleted_at", "updated_at"]) expect(AFTER_GUARD, column).toContain(`add column if not exists ${column} `);
  });

  it("la sonde de la messagerie (0032) ne lit aucune colonne de 0044 : sans elle, la messagerie fonctionne comme avant", () => {
    const lib = source("lib/messaging.ts");
    expect(lib).toContain('db.from("messages").select("id, wish_title").limit(0)');
    expect(lib).toContain('"id, conversation_id, sender_id, body, wish_title, wish_image_url, wish_image_thumb_url, wish_merchant_name, wish_merchant_url, wish_product_match_id, wish_price_min, wish_currency, hidden_at, created_at"');
  });
});

describe("vérification et registre", () => {
  it("le contrôle est en lecture seule : une seule requête « select », sept réponses", () => {
    const sql = statements(VERIFICATION);
    expect(sql.startsWith("select")).toBe(true);
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b\s/i);
    expect(sql.match(/\) as [a-z_]+[,;]/g)).toHaveLength(7);
    expect(VERIFICATION).toContain("true | true | true | true | true | true | true");
  });

  it("le registre cite 0044 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/^\| 0044 \| Messages, plus de confort[^|]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord ; demande 0032, déjà en production ; ne dépend pas de 0043 : l'une fonctionne sans l'autre\) \| — \|$/m);
    expect(REGISTRY).toContain("| 0044 | le fichier de la migration lui-même (**après 0032**) | `supabase/verifications/0044-verification.sql` (une ligne, sept `true`) |");
    expect(REGISTRY).toContain("Sans 0044, la messagerie fonctionne comme avant, et l'app ne propose ni « Aimer », ni « Répondre », ni « Supprimer », ni l'envoi d'une publication dans un message.");
    expect(REGISTRY.match(/^\| 0044 \|/gm)).toHaveLength(2);
  });
});
