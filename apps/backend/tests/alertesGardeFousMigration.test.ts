import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WISH_ALERT_RULES } from "@monapp/shared-types";

// Lot « durcissement des alertes » (revue de sécurité : acces-2, alertes-01
// à 04, entrees-06 à 08) : ce que le FICHIER de la migration 0040 doit
// garantir, vérifié sans base. Son comportement est vérifié sur une base
// Postgres locale et jetable (scénarios A à E, jamais Supabase), puis sur
// spotto-dev-2 par alertesPrix.test.ts. Le fichier 0040 reste tel quel :
// 0041 (alertesV2Migration.test.ts) remplace ses fonctions et sa sonde (3).

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0040_alertes_garde_fous.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0040-verification.sql"), "utf8");
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function body(name: string): string {
  const start = SQL.indexOf(`create or replace function ${name}(`);
  expect(start, name).toBeGreaterThan(0);
  const end = SQL.indexOf("$$;", SQL.indexOf("as $$", start));
  return SQL.slice(start, end);
}

const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle change :"));
const FUNCTIONS = ["wish_alerts_version", "wish_observe", "wish_alerts_claim", "wish_stock_report", "wish_mark_bought"];

describe("0040 : ordre, retour en arrière, droits", () => {
  it("refuse de s'appliquer sans 0036, avant de créer ou de modifier quoi que ce soit", () => {
    expect(STATEMENTS.trimStart()).toMatch(/^do \$\$\s*begin\s*if to_regclass\('public\.wish_tracking'\) is null[\s\S]*?raise exception '0040 demande la migration 0036/);
  });

  it("rejouable : colonnes, règles et index « if not exists », fonctions « create or replace »", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*alter table .* add column/.test(text))) expect(line).toContain("add column if not exists");
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*create (unique )?index/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS).not.toMatch(/create function/);
    expect(STATEMENTS.match(/add constraint/g)).toHaveLength(2);
    expect(STATEMENTS.match(/if not exists \(select 1 from pg_constraint/g)).toHaveLength(2);
  });

  it("aucun déclencheur : rien n'écrit dans une autre table pendant la suppression d'un compte (le système d'authentification n'a aucun droit sur les tables de l'app)", () => {
    expect(STATEMENTS).not.toMatch(/create (or replace )?trigger|security definer/i);
  });

  it("retour en arrière : règles retirées AVANT de rejouer 0036, puis la fonction, les colonnes et l'index", () => {
    const dropRule = ROLLBACK.indexOf("drop constraint if exists wish_tracking_sold_out_source_check");
    const replay = ROLLBACK.indexOf("rejouer le fichier 0036_alertes_prix.sql");
    expect(dropRule).toBeGreaterThan(0);
    expect(dropRule).toBeLessThan(replay);
    for (const text of [
      "drop function if exists wish_mark_bought(uuid, text, text, boolean, timestamptz)",
      "drop column if exists sold_out_source",
      "drop column if exists member_country",
      "drop column if exists bought_on",
      "drop index if exists stock_reports_key_day_idx",
    ]) {
      expect(ROLLBACK.indexOf(text), text).toBeGreaterThan(replay);
    }
  });

  it("chaque fonction : réservée au serveur, search_path fixé, vérifiée par le fichier de vérification", () => {
    for (const name of FUNCTIONS) {
      expect(body(name), name).toContain("set search_path = public");
      expect(SQL, name).toMatch(new RegExp(`revoke all on function ${name}\\(`));
      expect(SQL, name).toMatch(new RegExp(`grant execute on function ${name}\\([^)]*\\) to service_role`));
      expect(VERIFICATION, name).toContain(`'${name}'`);
    }
    expect(VERIFICATION).toContain(`= ${FUNCTIONS.length} as fonctions_serveur_seul`);
  });

  it("la sonde de 0040 répond 2 (le serveur de 0041 attend 3 : avec 0040 seule, il coupe les alertes)", () => {
    expect(body("wish_alerts_version")).toContain("return 2;");
  });

  it("verrous : partagé pour les observations, les signalements et les achats (avant tout verrou de ligne), exclusif pour l'envoi", () => {
    const SHARED = "perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));";
    for (const name of ["wish_observe", "wish_stock_report", "wish_mark_bought"]) {
      const text = body(name);
      expect(text.indexOf(SHARED), name).toBeGreaterThan(0);
      expect(text.indexOf(SHARED), name).toBeLessThan(text.indexOf("for update"));
    }
    expect(body("wish_alerts_claim")).toContain("perform pg_advisory_xact_lock(hashtext('wish_alerts'));");
  });

  it("le suivi ne garde que des jours : aucune écriture de updated_at", () => {
    for (const name of ["wish_observe", "wish_stock_report", "wish_mark_bought"]) {
      for (const update of body(name).split("update wish_tracking").slice(1)) expect(update.slice(0, update.indexOf(";")), name).not.toContain("updated_at");
    }
  });
});

