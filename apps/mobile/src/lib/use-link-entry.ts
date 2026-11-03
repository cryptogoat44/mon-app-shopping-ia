import { useRouter } from "expo-router";
import { linkStep } from "./link-step";
import { beginFromLink, prepareErrorMessage } from "./spot-flow";

export type LinkOutcome = { kind: "opened" } | { kind: "help" } | { kind: "refused"; message: string };

/** Lien collé dans le champ ou partagé depuis une autre app : une seule
 * fonction pour les deux (décision : link-step.ts). L'appelant affiche le
 * refus ou l'aide ; « opened » : le parcours a déjà changé d'écran. */
export function useLinkEntry(): (text: string) => Promise<LinkOutcome> {
  const router = useRouter();
  return async function openLink(text) {
    const step = linkStep(text);
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
