// Fournisseur FASHN, modèle tryon-v1.6 (lot « essayage virtuel »), appelé
// exactement comme le dit sa documentation officielle :
// - POST {base}/run avec { model_name: "tryon-v1.6", inputs: {…} } et la clé
//   en « Authorization: Bearer » ; la réponse donne l'identifiant de l'essai ;
// - GET {base}/status/{id}, interrogé toutes les 1,5 s environ, jusqu'à
//   « completed » (image en base64 : return_base64) ou « failed » (nom de
//   l'erreur) ; délai total, soumission comprise : le temps qui reste à
//   l'essai (délai commun fixé par la route), 90 s au plus ;
// - GET {base}/credits pour le solde (gardé 5 minutes).
// La photo du membre part toujours en base64 (data URI), jamais par une
// adresse ; l'image de la pièce part par son adresse publique, ou en base64
// si FASHN n'a pas pu la charger (le serveur la télécharge alors lui-même).
// Jamais de double soumission : POST /run n'est retenté (deux fois au plus)
// que si la connexion n'a jamais pu s'établir, ou si FASHN a répondu
// exactement 500 ou 503 (aucun essai créé : « API-level errors » de la
// documentation) ; jamais sur une autre erreur 5xx (501, 502, 504, 520,
// 524… : une passerelle, où l'essai a pu partir quand même), ni après un
// délai dépassé ou une coupure en route.
// Un échec après que FASHN a accepté l'essai (délai dépassé, résultat ou
// réponse illisible…) a pu être facturé : l'erreur porte alors les crédits
// présumés (1, ou ceux de l'en-tête quand FASHN les a donnés), comptés dans
// le budget du mois. Un échec que FASHN annonce lui-même (« failed ») ne
// coûte rien. Seules des erreurs de provider.ts sortent d'ici, jamais une
// erreur brute (lecture d'un corps coupée en route comprise).
// Rien de ce que renvoie FASHN (messages d'erreur, images) n'est journalisé :
// les erreurs sont des sortes fixes (provider.ts). Seul l'hôte de l'adresse
// de l'API est permis, redirections comprises (lib/safeFetch.ts).
import { z } from "zod";
import { imageFormatOf } from "../../imageSafety.js";
import { SafeFetchError, safeFetch } from "../../safeFetch.js";
import { jpegDataUri } from "../images.js";
import { TryonProviderError, type TryOnProvider, type TryonGarmentImage, type TryonProviderErrorKind, type TryonRunInput, type TryonRunOutput } from "../provider.js";

export const FASHN_MODEL = "tryon-v1.6";
/** Intervalle entre deux lectures de l'état d'un essai. */
export const FASHN_POLL_INTERVAL_MS = 1_500;
/** Délai total d'un essai au plus, soumission comprise (la route en laisse
 * souvent moins : le temps qui reste à l'essai). */
export const FASHN_DEADLINE_MS = 90_000;
/** Durée pendant laquelle le solde de crédits lu est gardé. */
export const FASHN_BALANCE_TTL_MS = 5 * 60_000;
/** Attentes avant chaque nouvelle tentative de soumission (2 au plus). */
export const FASHN_RUN_RETRY_DELAYS_MS: readonly number[] = [500, 1_500];

const RUN_REQUEST_TIMEOUT_MS = 30_000;
const STATUS_REQUEST_TIMEOUT_MS = 10_000;
const CREDITS_REQUEST_TIMEOUT_MS = 10_000;
/** Une réponse de l'état porte l'image en base64 : quelques centaines de Ko. */
const MAX_STATUS_BYTES = 20 * 1024 * 1024;
const MAX_SMALL_RESPONSE_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 15 * 1024 * 1024;
const CREDITS_HEADER = "x-fashn-credits-used";
/** Un essai tryon-v1.6 coûte 1 crédit par image (num_samples: 1). */
const DEFAULT_CREDITS_PER_TRY = 1;

const PREDICTION_ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const RUN_RESPONSE = z.object({ id: PREDICTION_ID });
const ERROR_BODY = z.object({ error: z.string().max(100) });
const STATUS_RESPONSE = z.object({
  status: z.string().max(40),
  output: z.array(z.string()).nullish(),
  error: z.object({ name: z.string().max(100) }).nullish(),
});
const CREDITS_RESPONSE = z.object({ credits: z.object({ total: z.number().finite().min(0) }) });
const OUTPUT_DATA_URI = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Erreurs d'un essai (« status: failed ») : le nom de l'erreur, documenté. */
const JOB_ERRORS: Readonly<Record<string, TryonProviderErrorKind>> = {
  ImageLoadError: "image_load",
  ContentModerationError: "moderation_blocked",
  PoseError: "pose_not_detected",
  InputValidationError: "invalid_input",
  ThirdPartyError: "unavailable",
  UnavailableError: "unavailable",
  PipelineError: "unavailable",
};

