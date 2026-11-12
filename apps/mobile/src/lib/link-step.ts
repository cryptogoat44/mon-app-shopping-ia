// Point d'entrée unique d'un lien dans le Spotter (lot « partager vers
// Spotto ») : lien collé dans le champ, ou partagé depuis une autre app par la
// feuille de partage d'iOS — une seule décision pour les deux. Le lecteur
// intégré (app iPhone, lot « lecteur intégré ») s'y branche : étape
// « player ». Logique pure, testée.
import { t } from "../i18n";
import { detectLink, type LinkDetection, type LinkPlatform } from "./link-detection";
import { isPlayerPlatform, type PlayerPlatform } from "./player-link";
import { LINK_COVER_ENABLED } from "./spot-flags";

export type LinkStep =
  /** Analyse de l'image de couverture (Lot S), quand elle est active. */
  | { kind: "cover"; url: string; platform: LinkPlatform }
  /** Lecteur intégré (app iPhone) : la vidéo s'ouvre dans Spotto. */
  | { kind: "player"; url: string; platform: PlayerPlatform }
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

/** `playerPlatforms` : plateformes ouvertes dans le lecteur intégré (app
 * iPhone, lib/player-access.ts) ; aucune par défaut — le site, et l'app tant
 * que LINK_PLAYER_ENABLED est coupé, gardent exactement le parcours actuel. */
export function linkStep(text: string, coverEnabled: boolean = LINK_COVER_ENABLED, playerPlatforms: readonly PlayerPlatform[] = []): LinkStep {
  const detection = detectLink(text);
  // Lecteur intégré : TikTok et Instagram seulement (Pinterest garde l'aide :
  // aucun lecteur officiel vérifié, note R2 §6). Un profil est refusé avec le
  // message qui dit quoi faire, au lieu de l'aide.
  if ((detection.kind === "supported" || detection.kind === "not_a_video") && isPlayerPlatform(detection.platform) && playerPlatforms.includes(detection.platform)) {
    return detection.kind === "supported"
      ? { kind: "player", url: detection.url, platform: detection.platform }
      : { kind: "refused", message: t.spotter.notAVideo[detection.platform] };
  }
  if (detection.kind === "supported") return coverEnabled ? { kind: "cover", url: detection.url, platform: detection.platform } : { kind: "help" };
  // Analyse coupée : aucun lien TikTok, Instagram ou Pinterest ne se lit, vidéo
  // ou profil ; l'aide dit quoi faire à la place (la capture du bon moment).
  if (detection.kind === "not_a_video" && !coverEnabled) return { kind: "help" };
  return { kind: "refused", message: linkRefusal(detection) ?? t.spotter.notALink };
}
