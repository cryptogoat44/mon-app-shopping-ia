import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WISH_ALERT_RULES } from "@monapp/shared-types";
import { WISH_ALERTS_GUARDED_VERSION } from "../src/lib/wishAlertsSchema.js";

// Alertes, nouvelle version (migration 0041) : ce que le FICHIER de la
// migration doit garantir, vérifié sans base. Son comportement (seuil, série
// de 3 signalements, « Aider les autres membres », jours seulement,
// suppression d'un compte) est vérifié sur une base Postgres locale et
// jetable (jamais Supabase), puis sur spotto-dev-2 par alertesPrix.test.ts.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0041_alertes_v2.sql"), "utf8");
const SQL_0036 = readFileSync(join(__dirname, "../supabase/migrations/0036_alertes_prix.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0041-verification.sql"), "utf8");
const STATEMENTS = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function body(name: string): string {
  const start = SQL.indexOf(`create or replace function ${name}(`);
  expect(start, name).toBeGreaterThan(0);
  const end = SQL.indexOf("$$;", SQL.indexOf("as $$", start));
  return SQL.slice(start, end);
}

const HEADER = SQL.slice(0, SQL.indexOf("do $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle change :"));
const FUNCTIONS = ["wish_alerts_version", "wish_observe", "wish_stock_report", "wish_alerts_claim", "wish_alerts_mark_sent", "wish_alerts_purge"];

