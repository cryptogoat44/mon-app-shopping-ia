import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FASHN_MODEL, FashnProvider, httpErrorKind, jobErrorKind, neverConnected } from "../src/lib/tryon/providers/fashn.js";
import { FakeProvider, fakeBandText } from "../src/lib/tryon/providers/fake.js";
import { createTryonProvider } from "../src/lib/tryon/providers/index.js";
import { TryonProviderError, type TryonGarmentImage, type TryonProviderErrorKind } from "../src/lib/tryon/provider.js";
import { readTryonConfig } from "../src/lib/tryon/config.js";
import { isPaidHost } from "./setup/noPaidCalls.js";

// Essayage virtuel : les fournisseurs. FASHN est toujours remplacé par un
// faux `fetch` (aucun appel réel : tests/setup/noPaidCalls.ts refuse
// fashn.ai) ; les réponses imitent sa documentation officielle. Clé factice.

const KEY = "fa-cle-factice-0123456789";
const BASE = "https://api.fashn.ai/v1";
const PREDICTION = "123a87r9-4129-4bb3-be18-9c9fb5bd7fc1-u1";
const PERSON = await sharp({ create: { width: 48, height: 64, channels: 3, background: "#a08060" } }).jpeg().toBuffer();
const GARMENT = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#203040" } }).jpeg().toBuffer();
const RESULT = await sharp({ create: { width: 48, height: 64, channels: 3, background: "#406080" } }).jpeg().toBuffer();
const GARMENT_URL: TryonGarmentImage = { kind: "url", url: "https://boutique.example/images/veste.jpg" };
/** Un message d'erreur de FASHN, avec une adresse : il ne doit jamais ressortir. */
const PROVIDER_MESSAGE = "Error loading model image: https://secret.example/photo-de-camille.jpg";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completed = (output = `data:image/jpeg;base64,${RESULT.toString("base64")}`, headers: Record<string, string> = { "x-fashn-credits-used": "1" }) =>
  json(200, { id: PREDICTION, status: "completed", output: [output], error: null }, headers);
const networkError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

