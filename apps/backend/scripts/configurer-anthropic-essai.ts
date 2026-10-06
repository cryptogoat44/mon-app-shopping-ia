// Configuration UNIQUE, faite par le fondateur (lot 4, temps 1 bis) : enregistre
// la clé d'ESSAI d'Anthropic — espace de travail « essais », limite de dépense
// très basse — dans apps/backend/.anthropic-essai-key (ignoré par Git, lisible
// par le seul utilisateur du Mac). Elle sert UNIQUEMENT à comparer les modèles
// (comparer-modeles-video), jamais au serveur ; la clé de production, elle,
// est saisie par le fondateur dans Render.
//
//   pnpm --filter backend configurer-anthropic-essai
//
// Saisie masquée ; la clé est testée auprès d'Anthropic par la liste des
// modèles (gratuite : aucune image, aucun texte envoyé) ; jamais affichée.
import { chmodSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { askHidden } from "./lib/prompt.js";
import { ANTHROPIC_ESSAI_KEY_PATH } from "./lib/anthropic-essai.js";

const MODELES = ["claude-haiku-4-5-20251001", "claude-sonnet-5-5"];

async function main(): Promise<void> {
  const key = await askHidden("Clé d'API Anthropic d'ESSAI (ne s'affiche pas) : ");
  if (!key) throw new Error("Clé manquante.");
  const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (!response.ok) {
    // 400 : clé valable mais rattachée à plusieurs espaces de travail (Anthropic
    // exige alors l'espace à chaque appel) ; 401 : clé inconnue, désactivée ou expirée.
    const conseil =
      response.status === 400
        ? " Vérifiez qu'elle est rattachée à un seul espace de travail (« Spotto – essais »)."
        : response.status === 401
          ? " Vérifiez qu'elle a été copiée en entier et qu'elle n'est ni désactivée ni expirée."
          : "";
    throw new Error(`Clé refusée par Anthropic (réponse ${response.status}) : rien n'est enregistré.${conseil}`);
  }
  const liste = z.object({ data: z.array(z.object({ id: z.string() })) }).safeParse(await response.json());
  if (!liste.success) throw new Error("Réponse inattendue d'Anthropic : rien n'est enregistré.");
  const disponibles = new Set(liste.data.data.map((modele) => modele.id));
  for (const modele of MODELES) {
    console.log(`${disponibles.has(modele) ? "✓" : "⚠ absent :"} ${modele}`);
  }
  writeFileSync(ANTHROPIC_ESSAI_KEY_PATH, `${key}\n`, { mode: 0o600 });
  chmodSync(ANTHROPIC_ESSAI_KEY_PATH, 0o600);
  console.log("Clé d'essai valide et enregistrée dans apps/backend/.anthropic-essai-key (ignoré par Git).");
  console.log("Pensez à vider le presse-papiers (copiez un simple mot).");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