describe("0041 : ordre, rejouable, droits, aucun déclencheur", () => {
  it("refuse de s'appliquer sans 0040, avant de créer ou de modifier quoi que ce soit", () => {
    expect(STATEMENTS.trimStart()).toMatch(/^do \$\$\s*begin\s*if to_regclass\('public\.wish_tracking'\) is null[\s\S]*?wish_mark_bought\(uuid, text, text, boolean, timestamptz\)[\s\S]*?raise exception '0041 demande la migration 0040/);
  });

  it("rejouable : colonnes « if not exists » / « if exists », index « if not exists », règles ajoutées seulement si absentes ; les reprises de données ne tournent qu'une fois", () => {
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*alter table .* add column/.test(text))) expect(line).toContain("add column if not exists");
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*alter table .* drop column/.test(text))) expect(line).toContain("drop column if exists");
    for (const line of STATEMENTS.split("\n").filter((text) => /^\s*create (unique )?index/.test(text))) expect(line).toContain("if not exists");
    expect(STATEMENTS).not.toMatch(/create function/);
    expect(STATEMENTS.match(/add constraint/g)).toHaveLength(4);
    // La reprise des « épuisée » venus des membres : seulement tant que la règle n'a pas 'reported'.
    expect(STATEMENTS).toMatch(/pg_get_constraintdef\(oid\) like '%reported%'\) then\s*alter table wish_tracking drop constraint if exists wish_tracking_sold_out_source_check;\s*update wish_tracking t set sold_out_source = 'reported'/);
    // La référence de 0036 devient un seuil seulement tant qu'elle existe.
    expect(STATEMENTS).toMatch(/column_name = 'ref_price'\) then\s*execute \$sql\$\s*update wish_watches w/);
  });

  it("aucun déclencheur ni « security definer » : rien n'écrit dans une autre table pendant la suppression d'un compte (le rôle de l'authentification n'a aucun droit sur les tables de l'app)", () => {
    expect(STATEMENTS).not.toMatch(/create (or replace )?trigger|security definer/i);
  });

  it("chaque fonction : réservée au serveur, search_path fixé, vérifiée par le fichier de vérification ; l'ancienne wish_observe est retirée", () => {
    for (const name of FUNCTIONS) {
      expect(body(name), name).toContain("set search_path = public");
      expect(SQL, name).toMatch(new RegExp(`revoke all on function ${name}\\(`));
      expect(SQL, name).toMatch(new RegExp(`grant execute on function ${name}\\([^)]*\\) to service_role`));
      expect(VERIFICATION, name).toContain(`'${name}'`);
    }
    expect(VERIFICATION).toContain(`and not has_function_privilege('authenticated', p.oid, 'execute')) = ${FUNCTIONS.length}`);
    expect(VERIFICATION).toContain("to_regprocedure('public.wish_stock_report(uuid, text, text, integer, timestamptz)') is null as fonctions_serveur_seul");
    expect(STATEMENTS).toContain("drop function if exists wish_observe(jsonb, timestamptz);");
    expect(STATEMENTS).toContain("grant execute on function wish_observe(jsonb, uuid, timestamptz) to service_role;");
    // « Plus disponible » prend le pays de la recherche : l'ancienne signature disparaît.
    expect(STATEMENTS).toContain("drop function if exists wish_stock_report(uuid, text, text, integer, timestamptz);");
    expect(STATEMENTS).toContain("grant execute on function wish_stock_report(uuid, text, text, integer, text, timestamptz) to service_role;");
  });

  it("la sonde répond la version attendue par le serveur (3 : alertes allumées seulement avec 0041)", () => {
    expect(WISH_ALERTS_GUARDED_VERSION).toBe(3);
    expect(body("wish_alerts_version")).toContain(`return ${WISH_ALERTS_GUARDED_VERSION};`);
    expect(VERIFICATION).toContain(`wish_alerts_version() = ${WISH_ALERTS_GUARDED_VERSION} as sonde`);
  });

  it("retour en arrière : fonctions et règles de 0041 retirées et colonnes remises AVANT de rejouer 0036 puis 0040, colonnes nouvelles retirées après", () => {
    const replay = ROLLBACK.indexOf("rejouer 0036_alertes_prix.sql, puis 0040_alertes_garde_fous.sql");
    expect(replay).toBeGreaterThan(0);
    for (const text of [
      "drop function if exists wish_observe(jsonb, uuid, timestamptz)",
      "drop function if exists wish_alerts_claim(integer, timestamptz)",
      "drop function if exists wish_stock_report(uuid, text, text, integer, text, timestamptz)",
      "drop constraint if exists wish_tracking_sold_out_source_check",
      "update wish_tracking set sold_out_source = 'members' where sold_out_source = 'reported'",
      "add column if not exists ref_price",
      "add column if not exists send_after",
      "add column if not exists last_sent_price_drop_at",
    ]) {
      expect(ROLLBACK.indexOf(text), text).toBeGreaterThan(0);
      expect(ROLLBACK.indexOf(text), text).toBeLessThan(replay);
    }
    for (const text of ["drop column if exists target_price", "drop column if exists sent_on", "drop column if exists in_streak", "drop column if exists country", "drop column if exists help_others"]) {
      expect(ROLLBACK.indexOf(text), text).toBeGreaterThan(replay);
    }
  });

  it("verrous : partagé « wish_alerts » puis verrou de l'empreinte pour les observations et les signalements (avant tout verrou de ligne) ; exclusif pour l'envoi et la purge", () => {
    const SHARED = "perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));";
    for (const name of ["wish_observe", "wish_stock_report"]) {
      const text = body(name);
      const key = text.indexOf("perform pg_advisory_xact_lock(hashtext('wish_key:'");
      expect(text.indexOf(SHARED), name).toBeGreaterThan(0);
      expect(key, name).toBeGreaterThan(text.indexOf(SHARED));
      expect(key, name).toBeLessThan(text.indexOf("for update"));
    }
    for (const name of ["wish_alerts_claim", "wish_alerts_mark_sent", "wish_alerts_purge"]) expect(body(name)).toContain("perform pg_advisory_xact_lock(hashtext('wish_alerts'));");
  });
});

