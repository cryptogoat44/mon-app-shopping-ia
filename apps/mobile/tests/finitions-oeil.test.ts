import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDGE_INSET_PER_BLUR, EDGE_STRIP, edgeBands, fillsTile } from "../src/lib/piece-image";

// Lot « finitions de l'œil » (retours3/lots/lot-12-finitions.md) : ce qu'un
// regard exigeant voyait encore sur les vrais écrans.
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

/** Où tombe, après l'étirement, le point `u` de la copie (coordonnées de la bande) : transform de React Native, centre pour origine. */
function mapped(band: ReturnType<typeof edgeBands>[number], u: number): number {
  const horizontal = band.side === "left" || band.side === "right";
  const [move, scale] = band.transform as [Record<string, number>, Record<string, number>];
  const c = horizontal ? band.copy.left + band.copy.width / 2 : band.copy.top + band.copy.height / 2;
  const a = horizontal ? move.translateX : move.translateY;
  const s = horizontal ? scale.scaleX : scale.scaleY;
  return c + a + s * (u - c);
}

describe("1 · les bords prolongés (lib/piece-image.ts, edgeBands)", () => {
  const square = { width: 358, height: 358 };
  const gridTile = { width: 175, height: 218.75 };

  it("photo 2:3 dans un carré : une bande à gauche et une à droite, de même largeur, sur toute la hauteur de la photo", () => {
    const bands = edgeBands({ width: 1000, height: 1500 }, square, "hero");
    expect(bands.map((b) => b.side)).toEqual(["left", "right"]);
    const [left, right] = bands;
    expect(left.box.width).toBeCloseTo(right.box.width, 6);
    // La photo (1 point par pixel au plus : 358 de haut, 238,67 de large) laisse 59,67 points de chaque côté ; un point de plus sous la photo.
    expect(left.box.width).toBeCloseTo((358 - (358 * 2) / 3) / 2 + 1, 4);
    expect(left.box.left).toBe(0);
    expect(right.box.left + right.box.width).toBeCloseTo(358, 6);
    expect(left.box.height).toBeCloseTo(358, 6);
  });

  it("photo 16:9 dans un carré : une bande en haut et une en bas, aucune sur les côtés", () => {
    const bands = edgeBands({ width: 1600, height: 900 }, square, "hero");
    expect(bands.map((b) => b.side)).toEqual(["top", "bottom"]);
    expect(bands[0].box.height).toBeCloseTo(bands[1].box.height, 6);
    expect(bands[0].box.width).toBe(358);
  });

  it("photo qui remplit (carrée dans un carré, 4:5 dans une tuile, 3:4 en grille) : aucune bande", () => {
    expect(edgeBands({ width: 1000, height: 1000 }, square, "hero")).toEqual([]);
    expect(edgeBands({ width: 800, height: 1000 }, { width: 300, height: 375 }, "hero")).toEqual([]);
    expect(fillsTile({ width: 750, height: 1000 }, gridTile, "grid")).toBe(true);
    expect(edgeBands({ width: 750, height: 1000 }, gridTile, "grid")).toEqual([]);
  });

  it("taille ou cadre inconnus : aucune bande (la plinthe reste)", () => {
    expect(edgeBands(null, square, "hero")).toEqual([]);
    expect(edgeBands({ width: 0, height: 0 }, square, "hero")).toEqual([]);
    expect(edgeBands({ width: 1000, height: 1500 }, { width: 0, height: 0 }, "hero")).toEqual([]);
  });

  it("petite image dans une grande tuile (jamais agrandie) : les quatre côtés", () => {
    expect(edgeBands({ width: 200, height: 260 }, square, "hero").map((b) => b.side)).toEqual(["left", "right", "top", "bottom"]);
  });

  it("l'étirement part du bord : le point pris dans la photo touche la jointure, EDGE_STRIP points plus loin touchent le bord de la tuile", () => {
    for (const band of edgeBands({ width: 1000, height: 1500 }, square, "hero").concat(edgeBands({ width: 1600, height: 900 }, square, "hero"))) {
      const inset = band.blur * EDGE_INSET_PER_BLUR;
      if (band.side === "left") {
        const seam = band.box.width - 1;
        expect(mapped(band, seam + inset)).toBeCloseTo(seam, 6);
        expect(mapped(band, seam + inset + EDGE_STRIP)).toBeCloseTo(0, 6);
      } else if (band.side === "right") {
        expect(mapped(band, 1 - inset)).toBeCloseTo(1, 6);
        expect(mapped(band, 1 - inset - EDGE_STRIP)).toBeCloseTo(band.box.width, 6);
      } else if (band.side === "top") {
        const seam = band.box.height - 1;
        expect(mapped(band, seam + inset)).toBeCloseTo(seam, 6);
        expect(mapped(band, seam + inset + EDGE_STRIP)).toBeCloseTo(0, 6);
      } else {
        expect(mapped(band, 1 - inset)).toBeCloseTo(1, 6);
        expect(mapped(band, 1 - inset - EDGE_STRIP)).toBeCloseTo(band.box.height, 6);
      }
    }
  });

  it("le flou suit la taille de la photo : une grille floute moins qu'une grande image, toujours entre 2 et 10", () => {
    const hero = edgeBands({ width: 1000, height: 1500 }, square, "hero")[0];
    const grid = edgeBands({ width: 1000, height: 1500 }, gridTile, "grid")[0];
    expect(grid.blur).toBeLessThan(hero.blur);
    expect(grid.blur).toBeGreaterThanOrEqual(2);
    expect(hero.blur).toBeLessThanOrEqual(10);
  });

  it("une photo en pied 2:3 en grille reste entière (12 %), avec ses deux bandes : les règles de remplissage ne changent pas", () => {
    expect(fillsTile({ width: 1000, height: 1500 }, gridTile, "grid")).toBe(false);
    expect(edgeBands({ width: 1000, height: 1500 }, gridTile, "grid").map((b) => b.side)).toEqual(["left", "right"]);
  });
});

