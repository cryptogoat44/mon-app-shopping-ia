import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { codeSansSentry, GardeStatistiques, versStatistiques } from "../scripts/parcours-ecran/garde-statistiques.js";

// Lot 4 ter (demande du fondateur après l'incident du 2026-10-07) : le
// garde-fou des parcours à l'écran bloque et signale toute requête vers
// PostHog ou Sentry que le scénario n'a pas interceptée. Preuve dans un VRAI
// Chrome. Sécurité du test lui-même : Chrome résout PostHog et Sentry vers un
// faux serveur local (--host-resolver-rules) — rien ne peut partir sur Internet,
// même si le garde-fou faisait défaut.
const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // Mac
  "/usr/bin/google-chrome", // machines de GitHub (ubuntu-24.04)
  "/usr/bin/google-chrome-stable",
].find((chemin): chemin is string => Boolean(chemin) && existsSync(chemin!));

let browser: Browser;
let faux: Server;
let port = 0;
let recues: string[] = [];

beforeAll(async () => {
  if (!CHROME) throw new Error("Google Chrome introuvable (indiquez CHROME_PATH) : le garde-fou doit être prouvé dans un vrai navigateur.");
  faux = createServer((req, res) => {
    if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>page</title>");
    if (req.url === "/favicon.ico") return res.writeHead(404).end();
    recues.push(`${req.headers.host ?? "?"}${req.url ?? ""}`);
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }).end("{}");
  });
  await new Promise<void>((resolve) => faux.listen(0, "127.0.0.1", resolve));
  const adresse = faux.address();
  if (adresse === null || typeof adresse === "string") throw new Error("Faux serveur sans port.");
  port = adresse.port;
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--host-resolver-rules=MAP *.posthog.com 127.0.0.1, MAP posthog.com 127.0.0.1, MAP *.sentry.io 127.0.0.1, MAP sentry.io 127.0.0.1"],
  });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (faux ? faux.close(() => resolve()) : resolve()));
});

/** Contexte protégé ; `echecs` : hôte et raison de chaque requête échouée
 * (ERR_BLOCKED_BY_CLIENT = arrêtée par le garde-fou). */
async function ouvrir(garde: GardeStatistiques): Promise<{ contexte: BrowserContext; page: Page; echecs: string[] }> {
  recues = [];
  const contexte = await browser.newContext();
  await garde.proteger(contexte);
  const page = await contexte.newPage();
  const echecs: string[] = [];
  // Chrome ajoute parfois « .Inspector » (blocage décidé par l'outil de pilotage) : ignoré.
  page.on("requestfailed", (requete) => echecs.push(`${new URL(requete.url()).hostname} ${(requete.failure()?.errorText ?? "?").replace(/\.Inspector$/, "")}`));
  await page.goto(`http://127.0.0.1:${port}/page`);
  return { contexte, page, echecs };
}

/** Envoi d'un événement depuis la page, comme le site ; « ok » ou « bloqué ». */
function envoyer(page: Page, adresse: string): Promise<string> {
  return page.evaluate(
    `fetch(${JSON.stringify(adresse)}, { method: "POST", body: "{}" }).then(() => "ok", () => "bloqué")`
  ) as Promise<string>;
}

