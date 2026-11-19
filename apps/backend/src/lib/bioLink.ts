import { checkBioLink } from "@monapp/shared-types";
import { isWebUrl } from "./validation.js";

// Lien en bio (lot « vie sociale », migration 0049) : ce que le serveur
// accepte. La règle elle-même est dans @monapp/shared-types (checkBioLink),
// la même que l'app applique pour prévenir tout de suite ; ici, le serveur
// seul juge : il refait aussi la vérification commune des liens web
// (isWebUrl : aucun caractère de contrôle, aucun identifiant), et donne au
// filtre des mots interdits ce que le membre a écrit (routes/me.ts). Le lien
// n'est jamais journalisé.

export const LINK_INVALID = { error: "link_invalid", message: "Le lien doit commencer par https:// et mener à un site web." } as const;
export const LINK_TOO_LONG = { error: "link_too_long", message: "Le lien est trop long (200 caractères maximum)." } as const;

export type BioLinkResult = { ok: true; url: string | null } | { ok: false; refusal: typeof LINK_INVALID | typeof LINK_TOO_LONG };

/** Le lien à enregistrer (mis en forme ; null ou "" : retiré), ou la raison du refus. */
export function bioLinkProblem(input: string | null): BioLinkResult {
  if (input === null) return { ok: true, url: null };
  const checked = checkBioLink(input);
  if (!checked.ok) return { ok: false, refusal: checked.problem === "too_long" ? LINK_TOO_LONG : LINK_INVALID };
  if (checked.url !== null && !isWebUrl(input.trim())) return { ok: false, refusal: LINK_INVALID };
  return { ok: true, url: checked.url };
}

/** Les textes d'un lien à passer au filtre des mots interdits : tel qu'écrit,
 * tel qu'enregistré, et décodé (« %75 » ne cache pas un mot). */
export function bioLinkTexts(input: string | null, stored: string | null): string[] {
  const texts = [input ?? "", stored ?? ""];
  for (const text of texts.slice()) {
    try {
      texts.push(decodeURIComponent(text));
    } catch {
      // Un « % » isolé : le texte tel quel suffit.
    }
  }
  return texts.filter((text) => text !== "");
}
