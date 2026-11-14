import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TryonRunResponse, TryonStatus } from "@monapp/shared-types";
import tryonRoutes, { TRYON_FALLBACK_MIN_MS, TRYON_TRY_DEADLINE_MS } from "../src/routes/tryon.js";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { MULTIPART_LIMITS } from "../src/lib/multipartErrors.js";
import { isErrorBody, localizeMessage } from "../src/lib/messages.js";
import { requestLocale } from "../src/lib/locale.js";
import { LOG_REDACT_PATHS, MASKED_DATA, requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { AI_DIGITAL_SOURCE_TYPE } from "../src/lib/tryon/band.js";
import { DEFAULT_FASHN_API_BASE_URL, TRYON_CONSENT_VERSION, type TryonConfig, type TryonConfigState } from "../src/lib/tryon/config.js";
import { FakeProvider, type FakeProviderOptions } from "../src/lib/tryon/providers/fake.js";
import { TryonProviderError, type TryOnProvider, type TryonRunInput, type TryonRunOutput } from "../src/lib/tryon/provider.js";
import { downloadPublicImage, PublicImageError } from "../src/lib/publicImage.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";
import { tryonRpc, type FakeTryonOptions } from "./fakeTryon.js";

// Essayage virtuel : chaque route, de bout en bout, avec le faux fournisseur
// (aucun réseau) et une fausse base en mémoire qui imite les fonctions de la
// migration 0042 (tests/fakeTryon.ts). Le drapeau n'est allumé que dans cette
// fausse base, en mémoire. Aucun appel à FASHN, à Supabase ni à une boutique :
// le téléchargement d'une image de pièce est remplacé par un faux.

vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return { ...original, downloadPublicImage: vi.fn() };
});
const download = vi.mocked(downloadPublicImage);

const USER = "a0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const OWN_SEARCH = "5e000000-0000-4000-8000-000000000001";
const OTHER_SEARCH = "5e000000-0000-4000-8000-000000000002";
const MATCH = "11000000-0000-4000-8000-000000000001";
const OTHER_MATCH = "11000000-0000-4000-8000-000000000002";
const HTTP_ONLY_MATCH = "11000000-0000-4000-8000-000000000003";
const NO_LINK_MATCH = "11000000-0000-4000-8000-000000000004";
const HD_URL = "https://boutique.example/images/veste-hd.jpg";
const THUMB_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:veste";
/** 13 novembre 2026, 13 h à Paris : le prochain mois commence le 1er décembre à 0 h (23 h UTC la veille). */
const NOW = new Date("2026-11-13T12:00:00.000Z");
const NEXT_RESET = "2026-11-30T23:00:00.000Z";

const PHOTO = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#c8b49a" } })
  .withExif({ IFD0: { Artist: "Camille Secret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100" } })
  .jpeg()
  .toBuffer();
const PHOTO_BASE64 = PHOTO.toString("base64");
const GARMENT = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#203040" } }).jpeg().toBuffer();

const CONFIG: TryonConfig = {
  provider: "fake",
  apiKey: null,
  apiBaseUrl: DEFAULT_FASHN_API_BASE_URL,
  freePerMonth: 5,
  bonusPerPurchase: 5,
  bonusValidityDays: 365,
  requireBuyLink: true,
  monthlyBudgetUsd: 100,
  alertThreshold: 0.8,
  pricePerCreditUsd: 0.075,
  minProviderCredits: 20,
  timeZone: "Europe/Paris",
};
const READY: TryonConfigState = { state: "ready", config: CONFIG };

type Fake = ReturnType<typeof fakeSupabase>;

interface Setup {
  db?: FakeDbOptions;
  tryon?: FakeTryonOptions;
  /** Drapeau de la base : allumé (par défaut), éteint, ou ligne absente (null). */
  flag?: boolean | null;
  /** Statut d'âge et consentement du membre (par défaut : majeur, consentement en vigueur). */
  profile?: Row | null;
}

function database(setup: Setup = {}): Fake {
  let fake!: Fake;
  fake = fakeSupabase({ ...setup.db, rpc: tryonRpc(() => fake, { now: () => NOW, ...setup.tryon }) });
  if (setup.flag !== null) fake.table("feature_flags").push({ key: "tryon", enabled: setup.flag ?? true, updated_at: NOW.toISOString() });
  fake.table("product_searches").push({ id: OWN_SEARCH, user_id: USER }, { id: OTHER_SEARCH, user_id: OTHER });
  const match = (id: string, search: string, fields: Row) => ({ id, search_id: search, image_url: THUMB_URL, image_hd_url: HD_URL, merchant_url: "https://boutique.example/veste", ...fields });
  fake.table("product_matches").push(
    match(MATCH, OWN_SEARCH, {}),
    match(OTHER_MATCH, OTHER_SEARCH, {}),
    match(HTTP_ONLY_MATCH, OWN_SEARCH, { image_url: "http://boutique.example/veste.jpg", image_hd_url: null }),
    match(NO_LINK_MATCH, OWN_SEARCH, { merchant_url: "pas un lien" })
  );
  fake.table("affiliate_links").push({ product_match_id: MATCH, affiliate_url: "https://boutique.example/veste" });
  const profile =
    setup.profile === undefined
      ? { age_status: "adult", age_checked_at: NOW.toISOString(), consent_version: TRYON_CONSENT_VERSION, consent_accepted_at: NOW.toISOString(), consent_withdrawn_at: null }
      : setup.profile;
  if (profile) fake.table("tryon_profiles").push({ user_id: USER, ...profile });
  return fake;
}

let app: FastifyInstance | null = null;
let lines: string[] = [];

afterEach(async () => {
  await app?.close();
  app = null;
  download.mockReset();
});

beforeEach(() => {
  lines = [];
  download.mockRejectedValue(new PublicImageError("Image injoignable"));
});