async function attendre(condition: () => boolean): Promise<void> {
  for (let essai = 0; essai < 50 && !condition(); essai += 1) await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("hôtes surveillés", () => {
  it("PostHog et Sentry, tous leurs sous-domaines ; rien d'autre", () => {
    for (const adresse of ["https://eu.i.posthog.com/i/v0/e/", "https://us.i.posthog.com/batch", "https://app.posthog.com/", "https://o450.ingest.de.sentry.io/api/1/envelope/", "https://sentry.io/"]) {
      expect(versStatistiques(adresse), adresse).toBe(true);
    }
    for (const adresse of ["http://localhost:3000/api/searches", "https://sbtwsmxfdfxzgcohbznd.supabase.co/rest/v1/", "https://posthog.com.example.org/", "https://notsentry.io/", "data:,x"]) {
      expect(versStatistiques(adresse), adresse).toBe(false);
    }
  });

  it("code compilé : l'adresse Sentry du PROJET est repérée ; celles de la bibliothèque Sentry, non", () => {
    const projet = "https://0123abcd@o4507.ingest.de.sentry.io/4508";
    expect(codeSansSentry(`init({dsn:"${projet}"})`, projet)).toBe(false);
    expect(codeSansSentry('init({dsn:""})', projet)).toBe(true);
    // Autre adresse de même forme (comme celle de diagnostic que la bibliothèque Sentry contient) : pas celle du projet.
    expect(codeSansSentry('"https://ffffffffffffffffffffffffffffffff@o1.ingest.us.sentry.io/1"', projet)).toBe(true);
    expect(codeSansSentry(`dsn:"${projet}"`, undefined)).toBe(true);
  });
});

describe("garde-fou dans un vrai Chrome", () => {
  it("statistiques interceptées par le scénario (réponse fabriquée) : rien n'est signalé", async () => {
    const garde = new GardeStatistiques();
    const { contexte, page } = await ouvrir(garde);
    await page.route("https://eu.i.posthog.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    expect(await envoyer(page, "https://eu.i.posthog.com/i/v0/e/")).toBe("ok");
    await page.waitForTimeout(300);
    expect(garde.fuites).toEqual([]);
    expect(() => garde.verifier()).not.toThrow();
    expect(recues).toEqual([]);
    await contexte.close();
  });

  it("incident du 2026-10-07 rejoué (interception retirée par unrouteAll) : requêtes bloquées, parcours en échec", async () => {
    const garde = new GardeStatistiques();
    const { contexte, page, echecs } = await ouvrir(garde);
    await page.route("https://eu.i.posthog.com/**", (route) => route.fulfill({ status: 200, body: "{}" }));
    await page.unrouteAll();
    expect(await envoyer(page, "https://eu.i.posthog.com/i/v0/e/")).toBe("bloqué");
    expect(await envoyer(page, "https://o450.ingest.de.sentry.io/api/1/envelope/")).toBe("bloqué");
    expect(echecs).toEqual(["eu.i.posthog.com net::ERR_BLOCKED_BY_CLIENT", "o450.ingest.de.sentry.io net::ERR_BLOCKED_BY_CLIENT"]);
    expect(garde.fuites.map((f) => `${f.issue} ${f.hote}`)).toEqual(["bloquee eu.i.posthog.com", "bloquee o450.ingest.de.sentry.io"]);
    expect(() => garde.verifier()).toThrow(/Garde-fou statistiques : 2 requête\(s\).*eu\.i\.posthog\.com.*bloquée/);
    expect(recues).toEqual([]); // rien n'est sorti du navigateur
    await contexte.close();
  });

  it("même si la route du garde-fou était retirée : une réponse venue d'un serveur est signalée « partie »", async () => {
    const garde = new GardeStatistiques();
    const { contexte, page } = await ouvrir(garde);
    await contexte.unrouteAll();
    expect(await envoyer(page, `http://eu.i.posthog.com:${port}/i/v0/e/`)).toBe("ok");
    await attendre(() => garde.fuites.length > 0);
    expect(recues).toEqual([`eu.i.posthog.com:${port}/i/v0/e/`]); // reçue par le FAUX serveur local
    expect(garde.fuites.map((f) => `${f.issue} ${f.hote}`)).toEqual(["partie eu.i.posthog.com"]);
    expect(() => garde.verifier()).toThrow(/PARTIE/);
    await contexte.close();
  });

  it("scénario sentry-site : seul l'hôte UE de Sentry passe le garde-fou ; PostHog reste bloqué", async () => {
    const garde = new GardeStatistiques(["ingest.de.sentry.io"]);
    const { contexte, page, echecs } = await ouvrir(garde);
    // Sentry passe le garde-fou, puis ne trouve aucun serveur (résolu vers le Mac) : rien ne sort.
    expect(await envoyer(page, "https://o450.ingest.de.sentry.io/api/1/envelope/")).toBe("bloqué");
    expect(await envoyer(page, "https://eu.i.posthog.com/i/v0/e/")).toBe("bloqué");
    expect(echecs).toEqual(["o450.ingest.de.sentry.io net::ERR_CONNECTION_REFUSED", "eu.i.posthog.com net::ERR_BLOCKED_BY_CLIENT"]);
    expect(garde.fuites.map((f) => `${f.issue} ${f.hote}`)).toEqual(["bloquee eu.i.posthog.com"]);
    await contexte.close();
  });
});
