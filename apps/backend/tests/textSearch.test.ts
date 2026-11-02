import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot c, voie C : recherche Google Shopping par SerpApi. Aucun appel réel :
// safeFetch est remplacé et chaque réponse est fabriquée (marques et sites
// fictifs). La garde des tests (tests/setup/noPaidCalls.ts) refuserait de
// toute façon serpapi.com.
vi.mock("../src/lib/safeFetch.js", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../src/lib/safeFetch.js";
import { callShopping, googleDomainFor, serpApiTextProvider, SHOPPING_SETTINGS } from "../src/services/serpapi.js";
import { filterShoppingItems, isGoogleLink, MAX_TEXT_MATCHES, searchProductsByText, SHOPPING_CURRENCIES } from "../src/services/textSearch.js";
import { ProviderFailure } from "../src/services/searchProvider.js";
import { MAX_PRICE } from "../src/services/visualSearch.js";

const safeFetchMock = vi.mocked(safeFetch);
const FR = { country: "fr", hl: "fr" };
const QUERY = "Exemplor veste Nuage 07";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

const item = (position: number, extra: Record<string, unknown> = {}) => ({
  position,
  title: `Exemplor veste Nuage 07 — modèle ${position}`,
  link: `https://boutique-exemple.fr/p/${position}`,
  product_link: `https://www.google.fr/shopping/product/${position}?gl=fr`,
  source: "Boutique Exemple",
  price: "49,99 €",
  extracted_price: 49.99,
  thumbnail: `https://encrypted-tbn0.gstatic.com/images?q=tbn:${position}`,
  ...extra,
});

async function search(items: unknown[], locale = FR, lens: { merchantUrl: string }[] = []) {
  safeFetchMock.mockResolvedValueOnce(jsonResponse({ search_metadata: { status: "Success" }, shopping_results: items }));
  return searchProductsByText(serpApiTextProvider, QUERY, locale, signal(), lens);
}

/** Message de la panne levée (ou null). */
async function failureOf(run: () => Promise<unknown>): Promise<ProviderFailure> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ProviderFailure) return error;
    throw error;
  }
  throw new Error("aucune panne levée");
}

