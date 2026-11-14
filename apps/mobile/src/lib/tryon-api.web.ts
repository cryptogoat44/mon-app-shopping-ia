// Essayage virtuel photo (site) : les appels au serveur, et eux seuls.
// Fichier .web : jamais dans l'app iPhone (règle 2.5.19 d'Apple). Toutes les
// réponses sont relues (lib/tryon-read.web.ts). La photo part dans le corps
// de la requête, depuis la mémoire : jamais par une adresse, jamais par un
// fichier écrit quelque part. Aucun suivi d'usage (PostHog) de l'essayage.
import type { TryonAgeGateRequest, TryonConsentRequest, TryonConsentState, TryonReportRequest, TryonRunResponse, TryonStatus } from "@monapp/shared-types";
import { authorizedFetch } from "./api";
import { isGuid, readAgeGateResponse, readConsentResponse, readRunResponse, readTryonStatus } from "./tryon-read.web";

const TRYON_PATH = "/api/tryon";

/** Réponse du serveur sans la forme attendue (image ou état illisible). Le
 * message est un code, jamais montré tel quel. */
export class TryonResponseError extends Error {
  constructor() {
    super("tryon_response_unreadable");
    this.name = "TryonResponseError";
  }
}

async function jsonOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Disponibilité, porte d'âge, consentement et essais restants. Illisible :
 * « éteint » (rien ne s'affiche). */
export async function fetchTryonStatus(): Promise<TryonStatus> {
  const response = await authorizedFetch(`${TRYON_PATH}/status`, { cache: "no-store" });
  return readTryonStatus(await jsonOf(response));
}

/** Porte d'âge : la date part une fois, le serveur ne garde que le statut. */
export async function submitBirthDate(birthDate: string): Promise<"adult" | "minor"> {
  const body: TryonAgeGateRequest = { birthDate };
  const response = await authorizedFetch(`${TRYON_PATH}/age-gate`, { method: "POST", body: JSON.stringify(body) });
  const ageGate = readAgeGateResponse(await jsonOf(response));
  if (!ageGate) throw new TryonResponseError();
  return ageGate;
}

/** Accepte le texte de consentement dans la version lue par la personne. */
export async function acceptTryonConsent(version: string): Promise<TryonConsentState> {
  const body: TryonConsentRequest = { version };
  const response = await authorizedFetch(`${TRYON_PATH}/consent`, { method: "POST", body: JSON.stringify(body) });
  const consent = readConsentResponse(await jsonOf(response));
  if (!consent) throw new TryonResponseError();
  return consent;
}

/** Retire le consentement (Réglages). Possible même fonction éteinte côté serveur. */
export async function withdrawTryonConsent(): Promise<TryonConsentState> {
  const response = await authorizedFetch(`${TRYON_PATH}/consent`, { method: "DELETE" });
  const consent = readConsentResponse(await jsonOf(response));
  if (!consent) throw new TryonResponseError();
  return consent;
}

export interface TryonRunRequest {
  itemId: string;
  /** Le JPEG préparé sur l'appareil (lib/tryon-photo.web.ts). */
  photo: Blob;
  /** « Cette photo est la mienne », cochée : sans elle, rien ne part. */
  attestSelf: true;
  signal?: AbortSignal;
}

/** Lance un essai. Les champs de texte partent avant la photo : le serveur
 * les lit sans attendre le fichier. */
export async function runTryon({ itemId, photo, attestSelf, signal }: TryonRunRequest): Promise<TryonRunResponse> {
  if (!isGuid(itemId) || attestSelf !== true) throw new TryonResponseError();
  const form = new FormData();
  form.append("itemId", itemId);
  form.append("attestSelf", "true");
  form.append("photo", photo, "photo.jpg");
  const response = await authorizedFetch(TRYON_PATH, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  const result = readRunResponse(await jsonOf(response));
  if (!result) throw new TryonResponseError();
  return result;
}

/** Signale un résultat : la pièce, le motif, un commentaire facultatif.
 * Aucune image ne part. Réponse 204, sans corps. */
export async function reportTryonResult(report: TryonReportRequest): Promise<void> {
  await authorizedFetch(`${TRYON_PATH}/report`, { method: "POST", body: JSON.stringify(report) });
}