describe("point 5 : aucune alerte ne désigne sa recherche, son signalement ou le membre à son origine", () => {
  it("schéma : aucune colonne d'origine sur les tables des alertes (0036 + 0041)", () => {
    const definition = SQL_0036.slice(SQL_0036.indexOf("create table if not exists wish_alert_events ("), SQL_0036.indexOf(");", SQL_0036.indexOf("create table if not exists wish_alert_events (")));
    const added = [...SQL.matchAll(/alter table (wish_alert_events|wish_watches|wish_tracking) add column if not exists (\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    for (const column of [definition, ...added]) expect(column).not.toMatch(/search|report|observer|searcher|buyer|source_user|match_id|merchant_url|\burl\b/);
    expect(VERIFICATION).toContain("as aucune_origine");
  });

  it("le membre qui cherche (p_observer) est lu pour son réglage et la règle des auteurs, jamais écrit avec une alerte", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("select coalesce(p.help_others, false) into v_help from profiles p where p.id = p_observer;");
    for (const insert of observe.split("insert into wish_alert_events").slice(1)) expect(insert.slice(0, insert.indexOf(";"))).not.toContain("p_observer");
    expect(observe).not.toMatch(/raise (notice|log|info|warning)/);
    const report = body("wish_stock_report");
    for (const insert of report.split("insert into wish_alert_events").slice(1)) expect(insert.slice(0, insert.indexOf(";"))).not.toMatch(/p_user_id|stock_reports\.id/);
  });

  it("le signalement garde son auteur (s'il aidait les autres, et le pays de sa recherche), dans sa propre table", () => {
    expect(body("wish_stock_report")).toContain("insert into stock_reports (user_id, match_key_hash, created_on, in_streak, helps_others, country)");
    expect(body("wish_stock_report")).toContain("values (p_user_id, p_key, v_today, v_country is not null, v_help, v_country);");
    expect(STATEMENTS).toContain("alter table stock_reports add column if not exists country text check (country is null or country ~ '^[a-z]{2}$');");
  });

  it("l'en-tête ne promet pas plus que le schéma : aucune colonne d'origine, mais un rapprochement reste possible pour qui a toute la base", () => {
    expect(HEADER).toContain("Aucune colonne ne relie une alerte à son origine");
    expect(HEADER).not.toContain("Rien ne relie une alerte à son origine");
    expect(HEADER.replace(/\n--\s+/g, " ")).toContain("quelqu'un qui aurait un accès complet à la base pourrait encore rapprocher une alerte d'une recherche faite ce jour-là");
  });
});

describe("point 2 : seuil, série de 3 d'affilée, « Aider les autres membres »", () => {
  it("baisse : une alerte seulement en PASSANT sous le seuil (below_target), réarmée au seuil ou au-dessus ; même pays, même devise ; jamais pour une pièce épuisée", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("elsif t.target_currency = v_currency and t.target_country = v_country then");
    expect(observe).toContain("if v_cents < round(t.target_price * 100) then");
    expect(observe).toContain("if not t.below_target and v_new_stock <> 'sold_out' then");
    expect(observe).toMatch(/-- Revenu au seuil ou au-dessus : la cloche se réarme\.\s*v_below := false;/);
    // Sans seuil : le premier prix vu le devient, sans alerte.
    expect(observe).toMatch(/if t\.target_price is null then[\s\S]*?v_target_price := v_cents \/ 100\.0;/);
    // À l'envoi : périmée si le prix est remonté (ou la pièce épuisée).
    expect(body("wish_alerts_claim")).toContain("elsif e.alert_kind = 'price_drop' and (not e.below_target or e.stock_state = 'sold_out') then");
  });

  it(`rupture : ${WISH_ALERT_RULES.stockReportersToConfirm} membres différents d'affilée, du même pays, qui aident les autres ; un signalement sans pays ne compte dans aucune série`, () => {
    expect(WISH_ALERT_RULES.stockReportersToConfirm).toBe(3);
    const report = body("wish_stock_report");
    expect(report).toContain("where r.match_key_hash = p_key and r.country = v_country and r.in_streak and r.helps_others and p.help_others;");
    expect(report).toContain(`v_confirmed := v_help and v_country is not null and v_reporters >= ${WISH_ALERT_RULES.stockReportersToConfirm};`);
    expect(report).toContain("v_country text := case when coalesce(p_country, '') ~ '^[a-z]{2}$' then p_country end;");
    // Plus aucune fenêtre de jours (seulement l'effacement des signalements à 30 jours).
    expect(report).not.toMatch(/created_on >= v_today -/);
    expect(STATEMENTS).toContain("create index if not exists stock_reports_streak_idx on stock_reports (match_key_hash, country) where in_streak;");
  });

  it("rupture établie : dans ce pays seulement, une envie par membre (la même sélection que wish_observe), plus toutes les envies de l'auteur", () => {
    const report = body("wish_stock_report");
    const selection = report.slice(report.indexOf("select distinct on (tr.user_id)"), report.indexOf("tr.wishlist_item_id) c;"));
    expect(selection).toContain("and coalesce(tr.member_country, tr.last_country) = v_country");
    const order = (text: string) => {
      const start = text.indexOf("(coalesce(ww.notify_price_drop");
      return text.slice(start, text.indexOf("desc,", start));
    };
    const observe = body("wish_observe");
    expect(order(selection)).toBe(order(observe.slice(observe.indexOf("select distinct on (tr.user_id)"))));
    expect(report).toContain("and (t.wishlist_item_id = any(v_selected) or t.user_id = p_user_id)");
    expect(report).toContain("when tr.wishlist_item_id = any(v_selected) then 'members'");
    expect(report).toMatch(/where tr\.wishlist_item_id = any\(v_selected\)\s*and not \(tr\.stock_state = 'sold_out'/);
    // L'observation regarde d'abord l'envie du pays, puis la même règle (cloche, identifiant) ; « en stock » remet les autres envies de qui cherche.
    expect(observe).toContain("coalesce(coalesce(tr.member_country, tr.last_country) = v_country, false) desc,");
    expect(observe).toMatch(/where o\.user_id = p_observer and o\.match_key_hash = v_key[\s\S]*?and o\.stock_state = 'sold_out' and not \(o\.wishlist_item_id = any\(v_ids\)\)/);
  });

  it("stock par pays : une observation ne touche le stock des autres que dans son pays (les deux connus) ; sans pays, seulement les envies de qui cherche", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("v_apply_stock := v_stock is not null and (v_mine or (v_others and v_row_country = v_country));");
    expect(observe).toContain("v_others := v_help and v_country is not null and not (v_reporter_here and v_established);");
    expect(observe).toContain("update stock_reports set in_streak = false where match_key_hash = v_key and country = v_country and in_streak;");
    expect(observe).toMatch(/v_new_source := case when t\.stock_state = 'sold_out' and t\.sold_out_source = 'members' then 'members' else 'shop' end;/);
  });

  it("fin d'une rupture : avant qu'elle soit établie, tout « en stock » d'un membre qui aide les autres clôt la série ; une fois établie, celui d'un auteur ne change que ses envies ; le premier non-auteur envoie « De retour en stock »", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("v_confirmed := t.stock_state = 'sold_out' and t.sold_out_source in ('shop', 'members');");
    expect(observe).toMatch(/if v_confirmed and not v_reporter_here and not \(v_mine and v_reporter_any\)\s*and v_alerts and t\.watch_restock then/);
    // Établie : une envie de ce pays 'shop' ou 'members' (Google, ou 3 d'affilée).
    expect(observe).toMatch(/v_established := exists \(select 1 from wish_tracking e[\s\S]*?e\.sold_out_source in \('shop', 'members'\)[\s\S]*?= v_country\);/);
    // La série n'est close que si l'observation touche les autres (jamais pour l'auteur devant une rupture établie).
    expect(observe.indexOf("v_others := v_help")).toBeLessThan(observe.indexOf("if v_others and v_stock is true then"));
    expect(observe.indexOf("v_reporter_here := ")).toBeLessThan(observe.indexOf("v_others := v_help"));
  });

  it("« Aider les autres membres » coupé : seulement ses envies (observation et signalement), sans toucher la série ni compter", () => {
    const observe = body("wish_observe");
    expect(observe).toContain("and (tr.user_id = p_observer or v_others)");
    expect(observe).toContain("(tr.user_id = p_observer\n                    or (v_others and");
    expect(body("wish_stock_report")).toContain("select coalesce(p.help_others, false) into v_help from profiles p where p.id = p_user_id;");
    expect(STATEMENTS).toContain("alter table profiles add column if not exists help_others boolean not null default true;");
  });

  it("un seuil choisi sans prix connu part armé (décision du fondateur) ; la limite « devise du pays seulement » est écrite", () => {
    expect(HEADER).toContain("seuil choisi alors qu'aucun prix n'avait encore été vu part armé");
    expect(HEADER).toContain("seuls les prix dans la devise du pays de la");
    expect(body("wish_observe")).toContain("un seuil choisi sans prix connu est armé.");
  });

  it("plus de limite « 1 par envie et par sorte sur 7 jours » ; « 5 par personne et par jour » gardée", () => {
    const claim = body("wish_alerts_claim");
    expect(claim).not.toMatch(/7 days|interval '7/);
    expect(WISH_ALERT_RULES.perPersonPerDay).toBe(5);
    expect(claim.match(/\(s\.status = 'sent' and s\.sent_on = v_today\)/g)).toHaveLength(2);
    expect(claim.match(/\) < 5\b|\) >= 5 then/g)).toHaveLength(2);
  });
});