beforeEach(() => {
  safeFetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Google Shopping par SerpApi — l'appel", () => {
  it("google_shopping_light avec q, gl=fr, hl=fr, google_domain=google.fr et la clé ; jamais d'image ni de no_cache ; le signal donné est transmis", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ shopping_results: [item(1)] }));
    const stop = signal();
    await callShopping(QUERY, FR, stop);

    expect(safeFetchMock).toHaveBeenCalledOnce();
    const [address, options] = safeFetchMock.mock.calls[0]!;
    const url = new URL(address as string);
    expect(url.hostname).toBe("serpapi.com");
    expect(url.searchParams.get("engine")).toBe("google_shopping_light");
    expect(SHOPPING_SETTINGS.engine).toBe("google_shopping_light");
    expect(url.searchParams.get("q")).toBe(QUERY);
    expect(url.searchParams.get("gl")).toBe("fr");
    expect(url.searchParams.get("hl")).toBe("fr");
    expect(url.searchParams.get("google_domain")).toBe("google.fr");
    expect(url.searchParams.has("api_key")).toBe(true);
    for (const forbidden of ["url", "no_cache", "type", "country"]) expect(url.searchParams.has(forbidden), forbidden).toBe(false);
    expect(options).toMatchObject({ allowedHosts: ["serpapi.com"], signal: stop });
  });

  it("domaine de Google : liste fermée (fr, gb, us, ch) ; tout autre pays (en-DE) : google.com", async () => {
    expect([googleDomainFor("fr"), googleDomainFor("gb"), googleDomainFor("us"), googleDomainFor("ch")]).toEqual(["google.fr", "google.co.uk", "google.com", "google.ch"]);
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ shopping_results: [] }));
    await callShopping(QUERY, { country: "de", hl: "en" }, signal());
    const url = new URL(safeFetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("google_domain")).toBe("google.com");
    expect(url.searchParams.get("gl")).toBe("de");
    expect(url.searchParams.get("hl")).toBe("en");
  });

  it("pannes classées comme pour Lens : 400 à 499, 500, 503 et statut « Error » = refus non facturé ; 502 = erreur ; délai dépassé ; réponse illisible", async () => {
    for (const status of [400, 401, 404, 429, 499, 500, 503]) {
      safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: `refus ${QUERY}` }, status));
      expect(await failureOf(() => callShopping(QUERY, FR, signal())), String(status)).toMatchObject({ kind: "refused", statusCode: status });
    }
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ search_metadata: { status: "Error" }, error: `Proxy timeout for ${QUERY}` }));
    expect(await failureOf(() => callShopping(QUERY, FR, signal()))).toMatchObject({ kind: "refused", statusCode: 200 });
    safeFetchMock.mockResolvedValueOnce(new Response("{}", { status: 502 }));
    expect(await failureOf(() => callShopping(QUERY, FR, signal()))).toMatchObject({ kind: "error", statusCode: 502 });
    safeFetchMock.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect(await failureOf(() => callShopping(QUERY, FR, signal()))).toMatchObject({ kind: "timeout", statusCode: null });
    safeFetchMock.mockResolvedValueOnce(new Response("<html>erreur</html>", { status: 200 }));
    expect(await failureOf(() => callShopping(QUERY, FR, signal()))).toMatchObject({ kind: "unreadable", statusCode: 200 });
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ shopping_results: "aucune" }));
    expect(await failureOf(() => callShopping(QUERY, FR, signal()))).toMatchObject({ kind: "unreadable" });
  });

  it("le message d'une panne ne contient JAMAIS la requête, ni le texte de SerpApi qui pourrait la reprendre", async () => {
    const failures = [
      () => safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: `Invalid query: ${QUERY}` })),
      () => safeFetchMock.mockResolvedValueOnce(jsonResponse({ search_metadata: { status: "Error" }, error: `Echo ${QUERY}` })),
      () => safeFetchMock.mockResolvedValueOnce(jsonResponse({ error: QUERY }, 400)),
      () => safeFetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${QUERY}`)),
    ];
    for (const prepare of failures) {
      prepare();
      const failure = await failureOf(() => callShopping(QUERY, FR, signal()));
      expect(failure.message).not.toContain("Exemplor");
      expect(failure.message).not.toContain("Nuage");
      expect(failure.message).not.toContain("Invalid query");
    }
  });

  it("« hasn't returned any results » : une recherche vide (facturée), pas une panne", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ search_metadata: { status: "Success" }, error: "Google Shopping Light hasn't returned any results for this query." }));
    const result = await searchProductsByText(serpApiTextProvider, QUERY, FR, signal(), []);
    expect(result.matches).toEqual([]);
    expect(result.measure).toMatchObject({ received: 0, kept: 0 });
    expect(result.statusCode).toBe(200);
  });

  it("proposition mal formée écartée seule, sans faire échouer les autres", async () => {
    const result = await search([item(1, { title: 42 }), item(2, { extracted_price: "beaucoup" }), item(3)]);
    expect(result.matches.map((match) => match.merchantUrl)).toEqual(["https://boutique-exemple.fr/p/3"]);
    expect(result.measure.received).toBe(3);
  });
});

describe("Google Shopping — prix et devises", () => {
  it("« 49,99 € » en France : 49,99 EUR ; « 1 234,50 € » et « EUR 12.00 » aussi", async () => {
    const result = await search([item(1), item(2, { price: "1 234,50 €", extracted_price: 1234.5 }), item(3, { price: "EUR 12.00", extracted_price: 12 })]);
    expect(result.matches.map((match) => [match.priceValue, match.currency])).toEqual([
      [49.99, "EUR"],
      [1234.5, "EUR"],
      [12, "EUR"],
    ]);
    expect(result.measure).toMatchObject({ keptWithPrice: 3, priceDroppedCurrency: 0 });
  });

  it("« $US 30 » en France : prix caché, pièce gardée ; jamais converti", async () => {
    const result = await search([item(1, { price: "30,00 $US", extracted_price: 30 }), item(2, { price: "$CA 40", extracted_price: 40 })]);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((match) => [match.priceValue, match.currency])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(result.measure).toMatchObject({ kept: 2, keptWithPrice: 0, priceDroppedCurrency: 2 });
  });

  it("pays dont la devise n'est pas connue ici (en-DE) : prix en euros caché, pièce gardée", async () => {
    expect(SHOPPING_CURRENCIES.de).toBeUndefined();
    const result = await search([item(1)], { country: "de", hl: "en" });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ priceValue: null, currency: null });
    expect(result.measure.priceDroppedCurrency).toBe(1);
  });

  it("Royaume-Uni, Suisse, États-Unis : leur devise seulement", async () => {
    const gb = await search([item(1, { price: "£30.00", extracted_price: 30 }), item(2, { price: "€30.00", extracted_price: 30 })], { country: "gb", hl: "en" });
    expect(gb.matches.map((match) => match.currency)).toEqual(["GBP", null]);
    const ch = await search([item(1, { price: "CHF 49.90", extracted_price: 49.9 })], { country: "ch", hl: "en" });
    expect(ch.matches[0]).toMatchObject({ priceValue: 49.9, currency: "CHF" });
    const us = await search([item(1, { price: "$30.00", extracted_price: 30 }), item(2, { price: "US$45", extracted_price: 45 }), item(3, { price: "CA$30", extracted_price: 30 })], { country: "us", hl: "en" });
    expect(us.matches.map((match) => match.currency)).toEqual(["USD", "USD", null]);
  });

  it("limites de la base : prix négatif, trop grand ou illisible retiré, la pièce reste ; sans prix : aucun prix", async () => {
    const result = await search([
      item(1, { extracted_price: -5, price: "-5 €" }),
      item(2, { extracted_price: MAX_PRICE + 1, price: "100 000 000 €" }),
      item(3, { extracted_price: Number.MAX_VALUE, price: "beaucoup €" }),
      item(4, { price: undefined, extracted_price: undefined }),
    ]);
    expect(result.matches).toHaveLength(4);
    expect(result.matches.every((match) => match.priceValue === null)).toBe(true);
  });
});

describe("Google Shopping — filtres", () => {
  it("réseaux sociaux et faire.com retirés ; doublons retirés ; pages déjà proposées par Lens retirées", async () => {
    const result = await search(
      [
        item(1),
        item(2, { link: "https://www.instagram.com/p/exemple" }),
        item(3, { link: "https://www.faire.com/fr/product/exemple" }),
        item(4, { link: "https://boutique-exemple.fr/p/1#avis" }),
        item(5, { link: "https://autre-exemple.fr/article/9?utm_source=google" }),
        item(6),
      ],
      FR,
      [{ merchantUrl: "https://autre-exemple.fr/article/9" }]
    );
    expect(result.matches.map((match) => match.merchantUrl)).toEqual(["https://boutique-exemple.fr/p/1", "https://boutique-exemple.fr/p/6"]);
    expect(result.matches.map((match) => match.rank)).toEqual([1, 2]);
  });

  it("lien : le lien direct d'abord ; sans lui (ou s'il mène à Google), la page produit de Google, gardée et comptée", async () => {
    const result = await search([
      item(1),
      item(2, { link: undefined }),
      item(3, { link: "https://www.google.fr/aclk?sa=exemple" }),
    ]);
    expect(result.matches.map((match) => match.merchantUrl)).toEqual([
      "https://boutique-exemple.fr/p/1",
      "https://www.google.fr/shopping/product/2?gl=fr",
      "https://www.google.fr/shopping/product/3?gl=fr",
    ]);
    expect(result.measure.googleLinks).toBe(2);
    expect([isGoogleLink("https://shopping.google.com/x"), isGoogleLink("https://www.google.co.uk/x"), isGoogleLink("https://googleusercontent.com/x"), isGoogleLink("pas une adresse")]).toEqual([true, true, false, false]);
  });

  it("vignettes « data: » jamais gardées (comptées) ; la vignette hébergée par SerpApi n'est jamais lue", async () => {
    const result = await search([
      item(1, { thumbnail: "data:image/jpeg;base64,AAAA" }),
      item(2, { thumbnail: undefined, serpapi_thumbnail: "https://serpapi.com/searches/x/images/y.jpeg" }),
      item(3),
    ]);
    expect(result.matches.map((match) => match.merchantUrl)).toEqual(["https://boutique-exemple.fr/p/3"]);
    expect(result.matches.some((match) => match.imageUrl.startsWith("data:") || match.imageUrl.includes("serpapi.com"))).toBe(false);
    expect(result.measure.droppedDataThumbnails).toBe(1);
  });

  it("20 au plus, après le tri donné (jamais avant) ; rangs 1..20", async () => {
    const many = Array.from({ length: 35 }, (_, index) => item(index + 1));
    safeFetchMock.mockResolvedValueOnce(jsonResponse({ shopping_results: many }));
    const reversed = await searchProductsByText(serpApiTextProvider, QUERY, FR, signal(), [], (matches) => [...matches].reverse());
    expect(MAX_TEXT_MATCHES).toBe(20);
    expect(reversed.matches).toHaveLength(20);
    expect(reversed.matches[0]!.merchantUrl).toBe("https://boutique-exemple.fr/p/35");
    expect(reversed.matches.map((match) => match.rank)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(reversed.measure).toMatchObject({ received: 35, kept: 20 });
  });

  it("caractères nuls retirés des textes", async () => {
    const result = await search([item(1, { title: "Exemplor\u0000 veste", source: "Bou\u0000tique", link: "https://boutique-exemple.fr/p/\u00001" })]);
    expect(result.matches[0]).toMatchObject({ productName: "Exemplor veste", merchantName: "Boutique", merchantUrl: "https://boutique-exemple.fr/p/1" });
  });

  it("les filtres seuls ne font aucun appel (contenu du cache)", () => {
    const filtered = filterShoppingItems({ items: [item(1), item(2, { link: "https://www.tiktok.com/@x" })], received: 2 }, "fr");
    expect(filtered).toMatchObject({ received: 2, droppedDataThumbnails: 0 });
    expect(filtered.matches).toHaveLength(1);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe("garde des tests", () => {
  it("fetch refuse serpapi.com et api.anthropic.com avant tout envoi (tests/setup/noPaidCalls.ts)", async () => {
    // La garde est bien en place : sinon, on s'arrête ici, sans rien envoyer.
    expect(globalThis.fetch.name).toBe("guardedFetch");
    await expect(globalThis.fetch("https://serpapi.com/search.json?engine=google_shopping_light")).rejects.toThrow("Appel payant refusé");
    await expect(globalThis.fetch(new URL("https://api.anthropic.com/v1/messages"), { method: "POST" })).rejects.toThrow("Appel payant refusé");
  });
});
