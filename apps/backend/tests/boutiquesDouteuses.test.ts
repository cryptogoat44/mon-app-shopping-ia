import { describe, expect, it, vi } from "vitest";
import type { ProviderVisualMatch } from "../src/services/searchProvider.js";

// Boutiques douteuses (lot « recherche confiance ») : listes du fondateur,
// signaux prudents, offres retirées, mentions, ordre, jamais tout retirer.
// Aucun réseau, aucune base : fonctions pures et lignes factices. Adresses
// fictives (sauf les boutiques connues, qui sont celles de la vraie liste).
const lists = vi.hoisted(() => ({ hidden: [] as string[] }));
vi.mock("../src/listes/boutiquesMasquees.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/listes/boutiquesMasquees.js")>();
  return { ...original, BOUTIQUES_MASQUEES: lists.hidden };
});

import { BOUTIQUES_CONNUES } from "../src/listes/boutiquesConnues.js";
import { BOUTIQUES_OFFICIELLES } from "../src/listes/boutiquesOfficielles.js";
import {
  KNOWN_SHOP_BOOST,
  isHiddenShop,
  isKnownShop,
  isOfficialShop,
  looksLikeFakeShop,
  reviewOffers,
  trustOrder,
  withoutDubiousOffers,
  type TrustOffer,
} from "../src/lib/shopTrust.js";
import { keptMatchRows, toProductSearch, type MatchRow, type SearchRow } from "../src/lib/searchRows.js";
import { filterVisualMatches } from "../src/services/visualSearch.js";

const offer = (merchantUrl: string, priceValue: number | null = null, currency: string | null = priceValue === null ? null : "€"): TrustOffer => ({ merchantUrl, priceValue, currency });