describe("1 · la tuile (components/piece-tile.tsx) dessine les bandes", () => {
  const tile = read("src/components/piece-tile.tsx");

  it("refusé : la copie floue et agrandie sous toute la tuile ; permis : une vue qui coupe par bande, la copie étirée dedans", () => {
    expect(tile).not.toMatch(/blurRadius=\{24\}/);
    expect(tile).not.toContain("scale: 1.2");
    expect(tile).toContain("bands.map((band) => (");
    expect(tile).toContain('band: { position: "absolute", overflow: "hidden" }');
    expect(tile).toContain("style={[styles.bandCopy, band.copy, { transform: band.transform }]}");
    expect(tile).toContain('contentFit="fill"');
  });

  it("couleur des bords connue : fond uni, aucune bande ; taille inconnue : aucune bande", () => {
    expect(tile).toContain("const bands = background || !shownUri ? [] : edgeBands(naturalSize, frame, variant);");
    expect(tile).toContain("{ backgroundColor: background }");
  });

  it("les bandes copient l'image réellement affichée (vignette, puis originale), jamais lues par VoiceOver", () => {
    expect(tile).toContain("source={{ uri: shownUri! }}");
    expect(read("src/components/spot-image.tsx")).toContain("useReportSize(hdOnTop ? current.hdSize : showThumb ? current.thumbSize : null, hdOnTop ? hd : showThumb ? thumb : null, onImageSize);");
    expect(tile).toMatch(/key=\{band\.side\}\s+pointerEvents="none"\s+accessible=\{false\}\s+importantForAccessibility="no-hide-descendants"/);
  });
});

describe("3 · le haut du Résultat : une seule ligne grise sous les pastilles", () => {
  const bar = read("src/components/result-sort-bar.tsx");
  const screen = read("src/app/(app)/spot/result.tsx");
  const verdict = read("src/components/verdict-line.tsx");

  it("verdict présent : lui seul à l'œil, le résumé des prix reste lu par VoiceOver (nom de la pastille du tri)", () => {
    const info = bar.slice(bar.indexOf("{verdict ? ("), bar.indexOf("</View>\n  );\n}"));
    expect(info).toMatch(/\{verdict \? \(\s*verdict\s*\) : \(\s*<Text style=\{styles\.summary\}/);
    expect(bar).toContain("<SortMenuButton view={view} onChange={onChange} hiddenSummary={verdict ? summary : null} />");
    expect(bar).toContain("accessibilityLabel={hiddenSummary ? `${t.result.sortMenuLabel(current.label)}. ${hiddenSummary}` : t.result.sortMenuLabel(current.label)}");
  });

  it("refusé : la phrase du verdict ET le résumé rendus ensemble ; une seule phrase du verdict dans l'écran", () => {
    // Le résumé n'est rendu que dans la branche « pas de verdict ».
    expect(bar.match(/testID="price-summary"/g)).toHaveLength(1);
    expect(bar.indexOf('testID="price-summary"')).toBeGreaterThan(bar.indexOf(") : ("));
    expect(screen.match(/<VerdictLine /g)).toHaveLength(1);
    expect(screen).toContain("verdict={verdictLineShown(result.verdict) ? <VerdictLine verdict={result.verdict} /> : null}");
  });

  it("le « ⓘ » est lié au dernier mot par une espace insécable ; les mots du verdict ne changent pas", () => {
    expect(verdict).toContain('{sentence}{"\\u00A0"}<Text style={styles.more}>ⓘ</Text>');
    expect(verdict).toContain("accessibilityLabel={sentence}");
    expect(verdict).toContain("return Boolean(verdict && verdictSentence(verdict, t.result.verdict, getActiveLocale()));");
  });

  it("deux lignes de 36 points, zone touchable de 44 sur l'iPhone ; les mentions ne réservent plus leur marge vide", () => {
    expect(verdict).toContain('box: { minHeight: 36, justifyContent: "center" }');
    expect(verdict).toContain("hitSlop={{ top: 4, bottom: 4 }}");
    expect(screen).toContain('marks: { flexDirection: "row", flexWrap: "wrap", columnGap: space.sm, alignItems: "center", marginVertical: -8 }');
    // Refusé : la rangée vide des mentions qui tirerait le bouton sur le prix.
    expect(screen).toContain('{piece.offerMark || typeof piece.inStock === "boolean" ? (\n              <View style={styles.marks}>');
  });
});
