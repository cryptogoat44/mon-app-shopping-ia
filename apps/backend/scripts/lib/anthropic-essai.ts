// Clé d'ESSAI d'Anthropic (lot 4, temps 1 bis) : enregistrée par le fondateur
// (configurer-anthropic-essai), lue seulement par la comparaison des modèles.
// Jamais utilisée par le serveur, jamais affichée ni recopiée.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ANTHROPIC_ESSAI_KEY_PATH = fileURLToPath(new URL("../../.anthropic-essai-key", import.meta.url));

export function lireCleEssai(): string {
  if (!existsSync(ANTHROPIC_ESSAI_KEY_PATH)) {
    throw new Error("Aucune clé d'essai : le fondateur doit d'abord lancer « pnpm --filter backend configurer-anthropic-essai ».");
  }
  const cle = readFileSync(ANTHROPIC_ESSAI_KEY_PATH, "utf8").trim();
  if (!cle) throw new Error("Clé d'essai vide : relancez « pnpm --filter backend configurer-anthropic-essai ».");
  return cle;
}
