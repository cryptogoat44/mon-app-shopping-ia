import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Essayage virtuel (lot « essayage virtuel ») : ce que le FICHIER de la
// migration 0042 doit garantir, vérifié sans base. Le comportement lui-même
// est vérifié sur une base Postgres jetable (quotas, essais simultanés,
// budget, purge, suppression d'un compte), puis sur spotto-dev-2 par
// essayageBase.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0042_essayage_virtuel.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0042-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires. */
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

const TABLES = ["feature_flags", "tryon_profiles", "tryon_events", "tryon_bonus_grants", "tryon_reports", "tryon_alerts", "tryon_usage_months"];
const MEMBER_TABLES = ["tryon_profiles", "tryon_events", "tryon_bonus_grants", "tryon_reports"];
const FUNCTIONS = [
  "tryon_version",
  "tryon_purge",
  "tryon_alert_once",
  "tryon_remaining",
  "tryon_reserve",
  "tryon_complete",
  "tryon_fail",
  "tryon_set_age",
  "tryon_reset_age",
  "tryon_grant_bonus",
];

/** Le corps d'une fonction, de « create or replace function » à « $$; ». */
function body(name: string): string {
  const start = SQL.indexOf(`create or replace function ${name}(`);
  expect(start, name).toBeGreaterThan(0);
  return SQL.slice(start, SQL.indexOf("$$;", SQL.indexOf("as $$", start)));
}

/** La définition d'une table, de « create table » à « ); ». */
function table(name: string): string {
  const start = SQL.indexOf(`create table if not exists ${name} (`);
  expect(start, name).toBeGreaterThan(0);
  return SQL.slice(start, SQL.indexOf("\n);", start));
}

describe("en-tête de 0042", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0042 \(lot « essayage virtuel », 2026-11-13\)/);
    for (const words of ["ÉTEINT par défaut", "Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique", "Aucun déclencheur"]) {
      expect(HEADER, words).toContain(words);
    }
    // Jamais la photo, l'image produite ni la date de naissance.
    expect(HEADER).toContain("jamais la photo, jamais l'image");
    expect(HEADER).toContain("jamais la date de naissance");
  });

  it("refuse de s'appliquer sans la table profiles, avant de créer quoi que ce soit", () => {
    expect(STATEMENTS.trimStart()).toMatch(/^do \$\$\s*begin\s*if to_regclass\('public\.profiles'\) is null then\s*raise exception '0042 demande la table profiles/);
  });

  it("le registre des migrations cite 0042, son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/\| 0042 \| Essayage virtuel photo, ÉTEINT/);
    expect(REGISTRY).toContain("`supabase/verifications/0042-verification.sql` (une ligne, huit `true`)");
    expect(REGISTRY).toContain("Sans 0042, l'essayage virtuel reste éteint");
  });
});

describe("drapeau : créé éteint, jamais rallumé par la migration", () => {
  it("la ligne « tryon » est insérée à false, sans jamais changer une valeur existante", () => {
    expect(STATEMENTS).toContain("insert into feature_flags (key, enabled) values ('tryon', false) on conflict (key) do nothing;");
    expect(table("feature_flags")).toContain("enabled boolean not null default false");
    // Aucune instruction ne met le drapeau à true.
    expect(STATEMENTS).not.toMatch(/feature_flags[^;]*\btrue\b/);
  });
});

describe("tables : serveur seul, suppression en cascade, aucune image", () => {
  it("chaque table : RLS active, fermée aux visiteurs et aux comptes connectés, ouverte au serveur, retirée par le retour en arrière", () => {
    for (const name of TABLES) {
      table(name);
      expect(STATEMENTS, name).toContain(`alter table ${name} enable row level security;`);
      expect(STATEMENTS, name).toContain(`revoke all on table ${name} from public, anon, authenticated;`);
      expect(STATEMENTS, name).toContain(`grant select, insert, update, delete on table ${name} to service_role;`);
      expect(ROLLBACK, name).toMatch(new RegExp(`drop table if exists [^;]*\\b${name}\\b`));
      expect(VERIFICATION, name).toContain(`'${name}'`);
    }
    // Aucune règle d'accès (« policy ») : seul le serveur lit et écrit.
    expect(STATEMENTS).not.toMatch(/create policy/i);
  });

  it("les tables d'un membre partent avec son compte ; les compteurs du budget n'ont aucun membre", () => {
    for (const name of MEMBER_TABLES) expect(table(name), name).toMatch(/user_id uuid (not null |primary key )?references profiles\(id\) on delete cascade/);
    expect(table("tryon_usage_months")).not.toMatch(/user/);
    expect(table("tryon_alerts")).not.toMatch(/user/);
  });

  it("aucune colonne d'image, de photo, d'adresse ni de date de naissance", () => {
    for (const name of TABLES) expect(table(name), name).not.toMatch(/image|photo|picture|url|birth|naissance|base64/i);
  });

  it("une commande n'accorde des essais qu'une fois (référence unique) ; une alerte une fois par période", () => {
    expect(table("tryon_bonus_grants")).toContain("order_ref text not null unique");
    expect(table("tryon_alerts")).toContain("unique (kind, period)");
  });
});

