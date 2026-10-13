import { afterEach, describe, expect, it, vi } from "vitest";

const { share, track } = vi.hoisted(() => ({ share: vi.fn(), track: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Share: { share, sharedAction: "sharedAction", dismissedAction: "dismissedAction" } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../src/lib/analytics", () => ({ track }));

import { setActiveLocale } from "../src/i18n";
import { shareWishOutside, wishShareIsAffiliate, wishShareLink, wishShareMessage } from "../src/lib/share-wish";

// Lot 5, 5.C : partager une envie hors de Spotto, avec la mention « lien
// affilié » quand c'est le cas — jamais une page publique de l'envie.
const affiliate = { title: "Sac Kelly", merchantName: "Boutique", merchantUrl: "https://shop.test/sac", affiliateUrl: "https://shop.test/sac?aff=spotto" };
const direct = { ...affiliate, affiliateUrl: null };

afterEach(() => {
  setActiveLocale("fr");
  track.mockReset();
  share.mockReset();
});

describe("partage d'une envie hors de Spotto", () => {
  it("lien affilié : le lien affilié et sa mention", () => {
    expect(wishShareLink(affiliate)).toBe("https://shop.test/sac?aff=spotto");
    expect(wishShareIsAffiliate(affiliate)).toBe(true);
    expect(wishShareMessage(affiliate)).toBe("Une pièce repérée sur Spotto : Sac Kelly chez Boutique\nhttps://shop.test/sac?aff=spotto (lien affilié)");
  });

  it("lien direct : aucune mention", () => {
    expect(wishShareIsAffiliate(direct)).toBe(false);
    expect(wishShareMessage(direct)).toBe("Une pièce repérée sur Spotto : Sac Kelly chez Boutique\nhttps://shop.test/sac");
    // Un « lien affilié » identique au lien du marchand n'en est pas un.
    expect(wishShareIsAffiliate({ ...direct, affiliateUrl: direct.merchantUrl })).toBe(false);
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(wishShareMessage(affiliate)).toBe("Spotted on Spotto: Sac Kelly at Boutique\nhttps://shop.test/sac?aff=spotto (affiliate link)");
  });

  it("marchand déjà dans le titre : il n'est pas répété ; la mention et le lien ne changent pas", () => {
    const titled = { ...affiliate, title: "Sac Kelly | Boutique" };
    expect(wishShareMessage(titled)).toBe("Une pièce repérée sur Spotto : Sac Kelly | Boutique\nhttps://shop.test/sac?aff=spotto (lien affilié)");
    // Sans tenir compte des majuscules.
    expect(wishShareMessage({ ...direct, title: "Sac Kelly | BOUTIQUE" })).toBe("Une pièce repérée sur Spotto : Sac Kelly | BOUTIQUE\nhttps://shop.test/sac");
    setActiveLocale("en");
    expect(wishShareMessage(titled)).toBe("Spotted on Spotto: Sac Kelly | Boutique\nhttps://shop.test/sac?aff=spotto (affiliate link)");
  });

  it("sans marchand : rien à partager", async () => {
    const none = { title: "Pièce", merchantName: null, merchantUrl: null, affiliateUrl: null };
    expect(wishShareMessage(none)).toBeNull();
    expect(await shareWishOutside(none)).toBe("cancelled");
    expect(share).not.toHaveBeenCalled();
  });

  it("iPhone : feuille fermée sans partager, rien n'est compté ; partage : canal et oui/non affilié seulement", async () => {
    share.mockResolvedValueOnce({ action: "dismissedAction" });
    expect(await shareWishOutside(affiliate)).toBe("cancelled");
    expect(track).not.toHaveBeenCalled();
    share.mockResolvedValueOnce({ action: "sharedAction" });
    expect(await shareWishOutside(affiliate)).toBe("shared");
    expect(share).toHaveBeenLastCalledWith({ message: wishShareMessage(affiliate) });
    expect(track).toHaveBeenCalledWith("wish_shared_external", { method: "native", affiliate: true });
  });
});
