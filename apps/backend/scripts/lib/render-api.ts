// Appels à l'API de Render, partagés par render-bride et configurer-anthropic-prod
// (garde-fou : scripts/lib/render-guard.ts). La clé d'API Render est lue dans
// apps/backend/.render-api-key (ignoré par Git) et n'est jamais affichée.
// Méthodes possibles : lecture, création d'un déploiement, écriture d'UNE
// variable — jamais de suppression.
import { existsSync, readFileSync } from "node:fs";
import { RENDER_KEY_PATH, RenderGuardError } from "./render-guard.js";

export const RENDER_API = "https://api.render.com/v1";

/** Même signature que fetch : remplacée par des réponses simulées dans les tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class RenderNotFound extends Error {}

export function readRenderKey(): string {
  if (!existsSync(RENDER_KEY_PATH)) throw new RenderGuardError("Clé Render absente : lancez d'abord « pnpm --filter backend configurer-render ».");
  const key = readFileSync(RENDER_KEY_PATH, "utf8").trim();
  if (!key) throw new RenderGuardError("Fichier de clé Render vide.");
  return key;
}

function headers(renderKey: string, withBody: boolean): Record<string, string> {
  return { Authorization: `Bearer ${renderKey}`, Accept: "application/json", ...(withBody ? { "Content-Type": "application/json" } : {}) };
}

/** Appel à l'API de Render (valeurs publiques seulement : la réponse peut être recopiée dans un message d'erreur). */
export async function renderRequest(
  renderKey: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  fetchImpl: FetchLike = fetch
): Promise<unknown> {
  const response = await fetchImpl(`${RENDER_API}${path}`, {
    method,
    headers: headers(renderKey, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (response.status === 404 && method === "GET") throw new RenderNotFound();
  if (!response.ok) throw new Error(`Render a répondu ${response.status}${text ? ` : ${text.slice(0, 200)}` : ""}`);
  return text ? JSON.parse(text) : null;
}

/** Une variable existe-t-elle ? Seul le code de réponse est regardé : la
 * réponse (qui contient la valeur) n'est jamais lue. */
export async function renderVariableExists(renderKey: string, serviceId: string, name: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const response = await fetchImpl(`${RENDER_API}/services/${serviceId}/env-vars/${name}`, { method: "GET", headers: headers(renderKey, false) });
  await response.body?.cancel();
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Render a répondu ${response.status} (lecture de l'existence de ${name}).`);
  return true;
}

/** Écrit UNE variable secrète. La réponse de Render (qui contient la valeur)
 * n'est jamais lue ni recopiée, même en cas d'erreur : seul son code l'est. */
export async function renderPutSecretVariable(renderKey: string, serviceId: string, name: string, value: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(`${RENDER_API}/services/${serviceId}/env-vars/${name}`, {
    method: "PUT",
    headers: headers(renderKey, true),
    body: JSON.stringify({ value }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Render a refusé l'enregistrement de ${name} (réponse ${response.status}).`);
}