/** Un faux FASHN : chaque appel est noté, `answer` donne la réponse (ou l'erreur levée). */
function fakeFetch(answer: (call: Call, index: number) => Response | Error) {
  const calls: Call[] = [];
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = { method: init?.method ?? "GET", url: String(input), headers, body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const result = answer(call, calls.length - 1);
    if (result instanceof Error) throw result;
    return result;
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

/** FASHN sans attente réelle ; l'horloge avance de chaque attente demandée. */
function provider(options: { deadlineMs?: number } = {}) {
  let clock = 0;
  return new FashnProvider({
    apiKey: KEY,
    baseUrl: BASE,
    pollIntervalMs: 1_500,
    deadlineMs: options.deadlineMs ?? 90_000,
    retryDelaysMs: [500, 1_500],
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
}

async function failure(run: () => Promise<unknown>): Promise<TryonProviderError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(TryonProviderError);
    return error as TryonProviderError;
  }
  throw new Error("aucune erreur");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FASHN : un essai, exactement comme le dit la documentation", () => {
  it("POST /run avec tryon-v1.6 et les réglages de la mission, puis GET /status jusqu'à « completed »", async () => {
    const calls = fakeFetch((call, index) => {
      if (index === 0) return json(200, { id: PREDICTION, error: null });
      return index < 3 ? json(200, { id: PREDICTION, status: index === 1 ? "in_queue" : "processing", error: null }) : completed();
    });
    const result = await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" });
    expect(result.creditsUsed).toBe(1);
    expect(result.image.equals(RESULT)).toBe(true);

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${BASE}/run`, ...Array(3).fill(`GET ${BASE}/status/${PREDICTION}`)]);
    expect(calls[0]!.body).toEqual({
      model_name: FASHN_MODEL,
      inputs: {
        model_image: `data:image/jpeg;base64,${PERSON.toString("base64")}`,
        garment_image: GARMENT_URL.url,
        category: "auto",
        mode: "balanced",
        garment_photo_type: "auto",
        moderation_level: "conservative",
        num_samples: 1,
        output_format: "jpeg",
        return_base64: true,
      },
    });
    expect(FASHN_MODEL).toBe("tryon-v1.6");
    for (const call of calls) expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
  });

  it("l'image de la pièce en octets part en base64, comme la photo (jamais par une adresse)", async () => {
    const calls = fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION, error: null }) : completed()));
    await provider().run({ personImage: PERSON, garmentImage: { kind: "data", jpeg: GARMENT }, locale: "en" });
    const inputs = (calls[0]!.body as { inputs: Record<string, unknown> }).inputs;
    expect(inputs.garment_image).toBe(`data:image/jpeg;base64,${GARMENT.toString("base64")}`);
    expect(String(inputs.model_image).startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("crédits : ceux de l'en-tête x-fashn-credits-used, 1 s'il manque ou se lit mal", async () => {
    fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : completed(undefined, { "x-fashn-credits-used": "2" })));
    expect((await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" })).creditsUsed).toBe(2);
    fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : completed(undefined, {})));
    expect((await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" })).creditsUsed).toBe(1);
    fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : completed(undefined, { "x-fashn-credits-used": "beaucoup" })));
    expect((await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" })).creditsUsed).toBe(1);
  });

  it("un résultat donné par une adresse (au lieu du base64) n'est jamais suivi : réponse inattendue", async () => {
    const calls = fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : completed("https://cdn.fashn.ai/x/output_0.png")));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("invalid_response");
    expect(calls.some((call) => call.url.includes("cdn.fashn.ai"))).toBe(false);
  });

  it("un résultat qui n'est pas une image JPEG ou PNG est refusé", async () => {
    fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : completed(`data:image/jpeg;base64,${Buffer.from("<svg/>").toString("base64")}`)));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("invalid_response");
  });
});

describe("FASHN : erreurs traduites en sortes fixes, sans aucun texte de FASHN", () => {
  const cases: [string, number, string, TryonProviderErrorKind][] = [
    ["400 BadRequest", 400, "BadRequest", "bad_request"],
    ["401 UnauthorizedAccess", 401, "UnauthorizedAccess", "unauthorized"],
    ["404 NotFound", 404, "NotFound", "not_found"],
    ["429 RateLimitExceeded", 429, "RateLimitExceeded", "rate_limited"],
    ["429 ConcurrencyLimitExceeded", 429, "ConcurrencyLimitExceeded", "rate_limited"],
    ["429 OutOfCredits", 429, "OutOfCredits", "out_of_credits"],
  ];
  for (const [label, status, name, kind] of cases) {
    it(`soumission refusée : ${label} → ${kind}, sans nouvelle tentative`, async () => {
      const calls = fakeFetch(() => json(status, { error: name, message: PROVIDER_MESSAGE }));
      const error = await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }));
      expect(error.kind).toBe(kind);
      expect(error.status).toBe(status);
      expect(error.message).toBe(`tryon_${kind}`);
      expect(calls).toHaveLength(1);
    });
  }

  const jobErrors: [string, TryonProviderErrorKind][] = [
    ["ImageLoadError", "image_load"],
    ["ContentModerationError", "moderation_blocked"],
    ["PoseError", "pose_not_detected"],
    ["InputValidationError", "invalid_input"],
    ["ThirdPartyError", "unavailable"],
    ["UnavailableError", "unavailable"],
    ["PipelineError", "unavailable"],
    ["NomInconnu", "unavailable"],
  ];
  for (const [name, kind] of jobErrors) {
    it(`essai échoué : ${name} → ${kind}`, async () => {
      fakeFetch((_call, index) =>
        index === 0 ? json(200, { id: PREDICTION }) : json(200, { id: PREDICTION, status: "failed", error: { name, message: PROVIDER_MESSAGE } })
      );
      const error = await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }));
      expect(error.kind).toBe(kind);
      expect(error.message).toBe(`tryon_${kind}`);
      expect(JSON.stringify(error)).not.toContain("secret.example");
    });
  }

  it("états des SDK : « canceled » → panne, « time_out » → délai ; un état inconnu → réponse inattendue", async () => {
    for (const [status, kind] of [["canceled", "unavailable"], ["time_out", "timeout"], ["bizarre", "invalid_response"]] as const) {
      fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : json(200, { id: PREDICTION, status })));
      expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind, status).toBe(kind);
    }
  });

  it("fonctions de correspondance, telles que documentées", () => {
    expect(httpErrorKind(500, "InternalServerError")).toBe("unavailable");
    expect(httpErrorKind(418, null)).toBe("bad_request");
    expect(jobErrorKind(undefined)).toBe("unavailable");
  });
});

describe("FASHN : jamais de double soumission", () => {
  it("connexion jamais établie (refusée, nom introuvable) : deux nouvelles tentatives au plus", async () => {
    const calls = fakeFetch(() => networkError("ECONNREFUSED"));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("unavailable");
    expect(calls).toHaveLength(3);
    expect(neverConnected(networkError("ENOTFOUND"))).toBe(true);
    expect(neverConnected(Object.assign(new TypeError("fetch failed"), { cause: new AggregateError([Object.assign(new Error("a"), { code: "ECONNREFUSED" })]) }))).toBe(true);
  });

  it("puis réussite après une connexion refusée : un seul essai soumis", async () => {
    const calls = fakeFetch((_call, index) => (index === 0 ? networkError("ECONNREFUSED") : index === 1 ? json(200, { id: PREDICTION }) : completed()));
    await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
  });

  it("coupure après l'envoi (ECONNRESET) ou délai dépassé : jamais retenté", async () => {
    const reset = fakeFetch(() => networkError("ECONNRESET"));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("unavailable");
    expect(reset).toHaveLength(1);
    const timeout = fakeFetch(() => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("timeout");
    expect(timeout).toHaveLength(1);
  });

  it("erreur 500 ou 503 (aucun essai créé) : retentée ; 502 et 504 (passerelle, ambigus) : jamais", async () => {
    const recovered = fakeFetch((_call, index) => (index === 0 ? json(503, { error: "ServiceUnavailable" }) : index === 1 ? json(200, { id: PREDICTION }) : completed()));
    await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" });
    expect(recovered.filter((call) => call.method === "POST")).toHaveLength(2);

    const always500 = fakeFetch(() => json(500, { error: "InternalServerError", message: PROVIDER_MESSAGE }));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("unavailable");
    expect(always500).toHaveLength(3);

    for (const status of [502, 504]) {
      const gateway = fakeFetch(() => json(status, { error: "Gateway" }));
      expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("unavailable");
      expect(gateway, String(status)).toHaveLength(1);
    }
  });

  it("lecture de l'état : une panne passagère (500, 429, réseau) fait relire, jamais resoumettre", async () => {
    const calls = fakeFetch((_call, index) => {
      if (index === 0) return json(200, { id: PREDICTION });
      if (index === 1) return json(500, { error: "InternalServerError" });
      if (index === 2) return json(429, { error: "RateLimitExceeded" });
      if (index === 3) return networkError("ECONNRESET");
      return completed();
    });
    await provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls).toHaveLength(5);
  });

  it("délai total de 90 s, soumission comprise : au-delà, « timeout »", async () => {
    const calls = fakeFetch((_call, index) => (index === 0 ? json(200, { id: PREDICTION }) : json(200, { id: PREDICTION, status: "processing" })));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("timeout");
    // Une lecture toutes les 1,5 s avant les 90 s : 59 (la 60e tomberait pile au délai), pas une de plus.
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(59);
  });

  it("une redirection vers un autre hôte n'est jamais suivie", async () => {
    const calls = fakeFetch(() => new Response(null, { status: 302, headers: { location: "https://ailleurs.example/run" } }));
    expect((await failure(() => provider().run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("unavailable");
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual(["api.fashn.ai"]);
  });
});

describe("FASHN : solde de crédits (« Credits Balance »), gardé 5 minutes", () => {
  it("lit GET /credits (total), une seule fois en 5 minutes, même pour des lectures simultanées", async () => {
    let clock = 0;
    const fashn = new FashnProvider({ apiKey: KEY, baseUrl: BASE, now: () => clock });
    const calls = fakeFetch(() => json(200, { credits: { total: 234, subscription: 100, on_demand: 134 } }));
    expect(await Promise.all([fashn.getCreditBalance(), fashn.getCreditBalance()])).toEqual([234, 234]);
    clock += 5 * 60_000 - 1;
    expect(await fashn.getCreditBalance()).toBe(234);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${BASE}/credits`]);
    clock += 1;
    await fashn.getCreditBalance();
    expect(calls).toHaveLength(2);
  });

  it("clé refusée ou réponse illisible : erreur (jamais un solde inventé)", async () => {
    fakeFetch(() => json(401, { error: "UnauthorizedAccess", message: "Unauthorized: Invalid token" }));
    expect((await failure(() => provider().getCreditBalance())).kind).toBe("unauthorized");
    fakeFetch(() => json(200, { credits: { total: "beaucoup" } }));
    expect((await failure(() => provider().getCreditBalance())).kind).toBe("invalid_response");
  });

  it("garde des tests : un vrai appel à FASHN est refusé, sous-domaines compris", () => {
    expect(isPaidHost("api.fashn.ai")).toBe(true);
    expect(isPaidHost("fashn.ai")).toBe(true);
    expect(isPaidHost("fashn.ai.exemple.com")).toBe(false);
  });
});