/** Codes d'une connexion qui n'a jamais pu s'établir : rien n'est parti. */
const NEVER_CONNECTED_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

/** Le corps d'un essai : exactement les réglages demandés par la mission,
 * avec les valeurs documentées de tryon-v1.6. */
export function fashnRunBody(personImage: Buffer, garment: TryonGarmentImage) {
  return {
    model_name: FASHN_MODEL,
    inputs: {
      model_image: jpegDataUri(personImage),
      garment_image: garment.kind === "url" ? garment.url : jpegDataUri(garment.jpeg),
      category: "auto",
      mode: "balanced",
      garment_photo_type: "auto",
      // Obligatoire : bloque maillots, lingerie et tenues dénudées (la valeur
      // par défaut de FASHN, « permissive », les laisse passer).
      moderation_level: "conservative",
      num_samples: 1,
      output_format: "jpeg",
      return_base64: true,
    },
  };
}

/** Sorte d'une erreur HTTP de FASHN (« API-level errors »), d'après son code et le nom de l'erreur. */
export function httpErrorKind(status: number, errorName: string | null): TryonProviderErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return errorName === "OutOfCredits" ? "out_of_credits" : "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

/** Sorte d'un essai échoué, d'après le nom de son erreur ; un nom inconnu : panne. */
export function jobErrorKind(errorName: string | null | undefined): TryonProviderErrorKind {
  return (errorName && JOB_ERRORS[errorName]) || "unavailable";
}

/** Exactement 500 ou 503 à la soumission : aucun essai créé (documenté), on
 * peut réessayer. Toute autre erreur 5xx vient peut-être d'une passerelle,
 * après que l'essai est parti : jamais retentée. */
function isRetryableRunStatus(status: number): boolean {
  return status === 500 || status === 503;
}

function errorCode(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string" ? (value as { code: string }).code : undefined;
}

/** La demande n'a jamais quitté le serveur (connexion refusée, nom introuvable…).
 * fetch de Node : la vraie cause est dans error.cause (plusieurs adresses : AggregateError). */
export function neverConnected(error: unknown): boolean {
  const cause = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof AggregateError) return cause.errors.length > 0 && cause.errors.every((one) => NEVER_CONNECTED_CODES.has(errorCode(one) ?? ""));
  return NEVER_CONNECTED_CODES.has(errorCode(cause) ?? "");
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Une erreur ramenée à une sorte fixe : une erreur brute (lecture coupée en
 * route, délai) devient « timeout » ou « unavailable ». `creditsBilled` : les
 * crédits présumés quand FASHN avait déjà accepté l'essai. */
function typedError(error: unknown, status?: number, creditsBilled = 0): TryonProviderError {
  if (!(error instanceof TryonProviderError)) return new TryonProviderError(isTimeout(error) ? "timeout" : "unavailable", status, creditsBilled);
  return error.creditsBilled >= creditsBilled ? error : new TryonProviderError(error.kind, error.status ?? status, creditsBilled);
}

/** Abandonne le corps d'une réponse dont on n'a pas besoin (sans jamais échouer). */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Le corps d'une réponse, au plus `maxBytes` octets (sinon : réponse
 * inattendue). Une lecture coupée en route (délai, connexion perdue) lève
 * l'erreur brute : à l'appelant de la traiter. */
async function readBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(response);
    throw new TryonProviderError("invalid_response", response.status);
  }
  if (!response.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TryonProviderError("invalid_response", response.status);
      }
      chunks.push(value);
    }
  } catch (error) {
    // Lecture abandonnée : ce qui a déjà été lu ne reste pas en mémoire non plus.
    for (const chunk of chunks) chunk.fill(0);
    throw error;
  }
  const bytes = Buffer.concat(chunks);
  const text = bytes.toString("utf8");
  // Les octets lus (l'image produite, en base64) ne restent pas en mémoire.
  bytes.fill(0);
  for (const chunk of chunks) chunk.fill(0);
  return text;
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await readBody(response, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TryonProviderError("invalid_response", response.status);
  }
}

