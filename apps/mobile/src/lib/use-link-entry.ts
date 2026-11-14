import { useRouter } from "expo-router";
import { normalizeVideoLink } from "@monapp/shared-types";
import { track } from "./analytics";
import { linkStep } from "./link-step";
import type { PlayerLinkSource } from "./player-link";
import { pendingVideoLinks } from "./video-context";

export type LinkOutcome = { kind: "opened" } | { kind: "help" } | { kind: "refused"; message: string };

/** Lien collé dans le champ ou partagé depuis une autre app : une seule
 * fonction pour les deux (décision : link-step.ts). L'appelant affiche le
 * refus ou l'aide ; « opened » : le parcours a déjà changé d'écran.
 * Lien de vidéo TikTok ou Instagram (mission « liens vidéo ») : il est mis
 * en attente 10 minutes (lib/pending-video-link.ts), puis l'écran « vidéo
 * partagée » s'ouvre, sur l'app comme sur le site. */
export function useLinkEntry(): (text: string, source: PlayerLinkSource) => Promise<LinkOutcome> {
  const router = useRouter();
  return async function openLink(text, source) {
    const step = linkStep(text);
    if (step.kind !== "video") return step;
    await pendingVideoLinks.hold({ url: step.url, platform: step.platform, creatorHandle: normalizeVideoLink(step.url)?.creatorHandle ?? null });
    track("player_opened", { platform: step.platform, source });
    router.push({ pathname: "/spot/lecteur", params: { url: step.url } });
    return { kind: "opened" };
  };
}
