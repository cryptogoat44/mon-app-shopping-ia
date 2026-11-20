import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "@monapp/shared-types";

// Compte privé (lot « vie sociale », migration 0045) : ce que le FICHIER de
// la migration doit garantir, vérifié sans base. Son comportement (garde,
// rejouable, une demande par paire, jamais à soi-même, cascade à la
// suppression d'un compte, table fermée au public, retour en arrière) a été
// essayé sur une base Postgres locale et jetable (jamais Supabase), puis le
// sera sur spotto-dev-2 par comptePriveBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0045_compte_prive.sql"), "utf8");
const SQL_0024 = readFileSync(join(__dirname, "../supabase/migrations/0024_partage_envies.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0045-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

/** Les types entre parenthèses d'une règle « type in (…) ». */
function typesIn(sql: string): string[] {
  const list = /notifications_type_check\s+check \(type in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);
}

describe("0045 : en-tête, ordre, rejouable", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0045 \(lot « vie sociale », 2026-11-18\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique", "Aucun déclencheur", "APRÈS 0024"]) {
      expect(HEADER, words).toContain(words);
    }
  });

  it("refuse de s'appliquer sans 0024, avant de créer ou de modifier quoi que ce soit", () => {
    expect(SQL_0024).toContain("alter table notifications add column if not exists piece_send_id uuid;");
    expect(STATEMENTS.trimStart()).toMatch(/^do \$\$\s*begin\s*if not exists \(select 1 from information_schema\.columns[\s\S]*?column_name = 'piece_send_id'\) then\s*raise exception '0045 demande la migration 0024/);
  });

  it("rejouable : colonne, table et index « if not exists », règle retirée « if exists » avant d'être reposée", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*alter table .* add column/.test(text))) expect(line).toContain("add column if not exists");
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*create (unique )?index/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS.match(/create table/g)).toHaveLength(1);
    expect(STATEMENTS).toContain("create table if not exists follow_requests (");
    expect(STATEMENTS).toMatch(/alter table notifications drop constraint if exists notifications_type_check;\s*alter table notifications add constraint notifications_type_check/);
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("ne supprime ni ne modifie aucune donnée, n'ajoute ni déclencheur ni fonction", () => {
    expect(STATEMENTS).not.toMatch(/\b(delete from|update |truncate|drop table|drop column)\b/i);
    expect(STATEMENTS).not.toMatch(/create (or replace )?(trigger|function)|security definer/i);
  });
});

describe("0045 : ce qu'elle ajoute", () => {
  it("un compte est public tant que son propriétaire n'a rien changé", () => {
    expect(STATEMENTS).toContain("alter table profiles add column if not exists is_private boolean not null default false;");
  });

  it("une demande par paire de comptes, jamais à soi-même, effacée avec l'un ou l'autre compte", () => {
    const table = STATEMENTS.slice(STATEMENTS.indexOf("create table if not exists follow_requests ("), STATEMENTS.indexOf("\n);"));
    expect(table).toContain("requester_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("target_id uuid not null references profiles(id) on delete cascade");
    expect(table).toContain("primary key (requester_id, target_id)");
    expect(table).toContain("check (requester_id <> target_id)");
    // Aucune trace d'un refus : ni état, ni date de réponse.
    expect(table).not.toMatch(/status|declined|refus|answered/i);
    expect(STATEMENTS).toContain("create index if not exists follow_requests_target_idx on follow_requests (target_id, created_at desc);");
  });

  it("la table des demandes est réservée au serveur : RLS active, aucune politique, aucun droit pour les visiteurs ni les comptes connectés", () => {
    expect(STATEMENTS).toContain("alter table follow_requests enable row level security;");
    expect(STATEMENTS).not.toMatch(/create policy/i);
    expect(STATEMENTS).toContain("revoke all on table follow_requests from public, anon, authenticated;");
    expect(STATEMENTS).toContain("grant select, insert, update, delete on table follow_requests to service_role;");
  });

  it("notifications : les six types d'avant, plus cinq, exactement ceux que le serveur connaît", () => {
    const before = typesIn(SQL_0024);
    const after = typesIn(STATEMENTS);
    expect(before).toHaveLength(6);
    expect(after.slice(0, 6)).toEqual(before);
    expect(after.slice(6)).toEqual(["follow_request", "follow_accepted", "reply", "mention", "tag"]);
    // Tout type que le serveur écrit est accepté par la base (les trois derniers arrivent avec 0046 et 0047).
    for (const type of NOTIFICATION_TYPES) expect(after, type).toContain(type);
    // Chaque nouveau type a un auteur : la règle sur l'auteur ne change pas.
    expect(STATEMENTS).not.toContain("notifications_actor_check");
  });
});

describe("0045 : retour en arrière, vérification, registre", () => {
  it("le retour en arrière efface d'abord les notifications des nouveaux types, puis remet la règle de 0024", () => {
    const erase = ROLLBACK.indexOf("delete from notifications where type in ('follow_request', 'follow_accepted', 'reply', 'mention', 'tag');");
    const narrow = ROLLBACK.indexOf("check (type in ('follow', 'like', 'comment', 'moderation', 'report_handled', 'piece_received'));");
    expect(erase).toBeGreaterThan(0);
    expect(narrow).toBeGreaterThan(erase);
    expect(ROLLBACK).toContain("drop table if exists follow_requests;");
    expect(ROLLBACK).toContain("alter table profiles drop column if exists is_private;");
  });

  it("la vérification est en lecture seule et rend six colonnes", () => {
    const statements = VERIFICATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.trimStart().startsWith("select")).toBe(true);
    // Hors des textes entre apostrophes (noms de droits : 'insert', 'delete').
    expect(statements.replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i);
    expect(statements.match(/\bas [a-z_]+[,;]/g)).toHaveLength(6);
    for (const column of ["public_par_defaut", "aucun_compte_change", "demandes", "protegee", "fermee_au_public", "types_notifications"]) {
      expect(statements, column).toContain(`as ${column}`);
      expect(VERIFICATION, column).toContain(`${column} = true`);
    }
  });

  it("le registre cite 0045 appliquée en production le 20 novembre 2026, son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0045 \| Compte privé et demandes d'abonnement[^|]*\| appliquée en production \(après 0024/);
    expect(REGISTRY).toContain("`supabase/verifications/0045-verification.sql` (une ligne, six `true`)");
    expect(REGISTRY).toContain("Sans 0045, tous les comptes restent publics");
  });
});