describe("A : un membre seul ne change jamais ce que reçoivent les autres", () => {
  it("« Plus disponible » : les envies des autres seulement à partir de N auteurs différents sur la durée de garde des signalements", () => {
    const report = body("wish_stock_report");
    expect(report).toContain("count(distinct r.user_id)");
    expect(report).toContain(`r.created_on >= v_today - ${WISH_ALERT_RULES.retentionDays}`);
    expect(report).toContain("v_reporters >= 2 or t.user_id = p_user_id");
    expect(report).toContain("else 'members' end");
    expect(report).not.toContain("insert into wish_alert_events");
  });

  it("« De retour en stock » seulement après un « épuisé » annoncé par la boutique ; baisse bloquée seulement par lui", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("if t.stock_state = 'sold_out' and t.sold_out_source = 'shop' and v_alerts and t.watch_restock then");
    expect(observe).toContain("v_new_source := 'shop';");
    expect(observe).toMatch(/and not \(v_new_stock = 'sold_out' and v_new_source = 'shop'\) then/);
    expect(body("wish_alerts_claim")).toContain("and not (e.stock_state = 'sold_out' and e.sold_out_source = 'shop')) then");
    // Une origine pour chaque « épuisée » (règle de la base), inconnue avant 0040 : comme un signalement.
    expect(STATEMENTS).toContain("update wish_tracking set sold_out_source = 'members' where stock_state = 'sold_out' and sold_out_source is null;");
    expect(STATEMENTS).toContain("((stock_state = 'sold_out') = (sold_out_source is not null))");
  });
});

describe("B, C, D : une envie par membre, réécrite seulement si elle change ; pays du membre ; achat par pièce", () => {
  it("wish_observe : une seule envie par membre et par pièce, réécrite seulement si quelque chose change", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("select distinct on (tr.user_id) tr.wishlist_item_id as id");
    expect(observe).toContain("where tr.wishlist_item_id = any(v_ids)");
    expect(observe).toMatch(/is distinct from\s+\(v_last_price, v_last_currency, v_last_country, v_today, v_new_stock, v_new_source,/);
  });

  it("le prix n'est regardé que pour le pays du membre (sans lui : celui de la référence, comme avant)", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("v_row_country := coalesce(t.member_country, t.ref_country);");
    expect(observe).toContain("if v_cents is not null and (v_row_country is null or v_country = v_row_country) then");
  });

  it("une pièce achetée (bought_on) n'alerte jamais, ni à l'observation ni à l'envoi ; seules les envies de l'acheteur sont marquées", () => {
    expect(body("wish_observe")).toContain("(tr.bought_on is not null or (w.product_match_id is not null and exists (");
    expect(body("wish_alerts_claim")).toContain("if e.bought_on is not null");
    expect(body("wish_mark_bought")).toContain("where t.user_id = p_user_id");
  });
});