describe("faux fournisseur : aucun réseau, la photo revient avec « TEST – FAUX ESSAI »", () => {
  it("renvoie la photo du membre avec un bandeau rouge en haut, 1 crédit, sans aucun appel réseau", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const photo = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#d8d0c0" } }).jpeg().toBuffer();
    const fake = new FakeProvider();
    const result = await fake.run({ personImage: photo, garmentImage: GARMENT_URL, locale: "fr" });
    expect(result.creditsUsed).toBe(1);
    expect(network).not.toHaveBeenCalled();
    const { data, info } = await sharp(result.image).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([400, 600]);
    // En haut, le bandeau rouge ; en bas, la photo d'origine.
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const [r, g, b] = pixel(2, 2);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(90);
    expect(b).toBeLessThan(90);
    expect(pixel(200, 590).every((value, index) => Math.abs(value - [0xd8, 0xd0, 0xc0][index]!) < 12)).toBe(true);
    expect(await fake.getCreditBalance()).toBe(1000);
    expect(fakeBandText("fr")).toBe("TEST – FAUX ESSAI");
    expect(fakeBandText("en")).toBe("TEST – FAKE TRY-ON");
  });

  it("échecs, solde et image de la pièce illisible par adresse : réglés par son constructeur", async () => {
    expect((await failure(() => new FakeProvider({ failure: "pose_not_detected" }).run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("pose_not_detected");
    const unreadable = new FakeProvider({ garmentUrlUnreadable: true });
    expect((await failure(() => unreadable.run({ personImage: PERSON, garmentImage: GARMENT_URL, locale: "fr" }))).kind).toBe("image_load");
    await unreadable.run({ personImage: PERSON, garmentImage: { kind: "data", jpeg: GARMENT }, locale: "fr" });
    expect(unreadable.garmentKinds).toEqual(["url", "data"]);
    expect(await new FakeProvider({ balance: 3 }).getCreditBalance()).toBe(3);
    expect((await failure(() => new FakeProvider({ balanceFailure: "unavailable" }).getCreditBalance())).kind).toBe("unavailable");
  });
});

describe("choix du fournisseur par TRYON_PROVIDER", () => {
  it("fake → le faux ; fashn → FASHN (avec sa clé)", () => {
    const fake = readTryonConfig({ TRYON_ENABLED: true, TRYON_PROVIDER: "fake" } as never, "development");
    const fashn = readTryonConfig({ TRYON_ENABLED: true, TRYON_PROVIDER: "fashn", FASHN_API_KEY: KEY } as never, "production");
    if (fake.state !== "ready" || fashn.state !== "ready") throw new Error("réglages attendus prêts");
    expect(createTryonProvider(fake.config)).toBeInstanceOf(FakeProvider);
    expect(createTryonProvider(fashn.config)).toBeInstanceOf(FashnProvider);
    expect(createTryonProvider(fashn.config).name).toBe("fashn");
  });
});
