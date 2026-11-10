import { useRouter } from "expo-router";
import { track } from "./analytics";
import { linkStep } from "./link-step";
import { playerPlatforms } from "./player-access";
import { holdPlayerLink, type PlayerLinkSource } from "./player-link";
import { beginFromLink, prepareErrorMessage } from "./spot-flow";

export type LinkOutcome = { kind: "opened" } | { kind: "help" } | { kind: "refused"; message: string };

/** Lien collé dans le champ ou partagé depuis une autre app : une seule
 * fonction pour les deux (décision : link-step.ts). L'appelant affiche le
 * refus ou l'aide ; « opened » : le parcours a déjà changé d'écran. Sur l'app
 * iPhone, lecteur allumé, un lien TikTok ou Instagram ouvre le lecteur
 * intégré ; le lien reste en mémoire (player-link.ts), jamais dans l'adresse
 * de l'écran. */
export function useLinkEntry(): (text: string, source: PlayerLinkSource) => Promise<LinkOutcome> {
  const router = useRouter();
  return async function openLink(text, source) {
    const step = linkStep(text, undefined, playerPlatforms());
    if (step.kind === "player") {
      holdPlayerLink({ url: step.url, platform: step.platform, source });
      track("player_opened", { platform: step.platform, source });
      router.push("/spot/lecteur");
      return { kind: "opened" };
    }
    if (step.kind !== "cover") return step;
    try {
      const draft = await beginFromLink(step.url, step.platform);
      router.push({ pathname: "/spot/apercu", params: { searchId: draft.searchId ?? "" } });
      return { kind: "opened" };
    } catch (error) {
      return { kind: "refused", message: prepareErrorMessage(error) };
    }
  };
}