/** Un fournisseur réglé essai par essai : chacun note le temps que la route
 * lui laisse (délai commun) et la forme de l'image de la pièce, puis joue son
 * étape (faire avancer l'horloge du test, répondre ou échouer). */
class ScriptedProvider implements TryOnProvider {
  readonly name = "fake" as const;
  readonly timesLeft: (number | undefined)[] = [];
  readonly garmentKinds: ("url" | "data")[] = [];

  constructor(
    private readonly steps: ((input: TryonRunInput) => Promise<TryonRunOutput>)[],
    private readonly balance: () => Promise<number> = async () => 1000
  ) {}

  async run(input: TryonRunInput): Promise<TryonRunOutput> {
    this.timesLeft.push(input.timeLeftMs);
    this.garmentKinds.push(input.garmentImage.kind);
    const step = this.steps[this.timesLeft.length - 1];
    if (!step) throw new Error("essai imprévu");
    return step(input);
  }

  getCreditBalance(): Promise<number> {
    return this.balance();
  }
}

/** L'app réduite aux routes de l'essayage, avec le journal de production (masquage compris)
 * et la traduction des messages d'erreur (app.ts). */
async function tryonApp(
  fake: Fake,
  options: { config?: TryonConfigState; provider?: TryOnProvider | FakeProviderOptions; userId?: string; now?: () => Date } = {}
): Promise<FastifyInstance> {
  app = Fastify({
    logger: {
      level: "info",
      stream: { write: (line: string) => lines.push(line) },
      redact: { paths: LOG_REDACT_PATHS, censor: MASKED_DATA },
      serializers: { req: requestLogFields },
      formatters: { log: withoutErrorDetails },
      hooks: { streamWrite: scrubLogLine },
    },
  });
  await app.register(multipart, { limits: MULTIPART_LIMITS });
  app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: options.userId ?? USER, email: null };
  });
  app.decorate("requireActiveAccount", async () => {});
  app.addHook("preSerialization", async (request, reply, payload) =>
    reply.statusCode < 400 || !isErrorBody(payload) ? payload : { ...payload, message: localizeMessage(payload.message, reply.statusCode, requestLocale(request)) }
  );
  await app.register(rateLimitPlugin);
  const provider = options.provider instanceof FakeProvider || (options.provider && "run" in options.provider) ? (options.provider as TryOnProvider) : new FakeProvider(options.provider as FakeProviderOptions | undefined);
  await app.register(tryonRoutes, { configState: options.config ?? READY, provider, now: options.now ?? (() => NOW) });
  await app.ready();
  return app;
}

/** Formulaire d'un essai : la photo et les champs (attestSelf: "true" par défaut). */
function tryForm(fields: Record<string, string> = {}, photo: Buffer = PHOTO, photoField = "photo") {
  const boundary = "limiteDeTestEssayage";
  const all = { itemId: MATCH, attestSelf: "true", ...fields };
  const parts: Buffer[] = Object.entries(all).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${photoField}"; filename="moi.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), photo, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const run = (target: FastifyInstance, fields: Record<string, string> = {}, photo?: Buffer, headers: Record<string, string> = {}) => {
  const form = tryForm(fields, photo);
  return target.inject({ method: "POST", url: "/api/tryon", payload: form.payload, headers: { ...form.headers, ...headers } });
};
const status = async (target: FastifyInstance) => (await target.inject({ method: "GET", url: "/api/tryon/status" })).json() as TryonStatus;
const events = (fake: Fake) => fake.table("tryon_events");

describe("éteint : rien n'est proposé, rien ne part", () => {
  const cases: [string, Setup, TryonConfigState][] = [
    ["interrupteur TRYON_ENABLED coupé (drapeau allumé)", {}, { state: "off" }],
    ["réglages invalides (drapeau allumé)", {}, { state: "invalid", problems: ["TRYON_PROVIDER : fournisseur inconnu (fake ou fashn)"] }],
    ["drapeau de la base éteint", { flag: false }, READY],
    ["drapeau absent de la base", { flag: null }, READY],
    ["table des drapeaux absente (base sans 0042)", { db: { missing: ["feature_flags"] } }, READY],
  ];
  for (const [label, setup, config] of cases) {
    it(label, async () => {
      const fake = database(setup);
      const target = await tryonApp(fake, { config });
      const statusResponse = await target.inject({ method: "GET", url: "/api/tryon/status" });
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toEqual({ enabled: false });
      expect(statusResponse.headers["cache-control"]).toBe("no-store");
      const disabled = { error: "feature_disabled", message: "L'essayage virtuel n'est pas disponible." };
      for (const response of [
        await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "1990-01-01" } }),
        await target.inject({ method: "POST", url: "/api/tryon/consent", payload: { version: TRYON_CONSENT_VERSION } }),
        await run(target),
        await target.inject({ method: "POST", url: "/api/tryon/report", payload: { itemId: MATCH, reason: "other" } }),
      ]) {
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual(disabled);
      }
      expect(events(fake)).toEqual([]);
      // Le consentement se lit toujours (Réglages du site : le retrait reste possible).
      const consent = await target.inject({ method: "GET", url: "/api/tryon/consent" });
      expect(consent.statusCode).toBe(200);
      expect(consent.headers["cache-control"]).toBe("no-store");
      expect(consent.json()).toEqual({ consent: { given: true, version: TRYON_CONSENT_VERSION } });
    });
  }

  it("le message est traduit en anglais ; retirer son consentement reste possible", async () => {
    const fake = database({ flag: false });
    const target = await tryonApp(fake);
    const english = await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "1990-01-01" }, headers: { "accept-language": "en" } });
    expect(english.json()).toEqual({ error: "feature_disabled", message: "Virtual try-on isn't available." });
    const withdrawn = await target.inject({ method: "DELETE", url: "/api/tryon/consent" });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toEqual({ consent: { required: true, version: TRYON_CONSENT_VERSION } });
    expect(fake.table("tryon_profiles")[0]!.consent_withdrawn_at).toBe(NOW.toISOString());
  });

  it("le retrait du consentement fonctionne aussi sur une base sans 0042 (rien à retirer)", async () => {
    const fake = database({ db: { missing: ["tryon_profiles", "feature_flags"] } });
    const target = await tryonApp(fake);
    expect((await target.inject({ method: "DELETE", url: "/api/tryon/consent" })).statusCode).toBe(200);
  });
});

