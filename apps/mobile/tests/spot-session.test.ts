import { describe, expect, it } from "vitest";
import { rememberLaunchExtras, withLaunchExtras } from "../src/api/spotSession";
import type { SpotComplement, SpotResult } from "../src/api/types";

// Voie C (lot c) : une recherche rouverte (« Récemment spottées », Précédent
// ou Suivant du navigateur) est relue sur le serveur, qui n'enregistre ni
// « Triées selon vos mots » ni la requête des boutiques. Ces deux mentions
// du lancement sont gardées le temps de la session.

const complement = (query: string | null): SpotComplement => ({ shopping: [], words: [], status: "shown", query, suggestText: false, textStatus: null });

const result = (searchId: string, extra: Partial<SpotResult> = {}): SpotResult => ({ searchId, status: "success", pieces: [], similarPieces: [], ...extra });

describe("mentions du lancement gardées pour une recherche rouverte", () => {
  it("le tri par vos mots et la requête des boutiques reviennent sur la recherche relue", () => {
    rememberLaunchExtras(result("s-1", { sortedByWords: true, complement: complement("Exemplor veste Nuage 07") }));
    const reread = withLaunchExtras(result("s-1", { complement: complement(null) }));
    expect(reread.sortedByWords).toBe(true);
    expect(reread.complement?.query).toBe("Exemplor veste Nuage 07");
  });

  it("une autre recherche, ou une recherche sans complément, reste telle quelle", () => {
    rememberLaunchExtras(result("s-2", { sortedByWords: true }));
    const other = result("s-3", { complement: complement(null) });
    expect(withLaunchExtras(other)).toEqual(other);
    const plain = withLaunchExtras(result("s-2"));
    expect(plain.sortedByWords).toBe(true);
    expect(plain.complement).toBeUndefined();
  });

  it("rien à garder (ni tri, ni requête) : rien n'est gardé ; 20 recherches au plus", () => {
    rememberLaunchExtras(result("s-vide", { complement: complement(null) }));
    expect(withLaunchExtras(result("s-vide", { complement: complement(null) })).complement?.query).toBeNull();
    for (let index = 0; index < 21; index += 1) rememberLaunchExtras(result(`s-lot-${index}`, { sortedByWords: true }));
    expect(withLaunchExtras(result("s-lot-0")).sortedByWords).toBeUndefined();
    expect(withLaunchExtras(result("s-lot-20")).sortedByWords).toBe(true);
  });
});
