import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "../src/i18n";
import { EDGE_INSET_NATIVE, EDGE_INSET_PER_BLUR, EDGE_STRIP, edgeBands, fillsTile } from "../src/lib/piece-image";
import { actionsInTwoRows, estimatedTextWidth, pairStacked, placeholderFor } from "../src/lib/text-fit";
import { rowHasMarksAt } from "../src/lib/result-sections";
import { recentDayLabel, recentDayShort } from "../src/lib/recent-searches";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

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

  it("l'étirement part du bord : le point pris dans la photo touche la jointure, EDGE_STRIP points plus loin touchent le bord de la tuile (iPhone et site)", () => {
    const cases = [
      ...edgeBands({ width: 1000, height: 1500 }, square, "hero").concat(edgeBands({ width: 1600, height: 900 }, square, "hero")).map((band) => ({ band, inset: EDGE_INSET_NATIVE })),
      ...edgeBands({ width: 1000, height: 1500 }, square, "hero", "web").concat(edgeBands({ width: 1600, height: 900 }, square, "hero", "web")).map((band) => ({ band, inset: band.blur * EDGE_INSET_PER_BLUR })),
    ];
    for (const { band, inset } of cases) {
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

  it("refusé (correctif) : la bande prise 21 points dans la photo et étirée le long du bord ; permis : sur l'iPhone, la colonne du bord, à l'échelle de la photo", () => {
    const [left, right] = edgeBands({ width: 1000, height: 1500 }, square, "hero");
    for (const band of [left, right]) {
      // Chaque ligne de la bande prolonge la même ligne de la photo : la copie a la hauteur de la photo, posée sur elle.
      expect(band.copy.top).toBe(0);
      expect(band.copy.height).toBeCloseTo(band.box.height, 6);
      expect(band.fill).toBeUndefined();
    }
    // Le point pris est à 1 point du bord (la colonne même du bord), plus à 3 fois le flou.
    expect(mapped(left, left.box.width - 1 + 1)).toBeCloseTo(left.box.width - 1, 6);
    expect(mapped(left, left.box.width - 1 + 21)).not.toBeCloseTo(left.box.width - 1, 0);
    const [top] = edgeBands({ width: 1600, height: 900 }, square, "hero");
    expect(top.copy.left).toBe(0);
    expect(top.copy.width).toBe(358);
  });

  it("site : la copie visible aussi à l'échelle de la photo ; la copie de dessous, plus longue, remplit seule les bouts que le flou CSS rend transparents", () => {
    for (const band of edgeBands({ width: 1000, height: 1500 }, square, "hero", "web")) {
      expect(band.copy.top).toBe(0);
      expect(band.copy.height).toBeCloseTo(band.box.height, 6);
      const inset = band.blur * EDGE_INSET_PER_BLUR;
      expect(band.fill).toEqual({ ...band.copy, top: -inset, height: band.copy.height + 2 * inset });
    }
    for (const band of edgeBands({ width: 1600, height: 900 }, square, "hero", "web")) {
      const inset = band.blur * EDGE_INSET_PER_BLUR;
      expect(band.fill).toEqual({ ...band.copy, left: -inset, width: band.copy.width + 2 * inset });
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
    expect(tile).toContain('const bands = background || !shownUri ? [] : edgeBands(naturalSize, frame, variant, Platform.OS === "web" ? "web" : "native");');
    // La copie de dessous (site seulement) est dessinée avant, donc sous la copie visible.
    expect(tile.indexOf("style={[styles.bandCopy, band.fill, { transform: band.transform }]}")).toBeGreaterThan(-1);
    expect(tile.indexOf("style={[styles.bandCopy, band.fill, { transform: band.transform }]}")).toBeLessThan(tile.indexOf("style={[styles.bandCopy, band.copy, { transform: band.transform }]}"));
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
    expect(screen).toContain('marks: { flexDirection: "row", flexWrap: "wrap", columnGap: space.sm, alignItems: "center", alignSelf: "flex-start", minHeight: 32, marginVertical: -8 }');
    // Refusé : la rangée vide des mentions qui tirerait le bouton sur le prix.
    expect(screen).toContain('{selectedIndex === cheapest || piece.offerMark || typeof piece.inStock === "boolean" ? (\n              <View');
  });
});

describe("3 · correctif : « Ce n'est pas la bonne pièce ? » ne grandit plus la ligne du prix, et les mentions ne le recouvrent pas", () => {
  const screen = read("src/app/(app)/spot/result.tsx");
  const link = read("src/components/spot-corrections.tsx");
  const style = (source: string, name: string) => source.match(new RegExp(`\\n  ${name}: \\{([^}]*)\\}`))?.[1] ?? "";

  it("refusé : le lien de 44 points posé tel quel sur la ligne du prix (elle passait de 18 à 44 points) ; permis : 18 points dans la ligne, 44 de zone vers le haut", () => {
    const row = screen.slice(screen.indexOf("<View style={styles.metaRow}"), screen.indexOf("<ForeignShopNote piece={piece} />"));
    expect(row).toContain("<CorrectionsLink inline ");
    expect(row).not.toContain("styles.notRight");
    // La boîte garde 44 points (le site ignore les zones élargies), dont 26 au-dessus de la ligne : la ligne ne compte que 18.
    expect(style(link, "link")).toContain("minHeight: 44");
    expect(style(link, "linkInline")).toContain("minHeight: 44, marginTop: -CORRECTIONS_LINK_OVERFLOW_UP, paddingTop: CORRECTIONS_LINK_OVERFLOW_UP");
    expect(link).toContain("export const CORRECTIONS_LINK_OVERFLOW_UP = 26;");
    expect(44 - 26).toBe(18);
    expect(style(screen, "meta")).toContain("lineHeight: 18");
    expect(style(link, "linkLabelInline")).toContain("lineHeight: 18");
    // Jamais vers le bas, où sont les mentions.
    expect(style(link, "linkInline")).not.toContain("marginBottom");
  });

  it("« Le moins cher » sur la rangée des mentions : pas de ligne de plus sous le prix", () => {
    const card = screen.slice(screen.indexOf("<View style={styles.metaRow}"), screen.indexOf("{piece.merchantUrl ? (\n              <Pressable style={styles.primary}"));
    expect(card.indexOf("<CheapestBadge inline />")).toBeGreaterThan(card.indexOf("<View style={[styles.marks"));
    expect(card.match(/<CheapestBadge/g)).toHaveLength(1);
  });

  it("refusé (correctif) : sous le lien, les mentions descendues de 14 points (la rangée d'actions passait sous le bas de l'écran) ; permis : même hauteur, la ligne du prix au-dessus pour le toucher", () => {
    // Refusé : une marge de plus, mesurée après coup (l'écran sautait de 14 points au premier dessin).
    expect(screen).not.toContain("marksUnderLink");
    expect(screen).not.toContain("setMarksRight");
    expect(read("src/lib/text-fit.ts")).not.toContain("marksUnderLink");
    expect(link).not.toContain("onLayout");
    // Permis : les mentions remontent toujours de 8 points (6 avec « Le moins cher »), dans tous les cas.
    expect(screen).toContain("<View style={[styles.marks, selectedIndex === cheapest ? styles.marksWithBadge : null]}>");
    expect(style(screen, "marks")).toContain("marginVertical: -8");
    expect(style(screen, "marksWithBadge")).toBe(" marginTop: -6 ");
    // La ligne du prix passe au-dessus (zIndex) : le lien gagne les 8 points de recouvrement et la zone élargie des mentions ;
    // son vide laisse passer le toucher vers les mentions (box-none).
    expect(style(screen, "metaRow")).toContain("zIndex: 1");
    expect(screen).toContain('<View style={styles.metaRow} pointerEvents="box-none">');
    expect(screen.indexOf('<View style={styles.metaRow} pointerEvents="box-none">')).toBeLessThan(screen.indexOf("<View style={[styles.marks"));
    expect(read("src/components/stock-note.tsx")).toContain("hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}");
    expect(read("src/components/offer-mark.tsx")).toContain("hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}");
  });
});

describe("5 · le prix n'est jamais coupé ; 4 · le rythme d'« Autres propositions »", () => {
  const card = read("src/components/proposal-card.tsx");
  const style = (name: string) => card.match(new RegExp(`\\n  ${name}: \\{([^}]*)\\}`))?.[1] ?? "";

  it("refusé : un seul texte « boutique · prix » tronqué ; permis : la boutique rétrécit (une ligne), le prix ne rétrécit pas", () => {
    expect(card).not.toContain('{[piece.merchantName, price].filter(Boolean).join(" · ")}');
    expect(card).toContain("<ShopAndPrice shop={piece.merchantName} price={price} />");
    expect(card).toMatch(/<Text style=\{\[styles\.cardMeta, styles\.cardShop\]\} numberOfLines=\{1\}>/);
    expect(style("cardShop")).toContain("flexShrink: 1");
    expect(style("cardPrice")).toContain("flexShrink: 0");
    expect(style("cardMetaRow")).toContain('flexDirection: "row"');
  });

  it("« Voir chez … › » sur une ligne : le libellé souligné raccourci, le chevron hors du texte raccourci et du soulignement", () => {
    const link = card.slice(card.indexOf("<View style={styles.shopLinkLine}>"), card.indexOf("</Pressable>", card.indexOf("<View style={styles.shopLinkLine}>")));
    expect(link).toContain("<Text style={styles.shopLinkLabel} numberOfLines={1}>");
    expect(link).toMatch(/<\/Text>\s*<Text style=\{styles\.shopLinkChevron\}>\{"\\u00a0›"\}<\/Text>/);
    expect(card).not.toContain("<Text numberOfLines={2}>");
    expect(style("shopLinkLabel")).toContain("flexShrink: 1");
    expect(style("shopLinkChevron")).toContain("flexShrink: 0");
    expect(style("shopLinkChevron")).not.toContain("lienSouligne");
  });

  it("« Le moins cher » posé sur la photo (les lignes de la carte ne bougent plus), bornée à la tuile ; ailleurs, la pastille d'avant", () => {
    expect(card).toContain("{cheapest ? <CheapestBadge onTile /> : null}");
    // Refusé (correctif) : une pastille absolue sans bord droit, qui débordait de la tuile au grand texte.
    expect(style("badgeOnTile")).not.toContain('position: "absolute"');
    // Permis : une zone posée à 8 points des deux bords, la pastille à sa largeur de contenu dedans.
    expect(style("badgeOnTileZone")).toContain('position: "absolute", top: space.sm, left: space.sm, right: space.sm, alignItems: "flex-start"');
    expect(style("badgeOnTile")).toContain('maxWidth: "100%"');
    expect(card).toContain('<View style={styles.badgeOnTileZone} pointerEvents="none">');
    // La ligne triée par prix garde sa pastille sous le prix.
    expect(card).toContain("{cheapest ? <CheapestBadge /> : null}");
  });

  it("rythme : mention remontée vers le prix, lien vers la mention ; rangée des mentions absente quand il n'y a rien à dire (ni chez la voisine)", () => {
    expect(style("marks")).toContain("marginTop: -5, marginBottom: -8");
    expect(style("shopLinkTight")).toContain("marginTop: -6");
    expect(card).toContain("{marksRow ? (\n        <View style={styles.marks}>");
    expect(card).toContain("const marksRow = hasMarks(piece) || rowHasMarks === true;");
    // Correctif : la marge négative du lien seulement sans rangée de mentions au-dessus.
    expect(card).toContain("<ShopLink piece={piece} placement={placement} tight={!marksRow} />");
    // Zones touchables gardées.
    expect(style("shopLink")).toContain("minHeight: size.touchTarget");
  });

  it("refusé (correctif) : « Voir chez … » qui recouvre le texte de « En stock » ; permis : les marges négatives restent dans le vide sous ce texte", () => {
    // Mentions de 32 points, texte de 12 centré : environ 8 points vides sous le texte.
    const noteHeight = 32;
    const labelLine = 12 * 1.25;
    const emptyBelow = (noteHeight - labelLine) / 2;
    const marksBottom = Number(style("marks").match(/marginBottom: (-?\d+)/)?.[1]);
    const linkTop = card.includes("tight={!marksRow}") ? 0 : Number(style("shopLinkTight").match(/marginTop: (-?\d+)/)?.[1]);
    expect(-(marksBottom + linkTop)).toBeLessThanOrEqual(emptyBelow);
    expect(read("src/components/stock-note.tsx")).toContain('minHeight: 32 }');
    // L'ancien cumul (-8 puis -6) aurait mordu sur le texte.
    expect(8 + 6).toBeGreaterThan(emptyBelow);
  });

  it("deux cartes d'une rangée : la rangée des mentions réservée dans les deux dès que l'une en a (cartes alignées)", () => {
    const none = {};
    const stock = { inStock: true };
    // Permis : la voisine en a une, la rangée est réservée chez les deux (0 et 1) ; refusé : une rangée sans aucune mention.
    expect(rowHasMarksAt([stock, none, none, none], 1)).toBe(true);
    expect(rowHasMarksAt([stock, none, none, none], 0)).toBe(true);
    expect(rowHasMarksAt([stock, none, none, none], 2)).toBe(false);
    expect(rowHasMarksAt([stock, none, none, none], 3)).toBe(false);
    // Carte seule en fin de grille.
    expect(rowHasMarksAt([none, none, none], 2)).toBe(false);
    expect(rowHasMarksAt([none, none, { inStock: false }], 2)).toBe(true);
    expect(style("marks")).toContain("minHeight: 32");
    for (const path of ["src/app/(app)/spot/result.tsx", "src/components/result-complement.tsx", "src/components/no-price-section.tsx"]) {
      expect(read(path), path).toContain("rowHasMarks={rowHasMarksAt(list.map((entry) => entry.piece), i)}");
    }
  });
});

describe("6 · petites largeurs et grand texte (lib/text-fit.ts)", () => {
  const actions = [fr.result.keep, fr.result.markAsBought, fr.result.share, fr.result.moreShort];
  const actionsEn = [en.result.keep, en.result.markAsBought, en.result.share, en.result.moreShort];

  it("estimation large : « Je l'ai achetée » en 12 points au moins aussi large que mesuré sur le site (83 points)", () => {
    expect(estimatedTextWidth("Je l'ai achetée", 12, 1)).toBeGreaterThanOrEqual(83);
    expect(estimatedTextWidth("Je l'ai achetée", 12, 1.3)).toBeCloseTo(estimatedTextWidth("Je l'ai achetée", 12, 1) * 1.3, 6);
    // Un texte plus petit que la normale n'est jamais compté plus étroit.
    expect(estimatedTextWidth("abc", 12, 0.8)).toBe(estimatedTextWidth("abc", 12, 1));
  });

  it("rangée soudée : une rangée de quatre à 390 pt ; deux rangées de deux à 320 pt, et à 390 pt texte × 1,3", () => {
    expect(actionsInTwoRows(390, 1, actions)).toBe(false);
    expect(actionsInTwoRows(320, 1, actions)).toBe(true);
    expect(actionsInTwoRows(390, 1.3, actions)).toBe(true);
    // Anglais : « I bought it » tient à 390 comme à 375.
    expect(actionsInTwoRows(390, 1, actionsEn)).toBe(false);
    expect(actionsInTwoRows(375, 1, actionsEn)).toBe(false);
    // Le site large (480 au plus) : une rangée.
    expect(actionsInTwoRows(1280, 1, actions)).toBe(false);
  });

  it("« Partager le look » ne compte pas : une rangée à 390 pt (FR, texte normal) ; deux à 320 pt et à 390 pt texte × 1,3", () => {
    const screen = read("src/app/(app)/spot/result.tsx");
    expect(screen).toContain("const actionLabels = [t.result.keep, t.result.markAsBought, t.result.share, ...(piece.real ? [t.result.moreShort] : [])];");
    expect(screen).not.toMatch(/const actionLabels = [^\n]*t\.look\.share/);
    // Refusé : avec « Partager le look » (16 caractères), la rangée passait à deux rangées à 390 pt.
    expect(actionsInTwoRows(390, 1, [...actions.slice(0, 2), fr.look.share, actions[3]])).toBe(true);
    // Permis : les libellés qui doivent tenir sur une ligne.
    expect(actionsInTwoRows(390, 1, actions)).toBe(false);
    expect(actionsInTwoRows(393, 1, actions)).toBe(false);
    expect(actionsInTwoRows(320, 1, actions)).toBe(true);
    expect(actionsInTwoRows(390, 1.3, actions)).toBe(true);
  });

  it("fiche d'une envie : côte à côte à 390 pt ; l'un sous l'autre à 320 pt et à 390 pt texte × 1,3 ; un seul bouton, jamais « empilé »", () => {
    const pair = [fr.result.markAsBought, fr.wishAlerts.bellOff];
    expect(pairStacked(390, 1, pair)).toBe(false);
    expect(pairStacked(320, 1, pair)).toBe(true);
    expect(pairStacked(390, 1.3, pair)).toBe(true);
    expect(pairStacked(320, 1, [fr.result.markAsBought])).toBe(false);
  });

  it("textes d'attente : le long s'il tient dans le champ mesuré, sinon le court ; largeur inconnue : le court si le texte est agrandi", () => {
    expect(placeholderFor(fr.player.linkLabel, fr.player.linkPlaceholderShort, 210, 16, 1)).toBe(fr.player.linkLabel);
    expect(placeholderFor(fr.player.linkLabel, fr.player.linkPlaceholderShort, 140, 16, 1)).toBe(fr.player.linkPlaceholderShort);
    expect(placeholderFor(fr.player.linkLabel, fr.player.linkPlaceholderShort, 210, 16, 1.3)).toBe(fr.player.linkPlaceholderShort);
    expect(placeholderFor(fr.player.linkLabel, fr.player.linkPlaceholderShort, 0, 16, 1)).toBe(fr.player.linkLabel);
    expect(placeholderFor(fr.player.linkLabel, fr.player.linkPlaceholderShort, 0, 16, 1.3)).toBe(fr.player.linkPlaceholderShort);
    // Les textes courts tiennent là où les longs étaient coupés (captures du rapport des yeux : 320 pt).
    expect(estimatedTextWidth(fr.player.linkPlaceholderShort, 16, 1)).toBeLessThan(140);
    expect(estimatedTextWidth(fr.retrouverPieces.historySearchPlaceholderShort, 15, 1.3)).toBeLessThan(200);
    expect([en.player.linkPlaceholderShort, en.retrouverPieces.historySearchPlaceholderShort]).toEqual(["Video link", "Search"]);
    expect([fr.player.linkPlaceholderShort, fr.retrouverPieces.historySearchPlaceholderShort]).toEqual(["Lien de la vidéo", "Rechercher"]);
  });

  it("les écrans s'en servent : rangée d'actions, fiche d'une envie, trois champs (le nom lu reste le libellé entier)", () => {
    const screen = read("src/app/(app)/spot/result.tsx");
    expect(screen).toContain("const wideText = actionsInTwoRows(windowWidth, fontScale, actionLabels, actionCount);");
    expect(screen).not.toContain("fontScale > 1.3");
    expect(screen).toMatch(/\n  action: \{[^}]*justifyContent: "flex-start"/);
    expect(screen).toMatch(/\n  actionHalf: \{[^}]*justifyContent: "flex-start"/);
    const envie = read("src/app/(app)/envie.tsx");
    expect(envie).not.toContain("fontScale > 1.3");
    expect(envie).toContain('flexDirection: pairStackedNow ? "column" : "row"');
    const link = read("src/components/link-entry.tsx");
    expect(link).toContain("accessibilityLabel={label}");
    expect(link).toContain("onLayout={(event) => setInputWidth(event.nativeEvent.layout.width)}");
    const history = read("src/components/recent-searches.tsx");
    expect(history).toContain("placeholder={placeholderFor(t.retrouverPieces.historySearchPlaceholder, t.retrouverPieces.historySearchPlaceholderShort, inputWidth, font.secondary, fontScale)}");
    expect(history).toContain("accessibilityLabel={t.retrouverPieces.historySearchLabel}");
    const views = read("src/components/spot-launch-views.tsx");
    expect(views).toContain("shortPlaceholder={t.launch.photoLabel}");
    expect(views).toContain("label={t.launch.photoLabel}");
  });

  it("Résultat : une seule rangée de pastilles qui défile ; titre de la barre à la taille de « Fermer », jamais sous lui", () => {
    const bar = read("src/components/result-sort-bar.tsx");
    expect(bar).toContain("<ScrollView horizontal showsHorizontalScrollIndicator={false}");
    const screen = read("src/app/(app)/spot/result.tsx");
    expect(screen).toMatch(/\n  navTitle: \{[^}]*fontSize: font\.body/);
    expect(screen).toMatch(/\n  close: \{[^}]*fontSize: font\.body/);
    expect(screen).toContain("{ left: titleInset, right: titleRight }");
  });
});

describe("7 · l'accueil : la date courte des cases, le maillon du lien", () => {
  // Heure locale de l'appareil, comme l'écran (tests/retrouver-pieces.test.ts).
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const NOW = new Date(2026, 10, 26, 15);

  it("français : « Lun. 23 nov. » ; « Aujourd'hui » et « Hier » gardés ; « 1er » ; l'année d'une autre année", () => {
    expect(recentDayShort(at(2026, 11, 23), "fr", NOW)).toBe("Lun. 23 nov.");
    expect(recentDayShort(at(2026, 11, 26, 8), "fr", NOW)).toBe("Aujourd'hui");
    expect(recentDayShort(at(2026, 11, 25, 23), "fr", NOW)).toBe("Hier");
    expect(recentDayShort(at(2026, 11, 1), "fr", NOW)).toBe("Dim. 1er nov.");
    expect(recentDayShort(at(2025, 12, 30), "fr", NOW)).toBe("Mar. 30 déc. 2025");
  });

  afterEach(() => setActiveLocale("fr"));

  it("anglais : « Mon, Nov 23 » ; « Today » et « Yesterday » gardés", () => {
    setActiveLocale("en");
    expect(recentDayShort(at(2026, 11, 23), "en", NOW)).toBe("Mon, Nov 23");
    expect(recentDayShort(at(2026, 11, 26, 8), "en", NOW)).toBe("Today");
    expect(recentDayShort(at(2026, 11, 25, 9), "en", NOW)).toBe("Yesterday");
  });

  it("refusé : la date longue écrite sur la case ; permis : lue par VoiceOver ; la boutique raccourcie avant la date", () => {
    const tile = read("src/components/recent-searches.tsx");
    expect(tile).toContain("const day = recentDayShort(entry.createdAt, getActiveLocale());");
    expect(tile).toContain("const spoken = [recentDayLabel(entry.createdAt, getActiveLocale()), piece.merchantName]");
    expect(tile).toContain("accessibilityLabel={`${piece.name}, ${spoken}`}");
    expect(tile).not.toMatch(/<Text style=\{styles\.meta\} numberOfLines=\{1\}>\s*\{meta\}/);
    // La date ne rétrécit pas avant la boutique, mais reste bornée à la case (refusé : elle débordait au grand texte).
    expect(tile).toMatch(/\n  metaDay: \{ flexShrink: 0, maxWidth: "100%" \}/);
    expect(tile).not.toMatch(/\n  metaDay: \{ flexShrink: 0 \}/);
    expect(tile).toMatch(/\n  metaShop: \{ flexShrink: 1 \}/);
    // La date longue reste celle d'avant (tests/retrouver-pieces.test.ts).
    expect(recentDayLabel(at(2026, 11, 23), "fr", NOW)).toBe("lundi 23 novembre");
  });

  it("l'icône du lien : le maillon de la maquette (refusé : l'ancien tracé en « S »)", () => {
    const icons = read("src/components/icons.tsx");
    const link = icons.slice(icons.indexOf("export function LinkIcon("), icons.indexOf("export function CameraIcon("));
    expect(link).toContain('d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"');
    expect(link).toContain('viewBox="0 0 24 24"');
    expect(icons).not.toContain("M7 11l4-4M6.5 4.5");
  });
});

describe("8 · Réglages : les choix cohérents (maquette 7)", () => {
  const blocks = ["src/components/messages-from-setting.tsx", "src/components/mentions-from-setting.tsx", "src/components/piece-sends-setting.tsx"];
  const values = (source: string) => [...source.matchAll(/\{ value: "(everyone|following|nobody)", label: ([^ }]+) \}/g)].map((m) => [m[1], m[2]] as const);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelOf = (catalog: any, path: string) => path.split(".").slice(1).reduce((node: any, key) => node[key], catalog) as string;

  it("même ordre dans chaque bloc « Qui peut… » : du plus ouvert au plus fermé (refusé : « Comptes que je suis » en premier)", () => {
    for (const path of blocks) {
      expect(values(read(path)).map(([value]) => value), path).toEqual(["everyone", "following", "nobody"]);
    }
  });

  it("mêmes mots pour les mêmes choix (« Comptes que je suis »), sans changer le sens : « Mes amis seulement » reste pour « Qui peut m'écrire »", () => {
    for (const catalog of [fr, en]) {
      const seen = new Map<string, Set<string>>();
      for (const path of blocks) {
        for (const [value, key] of values(read(path))) {
          const words = labelOf(catalog, key);
          if (path.includes("messages-from") && value === "nobody") continue;
          seen.set(value, (seen.get(value) ?? new Set()).add(words));
        }
      }
      for (const [value, words] of seen) expect([...words], `${value}`).toHaveLength(1);
    }
    expect(fr.settings.messagesFromNobody).toBe("Mes amis seulement");
    expect(fr.commentThreads.following).toBe("Comptes que je suis");
  });

  it("une liste simple à cocher (refusé : les grosses pastilles qui s'empilent) ; groupe radio, 44 points, état coché sur le site", () => {
    for (const path of blocks) {
      expect(read(path), path).toContain("<SettingsChoice");
      expect(read(path), path).not.toContain("<SegmentedChoice");
    }
    const settings = read("src/app/(app)/settings.tsx");
    expect(settings).not.toContain("<SegmentedChoice");
    expect(settings.match(/<SettingsChoice/g)).toHaveLength(2);
    const choice = read("src/components/settings-choice.tsx");
    expect(choice).toContain('accessibilityRole="radiogroup"');
    expect(choice).toContain('accessibilityRole="radio"');
    expect(choice).toContain("aria-checked={selected}");
    expect(choice).toContain("row: g.row");
    // Les explications restent, en pied de carte.
    expect(read("src/components/messages-from-setting.tsx")).toContain("<Text style={styles.hint}>{t.settings.messagesFromHint}</Text>");
  });
});

describe("9 · la famille visuelle", () => {
  it("l'analyse d'un lien (iPhone aussi, components/video-link-analysis.tsx) : champ en bloc plein ; gouttière de 16 points (refusé : 24)", () => {
    const analysis = read("src/components/video-link-analysis.tsx");
    expect(analysis.match(/testID="video-link-query"[\s\S]*?\/>/g)?.every((field) => field.includes("boxed"))).toBe(true);
    // Son texte d'attente court, comme les autres champs (6).
    expect(analysis.match(/shortPlaceholder=\{t\.videoLinkAuto\.placeholderShort\}/g)).toHaveLength(2);
    expect([fr.videoLinkAuto.placeholderShort, en.videoLinkAuto.placeholderShort]).toEqual(["ex. la veste en cuir beige", "e.g. the beige leather jacket"]);
    const lecteur = read("src/app/(app)/spot/lecteur.tsx");
    expect(lecteur).toMatch(/\n  content: \{ paddingHorizontal: space\.md,/);
    expect(lecteur).not.toMatch(/\n  content: \{ paddingHorizontal: space\.lg,/);
  });

  it("« Voir chez … » : la même taille (17 points) sur le Résultat et sur la fiche d'une envie", () => {
    expect(read("src/app/(app)/spot/result.tsx")).toMatch(/\n  primaryLabel: \{[^}]*fontSize: font\.body/);
    expect(read("src/components/merchant-link-button.tsx")).toMatch(/\n  primaryLabel: \{[^}]*fontSize: font\.body/);
  });

  it("« Dernier prix vu » : le libellé en gris, la valeur en clair ; phrase d'une autre forme : tout en valeur", () => {
    const envie = read("src/app/(app)/envie.tsx");
    expect(envie).toContain("<Text style={styles.alertDetailLabel}>{lastSeenParts(details.lastPrice).label}</Text>");
    expect(envie).toMatch(/\n  alertDetailLabel: \{ color: color\.acier \}/);
    expect(envie).toContain('const label = t.wishAlerts.lastSeenPrice("");');
    // Le libellé est bien le début de la phrase, en français et en anglais.
    for (const catalog of [fr, en]) expect(catalog.wishAlerts.lastSeenPrice("240 €").startsWith(catalog.wishAlerts.lastSeenPrice(""))).toBe(true);
  });
});
