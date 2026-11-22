import { describe, expect, it } from "vitest";
import { verdictTier } from "../src/lib/lightSort.js";
import { parseMatchRows, parseSearchRow, toProductSearch, type MatchRow } from "../src/lib/searchRows.js";
import { knownShopName } from "../src/lib/shopTrust.js";
import { BOUTIQUES_CONNUES } from "../src/listes/boutiquesConnues.js";
import { countedShopName, searchVerdict, SELLER_TITLED_SHOPS, VERDICT_MIN_PRICES, VERDICT_MIN_SHOPS } from "../src/lib/verdict.js";

// Le verdict (lot « verdict », migration 0055), sans base : le palier noté à
// l'enregistrement (lightSort.ts, verdictTier) et la phrase calculée à la
// relecture (verdict.ts), à travers toProductSearch (les offres retirées et
// signalées comme l'écran les montre). Règle d'or : un faux « identifiée »
// est le pire des cas ; dans le doute, le plus modeste ; sans savoir, rien.
// Marques, modèles et boutiques inconnues fictifs ; boutiques connues tirées
// de la liste du fondateur (src/listes/boutiquesConnues.ts).

const REFERENCE = { brand: "Exemplor", model: "Nuage 07" };

describe("le palier du verdict, noté sur la ligne (verdictTier)", () => {
  it("permis : 0 quand le titre nomme la marque ET le modèle, 1 pour la marque seule", () => {
    expect(verdictTier("Veste Exemplor Nuage 07 bleue", REFERENCE)).toBe(0);
    expect(verdictTier("Exemplor veste nuage 07", REFERENCE)).toBe(0);
    expect(verdictTier("Veste Exemplor bleue", REFERENCE)).toBe(1);
  });

  it("refusé : jamais 0 sans modèle donné (la marque seule ne dit pas « la même pièce ») ; le modèle sans la marque, une marque faite de petits mots ou vide : 2", () => {
    expect(verdictTier("Veste Exemplor", { brand: "Exemplor", model: "" })).toBe(1);
    expect(verdictTier("Veste Nuage 07", REFERENCE)).toBe(2);
    expect(verdictTier("On Cloud 5 basket", { brand: "On", model: "Cloud 5" })).toBe(2);
    expect(verdictTier("Veste Nuage 07", { brand: "", model: "Nuage 07" })).toBe(2);
    expect(verdictTier("Veste Exemplor", { brand: "", model: "" })).toBe(2);
    // Un mot du modèle manque : pas 0.
    expect(verdictTier("Veste Exemplor Nuage 08", REFERENCE)).toBe(1);
  });
});

describe("le nom d'une boutique comptée (knownShopName)", () => {
  it("permis : une enseigne connue, quel que soit le pays ou le sous-domaine", () => {
    expect(knownShopName("https://www.zalando.fr/veste")).toBe("zalando");
    expect(knownShopName("https://zalando.be/veste")).toBe("zalando");
    expect(knownShopName("https://www.asos.com/veste")).toBe("asos");
  });

  it("refusé : une boutique inconnue, une imitation, une adresse illisible", () => {
    expect(knownShopName("https://boutique-a.fr/1")).toBeNull();
    expect(knownShopName("https://zalando-outlet.shop/1")).toBeNull();
    expect(knownShopName("pas une adresse")).toBeNull();
  });
});

describe("les boutiques comptées pour le verdict (countedShopName)", () => {
  it("permis : une enseigne connue ou un site officiel de marque", () => {
    expect(countedShopName("https://www.zalando.fr/veste")).toBe("zalando");
    expect(countedShopName("https://www.asos.com/veste")).toBe("asos");
  });

  it("refusé : une place de marché ou un site de revente, où chaque vendeur écrit son titre ; une boutique inconnue", () => {
    expect(countedShopName("https://www.amazon.fr/veste")).toBeNull();
    expect(countedShopName("https://www.vinted.fr/items/1")).toBeNull();
    expect(countedShopName("https://fr.vestiairecollective.com/veste")).toBeNull();
    expect(countedShopName("https://stockx.com/veste")).toBeNull();
    expect(countedShopName("https://boutique-a.fr/1")).toBeNull();
  });

  it("chaque place de marché exclue est encore dans la liste du fondateur (un renommage ne la ferait pas compter en silence)", () => {
    for (const name of SELLER_TITLED_SHOPS) expect(BOUTIQUES_CONNUES.some((domain) => domain.split(".")[0] === name), name).toBe(true);
  });
});