describe("lecture du consentement (GET /api/tryon/consent) : toujours possible, fonction allumée ou non", () => {
  const read = async (target: FastifyInstance) => (await target.inject({ method: "GET", url: "/api/tryon/consent" })).json() as unknown;
  const adult = { age_status: "adult", age_checked_at: NOW.toISOString(), consent_version: null, consent_accepted_at: null, consent_withdrawn_at: null };

  it("donné : oui tant qu'il n'est pas retiré, même pour une ancienne version ; jamais donné ou retiré : non", async () => {
    const version = TRYON_CONSENT_VERSION;
    expect(await read(await tryonApp(database()))).toEqual({ consent: { given: true, version } });
    expect(await read(await tryonApp(database({ profile: null })))).toEqual({ consent: { given: false, version } });
    expect(await read(await tryonApp(database({ profile: adult })))).toEqual({ consent: { given: false, version } });
    expect(await read(await tryonApp(database({ profile: { ...adult, consent_version: "2025-01-v0", consent_accepted_at: NOW.toISOString() } })))).toEqual({ consent: { given: true, version } });
    const withdrawn = { ...adult, consent_version: version, consent_accepted_at: NOW.toISOString(), consent_withdrawn_at: NOW.toISOString() };
    expect(await read(await tryonApp(database({ profile: withdrawn }), { config: { state: "off" } }))).toEqual({ consent: { given: false, version } });
  });

  it("puis retiré, fonction éteinte : la lecture suit", async () => {
    const target = await tryonApp(database({ flag: false }));
    expect(await read(target)).toMatchObject({ consent: { given: true } });
    expect((await target.inject({ method: "DELETE", url: "/api/tryon/consent" })).statusCode).toBe(200);
    expect(await read(target)).toMatchObject({ consent: { given: false } });
  });

  it("base sans 0042 : rien n'a pu être accepté (non), sans erreur", async () => {
    const target = await tryonApp(database({ db: { missing: ["tryon_profiles", "feature_flags"] } }), { config: { state: "off" } });
    const response = await target.inject({ method: "GET", url: "/api/tryon/consent" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ consent: { given: false, version: TRYON_CONSENT_VERSION } });
  });

  it("ne lit ni le drapeau, ni la clé du fournisseur, et n'appelle jamais le fournisseur", async () => {
    const config = { ...CONFIG, provider: "fashn" as const };
    Object.defineProperty(config, "apiKey", {
      get() {
        throw new Error("clé lue");
      },
    });
    const untouchable: TryOnProvider = {
      name: "fashn",
      run: () => Promise.reject(new Error("fournisseur appelé")),
      getCreditBalance: () => Promise.reject(new Error("fournisseur appelé")),
    };
    const fake = database({ db: { missing: ["feature_flags"] } });
    const target = await tryonApp(fake, { config: { state: "ready", config }, provider: untouchable });
    const response = await target.inject({ method: "GET", url: "/api/tryon/consent" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ consent: { given: true, version: TRYON_CONSENT_VERSION } });
  });
});

describe("statut : âge, consentement, essais restants", () => {
  it("nouveau membre : âge inconnu, consentement à demander, 5 essais gratuits jusqu'au 1er décembre (Paris)", async () => {
    const target = await tryonApp(database({ profile: null }));
    const response = await target.inject({ method: "GET", url: "/api/tryon/status" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      enabled: true,
      ageGate: "unknown",
      consent: { required: true, version: TRYON_CONSENT_VERSION },
      remaining: { free: 5, bonus: 0, nextReset: NEXT_RESET },
    });
  });

  it("base illisible : éteint plutôt qu'une erreur (l'app ne propose rien)", async () => {
    const target = await tryonApp(database({ tryon: { failing: ["tryon_remaining"] } }));
    expect(await status(target)).toEqual({ enabled: false });
  });
});

describe("porte d'âge : la date de naissance n'est jamais gardée ni journalisée", () => {
  it("dates invalides refusées : pas une vraie date, mauvais format, dans le futur, avant 1900", async () => {
    const target = await tryonApp(database({ profile: null }));
    for (const birthDate of ["2008-02-30", "13/11/2008", "", "2027-01-01", "1899-12-31", " 2000-01-01", "2000-1-1"]) {
      const response = await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate } });
      expect(response.statusCode, birthDate).toBe(400);
      expect(response.json()).toEqual({ error: "tryon_birth_date_invalid", message: "Cette date de naissance n'est pas valide." });
    }
    expect((await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "2000-01-01", extra: 1 } })).statusCode).toBe(400);
  });

  it("17 ans et 364 jours : mineur, enregistré une fois pour toutes (409 ensuite) ; l'essai est refusé", async () => {
    const fake = database({ profile: null });
    const target = await tryonApp(fake);
    const first = await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "2008-11-14" } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ageGate: "minor" });
    const again = await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "1990-01-01" } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "tryon_age_already_set", message: "Votre âge a déjà été vérifié." });
    expect((await status(target)) as unknown).toMatchObject({ ageGate: "minor" });
    const consent = await target.inject({ method: "POST", url: "/api/tryon/consent", payload: { version: TRYON_CONSENT_VERSION } });
    expect(consent.statusCode).toBe(403);
    expect(consent.json()).toEqual({ error: "tryon_minor", message: "L'essayage virtuel est réservé aux personnes majeures." });
    const tried = await run(target);
    expect(tried.statusCode).toBe(403);
    expect(tried.json().error).toBe("tryon_minor");
    // Seuls le statut et sa date sont gardés.
    expect(fake.table("tryon_profiles")).toEqual([
      { user_id: USER, age_status: "minor", age_checked_at: NOW.toISOString(), consent_version: null, consent_accepted_at: null, consent_withdrawn_at: null },
    ]);
    expect(JSON.stringify([...fake.tables.values()])).not.toContain("2008-11-14");
    expect(lines.join("\n")).not.toContain("2008-11-14");
  });

  it("18 ans pile : majeur", async () => {
    const target = await tryonApp(database({ profile: null }));
    const response = await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "2008-11-13" } });
    expect(response.json()).toEqual({ ageGate: "adult" });
  });
});

