// Clé de PRODUCTION d'Anthropic → variable ANTHROPIC_API_KEY du service
// spotto-api sur Render, en une seule manipulation du fondateur (décision du
// 2026-10-07, lot 4, temps 1 bis) :
//
//   pnpm --filter backend configurer-anthropic-prod               annonce seule (rien n'est demandé ni envoyé)
//   pnpm --filter backend configurer-anthropic-prod --confirmer   saisie masquée, validation, envoi, contrôle
//
// 1. Saisie masquée : la clé ne s'affiche jamais ; elle n'est écrite dans aucun
//    fichier et n'apparaît dans aucun message ni journal.
// 2. Refus immédiat si ce n'est pas une clé d'Anthropic, ou si c'est la clé
//    d'ESSAI enregistrée sur ce Mac.
// 3. Validation gratuite auprès d'Anthropic (liste des modèles : aucune image,
//    aucun texte) ; le modèle du serveur doit être accessible.
// 4. Envoi à Render par le garde-fou (scripts/lib/render-guard.ts) : UNE
//    variable, ANTHROPIC_API_KEY, sur spotto-api seulement ; aucune autre
//    variable modifiée, aucune suppression, aucun déploiement.
// 5. Contrôle : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERPAPI_KEY et
//    ANTHROPIC_API_KEY existent sur spotto-api — leurs valeurs ne sont jamais lues.
import { askHidden } from "./lib/prompt.js";
import { cleEssaiEventuelle } from "./lib/anthropic-essai.js";
import { assertProductionKey, checkRequiredVariables, sendAnthropicKey, validateAnthropicKey } from "./lib/anthropic-prod.js";
import { readRenderKey } from "./lib/render-api.js";
import { ALLOWED_SERVICES, SECRET_VARIABLE } from "./lib/render-guard.js";
import { VIDEO_AI_SETTINGS } from "../src/services/videoMoments.js";

async function main(): Promise<void> {
  const service = ALLOWED_SERVICES[SECRET_VARIABLE.service];
  console.log(
    `ACTION ANNONCÉE : enregistrer la clé de production d'Anthropic comme variable ${SECRET_VARIABLE.key} du service « ${SECRET_VARIABLE.service} » (${service.id}), sans déployer. Aucune autre variable n'est modifiée ; rien n'est supprimé.`
  );
  if (!process.argv.includes("--confirmer")) {
    console.log("Rien n'est demandé ni envoyé. Relancer avec --confirmer.");
    return;
  }
  // La clé Render d'abord : inutile de demander la clé d'Anthropic si l'envoi est impossible.
  const renderKey = readRenderKey();
  const key = await askHidden("Clé de PRODUCTION d'Anthropic (ne s'affiche pas) : ");
  assertProductionKey(key, cleEssaiEventuelle());
  await validateAnthropicKey(key);
  console.log(`✓ Clé acceptée par Anthropic (appel gratuit) ; modèle du serveur accessible : ${VIDEO_AI_SETTINGS.model}.`);
  const action = await sendAnthropicKey(renderKey, key);
  console.log(`✓ ${SECRET_VARIABLE.key} ${action} sur « ${SECRET_VARIABLE.service} » (valeur jamais affichée).`);
  const { present, missing } = await checkRequiredVariables(renderKey);
  for (const name of present) console.log(`✓ ${name} : présente (valeur non lue)`);
  if (missing.length > 0) {
    throw new Error(`Variables absentes sur « ${SECRET_VARIABLE.service} » : ${missing.join(", ")}. À vérifier dans le tableau de bord de Render, sans rien modifier d'autre.`);
  }
  console.log("Aucun déploiement lancé : la clé sera prise au prochain déploiement de spotto-api.");
  console.log("Pensez à vider le presse-papiers (copiez un simple mot).");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
