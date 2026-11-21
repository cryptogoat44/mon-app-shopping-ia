import { useRouter } from "expo-router";
import { normalizeVideoLink } from "@monapp/shared-types";
import { track } from "./analytics";
import type { JourneyEntry } from "./journey-entries";
import { linkStep } from "./link-step";
import type { PlayerLinkSource } from "./player-link";
import { pendingVideoLinks } from "./video-context";

export type LinkOutcome = { kind: "opened" } | { kind: "help" } | { kind: "refused"; message: string };

/** Lien collé dans le champ ou partagé depuis une autre app : une seule
 * fonction pour les deux (décision : link-step.ts). L'appelant affiche le
 * refus ou l'aide ; « opened » : le parcours a déjà changé d'écran.
 * Lien de vidéo TikTok ou Instagram (mission « liens vidéo ») : il est mis
 * en attente 10 minutes (lib/pending-video-link.ts), puis l'écran « vidéo
 * partagée » s'ouvre, sur l'app comme sur le site. Mesure du parcours : le
 * parcours commence ici, lien reconnu ; refus et aide n'en ouvrent aucun. */
export function useLinkEntry(): (text: string, source: PlayerLinkSource) => Promise<LinkOutcome> {
  const router = useRouter();
  return async function openLink(text, source) {
    const step = linkStep(text);
    if (step.kind !== "video") return step;
    await pendingVideoLinks.hold({ url: step.url, platform: step.platform, creatorHandle: normalizeVideoLink(step.url)?.creatorHandle ?? null });
    const entry: JourneyEntry = `link_${source}`;
    track("journey_started", { entry, link_platform: step.platform });
    track("player_opened", { platform: step.platform, source, link_platform: step.platform });
    router.push({ pathname: "/spot/lecteur", params: { url: step.url } });
    return { kind: "opened" };
  };
}
