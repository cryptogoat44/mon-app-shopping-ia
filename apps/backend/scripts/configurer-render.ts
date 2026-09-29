// Configuration UNIQUE, faite par le fondateur : enregistre la clé d'API
// Render dans apps/backend/.render-api-key (ignoré par Git, lisible par le
// seul utilisateur du Mac), utilisée ensuite par render-bride.
//
//   pnpm --filter backend configurer-render
//
// Saisie masquée ; la clé est testée auprès de Render (lecture du seul
// service spotto-api) avant d'être enregistrée ; elle n'est jamais affichée.
import { chmodSync, writeFileSync } from "node:fs";
import { askHidden } from "./lib/prompt.js";
import { ALLOWED_SERVICES, RENDER_KEY_PATH as KEY_PATH } from "./lib/render-guard.js";

async function main(): Promise<void> {
  const key = await askHidden("Clé d'API Render (ne s'affiche pas) : ");
  if (!key) throw new Error("Clé manquante.");

  const service = ALLOWED_SERVICES["spotto-api"];
  const response = await fetch(`https://api.render.com/v1/services/${service.id}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Clé refusée par Render (réponse ${response.status}) : rien n'est enregistré.`);
  const data = (await response.json()) as { name?: string };
  if (data.name !== "spotto-api") throw new Error("Réponse inattendue de Render : rien n'est enregistré.");

  writeFileSync(KEY_PATH, `${key}\n`, { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  console.log("Clé valide (service spotto-api trouvé) et enregistrée dans apps/backend/.render-api-key (ignoré par Git).");
  console.log("Pensez à vider le presse-papiers (copiez un simple mot).");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
