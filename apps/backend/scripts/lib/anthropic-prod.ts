// Clé de PRODUCTION d'Anthropic (lot 4, temps 1 bis ; décision du fondateur,
// 2026-10-07) : validation auprès d'Anthropic, envoi à Render comme variable
// ANTHROPIC_API_KEY du service spotto-api, puis contrôle de l'existence des
// variables indispensables. Logique sans saisie ni affichage, testée avec des
// réponses simulées (tests/anthropicProd.test.ts). La clé n'apparaît jamais
// dans un message, un fichier ou un journal.
import { z } from "zod";
import { VIDEO_AI_SETTINGS } from "../../src/services/videoMoments.js";
import { renderPutSecretVariable, renderVariableExists, type FetchLike } from "./render-api.js";
import { assertSecretVariable, isAnthropicKeyShape, REQUIRED_SERVER_VARIABLES, SECRET_VARIABLE } from "./render-guard.js";

const MODELS_URL = "https://api.anthropic.com/v1/models?limit=100";
const MODELS = z.object({ data: z.array(z.object({ id: z.string() })) });

export class AnthropicKeyError extends Error {}

/** Refus avant tout envoi : forme inattendue, ou clé d'essai collée par erreur. */
export function assertProductionKey(key: string, testKey: string | null): void {
  if (!isAnthropicKeyShape(key)) throw new AnthropicKeyError("Ce texte n'a pas la forme d'une clé d'Anthropic (sk-ant-…) : rien n'est envoyé.");
  if (testKey !== null && key === testKey) {
    throw new AnthropicKeyError("C'est la clé d'ESSAI (espace « Spotto – essais ») : créez la clé dans « Spotto – production ». Rien n'est envoyé.");
  }
}

/** Validation gratuite (liste des modèles : aucune image, aucun texte) ; le
 * modèle du serveur doit être accessible avec cette clé. */
export async function validateAnthropicKey(key: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(MODELS_URL, { method: "GET", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
  if (!response.ok) {
    await response.body?.cancel();
    const conseil =
      response.status === 400
        ? " Vérifiez qu'elle est rattachée au seul espace « Spotto – production »."
        : response.status === 401
          ? " Vérifiez qu'elle a été copiée en entier et qu'elle n'est ni désactivée ni expirée."
          : "";
    throw new AnthropicKeyError(`Clé refusée par Anthropic (réponse ${response.status}) : rien n'est envoyé à Render.${conseil}`);
  }
  const liste = MODELS.safeParse(await response.json().catch(() => null));
  if (!liste.success) throw new AnthropicKeyError("Réponse inattendue d'Anthropic : rien n'est envoyé à Render.");
  if (!liste.data.data.some((modele) => modele.id === VIDEO_AI_SETTINGS.model)) {
    throw new AnthropicKeyError(`Le modèle du serveur (${VIDEO_AI_SETTINGS.model}) n'est pas accessible avec cette clé : rien n'est envoyé à Render.`);
  }
}

/** Envoi à Render : ANTHROPIC_API_KEY sur spotto-api, et rien d'autre (garde-fou). */
export async function sendAnthropicKey(renderKey: string, key: string, fetchImpl: FetchLike = fetch): Promise<"créée" | "remplacée"> {
  const { serviceId, key: name } = assertSecretVariable(SECRET_VARIABLE.service, SECRET_VARIABLE.key);
  const existed = await renderVariableExists(renderKey, serviceId, name, fetchImpl);
  await renderPutSecretVariable(renderKey, serviceId, name, key, fetchImpl);
  return existed ? "remplacée" : "créée";
}

/** Après l'envoi : les variables indispensables existent-elles ? (valeurs jamais lues) */
export async function checkRequiredVariables(renderKey: string, fetchImpl: FetchLike = fetch): Promise<{ present: string[]; missing: string[] }> {
  const { serviceId } = assertSecretVariable(SECRET_VARIABLE.service, SECRET_VARIABLE.key);
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of REQUIRED_SERVER_VARIABLES) {
    if (await renderVariableExists(renderKey, serviceId, name, fetchImpl)) present.push(name);
    else missing.push(name);
  }
  return { present, missing };
}