describe("consentement versionné", () => {
  const adultWithoutConsent = { age_status: "adult", age_checked_at: NOW.toISOString(), consent_version: null, consent_accepted_at: null, consent_withdrawn_at: null };

  it("âge inconnu : la porte d'âge d'abord", async () => {
    const target = await tryonApp(database({ profile: null }));
    const response = await target.inject({ method: "POST", url: "/api/tryon/consent", payload: { version: TRYON_CONSENT_VERSION } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "tryon_age_required", message: "Indiquez d'abord votre date de naissance." });
  });

  it("une autre version que celle en vigueur : 409 ; la bonne : acceptée ; retirée : redemandée", async () => {
    const fake = database({ profile: adultWithoutConsent });
    const target = await tryonApp(fake);
    const outdated = await target.inject({ method: "POST", url: "/api/tryon/consent", payload: { version: "2025-01-v0" } });
    expect(outdated.statusCode).toBe(409);
    expect(outdated.json().error).toBe("tryon_consent_outdated");
    expect((await target.inject({ method: "POST", url: "/api/tryon/consent", payload: {} })).statusCode).toBe(400);

    const accepted = await target.inject({ method: "POST", url: "/api/tryon/consent", payload: { version: TRYON_CONSENT_VERSION } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ consent: { required: false, version: TRYON_CONSENT_VERSION } });
    expect(await status(target)).toMatchObject({ consent: { required: false } });

    const withdrawn = await target.inject({ method: "DELETE", url: "/api/tryon/consent" });
    expect(withdrawn.json()).toEqual({ consent: { required: true, version: TRYON_CONSENT_VERSION } });
    expect(await status(target)).toMatchObject({ consent: { required: true } });
    expect(fake.table("tryon_profiles")[0]).toMatchObject({ consent_version: TRYON_CONSENT_VERSION, consent_withdrawn_at: NOW.toISOString() });
    expect((await run(target)).json().error).toBe("tryon_consent_required");
  });

  it("consentement donné pour une ancienne version : l'essai demande de le relire", async () => {
    const target = await tryonApp(database({ profile: { ...adultWithoutConsent, consent_version: "2025-01-v0", consent_accepted_at: NOW.toISOString() } }));
    expect(await status(target)).toMatchObject({ consent: { required: true, version: TRYON_CONSENT_VERSION } });
    const tried = await run(target);
    expect(tried.statusCode).toBe(403);
    expect(tried.json()).toEqual({ error: "tryon_consent_outdated", message: "Les conditions de l'essayage virtuel ont changé. Relisez-les, puis acceptez-les à nouveau." });
  });
});

describe("un essai réussi", () => {
  it("image en data URI avec le bandeau IA et la métadonnée IPTC, sans EXIF ; décompté ; rien n'est gardé", async () => {
    const fake = database();
    const provider = new FakeProvider();
    const target = await tryonApp(fake, { provider });
    const response = await run(target);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json() as TryonRunResponse;
    expect(body.remaining).toEqual({ free: 4, bonus: 0, nextReset: NEXT_RESET });
    expect(body.image.startsWith("data:image/jpeg;base64,")).toBe(true);
    const image = Buffer.from(body.image.slice("data:image/jpeg;base64,".length), "base64");
    const metadata = await sharp(image).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(["jpeg", 600, 900]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp?.toString()).toContain(AI_DIGITAL_SOURCE_TYPE);
    expect(image.includes("Camille Secret")).toBe(false);
    // L'image de la pièce est partie par son adresse (l'originale de la boutique).
    expect(provider.garmentKinds).toEqual(["url"]);

    expect(events(fake)).toHaveLength(1);
    expect(events(fake)[0]).toMatchObject({ user_id: USER, item_id: MATCH, status: "succeeded", credits_used: 1, quota_source: "free", month: "2026-11", error_code: null });
    expect(fake.table("tryon_usage_months")).toEqual([{ month: "2026-11", credits_used: 1, tries_succeeded: 1 }]);
    // Aucune image nulle part : ni base, ni stockage, ni journal.
    expect(fake.uploads).toEqual([]);
    const everything = JSON.stringify([...fake.tables.values()]);
    for (const text of ["base64", "data:image", PHOTO_BASE64.slice(100, 160)]) expect(everything).not.toContain(text);
    const journal = lines.join("\n");
    expect(journal).toContain("Essayage réussi");
    expect(journal).not.toContain(PHOTO_BASE64.slice(100, 160));
    expect(journal).not.toContain(body.image.slice(200, 260));
  });

  it("le bandeau est dans la langue de l'app (anglais)", async () => {
    const french = await run(await tryonApp(database()));
    const english = await run(await tryonApp(database()), {}, undefined, { "accept-language": "en" });
    expect(french.statusCode).toBe(200);
    expect(english.statusCode).toBe(200);
    expect(french.json().image).not.toBe(english.json().image);
  });

  it("FASHN n'a pas pu charger l'image de la pièce : le serveur la télécharge (HD d'abord) et l'envoie en octets", async () => {
    const provider = new FakeProvider({ garmentUrlUnreadable: true });
    download.mockImplementation(async (url) => {
      if (url === HD_URL) throw new PublicImageError("Image indisponible (403)", 403);
      return Buffer.from(GARMENT);
    });
    const fake = database();
    const response = await run(await tryonApp(fake, { provider }));
    expect(response.statusCode).toBe(200);
    expect(provider.garmentKinds).toEqual(["url", "data"]);
    expect(download.mock.calls.map(([url]) => url)).toEqual([HD_URL, THUMB_URL]);
    expect(events(fake)[0]).toMatchObject({ status: "succeeded" });
  });

  it("… et si aucune image de la pièce ne se télécharge : 422, rien de décompté", async () => {
    const fake = database();
    const response = await run(await tryonApp(fake, { provider: { garmentUrlUnreadable: true } }));
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("tryon_image_unreadable");
    expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: "garment_unavailable", quota_source: null });
  });
});

