import { describe, expect, it } from "vitest";
import type { ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { chooseInitialResult, toSpotResult } from "../src/lib/spot-result";

function search(overrides: Partial<ProductSearch> = {}): ProductSearch {
  return {
    id: "s1",
    sourceUrl: "https://www.tiktok.com/@x/video/1",
    sourcePlatform: "tiktok",
    method: "oembed",
    thumbnailUrl: null,
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

  it("signale une capture nécessaire pour un lien sans miniature exploitable", () => {
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
