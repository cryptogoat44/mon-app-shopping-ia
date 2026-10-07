import { describe, expect, it } from "vitest";
import { lireReponses } from "../scripts/lib/journal-serveur.js";

// Outil des vérifications sur iPhone (lot 4 ter) : réponses du serveur local
// lues dans son journal — méthode, chemin sans paramètres, code, durée ; rien d'autre.
describe("lecture du journal du serveur local", () => {
  it("relie chaque réponse à sa requête, sans les paramètres de l'adresse", () => {
    const journal = [
      '{"level":30,"time":1000,"reqId":"req-1","req":{"method":"GET","url":"/api/me?x=1","host":"localhost:3000"},"msg":"incoming request"}',
      '{"level":30,"time":1003,"reqId":"req-1","res":{"statusCode":401},"responseTime":2.6,"msg":"request completed"}',
      "[simulation SerpApi] 3 proposition(s)",
      '{"level":30,"time":1100,"reqId":"req-2","req":{"method":"GET","url":"/api/consents"},"msg":"incoming request"}',
      "{ligne coupée",
      '{"level":30,"time":1810,"reqId":"req-2","res":{"statusCode":200},"responseTime":710.2,"msg":"request completed"}',
    ].join("\n");
    expect(lireReponses(journal)).toEqual([
      { temps: 1003, methode: "GET", chemin: "/api/me", code: 401, dureeMs: 3 },
      { temps: 1810, methode: "GET", chemin: "/api/consents", code: 200, dureeMs: 710 },
    ]);
  });

  it("réponse sans requête connue : chemin « ? » ; journal vide : rien", () => {
    expect(lireReponses('{"time":5,"reqId":"req-9","res":{"statusCode":204}}')).toEqual([{ temps: 5, methode: "?", chemin: "?", code: 204, dureeMs: 0 }]);
    expect(lireReponses("")).toEqual([]);
  });
});
