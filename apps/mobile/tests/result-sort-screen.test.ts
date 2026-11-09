import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { formatPrice } from "../src/lib/format";

// Tri des résultats (2026-11-08) : écran Résultat et composants. Pas de rendu
// de composants ici (vitest.config.ts) : les fichiers sont lus, comme pour la
// section « Sans prix » (no-price-section.test.ts) ; la disposition elle-même
// est testée dans result-sort.test.ts (resultLayout).
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const screen = read("app/(app)/spot/result.tsx");
const bar = read("components/result-sort-bar.tsx");
const list = read("components/price-sorted-list.tsx");
const card = read("components/proposal-card.tsx");
const complement = read("components/result-complement.tsx");
const preferences = read("lib/preferences-context.tsx");
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("le contrôle de tri, en haut de la liste", () => {
  it("trois choix exclusifs, annoncés comme un groupe de boutons radio (état coché aussi sur le site)", () => {
    expect(bar).toContain('accessibilityRole="radiogroup" accessibilityLabel={t.result.sortLabel}');
    expect(bar).toContain('accessibilityRole="radio"');
    expect(bar).toContain("accessibilityState={{ checked: selected }}");
    expect(bar).toContain("aria-checked={selected}");
    for (const [value, label] of [
      ["relevance", "t.result.sortRelevance"],
      ["price_asc", "t.result.sortPriceAsc"],
      ["price_desc", "t.result.sortPriceDesc"],
    ]) {
      expect(bar).toContain(`{ value: "${value}", label: ${label} }`);
    }
    // Toucher un choix change le tri, rien d'autre ; le choix en cours ne fait rien.
    expect(bar).toContain("onPress={() => (selected ? undefined : onChange({ ...view, sort: option.value }))}");
  });

  it("« Avec prix seulement » : un interrupteur, avec son libellé et ce qu'il fait", () => {
    expect(bar).toContain('accessibilityRole="switch"');
    expect(bar).toContain("aria-checked={view.withPriceOnly}");
    expect(bar).toContain("accessibilityLabel={t.result.withPriceOnly}");
    expect(bar).toContain("accessibilityHint={t.result.withPriceOnlyHint}");
    expect(bar).toContain("onChange({ ...view, withPriceOnly: !view.withPriceOnly })");
  });

  it("zones tactiles de 44 points au moins", () => {
    expect(bar.match(/minHeight: size\.touchTarget/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("l'écran le place en haut, avant « Votre pièce » et la grande carte ; le choix vient de l'appareil", () => {
    const sortBar = screen.indexOf("<ResultSortBar view={view} onChange={changeView} summary={summaryText} />");
    expect(sortBar).toBeGreaterThan(-1);
    expect(sortBar).toBeLessThan(screen.indexOf("<YourPiece image={yourPiece} />"));
    expect(sortBar).toBeLessThan(screen.indexOf("onLayout={heroReveal.onHeroLayout}"));
    expect(screen).toContain("const { resultView: view, chooseResultView } = usePreferences();");
  });
});

describe("« Pertinence » : l'écran d'avant, dans le même ordre", () => {
  it("la disposition vient de resultLayout (identique à price-first sans filtre, result-sort.test.ts)", () => {
    expect(screen).toContain("const layout = resultLayout(result, view, { selectedIndex, pickedInPriceList, country: startOptions.country });");
  });

  it("mêmes sections, dans le même ordre : autres propositions, ligne d'attente, boutiques, vos mots, « Sans prix »", () => {
    let from = screen.indexOf(") : (", screen.indexOf("{priceSort ? ("));
    for (const marker of ["{t.result.otherProposals}", "<ShopsPending />", '<ResultComplement source="ai"', 'source="words"', "<NoPriceSection", "{textSearch(true)}"]) {
      const at = screen.indexOf(marker, from);
      expect(at, marker).toBeGreaterThan(from);
      from = at;
    }
  });

  it("la grande carte n'est masquée que par le tri par prix ou « Avec prix seulement » (resultLayout) ; elle reste celle de l'écran", () => {
    expect(screen).toContain("const showBigCard = layout.bigCard !== null;");
    expect(screen).toContain("{showBigCard ? (");
    // Toujours la même pièce et les mêmes boutons : `piece`, celle de selectedIndex, jamais une carte de la liste triée.
    expect(screen).toContain("const piece = result ? (allPieces(result)[selectedIndex] ?? null) : null;");
    // Grande carte masquée : « Ce n'est pas la bonne pièce ? » reste en haut de la liste, dans les deux modes.
    const link = screen.indexOf("{!showBigCard && sheetActions.length > 0 ? <CorrectionsLink");
    expect(link).toBeGreaterThan(screen.indexOf("{showBigCard ? ("));
    expect(link).toBeLessThan(screen.indexOf("{priceSort ? ("));
  });

  it("« Le moins cher » sur la carte concernée, grande carte comprise", () => {
    expect(screen).toContain("{selectedIndex === cheapest ? <CheapestBadge /> : null}");
    expect(screen).toContain("cheapest={index === cheapest}");
    expect(screen.match(/cheapestIndex=\{cheapest\}/g)?.length).toBe(3);
    expect(complement).toContain("cheapest={index === cheapestIndex}");
  });
});

describe("tri par prix : une seule liste, sans grande carte ni titre de section", () => {
  it("la liste triée à la place des sections, la ligne d'attente des boutiques en haut", () => {
    const branch = screen.slice(screen.indexOf("{priceSort ? ("), screen.indexOf(") : (", screen.indexOf("{priceSort ? (")));
    expect(branch).toContain("{result.complement?.pending ? <ShopsPending /> : null}");
    expect(branch).toContain(
      '<PriceSortedList key={priceSort} items={layout.priceList ?? []} cheapestIndex={cheapest} onSelect={selectFromPriceList} placements={placements} sendAction={sendFrom("price_list")} stockAction={stockFrom} />'
    );
    expect(branch).not.toContain("sectionTitle");
    expect(branch.indexOf("<ShopsPending />")).toBeLessThan(branch.indexOf("<PriceSortedList"));
  });

  it("une ligne par proposition, posée directement dans la page (aucun cadre autour) ; image et lien séparés, chacun sur sa pièce", () => {
    expect(list).toContain(
      '<ProposalCard variant="row" piece={piece} onSelect={() => onSelect(index)} placement={placements.get(index)} cheapest={index === cheapestIndex} onSend={sendAction?.(piece)} onReportGone={stockAction?.(piece)} />'
    );
    const returned = list.slice(list.indexOf("  return (\n    <>"));
    expect(returned).toMatch(/^ {2}return \(\n {4}<>\n {6}\{visible\.map/);
    // Ligne : la zone touchable (image, nom, prix) puis le lien vers la boutique, jamais l'un dans l'autre.
    const row = card.slice(card.indexOf('if (variant === "row")'), card.indexOf("return (\n    <View style={styles.card}>"));
    expect(row.indexOf("</Pressable>")).toBeLessThan(row.indexOf("<ShopLink piece={piece} placement={placement} />"));
  });

  it("la page ne saute pas quand une boutique arrive au-dessus : position gardée (iPhone), en tri par prix seulement", () => {
    expect(screen).toContain('maintainVisibleContentPosition={priceSort && Platform.OS !== "web" ? { minIndexForVisible: 0 } : undefined}');
    // Les boutiques ensuite ne font jamais défiler l'écran : aucun défilement lié à leur arrivée.
    const shopsEffect = screen.slice(screen.indexOf("const shopsSearchId"), screen.indexOf("const lateQuery"));
    expect(shopsEffect).not.toMatch(/scrollTo|reveal/);
  });

  it("une ligne arrivée après l'affichage apparaît en fondu court (opacité seule), sans fondu avec « Réduire les animations »", () => {
    expect(list).toContain("active={known !== null && !known.has(piece.id) && !reduceMotion}");
    expect(list).toContain("Animated.timing(opacity, { toValue: 1, duration: 220");
    expect(list).toContain("<Animated.View style={{ opacity }}>");
  });

  it("une carte touchée passe en grand avec ses boutons, retenue comme en « Pertinence » ; changer de tri la retire", () => {
    const select = screen.slice(screen.indexOf("function selectFromPriceList"), screen.indexOf("function changeView"));
    expect(select).toContain("updateChoice((current) => chooseCard(current, index, startIndex, placements.get(index)));");
    expect(select).toContain("setPickedInPriceList(true);");
    const change = screen.slice(screen.indexOf("function changeView"), screen.indexOf("/** « Résultats pour vos mots » vient d'arriver"));
    expect(change).toContain("setPickedInPriceList(false);");
    expect(change).toContain("chooseResultView(next);");
  });

  it("vos mots arrivés en tri par prix : ni grande carte ni section à montrer, l'écran ne bouge pas", () => {
    expect(screen).toContain("const reveal = priceSortRef.current ? null : wordsArrivalReveal(result, next, choiceRef.current, startOptions);");
  });
});

describe("choix gardé sur l'appareil (même façon que la langue et l'apparence)", () => {
  it("lu au démarrage avec la langue, écrit à chaque changement, toujours sous try/catch", () => {
    expect(preferences).toContain("parseResultView(await AsyncStorage.getItem(RESULT_VIEW_STORAGE_KEY))");
    expect(preferences).toContain("await AsyncStorage.setItem(RESULT_VIEW_STORAGE_KEY, serializeResultView(next));");
    for (const call of ["AsyncStorage.getItem(RESULT_VIEW_STORAGE_KEY)", "AsyncStorage.setItem(RESULT_VIEW_STORAGE_KEY"]) {
      const before = preferences.slice(0, preferences.indexOf(call));
      expect(before.lastIndexOf("try {"), call).toBeGreaterThan(before.lastIndexOf("catch"));
      expect(preferences.indexOf("} catch {", before.length), call).toBeGreaterThan(before.length);
    }
    expect(preferences).toContain('track("result_view_changed", change);');
  });
});

describe("textes en français et en anglais", () => {
  it("le contrôle, le filtre et la pastille", () => {
    expect([fr.result.sortRelevance, fr.result.sortPriceAsc, fr.result.sortPriceDesc]).toEqual(["Pertinence", "Prix croissant", "Prix décroissant"]);
    expect([en.result.sortRelevance, en.result.sortPriceAsc, en.result.sortPriceDesc]).toEqual(["Relevance", "Price: low to high", "Price: high to low"]);
    expect(fr.result.sortLabel).toBe("Trier les résultats");
    expect(en.result.sortLabel).toBe("Sort results");
    expect(fr.result.withPriceOnly).toBe("Avec prix seulement");
    expect(en.result.withPriceOnly).toBe("With a price only");
    expect(fr.result.cheapestBadge).toBe("Le moins cher");
    expect(en.result.cheapestBadge).toBe("Lowest price");
    // Vouvoiement, jamais de tutoiement.
    expect(fr.result.withPriceOnlyHint).toBe("Masque les propositions sans prix.");
    expect(fr.result.showAllProposals).toBe("Afficher aussi les propositions sans prix");
  });

  it("la ligne des prix, au pluriel et au singulier, prix dans sa devise d'origine", () => {
    expect(plain(fr.result.offersSummary(12, formatPrice(29, "EUR", "fr")))).toBe("12 offres · à partir de 29 €");
    expect(plain(fr.result.offersSummary(1, formatPrice(29.5, "EUR", "fr")))).toBe("1 offre · 29,50 €");
    expect(en.result.offersSummary(12, formatPrice(29, "EUR", "en"))).toBe("12 offers · from €29");
    expect(en.result.offersSummary(1, formatPrice(29, "USD", "en"))).toBe("1 offer · $29");
  });
});
