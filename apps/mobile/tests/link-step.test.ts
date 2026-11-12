import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { detectLink } from "../src/lib/link-detection";
import { linkRefusal, linkStep } from "../src/lib/link-step";
import { normalizeSharedLink } from "../src/lib/shared-item";

// Lot « partager vers Spotto » : un lien collé dans le champ et un lien
// partagé depuis une autre app passent par la même décision (link-step.ts).
// La voie « couverture » est retirée (12 novembre 2026) : un lien ne donne
// jamais d'image. Mission « liens vidéo » : une vidéo TikTok ou Instagram
// ouvre l'écran « vidéo partagée » ; Pinterest mène à l'aide « capture
// d'écran d'abord » ; un profil ou un autre site, à un refus clair.
const VIDEO_LINKS = [
  "https://www.tiktok.com/@x/video/1",
  "https://vm.tiktok.com/ZMabc/",
  "Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp",
  "https://www.instagram.com/reel/abc/",
];
const PINTEREST_LINKS = ["https://pin.it/4xYz", "pin.it/4xYz", "https://fr.pinterest.com/pin/123/"];
const PROFILE_LINKS = ["https://www.tiktok.com/@mayelasjourney", "https://www.instagram.com/zara/"];

describe("lien collé ou partagé : jamais d'image de couverture", () => {
  it.each(VIDEO_LINKS)("« %s » : l'écran « vidéo partagée »", (text) => {
    expect(linkStep(text).kind).toBe("video");
  });

  it.each(PINTEREST_LINKS)("« %s » : l'aide « capture d'écran d'abord »", (text) => {
    expect(linkStep(text)).toEqual({ kind: "help" });
  });

  it("profil TikTok ou Instagram : refus qui dit quoi faire", () => {
    expect(linkStep(PROFILE_LINKS[0]!)).toEqual({ kind: "refused", message: fr.spotter.notAVideo.tiktok });
    expect(linkStep(PROFILE_LINKS[1]!)).toEqual({ kind: "refused", message: fr.spotter.notAVideo.instagram });
  });

  it("autre site ou simple texte : refusés avec un message clair", () => {
    expect(linkStep("https://www.zara.com/fr/veste")).toEqual({ kind: "refused", message: fr.spotter.unsupportedLink });
    expect(linkStep("veste marron")).toEqual({ kind: "refused", message: fr.spotter.notALink });
  });

  it("messages sous le champ : un par cas, aucun pour un lien reconnu ou un champ vide", () => {
    expect(linkRefusal(detectLink("veste marron"))).toBe(fr.spotter.notALink);
    expect(linkRefusal(detectLink("https://www.zara.com/fr/veste"))).toBe(fr.spotter.unsupportedLink);
    expect(linkRefusal(detectLink("https://www.pinterest.fr/zara/"))).toBe(fr.spotter.notAVideo.pinterest);
    expect(linkRefusal(detectLink("https://vm.tiktok.com/ZMabc/"))).toBeNull();
    expect(linkRefusal(detectLink("   "))).toBeNull();
  });
});

describe("lien partagé et lien collé : une seule décision", () => {
  it.each([...VIDEO_LINKS, ...PINTEREST_LINKS, ...PROFILE_LINKS, "https://www.zara.com/fr/veste"])("« %s »", (text) => {
    const shared = normalizeSharedLink(text);
    if (!shared) throw new Error("lien attendu");
    expect(linkStep(shared)).toEqual(linkStep(text));
  });
});
