import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWords, luxuryResaleOf, resaleSitesFor, searchUrlOf, searchWordsOf } from "../src/lib/luxuryResale.js";
import { parseMatchRows, parseSearchRow, toProductSearch } from "../src/lib/searchRows.js";
import { MAISONS_DE_LUXE, SITES_DE_REVENTE, type SiteDeRevente } from "../src/listes/secondeMainDeLuxe.js";

// Seconde main de luxe (lot « seconde main de luxe ») : la règle du §1 de la
// fiche, sans base ni réseau, à travers toProductSearch (offres retirées et
// signalées comme l'écran les montre). Règle d'or : dans le doute, rien.
// Boutiques connues tirées des listes du fondateur ; boutiques inconnues
// fictives.

type Row = Record<string, unknown>;

const SEARCH: Row = {
  id: "recherche-luxe",
  user_id: "membre-luxe",
  source_url: null,
  source_platform: "photo",
  method: "manual_screenshot",
  screenshot_url: null,
  status: "completed",
  error_message: null,
  // Les mots tapés par le membre : jamais dans la recherche du site de revente.
  query: "manteau de ma tante zéphyrine",
  created_at: "2026-11-23T10:00:00.000Z",
  refused_before_call: 0,
  failure_kind: null,
  provider: "serpapi",
  run_started_at: "2026-11-23T10:00:00.000Z",
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
function offer(url: string, title: string, extra: Row = {}): Row {
  rank += 1;
  return {
    id: `p${rank}`,
    search_id: SEARCH.id,
    rank,
    product_name: title,
    brand: null,
    image_url: `https://images.exemple.fr/${rank}.jpg`,
    image_hd_url: null,
    price_min: 2900,
    price_max: 2900,
    currency: "EUR",
    merchant_name: "Boutique",
    merchant_url: url,
    origin: "lens",
    ...extra,
  };
}
const shopping = (url: string, title: string, extra: Row = {}) => offer(url, title, { origin: "shopping", ...extra });
const words = (url: string, title: string) => offer(url, title, { origin: "words" });

function productSearch(matches: Row[], search: Row = {}, luxuryResale = true) {
  const row = parseSearchRow({ ...SEARCH, ...search })!;
  const rows = parseMatchRows(matches)!;
  expect(row).not.toBeNull();
  expect(rows).not.toBeNull();
  return toProductSearch(row, rows, new Map(), new Map(), true, { verdict: true, luxuryResale });
}
const resaleOf = (matches: Row[], search: Row = {}) => productSearch(matches, search).luxuryResale;
const houseOf = (matches: Row[], search: Row = {}) => resaleOf(matches, search)?.house;

describe("(A) le site officiel et une boutique connue", () => {
  it("permis : dior.com + zalando.fr dont le titre nomme « Dior »", () => {
    expect(houseOf([offer("https://www.dior.com/fr_fr/sac-lady", "Sac Lady Dior moyen modèle"), offer("https://www.zalando.fr/a", "Dior Sac Lady noir")])).toBe("Dior");
  });

  it("refusé : dior.com seul (une seule source), ou deux pages de dior.com (une seule source)", () => {
    expect(houseOf([offer("https://www.dior.com/a", "Sac Lady Dior")])).toBeUndefined();
    expect(houseOf([offer("https://www.dior.com/a", "Sac Lady Dior"), offer("https://www.dior.com/b", "Sac Saddle Dior")])).toBeUndefined();
  });
});

describe("(A) deux boutiques connues", () => {
  it("permis : farfetch + mytheresa nomment « Gucci »", () => {
    expect(houseOf([offer("https://www.farfetch.com/a", "Gucci sac Jackie 1961"), shopping("https://www.mytheresa.com/b", "Sac Jackie 1961 Gucci")])).toBe("Gucci");
  });

  it("refusé : zalando.fr + zalando.be (une seule enseigne, une seule source)", () => {
    expect(houseOf([offer("https://www.zalando.fr/a", "Gucci sac Jackie"), offer("https://www.zalando.be/b", "Gucci sac Jackie")])).toBeUndefined();
  });
});

describe("le titre d'une autre marque ne compte pas", () => {
  it("refusé : « Blouse Céline » sur sezane.com (site officiel d'une autre marque) + 24s.com nommant « Celine »", () => {
    expect(houseOf([offer("https://www.sezane.com/fr/blouse-celine", "Blouse Céline"), offer("https://www.24s.com/a", "Celine Triomphe sac")])).toBeUndefined();
  });

  it("permis : celine.com + 24s.com", () => {
    expect(houseOf([offer("https://www.celine.com/a", "Sac Triomphe"), offer("https://www.24s.com/a", "Celine Triomphe sac")])).toBe("Celine");
  });

  it("refusé : le nom d'une autre marque qui contient celui de la maison (« See by Chloé », « Red Valentino ») ; permis : la maison elle-même", () => {
    expect(houseOf([offer("https://www.farfetch.com/a", "See by Chloé sandales Lyna"), offer("https://www.mytheresa.com/b", "Sandales See By Chloe")])).toBeUndefined();
    expect(houseOf([offer("https://www.farfetch.com/a", "Red Valentino robe"), offer("https://www.24s.com/b", "Robe RED Valentino")])).toBeUndefined();
    // Chloé demande son site officiel (siteRequis, voir plus bas) : chloe.com + une boutique connue.
    expect(houseOf([offer("https://www.chloe.com/fr/sandales-lauren", "Sandales Lauren"), offer("https://www.mytheresa.com/b", "Sandales Lauren Chloe")])).toBe("Chloé");
  });
});

describe("maisons dont le nom est aussi un prénom ou une autre ligne (siteRequis : Valentino, Celine, Chloé)", () => {
  it("refusé : la ligne Mario Valentino vendue « Valentino Bags » (Zalando) ou « VALENTINO » (About You)", () => {
    expect(houseOf([offer("https://www.zalando.fr/a", "Valentino Bags ZERO RE - Sac à main - noir"), offer("https://www.aboutyou.fr/b", "VALENTINO Sac à bandoulière 'Zero Re' en noir")])).toBeUndefined();
  });

  it("refusé : « Céline » prénom d'un modèle sur deux boutiques connues (La Redoute, bonprix)", () => {
    expect(houseOf([offer("https://www.laredoute.fr/a", "Blouse Céline imprimée"), offer("https://www.bonprix.fr/b", "Blouse Céline à fleurs")])).toBeUndefined();
  });

  it("refusé : deux grandes boutiques de luxe sans le site de la maison (Chloé, Valentino)", () => {
    expect(houseOf([offer("https://www.farfetch.com/a", "Chloé sandales Lauren"), offer("https://www.mytheresa.com/b", "Sandales Lauren Chloe")])).toBeUndefined();
    expect(houseOf([offer("https://www.farfetch.com/a", "Valentino Garavani Rockstud"), offer("https://www.24s.com/b", "Escarpins Rockstud Valentino")])).toBeUndefined();
  });

  it("permis : le site de la maison + une boutique connue qui la nomme", () => {
    expect(houseOf([offer("https://www.valentino.com/fr-fr/rockstud", "Escarpins Rockstud"), offer("https://www.24s.com/b", "Escarpins Rockstud Valentino Garavani")])).toBe("Valentino");
    expect(houseOf([offer("https://www.celine.com/a", "Blouse en soie"), offer("https://www.laredoute.fr/b", "Blouse Celine soie")])).toBe("Celine");
  });

  it("refusé : « Valentino Bags » ne compte jamais, même avec le site de la maison (une seule source) ; permis : (B) brand_shop sur valentino.com", () => {
    expect(houseOf([offer("https://www.valentino.com/a", "Sac Rockstud"), offer("https://www.zalando.fr/b", "Valentino Bags Sac Rockstud")])).toBeUndefined();
    expect(houseOf([shopping("https://www.valentino.com/a", "Sac Rockstud", { brand_shop: true })])).toBe("Valentino");
  });

  it("permis : une maison sans siteRequis garde la règle (A) par deux boutiques connues (Gucci)", () => {
    expect(houseOf([offer("https://www.laredoute.fr/a", "Gucci ceinture GG"), offer("https://www.bonprix.fr/b", "Ceinture Gucci GG")])).toBe("Gucci");
  });
});

describe("revente, places de marché, boutiques inconnues", () => {
  const doubtful = [
    offer("https://fr.vestiairecollective.com/a", "Chanel Timeless sac"),
    offer("https://www.vinted.fr/items/1", "Chanel sac Timeless"),
    offer("https://www.amazon.fr/a", "Chanel Timeless"),
    offer("https://boutique-inconnue.fr/a", "Chanel Timeless sac"),
  ];

  it("refusé : vestiairecollective + vinted + amazon + une boutique inconnue nommant « Chanel »", () => {
    expect(houseOf(doubtful)).toBeUndefined();
  });

  it("permis : les mêmes, plus deux boutiques connues", () => {
    expect(houseOf([...doubtful, offer("https://www.farfetch.com/a", "Chanel Timeless"), offer("https://www.24s.com/a", "Sac Chanel")])).toBe("Chanel");
  });
});

describe("mots entiers", () => {
  it("refusé : le nom dans un mot plus long (« Diorissimo-like », « Pradaesque »), ou au pluriel", () => {
    expect(houseOf([offer("https://www.farfetch.com/a", "Sac Diorissimo-like"), offer("https://www.24s.com/a", "Diorissimo style")])).toBeUndefined();
    expect(houseOf([offer("https://www.farfetch.com/a", "Veste Pradaesque"), offer("https://www.24s.com/a", "Pradaesque veste")])).toBeUndefined();
    expect(houseOf([offer("https://www.farfetch.com/a", "Les Diors de l'été"), offer("https://www.24s.com/a", "Diors")])).toBeUndefined();
    // Un seul mot d'un nom en deux mots ne suffit pas.
    expect(houseOf([offer("https://www.farfetch.com/a", "Veste Stone grise"), offer("https://www.24s.com/a", "Island veste")])).toBeUndefined();
  });

  it("permis : « Saint-Laurent » pour « Saint Laurent », « HERMES » pour « Hermès », un autre nom exact (« YSL »)", () => {
    expect(houseOf([offer("https://www.farfetch.com/a", "Saint-Laurent sac Le 5 à 7"), offer("https://www.24s.com/a", "YSL Le 5 à 7")])).toBe("Saint Laurent");
    expect(houseOf([offer("https://www.farfetch.com/a", "HERMES ceinture"), offer("https://www.24s.com/a", "Ceinture Hermès H")])).toBe("Hermès");
  });
});

describe("offres signalées et retirées", () => {
  // Trois prix ordinaires dans la même devise : un prix sous le tiers de leur médiane est « inhabituellement bas ».
  const priced = () => [offer("https://a.exemple.fr/1", "Sac"), offer("https://b.exemple.fr/2", "Sac"), offer("https://c.exemple.fr/3", "Sac")];

  it("refusé : une source signalée — fendi.com (pas une boutique connue) à un prix très bas, rangée en fin de « shopping » ou marquée dans la recherche visuelle", () => {
    const demoted = productSearch([...priced(), shopping("https://www.fendi.com/a", "Baguette", { price_min: 10, price_max: 10 }), offer("https://www.farfetch.com/a", "Fendi Baguette")]);
    expect(demoted.matches.find((m) => m.merchantUrl === "https://www.fendi.com/a")?.demoted).toBe(true);
    expect(demoted.luxuryResale).toBeUndefined();
    const marked = productSearch([...priced(), offer("https://www.fendi.com/a", "Baguette", { price_min: 10, price_max: 10 }), offer("https://www.farfetch.com/a", "Fendi Baguette")]);
    expect(marked.matches.find((m) => m.merchantUrl === "https://www.fendi.com/a")?.offerMark).toBe("unusual_price");
    expect(marked.luxuryResale).toBeUndefined();
  });

  it("refusé : une source retirée (boutique masquée par un mot évident de son adresse)", () => {
    expect(houseOf([offer("https://www.dior.com/a", "Sac Saddle"), offer("https://replica.farfetch.com/a", "Dior Saddle")])).toBeUndefined();
  });

  it("permis : la même source, non signalée", () => {
    expect(houseOf([...priced(), shopping("https://www.fendi.com/a", "Baguette"), offer("https://www.farfetch.com/a", "Fendi Baguette")])).toBe("Fendi");
    expect(houseOf([offer("https://www.dior.com/a", "Sac Saddle"), offer("https://www.farfetch.com/a", "Dior Saddle")])).toBe("Dior");
  });
});

describe("origine des propositions", () => {
  it("refusé : deux sources venues de « Résultats pour vos mots » (elles répètent les mots tapés)", () => {
    expect(houseOf([offer("https://lens.exemple.fr/a", "Veste"), words("https://www.farfetch.com/a", "Prada veste"), words("https://www.24s.com/a", "Veste Prada")])).toBeUndefined();
  });

  it("permis : une source « lens » + une source « shopping »", () => {
    expect(houseOf([offer("https://www.farfetch.com/a", "Prada veste"), shopping("https://www.24s.com/a", "Veste Prada")])).toBe("Prada");
  });
});

describe("(B) la boutique de la marque de la pièce, vérifiée (brand_shop, 0054)", () => {
  it("permis : brand_shop sur dior.com dans « shopping », seule", () => {
    expect(houseOf([offer("https://lens.exemple.fr/a", "Sac"), shopping("https://www.dior.com/a", "Sac Saddle", { brand_shop: true })])).toBe("Dior");
  });

  it("refusé : brand_shop sur une adresse qui n'est pas celle de la maison, brand_shop absent (base sans 0054), ou hors de « shopping »", () => {
    expect(houseOf([shopping("https://www.zara.com/a", "Sac Dior style", { brand_shop: true })])).toBeUndefined();
    expect(houseOf([shopping("https://www.dior.com/a", "Sac Saddle")])).toBeUndefined();
    expect(houseOf([offer("https://www.dior.com/a", "Sac Saddle", { brand_shop: true })])).toBeUndefined();
  });
});

describe("une seule maison", () => {
  it("refusé : Dior et Gucci retenues ensemble — rien", () => {
    expect(
      houseOf([offer("https://www.dior.com/a", "Sac Saddle"), offer("https://www.farfetch.com/a", "Dior Saddle"), offer("https://www.gucci.com/a", "Sac Jackie"), offer("https://www.24s.com/a", "Gucci Jackie")])
    ).toBeUndefined();
    // Un titre qui nomme deux maisons (une collaboration) les fait compter toutes les deux.
    expect(houseOf([offer("https://www.farfetch.com/a", "Gucci x Balenciaga sac Hacker"), offer("https://www.24s.com/a", "Sac Hacker Gucci Balenciaga")])).toBeUndefined();
  });

  it("permis : Dior seule (Gucci n'a qu'une source)", () => {
    expect(houseOf([offer("https://www.dior.com/a", "Sac Saddle"), offer("https://www.farfetch.com/a", "Dior Saddle"), offer("https://www.24s.com/a", "Gucci Jackie")])).toBe("Dior");
  });
});

describe("état de la recherche et liste des sites", () => {
  const retained = () => [offer("https://www.dior.com/a", "Sac Saddle"), offer("https://www.farfetch.com/a", "Dior Saddle")];

  it("refusé : recherche non terminée ou en échec, aucune proposition, liste de sites vide, aucun site valable", () => {
    expect(resaleOf(retained(), { status: "processing" })).toBeUndefined();
    expect(resaleOf(retained(), { status: "failed" })).toBeUndefined();
    expect(resaleOf([])).toBeUndefined();
    const row = parseSearchRow(SEARCH)!;
    const shown = parseMatchRows(retained())!.map((match) => ({ match, mark: null, demoted: false }));
    expect(luxuryResaleOf(row, shown, MAISONS_DE_LUXE, [])).toBeUndefined();
    expect(luxuryResaleOf(row, shown, MAISONS_DE_LUXE, [{ nom: "Mauvais", recherche: "http://revente.exemple.com/?q={mots}" }])).toBeUndefined();
  });

  it("permis : terminée, une maison retenue — les sites de la liste du fondateur", () => {
    const resale = resaleOf(retained())!;
    expect(resale).toEqual({ house: "Dior", words: "Dior Sac Saddle", sites: [{ name: "Vestiaire Collective", url: "https://fr.vestiairecollective.com/search/?q=Dior%20Sac%20Saddle" }] });
  });

  it("refusé : sans l'option (historique, autres chemins), jamais de champ", () => {
    expect("luxuryResale" in productSearch(retained(), {}, false)).toBe(false);
  });
});

describe("les mots de la recherche", () => {
  const dior = MAISONS_DE_LUXE.find((house) => house.nom === "Dior")!;
  const shownWith = (prices: number[]) => parseMatchRows(prices.map((price) => offer("https://a.exemple.fr/1", "x", { price_min: price, price_max: price })))!.map((match) => ({ match, mark: null, demoted: false }));

  it("l'exemple de la fiche : 8 mots, sans petits mots", () => {
    expect(searchWordsOf("Sac Lady Dior moyen modèle en cuir d'agneau Cannage noir", dior, [])).toBe("Sac Lady Dior moyen modèle cuir d'agneau Cannage");
  });

  it("sans référence de 5 chiffres ou plus, sans signes ; le nom de la maison ajouté en tête s'il manque", () => {
    // « M0446CBAA » n'a que 4 chiffres à la suite : il reste ; « 1234567 » est une référence.
    expect(searchWordsOf("Sac Saddle M0446CBAA / ref. 1234567 (noir)", dior, [])).toBe("Dior Sac Saddle M0446CBAA ref noir");
    expect(searchWordsOf("Sac Saddle", dior, [])).toBe("Dior Sac Saddle");
    expect(searchWordsOf("Christian Dior sac Saddle", dior, [])).toBe("Christian Dior sac Saddle");
  });

  it("jamais un prix : la devise et les nombres qui la touchent, et tout nombre égal au prix d'une offre montrée", () => {
    expect(searchWordsOf("Sac Dior Saddle 3 500,00 € noir", dior, [])).toBe("Sac Dior Saddle noir");
    expect(searchWordsOf("Sac Dior Saddle €3500 noir", dior, [])).toBe("Sac Dior Saddle noir");
    expect(searchWordsOf("Sac Dior Saddle 3500 EUR", dior, [])).toBe("Sac Dior Saddle");
    expect(searchWordsOf("Sac Dior Saddle 3500", dior, shownWith([3500]))).toBe("Sac Dior Saddle");
    // Un nombre de modèle qui n'est pas un prix reste (« Dior 30 Montaigne »).
    expect(searchWordsOf("Sac Dior 30 Montaigne", dior, shownWith([3500]))).toBe("Sac Dior 30 Montaigne");
    // Un nombre collé à un code de devise.
    expect(searchWordsOf("Dior B23 sneaker 1250EUR noir", dior, [])).toBe("Dior B23 sneaker noir");
    expect(searchWordsOf("Dior CHF1250", dior, [])).toBe("Dior");
    expect(searchWordsOf("Dior Saddle 1.250,00EUR, 3 500 euros", dior, [])).toBe("Dior Saddle");
    // Permis : un code de modèle qui n'est pas un prix (« B23 », « EUR » dans un mot) reste.
    expect(searchWordsOf("Dior B23 Europa", dior, [])).toBe("Dior B23 Europa");
  });

  it("jamais le nom d'une boutique connue montrée", () => {
    const shown = parseMatchRows([offer("https://www.farfetch.com/a", "x")])!.map((match) => ({ match, mark: null, demoted: false }));
    expect(searchWordsOf("Dior Saddle - Farfetch", dior, shown)).toBe("Dior Saddle");
  });

  it("jamais le nom d'une boutique en plusieurs mots ou avec des tirets (« NET-A-PORTER », « MR PORTER », « Galeries Lafayette », « THE OUTNET »)", () => {
    const shownAt = (url: string) => parseMatchRows([offer(url, "x")])!.map((match) => ({ match, mark: null, demoted: false }));
    expect(searchWordsOf("Saddle leather shoulder bag | DIOR | NET-A-PORTER", dior, shownAt("https://www.net-a-porter.com/a"))).toBe("Saddle leather shoulder bag DIOR");
    expect(searchWordsOf("B23 sneakers | Dior | MR PORTER", dior, shownAt("https://www.mrporter.com/a"))).toBe("B23 sneakers Dior");
    expect(searchWordsOf("Sac Lady Dior - Dior | Galeries Lafayette", dior, shownAt("https://www.galerieslafayette.com/a"))).toBe("Sac Lady Dior Dior");
    expect(searchWordsOf("Dior Saddle | THE OUTNET", dior, shownAt("https://www.theoutnet.com/a"))).toBe("Dior Saddle");
  });

  it("permis : les mêmes mots restent quand la boutique n'est pas montrée (« Porter » n'est pas une boutique à lui seul)", () => {
    expect(searchWordsOf("Dior Saddle Porter strap", dior, parseMatchRows([offer("https://www.mrporter.com/a", "x")])!.map((match) => ({ match, mark: null, demoted: false })))).toBe("Dior Saddle Porter strap");
    expect(searchWordsOf("Dior Saddle | MR PORTER", dior, [])).toBe("Dior Saddle MR PORTER");
  });

  it("de bout en bout : net-a-porter + mytheresa — le nom de la boutique n'est ni dans les mots ni dans l'adresse", () => {
    const resale = resaleOf([offer("https://www.net-a-porter.com/a", "Saddle leather shoulder bag | DIOR | NET-A-PORTER"), offer("https://www.mytheresa.com/b", "Dior Saddle bag")]);
    expect(resale?.words).toBe("Saddle leather shoulder bag DIOR");
    for (const site of resale!.sites) expect(site.url.toLowerCase()).not.toMatch(/porter/);
  });

  it("80 caractères au plus, coupés sur une fin de mot", () => {
    const long = "Dior Abcdefghijklmnop Bcdefghijklmnopq Cdefghijklmnopqr Defghijklmnopqrs Efghijklmnopqrst Fghijk";
    const result = searchWordsOf(long, dior, []);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(result)).toBe(true);
    expect(long.charAt(result.length)).toBe(" ");
  });

  it("encodage : « & », « ' », accents, espaces — l'adresse est celle de la liste, les mots encodés à leur place", () => {
    expect(encodeWords("Hermès Kelly d'agneau & or (28)")).toBe("Herm%C3%A8s%20Kelly%20d%27agneau%20%26%20or%20%2828%29");
    expect(searchUrlOf("https://fr.vestiairecollective.com/search/?q={mots}", "Hermès d'agneau & or")).toBe(
      "https://fr.vestiairecollective.com/search/?q=Herm%C3%A8s%20d%27agneau%20%26%20or"
    );
  });

  it("refusé : des mots qui voudraient changer d'hôte ou de chemin restent dans la recherche, encodés ; une adresse de liste non https, sans {mots} ou avec deux", () => {
    const url = searchUrlOf("https://fr.vestiairecollective.com/search/?q={mots}", "x@evil.example/../#?a=b")!;
    expect(new URL(url).host).toBe("fr.vestiairecollective.com");
    expect(new URL(url).pathname).toBe("/search/");
    expect(new URL(url).searchParams.get("q")).toBe("x@evil.example/../#?a=b");
    expect(searchUrlOf("https://{mots}.exemple.com/?q=x", "evil.example")).toBeNull();
    expect(searchUrlOf("http://revente.exemple.com/?q={mots}", "Dior")).toBeNull();
    expect(searchUrlOf("https://revente.exemple.com/", "Dior")).toBeNull();
    expect(searchUrlOf("https://revente.exemple.com/{mots}?q={mots}", "Dior")).toBeNull();
    expect(searchUrlOf("https://revente.exemple.com/?q={mots}", "  ")).toBeNull();
  });

  it("refusé : jamais les mots du membre (query), ni un identifiant, ni un prix ; aucun montant nulle part dans le champ", () => {
    const resale = resaleOf([offer("https://www.dior.com/a", "Sac Saddle 2900 € noir"), offer("https://www.farfetch.com/a", "Dior Saddle", { price_min: 3100, price_max: 3100 })])!;
    expect(resale.words).toBe("Dior Sac Saddle noir");
    const field = JSON.stringify(resale);
    expect(field).not.toMatch(/zéphyrine|z%C3%A9phyrine|tante/i);
    expect(field).not.toMatch(/recherche-luxe|membre-luxe|"p\d+"/);
    expect(field).not.toMatch(/2900|3100|2\s?900|3\s?100|€|EUR/);
  });
});

