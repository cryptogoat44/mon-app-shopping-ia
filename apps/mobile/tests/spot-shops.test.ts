import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchOrigin, ProductMatch, ProductSearch, SearchComplement } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { sanitizeProps } from "../src/lib/analytics-events";
import { allPieces } from "../src/lib/result-sections";
import { bestProposalIndex, chooseCard, noPriceNoticeShown, priceFirstSections, startIndexOf, startProposalIndex, NO_CHOICE, wordsArrivalReveal } from "../src/lib/price-first";
import { toSpotResult, withTextSearch } from "../src/lib/spot-result";
import { afterShops, forgetShopsRequests, requestShops, SHOPS_TIMEOUT_MS, shopsOutcomeOf, shopsPending, withoutShopsPending } from "../src/lib/spot-shops";

// Boutiques ensuite (2026-11-08) : les résultats de la recherche visuelle
// tout de suite, avec la ligne « Recherche dans d'autres boutiques… », puis
// les boutiques ajoutées dessous ; rien trouvé ou panne : la ligne
// disparaît, sans message. La grande carte, choisie au premier affichage, ne
// change jamais. Aucun réseau : la demande au serveur est simulée.

afterEach(() => {
  forgetShopsRequests();
  vi.useRealTimers();
});

/** Une proposition : « l2€ » = 2ᵉ de la recherche visuelle, avec prix ; « s1 » = 1ʳᵉ des boutiques, sans prix. */
function match(id: string, rank: number, price: number | null, origin?: MatchOrigin, currency = "EUR"): ProductMatch {
  return {
    id,
    rank,
    productName: `Pièce ${id}`,
    brand: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    imageHdUrl: null,
    priceMin: price,
    priceMax: price,
    currency: price === null ? null : currency,
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    feedbackReason: null,
    ...(origin ? { origin } : {}),
  };
}

const PENDING: SearchComplement = { status: null, suggestText: false, textStatus: null, pending: true };

/** Réponse du lancement : la recherche visuelle seule, boutiques en attente. */
function launched(lens: (number | null)[], extra: Partial<ProductSearch> = {}): ProductSearch {
  return {
    id: "s1",
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status: "completed",
    errorMessage: null,
    query: null,
    createdAt: "2026-11-08T10:00:00.000Z",
    matches: lens.map((price, index) => match(`l${index + 1}`, index + 1, price)),
    complement: PENDING,
    ...extra,
  };
}

/** Réponse des boutiques : la même recherche, avec les boutiques après la recherche visuelle. */
function withShopsReply(lens: (number | null)[], shops: (number | null)[], complement: Partial<SearchComplement> = {}): ProductSearch {
  const base = launched(lens);
  return {
    ...base,
    matches: [...base.matches, ...shops.map((price, index) => match(`s${index + 1}`, lens.length + index + 1, price, "shopping"))],
    complement: { status: shops.length > 0 ? "shown" : "empty", query: "Exemplor veste Nuage 07", suggestText: false, textStatus: null, ...complement },
  };
}

const ids = (result: Pick<SpotResult, "pieces" | "complement">) => allPieces(result).map((piece) => piece.id);