// ---- Une recherche relue ----

type Row = Record<string, unknown>;

const SEARCH: Row = {
  id: "recherche-v",
  user_id: "membre-v",
  source_url: null,
  source_platform: "photo",
  method: "manual_screenshot",
  screenshot_url: null,
  status: "completed",
  error_message: null,
  query: null,
  created_at: "2026-11-22T10:00:00.000Z",
  refused_before_call: 0,
  failure_kind: null,
  provider: "serpapi",
  run_started_at: "2026-11-22T10:00:00.000Z",
  complement_status: "shown",
  shopping_calls: 1,
  lens_from_cache: false,
  served_from_cache: false,
  text_suggested: false,
  text_requested_at: null,
  text_status: null,
  total_seconds: 6,
  complement_deferred: null,
  complement_deferred_at: null,
};

let rank = 0;
/** Une proposition ; `tier` : son palier (null : ligne d'avant ; "absent" : base sans 0055). */
function offer(url: string, tier: 0 | 1 | 2 | null | "absent", price: number | null = 70, extra: Row = {}): Row {
  rank += 1;
  return {
    id: `p${rank}`,
    search_id: SEARCH.id,
    rank,
    product_name: `Pièce ${rank}`,
    brand: null,
    image_url: `https://images.exemple.fr/${rank}.jpg`,
    image_hd_url: null,
    price_min: price,
    price_max: price,
    currency: price === null ? null : "EUR",
    merchant_name: "Boutique",
    merchant_url: url,
    origin: "shopping",
    ...(tier === "absent" ? {} : { title_tier: tier }),
    ...extra,
  };
}
const lens = (url: string, extra: Row = {}) => offer(url, null, 65, { origin: "lens", ...extra });

function verdictOf(matches: Row[], search: Row = {}, verdict = true) {
  const row = parseSearchRow({ ...SEARCH, ...search })!;
  const rows = parseMatchRows(matches)!;
  expect(row).not.toBeNull();
  expect(rows).not.toBeNull();
  return toProductSearch(row, rows, new Map(), new Map(), true, { verdict }).verdict;
}

describe("« identified » : au moins deux boutiques connues distinctes nomment la marque et le modèle", () => {
  it("permis : deux enseignes connues au palier 0, avec le nombre et la fourchette dans leur devise", () => {
    expect(VERDICT_MIN_SHOPS).toBe(2);
    expect(VERDICT_MIN_PRICES).toBe(2);
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://www.zalando.fr/a", 0, 89), offer("https://www.asos.com/b", 0, 59), offer("https://boutique-a.fr/c", 0, 20)])).toEqual({
      level: "identified",
      shopCount: 2,
      priceRange: { min: 59, max: 89, currency: "EUR" },
    });
  });

  it("refusé : une seule boutique ne suffit pas — même avec deux offres de la même enseigne (deux pays compris) ; c'est « close »", () => {
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://www.zalando.fr/a", 0)])).toEqual({ level: "close" });
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://www.zalando.fr/a", 0), offer("https://www.zalando.fr/b", 0)])).toEqual({ level: "close" });
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://www.zalando.fr/a", 0), offer("https://www.zalando.be/b", 0)])).toEqual({ level: "close" });
  });

  it("refusé : des boutiques inconnues ne comptent pas, même nombreuses (titres « bourrés de marques ») ; c'est « lookalikes »", () => {
    expect(verdictOf([offer("https://boutique-a.fr/1", 0), offer("https://boutique-b.fr/2", 0), offer("https://boutique-c.fr/3", 0)])).toEqual({ level: "lookalikes" });
    // Avec une enseigne connue : une seule boutique comptée, « close ».
    expect(verdictOf([offer("https://boutique-a.fr/1", 0), offer("https://boutique-b.fr/2", 0), offer("https://www.zalando.fr/a", 0)])).toEqual({ level: "close" });
  });

  it("refusé : places de marché et revente ne comptent pas — une enseigne connue avec Amazon et Vinted reste « close », Amazon et Vinted seuls « lookalikes »", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0), offer("https://www.amazon.fr/b", 0), offer("https://www.vinted.fr/c", 0)])).toEqual({ level: "close" });
    expect(verdictOf([offer("https://www.amazon.fr/b", 0), offer("https://www.vinted.fr/c", 0)])).toEqual({ level: "lookalikes" });
  });

  it("permis : un site officiel de marque et une enseigne connue comptent pour deux", () => {
    expect(verdictOf([offer("https://www.adidas.fr/a", 0, 100), offer("https://www.zalando.fr/b", 0, 90)])).toEqual({ level: "identified", shopCount: 2, priceRange: { min: 90, max: 100, currency: "EUR" } });
  });

  it("refusé : une offre retirée (boutique masquée) ne compte pas", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0), offer("https://replica.asos.com/b", 0)])).toEqual({ level: "close" });
  });

  it("refusé : une boutique connue au palier 1 (marque seule) ne compte pas pour « identified »", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0), offer("https://www.asos.com/b", 1)])).toEqual({ level: "close" });
  });
});

