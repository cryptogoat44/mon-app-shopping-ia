import { describe, expect, it } from "vitest";
import { parseVideoMomentsResponse } from "@monapp/shared-types";

// Lot 4, temps 1 bis : l'app ne fait jamais confiance aveuglément au réseau —
// la réponse de l'analyse automatique est relue avant usage.
const BOX = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };

describe("lecture de la réponse « meilleurs moments »", () => {
  it("accepte jusqu'à 3 moments distincts, sur des images envoyées, cadres dans l'image", () => {
    const value = { moments: [{ frame: 2, box: BOX }, { frame: 0, box: { x: 0, y: 0, width: 1, height: 1 } }] };
    expect(parseVideoMomentsResponse(value, 3)).toEqual(value.moments);
    expect(parseVideoMomentsResponse({ moments: [] }, 3)).toEqual([]);
  });

  it("refuse une image qui n'a pas été envoyée, un doublon, plus de 3 moments", () => {
    expect(parseVideoMomentsResponse({ moments: [{ frame: 3, box: BOX }] }, 3)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: [{ frame: -1, box: BOX }] }, 3)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: [{ frame: 1.5, box: BOX }] }, 3)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: [{ frame: 1, box: BOX }, { frame: 1, box: BOX }] }, 3)).toBeNull();
    const four = [0, 1, 2, 3].map((frame) => ({ frame, box: BOX }));
    expect(parseVideoMomentsResponse({ moments: four }, 5)).toBeNull();
  });

  it("refuse un cadre hors de l'image, vide, ou mal formé", () => {
    expect(parseVideoMomentsResponse({ moments: [{ frame: 0, box: { x: 0.8, y: 0, width: 0.5, height: 0.5 } }] }, 1)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: [{ frame: 0, box: { x: 0, y: 0, width: 0, height: 0.5 } }] }, 1)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: [{ frame: 0, box: { x: "0", y: 0, width: 1, height: 1 } }] }, 1)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: [{ frame: 0 }] }, 1)).toBeNull();
    expect(parseVideoMomentsResponse({ moments: "2,3" }, 1)).toBeNull();
    expect(parseVideoMomentsResponse(null, 1)).toBeNull();
  });
});
