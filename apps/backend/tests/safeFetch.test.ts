import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch, SafeFetchError } from "../src/lib/safeFetch.js";

// Petit serveur local (http, sans certificat) qui simule un hôte de
// confiance renvoyant tantôt une réponse normale, tantôt une redirection —
// vers un hôte autorisé ou non. `allowedSchemes: ["http:"]` n'est utilisé
// qu'ici, pour les tests : en production, safeFetch n'accepte que https.
describe("safeFetch", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello");
        return;
      }
      if (req.url === "/redirect-to-allowed") {
        res.writeHead(302, { location: `${baseUrl}/ok` });
        res.end();
        return;
      }
      if (req.url === "/redirect-to-forbidden") {
        res.writeHead(302, { location: "http://evil.example.com/steal" });
        res.end();
        return;
      }
      if (req.url === "/redirect-loop") {
        res.writeHead(302, { location: `${baseUrl}/redirect-loop` });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Échec de démarrage du serveur de test.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns the response for a plain request to an allowed host", async () => {
    const res = await safeFetch(`${baseUrl}/ok`, { allowedHosts: ["127.0.0.1"], allowedSchemes: ["http:"] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("follows a redirect that stays within the allowed hosts", async () => {
    const res = await safeFetch(`${baseUrl}/redirect-to-allowed`, {
      allowedHosts: ["127.0.0.1"],
      allowedSchemes: ["http:"],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("refuses to follow a redirect to a host outside the allow-list", async () => {
    await expect(
      safeFetch(`${baseUrl}/redirect-to-forbidden`, { allowedHosts: ["127.0.0.1"], allowedSchemes: ["http:"] })
    ).rejects.toThrow(SafeFetchError);
  });

  it("refuses a disallowed scheme up front", async () => {
    await expect(safeFetch(`${baseUrl}/ok`, { allowedHosts: ["127.0.0.1"] })).rejects.toThrow(SafeFetchError);
  });

  it("refuses a host outside the allow-list even with no redirect involved", async () => {
    await expect(
      safeFetch(`${baseUrl}/ok`, { allowedHosts: ["totally-different-host.example"], allowedSchemes: ["http:"] })
    ).rejects.toThrow(SafeFetchError);
  });

  it("gives up after too many redirects", async () => {
    await expect(
      safeFetch(`${baseUrl}/redirect-loop`, { allowedHosts: ["127.0.0.1"], allowedSchemes: ["http:"] })
    ).rejects.toThrow(SafeFetchError);
  });
});
