import { describe, expect, it, vi } from "vitest";
import type { OfferMark } from "@monapp/shared-types";
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
  isBrandShop,
  isHiddenShop,
  isKnownShop,
  isOfficialShop,
  looksLikeFakeShop,
  reviewOffers,
  sectionOrder,
  trustOrder,
  withoutDubiousOffers,
  type TrustOffer,
} from "../src/lib/shopTrust.js";
import { lightSort } from "../src/lib/lightSort.js";
import { keptMatchRows, toProductSearch, type MatchRow, type SearchRow } from "../src/lib/searchRows.js";
import { filterVisualMatches } from "../src/services/visualSearch.js";

const offer = (merchantUrl: string, priceValue: number | null = null, currency: string | null = priceValue === null ? null : "€"): TrustOffer => ({ merchantUrl, priceValue, currency });
/** Ce que l'enregistrement a noté d'une section sans boutique de la marque de la pièce (sectionOrder). */
const plainOffers = (items: readonly string[]) => items.map(() => ({ brandShop: false }));

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

  it("ordre, « Cette pièce dans d'autres boutiques » (shopping) : le site officiel de la marque de la pièce, noté à l'enregistrement, passe en tête, avant les revendeurs connus, dans son ordre", () => {
    const review = (mark: "official_shop" | "known_shop" | null, demoted = false) => ({ dropped: false, dropReason: null, mark, demoted, boosted: mark !== null });
    const items = ["a", "b-connue", "c", "d-officielle", "e", "f-officielle", "g-signalee"];
    const reviews = [review(null), review("known_shop"), review(null), review("official_shop"), review(null), review("official_shop"), { ...review(null, true), mark: "unusual_price" as const }];
    // Les deux pages de nike.com sont notées : Nike est la marque de la pièce.
    const offers = items.map((item) => ({ brandShop: item.endsWith("-officielle") }));
    expect(sectionOrder("shopping", items, reviews, offers)).toEqual(["d-officielle", "f-officielle", "b-connue", "a", "c", "e", "g-signalee"]);
    expect(trustOrder(items, reviews)).toEqual(sectionOrder("shopping", items, reviews, offers));
    // Refusé : sans la note de l'enregistrement, aucune boutique officielle ne passe devant, ni ne remonte comme une
    // boutique connue (le revendeur connu, lui, remonte toujours de 2 places au plus).
    expect(sectionOrder("shopping", items, reviews, plainOffers(items))).toEqual(["b-connue", "a", "c", "d-officielle", "e", "f-officielle", "g-signalee"]);
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

  it("ordre, « Cette pièce dans d'autres boutiques » (shopping) : une boutique connue remonte de 2 places au plus, les offres signalées passent en fin de section, le reste garde son ordre", () => {
    const review = (boosted: boolean, demoted: boolean) => ({ dropped: false, dropReason: null, mark: null, demoted, boosted });
    const items = ["a", "b", "c", "d-connue", "e-signalee", "f"];
    const reviews = [review(false, false), review(false, false), review(false, false), review(true, false), review(false, true), review(false, false)];
    expect(KNOWN_SHOP_BOOST).toBe(2);
    expect(sectionOrder("shopping", items, reviews, plainOffers(items))).toEqual(["a", "d-connue", "b", "c", "f", "e-signalee"]);
    // Déjà en tête : rien ne bouge ; retirée : absente.
    expect(sectionOrder("shopping", ["x", "y"], [review(true, false), { ...review(false, false), dropped: true }], plainOffers(["x", "y"]))).toEqual(["x"]);
  });

  it("ordre, recherche visuelle (lens) et « Résultats pour vos mots » (words) : chaque offre garde son rang reçu — aucune boutique officielle ou connue remontée, aucune offre signalée descendue ; seules les offres retirées manquent", () => {
    const review = (mark: OfferMark | null, flags: { demoted?: boolean; dropped?: boolean } = {}) => ({
      dropped: flags.dropped === true,
      dropReason: flags.dropped === true ? ("hidden" as const) : null,
      mark,
      demoted: flags.demoted === true,
      boosted: mark === "official_shop" || mark === "known_shop",
    });
    const items = ["a", "b-signalee", "c-connue", "d", "e-officielle", "f-retiree", "g-adresse-douteuse"];
    const reviews = [review(null), review("unusual_price", { demoted: true }), review("known_shop"), review(null), review("official_shop"), review(null, { dropped: true }), review(null, { demoted: true })];
    // La boutique officielle est notée comme celle de la marque de la pièce : même ainsi, elle garde son rang ici.
    const offers = items.map((item) => ({ brandShop: item === "e-officielle" }));
    for (const origin of ["lens", "words"] as const) {
      expect(sectionOrder(origin, items, reviews, offers), origin).toEqual(["a", "b-signalee", "c-connue", "d", "e-officielle", "g-adresse-douteuse"]);
    }
    // Contrôle : les mêmes offres dans « Cette pièce dans d'autres boutiques » sont rangées par leur mention.
    expect(sectionOrder("shopping", items, reviews, offers)).toEqual(["e-officielle", "c-connue", "a", "d", "b-signalee", "g-adresse-douteuse"]);
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

  it("ordre : chaque section reste à part ; la recherche visuelle garde l'ordre reçu (boutique connue et offre signalée à leur rang) ; dans « Cette pièce dans d'autres boutiques », la boutique connue remonte ; liens et rangs intacts", () => {
    // Lens : l'ordre reçu, sans p5 (retirée) ; boutiques : p9 (connue) devant p7.
    expect(search.matches.map((match) => match.id)).toEqual(["p1", "p2", "p3", "p4", "p6", "p9", "p7"]);
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

// Ordre des boutiques (décision du fondateur, 21 novembre 2026 : « Je ne veux
// mettre aucune marque en avant ») : la boutique officielle de la marque passe
// en tête pour la même pièce seulement (« Cette pièce dans d'autres
// boutiques ») ; ailleurs, chaque proposition garde sa place reçue. Les
// mentions restent partout ; les offres très douteuses sont retirées partout.
describe("ordre des boutiques : la boutique officielle en tête pour la même pièce seulement", () => {
  const rows = [
    // Recherche visuelle (Lens).
    row(1, "https://boutique-a.fr/1", 120),
    row(2, "https://petite-boutique-exemple.fr/2", 25), // prix inhabituellement bas
    row(3, "https://www.zalando.fr/3", 125), // boutique connue
    row(4, "https://moncler-outlet.shop/4", 118), // adresse douteuse seule : gardée, sans mention
    row(5, "https://www.nike.com/fr/5", 140), // boutique officielle de la marque
    row(6, "https://replica-veste.fr/6", 99), // boutique masquée : retirée
    row(7, "https://boutique-b.fr/7", 110),
    // Cette pièce dans d'autres boutiques : une veste Nike (nike.com noté à l'enregistrement comme la boutique de sa marque).
    row(8, "https://boutique-c.fr/s1", 115, { origin: "shopping", product_name: "Veste Nike Windrunner" }),
    row(9, "https://petite-boutique-exemple.fr/s2", 30, { origin: "shopping", product_name: "Nike Windrunner" }), // prix inhabituellement bas
    row(10, "https://boutique-d.fr/s3", 122, { origin: "shopping", product_name: "Nike Windrunner veste homme" }),
    row(11, "https://boutique-e.fr/s4", 119, { origin: "shopping", product_name: "Coupe-vent Windrunner Nike" }),
    row(12, "https://www.asos.com/s5", 117, { origin: "shopping", product_name: "Nike - Windrunner - Veste" }), // boutique connue
    row(13, "https://www.nike.com/fr/s6", 135, { origin: "shopping", product_name: "Veste Windrunner pour homme", brand_shop: true }), // boutique officielle de la marque
    row(14, "https://moncler-outlet.shop/s7", 15, { origin: "shopping", product_name: "Nike Windrunner" }), // prix très bas ET adresse douteuse : retirée
    // Résultats pour vos mots.
    row(15, "https://boutique-f.fr/w1", 112, { origin: "words" }),
    row(16, "https://petite-boutique-exemple.fr/w2", 20, { origin: "words" }), // prix inhabituellement bas
    row(17, "https://www.zalando.fr/w3", 121, { origin: "words" }), // boutique connue
    row(18, "https://www.nike.com/fr/w4", 128, { origin: "words" }), // boutique officielle de la marque
    row(19, "https://cheap-nike.xyz/w5", 12, { origin: "words" }), // prix très bas ET adresse douteuse : retirée
    row(20, "https://replica-sac.fr/w6", 90, { origin: "words" }), // boutique masquée : retirée
  ];
  const search = toProductSearch(SEARCH, rows, new Map(), new Map());
  /** Les identifiants d'une section, dans l'ordre envoyé (Lens : origine absente). */
  const section = (origin?: "shopping" | "words") => search.matches.filter((match) => match.origin === origin).map((match) => match.id);
  const markOf = (id: string) => search.matches.find((match) => match.id === id)?.offerMark ?? null;

  it("« Cette pièce dans d'autres boutiques » : la boutique officielle de la marque en tête, la boutique connue remontée de 2 places au plus, l'offre « Prix inhabituellement bas » en fin de section", () => {
    expect(section("shopping")).toEqual(["p13", "p8", "p12", "p10", "p11", "p9"]);
    expect([markOf("p13"), markOf("p12"), markOf("p9")]).toEqual(["official_shop", "known_shop", "unusual_price"]);
  });

  it("recherche visuelle : la boutique officielle, la boutique connue et l'offre signalée restent à leur rang reçu, avec leur mention ; la grande carte reste la première reçue", () => {
    expect(section()).toEqual(["p1", "p2", "p3", "p4", "p5", "p7"]);
    expect(search.matches[0]!.id).toBe("p1");
    expect([markOf("p2"), markOf("p3"), markOf("p5")]).toEqual(["unusual_price", "known_shop", "official_shop"]);
    // Adresse douteuse seule : à sa place, sans mention (rien n'est dit d'une adresse).
    expect(markOf("p4")).toBeNull();
    expect("offerMark" in search.matches.find((match) => match.id === "p1")!).toBe(false);
  });

  it("« Résultats pour vos mots » : la boutique officielle, la boutique connue et l'offre signalée restent à leur rang reçu, avec leur mention", () => {
    expect(section("words")).toEqual(["p15", "p16", "p17", "p18"]);
    expect([markOf("p16"), markOf("p17"), markOf("p18")]).toEqual(["unusual_price", "known_shop", "official_shop"]);
  });

  it("une offre très douteuse (boutique masquée, ou prix très bas ET adresse douteuse) est retirée dans toutes les sections ; les sections restent dans leur ordre, rangs intacts", () => {
    const ids = search.matches.map((match) => match.id);
    for (const dropped of ["p6", "p14", "p19", "p20"]) expect(ids).not.toContain(dropped);
    expect(ids).toHaveLength(16);
    expect(search.matches.map((match) => match.origin ?? "lens")).toEqual([...Array(6).fill("lens"), ...Array(6).fill("shopping"), ...Array(4).fill("words")]);
    for (const match of search.matches) expect(match.rank).toBe(Number(match.id.slice(1)));
  });

  // Grande carte prise dans le complément (app) : jamais une offre que le serveur range en fin de section. Une
  // adresse douteuse n'a pas de mention : l'app ne la reconnaît que par ce signal, jamais affiché.
  it("permis : dans « Cette pièce dans d'autres boutiques », l'offre rangée en fin de section est dite « demoted » ; refusé : jamais ailleurs (recherche visuelle, vos mots), ni pour une autre offre", () => {
    expect(search.matches.filter((match) => match.demoted === true).map((match) => match.id)).toEqual(["p9"]);
    // p2 et p16 (prix inhabituellement bas) et p4 (adresse douteuse) gardent leur place reçue : rien n'est dit.
    for (const id of ["p2", "p4", "p16", "p8", "p12", "p13"]) expect("demoted" in search.matches.find((match) => match.id === id)!, id).toBe(false);
    // Une adresse douteuse au prix ordinaire, reçue la première : rangée en dernier, sans mention, dite « demoted ».
    const shopping = toProductSearch(
      SEARCH,
      [
        row(1, "https://boutique-lens.fr/1", null),
        row(2, "https://boutique-lens2.fr/2", null),
        row(3, "https://moncler-outlet.shop/s1", 610, { origin: "shopping" }),
        row(4, "https://boutique-c.fr/s2", 640, { origin: "shopping" }),
        row(5, "https://www.zalando.fr/s3", 650, { origin: "shopping" }),
        row(6, "https://www.moncler.com/fr/s4", 1250, { origin: "shopping", brand_shop: true }),
        row(7, "https://boutique-d.fr/s5", 660, { origin: "shopping" }),
      ],
      new Map(),
      new Map()
    ).matches.filter((match) => match.origin === "shopping");
    expect(shopping.map((match) => match.id)).toEqual(["p6", "p5", "p4", "p7", "p3"]);
    expect(shopping.map((match) => match.demoted ?? false)).toEqual([false, false, false, false, true]);
    expect("offerMark" in shopping.at(-1)!).toBe(false);
  });
});

// « Cette pièce dans d'autres boutiques » vient de Google Shopping, sur la
// requête de l'IA : le tri léger y range d'abord les titres qui nomment la
// marque ou le modèle de la pièce, et y garde des pièces d'autres marques
// (lib/lightSort.ts). La liste des boutiques officielles compte 56 marques :
// seule celle de la marque de la pièce, reconnue à l'enregistrement
// (isBrandShop, lib/voieC.ts), passe en tête ; toute autre garde sa place
// reçue, avec sa mention (« je ne veux mettre aucune marque en avant »).
describe("« Cette pièce dans d'autres boutiques » : seule la boutique officielle de la marque de la pièce passe en tête", () => {
  /** Une section rangée comme à l'enregistrement (tri léger par la marque et le modèle de la requête, un oui sur la
   * boutique de la marque ; aucun oui pour une ligne d'avant 0054), sous une proposition Lens, puis relue : les
   * adresses dans l'ordre enregistré, puis dans l'ordre envoyé, et leurs mentions. */
  function savedSection(reference: { brand: string; model: string }, google: readonly [url: string, title: string][], options: { before0054?: boolean } = {}) {
    const sorted = lightSort(
      google.map(([url, title]) => ({ url, productName: title })),
      reference
    ).items;
    const rows = [
      row(1, "https://boutique-lens.fr/1", 40),
      ...sorted.map(({ url, productName }, index) =>
        row(index + 2, url, 30 + index, { origin: "shopping", product_name: productName, ...(!options.before0054 && isBrandShop(url, reference.brand) ? { brand_shop: true } : {}) })
      ),
    ];
    const shopping = toProductSearch(SEARCH, rows, new Map(), new Map()).matches.filter((match) => match.origin === "shopping");
    return {
      saved: sorted.map(({ url }) => new URL(url).hostname),
      hosts: shopping.map((match) => new URL(match.merchantUrl).hostname),
      marks: shopping.map((match) => match.offerMark ?? null),
    };
  }
  // Une pièce Zara : deux revendeurs nomment Zara, puis des pièces d'autres marques (ordre de Google).
  const ZARA: [string, string][] = [
    ["https://boutique-c.fr/s1", "Top satiné Zara noir"],
    ["https://boutique-d.fr/s2", "Zara top satin"],
    ["https://www.zara.com/fr/s3", "TOP SATINÉ - Noir | ZARA France"],
    ["https://boutique-e.fr/s4", "Top satiné"],
    ["https://www2.hm.com/fr_fr/s5", "Top en satin"],
    ["https://shop.mango.com/fr/s6", "Blouse satinée"],
  ];
  const ZARA_PIECE = { brand: "Zara", model: "" };

  it("permis : la boutique de la marque de la pièce en tête (Zara ; H&M, même quand aucun titre ne dit « H&M » ; The North Face) ; les autres boutiques officielles à leur place, avec leur mention", () => {
    const zara = savedSection(ZARA_PIECE, ZARA);
    expect(zara.hosts).toEqual(["www.zara.com", "boutique-c.fr", "boutique-d.fr", "boutique-e.fr", "www2.hm.com", "shop.mango.com"]);
    expect(zara.marks).toEqual(["official_shop", null, null, null, "official_shop", "official_shop"]);
    const hm = savedSection({ brand: "H&M", model: "" }, [
      ["https://boutique-c.fr/h1", "H&M robe lin"],
      ["https://boutique-d.fr/h2", "Robe en lin H&M taille 38"],
      ["https://www2.hm.com/fr_fr/h3", "Robe en lin"],
    ]);
    expect(hm.hosts).toEqual(["www2.hm.com", "boutique-c.fr", "boutique-d.fr"]);
    // Pièce H&M, des offres Mango devant dans l'ordre de Google : hm.com en tête, mango.com à sa place reçue.
    const hmBehindMango = savedSection({ brand: "H&M", model: "" }, [
      ["https://www.zalando.fr/m1", "Mango - Robe en lin"],
      ["https://www.laredoute.fr/m2", "Robe lin MANGO"],
      ["https://shop.mango.com/fr/m3", "Robe en lin"],
      ["https://www2.hm.com/fr_fr/m4", "Robe en lin"],
    ]);
    expect(hmBehindMango.hosts).toEqual(["www2.hm.com", "www.zalando.fr", "www.laredoute.fr", "shop.mango.com"]);
    expect(hmBehindMango.marks).toEqual(["official_shop", "known_shop", "known_shop", "official_shop"]);
    const tnf = savedSection({ brand: "The North Face", model: "Nuptse" }, [
      ["https://boutique-c.fr/t1", "The North Face Nuptse 1996"],
      ["https://boutique-d.fr/t2", "The North Face 1996 RETRO NUPTSE JACKET"],
      ["https://www.thenorthface.fr/t3", "Veste 1996 Retro Nuptse pour homme"],
    ]);
    expect(tnf.hosts).toEqual(["www.thenorthface.fr", "boutique-c.fr", "boutique-d.fr"]);
  });

  it("refusé : aucune offre ne nomme la marque de la pièce — la boutique officielle d'une marque revendue ne passe jamais devant (avant : Mango en tête d'une section Zara, nike.com pour des baskets Saye)", () => {
    const mango = savedSection(ZARA_PIECE, [
      ["https://www.zalando.fr/a", "Mango - Top satiné - noir"],
      ["https://www.laredoute.fr/b", "Top satiné col V MANGO"],
      ["https://boutique-e.fr/c", "Top satiné"],
      ["https://www2.hm.com/fr_fr/d", "Top en satin"],
      ["https://shop.mango.com/fr/e", "Top satiné"],
    ]);
    expect(mango.hosts).toEqual(["www.zalando.fr", "www.laredoute.fr", "boutique-e.fr", "www2.hm.com", "shop.mango.com"]);
    expect(mango.marks).toEqual(["known_shop", "known_shop", null, "official_shop", "official_shop"]);
    const nike = savedSection({ brand: "Saye", model: "Modelo 89" }, [
      ["https://www.zalando.fr/a", "Nike Sportswear - COURT VISION - Baskets basses - white"],
      ["https://www.courir.com/b", "Nike Court Vision Low Next Nature blanc"],
      ["https://boutique-x.fr/c", "Baskets blanches cuir"],
      ["https://www.nike.com/fr/d", "Chaussure Nike Court Vision Low Next Nature pour homme"],
    ]);
    expect(nike.hosts).toEqual(["www.zalando.fr", "www.courir.com", "boutique-x.fr", "www.nike.com"]);
  });

  it("refusé : un mot de la marque, du modèle ou de la description qui est aussi une marque de la liste (Jules & Jenn, blouse Sézane « Jules », Tommy Bahama, motif « petit bateau ») ne fait jamais passer sa boutique devant", () => {
    const julesJenn = savedSection({ brand: "Jules & Jenn", model: "" }, [
      ["https://www.spartoo.com/a", "Jules & Jenn - Sac seau cuir camel"],
      ["https://www.galerieslafayette.com/b", "Sac seau en cuir Jules & Jenn"],
      ["https://boutique-x.fr/c", "Sac seau cuir camel"],
      ["https://www.jules.com/fr-fr/d", "Sac bandoulière homme"],
    ]);
    expect(julesJenn.hosts).toEqual(["www.spartoo.com", "www.galerieslafayette.com", "boutique-x.fr", "www.jules.com"]);
    expect(julesJenn.marks.at(-1)).toBe("official_shop");
    const sezane = savedSection({ brand: "Sézane", model: "Jules" }, [
      ["https://www.vestiairecollective.com/a", "Sézane Blouse Jules écru"],
      ["https://www.vinted.fr/b", "Blouse Jules Sezane T38"],
      ["https://www.jules.com/fr-fr/c", "Chemise oxford homme"],
    ]);
    expect(sezane.hosts).toEqual(["www.vestiairecollective.com", "www.vinted.fr", "www.jules.com"]);
    const tommy = savedSection({ brand: "Tommy Bahama", model: "" }, [
      ["https://boutique-a.fr/a", "Tommy Bahama chemise hawaïenne"],
      ["https://boutique-b.fr/b", "Chemise Tommy Bahama lin"],
      ["https://boutique-c.fr/c", "Chemise lin"],
      ["https://fr.tommy.com/d", "Chemise en lin coupe droite"],
    ]);
    expect(tommy.hosts).toEqual(["boutique-a.fr", "boutique-b.fr", "boutique-c.fr", "fr.tommy.com"]);
    const pyjama = savedSection({ brand: "Tape à l'œil", model: "" }, [
      ["https://boutique-a.fr/p1", "Pyjama Tape à l'œil motif petit bateau"],
      ["https://boutique-b.fr/p2", "Tape à l'œil pyjama petit bateau"],
      ["https://www.petit-bateau.fr/p3", "Pyjama enfant"],
    ]);
    expect(pyjama.hosts).toEqual(["boutique-a.fr", "boutique-b.fr", "www.petit-bateau.fr"]);
  });

  it("refusé : une ligne d'avant 0054 (aucun oui), ou une marque écrite autrement que son adresse (« Saint Laurent », ysl.com) — la boutique garde sa place reçue, avec sa mention", () => {
    const before = savedSection(ZARA_PIECE, ZARA, { before0054: true });
    expect(before.hosts).toEqual(before.saved);
    expect(before.marks[2]).toBe("official_shop");
    const ysl = savedSection({ brand: "Saint Laurent", model: "Le 5 à 7" }, [
      ["https://www.mytheresa.com/a", "Saint Laurent Sac Le 5 à 7"],
      ["https://boutique-c.fr/b", "Sac porté épaule Le 5 à 7 Saint Laurent"],
      ["https://www.ysl.com/fr-fr/c", "Sac Le 5 à 7 en cuir lisse"],
      ["https://boutique-d.fr/d", "Sac cuir"],
    ]);
    expect(ysl.hosts).toEqual(["www.mytheresa.com", "boutique-c.fr", "www.ysl.com", "boutique-d.fr"]);
    expect(ysl.marks[2]).toBe("official_shop");
  });

  it("une boutique officielle d'une autre marque ne remonte pas non plus comme une boutique connue ; un revendeur connu, lui, remonte toujours de 2 places au plus", () => {
    const section = savedSection(ZARA_PIECE, [
      ["https://boutique-c.fr/k1", "Top satiné Zara noir"],
      ["https://boutique-d.fr/k2", "Zara top satin"],
      ["https://boutique-e.fr/k3", "Top satiné"],
      ["https://www2.hm.com/fr_fr/k4", "Top en satin"],
      ["https://www.zalando.fr/k5", "Zara - Top satiné"],
    ]);
    expect(section.saved).toEqual(["boutique-c.fr", "boutique-d.fr", "www.zalando.fr", "boutique-e.fr", "www2.hm.com"]);
    expect(section.hosts).toEqual(["www.zalando.fr", "boutique-c.fr", "boutique-d.fr", "boutique-e.fr", "www2.hm.com"]);
  });
});

// Ordre des boutiques : la boutique officielle de la marque de la pièce est
// reconnue à l'enregistrement, où la marque est connue (celle de la requête,
// vérifiée par le serveur dans les titres Lens) ; la ligne en garde un oui.
describe("à l'enregistrement : la boutique officielle de la marque de la pièce (isBrandShop)", () => {
  it("permis : la marque écrite comme son adresse, en un mot (« H&M », « The North Face », « ba&sh », « Hermès », pluriel « Levi's »), sur tous ses sous-domaines", () => {
    expect(isBrandShop("https://www.zara.com/fr/fr/top-p1.html", "Zara")).toBe(true);
    expect(isBrandShop("https://www2.hm.com/fr_fr/productpage.1.html", "H&M")).toBe(true);
    expect(isBrandShop("https://www.thenorthface.fr/veste", "The North Face")).toBe(true);
    expect(isBrandShop("https://www.ba-sh.com/robe", "ba&sh")).toBe(true);
    expect(isBrandShop("https://www.hermes.com/fr/fr/carre", "Hermès")).toBe(true);
    expect(isBrandShop("https://www.levi.com/FR/fr_FR/501", "Levi's")).toBe(true);
  });

  it("refusé : un mot de la marque, du modèle ou d'une autre marque ne suffit jamais (Jules & Jenn, Tommy Bahama, Mango dans une section Zara) ; une marque écrite autrement que son adresse, une marque vide, un revendeur ou une imitation non plus", () => {
    expect(isBrandShop("https://www.jules.com/fr-fr/sac", "Jules & Jenn")).toBe(false);
    expect(isBrandShop("https://fr.tommy.com/chemise", "Tommy Bahama")).toBe(false);
    expect(isBrandShop("https://shop.mango.com/fr/top", "Zara")).toBe(false);
    expect(isBrandShop("https://www2.hm.com/fr_fr/top", "Zara")).toBe(false);
    expect(isBrandShop("https://www.nike.com/fr/court-vision", "Saye")).toBe(false);
    expect(isBrandShop("https://www.petit-bateau.fr/pyjama", "Tape à l'œil")).toBe(false);
    // Accepté (décision « jamais une marque en avant par erreur ») : « Saint Laurent » n'est pas ysl.com.
    expect(isBrandShop("https://www.ysl.com/fr-fr/sac", "Saint Laurent")).toBe(false);
    expect(isBrandShop("https://www.zara.com/fr/top", "")).toBe(false);
    expect(isBrandShop("https://www.zara.com/fr/top", " & ")).toBe(false);
    expect(isBrandShop("https://www.zalando.fr/zara-top", "Zara")).toBe(false);
    expect(isBrandShop("https://nike-outlet.shop/air-max", "Nike")).toBe(false);
    expect(isBrandShop("pas une adresse", "Zara")).toBe(false);
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
