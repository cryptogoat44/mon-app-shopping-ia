import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_CURRENCY_MARKS, alertCurrency, COUNTRY_CURRENCIES, isCountryCurrency } from "@monapp/shared-types";
import { isLocalCurrency } from "../src/services/lensMeasure.js";
import { ALERT_EXCLUDED_MARKETPLACES, ALERT_KEY_VERSION, alertKeyHash, alertKeyString, isMarketplaceMerchant, merchantKey, trackingKeyOf } from "../src/lib/alertKeys.js";
import { TRACKING_PARAMS } from "../src/services/matchFilters.js";

// Alertes prix et stock (lot 2 ; nouvelle version, 0041) : l'empreinte
// « même pièce » (le SHA-256 du lien normalisé de la boutique, jamais le
// titre ni l'image) et la devise des prix, sans réseau ni base. Boutiques et
// produits fictifs.

const GOOGLE = "https://www.google.fr/search?ibp=oshop&q=veste+exemple&prds=catalogid:111,headlineOfferDocid:222,productid:4455667788,pvt:hg";

describe("empreinte « même pièce » : le lien normalisé de la boutique (0041)", () => {
  it("version 2 des empreintes : le script de rattrapage les recalcule", () => {
    expect(ALERT_KEY_VERSION).toBe(2);
  });

  it("https imposé, hôte en minuscules sans « www. », sans fragment ni « / » final, chemin tel quel", () => {
    const base = alertKeyString("https://boutique-exemple.fr/Vestes/Nuage-07", "Boutique Exemple");
    expect(base).toBe("https://boutique-exemple.fr/Vestes/Nuage-07");
    for (const variant of [
      "http://boutique-exemple.fr/Vestes/Nuage-07",
      "https://WWW.Boutique-Exemple.fr/Vestes/Nuage-07",
      "http://www.boutique-exemple.fr/Vestes/Nuage-07/",
      "https://boutique-exemple.fr/Vestes/Nuage-07#avis",
      "https://boutique-exemple.fr/Vestes/Nuage-07//",
    ]) {
      expect(alertKeyString(variant, "Boutique Exemple"), variant).toBe(base);
      expect(trackingKeyOf(variant, "Boutique Exemple")!.hash, variant).toBe(trackingKeyOf(base, "Boutique Exemple")!.hash);
    }
    // m., fr. et www2. gardés : ce peuvent être d'autres sites ; un seul « www. » retiré.
    expect(alertKeyString("https://www2.boutique.example/p/1", null)).toBe("https://www2.boutique.example/p/1");
    expect(alertKeyString("https://m.boutique.example/p/1", null)).toBe("https://m.boutique.example/p/1");
    expect(alertKeyString("https://www.www.boutique.example/p/1", null)).toBe("https://www.boutique.example/p/1");
    // La casse du chemin compte.
    expect(alertKeyString("https://boutique.example/P/1", null)).not.toBe(alertKeyString("https://boutique.example/p/1", null));
  });

  it("paramètres de suivi retirés (utm_… et TOUTE la liste TRACKING_PARAMS), les autres gardés (valeurs vides comprises), triés par nom puis valeur", () => {
    const plain = alertKeyString("https://boutique.example/veste?couleur=bleu&taille=M", null);
    expect(plain).toBe("https://boutique.example/veste?couleur=bleu&taille=M");
    // Avec et sans paramètres de suivi, dans un autre ordre : la même pièce.
    const tracked = alertKeyString("http://www.boutique.example/veste/?utm_source=google&taille=M&gclid=abc&couleur=bleu&srsltid=x&UTM_Medium=cpc#haut", null);
    expect(tracked).toBe(plain);
    expect(alertKeyString("https://boutique.example/veste?taille=M&couleur=bleu", null)).toBe(plain);
    // Une autre couleur : une autre pièce.
    expect(alertKeyString("https://boutique.example/veste?couleur=rouge&taille=M", null)).not.toBe(plain);
    // Un paramètre inconnu (ref, cid, variant) compte toujours : le garder ne coûte qu'une alerte manquée.
    expect(alertKeyString("https://boutique.example/veste?ref=abc", null)).toBe("https://boutique.example/veste?ref=abc");
    expect(alertKeyString("https://boutique.example/veste?variant=", null)).toBe("https://boutique.example/veste?variant=");
    expect(alertKeyString("https://boutique.example/veste?a=2&a=1&b=", null)).toBe("https://boutique.example/veste?a=1&a=2&b=");
    // La liste fermée des paramètres de suivi est celle des filtres des résultats, en entier.
    expect([...TRACKING_PARAMS].length).toBeGreaterThanOrEqual(15);
    for (const name of TRACKING_PARAMS) {
      expect(alertKeyString(`https://boutique.example/veste?${name}=1`, null), name).toBe("https://boutique.example/veste");
      expect(alertKeyString(`https://boutique.example/veste?${name.toUpperCase()}=1&taille=M`, null), name).toBe("https://boutique.example/veste?taille=M");
    }
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"]) {
      expect(alertKeyString(`https://boutique.example/veste?${name}=x`, null), name).toBe("https://boutique.example/veste");
    }
  });

  it("l'empreinte est le SHA-256 du lien normalisé (rien d'autre : ni version, ni nom de boutique)", () => {
    const key = trackingKeyOf("http://www.boutique.example/veste/?taille=M&utm_source=x", "Boutique Exemple")!;
    expect(key.hash).toBe(alertKeyHash("https://boutique.example/veste?taille=M"));
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("semblable mais différente : un autre chemin chez la même boutique n'a pas la même clé", () => {
    expect(alertKeyString("https://boutique.example/veste-nuage-07", "Boutique")).not.toBe(alertKeyString("https://boutique.example/veste-nuage-08", "Boutique"));
  });

  it("autre boutique : le même produit ailleurs n'a pas la même clé", () => {
    expect(alertKeyString("https://boutique-a.example/veste-nuage-07", null)).not.toBe(alertKeyString("https://boutique-b.example/veste-nuage-07", null));
  });

  it("places de marché exclues (toutes extensions), comme les liens de redirection et les pages de liste", () => {
    expect(ALERT_EXCLUDED_MARKETPLACES).toEqual(["amazon", "farfetch", "etsy", "temu", "dhgate", "ebay", "vinted"]);
    for (const link of [
      "https://www.amazon.fr/dp/B000123",
      "https://www.amazon.com.be/dp/B000123",
      "https://www.farfetch.com/fr/shopping/women/item-1.aspx",
      "https://www.etsy.com/listing/123/veste?ref=hp",
      "https://www.temu.com/veste-g-601.html",
      "https://fr.dhgate.com/product/veste/123.html",
      "https://www.ebay.co.uk/itm/123",
      "https://www.vinted.fr/items/123-veste",
      // Redirections et liens d'affiliation.
      "https://bit.ly/abc",
      "https://click.linksynergy.com/deeplink?id=1",
      "https://boutique.example/go?url=https%3A%2F%2Fautre.example%2Fp%2F1",
      // Pages de liste ou de recherche, et page d'accueil.
      "https://boutique.example/search?q=veste",
      "https://boutique.example/recherche/veste",
      "https://boutique.example/vestes?q=nuage",
      "https://boutique.example/",
      // Écartées par les filtres des résultats (réseaux sociaux, pages sans vente).
      "https://www.instagram.com/p/abc",
      "https://www.reddit.com/r/mode/1",
      // Pas une adresse web ordinaire.
      "javascript:alert(1)",
      "https://nom:motdepasse@boutique.example/p/1",
      "pas une adresse",
    ]) {
      expect(alertKeyString(link, "Boutique"), link).toBeNull();
    }
  });
});

describe("clé « même pièce » : places de marché, liens courts et pages de liste (décision 4)", () => {
  it("une offre d'une place de marché n'a jamais d'empreinte, quel que soit le lien, même avec un nom de vendeur", () => {
    const google = "https://www.google.fr/shopping/product/1?prds=productid:4455667788";
    for (const source of ["eBay", "eBay - vendeurx", "Amazon.fr", "Amazon Marketplace", "Vinted", "Etsy", "Farfetch", "Temu", "DHgate"]) {
      expect(alertKeyString(google, source), source).toBeNull();
      expect(alertKeyString(GOOGLE, source), source).toBeNull();
      // Même sur le lien d'une autre boutique : dans le doute, pas de clé.
      expect(alertKeyString("https://boutique.example/p/1", source), source).toBeNull();
    }
    expect(isMarketplaceMerchant("ebayvendeurx")).toBe(true);
    expect(isMarketplaceMerchant("amazonfrseller")).toBe(true);
    expect(isMarketplaceMerchant("boutiqueexemple")).toBe(false);
    expect(isMarketplaceMerchant(null)).toBe(false);
  });

  it("liens courts d'Amazon (amzn.to, amzn.eu, amzn.asia, amzn.com, a.co) et des autres places de marché : aucune clé", () => {
    for (const link of ["https://amzn.to/3abcd", "https://amzn.eu/d/abc123", "https://amzn.asia/d/xyz", "https://amzn.com/B000123", "https://a.co/d/xyz", "https://ebay.us/abc", "https://etsy.me/abc"]) {
      expect(alertKeyString(link, "Boutique"), link).toBeNull();
    }
  });

  it("pages de catégorie ou de collection (sans segment de produit), pagination ou tri : aucune clé ; un produit rangé dans une collection garde la sienne", () => {
    for (const link of [
      "https://boutique.example/collections/vestes",
      "https://boutique.example/collections/all",
      "https://boutique.example/category/vestes",
      "https://boutique.example/femme/categories/vestes",
      "https://boutique.example/fr/c/robes-123",
      "https://boutique.example/catalogue/vestes",
      "https://boutique.example/vestes?page=2",
      "https://boutique.example/vestes?sort=price",
    ]) {
      expect(alertKeyString(link, "Boutique"), link).toBeNull();
    }
    expect(alertKeyString("https://boutique.example/collections/vestes/products/veste-nuage", "Boutique")).toBe("https://boutique.example/collections/vestes/products/veste-nuage");
    expect(alertKeyString("https://boutique.example/c/robes/p/123", "Boutique")).toBe("https://boutique.example/c/robes/p/123");
    // Une page de produit à un seul segment garde son empreinte (la reconnaître comme liste écarterait de vraies pièces).
    expect(alertKeyString("https://boutique.example/veste-nuage-07", "Boutique")).toBe("https://boutique.example/veste-nuage-07");
  });
});

describe("un résultat sans lien direct vers la boutique (page de Google seulement) : aucune empreinte, jamais d'alerte", () => {
  it("page de Google, même avec un productid et une vraie boutique : aucune empreinte (l'ancienne clé « google » n'existe plus)", () => {
    for (const link of [
      GOOGLE,
      "https://www.google.fr/shopping/product/1?prds=productid:4455667788",
      "https://www.google.com/search?ibp=oshop&q=veste",
      "https://www.google.fr/shopping/product/4455667788",
      "http://google.fr/search?prds=productid:1",
    ]) {
      expect(alertKeyString(link, "Boutique Exemple"), link).toBeNull();
      expect(trackingKeyOf(link, "Boutique Exemple"), link).toBeNull();
    }
  });
});

describe("empreinte et boutique normalisée", () => {
  it("la base ne garde que l'empreinte SHA-256 du lien, jamais l'adresse, et la boutique normalisée à part", () => {
    const key = trackingKeyOf("https://boutique.example/veste?taille=M", "Boutique Exemple")!;
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toEqual({ hash: alertKeyHash("https://boutique.example/veste?taille=M"), merchant: "boutiqueexemple" });
    expect(trackingKeyOf(GOOGLE, "Boutique")).toBeNull();
    expect(trackingKeyOf("https://www.amazon.fr/dp/1", "Amazon")).toBeNull();
  });

  it("nom de boutique : minuscules, sans accents ni ponctuation, sans l'extension d'un nom de domaine", () => {
    expect(merchantKey("Zalando")).toBe("zalando");
    expect(merchantKey("zalando.fr")).toBe("zalando");
    expect(merchantKey("www.Zalando.co.uk")).toBe("zalando");
    expect(merchantKey("H&M")).toBe("hm");
    expect(merchantKey("Galeries Lafayette")).toBe("galerieslafayette");
    expect(merchantKey("Éléonore Boutique")).toBe("eleonoreboutique");
    expect(merchantKey("   ")).toBeNull();
    expect(merchantKey("–")).toBeNull();
    expect(merchantKey(null)).toBeNull();
  });
});

describe("devise des alertes (alertCurrency, packages/shared-types)", () => {
  it("table fermée : symboles et écritures de Google vers le code ISO", () => {
    expect(ALERT_CURRENCY_MARKS).toEqual({ "€": "EUR", "£": "GBP", US$: "USD", $US: "USD", $CA: "CAD", CA$: "CAD", $AU: "AUD", $MX: "MXN" });
    expect(["€", "£", "US$", "$US", "$CA", "CA$", "$AU", "$MX"].map((mark) => alertCurrency(mark, "fr"))).toEqual(["EUR", "GBP", "USD", "USD", "CAD", "CAD", "AUD", "MXN"]);
  });

  it("« $ » seul : dollar américain seulement pour une recherche aux États-Unis", () => {
    expect(alertCurrency("$", "us")).toBe("USD");
    expect(alertCurrency("$", "ca")).toBeNull();
    expect(alertCurrency("$", "fr")).toBeNull();
    expect(alertCurrency("$", null)).toBeNull();
  });

  it("UNE seule table pour toute l'app : Lens, Google Shopping, le tri et « Boutique à l'étranger » la lisent (aucune copie qui pourrait diverger)", () => {
    expect(COUNTRY_CURRENCIES).toEqual({ fr: "EUR", gb: "GBP", ch: "CHF", us: "USD" });
    const marks = [...Object.keys(ALERT_CURRENCY_MARKS), "$", "EUR", "USD", "GBP", "CHF", "CAD", "¥", "euros", "€  ", null];
    for (const country of ["fr", "us", "gb", "ch", "de"]) {
      for (const mark of marks) expect(isLocalCurrency(mark, country), `${mark} ${country}`).toBe(isCountryCurrency(mark, country));
    }
    expect(isCountryCurrency("€", "fr")).toBe(true);
    expect(isCountryCurrency("$", "us")).toBe(true);
    expect(isCountryCurrency("$", "fr")).toBe(false);
    expect(isCountryCurrency("€", "de")).toBeNull();
    // Plus aucune table d'écritures de devise dans ces quatre fichiers.
    for (const file of ["src/services/lensMeasure.ts", "src/services/textSearch.ts", "../mobile/src/lib/result-sort.ts", "../mobile/src/lib/foreign-shop.ts"]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      expect(source, file).not.toMatch(/["']€["']|["']£["']|US\$|\$US/);
    }
  });

  it("code ISO : lui-même ; espaces d'une colonne char(3) retirées ; toute autre écriture : aucune comparaison", () => {
    expect(alertCurrency("EUR", "fr")).toBe("EUR");
    expect(alertCurrency("MAD", "fr")).toBe("MAD");
    expect(alertCurrency("€  ", "fr")).toBe("EUR");
    expect(alertCurrency("$  ", "us")).toBe("USD");
    expect(alertCurrency("eur", "fr")).toBeNull();
    expect(alertCurrency("euros", "fr")).toBeNull();
    expect(alertCurrency("¥", "fr")).toBeNull();
    expect(alertCurrency("", "fr")).toBeNull();
    expect(alertCurrency(null, "fr")).toBeNull();
  });
});