describe("un seul délai par essai, dès la réservation (100 s, sous les 120 s du site et les 3 minutes de la base)", () => {
  /** Horloge du test, que le fournisseur fait avancer. */
  function testClock() {
    let current = NOW.getTime();
    return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
  }
  const banded = async (): Promise<TryonRunOutput> => ({ image: Buffer.from(GARMENT), creditsUsed: 1 });

  it("le solde et le premier envoi consomment le délai ; le second envoi n'a que le temps qui reste, jamais un délai neuf", async () => {
    const clock = testClock();
    const provider = new ScriptedProvider(
      [
        async () => {
          clock.advance(50_000);
          throw new TryonProviderError("image_load");
        },
        banded,
      ],
      async () => {
        clock.advance(10_000);
        return 1000;
      }
    );
    download.mockResolvedValue(Buffer.from(GARMENT));
    const fake = database();
    const response = await run(await tryonApp(fake, { provider, now: clock.now }));
    expect(response.statusCode).toBe(200);
    expect(provider.garmentKinds).toEqual(["url", "data"]);
    expect(provider.timesLeft).toEqual([TRYON_TRY_DEADLINE_MS - 10_000, TRYON_TRY_DEADLINE_MS - 60_000]);
    expect(events(fake)[0]).toMatchObject({ status: "succeeded", quota_source: "free" });
  });

  it("trop peu de temps pour le repli : 504 tryon_timeout, ni téléchargement ni second envoi, jamais décompté, rien de facturé", async () => {
    const clock = testClock();
    const provider = new ScriptedProvider([
      async () => {
        clock.advance(TRYON_TRY_DEADLINE_MS - TRYON_FALLBACK_MIN_MS + 1);
        throw new TryonProviderError("image_load");
      },
    ]);
    const fake = database();
    const target = await tryonApp(fake, { provider, now: clock.now });
    const response = await run(target, {}, undefined, { "accept-language": "en" });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ error: "tryon_timeout", message: "The try-on took too long. Please try again in a moment." });
    expect(download).not.toHaveBeenCalled();
    expect(provider.timesLeft).toHaveLength(1);
    expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: "timeout", quota_source: null, credits_used: 0 });
    expect(fake.table("tryon_usage_months")).toEqual([]);
    expect(await status(target)).toMatchObject({ remaining: { free: 5 } });
  });

  it("le téléchargement de la pièce compte aussi : plus le temps d'un second envoi, la vignette n'est pas essayée", async () => {
    const clock = testClock();
    const provider = new ScriptedProvider([
      async () => {
        clock.advance(70_000);
        throw new TryonProviderError("image_load");
      },
    ]);
    download.mockImplementation(async () => {
      clock.advance(10_000);
      throw new PublicImageError("Image injoignable");
    });
    const fake = database();
    const response = await run(await tryonApp(fake, { provider, now: clock.now }));
    expect(response.statusCode).toBe(504);
    expect(response.json().error).toBe("tryon_timeout");
    expect(download.mock.calls.map(([url]) => url)).toEqual([HD_URL]);
    expect(provider.timesLeft).toHaveLength(1);
    expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: "timeout" });
  });

  it("le délai commun reste sous celui du site (envoi de la photo, bandeau et décompte en plus) et loin de la libération par la base", () => {
    const sheet = readFileSync(join(__dirname, "../../mobile/src/components/tryon-sheet.web.tsx"), "utf8");
    const clientTimeout = Number(/const CLIENT_TIMEOUT_MS = ([\d_]+);/.exec(sheet)?.[1]?.replaceAll("_", ""));
    expect(clientTimeout).toBe(120_000);
    expect(clientTimeout - TRYON_TRY_DEADLINE_MS).toBeGreaterThanOrEqual(20_000);
    const migration = readFileSync(join(__dirname, "../supabase/migrations/0042_essayage_virtuel.sql"), "utf8");
    expect(migration).toContain("v_window_start := v_at - interval '3 minutes';");
    expect(3 * 60_000 - TRYON_TRY_DEADLINE_MS).toBeGreaterThanOrEqual(60_000);
    expect(TRYON_FALLBACK_MIN_MS).toBeLessThan(TRYON_TRY_DEADLINE_MS);
  });
});