/** Le nom de l'erreur d'une réponse refusée (jamais son message). */
async function errorNameOf(response: Response): Promise<string | null> {
  try {
    const parsed = ERROR_BODY.safeParse(await readJson(response, MAX_SMALL_RESPONSE_BYTES));
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

/** Crédits consommés, d'après l'en-tête de FASHN (1 s'il manque ou se lit mal). */
function creditsUsedFrom(headers: Headers): number {
  const raw = headers.get(CREDITS_HEADER)?.trim();
  return raw && /^(?:[0-9]|10)$/.test(raw) ? Number(raw) : DEFAULT_CREDITS_PER_TRY;
}

/** L'image produite : une donnée base64 (jamais une adresse, jamais suivie),
 * JPEG ou PNG ; null si elle n'a pas cette forme. */
function decodeOutput(output: readonly string[] | null | undefined): Buffer | null {
  const first = output?.[0];
  const match = typeof first === "string" ? OUTPUT_DATA_URI.exec(first) : null;
  if (!match) return null;
  const image = Buffer.from(match[1]!, "base64");
  const format = imageFormatOf(image);
  if (image.length > MAX_RESULT_BYTES || (format !== "jpeg" && format !== "png")) {
    image.fill(0);
    return null;
  }
  return image;
}

export interface FashnProviderOptions {
  apiKey: string;
  /** Adresse de l'API, en https, sans « / » final (lib/tryon/config.ts). */
  baseUrl: string;
  pollIntervalMs?: number;
  deadlineMs?: number;
  balanceTtlMs?: number;
  retryDelaysMs?: readonly number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FashnProvider implements TryOnProvider {
  readonly name = "fashn" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly allowedHosts: string[];
  private readonly pollIntervalMs: number;
  private readonly deadlineMs: number;
  private readonly balanceTtlMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private balance: { value: number; readAt: number } | null = null;
  private balanceRead: Promise<number> | null = null;

  constructor(options: FashnProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    // Seul l'hôte de l'API est permis, redirections comprises.
    this.allowedHosts = [new URL(options.baseUrl).hostname];
    this.pollIntervalMs = options.pollIntervalMs ?? FASHN_POLL_INTERVAL_MS;
    this.deadlineMs = options.deadlineMs ?? FASHN_DEADLINE_MS;
    this.balanceTtlMs = options.balanceTtlMs ?? FASHN_BALANCE_TTL_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? FASHN_RUN_RETRY_DELAYS_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
  }

  async run(input: TryonRunInput): Promise<TryonRunOutput> {
    // Le temps qui reste à l'essai (délai commun de la route), jamais plus que le délai de FASHN.
    const timeLeft = input.timeLeftMs !== undefined && Number.isFinite(input.timeLeftMs) ? Math.min(input.timeLeftMs, this.deadlineMs) : this.deadlineMs;
    const deadline = this.now() + timeLeft;
    let accepted = false;
    try {
      const id = await this.submit(input, deadline);
      accepted = true;
      return await this.waitForResult(id, deadline);
    } catch (error) {
      if (error instanceof TryonProviderError) throw error;
      // Filet : jamais une erreur brute hors du fournisseur.
      throw typedError(error, undefined, accepted ? DEFAULT_CREDITS_PER_TRY : 0);
    }
  }

  async getCreditBalance(): Promise<number> {
    if (this.balance && this.now() - this.balance.readAt < this.balanceTtlMs) return this.balance.value;
    this.balanceRead ??= this.readBalance()
      .then((value) => {
        this.balance = { value, readAt: this.now() };
        return value;
      })
      .finally(() => {
        this.balanceRead = null;
      });
    return this.balanceRead;
  }

  private headers(json: boolean): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}`, accept: "application/json", ...(json ? { "content-type": "application/json" } : {}) };
  }

  private remaining(deadline: number): number {
    return deadline - this.now();
  }

  /** Soumet l'essai ; son identifiant. Retenté seulement quand rien n'a pu partir. */
  private async submit(input: TryonRunInput, deadline: number): Promise<string> {
    const body = JSON.stringify(fashnRunBody(input.personImage, input.garmentImage));
    for (let attempt = 0; ; attempt += 1) {
      const left = this.remaining(deadline);
      if (left <= 0) throw new TryonProviderError("timeout");
      const canRetry = attempt < this.retryDelaysMs.length;
      let response: Response;
      try {
        response = await safeFetch(`${this.baseUrl}/run`, {
          allowedHosts: this.allowedHosts,
          method: "POST",
          headers: this.headers(true),
          body,
          signal: AbortSignal.timeout(Math.min(RUN_REQUEST_TIMEOUT_MS, left)),
        });
      } catch (error) {
        if (canRetry && neverConnected(error)) {
          await this.sleep(this.retryDelaysMs[attempt]!);
          continue;
        }
        throw new TryonProviderError(isTimeout(error) ? "timeout" : "unavailable");
      }
      if (response.ok) {
        // FASHN a accepté l'essai : un échec à partir d'ici a pu être facturé,
        // et rien n'est jamais renvoyé (l'essai existe peut-être déjà).
        let body: unknown;
        try {
          body = await readJson(response, MAX_SMALL_RESPONSE_BYTES);
        } catch (error) {
          throw typedError(error, response.status, DEFAULT_CREDITS_PER_TRY);
        }
        const parsed = RUN_RESPONSE.safeParse(body);
        if (!parsed.success) throw new TryonProviderError("invalid_response", response.status, DEFAULT_CREDITS_PER_TRY);
        return parsed.data.id;
      }
      const kind = httpErrorKind(response.status, await errorNameOf(response));
      if (canRetry && isRetryableRunStatus(response.status)) {
        await this.sleep(this.retryDelaysMs[attempt]!);
        continue;
      }
      throw new TryonProviderError(kind, response.status);
    }
  }

  /** Lit l'état de l'essai toutes les 1,5 s jusqu'au résultat, à un échec, ou
   * au délai. L'essai est parti chez FASHN : s'il n'aboutit pas ici, FASHN a
   * pu le facturer quand même (1 crédit présumé, ou ceux de son en-tête),
   * sauf quand il annonce lui-même son échec. */
  private async waitForResult(id: string, deadline: number): Promise<TryonRunOutput> {
    const url = `${this.baseUrl}/status/${encodeURIComponent(id)}`;
    const billed = (kind: TryonProviderErrorKind, status?: number, credits = DEFAULT_CREDITS_PER_TRY) => new TryonProviderError(kind, status, credits);
    for (;;) {
      if (this.remaining(deadline) <= 0) throw billed("timeout");
      await this.sleep(Math.min(this.pollIntervalMs, this.remaining(deadline)));
      const left = this.remaining(deadline);
      if (left <= 0) throw billed("timeout");
      let response: Response;
      try {
        response = await safeFetch(url, {
          allowedHosts: this.allowedHosts,
          method: "GET",
          headers: this.headers(false),
          signal: AbortSignal.timeout(Math.min(STATUS_REQUEST_TIMEOUT_MS, left)),
        });
      } catch (error) {
        // Redirection vers un autre hôte : jamais suivie, panne. Sinon, une
        // lecture sans effet : la suivante, jusqu'au délai.
        if (error instanceof SafeFetchError) throw billed("unavailable");
        continue;
      }
      // Trop de lectures, ou panne passagère : on relit, jusqu'au délai.
      if (response.status === 429 || response.status >= 500) {
        await discardBody(response);
        continue;
      }
      if (!response.ok) throw billed(httpErrorKind(response.status, await errorNameOf(response)), response.status);
      let body: unknown;
      try {
        body = await readJson(response, MAX_STATUS_BYTES);
      } catch (error) {
        // Réponse trop grosse ou qui n'est pas du JSON : inattendue.
        if (error instanceof TryonProviderError) throw billed(error.kind, response.status);
        // Lecture coupée en route (délai de la lecture, connexion perdue) :
        // comme une lecture qui n'a pas abouti, la suivante, jusqu'au délai
        // (le résultat reste disponible chez FASHN).
        continue;
      }
      const parsed = STATUS_RESPONSE.safeParse(body);
      if (!parsed.success) throw billed("invalid_response", response.status);
      switch (parsed.data.status) {
        case "starting":
        case "in_queue":
        case "processing":
          continue;
        case "completed": {
          const creditsUsed = creditsUsedFrom(response.headers);
          const image = decodeOutput(parsed.data.output);
          // Payé (FASHN facture chaque image produite), mais illisible.
          if (!image) throw billed("invalid_response", response.status, creditsUsed);
          return { image, creditsUsed };
        }
        // Échecs annoncés par FASHN lui-même : jamais facturés.
        case "failed":
          throw new TryonProviderError(jobErrorKind(parsed.data.error?.name));
        // États cités par les exemples des SDK de FASHN.
        case "canceled":
          throw new TryonProviderError("unavailable");
        case "time_out":
          throw new TryonProviderError("timeout");
        default:
          throw billed("invalid_response", response.status);
      }
    }
  }

  private async readBalance(): Promise<number> {
    let response: Response;
    try {
      response = await safeFetch(`${this.baseUrl}/credits`, {
        allowedHosts: this.allowedHosts,
        method: "GET",
        headers: this.headers(false),
        signal: AbortSignal.timeout(CREDITS_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw typedError(error);
    }
    if (!response.ok) throw new TryonProviderError(httpErrorKind(response.status, await errorNameOf(response)), response.status);
    let body: unknown;
    try {
      body = await readJson(response, MAX_SMALL_RESPONSE_BYTES);
    } catch (error) {
      throw typedError(error, response.status);
    }
    const parsed = CREDITS_RESPONSE.safeParse(body);
    if (!parsed.success) throw new TryonProviderError("invalid_response", response.status);
    return parsed.data.credits.total;
  }
}