describe("point 6 : le jour seulement ; une heure exacte seulement pendant l'envoi", () => {
  it("les heures de création et d'envoi disparaissent (created_at, send_after, sent_at, last_sent_*_at, ref_*) ; restent les jours", () => {
    for (const column of ["created_at", "send_after", "sent_at"]) expect(STATEMENTS).toContain(`alter table wish_alert_events drop column if exists ${column};`);
    for (const kind of ["price_drop", "restock", "sold_out"]) expect(STATEMENTS).toContain(`alter table wish_watches drop column if exists last_sent_${kind}_at;`);
    expect(STATEMENTS).toContain("alter table wish_alert_events add column if not exists sent_on date;");
    for (const name of FUNCTIONS) expect(body(name), name).not.toMatch(/created_at|send_after|sent_at|last_sent_/);
  });

  it("la réservation (claimed_at, pushing_at) est effacée dès que l'alerte est close, et la base l'exige", () => {
    expect(STATEMENTS).toContain("check (status = 'pending' or (claimed_at is null and pushing_at is null))");
    expect(body("wish_alerts_mark_sent")).toMatch(/claimed_at = null,\s*pushing_at = null/);
    expect(body("wish_alerts_mark_sent")).toContain("sent_on = coalesce((ev.pushing_at at time zone 'Europe/Paris')::date, v_today)");
    expect(HEADER).toContain("(claimed_at, pushing_at, 15 minutes)");
  });

  it("une réservation échue sans envoi demandé est effacée à chaque passage, que l'alerte soit reprise ou non ; une alerte gardée pour le lendemain n'en garde pas", () => {
    const claim = body("wish_alerts_claim");
    const reconcile = claim.indexOf("perform wish_alerts_mark_sent(");
    const cleanup = claim.indexOf("set claimed_at = null\n   where ev.status = 'pending' and ev.pushing_at is null and ev.claimed_at < v_lease");
    expect(cleanup).toBeGreaterThan(reconcile);
    expect(cleanup).toBeLessThan(claim.indexOf("set status = 'expired'"));
    expect(claim).toMatch(/if v_status = 'held' then[\s\S]*?update wish_alert_events set claimed_at = null where id = e\.id and claimed_at is not null;/);
    expect(HEADER).toContain("le serveur relance un passage 16 minutes après un");
  });

  it(`une alerte jamais envoyée expire le ${WISH_ALERT_RULES.expiryDays}e jour (par date) ; alertes et signalements effacés à ${WISH_ALERT_RULES.retentionDays} jours (par date)`, () => {
    expect(body("wish_alerts_claim")).toContain(`ev.created_on <= v_today - ${WISH_ALERT_RULES.expiryDays}`);
    const purge = body("wish_alerts_purge");
    expect(purge).toContain(`created_on < v_today - ${WISH_ALERT_RULES.retentionDays} and created_on >= v_since limit p_limit`);
  });

  it("le choix et sa raison sont écrits dans l'en-tête de la migration", () => {
    expect(HEADER).toMatch(/Heures : seul le JOUR \(heure de Paris\) est gardé/);
    expect(HEADER).toMatch(/Pourquoi : une heure exacte de création ou d'envoi permettrait de\s*--\s+rapprocher une alerte de la recherche qui l'a fait naître/);
  });
});

describe("point 7 : la file ne renvoie que de quoi écrire une notification générique", () => {
  it("wish_alerts_claim : l'alerte, sa sorte, l'envie et la langue — ni titre, ni boutique, ni prix", () => {
    const claim = body("wish_alerts_claim");
    const signature = claim.slice(claim.indexOf("returns table ("), claim.indexOf(")", claim.indexOf("returns table (")));
    expect([...signature.matchAll(/^\s+(\w+) /gm)].map((match) => match[1])).toEqual(["event_id", "user_id", "wishlist_item_id", "kind", "locale"]);
    expect(claim).not.toMatch(/title|merchant_name|old_price|new_price/);
  });
});