describe("les deux listes du fondateur", () => {
  it("chaque adresse est écrite comme il faut : minuscules, sans « https:// » ni « www. », avec son extension, sans doublon", async () => {
    const actual = await vi.importActual<typeof import("../src/listes/boutiquesMasquees.js")>("../src/listes/boutiquesMasquees.js");
    for (const domain of [...BOUTIQUES_CONNUES, ...BOUTIQUES_OFFICIELLES, ...actual.BOUTIQUES_MASQUEES]) {
      expect(domain, domain).toMatch(/^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
    expect(new Set(BOUTIQUES_CONNUES).size).toBe(BOUTIQUES_CONNUES.length);
    expect(new Set(BOUTIQUES_OFFICIELLES).size).toBe(BOUTIQUES_OFFICIELLES.length);
    // Une adresse est soit un revendeur connu, soit le site officiel d'une marque, jamais les deux ; jamais masquée.
    expect(BOUTIQUES_OFFICIELLES.filter((domain) => BOUTIQUES_CONNUES.includes(domain))).toEqual([]);
    expect(actual.BOUTIQUES_MASQUEES.filter((domain) => BOUTIQUES_OFFICIELLES.includes(domain))).toEqual([]);
    expect(BOUTIQUES_OFFICIELLES.filter((domain) => isHiddenShop(`https://${domain}/`))).toEqual([]);
    expect(actual.BOUTIQUES_MASQUEES.filter((domain) => BOUTIQUES_CONNUES.includes(domain))).toEqual([]);
    // Masquées : vide, ou des copies avérées seulement (mots évidents).
    expect(actual.BOUTIQUES_MASQUEES).toEqual([]);
    for (const word of actual.MOTS_MASQUES) expect(word).toMatch(/^[a-z]{5,}$/);
    // Aucune boutique connue n'est masquée par un mot.
    expect(BOUTIQUES_CONNUES.filter((domain) => isHiddenShop(`https://${domain}/`))).toEqual([]);
  });

  it("boutique connue : l'adresse exacte et ses sous-domaines, jamais une adresse qui l'imite", () => {
    expect(isKnownShop("https://www.zalando.fr/veste-123.html")).toBe(true);
    expect(isKnownShop("https://fr.zalando.ch/veste")).toBe(true);
    expect(isKnownShop("https://www2.hm.com/fr_fr/productpage.123.html")).toBe(true);
    expect(isKnownShop("https://zalando-outlet.shop/veste")).toBe(false);
    expect(isKnownShop("https://zalando.fr.soldes-veste.top/")).toBe(false);
    expect(isKnownShop("https://notzalando.fr/")).toBe(false);
    expect(isKnownShop("pas une adresse")).toBe(false);
  });

  it("boutique masquée : un mot évident dans l'adresse (copies), ou une adresse ajoutée par le fondateur", () => {
    expect(isHiddenShop("https://best-replica-bags.top/sac")).toBe(true);
    expect(isHiddenShop("https://www.contrefacon-luxe.fr/sac")).toBe(true);
    expect(isHiddenShop("https://boutique-exemple.fr/replica-du-sac")).toBe(false);
    lists.hidden.push("fausse-boutique-exemple.top");
    try {
      expect(isHiddenShop("https://shop.fausse-boutique-exemple.top/veste")).toBe(true);
      expect(isHiddenShop("https://vraie-boutique-exemple.fr/veste")).toBe(false);
    } finally {
      lists.hidden.length = 0;
    }
  });
});

describe("adresse douteuse : une marque imitée, un mot de braderie et une extension inhabituelle, les trois ensemble", () => {
  it("repérée", () => {
    for (const url of [
      "https://moncler-outlet.shop/doudoune",
      "https://www.nikeoutlet.top/air",
      "https://cheap-nike.xyz/air",
      "https://bestmonclerjackets-sale.online/maya",
      "https://monclerparis.store/maya",
      "https://shop.ralphlauren-soldes.vip/polo",
    ]) {
      expect(looksLikeFakeShop(url), url).toBe(true);
    }
  });

  it("jamais une boutique ordinaire : il manque toujours au moins un des trois", () => {
    for (const url of [
      "https://www.moncler.com/fr-fr/doudoune",
      "https://moncler-outlet.fr/doudoune",
      "https://www.zalando.fr/nike",
      "https://petite-boutique-exemple.shop/robe",
      "https://atelier-exemple.store/veste",
      "https://canvas-store.shop/sac",
      "https://nike.shop/air",
      "https://shop.exemple.top/veste",
    ]) {
      expect(looksLikeFakeShop(url), url).toBe(false);
    }
  });
});

describe("règles, offre par offre", () => {
  const LEGIT = ["https://boutique-a.fr/1", "https://boutique-b.fr/2", "https://boutique-c.fr/3"];

  it("offre retirée : boutique masquée (toujours), ou prix très bas ET adresse douteuse", () => {
    const reviews = reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer(LEGIT[2]!, 130), offer("https://moncler-outlet.shop/x", 19), offer("https://replica-moncler.fr/x", 125)]);
    expect(reviews.map((review) => review.dropReason)).toEqual([null, null, null, "suspicious", "hidden"]);
    expect(reviews.slice(3).every((review) => review.dropped)).toBe(true);
  });

  it("offre signalée : prix sous le tiers de la médiane (au moins 3 prix dans la même devise) — gardée, rangée plus bas, mention « Prix inhabituellement bas »", () => {
    const reviews = reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer(LEGIT[2]!, 130), offer("https://petite-boutique-exemple.fr/x", 29)]);
    expect(reviews[3]).toEqual({ dropped: false, dropReason: null, mark: "unusual_price", demoted: true, boosted: false });
    expect(reviews.slice(0, 3).map((review) => review.mark)).toEqual([null, null, null]);
    // Juste au-dessus du tiers : rien.
    expect(reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer(LEGIT[2]!, 130), offer("https://petite-boutique-exemple.fr/x", 41)])[3]!.mark).toBeNull();
  });

  it("prudent : moins de 3 prix, ou des devises différentes (jamais converties), et rien n'est signalé", () => {
    expect(reviewOffers([offer(LEGIT[0]!, 120), offer("https://petite-boutique-exemple.fr/x", 9)]).map((review) => review.mark)).toEqual([null, null]);
    const currencies = reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer("https://petite-boutique-exemple.co.uk/x", 9, "£")]);
    expect(currencies.map((review) => review.mark)).toEqual([null, null, null]);
    // « € » et « EUR » (complété d'espaces par la base) sont la même devise…
    const same = reviewOffers([offer(LEGIT[0]!, 120, "EUR"), offer(LEGIT[1]!, 110, "€  "), offer("https://petite-boutique-exemple.fr/x", 20)]);
    expect(same.map((review) => review.mark)).toEqual([null, null, "unusual_price"]);
    // … et un prix à 0 (donnée douteuse) ne compte pas : il ne reste que 2 prix.
    expect(reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 0), offer("https://petite-boutique-exemple.fr/x", 20)]).map((review) => review.mark)).toEqual([null, null, null]);
  });

  it("adresse douteuse seule (prix ordinaire) : gardée, rangée plus bas, sans aucune mention (rien d'inexact n'est écrit)", () => {
    const [review] = reviewOffers([offer("https://moncler-outlet.shop/x", 120), offer(LEGIT[0]!, 110), offer(LEGIT[1]!, 130)]);
    expect(review).toEqual({ dropped: false, dropReason: null, mark: null, demoted: true, boosted: false });
  });

  it("boutique connue : mention « Boutique connue », remontée, jamais signalée pour son prix", () => {
    const reviews = reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer(LEGIT[2]!, 130), offer("https://www.zalando.fr/veste", 19)]);
    expect(reviews[3]).toEqual({ dropped: false, dropReason: null, mark: "known_shop", demoted: false, boosted: true });
  });

  it("site officiel de la marque : mention « Boutique officielle de la marque », jamais signalée pour son prix ; un revendeur reste « Boutique connue »", () => {
    expect(isOfficialShop("https://www.nike.com/fr/t/air-max-90")).toBe(true);
    expect(isOfficialShop("https://www2.hm.com/fr_fr/productpage.123.html")).toBe(true);
    expect(isOfficialShop("https://www.zalando.fr/nike-air-max")).toBe(false);
    expect(isOfficialShop("https://nike-outlet.shop/air-max")).toBe(false);
    expect(isKnownShop("https://www.nike.com/fr/t/air-max-90")).toBe(true);
    const reviews = reviewOffers([offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer("https://www.zalando.fr/nike-air-max", 125), offer("https://www.nike.com/fr/t/air-max-90", 19)]);
    expect(reviews[2]).toEqual({ dropped: false, dropReason: null, mark: "known_shop", demoted: false, boosted: true });
    expect(reviews[3]).toEqual({ dropped: false, dropReason: null, mark: "official_shop", demoted: false, boosted: true });
  });

  it("ordre : le site officiel de la marque passe en tête de sa section, avant les revendeurs connus, dans son ordre", () => {
    const review = (mark: "official_shop" | "known_shop" | null, demoted = false) => ({ dropped: false, dropReason: null, mark, demoted, boosted: mark !== null });
    const items = ["a", "b-connue", "c", "d-officielle", "e", "f-officielle", "g-signalee"];
    const reviews = [review(null), review("known_shop"), review(null), review("official_shop"), review(null), review("official_shop"), { ...review(null, true), mark: "unusual_price" as const }];
    expect(trustOrder(items, reviews)).toEqual(["d-officielle", "f-officielle", "b-connue", "a", "c", "e", "g-signalee"]);
  });

  it("jamais les seuls résultats : si les règles écartaient tout, les offres sont gardées, signalées et rangées plus bas", () => {
    const offers = [offer("https://moncler-outlet.shop/a", 10), offer("https://nike-sale.top/b", 12), offer("https://cheap-nike.xyz/c", 11)];
    // Avec le seuil d'aujourd'hui, la médiane comprend l'offre : jamais tout. Le filet, avec un seuil qui écarterait tout :
    const all = reviewOffers(offers, [], 2);
    expect(all.every((review) => !review.dropped && review.mark === "unusual_price" && review.demoted)).toBe(true);
    // Les résultats Lens déjà gardés comptent : les boutiques très suspectes partent.
    const withLens = reviewOffers(offers, [offer(LEGIT[0]!, 120), offer(LEGIT[1]!, 110), offer(LEGIT[2]!, 130)]);
    expect(withLens.every((review) => review.dropped)).toBe(true);
    // Une boutique masquée, elle, n'est jamais gardée, même seule.
    expect(reviewOffers([offer("https://replica-sac.fr/a", 100)])[0]!.dropped).toBe(true);
  });

  it("à l'enregistrement : les offres gardées dans leur ordre, et des nombres pour le journal", () => {
    const items = [{ link: LEGIT[0]!, euros: 120 }, { link: "https://replica-sac.fr/a", euros: 100 }, { link: LEGIT[1]!, euros: 110 }, { link: LEGIT[2]!, euros: 130 }, { link: "https://moncler-outlet.shop/x", euros: 15 }];
    const result = withoutDubiousOffers(items, (item) => offer(item.link, item.euros));
    expect(result.kept.map((item) => item.link)).toEqual(LEGIT);
    expect({ hidden: result.hidden, suspicious: result.suspicious }).toEqual({ hidden: 1, suspicious: 1 });
  });

  it("ordre : une boutique connue remonte de 2 places au plus, les offres signalées passent en fin de section, le reste garde son ordre", () => {
    const review = (boosted: boolean, demoted: boolean) => ({ dropped: false, dropReason: null, mark: null, demoted, boosted });
    const items = ["a", "b", "c", "d-connue", "e-signalee", "f"];
    const reviews = [review(false, false), review(false, false), review(false, false), review(true, false), review(false, true), review(false, false)];
    expect(KNOWN_SHOP_BOOST).toBe(2);
    expect(trustOrder(items, reviews)).toEqual(["a", "d-connue", "b", "c", "f", "e-signalee"]);
    // Déjà en tête : rien ne bouge ; retirée : absente.
    expect(trustOrder(["x", "y"], [review(true, false), { ...review(false, false), dropped: true }])).toEqual(["x"]);
  });
});