describe("la fourchette : jamais avec un seul prix, jamais en mélangeant deux devises", () => {
  it("permis : un même prix chez deux enseignes donne un minimum égal au maximum ; une offre sans prix est laissée de côté", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0, 70), offer("https://www.asos.com/b", 0, 70), offer("https://www.laredoute.fr/c", 0, null)])).toEqual({
      level: "identified",
      shopCount: 3,
      priceRange: { min: 70, max: 70, currency: "EUR" },
    });
  });

  it("refusé : un seul prix connu, ou deux prix de la même enseigne — pas de fourchette, le nombre reste", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0, 70), offer("https://www.asos.com/b", 0, null)])).toEqual({ level: "identified", shopCount: 2 });
    expect(verdictOf([offer("https://www.zalando.fr/a", 0, 70), offer("https://www.zalando.be/a", 0, 80), offer("https://www.asos.com/b", 0, null)])).toEqual({ level: "identified", shopCount: 2 });
  });

  it("refusé : deux devises, ou une devise illisible — pas de fourchette", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0, 70), offer("https://www.asos.com/b", 0, 60, { currency: "GBP" })])).toEqual({ level: "identified", shopCount: 2 });
    expect(verdictOf([offer("https://www.zalando.fr/a", 0, 70), offer("https://www.asos.com/b", 0, 60, { currency: "$" })])).toEqual({ level: "identified", shopCount: 2 });
  });

  it("le symbole et le code d'une même devise sont la même devise (« € » et « EUR »)", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", 0, 70, { currency: "€" }), offer("https://www.asos.com/b", 0, 60)])?.priceRange).toEqual({ min: 60, max: 70, currency: "EUR" });
  });
});

describe("« close » : une seule boutique comptée nomme la marque et le modèle", () => {
  it("permis : une enseigne connue au palier 0, les autres boutiques inconnues ou sans le modèle", () => {
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://www.zalando.fr/a", 0), offer("https://boutique-a.fr/1", 1), offer("https://www.asos.com/b", 1)])).toEqual({ level: "close" });
  });

  it("refusé : la marque seule (palier 1), même chez des enseignes connues — la requête contient toujours la marque : « lookalikes »", () => {
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://www.zalando.fr/a", 1), offer("https://www.asos.com/b", 1), offer("https://boutique-a.fr/1", 1)])).toEqual({ level: "lookalikes" });
  });

  it("refusé : seule une offre signalée (prix inhabituellement bas) nomme la marque — elle ne compte pas : « lookalikes »", () => {
    expect(
      verdictOf([offer("https://boutique-a.fr/1", 2, 100), offer("https://boutique-b.fr/2", 2, 110), offer("https://boutique-c.fr/3", 2, 105), offer("https://boutique-d.fr/4", 1, 10)])
    ).toEqual({ level: "lookalikes" });
  });
});

describe("« lookalikes » : rien de tel", () => {
  it("permis : aucun titre ne nomme la marque ; pièce sans marque reconnue (« no_query »), rien dans les boutiques (« empty »), IA coupée (« skipped »)", () => {
    expect(verdictOf([lens("https://lens-a.fr/1"), offer("https://boutique-a.fr/1", 2)])).toEqual({ level: "lookalikes" });
    for (const status of ["no_query", "empty", "skipped"]) expect(verdictOf([lens("https://lens-a.fr/1")], { complement_status: status }), status).toEqual({ level: "lookalikes" });
  });

  it("refusé : sans 0055 (la route ne demande pas le verdict), même une pièce sans marque n'en a aucun ; des lignes des boutiques sans la colonne non plus", () => {
    expect(verdictOf([lens("https://lens-a.fr/1")], { complement_status: "no_query" }, false)).toBeUndefined();
    expect(verdictOf([offer("https://www.zalando.fr/a", "absent"), offer("https://www.asos.com/b", "absent")])).toBeUndefined();
  });
});

