import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Alertes prix et stock (lot 2) : garde-fous lus dans le code, sans base.
// - CHAQUE chemin qui crée une envie (insertion dans wishlist_items) crée
//   aussi son suivi (trackNewWish) : une envie oubliée ne recevrait jamais
//   d'alerte. Un nouveau chemin sans trackNewWish fait échouer ce test.
// - L'observation n'envoie jamais à la base qui a cherché ou acheté.
// - La migration ne garde ni l'auteur d'une recherche, ni l'acheteur, ni une adresse.

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

describe("jamais qui a cherché, acheté ou signalé avec une observation", () => {
  it("wish_observe ne reçoit que le lot d'observations", () => {
    const text = readFileSync(join(SRC, "lib/wishObserve.ts"), "utf8");
    expect(text.match(/rpc\("wish_observe", \{([^}]*)\}\)/)?.[1]?.trim()).toBe("p_batch: observations");
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
