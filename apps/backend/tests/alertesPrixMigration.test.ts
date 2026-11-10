import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Alertes prix et stock (lot 2) : ce que le FICHIER de la migration 0036 doit
// garantir, vérifié sans base (le comportement lui-même est vérifié sur
// spotto-dev-2 par alertesPrix.test.ts) : le retour en arrière ne trahit
// aucun choix des membres, les fonctions prennent leurs verrous dans un ordre
// unique (aucun interblocage entre l'envoi et les observations), une alerte
// est due dès sa création (décision du fondateur : « à la seconde près »), et
// le suivi d'une envie ne garde que des jours.

const SQL = readFileSync(join(__dirname, "../supabase/migrations/0036_alertes_prix.sql"), "utf8");
const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0036-verification.sql"), "utf8");

/** Le corps d'une fonction de la migration, de « create or replace function » à « $$; ». */
function body(name: string): string {
  const start = SQL.indexOf(`create or replace function ${name}(`);
  expect(start, name).toBeGreaterThan(0);
  const end = SQL.indexOf("$$;", SQL.indexOf("as $$", start));
  return SQL.slice(start, end);
}

const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
const FUNCTIONS = ["wish_alerts_version", "wish_observe", "wish_alerts_claim", "wish_alerts_mark_pushing", "wish_alerts_mark_sent", "wish_alerts_release", "wish_stock_report", "wish_alerts_purge"];

