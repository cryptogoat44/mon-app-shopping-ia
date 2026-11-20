import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Quotas par membre (migration 0053) : ce que le FICHIER de la migration doit
// garantir, vérifié sans base. Son passage (refus sans 0029, deux fois de
// suite, part du mois, changements d'heure, réserve, deux réservations
// simultanées, droits, cascade, 0029 rejouée après elle, retour en arrière) a
// été essayé sur une base Postgres locale et jetable, jamais Supabase. Le
// comportement du serveur, avec et sans elle : quotasMembres.test.ts ; sur la
// vraie base de développement : quotasMembresBase.test.ts (sur le Mac).

const SUPABASE = join(__dirname, "../supabase");
const SQL = readFileSync(join(SUPABASE, "migrations/0053_quotas_membres.sql"), "utf8");
const SQL_0029 = readFileSync(join(SUPABASE, "migrations/0029_garde_fous.sql"), "utf8");
const VERIFICATION = readFileSync(join(SUPABASE, "verifications/0053-verification.sql"), "utf8");
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
/** Le corps d'une fonction plpgsql, entre ses deux « $$ ». */
function body(sql: string, name: string): string {
  const start = sql.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("as $$", start) + "as $$".length;
  return sql.slice(open, sql.indexOf("$$;", open));
}
/** Une instruction remise sur une ligne, espaces réduits. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const STATEMENTS = statements(SQL);
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
const V2 = body(SQL, "serpapi_quota_v2");
const V1 = body(SQL_0029, "serpapi_quota");

describe("en-tête de 0053", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, ce qu'elle demande", () => {
    expect(HEADER).toMatch(/^-- 0053 \(lot « quotas par membre », décisions du fondateur du 2026-11-19\)/);
    for (const words of [
      "Retour en arrière",
      "Ce qu'elle ajoute :",
      "Facultative pour le serveur : sans elle, il fonctionne exactement comme avant",
      "Rejouable sans effet",
      "spotto-dev-2",
      "À appliquer APRÈS 0028 et 0029",
      "RLS active, aucune politique",
      "ne supprime ni ne modifie aucune donnée existante",
      "Aucune route ne permet à un membre d'y écrire",
    ]) {
      expect(prose(HEADER), words).toContain(words);
    }
  });

  it("le retour en arrière est en tête, ne touche pas serpapi_quota, et demande de redémarrer le serveur", () => {
    expect(SQL.indexOf("-- Retour en arrière")).toBeLessThan(SQL.indexOf("-- Ce qu'elle ajoute :"));
    const commands = ROLLBACK.split("\n").filter((line) => line.startsWith("--   "));
    expect(commands).toEqual([
      "--   drop function if exists member_quotas_version();",
      "--   drop function if exists serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz);",
      "--   drop table if exists member_entitlements;",
    ]);
    expect(prose(ROLLBACK)).toContain("puis redémarrer le serveur chez Render");
    expect(prose(ROLLBACK)).toContain("serpapi_quota (0029) n'est pas touchée : rien à recréer.");
  });
});

describe("ce que 0053 exécute", () => {
  it("refuse de s'appliquer sans 0001-0022, sans 0028 ni sans 0029, avant de créer quoi que ce soit", () => {
    expect(STATEMENTS.startsWith("do $$\nbegin\n  if to_regclass('public.profiles') is null or to_regclass('public.serpapi_calls') is null then")).toBe(true);
    expect(STATEMENTS).toContain("raise exception '0053 demande la migration 0028 (voie C) : appliquez-la d''abord.';");
    expect(STATEMENTS).toContain("if to_regprocedure('public.ai_quota(text, uuid, integer, integer, boolean, timestamptz)') is null then");
    expect(STATEMENTS).toContain("raise exception '0053 demande la migration 0029 (garde-fous) : appliquez-la d''abord.';");
    expect(STATEMENTS.indexOf("end;\n$$;")).toBeLessThan(STATEMENTS.indexOf("create table"));
  });

  it("member_entitlements : deux droits connus, une date de fin facultative, supprimée avec le compte, fermée au public", () => {
    expect(flat(STATEMENTS)).toContain(
      flat(`create table if not exists member_entitlements (
        user_id uuid not null references profiles(id) on delete cascade,
        entitlement text not null check (entitlement in ('video', 'miroir')),
        expires_at timestamptz,
        source text not null check (source ~ '^[a-z][a-z0-9_]{0,39}$'),
        updated_at timestamptz not null default now(),
        primary key (user_id, entitlement)
      );`)
    );
    expect(STATEMENTS).toContain("alter table member_entitlements enable row level security;");
    expect(STATEMENTS).toContain("revoke all on table member_entitlements from public, anon, authenticated;");
    expect(STATEMENTS).toContain("grant select, insert, update, delete on table member_entitlements to service_role;");
    expect(STATEMENTS).not.toMatch(/create policy/i);
    expect(STATEMENTS).not.toMatch(/create trigger/i);
  });

  it("serpapi_quota n'est jamais redéfinie ni supprimée (un serveur plus ancien l'appelle encore)", () => {
    expect(STATEMENTS).not.toMatch(/function serpapi_quota\(/);
    expect(STATEMENTS).not.toMatch(/drop function/i);
    expect(STATEMENTS).toContain("create or replace function serpapi_quota_v2(");
  });

  it("serpapi_quota_v2 garde le corps de 0029 : même verrou, mêmes plafonds globaux, même part du jour", () => {
    expect(V2).toContain("perform pg_advisory_xact_lock(hashtext('serpapi_quota'));");
    // Les mêmes comptes de 0029, ligne pour ligne.
    for (const line of [
      "v_cycle_start := serpapi_cycle_start(p_renewal_day, v_at);",
      "v_next := serpapi_next_renewal(p_renewal_day, v_at);",
      "and c.released_at is null;",
      "and s.status in ('processing', 'completed', 'failed')",
      "and s.id is distinct from p_exclude_search",
      "and s.failure_kind is null",
      "and not s.served_from_cache;",
      "and m.stores_requested_at >= v_day_start and m.stores_requested_at <= v_at;",
    ]) {
      expect(V1, line).toContain(line);
      expect(V2, line).toContain(line);
    }
  });

  it("la part du mois compte comme la part du jour (cache et pannes exclus), dans le mois civil de Paris ; jamais les « Voir les boutiques »", () => {
    expect(V2).toContain("v_month_start := date_trunc('month', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';");
    expect(V2).toContain("v_resets := (date_trunc('month', v_at at time zone 'Europe/Paris') + interval '1 month')::date;");
    expect(flat(V2)).toContain(
      flat(`select count(*) filter (where s.created_at >= v_day_start), count(*)
        into v_user, v_user_month
        from product_searches s`)
    );
    expect(V2).toContain("and s.created_at >= v_month_start and s.created_at <= v_at");
    // Les « Voir les boutiques » ne s'ajoutent qu'à la part du jour.
    expect(V2).toContain("v_user := v_user + v_stores;");
    expect(V2).not.toMatch(/v_user_month := v_user_month \+ v_stores/);
  });

  it("la réserve réduit les plafonds globaux du jour et du mois, arrondis à l'entier inférieur ; 90 % au plus", () => {
    expect(V2).toContain("v_daily_cap := ((p_daily_cap::bigint * (100 - p_reserve_percent)) / 100)::integer;");
    expect(V2).toContain("v_monthly_cap := ((p_monthly_cap::bigint * (100 - p_reserve_percent)) / 100)::integer;");
    expect(V2).toContain("or p_reserve_percent is null or p_reserve_percent < 0 or p_reserve_percent > 90 then");
    expect(V2).toContain("or (p_user_monthly_cap is not null and p_user_monthly_cap < 1)");
    expect(V2).toContain("if v_month >= v_monthly_cap then");
    expect(V2).toContain("if v_day >= v_daily_cap then");
  });

  it("l'ordre des refus : mois du service, part du mois, part du jour, jour du service", () => {
    const order = ["'month'::text", "'user_month'::text", "'user'::text", "'day'::text"].map((refusal) => V2.indexOf(refusal));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(V2).toContain("if p_user_monthly_cap is not null and v_user_month >= p_user_monthly_cap then");
  });

  it("seul le serveur appelle les deux fonctions", () => {
    const signature = "serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz)";
    expect(STATEMENTS).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
    expect(STATEMENTS).toContain(`grant execute on function ${signature} to service_role;`);
    expect(STATEMENTS).toContain("revoke all on function member_quotas_version() from public, anon, authenticated;");
    expect(STATEMENTS).toContain("grant execute on function member_quotas_version() to service_role;");
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe("vérification et registre de 0053", () => {
  it("la vérification est en lecture seule, et dit ce qu'on attend de chaque colonne", () => {
    expect(statements(VERIFICATION)).not.toMatch(/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im);
    expect(statements(VERIFICATION).trimStart().startsWith("select")).toBe(true);
    for (const column of ["table_droits", "suppression_en_cascade", "fermee_au_public", "aucun_declencheur", "fonctions_serveur_seul", "ancienne_fonction_intacte"]) {
      expect(VERIFICATION).toContain(`as ${column}`);
      expect(VERIFICATION).toContain(`--   ${column} = true`);
    }
    expect(VERIFICATION).toContain("Résultat attendu : une seule ligne, true | true | true | true | true | true");
  });

  it("le registre a sa ligne « à appliquer », ses fichiers, et ce que fait le serveur sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0053 \| Quotas par membre[^\n]*\| appliquée en production \(demande 0028 et 0029/);
    expect(REGISTRY).toContain("| 0053 | le fichier de la migration lui-même (**après 0029**) | `supabase/verifications/0053-verification.sql` (une ligne, six `true`)");
    expect(REGISTRY).toContain("Sans 0053, les recherches fonctionnent exactement comme avant");
    // Rangée après 0044 (les numéros 0045 à 0052 sont réservés aux lots sociaux).
    expect(REGISTRY.indexOf("| 0053 | Quotas")).toBeGreaterThan(REGISTRY.indexOf("| 0044 | Messages, plus de confort"));
  });
});