describe("échecs que le fournisseur a pu facturer : jamais pris sur le quota, comptés dans la dépense du mois", () => {
  it("essai accepté, puis délai dépassé : 504, jamais décompté, 1 crédit dans les compteurs du mois (sans membre)", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new TryonProviderError("timeout", undefined, 1);
      },
    ]);
    const fake = database();
    const target = await tryonApp(fake, { provider });
    const response = await run(target);
    expect(response.statusCode).toBe(504);
    expect(response.json().error).toBe("tryon_timeout");
    expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: "timeout", quota_source: null, credits_used: 0 });
    expect(fake.table("tryon_usage_months")).toEqual([{ month: "2026-11", credits_used: 1, tries_succeeded: 0 }]);
    expect(await status(target)).toMatchObject({ remaining: { free: 5 } });
    expect(lines.some((line) => line.includes("Essayage échoué") && line.includes('"creditsBilled":1'))).toBe(true);
  });

  it("résultat payé, mais bandeau impossible (image illisible) : les crédits annoncés vont à la dépense du mois", async () => {
    const provider = new ScriptedProvider([async () => ({ image: Buffer.from("pas une image"), creditsUsed: 2 })]);
    const fake = database();
    const response = await run(await tryonApp(fake, { provider }));
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("tryon_provider_unavailable");
    expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: "result_unreadable", quota_source: null });
    expect(fake.table("tryon_usage_months")).toEqual([{ month: "2026-11", credits_used: 2, tries_succeeded: 0 }]);
  });

  it("un échec facturé qui franchit 80 % du budget : alerte budget_80 enregistrée et journalisée une fois", async () => {
    const fake = database();
    // Seuil de 80 $ : 1 066 crédits = 79,95 $ ; le crédit facturé le franchit.
    fake.table("tryon_usage_months").push({ month: "2026-11", credits_used: 1066, tries_succeeded: 1066 });
    const provider = new ScriptedProvider([
      async () => {
        throw new TryonProviderError("invalid_response", 200, 1);
      },
      async () => {
        throw new TryonProviderError("invalid_response", 200, 1);
      },
    ]);
    const target = await tryonApp(fake, { provider });
    expect((await run(target)).statusCode).toBe(503);
    expect((await run(target)).statusCode).toBe(503);
    expect(fake.table("tryon_usage_months")).toEqual([{ month: "2026-11", credits_used: 1068, tries_succeeded: 1066 }]);
    expect(fake.table("tryon_alerts").map((row) => row.kind)).toEqual(["budget_80"]);
    const alerts = lines.filter((line) => line.includes("Alerte de l'essayage virtuel"));
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0]!)).toMatchObject({ alerte: "essayage_budget_80", periode: "2026-11" });
  });

  it("essai libéré par la base pendant qu'il tournait, puis rattrapé : image remise, jamais décomptée du quota ; ses crédits comptent", async () => {
    const fake = database();
    const provider = new ScriptedProvider([
      async (input) => {
        // Une réservation d'un autre membre libère l'essai (resté en cours plus de 3 minutes).
        Object.assign(events(fake)[0]!, { status: "failed", error_code: "expired", finished_at: NOW.toISOString() });
        return { image: Buffer.from(input.personImage), creditsUsed: 1 };
      },
    ]);
    const target = await tryonApp(fake, { provider });
    const response = await run(target);
    expect(response.statusCode).toBe(200);
    expect((response.json() as TryonRunResponse).remaining).toEqual({ free: 5, bonus: 0, nextReset: NEXT_RESET });
    expect(events(fake)[0]).toMatchObject({ status: "succeeded", quota_source: null, credits_used: 1 });
    expect(fake.table("tryon_usage_months")).toEqual([{ month: "2026-11", credits_used: 1, tries_succeeded: 1 }]);
    expect(await status(target)).toMatchObject({ remaining: { free: 5 } });
  });
});

describe("quota : 5 gratuits par mois, puis les essais offerts", () => {
  it("6e essai du mois : 429 ; un essai offert accordé : décompté ensuite", async () => {
    const fake = database();
    const target = await tryonApp(fake);
    for (let index = 0; index < 5; index += 1) expect((await run(target)).statusCode).toBe(200);
    const exhausted = await run(target);
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json()).toEqual({ error: "tryon_quota_exhausted", message: "Vous avez utilisé tous vos essais de ce mois-ci." });
    expect(await status(target)).toMatchObject({ remaining: { free: 0, bonus: 0 } });

    await fake.db.rpc("tryon_grant_bonus", { p_user_id: USER, p_order_ref: "CMD-1" });
    expect(await status(target)).toMatchObject({ remaining: { free: 0, bonus: 5 } });
    const bonus = await run(target);
    expect(bonus.statusCode).toBe(200);
    expect(bonus.json().remaining).toMatchObject({ free: 0, bonus: 4 });
    expect(events(fake).at(-1)).toMatchObject({ quota_source: "bonus" });
  });

  it("deux essais simultanés du même membre : un seul passe, l'autre « déjà en cours »", async () => {
    const fake = database();
    const target = await tryonApp(fake);
    const [first, second] = await Promise.all([run(target), run(target)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect([first, second].find((response) => response.statusCode === 409)!.json().error).toBe("tryon_in_progress");
    expect(events(fake).filter((row) => row.status === "succeeded")).toHaveLength(1);
  });

  it("6 essais en cours sur tout le service : « réessayez dans un instant »", async () => {
    const fake = database();
    for (let index = 0; index < 6; index += 1) {
      events(fake).push({ id: `e000000${index}-0000-4000-8000-000000000000`, user_id: OTHER, item_id: OTHER_MATCH, status: "pending", month: "2026-11", created_at: new Date(NOW.getTime() - 60_000).toISOString() });
    }
    const response = await run(await tryonApp(fake));
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("tryon_busy");
  });
});

describe("budget du mois", () => {
  it("atteint : refus automatique, message « momentanément indisponibles », alerte budget_100 une seule fois", async () => {
    const fake = database();
    // 100 $ à 0,075 $ le crédit : 1 333 crédits dépensés, plus de quoi payer un essai de plus.
    fake.table("tryon_usage_months").push({ month: "2026-11", credits_used: 1333, tries_succeeded: 1333 });
    const target = await tryonApp(fake);
    for (const headers of [{}, { "accept-language": "en" }] as Record<string, string>[]) {
      const response = await run(target, {}, undefined, headers);
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe("tryon_budget_reached");
    }
    expect((await run(target)).json().message).toBe("Les essais sont momentanément indisponibles.");
    expect(fake.table("tryon_alerts").map((row) => [row.kind, row.period])).toEqual([["budget_100", "2026-11"]]);
    expect(lines.filter((line) => line.includes("Alerte de l'essayage virtuel"))).toHaveLength(1);
    expect(events(fake)).toEqual([]);
  });

  it("80 % franchis par un essai réussi : alerte budget_80 enregistrée et journalisée (une fois)", async () => {
    const fake = database();
    // Seuil de 80 $ : 1 066 crédits = 79,95 $ ; l'essai suivant le franchit.
    fake.table("tryon_usage_months").push({ month: "2026-11", credits_used: 1066, tries_succeeded: 1066 });
    const target = await tryonApp(fake);
    expect((await run(target)).statusCode).toBe(200);
    expect((await run(target)).statusCode).toBe(200);
    expect(fake.table("tryon_alerts").map((row) => row.kind)).toEqual(["budget_80"]);
    const alerts = lines.filter((line) => line.includes("Alerte de l'essayage virtuel")).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 40, alerte: "essayage_budget_80", periode: "2026-11", budget_usd: 100 });
  });
});

