import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « mesure du parcours » : la mention de l'offre (« Boutique officielle de
// la marque », « Boutique connue », « Prix inhabituellement bas », ou aucune)
// ajoutée au clic vers la boutique depuis l'écran Résultat, pour savoir si
// les boutiques officielles sont davantage choisies. Absente ailleurs.
// Comme tests/merchant-links.test.ts : api.ts, react-native et le navigateur
// intégré sont remplacés, rien ne s'ouvre ni ne part.
vi.mock("../src/lib/api", () => ({ trackProductMatchClick: vi.fn(async () => ({ url: "https://marchand.example/affilie" })) }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn(async () => ({ type: "opened" })) }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn() }));

import { OFFER_MARKS } from "@monapp/shared-types";
import { track } from "../src/lib/analytics";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { openMerchantLink } from "../src/lib/merchant-links";
import { merchantMarkFor } from "../src/lib/result-sections";

const analytics = vi.mocked(track);
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

beforeEach(() => analytics.mockClear());

describe("merchant_link_opened : la mention de l'offre", () => {
  it("écran Résultat : la mention de la carte, ou « none » sans mention, avec la place d'avant", async () => {
    await openMerchantLink({
      matchId: "m-officielle",
      url: "https://marque.example/veste",
      context: "result",
      placement: { rank: 4, displayed_position: 1, in_no_price_section: false },
      mark: "official_shop",
    });
    await openMerchantLink({ matchId: "m-sans", url: "https://boutique.example/veste", context: "similar", mark: "none" });
    expect(analytics.mock.calls).toEqual([
      ["merchant_link_opened", { context: "result", rank: 4, displayed_position: 1, in_no_price_section: false, mark: "official_shop" }],
      ["merchant_link_opened", { context: "similar", mark: "none" }],
    ]);
  });

  it("ailleurs (Envies, Vault, publication…) : l'événement d'avant, sans mention", async () => {
    await openMerchantLink({ matchId: "m-envie", url: "https://boutique.example/envie", context: "wishlist" });
    expect(analytics.mock.calls).toEqual([["merchant_link_opened", { context: "wishlist" }]]);
    expect(analytics.mock.calls[0]![1]).not.toHaveProperty("mark");
  });

  it("catalogue fermé : les mentions du serveur ou « none », jamais la boutique ni son adresse", () => {
    expect(ANALYTICS_EVENTS.merchant_link_opened.mark).toEqual({ kind: "enum", values: [...OFFER_MARKS, "none"] });
    for (const mark of [...OFFER_MARKS, "none"]) expect(sanitizeProps("merchant_link_opened", { context: "result", mark })).toEqual({ context: "result", mark });
    expect(sanitizeProps("merchant_link_opened", { context: "result", mark: "Zara", merchant: "zara.com", url: "https://zara.com/x" })).toEqual({ context: "result" });
  });

  it("la mention lue sur la proposition, comme sur sa carte", () => {
    expect(merchantMarkFor({ offerMark: "official_shop" })).toBe("official_shop");
    expect(merchantMarkFor({ offerMark: "known_shop" })).toBe("known_shop");
    expect(merchantMarkFor({ offerMark: "unusual_price" })).toBe("unusual_price");
    expect(merchantMarkFor({})).toBe("none");
  });

  it("les deux boutons de l'écran Résultat la donnent ; les boutons des autres écrans, jamais", () => {
    const call = "openMerchantLink({ matchId: piece.real ? piece.id : null, url, context: merchantContextFor(piece), placement, mark: merchantMarkFor(piece) })";
    expect(read("app/(app)/spot/result.tsx")).toContain(call);
    expect(read("components/proposal-card.tsx")).toContain(call);
    // Bouton commun (Envies, Vault, publication, pièces déjà repérées d'une vidéo) : pas d'offre, pas de mention.
    expect(read("components/merchant-link-button.tsx")).toContain("openMerchantLink({ matchId, url, context })");
    expect(read("components/post-card.tsx")).not.toContain("mark:");
  });
});