describe("aucun verdict quand on ne sait pas", () => {
  it("refusé : recherche d'avant 0055 (offres des boutiques sans palier), même une seule ligne sans palier", () => {
    expect(verdictOf([offer("https://www.zalando.fr/a", null), offer("https://www.asos.com/b", null)])).toBeUndefined();
    expect(verdictOf([offer("https://www.zalando.fr/a", 0), offer("https://www.asos.com/b", 0), offer("https://boutique-a.fr/c", null)])).toBeUndefined();
  });

  it("refusé : étape des boutiques en échec, à court de temps ou de place, ou pas lancée", () => {
    const matches = () => [offer("https://www.zalando.fr/a", 0), offer("https://www.asos.com/b", 0)];
    for (const status of ["ai_failed", "shopping_failed", "no_time", "no_capacity", "error", null]) {
      expect(verdictOf(matches(), { complement_status: status }), String(status)).toBeUndefined();
    }
  });

  it("refusé : boutiques encore attendues (« pending », « running ») ou étape restée en attente ; permis une fois close", () => {
    const now = new Date().toISOString();
    const matches = () => [offer("https://www.zalando.fr/a", 0), offer("https://www.asos.com/b", 0)];
    expect(verdictOf(matches(), { complement_deferred: "pending", complement_deferred_at: now, complement_status: null })).toBeUndefined();
    expect(verdictOf(matches(), { complement_deferred: "running", complement_deferred_at: now })).toBeUndefined();
    expect(verdictOf(matches(), { complement_deferred: "pending", complement_deferred_at: "2026-01-01T00:00:00.000Z", complement_status: "shown" })).toBeUndefined();
    expect(verdictOf(matches(), { complement_deferred: "done", complement_deferred_at: now })?.level).toBe("identified");
  });

  it("refusé : recherche non terminée, sans proposition, ou verdict non demandé (base sans 0055, historique qui ne lit qu'une proposition)", () => {
    const matches = () => [offer("https://www.zalando.fr/a", 0), offer("https://www.asos.com/b", 0)];
    expect(verdictOf(matches(), { status: "processing" })).toBeUndefined();
    expect(verdictOf([])).toBeUndefined();
    expect(verdictOf(matches(), {}, false)).toBeUndefined();
  });
});

describe("le verdict ne change l'ordre de rien", () => {
  it("permis : les propositions renvoyées sont les mêmes, dans le même ordre, avec ou sans verdict", () => {
    const matches = [lens("https://lens-a.fr/1"), offer("https://boutique-a.fr/1", 2), offer("https://www.zalando.fr/a", 0), offer("https://www.asos.com/b", 0)];
    const row = parseSearchRow(SEARCH)!;
    const rows = parseMatchRows(matches)! as MatchRow[];
    const withVerdict = toProductSearch(row, rows, new Map(), new Map(), true, { verdict: true });
    const without = toProductSearch(row, rows, new Map(), new Map(), true);
    expect(withVerdict.verdict?.level).toBe("identified");
    expect("verdict" in without).toBe(false);
    expect(withVerdict.matches).toEqual(without.matches);
  });

  it("refusé : rien de la marque, du modèle ni d'une boutique dans le verdict — des nombres, une devise et un niveau", () => {
    const verdict = verdictOf([offer("https://www.zalando.fr/a", 0, 70), offer("https://www.asos.com/b", 0, 80)]);
    expect(Object.keys(verdict!).sort()).toEqual(["level", "priceRange", "shopCount"]);
    expect(JSON.stringify(verdict)).not.toMatch(/zalando|asos|exemplor|nuage/i);
  });

  it("searchVerdict lui-même : aucune proposition montrée, aucun verdict", () => {
    expect(searchVerdict(parseSearchRow(SEARCH)!, [])).toBeUndefined();
  });
});
