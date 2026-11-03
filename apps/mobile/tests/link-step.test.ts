import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { detectLink } from "../src/lib/link-detection";
import { linkRefusal, linkStep } from "../src/lib/link-step";
import { normalizeSharedLink } from "../src/lib/shared-item";
import { LINK_COVER_ENABLED } from "../src/lib/spot-flags";

// Lot « partager vers Spotto » : un lien collé dans le champ et un lien
// partagé depuis une autre app passent par la même décision (link-step.ts).
// Non-régression du champ : avec l'analyse de la couverture (seul cas où le
// champ s'affiche), mêmes liens acceptés et mêmes messages qu'avant.
const VIDEO_LINKS = [
  "https://www.tiktok.com/@x/video/1",
  "https://vm.tiktok.com/ZMabc/",
  "Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp",
  "https://www.instagram.com/reel/abc/",
  "https://pin.it/4xYz",
  "pin.it/4xYz",
  "https://fr.pinterest.com/pin/123/",
];

describe("champ de lien collé (analyse de la couverture active) : rien ne change", () => {
  it.each(VIDEO_LINKS)("« %s » : analyse de la couverture, même lien et même plateforme", (text) => {
    const detection = detectLink(text);
    if (detection.kind !== "supported") throw new Error("lien attendu");
    expect(linkStep(text, true)).toEqual({ kind: "cover", url: detection.url, platform: detection.platform });
  });

  it("profil, autre site, simple texte : refusés avec les messages affichés sous le champ", () => {
    expect(linkStep("https://www.tiktok.com/@mayelasjourney", true)).toEqual({ kind: "refused", message: fr.spotter.notAVideo.tiktok });
    expect(linkStep("https://www.instagram.com/zara/", true)).toEqual({ kind: "refused", message: fr.spotter.notAVideo.instagram });
    expect(linkStep("https://www.zara.com/fr/veste", true)).toEqual({ kind: "refused", message: fr.spotter.unsupportedLink });
    expect(linkStep("veste marron", true)).toEqual({ kind: "refused", message: fr.spotter.notALink });
  });

  it("messages sous le champ : un par cas, aucun pour un lien reconnu ou un champ vide", () => {
    expect(linkRefusal(detectLink("veste marron"))).toBe(fr.spotter.notALink);
    expect(linkRefusal(detectLink("https://www.zara.com/fr/veste"))).toBe(fr.spotter.unsupportedLink);
    expect(linkRefusal(detectLink("https://www.pinterest.fr/zara/"))).toBe(fr.spotter.notAVideo.pinterest);
    expect(linkRefusal(detectLink("https://vm.tiktok.com/ZMabc/"))).toBeNull();
    expect(linkRefusal(detectLink("   "))).toBeNull();
  });
});

describe("aujourd'hui (analyse de la couverture coupée)", () => {
  it("réglage actuel : coupé", () => {
    expect(LINK_COVER_ENABLED).toBe(false);
    expect(linkStep("https://vm.tiktok.com/ZMabc/")).toEqual({ kind: "help" });
  });

  it("tout lien TikTok, Instagram ou Pinterest, vidéo ou profil : l'aide « capture d'écran d'abord »", () => {
    for (const text of [...VIDEO_LINKS, "https://www.tiktok.com/@mayelasjourney", "https://www.instagram.com/zara/"]) {
      expect(linkStep(text, false)).toEqual({ kind: "help" });
    }
  });

  it("autre site ou texte : le même refus clair qu'avant", () => {
    expect(linkStep("https://www.zara.com/fr/veste", false)).toEqual({ kind: "refused", message: fr.spotter.unsupportedLink });
    expect(linkStep("veste marron", false)).toEqual({ kind: "refused", message: fr.spotter.notALink });
  });
});

describe("lien partagé et lien collé : une seule décision", () => {
  it.each([...VIDEO_LINKS, "https://www.tiktok.com/@mayelasjourney", "https://www.zara.com/fr/veste"])("« %s »", (text) => {
    const shared = normalizeSharedLink(text);
    if (!shared) throw new Error("lien attendu");
    for (const coverEnabled of [true, false]) expect(linkStep(shared, coverEnabled)).toEqual(linkStep(text, coverEnabled));
  });
});
