// Point d'entrée unique d'un lien dans le Spotter (lot « partager vers
// Spotto ») : lien collé dans le champ, ou partagé depuis une autre app par la
// feuille de partage d'iOS — une seule décision pour les deux. Mission
// « liens vidéo » : un lien de vidéo TikTok ou Instagram ouvre l'écran
// « vidéo partagée » (spot/lecteur), sur l'app comme sur le site ; ce
// dernier décide du lecteur officiel ou de l'écran de secours. Logique pure,
// testée.
import { t } from "../i18n";
import { detectLink, type LinkDetection } from "./link-detection";
import { isPlayerPlatform, type PlayerPlatform } from "./player-link";

export type LinkStep =
  /** Vidéo TikTok ou Instagram : l'écran « vidéo partagée ». */
  | { kind: "video"; url: string; platform: PlayerPlatform }
  /** Lien qui ne mène à aucune vidéo lisible (Pinterest) : l'aide « capture d'écran d'abord ». */
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

/** L'image de couverture d'un lien n'est jamais demandée (voie retirée le
 * 12 novembre 2026) : la vidéo s'ouvre dans son lecteur officiel, ou l'écran
 * de secours dit comment faire une capture. */
export function linkStep(text: string): LinkStep {
  const detection = detectLink(text);
  if (detection.kind === "supported" && isPlayerPlatform(detection.platform)) return { kind: "video", url: detection.url, platform: detection.platform };
  // Profil TikTok ou Instagram : le message qui dit quoi faire.
  if (detection.kind === "not_a_video" && isPlayerPlatform(detection.platform)) return { kind: "refused", message: t.spotter.notAVideo[detection.platform] };
  // Pinterest, vidéo ou profil : aucun lecteur officiel vérifié ; l'aide dit quoi faire à la place.
  if (detection.kind === "supported" || detection.kind === "not_a_video") return { kind: "help" };
  return { kind: "refused", message: linkRefusal(detection) ?? t.spotter.notALink };
}