describe("la ligne d'attente, puis les boutiques dessous", () => {
  it("réponse du lancement : la recherche visuelle tout de suite, la ligne d'attente, aucune boutique", () => {
    const result = toSpotResult(launched([59, null]));
    expect(result.status).toBe("success");
    expect(result.pieces.map((piece) => piece.id)).toEqual(["l1", "l2"]);
    expect(result.complement).toMatchObject({ shopping: [], words: [], status: null, pending: true });
    expect(shopsPending(result)).toBe(true);
  });

  it("les boutiques arrivent : la ligne est remplacée par leur section, sous la recherche visuelle inchangée", () => {
    const before = toSpotResult(launched([59, null]));
    const after = afterShops(before, "s1", shopsOutcomeOf(withShopsReply([59, null], [45, null])));
    expect(shopsPending(after)).toBe(false);
    expect(after.complement?.pending).toBeUndefined();
    expect(after.pieces).toBe(before.pieces);
    expect(ids(after)).toEqual(["l1", "l2", "s1", "s2"]);
    expect(after.complement).toMatchObject({ status: "shown", query: "Exemplor veste Nuage 07", late: true });
  });

  it("le tri par les mots et les pièces déjà gardées du résultat affiché restent", () => {
    const before = { ...toSpotResult(launched([59, null], { sortedByWords: true })), owned: { kept: ["l2"], bought: [] } };
    const after = afterShops(before, "s1", shopsOutcomeOf(withShopsReply([59, null], [45])));
    expect(after.sortedByWords).toBe(true);
    expect(after.owned).toEqual({ kept: ["l2"], bought: [] });
  });

  it("« Que cherchez-vous ? » arrive avec l'issue des boutiques, comme avant", () => {
    const before = toSpotResult(launched([59]));
    expect(before.complement?.suggestText).toBe(false);
    const after = afterShops(before, "s1", shopsOutcomeOf(withShopsReply([59], [], { status: "empty", suggestText: true })));
    expect(after.complement).toMatchObject({ status: "empty", suggestText: true, shopping: [] });
  });

  it("rien trouvé, refus, panne : la ligne disparaît sans message, rien d'autre ne change", () => {
    const before = toSpotResult(launched([59, null]));
    const after = afterShops(before, "s1", { kind: "none" });
    expect(shopsPending(after)).toBe(false);
    expect(after.pieces).toBe(before.pieces);
    expect(after.complement).toEqual({ shopping: [], words: [], status: null, query: null, suggestText: false, textStatus: null });
    expect(after.status).toBe("success");
    expect(after.failReason).toBeUndefined();
    expect(withoutShopsPending(after)).toBe(after);
  });

  it("réponse encore « pending » (une autre demande n'a pas fini à temps) : la ligne disparaît", () => {
    expect(shopsOutcomeOf(launched([59]))).toEqual({ kind: "none" });
  });

  it("une autre recherche, ou un résultat qui n'attend plus : inchangé", () => {
    const before = toSpotResult(launched([59]));
    const outcome = shopsOutcomeOf(withShopsReply([59], [45]));
    expect(afterShops(before, "autre", outcome)).toBe(before);
    const settled = afterShops(before, "s1", outcome);
    expect(afterShops(settled, "s1", { kind: "none" })).toBe(settled);
  });
});

