import { describe, expect, it } from "vitest";
import { ALERT_CURRENCY_MARKS, alertCurrency } from "@monapp/shared-types";
import { ALERT_EXCLUDED_MARKETPLACES, ALERT_KEY_VERSION, alertKeyHash, alertKeyString, googleProductId, merchantKey, trackingKeyOf } from "../src/lib/alertKeys.js";
import { TRACKING_PARAMS } from "../src/services/matchFilters.js";

// Alertes prix et stock (lot 2) : la clé « même pièce » (même boutique ET même
// produit, jamais le titre ni l'image) et la devise des prix, sans réseau ni
// base. Boutiques et produits fictifs.

const GOOGLE = "https://www.google.fr/search?ibp=oshop&q=veste+exemple&prds=catalogid:111,headlineOfferDocid:222,productid:4455667788,pvt:hg";

describe("clé « même pièce » : lien d'une boutique", () => {
  it("règles de pageKey : hôte en minuscules, un seul « www. » retiré, chemin tel quel, sans fragment ni « / » final", () => {
    expect(alertKeyString("https://WWW.Boutique-Exemple.fr/Vestes/Nuage-07/#avis", "Boutique Exemple")).toBe(`v${ALERT_KEY_VERSION}|u|boutique-exemple.fr/Vestes/Nuage-07`);
    // m., fr. et www2. gardés : ce peuvent être d'autres sites.
    expect(alertKeyString("https://www2.boutique.example/p/1", null)).toBe("v1|u|www2.boutique.example/p/1");
    expect(alertKeyString("https://m.boutique.example/p/1", null)).toBe("v1|u|m.boutique.example/p/1");
    expect(alertKeyString("https://www.www.boutique.example/p/1", null)).toBe("v1|u|www.boutique.example/p/1");
    // La casse du chemin compte.
    expect(alertKeyString("https://boutique.example/P/1", null)).not.toBe(alertKeyString("https://boutique.example/p/1", null));
  });

  it("paramètres de suivi retirés, paramètres de variante gardés (valeurs vides comprises), triés par nom puis valeur", () => {
    const plain = alertKeyString("https://boutique.example/veste?couleur=bleu&taille=M", null);
    const tracked = alertKeyString("https://boutique.example/veste?utm_source=google&taille=M&gclid=abc&couleur=bleu&srsltid=x&UTM_Medium=cpc", null);
    expect(tracked).toBe(plain);
    expect(plain).toBe("v1|u|boutique.example/veste?couleur=bleu&taille=M");
    // Une autre couleur : une autre pièce.
    expect(alertKeyString("https://boutique.example/veste?couleur=rouge&taille=M", null)).not.toBe(plain);
    // Un paramètre inconnu (ref, cid, variant) compte toujours : le garder ne coûte qu'une alerte manquée.
    expect(alertKeyString("https://boutique.example/veste?ref=abc", null)).toBe("v1|u|boutique.example/veste?ref=abc");
    expect(alertKeyString("https://boutique.example/veste?variant=", null)).toBe("v1|u|boutique.example/veste?variant=");
    expect(alertKeyString("https://boutique.example/veste?a=2&a=1&b=", null)).toBe("v1|u|boutique.example/veste?a=1&a=2&b=");
    // La liste fermée des paramètres de suivi est celle des filtres des résultats.
    for (const name of TRACKING_PARAMS) expect(alertKeyString(`https://boutique.example/veste?${name}=1`, null)).toBe("v1|u|boutique.example/veste");
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

describe("clé « même pièce » : page de Google", () => {
  it("le productid lu strictement dans « prds », avec la boutique normalisée", () => {
    expect(googleProductId(GOOGLE)).toBe("4455667788");
    expect(alertKeyString(GOOGLE, "Boutique Exemple")).toBe("v1|g|google.fr|4455667788|boutiqueexemple");
    // Jamais les mots de la recherche dans la clé.
    expect(alertKeyString(GOOGLE, "Boutique Exemple")).not.toContain("veste");
  });

  it("lien Google sans productid : aucune clé (jamais de clé « lien » sur une page de Google)", () => {
    expect(alertKeyString("https://www.google.fr/search?ibp=oshop&q=veste", "Boutique")).toBeNull();
    expect(alertKeyString("https://www.google.fr/shopping/product/4455667788", "Boutique")).toBeNull();
    expect(alertKeyString("https://www.google.fr/search?prds=productid:12a34", "Boutique")).toBeNull();
    expect(alertKeyString("https://www.google.fr/search?prds=productid:1,productid:2", "Boutique")).toBeNull();
    expect(googleProductId("https://www.google.fr/search?prds=pid:123")).toBeNull();
  });

  it("sans boutique, aucune clé ; même productid chez une autre boutique : autre clé", () => {
    expect(alertKeyString(GOOGLE, null)).toBeNull();
    expect(alertKeyString(GOOGLE, "Boutique A")).not.toBe(alertKeyString(GOOGLE, "Boutique B"));
    // Autre domaine de Google (autre pays) : autre clé.
    expect(alertKeyString(GOOGLE.replace("google.fr", "google.com"), "Boutique A")).not.toBe(alertKeyString(GOOGLE, "Boutique A"));
  });
});

describe("empreinte et boutique normalisée", () => {
  it("la base ne garde que l'empreinte SHA-256 de la clé, jamais l'adresse", () => {
    const key = trackingKeyOf("https://boutique.example/veste?taille=M", "Boutique Exemple")!;
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.hash).toBe(alertKeyHash("v1|u|boutique.example/veste?taille=M"));
    expect(key).toEqual({ hash: key.hash, merchant: "boutiqueexemple", kind: "link" });
    expect(trackingKeyOf(GOOGLE, "Boutique")?.kind).toBe("google");
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