describe("ordre des sites et liste du fondateur", () => {
  it("permis : les sites sont rangés par ordre alphabétique de leur nom, quelle que soit leur place dans le fichier", () => {
    const sites: SiteDeRevente[] = [
      { nom: "Zèbre Revente", recherche: "https://zebre.exemple.com/?q={mots}" },
      { nom: "Atelier Occasion", recherche: "https://atelier.exemple.com/s/{mots}" },
      { nom: "Élan Seconde Main", recherche: "https://elan.exemple.com/?k={mots}" },
    ];
    expect(resaleSitesFor("Dior Saddle", sites).map((site) => site.name)).toEqual(["Atelier Occasion", "Élan Seconde Main", "Zèbre Revente"]);
  });

  it("refusé : un site invalide est retiré, les autres restent ; jamais plus de 5", () => {
    const sites: SiteDeRevente[] = [
      { nom: "Bon", recherche: "https://bon.exemple.com/?q={mots}" },
      { nom: "Mauvais", recherche: "http://mauvais.exemple.com/?q={mots}" },
      { nom: "", recherche: "https://vide.exemple.com/?q={mots}" },
    ];
    expect(resaleSitesFor("Dior", sites)).toEqual([{ name: "Bon", url: "https://bon.exemple.com/?q=Dior" }]);
    const many = [1, 2, 3, 4, 5, 6].map((index) => ({ nom: `Site ${index}`, recherche: `https://s${index}.exemple.com/?q={mots}` }));
    expect(resaleSitesFor("Dior", many)).toHaveLength(5);
  });

  it("l'adresse ouverte est exactement celle du fichier, en https, sur l'hôte écrit dans le fichier seulement", () => {
    const [site] = resaleSitesFor("Dior Saddle");
    expect(site).toEqual({ name: SITES_DE_REVENTE[0]!.nom, url: SITES_DE_REVENTE[0]!.recherche.replace("{mots}", "Dior%20Saddle") });
    expect(new URL(site!.url).protocol).toBe("https:");
    expect(new URL(site!.url).host).toBe(new URL(SITES_DE_REVENTE[0]!.recherche.replace("{mots}", "")).host);
  });
});

