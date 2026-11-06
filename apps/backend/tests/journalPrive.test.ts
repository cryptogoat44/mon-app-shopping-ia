import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { errorSummary, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";

// Journaux du serveur sans donnée personnelle (lot « filets de sécurité »,
// point 33) : ni les mots tapés, ni un chemin de fichier, ni une adresse
// e-mail, ni un identifiant de compte. Hors base : les requêtes sans jeton
// s'arrêtent avant toute lecture.
const COMPTE = "11111111-1111-4111-8111-111111111111";
const AUTRE_COMPTE = "22222222-2222-4222-8222-222222222222";
const MOTS = "veste-daim-secrete";
const EMAIL = "quelqu.un@exemple.fr";
const CHEMIN = `${COMPTE}/photo-de-profil.jpg`;

describe("journal du serveur, de bout en bout", () => {
  let app: FastifyInstance;
  const lignes: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: { level: "info", stream: { write: (ligne: string) => lignes.push(ligne) } } });
    // Une route d'essai qui journalise des erreurs comme les vraies routes :
    // une erreur de la base qui reprend la ligne refusée, une erreur du
    // stockage qui reprend le chemin du fichier.
    app.get("/essai-journal/:userId", async (request) => {
      const erreurBase = {
        message: `new row for relation "posts" violates check constraint, value "${MOTS}"`,
        details: `Failing row contains (${COMPTE}, ${MOTS}, ${EMAIL}).`,
        hint: null,
        code: "23514",
      };
      const erreurStockage = Object.assign(new Error(`Object not found: avatars/${CHEMIN}`), { name: "StorageApiError", status: 404 });
      request.log.error({ error: erreurBase, uploadError: erreurStockage, failures: ["vault"], count: 2 }, "Essai du journal");
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function lues(): Record<string, unknown>[] {
    return lignes.map((ligne) => JSON.parse(ligne) as Record<string, unknown>);
  }

  it("chaque requête est notée avec sa route déclarée : ni « ?q=… », ni identifiant dans le chemin", async () => {
    lignes.length = 0;
    expect((await app.inject({ method: "GET", url: `/api/users/search?q=${MOTS}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/users/${AUTRE_COMPTE}/posts?cursor=${COMPTE}` })).statusCode).toBe(401);
    const inconnue = await app.inject({ method: "GET", url: `/n-existe-pas/${COMPTE}?email=${encodeURIComponent(EMAIL)}` });
    // Même réponse qu'avant (404, message général), sans l'adresse.
    expect(inconnue.statusCode).toBe(404);
    expect(inconnue.json()).toMatchObject({ error: "Not Found", statusCode: 404 });
    expect(inconnue.body).not.toContain("n-existe-pas");

    const requetes = lues().filter((ligne) => ligne.msg === "incoming request");
    expect(requetes.map((ligne) => (ligne.req as { method: string; url: string }).url)).toEqual([
      "/api/users/search",
      "/api/users/:userId/posts",
      "(route inconnue)",
    ]);
    for (const ligne of requetes) expect((ligne.req as { method: string }).method).toBe("GET");
    // Les lignes « request completed » gardent le code de réponse (outils de lecture des journaux).
    expect(lues().filter((ligne) => ligne.msg === "request completed").map((ligne) => (ligne.res as { statusCode: number }).statusCode)).toEqual([401, 401, 404]);

    const texte = lignes.join("\n");
    for (const secret of [MOTS, COMPTE, AUTRE_COMPTE, EMAIL, "exemple.fr", "cursor="]) expect(texte).not.toContain(secret);
  });

  it("une erreur journalisée est réduite à son nom, son code et son statut : jamais son message ni ses détails", async () => {
    lignes.length = 0;
    expect((await app.inject({ method: "GET", url: `/essai-journal/${COMPTE}` })).statusCode).toBe(200);

    const essai = lues().find((ligne) => ligne.msg === "Essai du journal");
    expect(essai).toMatchObject({
      error: { code: "23514" },
      uploadError: { name: "StorageApiError", status: 404 },
      failures: ["vault"],
      count: 2,
    });
    expect(Object.keys(essai!.error as object)).toEqual(["code"]);
    expect(Object.keys(essai!.uploadError as object).sort()).toEqual(["name", "status"]);

    const texte = lignes.join("\n");
    for (const secret of [MOTS, COMPTE, EMAIL, CHEMIN, "Failing row", "avatars/", "photo-de-profil"]) expect(texte).not.toContain(secret);
  });
});

describe("filet final, sur chaque ligne du journal", () => {
  it("un identifiant, une adresse e-mail ou la partie « ?… » d'une adresse est remplacé ; la ligne reste un JSON valide", () => {
    const ligne = JSON.stringify({ level: 40, msg: `Reply was already sent, did you forget to "return reply" in the "/api/users/${COMPTE}/posts?q=${MOTS}&e=${EMAIL}" (GET)`, other: `avatars/${COMPTE}/photo.jpg` });
    const nettoyee = scrubLogLine(ligne);
    expect(JSON.parse(nettoyee)).toEqual({ level: 40, msg: 'Reply was already sent, did you forget to "return reply" in the "/api/users/:id/posts?…" (GET)', other: "avatars/:id/photo.jpg" });
    expect(scrubLogLine(JSON.stringify({ msg: `Compte ${EMAIL} introuvable` }))).toBe(JSON.stringify({ msg: "Compte :email introuvable" }));
  });

  it("les lignes ordinaires ne changent pas", () => {
    for (const ligne of [
      JSON.stringify({ level: 30, reqId: "req-1", req: { method: "GET", url: "/api/users/:userId/posts", host: "spotto-api.onrender.com", remoteAddress: "10.0.0.1" }, msg: "incoming request" }),
      JSON.stringify({ level: 30, msg: "Backend démarré sur http://0.0.0.0:3000" }),
      JSON.stringify({ level: 30, msg: "Que cherchez-vous ? Recherche avec vos mots" }),
      JSON.stringify({ level: 30, provider: "serpapi", outcome: "success", received: 60, kept: 30, addedRanks: [3, 7], callSeconds: 2.4, msg: "Mesure recherche" }),
    ]) {
      expect(scrubLogLine(ligne)).toBe(ligne);
    }
  });
});

describe("résumé d'une erreur", () => {
  it("garde le nom, le code, le statut et la nature d'une panne ; rien d'autre", () => {
    const panne = Object.assign(new Error(`SerpApi a refusé https://serpapi.com/search?api_key=secret&url=${CHEMIN}`), { name: "ProviderFailure", kind: "refused", statusCode: 429 });
    expect(errorSummary(panne)).toEqual({ name: "ProviderFailure", status: 429, kind: "refused" });
    expect(errorSummary(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }))).toEqual({ name: "Error", code: "ECONNREFUSED" });
    expect(errorSummary({ message: "Object not found", statusCode: "404", error: "not_found" })).toEqual({ status: 404 });
  });

  it("un nom, un code ou une nature qui ressemble à du contenu est écarté", () => {
    expect(errorSummary({ message: "x", name: `Erreur pour ${EMAIL}`, code: `${MOTS} ${COMPTE}`, kind: "Mots Tapés", status: 99 })).toEqual({});
  });

  it("seules les erreurs, à la racine de la ligne, changent ; le reste est gardé tel quel", () => {
    const ligne = { failures: ["vault", "posts"], leftovers: [{ bucket: "avatars", failed: 1, unreadable: false }], authError: { name: "AuthRetryableFetchError", status: 0 }, error: null, step: "search" };
    expect(withoutErrorDetails(ligne)).toBe(ligne);
    expect(withoutErrorDetails({ step: "search", error: { message: `Failing row contains (${COMPTE})`, code: "23502" } })).toEqual({ step: "search", error: { code: "23502" } });
  });
});