describe("la grande carte ne change pas quand les boutiques arrivent", () => {
  /** Recherche visuelle et boutiques (« € » : avec prix), pays de la recherche. */
  const CASES: { lens: (number | null)[]; shops: (number | null)[]; country?: string; label: string }[] = [
    { lens: [null, 59, null], shops: [40, 30], country: "fr", label: "la recherche visuelle a un prix" },
    { lens: [null, null], shops: [40], country: "fr", label: "aucun prix dans la recherche visuelle, des boutiques avec prix" },
    { lens: [null, null], shops: [null, 40], label: "aucun prix nulle part sauf une boutique plus loin" },
    { lens: [null, null], shops: [], label: "aucune boutique" },
    { lens: [0, null], shops: [25], country: "fr", label: "un prix à 0 dans la recherche visuelle" },
  ];

  for (const { lens, shops, country, label } of CASES) {
    it(label, () => {
      const before = toSpotResult(launched(lens));
      const after = afterShops(before, "s1", shopsOutcomeOf(withShopsReply(lens, shops)));
      const options = country ? { country } : {};
      const start = startProposalIndex(before, options);
      expect(startProposalIndex(after, options)).toBe(start);
      expect(allPieces(after)[start]?.id).toBe(allPieces(before)[start]?.id);
      expect(bestProposalIndex(after, country)).toBe(bestProposalIndex(before, country));
      // La disposition de la recherche visuelle (avec prix, puis repliées sans prix) ne bouge pas non plus.
      const sectionIds = (result: SpotResult) => {
        const sections = priceFirstSections(result, start);
        return { others: sections.others.map((p) => p.piece.id), withoutPrice: sections.withoutPrice.map((p) => p.piece.id) };
      };
      expect(sectionIds(after)).toEqual(sectionIds(before));
      expect(noPriceNoticeShown(after, start)).toBe(noPriceNoticeShown(before, start));
    });
  }

  it("aucun prix dans la recherche visuelle : la grande carte reste sa première proposition, la boutique avec prix vient dessous", () => {
    const before = toSpotResult(launched([null, null]));
    const after = afterShops(before, "s1", shopsOutcomeOf(withShopsReply([null, null], [40])));
    expect(startProposalIndex(after, { country: "fr" })).toBe(0);
    expect(allPieces(after)[0]?.id).toBe("l1");
    expect(priceFirstSections(after, 0).shopping.map((p) => p.piece.id)).toEqual(["s1"]);
    // Le même résultat arrivé d'un coup (ancien serveur, ou relu) suit la règle d'avant : la boutique avec prix en grand.
    expect(startProposalIndex(toSpotResult(withShopsReply([null, null], [40])), { country: "fr" })).toBe(2);
  });

  it("une carte touchée pendant l'attente reste en grand, à la même place", () => {
    const before = toSpotResult(launched([null, 59, null]));
    const choice = chooseCard(NO_CHOICE, 2, startIndexOf(NO_CHOICE, before, {}), undefined);
    const after = afterShops(before, "s1", shopsOutcomeOf(withShopsReply([null, 59, null], [40])));
    expect(allPieces(after)[choice.chosen!]?.id).toBe("l3");
  });

  it("vos mots lancés ensuite : toujours sans effet sur la grande carte", () => {
    const before = toSpotResult(launched([null, null]));
    const shown = afterShops(before, "s1", shopsOutcomeOf(withShopsReply([null, null], [null], { suggestText: true })));
    const reply = withShopsReply([null, null], [null]);
    const words: ProductSearch = { ...reply, matches: [...reply.matches, match("w1", 4, 30, "words")], complement: { status: "shown", suggestText: false, textStatus: "shown" } };
    const next = withTextSearch(shown, words);
    expect(next.complement?.late).toBe(true);
    expect(startProposalIndex(next, {})).toBe(0);
    expect(wordsArrivalReveal(shown, next, NO_CHOICE, {})).toBe("words");
  });
});

describe("une seule demande des boutiques par recherche, jamais d'erreur", () => {
  it("la demande partie avec le lancement est celle que l'écran retrouve", async () => {
    const fetchShops = vi.fn(async () => withShopsReply([59], [45]));
    const first = requestShops("s1", fetchShops);
    const second = requestShops("s1", fetchShops);
    expect(second).toBe(first);
    expect(await second).toMatchObject({ kind: "added" });
    expect(fetchShops).toHaveBeenCalledTimes(1);
  });

  it("panne ou refus du serveur : « rien », sans erreur", async () => {
    expect(await requestShops("s2", async () => Promise.reject(new Error("réseau")))).toEqual({ kind: "none" });
  });

  it("délai dépassé : la demande est abandonnée, « rien »", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | null = null;
    const outcome = requestShops("s3", (signal) => {
      seen = signal;
      return new Promise<ProductSearch>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("abandon"))));
    });
    await vi.advanceTimersByTimeAsync(SHOPS_TIMEOUT_MS);
    expect(await outcome).toEqual({ kind: "none" });
    expect(seen!.aborted).toBe(true);
  });
});

describe("textes et statistiques", () => {
  it("la ligne d'attente, en français et en anglais", () => {
    expect(fr.result.shopsPending).toBe("Recherche dans d'autres boutiques…");
    expect(en.result.shopsPending).toBe("Searching other shops…");
  });

  it("spot_completed accepte « unknown » (issue des boutiques jamais reçue), et rien d'autre de nouveau", () => {
    expect(sanitizeProps("spot_completed", { outcome: "results", results_count: 3, complement: "unknown", complement_count: 0 })).toEqual({
      outcome: "results",
      results_count: 3,
      complement: "unknown",
      complement_count: 0,
    });
    expect(sanitizeProps("spot_completed", { outcome: "results", results_count: 3, complement: "pending", complement_count: 0 })).not.toHaveProperty("complement");
  });
});