describe("solde de crédits du fournisseur", () => {
  it("sous le minimum : refus, essai échoué « low_credits », une alerte par jour", async () => {
    const fake = database();
    const target = await tryonApp(fake, { provider: { balance: 19 } });
    for (let index = 0; index < 2; index += 1) {
      const response = await run(target);
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe("tryon_provider_unavailable");
    }
    expect(events(fake).map((row) => [row.status, row.error_code])).toEqual([
      ["failed", "low_credits"],
      ["failed", "low_credits"],
    ]);
    expect(fake.table("tryon_alerts").map((row) => [row.kind, row.period])).toEqual([["low_credits", "2026-11-13"]]);
    expect(lines.filter((line) => line.includes("essayage_low_credits"))).toHaveLength(1);
    expect(await status(target)).toMatchObject({ remaining: { free: 5 } });
  });

  it("solde illisible : refus, rien de décompté", async () => {
    const fake = database();
    const response = await run(await tryonApp(fake, { provider: { balanceFailure: "unavailable" } }));
    expect(response.statusCode).toBe(503);
    expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: "balance_unreadable" });
  });
});

describe("échecs du fournisseur : un message clair, jamais décompté", () => {
  const cases: [FakeProviderOptions["failure"], number, string, string][] = [
    ["pose_not_detected", 422, "tryon_pose_not_detected", "We couldn't detect your figure in this photo. Please choose a full-length or half-length photo with only one person and good lighting."],
    ["moderation_blocked", 422, "tryon_moderation_blocked", "This try-on was blocked by moderation. Please choose another piece or another photo."],
    ["invalid_input", 422, "tryon_image_unreadable", "Your photo or the piece's image couldn't be used. Please try another photo or another piece."],
    ["timeout", 504, "tryon_timeout", "The try-on took too long. Please try again in a moment."],
    ["unavailable", 503, "tryon_provider_unavailable", "The try-on service is temporarily unavailable. Please try again later."],
    ["rate_limited", 503, "tryon_busy", "Try-ons are in high demand right now. Please try again in a moment."],
    ["unauthorized", 503, "tryon_provider_unavailable", "The try-on service is temporarily unavailable. Please try again later."],
  ];
  for (const [failure, httpStatus, error, english] of cases) {
    it(`${failure} → ${httpStatus} ${error}`, async () => {
      const fake = database();
      const target = await tryonApp(fake, { provider: { failure } });
      const response = await run(target, {}, undefined, { "accept-language": "en" });
      expect(response.statusCode).toBe(httpStatus);
      expect(response.json()).toEqual({ error, message: english });
      expect(events(fake)[0]).toMatchObject({ status: "failed", error_code: failure, quota_source: null, credits_used: 0 });
      expect(await status(target)).toMatchObject({ remaining: { free: 5 } });
      // Échec annoncé par le fournisseur (ou refus avant tout essai) : rien de facturé, rien dans la dépense du mois.
      expect(fake.table("tryon_usage_months")).toEqual([]);
    });
  }

  it("plus de crédits chez le fournisseur : refus et alerte « solde bas »", async () => {
    const fake = database();
    const response = await run(await tryonApp(fake, { provider: { failure: "out_of_credits" } }));
    expect(response.json().error).toBe("tryon_provider_unavailable");
    expect(fake.table("tryon_alerts").map((row) => row.kind)).toEqual(["low_credits"]);
  });
});