// ---- Relecture : ce que reçoit l'app (GET, lancement, boutiques, vos mots) ----

const SEARCH: SearchRow = {
  id: "recherche-1",
  user_id: "membre-1",
  source_url: null,
  source_platform: "photo",
  method: "manual_screenshot",
  screenshot_url: null,
  status: "completed",
  error_message: null,
  query: null,
  created_at: "2026-11-20T10:00:00.000Z",
  refused_before_call: 0,
  failure_kind: null,
  provider: "serpapi",
  run_started_at: "2026-11-20T10:00:00.000Z",
};

function row(rank: number, merchantUrl: string, price: number | null, extra: Partial<MatchRow> = {}): MatchRow {
  return {
    id: `p${rank}`,
    search_id: SEARCH.id,
    rank,
    product_name: `Veste ${rank}`,
    brand: null,
    image_url: `https://images.exemple.fr/${rank}.jpg`,
    image_hd_url: null,
    price_min: price === null ? null : price.toFixed(2),
    price_max: price === null ? null : price.toFixed(2),
    currency: price === null ? null : "EUR",
    merchant_name: "Boutique",
    merchant_url: merchantUrl,
    ...extra,
  };
}

describe("relecture d'une recherche (toProductSearch)", () => {
  const rows = [
    row(1, "https://boutique-a.fr/1", 120),
    row(2, "https://boutique-b.fr/2", 110),
    row(3, "https://petite-boutique-exemple.fr/3", 25),
    row(4, "https://www.zalando.fr/4", 125),
    row(5, "https://replica-veste.fr/5", 99),
    row(6, "https://boutique-c.fr/6", 130),
    row(7, "https://boutique-d.fr/s1", 115, { origin: "shopping" }),
    row(8, "https://moncler-outlet.shop/s2", 15, { origin: "shopping" }),
    row(9, "https://www.asos.com/s3", 118, { origin: "shopping" }),
  ];
  const affiliate = new Map(rows.map((match) => [match.id, `https://suivi.exemple.fr/${match.id}`]));
  const search = toProductSearch(SEARCH, rows, affiliate, new Map());

  it("retirées : la boutique masquée et l'offre très suspecte ne sont jamais envoyées (ni à « Trier par prix » de l'app, qui ne trie que ce qu'elle reçoit)", () => {
    const ids = search.matches.map((match) => match.id);
    expect(ids).not.toContain("p5");
    expect(ids).not.toContain("p8");
    expect(ids).toHaveLength(7);
  });

  it("mentions : « Boutique connue » et « Prix inhabituellement bas », champ absent sinon (une app plus ancienne l'ignore)", () => {
    const byId = new Map(search.matches.map((match) => [match.id, match]));
    expect(byId.get("p4")?.offerMark).toBe("known_shop");
    expect(byId.get("p9")?.offerMark).toBe("known_shop");
    expect(byId.get("p3")?.offerMark).toBe("unusual_price");
    expect("offerMark" in byId.get("p1")!).toBe(false);
  });

  it("ordre : chaque section reste à part ; boutique connue remontée, offre signalée en fin de sa section ; liens et rangs intacts", () => {
    // Lens : p4 (connue) gagne 2 places une fois p3 (signalée) passée en fin de section ; boutiques : p9 (connue) devant p7.
    expect(search.matches.map((match) => match.id)).toEqual(["p4", "p1", "p2", "p6", "p3", "p9", "p7"]);
    expect(search.matches.slice(0, 5).every((match) => match.origin === undefined)).toBe(true);
    expect(search.matches.slice(5).every((match) => match.origin === "shopping")).toBe(true);
    for (const match of search.matches) {
      expect(match.affiliateUrl).toBe(`https://suivi.exemple.fr/${match.id}`);
      expect(match.rank).toBe(Number(match.id.slice(1)));
    }
  });

  it("historique : jamais la vignette d'une offre qu'on ne montrerait plus", () => {
    expect(keptMatchRows([row(1, "https://replica-veste.fr/1", 90), row(2, "https://boutique-a.fr/2", 120)]).map((match) => match.id)).toEqual(["p2"]);
  });
});