describe("fonctions : serveur seul, sans « security definer », sans déclencheur", () => {
  it("chaque fonction est réservée au serveur, retirée par le retour en arrière et vérifiée", () => {
    for (const name of FUNCTIONS) {
      expect(body(name), name).toContain("set search_path = public");
      expect(ROLLBACK, name).toContain(`drop function if exists ${name}(`);
      expect(SQL, name).toMatch(new RegExp(`revoke all on function ${name}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQL, name).toMatch(new RegExp(`grant execute on function ${name}\\([^)]*\\) to service_role;`));
      expect(VERIFICATION, name).toContain(`'${name}'`);
    }
    expect(VERIFICATION).toContain(`= ${FUNCTIONS.length} as fonctions_serveur_seul`);
    expect(STATEMENTS.match(/create or replace function/g)).toHaveLength(FUNCTIONS.length);
  });

  it("aucun déclencheur et aucune fonction « security definer » : la suppression d'un compte ne fait que des cascades", () => {
    expect(STATEMENTS).not.toMatch(/create (or replace )?trigger|security definer/i);
  });

  it("les paramètres sont vérifiés avant tout verrou ; une valeur absurde est refusée", () => {
    for (const name of FUNCTIONS.filter((fn) => fn !== "tryon_version")) {
      const text = body(name);
      expect(text, name).toContain(`raise exception '${name} : paramètres invalides'`);
      const lock = text.indexOf("pg_advisory_xact_lock");
      if (lock >= 0) expect(text.indexOf("paramètres invalides"), name).toBeLessThan(lock);
    }
  });

  it("verrous dans le même ordre partout : la ligne du membre, puis le budget ; l'heure lue après", () => {
    for (const name of ["tryon_reserve", "tryon_complete"]) {
      const text = body(name);
      const member = text.indexOf("from tryon_profiles t where t.user_id = p_user_id for update");
      const budget = text.indexOf("perform pg_advisory_xact_lock(hashtext('tryon_budget'));");
      const clock = text.indexOf("v_at := coalesce(p_at, clock_timestamp());");
      expect(member, name).toBeGreaterThan(0);
      expect(budget, name).toBeGreaterThan(member);
      expect(clock, name).toBeGreaterThan(budget);
    }
  });

  it("réservation : essai bloqué libéré après 3 minutes, puis les contrôles dans l'ordre de la mission", () => {
    const reserve = body("tryon_reserve");
    expect(reserve).toContain("v_window_start := v_at - interval '3 minutes';");
    expect(reserve).toContain("set status = 'failed', error_code = 'expired'");
    const order = ["'not_allowed'", "'in_progress'", "'quota_exhausted'", "'busy'", "'budget_reached'", "'reserved'"].map((status) => reserve.indexOf(status));
    for (const index of order) expect(index).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Budget : la dépense du mois, plus les essais en cours et celui-ci.
    expect(reserve).toContain("(v_spent_credits + (v_pending + 1) * p_credits_per_try) * p_price_per_credit_usd > p_budget_usd");
    // Purge opportuniste, jamais pendant un essai à instant fixé (tests).
    expect(reserve).toMatch(/if p_at is null then\s*perform tryon_purge\(12\);/);
  });

  it("réussite : le gratuit d'abord, puis l'offert qui expire le plus tôt ; alertes jamais écrites dans un « and »", () => {
    const complete = body("tryon_complete");
    expect(complete.indexOf("v_source := 'free';")).toBeLessThan(complete.indexOf("order by g.expires_at, g.created_at, g.id"));
    expect(complete).toContain("for update;");
    // SQL ne garantit pas l'ordre d'un « and » : tryon_alert_once (qui écrit) est toujours dans un « if » à part.
    expect(complete).not.toMatch(/ and tryon_alert_once/);
    expect(complete).toMatch(/if v_spent >= p_alert_threshold \* p_budget_usd then\s*if tryon_alert_once\('budget_80'/);
  });

  it("un échec ne garde qu'un code court, jamais un texte du fournisseur", () => {
    expect(body("tryon_fail")).toContain("p_error_code !~ '^[a-z][a-z0-9_]{0,39}$'");
    expect(table("tryon_events")).toContain("error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,39}$')");
  });

  it("dernière instruction : PostgREST relit le schéma", () => {
    expect(STATEMENTS.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
