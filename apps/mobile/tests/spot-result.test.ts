import { describe, expect, it } from "vitest";
import type { MatchOrigin, ProductMatch, ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { chooseInitialResult, hdRereadDue, noPriceShown, pieceTitle, toSpotResult, withHdImages } from "../src/lib/spot-result";

function search(overrides: Partial<ProductSearch> = {}): ProductSearch {
  return {
    id: "s1",
    sourceUrl: "https://www.tiktok.com/@x/video/1",
    sourcePlatform: "tiktok",
    method: "oembed",
    status: "completed",
    errorMessage: null,
    query: null,
    createdAt: "2026-09-23T00:00:00.000Z",
    matches: [
      {
        id: "m1",
        rank: 2,
        productName: "Sac",
        brand: null,
        imageUrl: "https://example.com/a.jpg",
        priceMin: 100,
        priceMax: 100,
        currency: "EUR",
        merchantName: "Boutique",
        merchantUrl: "https://example.com/p",
        affiliateUrl: "https://example.com/p?aff",
        imageHdUrl: "https://example.com/hd.jpg",
        feedbackReason: "wrong_price",
      },
    ],
    ...overrides,
  };
}

const memory: SpotResult = { searchId: "s1", status: "success", pieces: [], similarPieces: [] };

describe("chooseInitialResult (audit Lot Q, ETA-04)", () => {
  it("utilise le résultat en mémoire quand il correspond à la recherche demandée", () => {
    expect(chooseInitialResult(memory, "s1")).toEqual({ kind: "ready", result: memory });
  });

  it("relit la recherche sur le serveur quand la mémoire est vide (page rechargée)", () => {
    expect(chooseInitialResult(null, "s1")).toEqual({ kind: "loading", searchId: "s1" });
  });

  it("relit la recherche quand la mémoire contient une autre recherche", () => {
    expect(chooseInitialResult(memory, "s2")).toEqual({ kind: "loading", searchId: "s2" });
  });

  it("utilise la mémoire pour un échec sans recherche créée (limite atteinte)", () => {
    const failed: SpotResult = { searchId: null, status: "failed", pieces: [], similarPieces: [], failReason: "rate_limited" };
    expect(chooseInitialResult(failed, undefined)).toEqual({ kind: "ready", result: failed });
  });

  it("ne prétend jamais qu'une pièce n'a pas été identifiée quand le résultat a simplement disparu", () => {
    expect(chooseInitialResult(null, undefined)).toEqual({ kind: "missing" });
  });
});

describe("toSpotResult", () => {
  it("garde l'identifiant de la recherche et le lien affilié", () => {
    const result = toSpotResult(search());
    expect(result.searchId).toBe("s1");
    expect(result.status).toBe("success");
    expect(result.pieces[0]?.affiliateUrl).toBe("https://example.com/p?aff");
  });

  // Petit lot 2 : « Triées selon vos mots » seulement si le serveur a remonté des propositions.
  it("indique le tri par les mots seulement quand le serveur l'a fait ; une recherche relue n'en dit rien", () => {
    expect(toSpotResult(search({ sortedByWords: true })).sortedByWords).toBe(true);
    expect(toSpotResult(search({ sortedByWords: false })).sortedByWords).toBe(false);
    expect(toSpotResult(search()).sortedByWords).toBe(false);
  });

  it("signale une capture nécessaire pour une recherche préparée, jamais lancée", () => {
    const result = toSpotResult(search({ matches: [], method: "manual_screenshot", status: "pending" }));
    expect(result).toMatchObject({ status: "failed", failReason: "needs_photo" });
  });

  it("signale une pièce non identifiée quand l'analyse n'a rien trouvé", () => {
    const result = toSpotResult(search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image." }));
    expect(result).toMatchObject({ status: "failed", failReason: "no_match" });
  });

  it("distingue une panne du service d'une recherche sans résultat", () => {
    const result = toSpotResult(search({ matches: [], status: "failed", errorMessage: "La recherche visuelle a échoué." }));
    expect(result).toMatchObject({ status: "failed", failReason: "technical" });
  });

  it("garde l'image haute définition des propositions", () => {
    expect(toSpotResult(search()).pieces[0]?.imageHdUrl).toBe("https://example.com/hd.jpg");
  });
});

describe("message « Aucune de ces propositions n'affiche de prix » (petit lot)", () => {
  it("seulement quand il y a des propositions et qu'aucune n'a de prix", () => {
    expect(noPriceShown([{ priceFrom: null }, { priceFrom: null }])).toBe(true);
    expect(noPriceShown([{ priceFrom: null }, { priceFrom: 39 }])).toBe(false);
    expect(noPriceShown([{ priceFrom: 0 }])).toBe(false);
    // Aucune proposition : c'est le message « rien trouvé », pas celui-ci.
    expect(noPriceShown([])).toBe(false);
  });
});

describe("titre envoyé pour « Garder » et « Je l'ai achetée » : 120 caractères au plus", () => {
  it("coupe les titres plus longs (Google Shopping va jusqu'à 150), laisse les autres tels quels", () => {
    const shopTitle = "Veste en cuir femme automne hiver courte cintrée style motard, simili cuir PU, fermeture éclair, poches zippées, noir, taille M";
    expect(shopTitle.length).toBeGreaterThan(120);
    expect(pieceTitle(shopTitle)).toBe(shopTitle.slice(0, 120));
    expect(pieceTitle("x".repeat(120))).toBe("x".repeat(120));
    expect(pieceTitle("Sac Boutique")).toBe("Sac Boutique");
  });

  it("ne coupe jamais un emoji en deux", () => {
    expect(pieceTitle(`${"x".repeat(119)}👜 cuir noir`)).toBe("x".repeat(119));
    expect(pieceTitle(`${"x".repeat(118)}👜 cuir noir`)).toBe(`${"x".repeat(118)}👜`);
  });
});

// Voie C (lot c) : les propositions du complément arrivent dans `matches`,
// avec leur origine ; la recherche visuelle reste seule dans `pieces`.
function match(id: string, origin?: MatchOrigin): ProductMatch {
  return {
    id,
    rank: 1,
    productName: `Pièce ${id}`,
    brand: null,
    imageUrl: `https://example.com/${id}.jpg`,
    priceMin: null,
    priceMax: null,
    currency: "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://example.com/${id}`,
    affiliateUrl: `https://example.com/${id}`,
    imageHdUrl: null,
    feedbackReason: null,
    ...(origin ? { origin } : {}),
  };
}

describe("toSpotResult, voie C (lot c)", () => {
  it("origine absente = recherche visuelle : sans complément, le résultat ne change pas", () => {
    const result = toSpotResult(search({ matches: [match("a"), match("b")] }));
    expect(result.pieces.map((piece) => piece.id)).toEqual(["a", "b"]);
    expect(result.pieces[0]?.origin).toBeUndefined();
    expect("complement" in result).toBe(false);
  });

  it("partage les propositions en trois, chacune dans son ordre", () => {
    const result = toSpotResult(
      search({
        matches: [match("l1"), match("l2", "lens"), match("s1", "shopping"), match("s2", "shopping"), match("w1", "words")],
        complement: { status: "shown", query: "veste daim marron", suggestText: false, textStatus: "shown" },
      })
    );
    expect(result.pieces.map((piece) => piece.id)).toEqual(["l1", "l2"]);
    expect(result.complement?.shopping.map((piece) => piece.id)).toEqual(["s1", "s2"]);
    expect(result.complement?.words.map((piece) => piece.id)).toEqual(["w1"]);
    expect(result.complement?.shopping[0]).toMatchObject({ origin: "shopping", real: true });
    expect(result.complement).toMatchObject({ status: "shown", query: "veste daim marron", suggestText: false, textStatus: "shown" });
  });

  it("un succès dès qu'une proposition existe, même sans la recherche visuelle (0 + mots)", () => {
    const result = toSpotResult(
      search({ matches: [match("w1", "words"), match("w2", "words")], complement: { status: "no_query", suggestText: false, textStatus: "shown" } })
    );
    expect(result.status).toBe("success");
    expect(result.pieces).toEqual([]);
    expect(result.complement?.words).toHaveLength(2);
  });

  it("l'invitation et l'issue de la recherche par les mots survivent à une relecture", () => {
    // Recherche relue (GET) : pas de requête, mais suggestText et textStatus enregistrés.
    const reread = toSpotResult(search({ matches: [match("l1")], complement: { status: "empty", suggestText: true, textStatus: null } }));
    expect(reread.complement).toMatchObject({ suggestText: true, textStatus: null, query: null, status: "empty" });
    const afterWords = toSpotResult(search({ matches: [match("l1")], complement: { status: "empty", suggestText: false, textStatus: "empty" } }));
    expect(afterWords.complement).toMatchObject({ suggestText: false, textStatus: "empty" });
  });

  it("la requête ne vient que de la réponse du lancement", () => {
    const launched = toSpotResult(search({ matches: [match("l1"), match("s1", "shopping")], complement: { status: "shown", query: "sac cuir noir", suggestText: false, textStatus: null } }));
    expect(launched.complement?.query).toBe("sac cuir noir");
    const reread = toSpotResult(search({ matches: [match("l1"), match("s1", "shopping")], complement: { status: "shown", suggestText: false, textStatus: null } }));
    expect(reread.complement?.query).toBeNull();
    // Jamais confondue avec le texte « Que cherchez-vous ? » d'un lancement (search.query).
    expect(reread.query).toBeNull();
  });

  it("« rien trouvé » garde l'invitation « Que cherchez-vous ? »", () => {
    const result = toSpotResult(
      search({ matches: [], status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: true, textStatus: null } })
    );
    expect(result).toMatchObject({ status: "failed", failReason: "no_match" });
    expect(result.complement).toMatchObject({ suggestText: true, shopping: [], words: [] });
  });
});

// Lot « vitrine » (retours du build 3) : relecture de la recherche pour les
// grandes images trouvées par le serveur ; seule imageHdUrl est reprise.
describe("relecture des grandes images (withHdImages, hdRereadDue)", () => {
  function shopMatch(id: string, origin: MatchOrigin, imageHdUrl: string | null): ProductMatch {
    return { ...match(id, origin), imageHdUrl };
  }
  const before = toSpotResult(
    search({ matches: [shopMatch("lens1", "lens", null), shopMatch("a", "shopping", null), shopMatch("b", "shopping", "https://shop.test/b.jpg"), shopMatch("w", "words", null)] })
  );

  it("permis : la grande image arrive par identifiant, ordre et sections inchangés", () => {
    const reread = search({ matches: [shopMatch("w", "words", "https://shop.test/w.jpg"), shopMatch("a", "shopping", "https://shop.test/a.jpg")] });
    const next = withHdImages(before, reread);
    expect(next.complement?.shopping.map((p) => [p.id, p.imageHdUrl])).toEqual([
      ["a", "https://shop.test/a.jpg"],
      ["b", "https://shop.test/b.jpg"],
    ]);
    expect(next.complement?.words.map((p) => p.imageHdUrl)).toEqual(["https://shop.test/w.jpg"]);
    expect(next.pieces).toBe(before.pieces);
    // Rien d'autre ne change sur la proposition.
    expect({ ...next.complement!.shopping[0], imageHdUrl: null }).toEqual(before.complement!.shopping[0]);
    expect(next.status).toBe(before.status);
  });

  it("refusé : une grande image déjà là n'est jamais remplacée par du vide ; une proposition inconnue est ignorée", () => {
    const reread = search({ matches: [shopMatch("b", "shopping", null), shopMatch("inconnue", "shopping", "https://shop.test/x.jpg")] });
    const next = withHdImages(before, reread);
    expect(next).toBe(before);
    expect(next.complement?.shopping[1].imageHdUrl).toBe("https://shop.test/b.jpg");
    expect(next.complement?.shopping.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("rien de neuf, ou une autre recherche : le même objet (aucun rendu inutile)", () => {
    expect(withHdImages(before, search({ matches: [shopMatch("b", "shopping", "https://shop.test/b.jpg")] }))).toBe(before);
    expect(withHdImages(before, search({ id: "autre", matches: [shopMatch("a", "shopping", "https://shop.test/a.jpg")] }))).toBe(before);
  });

  it("relire tant qu'une des 8 premières propositions « shopping » ou « words » n'a pas de grande image", () => {
    expect(hdRereadDue(before)).toBe(true);
    const complete = withHdImages(before, search({ matches: [shopMatch("a", "shopping", "https://a.jpg"), shopMatch("w", "words", "https://w.jpg")] }));
    expect(hdRereadDue(complete)).toBe(false);
    // Au-delà des 8 premières : pas de relecture pour elles.
    const many = toSpotResult(
      search({ matches: [...Array.from({ length: 8 }, (_, i) => shopMatch(`s${i}`, "shopping", `https://s${i}.jpg`)), shopMatch("neuvieme", "shopping", null)] })
    );
    expect(hdRereadDue(many)).toBe(false);
    // Sans complément, échec ou résultat absent : jamais.
    expect(hdRereadDue(toSpotResult(search()))).toBe(false);
    expect(hdRereadDue(null)).toBe(false);
  });
});

// Lot « couleur des bords » (retours du build 3) : la couleur unie des bords
// de la vignette, mesurée par le serveur, arrive dans un champ facultatif et
// sert de fond à la tuile ; la relecture du lot « vitrine » l'apporte aussi.
describe("couleur des bords (edgeColor)", () => {
  function colored(id: string, origin: MatchOrigin, edgeColor?: string, imageHdUrl: string | null = null): ProductMatch {
    return { ...search().matches[0]!, id, origin, imageHdUrl, ...(edgeColor ? { edgeColor } : {}) };
  }

  it("permis : matchToPiece recopie la couleur ; absente (serveur plus ancien ou coupé) : null", () => {
    const result = toSpotResult(search({ matches: [colored("a", "lens", "#f2f1ee"), colored("b", "lens")] }));
    expect(result.pieces.map((piece) => piece.edgeColor)).toEqual(["#f2f1ee", null]);
  });

  it("permis : la relecture apporte une couleur mesurée après la première réponse, sans rien changer d'autre", () => {
    const before = toSpotResult(search({ matches: [colored("l", "lens"), colored("s", "shopping")] }));
    const next = withHdImages(before, search({ matches: [colored("s", "shopping", "#e8e8e8"), colored("l", "lens", "#ffffff")] }));
    expect(next.pieces[0]!.edgeColor).toBe("#ffffff");
    expect(next.complement?.shopping[0]!.edgeColor).toBe("#e8e8e8");
    expect({ ...next.pieces[0], edgeColor: null }).toEqual(before.pieces[0]);
    expect(next.complement?.shopping[0]!.imageHdUrl).toBeNull();
  });

  it("refusé : une couleur déjà là n'est jamais remplacée par du vide ; rien de neuf : le même objet", () => {
    const before = toSpotResult(search({ matches: [colored("l", "lens", "#ffffff")] }));
    expect(withHdImages(before, search({ matches: [colored("l", "lens")] }))).toBe(before);
    expect(withHdImages(before, search({ matches: [colored("l", "lens", "#ffffff")] }))).toBe(before);
    expect(withHdImages(before, search({ id: "autre", matches: [colored("l", "lens", "#000000")] }))).toBe(before);
  });

  it("grande image et couleur arrivent ensemble ; chacune garde sa règle", () => {
    const before = toSpotResult(search({ matches: [colored("s", "shopping", "#ffffff")] }));
    const next = withHdImages(before, search({ matches: [colored("s", "shopping", undefined, "https://shop.test/s.jpg")] }));
    expect(next.complement?.shopping[0]).toMatchObject({ imageHdUrl: "https://shop.test/s.jpg", edgeColor: "#ffffff" });
  });
  it("permis : couleurs en cours de mesure (edgeColorsPending) → relecture, même Lens seul ou grandes images toutes là", () => {
    const lensOnly = toSpotResult(search({ edgeColorsPending: true, matches: [colored("l", "lens")] }));
    expect(lensOnly.edgeColorsPending).toBe(true);
    expect(lensOnly.complement).toBeUndefined();
    expect(hdRereadDue(lensOnly)).toBe(true);
    const allHd = toSpotResult(search({ edgeColorsPending: true, matches: [colored("s", "shopping", undefined, "https://shop.test/s.jpg")] }));
    expect(hdRereadDue(allHd)).toBe(true);
  });

  it("refusé : sans le champ (rien en file, fonction coupée, ancien serveur), ou une valeur autre que true → aucune relecture de plus", () => {
    const plain = toSpotResult(search({ matches: [colored("l", "lens")] }));
    expect("edgeColorsPending" in plain).toBe(false);
    expect(hdRereadDue(plain)).toBe(false);
    const odd = toSpotResult(search({ edgeColorsPending: "oui" as unknown as boolean, matches: [colored("l", "lens")] }));
    expect(hdRereadDue(odd)).toBe(false);
    expect(hdRereadDue(toSpotResult(search({ edgeColorsPending: true, matches: [] })))).toBe(false);
  });
});
