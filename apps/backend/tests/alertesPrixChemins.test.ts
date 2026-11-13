import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Alertes prix et stock (lot 2) : garde-fous lus dans le code, sans base.
// - CHAQUE chemin qui crée une envie (insertion dans wishlist_items) crée
//   aussi son suivi (trackNewWish) : une envie oubliée ne recevrait jamais
//   d'alerte. Un nouveau chemin sans trackNewWish fait échouer ce test.
// - L'observation n'envoie à la base le membre qui a cherché que pour son
//   réglage « Aider les autres membres » et la règle des auteurs (0041) ; un
//   achat n'est jamais observé.
// - La migration ne garde ni l'auteur d'une recherche, ni l'acheteur, ni une adresse.
// - Nouvelle version (0041, point 5 du fondateur) : jamais au journal, à
//   Sentry ni à PostHog le membre à l'origine d'une observation ou d'un
//   signalement avec les envies ou les membres prévenus ; l'envoi reste
//   détaché de la requête qui l'a déclenché.

const SRC = join(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("chaque envie créée a son suivi", () => {
  it("toute insertion dans wishlist_items est suivie de trackNewWish dans le même fichier", () => {
    const inserting = sourceFiles(SRC).filter((file) => /from\("wishlist_items"\)\s*\.(?:insert|upsert)\(/.test(readFileSync(file, "utf8")));
    // Les deux chemins connus le 9 novembre 2026 : « Garder » un résultat, « Garder » l'envie d'un ami.
    expect(inserting.map((file) => file.split("/src/")[1]).sort()).toEqual(["routes/collections.ts", "routes/wishlist.ts"]);
    for (const file of inserting) {
      const text = readFileSync(file, "utf8");
      const inserts = text.match(/from\("wishlist_items"\)\s*\.(?:insert|upsert)\(/g) ?? [];
      const tracked = text.match(/await trackNewWish\(/g) ?? [];
      expect(tracked.length, file).toBeGreaterThanOrEqual(inserts.length);
    }
  });
});

// Lot « durcissement des alertes » (entrees-07, alertes-02) : le plafond
// d'envies par membre est vérifié par CHAQUE chemin qui crée une envie, avant
// l'insertion. Un nouveau chemin sans ce contrôle fait échouer ce test.
describe("chaque chemin qui crée une envie vérifie le plafond d'envies", () => {
  it("toute insertion dans wishlist_items est précédée de wishlistFull dans le même fichier (409 « wishlist_full »)", () => {
    const inserting = sourceFiles(SRC).filter((file) => /from\("wishlist_items"\)\s*\.(?:insert|upsert)\(/.test(readFileSync(file, "utf8")));
    expect(inserting.length).toBeGreaterThan(0);
    for (const file of inserting) {
      const text = readFileSync(file, "utf8");
      const firstInsert = text.search(/from\("wishlist_items"\)\s*\.(?:insert|upsert)\(/);
      const check = text.indexOf("await wishlistFull(");
      expect(check, file).toBeGreaterThan(-1);
      expect(text.slice(check, check + 200), file).toContain("WISHLIST_FULL");
      // Dans la route qui insère, le contrôle vient avant l'insertion.
      const routeStart = text.lastIndexOf("fastify.post(", firstInsert);
      expect(text.slice(routeStart, firstInsert), file).toContain("await wishlistFull(");
    }
  });
});

describe("jamais qui a cherché, acheté ou signalé avec une observation", () => {
  it("wish_observe reçoit le lot d'observations et le membre qui cherche (rien d'autre) ; aucun achat n'est observé", () => {
    const text = readFileSync(join(SRC, "lib/wishObserve.ts"), "utf8");
    expect(text.match(/rpc\("wish_observe", \{([^}]*)\}\)/)?.[1]?.trim()).toBe("p_batch: observations, p_observer: input.observerId");
    expect(text).not.toMatch(/observePurchase|"purchase"/);
    // Une observation : empreinte, boutique, prix, devise, pays, stock. Rien d'autre.
    const shape = text.match(/export interface Observation \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect([...shape.matchAll(/^\s+(\w+):/gm)].map((match) => match[1])).toEqual(["k", "m", "p", "c", "n", "s"]);
  });

  it("les résultats sont observés aux cinq endroits où une recherche les rend, après reply.send", () => {
    const text = readFileSync(join(SRC, "routes/searches.ts"), "utf8");
    const calls = [...text.matchAll(/observeFresh\(fastify, request, "(\w+)"/g)].map((match) => match[1]);
    expect(calls).toEqual(["lens", "lens", "shopping", "shopping", "lens", "words"]);
    // Chaque observation suit l'envoi de la réponse (« const sent = reply.send(…) »).
    for (const block of text.split("const sent = reply.send(").slice(1)) {
      expect(block.slice(0, 600)).toMatch(/observeFresh\(/);
    }
  });

  it("la migration 0036 ne garde ni l'auteur d'une recherche, ni l'acheteur, ni une adresse", () => {
    const sql = readFileSync(join(__dirname, "../supabase/migrations/0036_alertes_prix.sql"), "utf8");
    const tables = [...sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)];
    expect(tables.map((match) => match[1])).toEqual(["wish_tracking", "wish_watches", "wish_alert_events", "stock_reports"]);
    for (const [, name, body] of tables) {
      const columns = [...body!.matchAll(/^\s+(\w+) /gm)].map((match) => match[1]!).filter((column) => !["foreign", "check"].includes(column));
      for (const column of columns) expect(column, `${name}.${column}`).not.toMatch(/url|searcher|buyer|reporter|search_id|product_match/);
    }
  });
});

// Nouvelle version des alertes (0041, point 5 du fondateur) : une alerte ne
// dit jamais quelle recherche, quel signalement ni quel membre est à son
// origine. Garde-fous lus dans le code (le schéma : alertesV2Migration.test.ts).
const ALERT_FILES = ["lib/wishObserve.ts", "lib/wishAlertsSend.ts", "lib/push.ts", "lib/wishAlerts.ts", "routes/wishAlerts.ts"];

/** Les appels au journal d'un fichier, avec leurs arguments (jusqu'à la parenthèse fermante de la ligne). */
function logCalls(text: string): string[] {
  return [...text.matchAll(/\b(?:log|fastify\.log|request\.log)\.(?:trace|debug|info|warn|error|fatal)\(([^\n]*)/g)].map((match) => match[1]!);
}

describe("aucune trace qui relie le membre à l'origine aux envies ou aux membres prévenus (journal, Sentry, PostHog)", () => {
  it("journal : aucun appel des fichiers des alertes ne porte un compte, une envie ou un membre (seulement des nombres et des codes)", () => {
    for (const file of ALERT_FILES) {
      const text = readFileSync(join(SRC, file), "utf8");
      for (const call of logCalls(text)) {
        expect(call, `${file} : ${call}`).not.toMatch(/userId|user_id|observerId|observer|wishId|wishlist_item_id|wishlistItemId|recipientId|group\.userId|\bids\b(?!\.length)|\bp_ids|event_id|request\.user|\bkey\b|hash/);
      }
    }
  });

  it("observation et envoi : détachés de la requête (journal racine fastify.log, aucune requête, aucun Sentry)", () => {
    const observe = readFileSync(join(SRC, "lib/wishObserve.ts"), "utf8");
    const send = readFileSync(join(SRC, "lib/wishAlertsSend.ts"), "utf8");
    for (const [file, text] of [["wishObserve.ts", observe], ["wishAlertsSend.ts", send]] as const) {
      expect(text, file).not.toMatch(/request\.log|captureServerError|captureServerFailure|captureException|Sentry|posthog/i);
    }
    // L'observation ne reçoit jamais la requête : seulement fastify et ses entrées.
    expect(observe).not.toMatch(/FastifyRequest/);
    expect(observe).toMatch(/export function observeResults\(fastify: FastifyInstance, input: ObserveInput\): void/);
    // Le passage d'envoi qu'elle lance ne reçoit que fastify (jamais la requête, jamais le membre qui cherche).
    expect(observe).toMatch(/if \(events > 0\) sendWishAlertsNow\(fastify\);/);
    expect(send).toMatch(/export function sendWishAlertsNow\(fastify: FastifyInstance\): void/);
    // Le crochet des routes fréquentes ne transmet rien de la requête au passage.
    const hook = send.slice(send.indexOf("export async function flushAfterResponse"));
    expect(hook.slice(0, hook.indexOf("\n}\n"))).toMatch(/scheduleWishAlertsFlush\(fastify\);/);
    // Les passages écrivent au journal racine par défaut.
    expect(send).toMatch(/export async function flushWishAlerts\(fastify: FastifyInstance, log: FastifyBaseLogger = fastify\.log\)/);
    expect(send).toMatch(/running = flushWishAlerts\(fastify\)/);
  });

  it("recherches : l'observation part après la réponse, avec l'identifiant du membre seulement vers la base ; aucune erreur d'observation ne remonte à Sentry", () => {
    const searches = readFileSync(join(SRC, "routes/searches.ts"), "utf8");
    const observeFresh = searches.slice(searches.indexOf("function observeFresh("), searches.indexOf("\n}\n", searches.indexOf("function observeFresh(")));
    expect(observeFresh).toContain("observeResults(fastify, { source, rows, country: searchLocaleFor(request).country, observerId });");
    expect(observeFresh).not.toMatch(/request\.log|capture/);
    const observe = readFileSync(join(SRC, "lib/wishObserve.ts"), "utf8");
    // Toute erreur de l'observation est attrapée (journal racine, son nom seulement).
    expect(observe).toMatch(/const task = runObservation\(fastify, input\)\.catch\(/);
  });

  it("« Plus disponible » : la route ne journalise ni le compte, ni la pièce, ni les envies touchées (matched) ; la notification ne dit rien du signalement", () => {
    const route = readFileSync(join(SRC, "routes/wishAlerts.ts"), "utf8");
    const report = route.slice(route.indexOf('"/api/alerts/stock-reports"'));
    for (const call of logCalls(report)) expect(call).not.toMatch(/matched|key|hash|userId|wish/);
    const lib = readFileSync(join(SRC, "lib/wishAlerts.ts"), "utf8");
    const reportSoldOut = lib.slice(lib.indexOf("export async function reportSoldOut"), lib.indexOf("// ---- « Je l'ai achetée »"));
    // Le nombre d'envies touchées n'est pas renvoyé à la route (rien à journaliser).
    expect(reportSoldOut).toMatch(/return parsed\.data\[0\]!\.allowed \? "reported" : "limited";/);
  });

  it("PostHog (app) : aucun événement d'analyse ne porte une envie, un membre, une alerte ou un signalement", () => {
    const events = readFileSync(join(__dirname, "../../mobile/src/lib/analytics-events.ts"), "utf8");
    expect(events).not.toMatch(/wishlistItemId|wishlist_item_id|user_id|userId|stock_report|wish_alert|alert_/);
    const app = join(__dirname, "../../mobile/src");
    for (const file of sourceFiles(app).filter((path) => /wish-alert|stock-report|push|envie\.tsx|wishlist-panel/.test(path))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\btrack\(([^\n]*)/g)) expect(match[1], file).not.toMatch(/wish|alert|report|stock|user/i);
    }
  });
});
