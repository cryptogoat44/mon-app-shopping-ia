import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AnthropicKeyError, assertProductionKey, checkRequiredVariables, sendAnthropicKey, validateAnthropicKey } from "../scripts/lib/anthropic-prod.js";
import { RENDER_API, type FetchLike } from "../scripts/lib/render-api.js";
import { assertEditableVariable, assertSecretVariable, FORBIDDEN_OLD_SERVER, isAnthropicKeyShape, REQUIRED_SERVER_VARIABLES } from "../scripts/lib/render-guard.js";

// Clé de production d'Anthropic → variable ANTHROPIC_API_KEY de spotto-api
// (décision du fondateur, 2026-10-07). Réponses SIMULÉES : aucun appel réel,
// ni à Anthropic ni à Render. Clés factices, assemblées ici pour qu'aucune
// forme de vraie clé n'apparaisse telle quelle dans le code.
const CLE = ["sk", "ant", "factice", "a".repeat(40)].join("-");
const CLE_ESSAI = ["sk", "ant", "factice", "e".repeat(40)].join("-");
const CLE_RENDER = "render-factice";
const SPOTTO_API = "srv-darcqk3tqb8s73f082f0";
const VARIABLE = `${RENDER_API}/services/${SPOTTO_API}/env-vars`;
/** Valeur secrète simulée renvoyée par Render : ne doit jamais ressortir. */
const SECRET_SIMULE = "valeur-secrete-simulee";

interface Appel {
  url: string;
  method: string;
  body: string | null;
  headers: Headers;
}