describe("contrôles d'un essai, dans l'ordre", () => {
  it("« cette photo est la mienne » non cochée : 400, rien de réservé", async () => {
    const fake = database();
    const target = await tryonApp(fake);
    for (const attestSelf of ["false", "", "TRUE"]) {
      const response = await run(target, { attestSelf });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "tryon_attest_required", message: "Confirmez que cette photo est la vôtre." });
    }
    expect(events(fake)).toEqual([]);
  });

  it("pièce d'un autre membre ou inconnue : 404 ; identifiant illisible : 400", async () => {
    const target = await tryonApp(database());
    for (const itemId of [OTHER_MATCH, "99999999-0000-4000-8000-000000000000"]) {
      const response = await run(target, { itemId });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "tryon_item_not_found", message: "Pièce introuvable." });
    }
    expect((await run(target, { itemId: "https://boutique.example/veste.jpg" })).statusCode).toBe(400);
  });

  it("pièce sans image en https, ou sans lien d'achat valide : 422 (le lien n'est exigé que si TRYON_REQUIRE_BUY_LINK)", async () => {
    const fake = database();
    const target = await tryonApp(fake);
    for (const itemId of [HTTP_ONLY_MATCH, NO_LINK_MATCH]) {
      const response = await run(target, { itemId });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "tryon_item_not_eligible", message: "Cette pièce ne peut pas être essayée." });
    }
    const relaxed = await tryonApp(database(), { config: { state: "ready", config: { ...CONFIG, requireBuyLink: false } } });
    expect((await run(relaxed, { itemId: NO_LINK_MATCH })).statusCode).toBe(200);
  });

  it("photo GIF, SVG ou illisible : 415 (type réel), essai échoué sans être décompté", async () => {
    const fake = database();
    const target = await tryonApp(fake);
    const gif = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } }).gif().toBuffer();
    for (const photo of [gif, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]) {
      const response = await run(target, {}, photo);
      expect(response.statusCode).toBe(415);
      expect(response.json()).toEqual({ error: "tryon_photo_invalid", message: "Cette photo n'a pas pu être lue. Choisissez une photo JPEG, PNG ou WebP." });
    }
    expect(events(fake).map((row) => row.error_code)).toEqual(["photo_invalid", "photo_invalid"]);
    expect(await status(target)).toMatchObject({ remaining: { free: 5 } });
  });

  it("plus de 10 Mo : 413 ; sans photo, sans formulaire ou avec un champ de trop : 400", async () => {
    const target = await tryonApp(database());
    const tooLarge = await run(target, {}, Buffer.alloc(10 * 1024 * 1024 + 1, 1));
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toEqual({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
    expect((await target.inject({ method: "POST", url: "/api/tryon", payload: { itemId: MATCH, attestSelf: "true" } })).statusCode).toBe(400);
    const extra = tryForm({ note: "x" });
    expect((await target.inject({ method: "POST", url: "/api/tryon", payload: extra.payload, headers: extra.headers })).statusCode).toBe(400);
    const wrongField = tryForm({}, PHOTO, "fichier");
    expect((await target.inject({ method: "POST", url: "/api/tryon", payload: wrongField.payload, headers: wrongField.headers })).statusCode).toBe(400);
  });
});

describe("signalement d'un résultat (sans image)", () => {
  it("enregistré : la pièce, le motif, la précision ; 204", async () => {
    const fake = database();
    const target = await tryonApp(fake);
    expect((await run(target)).statusCode).toBe(200);
    const response = await target.inject({ method: "POST", url: "/api/tryon/report", payload: { itemId: MATCH, reason: "wrong_piece", comment: "  Ce n'est pas la bonne veste.  " } });
    expect(response.statusCode).toBe(204);
    expect(fake.table("tryon_reports")).toEqual([{ user_id: USER, item_id: MATCH, reason: "wrong_piece", comment: "Ce n'est pas la bonne veste." }]);
    const empty = await target.inject({ method: "POST", url: "/api/tryon/report", payload: { itemId: MATCH, reason: "other", comment: "   " } });
    expect(empty.statusCode).toBe(204);
    expect(fake.table("tryon_reports")[1]).toMatchObject({ comment: null });
  });

  it("motif inconnu, précision trop longue, champ en trop : 400 ; pièce jamais essayée : 404", async () => {
    const target = await tryonApp(database());
    for (const payload of [
      { itemId: MATCH, reason: "spam" },
      { itemId: MATCH, reason: "other", comment: "x".repeat(501) },
      { itemId: MATCH, reason: "other", image: "data:image/jpeg;base64,AAAA" },
      { itemId: "pas-un-identifiant", reason: "other" },
    ]) {
      const response = await target.inject({ method: "POST", url: "/api/tryon/report", payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_request", message: "Signalement invalide." });
    }
    const never = await target.inject({ method: "POST", url: "/api/tryon/report", payload: { itemId: MATCH, reason: "other" } });
    expect(never.statusCode).toBe(404);
  });
});

describe("limites par membre (rallumées le temps du test)", () => {
  let savedNodeEnv: string | undefined;
  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
  });
  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
  });

  it("porte d'âge : 5 par heure, puis 429 « tryon_rate_limited »", async () => {
    const target = await tryonApp(database({ profile: null }), { userId: "c0000000-0000-4000-8000-000000000003" });
    for (let index = 0; index < RATE_LIMITS.tryonAgeGate.max; index += 1) {
      expect((await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "pas une date" } })).statusCode).toBe(400);
    }
    const limited = await target.inject({ method: "POST", url: "/api/tryon/age-gate", payload: { birthDate: "1990-01-01" }, headers: { "accept-language": "en" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "tryon_rate_limited", message: "Too many attempts in a short time. Please try again in an hour." });
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("lecture du consentement : la limite du statut (60 par minute), puis 429, fonction éteinte comprise", async () => {
    const target = await tryonApp(database({ flag: false }), { userId: "c0000000-0000-4000-8000-000000000005" });
    for (let index = 0; index < RATE_LIMITS.tryonStatus.max; index += 1) expect((await target.inject({ method: "GET", url: "/api/tryon/consent" })).statusCode).toBe(200);
    const limited = await target.inject({ method: "GET", url: "/api/tryon/consent" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("tryon_rate_limited");
  });

  it("essais : 10 par heure par membre (chaque demande compte), puis 429", async () => {
    const target = await tryonApp(database({ profile: null }), { userId: "c0000000-0000-4000-8000-000000000004" });
    for (let index = 0; index < RATE_LIMITS.tryonRunUser.max; index += 1) expect((await run(target)).statusCode).toBe(403);
    const limited = await run(target);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("tryon_rate_limited");
    expect(RATE_LIMITS.tryonRunUserDaily.max).toBe(30);
    expect(RATE_LIMITS.tryonRunGlobal.scope).toBe("global");
  });
});