// Registre des migrations : « 0036 demande 0035 ». Une base « avec 0036,
// sans 0035 » ne peut donc pas exister (les autres combinaisons :
// alertesPrixRoutes.test.ts et notificationsTelephone.test.ts).
describe("ordre des migrations", () => {
  it("0036 refuse de s'appliquer sans 0035 (push_tokens), avant de créer ou de modifier quoi que ce soit", () => {
    // Le fichier sans ses commentaires : le refus est sa toute première instruction.
    const statements = SQL.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trimStart();
    expect(statements).toMatch(/^do \$\$\s*begin\s*if to_regclass\('public\.push_tokens'\) is null then\s*raise exception '0036 demande la migration 0035 \(push_tokens\)/);
    // Elle ajoute ses colonnes à la table de 0035 : sans cette table, rien ne tiendrait.
    expect(statements).toContain("alter table push_tokens add column if not exists notify_messages");
    expect(statements).toContain("alter table push_tokens add column if not exists notify_alerts");
  });
});

describe("retour en arrière de 0036", () => {
  it("oublie d'abord les appareils des seules alertes, AVANT de remettre l'ancien serveur (il envoie les messages à tous les appareils) et avant de retirer la colonne", () => {
    const deleteLine = "--   delete from push_tokens where notify_messages = false;";
    const firstDelete = ROLLBACK.indexOf(deleteLine);
    expect(firstDelete).toBeGreaterThan(0);
    expect(ROLLBACK.slice(0, firstDelete)).toContain("JUSTE AVANT de remettre un serveur qui ne connaît pas 0036");
    // Rejouée juste avant de retirer la colonne (un appareil a pu se réenregistrer entre-temps).
    const drop = ROLLBACK.indexOf("alter table push_tokens drop column if exists notify_messages");
    expect(ROLLBACK.lastIndexOf(deleteLine)).toBeGreaterThan(firstDelete);
    expect(ROLLBACK.lastIndexOf(deleteLine)).toBeLessThan(drop);
    expect(ROLLBACK).toContain("alter table push_tokens drop column if exists notify_alerts");
    // Plus jamais la promesse fausse « reçoivent de nouveau les messages, comme avant ».
    expect(ROLLBACK).not.toContain("reçoivent de nouveau les messages");
  });

  it("chaque fonction créée est retirée par le retour en arrière, réservée au serveur, et vérifiée par le fichier de vérification", () => {
    for (const name of FUNCTIONS) {
      body(name);
      expect(ROLLBACK, name).toContain(`drop function if exists ${name}(`);
      expect(SQL, name).toMatch(new RegExp(`revoke all on function ${name}\\(`));
      expect(SQL, name).toMatch(new RegExp(`grant execute on function ${name}\\([^)]*\\) to service_role`));
      expect(VERIFICATION, name).toContain(`'${name}'`);
    }
    expect(VERIFICATION).toContain(`= ${FUNCTIONS.length} as fonctions_serveur_seul`);
  });
});

describe("verrous : l'envoi et les observations ne se croisent jamais (aucun interblocage)", () => {
  const SHARED = "perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));";
  const EXCLUSIVE = "perform pg_advisory_xact_lock(hashtext('wish_alerts'));";

  it("observation et « Plus disponible » : verrou partagé, pris AVANT tout verrou de ligne", () => {
    for (const name of ["wish_observe", "wish_stock_report"]) {
      const text = body(name);
      expect(text, name).toContain(SHARED);
      expect(text.indexOf(SHARED), name).toBeLessThan(text.indexOf("for update"));
      expect(text, name).not.toContain(EXCLUSIVE);
    }
  });

  it("file, « peut-être envoyée », « envoyée », réservations rendues et purge : verrou exclusif, en premier", () => {
    for (const name of ["wish_alerts_claim", "wish_alerts_mark_pushing", "wish_alerts_mark_sent", "wish_alerts_release", "wish_alerts_purge"]) {
      const text = body(name);
      expect(text, name).toContain(EXCLUSIVE);
      const firstWrite = Math.min(...["update ", "delete from", "for update", "perform wish_alerts_mark_sent"].map((word) => text.indexOf(word, text.indexOf("begin"))).filter((index) => index >= 0));
      expect(text.indexOf(EXCLUSIVE), name).toBeLessThan(firstWrite);
    }
  });
});

describe("jamais renvoyée, jamais perdue en route", () => {
  it("une alerte « peut-être envoyée » (pushing_at) n'est jamais réservée de nouveau, ni expirée, ni désactivée : elle est notée « envoyée »", () => {
    const claim = body("wish_alerts_claim");
    const reconcile = claim.indexOf("perform wish_alerts_mark_sent(");
    expect(reconcile).toBeGreaterThan(0);
    expect(claim.slice(reconcile, claim.indexOf("limit 200", reconcile))).toContain("ev.pushing_at is not null and ev.claimed_at < v_lease");
    // Expirée, désactivée, réservée : seulement sans envoi en cours ni demandé.
    for (const marker of ["set status = 'expired'", "set status = 'disabled'", "for e in"]) {
      const part = claim.slice(claim.indexOf(marker), claim.indexOf(";", claim.indexOf(marker)) + 400);
      expect(part, marker).toContain("ev.pushing_at is null");
      expect(part, marker).toContain("(ev.claimed_at is null or ev.claimed_at < v_lease)");
    }
    expect(body("wish_alerts_release")).toContain("pushing_at = null");
  });

  it("au-delà des limites, une alerte attend le premier instant permis dans ses 72 h (retour en stock compris), sinon « limitée »", () => {
    const claim = body("wish_alerts_claim");
    expect(claim).toContain("v_wait_until <= e.alert_created_at + interval '72 hours' then 'held' else 'limited'");
    expect(claim).toContain("update wish_alert_events set send_after = v_wait_until, claimed_at = null where id = e.id;");
  });
});

describe("dans le doute, aucune alerte ; envoyée tout de suite ; le suivi au jour près", () => {
  it("baisse de prix : jamais pour une pièce épuisée (à l'observation comme à l'envoi)", () => {
    expect(body("wish_observe")).toMatch(/v_alerts and t\.watch_price_drop\s+and v_new_stock <> 'sold_out'/);
    expect(body("wish_alerts_claim")).toContain("and e.stock_state <> 'sold_out') then");
  });

  it("toute alerte est due dès sa création (send_after = l'instant de l'observation) : plus aucun délai tiré au hasard", () => {
    const observe = body("wish_observe");
    const inserts = observe.split("insert into wish_alert_events").slice(1).map((part) => part.slice(0, part.indexOf(";")));
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) expect(insert).toMatch(/v_today, v_now, v_now\)/);
    expect(SQL).not.toMatch(/random\(\)/);
    expect(SQL).not.toMatch(/2 à 8 h|interval '2 hours'/);
  });

  it("le suivi d'une envie ne garde que des jours : ni une observation, ni un signalement, ni un envoi ne touche updated_at", () => {
    for (const name of ["wish_observe", "wish_stock_report", "wish_alerts_mark_sent"]) {
      const text = body(name);
      for (const update of text.split("update wish_tracking").slice(1)) {
        const statement = update.slice(0, update.indexOf(";"));
        expect(statement, name).not.toContain("updated_at");
      }
    }
  });

  it("jamais qui a cherché, acheté ou signalé : aucune colonne de personne ni d'adresse dans le suivi et les alertes", () => {
    for (const table of ["wish_tracking", "wish_alert_events"]) {
      const start = SQL.indexOf(`create table if not exists ${table} (`);
      const definition = SQL.slice(start, SQL.indexOf(");", start));
      expect(definition, table).not.toMatch(/searcher|buyer|reporter|observer|product_match_id|merchant_url|\burl\b/);
    }
  });
});