describe("à l'enregistrement : les résultats Lens", () => {
  const lensMatch = (position: number, link: string, euros: number | null): ProviderVisualMatch => ({
    position,
    title: `Veste ${position}`,
    link,
    source: "Boutique",
    thumbnail: `https://encrypted-tbn0.gstatic.com/images?q=${position}`,
    ...(euros === null ? {} : { price: { value: `${euros} €`, extracted_value: euros, currency: "€" } }),
  });

  it("boutique masquée et offre très suspecte jamais rangées (ni gardées dans le cache), comptées pour le journal ; les autres, dans l'ordre de Google", () => {
    const response = {
      matches: [
        lensMatch(1, "https://boutique-a.fr/1", 120),
        lensMatch(2, "https://replica-veste.fr/2", 90),
        lensMatch(3, "https://boutique-b.fr/3", 110),
        lensMatch(4, "https://moncler-outlet.shop/4", 15),
        lensMatch(5, "https://boutique-c.fr/5", 130),
        lensMatch(6, "https://moncler-outlet.shop/6", null),
      ],
      received: 6,
    };
    const { matches, dubious } = filterVisualMatches(response, "fr");
    expect(matches.map((match) => match.merchantUrl)).toEqual(["https://boutique-a.fr/1", "https://boutique-b.fr/3", "https://boutique-c.fr/5", "https://moncler-outlet.shop/6"]);
    expect(dubious).toEqual({ hidden: 1, suspicious: 1 });
    expect(matches.map((match) => match.rank)).toEqual([1, 2, 3, 4]);
  });
});