function fauxFetch(repondre: (appel: Appel) => Response): { fetchImpl: FetchLike; appels: Appel[] } {
  const appels: Appel[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const appel: Appel = { url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null, headers: new Headers(init?.headers) };
    appels.push(appel);
    return repondre(appel);
  };
  return { fetchImpl, appels };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function messageDErreur(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("une erreur était attendue");
}

describe("garde-fou : un seul secret, ANTHROPIC_API_KEY, sur spotto-api", () => {
  it("accepte ANTHROPIC_API_KEY sur spotto-api, et rien d'autre", () => {
    expect(assertSecretVariable("spotto-api", "ANTHROPIC_API_KEY")).toEqual({ serviceId: SPOTTO_API, key: "ANTHROPIC_API_KEY" });
    const refuses: [string | undefined, string | undefined][] = [
      ["site", "ANTHROPIC_API_KEY"],
      ["spotto-api", "SERPAPI_KEY"],
      ["spotto-api", "SUPABASE_SERVICE_ROLE_KEY"],
      ["spotto-api", "SUPABASE_URL"],
      ["spotto-api", "SENTRY_DSN"],
      ["spotto-api", undefined],
      [FORBIDDEN_OLD_SERVER, "ANTHROPIC_API_KEY"],
      ["mon-app-shopping-ia", "ANTHROPIC_API_KEY"],
      [undefined, "ANTHROPIC_API_KEY"],
    ];
    for (const [service, nom] of refuses) expect(() => assertSecretVariable(service, nom), `${service} ${nom}`).toThrow();
  });

  it("render-bride refuse toujours ce secret en ligne de commande", () => {
    expect(() => assertEditableVariable("spotto-api", "ANTHROPIC_API_KEY", CLE)).toThrow();
  });

  it("après l'envoi, on contrôle l'existence de 4 variables : les 3 indispensables au serveur et la clé", () => {
    expect([...REQUIRED_SERVER_VARIABLES]).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SERPAPI_KEY", "ANTHROPIC_API_KEY"]);
  });

  it("forme d'une clé d'Anthropic contrôlée avant tout envoi ; la clé d'essai est refusée", () => {
    expect(isAnthropicKeyShape(CLE)).toBe(true);
    for (const refusee of ["", "sk-ant-", "sk-proj-abcdefghijklmnopqrstuvwxyz", `${CLE} `, `${CLE}\n`, `x${CLE}`, `${CLE.slice(0, 20)} ${CLE.slice(20)}`]) {
      expect(isAnthropicKeyShape(refusee), JSON.stringify(refusee)).toBe(false);
    }
    expect(() => assertProductionKey(CLE, null)).not.toThrow();
    expect(() => assertProductionKey(CLE, CLE_ESSAI)).not.toThrow();
    expect(() => assertProductionKey(CLE_ESSAI, CLE_ESSAI)).toThrow(/clé d'ESSAI/);
    const message = (() => {
      try {
        assertProductionKey("pas-une-cle-secrete-123", null);
        return "";
      } catch (error) {
        return error instanceof AnthropicKeyError ? error.message : "";
      }
    })();
    expect(message).toContain("rien n'est envoyé");
    expect(message).not.toContain("pas-une-cle-secrete-123");
  });
});

describe("validation auprès d'Anthropic (gratuite : liste des modèles)", () => {
  it("clé acceptée et modèle du serveur accessible : un seul appel, à la liste des modèles", async () => {
    const { fetchImpl, appels } = fauxFetch(() => json(200, { data: [{ id: "claude-haiku-4-5-20251001" }, { id: "claude-sonnet-5-5" }] }));
    await validateAnthropicKey(CLE, fetchImpl);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe("https://api.anthropic.com/v1/models?limit=100");
    expect(appels[0]!.method).toBe("GET");
    expect(appels[0]!.headers.get("x-api-key")).toBe(CLE);
    expect(appels[0]!.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(appels[0]!.body).toBeNull();
  });

  it.each([
    [401, "ni désactivée ni expirée"],
    [400, "« Spotto – production »"],
    [500, "réponse 500"],
  ])("réponse %i : refus clair, sans jamais recopier la clé", async (status, attendu) => {
    const { fetchImpl } = fauxFetch(() => json(status, { error: { message: `clé ${CLE} refusée` } }));
    const message = await messageDErreur(validateAnthropicKey(CLE, fetchImpl));
    expect(message).toContain(attendu);
    expect(message).toContain("rien n'est envoyé à Render");
    expect(message).not.toContain(CLE);
  });

  it("modèle du serveur absent de la liste : refus", async () => {
    const { fetchImpl } = fauxFetch(() => json(200, { data: [{ id: "claude-haiku-4-5-20251001" }] }));
    expect(await messageDErreur(validateAnthropicKey(CLE, fetchImpl))).toContain("claude-sonnet-5-5");
  });
});

describe("envoi à Render : UNE variable, sur spotto-api seulement", () => {
  it("variable absente : lecture de son existence, puis écriture — et rien d'autre", async () => {
    const { fetchImpl, appels } = fauxFetch((appel) => (appel.method === "GET" ? json(404, { message: "not found" }) : json(200, { key: "ANTHROPIC_API_KEY", value: CLE })));
    expect(await sendAnthropicKey(CLE_RENDER, CLE, fetchImpl)).toBe("créée");
    expect(appels.map((a) => `${a.method} ${a.url}`)).toEqual([`GET ${VARIABLE}/ANTHROPIC_API_KEY`, `PUT ${VARIABLE}/ANTHROPIC_API_KEY`]);
    expect(JSON.parse(appels[1]!.body ?? "null")).toEqual({ value: CLE });
    expect(appels.every((a) => a.headers.get("authorization") === `Bearer ${CLE_RENDER}`)).toBe(true);
  });

  it("variable déjà présente : remplacée (sa valeur actuelle n'est jamais lue)", async () => {
    const { fetchImpl } = fauxFetch((appel) => json(200, { key: "ANTHROPIC_API_KEY", value: appel.method === "GET" ? SECRET_SIMULE : CLE }));
    expect(await sendAnthropicKey(CLE_RENDER, CLE, fetchImpl)).toBe("remplacée");
  });

  it("refus de Render : message avec le seul code de réponse, jamais la clé ni la réponse", async () => {
    const { fetchImpl } = fauxFetch((appel) => (appel.method === "GET" ? json(404, {}) : json(500, { echo: CLE, value: SECRET_SIMULE })));
    const message = await messageDErreur(sendAnthropicKey(CLE_RENDER, CLE, fetchImpl));
    expect(message).toContain("500");
    expect(message).not.toContain(CLE);
    expect(message).not.toContain(SECRET_SIMULE);
  });
});

describe("contrôle après envoi : 4 variables, existence seulement", () => {
  it("lit l'existence des 4 variables de spotto-api, jamais leurs valeurs, et signale l'absente", async () => {
    const { fetchImpl, appels } = fauxFetch((appel) => (appel.url.endsWith("/SUPABASE_SERVICE_ROLE_KEY") ? json(404, {}) : json(200, { value: SECRET_SIMULE })));
    const resultat = await checkRequiredVariables(CLE_RENDER, fetchImpl);
    expect(resultat).toEqual({ present: ["SUPABASE_URL", "SERPAPI_KEY", "ANTHROPIC_API_KEY"], missing: ["SUPABASE_SERVICE_ROLE_KEY"] });
    expect(JSON.stringify(resultat)).not.toContain(SECRET_SIMULE);
    expect(appels.map((a) => `${a.method} ${a.url}`)).toEqual(REQUIRED_SERVER_VARIABLES.map((nom) => `GET ${VARIABLE}/${nom}`));
  });

  it("réponse inattendue de Render : arrêt, avec le seul code de réponse", async () => {
    const { fetchImpl } = fauxFetch(() => json(401, { value: SECRET_SIMULE }));
    const message = await messageDErreur(checkRequiredVariables(CLE_RENDER, fetchImpl));
    expect(message).toContain("401");
    expect(message).not.toContain(SECRET_SIMULE);
  });
});

describe("le code des outils ne peut ni supprimer, ni toucher à la liste des variables, ni écrire la clé", () => {
  const source = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
  const fichiers = ["../scripts/configurer-anthropic-prod.ts", "../scripts/lib/anthropic-prod.ts", "../scripts/lib/render-api.ts"];

  it.each(fichiers)("%s : ni suppression, ni groupe de variables, ni liste entière", (chemin) => {
    const code = source(chemin);
    expect(code).not.toMatch(/"DELETE"/);
    expect(code).not.toMatch(/env-groups/);
    expect(code).not.toMatch(/\/env-vars`/);
  });

  it("la clé n'est écrite dans aucun fichier, ni affichée", () => {
    for (const chemin of ["../scripts/configurer-anthropic-prod.ts", "../scripts/lib/anthropic-prod.ts"]) {
      const code = source(chemin);
      expect(code, chemin).not.toMatch(/writeFile|appendFile|createWriteStream/);
      // Aucun console.… ne reçoit la variable `key` (seulement des noms et des comptes).
      expect(code, chemin).not.toMatch(/console\.[a-z]+\([^;]*(?<![.\w])key\b/);
    }
  });
});