describe("aucun appel, rien d'enregistré, rien de déplacé", () => {
  afterEach(() => vi.restoreAllMocks());

  it("aucune requête ne part du serveur : ni fetch pendant le calcul, ni réseau, base ou journal dans le module", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(houseOf([offer("https://www.dior.com/a", "Sac Saddle"), offer("https://www.farfetch.com/a", "Dior Saddle")])).toBe("Dior");
    expect(fetchSpy).not.toHaveBeenCalled();
    const source = readFileSync(join(__dirname, "../src/lib/luxuryResale.ts"), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/fetch\(|undici|node:http|axios|supabase|\.log\.|console\./);
    expect(code.match(/^import .*$/gm)!.every((line) => /from "(\.\/|\.\.\/listes\/|@monapp\/shared-types)/.test(line))).toBe(true);
  });

  it("refusé : le champ ne change ni l'ordre, ni les mentions, ni le reste de la réponse ; permis : il s'ajoute seul", () => {
    const matches = [
      offer("https://lens.exemple.fr/a", "Sac noir"),
      offer("https://www.dior.com/a", "Sac Saddle"),
      shopping("https://boutique-x.fr/1", "Sac"),
      shopping("https://www.farfetch.com/a", "Dior Saddle"),
      words("https://www.24s.com/a", "Dior"),
    ];
    const withField = productSearch(matches, {}, true);
    const without = productSearch(matches, {}, false);
    expect(withField.luxuryResale?.house).toBe("Dior");
    const { luxuryResale: _field, ...rest } = withField;
    expect(rest).toEqual(without);
  });
});
