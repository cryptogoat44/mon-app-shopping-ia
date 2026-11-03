// Point d'entrée unique d'un lien dans le Spotter (lot « partager vers
// Spotto ») : lien collé dans le champ, ou partagé depuis une autre app par la
// feuille de partage d'iOS — une seule décision pour les deux. Le futur
// lecteur intégré se branchera ici (et dans use-link-entry.ts) sans rien
// changer aux appelants. Logique pure, testée.
import { t } from "../i18n";
import { detectLink, type LinkDetection, type LinkPlatform } from "./link-detection";
import { LINK_COVER_ENABLED } from "./spot-flags";

export type LinkStep =
  /** Analyse de l'image de couverture (Lot S), quand elle est active. */
  | { kind: "cover"; url: string; platform: LinkPlatform }
  /** Le lien ne se lit pas (analyse coupée) : l'aide « capture d'écran d'abord ». */
  | { kind: "help" }
  /** Pas un lien utilisable : on dit pourquoi. */
  | { kind: "refused"; message: string };

/** Pourquoi le texte n'est pas un lien utilisable ; null s'il l'est, ou s'il est vide. Messages affichés sous le champ. */
export function linkRefusal(detection: LinkDetection): string | null {
  if (detection.kind === "not_a_link") return t.spotter.notALink;
  if (detection.kind === "unsupported") return t.spotter.unsupportedLink;
  if (detection.kind === "not_a_video") return t.spotter.notAVideo[detection.platform];
  return null;
}

export function linkStep(text: string, coverEnabled: boolean = LINK_COVER_ENABLED): LinkStep {
  const detection = detectLink(text);
  if (detection.kind === "supported") return coverEnabled ? { kind: "cover", url: detection.url, platform: detection.platform } : { kind: "help" };
  // Analyse coupée : aucun lien TikTok, Instagram ou Pinterest ne se lit, vidéo
  // ou profil ; l'aide dit quoi faire à la place (la capture du bon moment).
  if (detection.kind === "not_a_video" && !coverEnabled) return { kind: "help" };
  return { kind: "refused", message: linkRefusal(detection) ?? t.spotter.notALink };
}
