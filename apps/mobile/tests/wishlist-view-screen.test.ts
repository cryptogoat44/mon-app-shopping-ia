import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

// Écran Envies (2026-11-09) : recherche, tri et total. Pas de rendu de
// composants ici (vitest.config.ts) : les fichiers sont lus, comme pour le tri
// des résultats (result-sort-screen.test.ts) ; la logique elle-même est
// testée dans wishlist-view.test.ts.
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const panel = read("components/wishlist-panel.tsx");
const tools = read("components/wishlist-tools.tsx");
const preferences = read("lib/preferences-context.tsx");

describe("la recherche, en haut de la liste", () => {
  it("un champ avec son libellé (VoiceOver, site) et un texte d'exemple", () => {
    expect(tools).toContain("<TextInput");
    expect(tools).toContain("accessibilityLabel={t.wishlist.searchLabel}");
    expect(tools).toContain("placeholder={t.wishlist.searchPlaceholder}");
    expect(tools).toContain('returnKeyType="search"');
  });

  it("« Effacer la recherche » : un bouton nommé, seulement quand quelque chose est tapé", () => {
    expect(tools).toMatch(/\{query\.length > 0 \? \(\s*<Pressable/);
    expect(tools).toContain('onPress={() => onQueryChange("")}');
    expect(tools).toContain("accessibilityLabel={t.wishlist.clearSearch}");
  });

  it("aucun résultat : le dire, et proposer d'effacer la recherche (dans la collection choisie aussi)", () => {
    expect(panel).toContain('<WishlistSearchEmpty message={t.wishlist.searchEmpty(query.trim(), inCollection)} onClear={() => setQuery("")} />');
    const empty = tools.slice(tools.indexOf("export function WishlistSearchEmpty"));
    expect(empty).toContain('accessibilityRole="button"');
    expect(empty).toContain("{t.wishlist.clearSearch}");
  });
});

describe("le tri, comme sur l'écran Résultat", () => {
  it("trois choix exclusifs, annoncés comme un groupe de boutons radio (état coché aussi sur le site)", () => {
    expect(tools).toContain('accessibilityRole="radiogroup" accessibilityLabel={t.wishlist.sortLabel}');
    expect(tools).toContain('accessibilityRole="radio"');
    expect(tools).toContain("accessibilityState={{ checked: selected }}");
    expect(tools).toContain("aria-checked={selected}");
    for (const [value, label] of [
      ["recent", "t.wishlist.sortRecent"],
      ["price_asc", "t.wishlist.sortPriceAsc"],
      ["price_desc", "t.wishlist.sortPriceDesc"],
    ]) {
      expect(tools).toContain(`{ value: "${value}", label: ${label} }`);
    }
    expect(tools).toContain("onPress={() => (selected ? undefined : onSortChange(option.value))}");
  });

  it("zones tactiles de 44 points au moins (champ, effacer, segments, bouton du résultat vide)", () => {
    expect(tools.match(/minHeight: size\.touchTarget/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("le choix vient de l'appareil ; le changer le garde, avec la puce choisie pour les statistiques", () => {
    expect(panel).toContain("const { wishlistSort: sort, chooseWishlistSort } = usePreferences();");
    expect(panel).toContain("chooseWishlistSort(next, { inCollection });");
  });
});

describe("ce qui est affiché : la puce, puis la recherche, puis le tri", () => {
  it("toutes les envies de la puce sont lues (pages suivantes derrière), puis filtrées et triées", () => {
    expect(panel).toContain("loadAllPages(fetchPage, {");
    expect(panel).toContain("max: WISHLIST_LOAD_MAX,");
    expect(panel).toContain("onFirstPage: (page) => setList((current) => current ?? page),");
    expect(panel).toContain("const view = wishlistView(list?.items ?? [], { query, sort, country: searchCountryFrom(acceptLanguage()) });");
    expect(panel).toContain("data={chunk(view.visible, 3)}");
    // Une autre puce choisie abandonne la lecture en cours.
    const choose = panel.slice(panel.indexOf("function choose("), panel.indexOf("function changeSort("));
    expect(choose).toContain("loadRun.current += 1;");
  });

  it("le total : en attente tant que des pages restent à lire ; sinon sur les envies affichées, avec la puce ou la recherche", () => {
    expect(panel).toContain("? { text: t.wishlist.totalLoading, label: t.wishlist.totalLoading }");
    expect(panel).toContain(": wishlistTotalText(view.total, wishlistScope(query, inCollection), getActiveLocale());");
    expect(panel).toContain("t.wishlist.partialNote(list.items.length)");
  });

  it("recherche, tri et total en tête de liste, seulement quand il y a des envies", () => {
    expect(panel).toContain("{hasItems ? <WishlistTools query={query} onQueryChange={setQuery} sort={sort} onSortChange={changeSort} total={totalLine} note={partialNote} /> : null}");
    const header = panel.slice(panel.indexOf("ListHeaderComponent={"), panel.indexOf("ListEmptyComponent={"));
    expect(header).toContain("<WishlistTools");
  });

  it("la ligne du total est lue avec des virgules et annoncée quand elle change", () => {
    expect(tools).toContain('accessibilityLabel={total.label} accessibilityLiveRegion="polite"');
  });

  it("le prix de chaque envie reste affiché sur sa carte", () => {
    expect(panel).toContain("{displayPrice(item) ? <Text style={styles.price}>{displayPrice(item)}</Text> : null}");
  });

  it("le clavier ne bloque pas les boutons de la liste (effacer, puces)", () => {
    expect(panel).toContain('keyboardShouldPersistTaps="handled"');
  });
});

describe("tri gardé sur l'appareil, statistiques sans la recherche", () => {
  it("lu au démarrage avec les autres préférences, écrit à chaque changement (try/catch dans lib/wishlist-view.ts)", () => {
    expect(preferences).toContain("readWishlistSort((key) => AsyncStorage.getItem(key)),");
    expect(preferences).toContain("void saveWishlistSort((key, value) => AsyncStorage.setItem(key, value), next);");
    expect(preferences).toContain('track("wishlist_sort_changed", change);');
  });

  it("jamais le texte tapé dans les statistiques : l'écran n'envoie aucun événement lui-même", () => {
    expect(panel).not.toContain("track(");
    expect(tools).not.toContain("track(");
  });
});

describe("textes en français et en anglais", () => {
  it("la recherche et le tri", () => {
    expect([fr.wishlist.sortRecent, fr.wishlist.sortPriceAsc, fr.wishlist.sortPriceDesc]).toEqual(["Récentes", "Prix croissant", "Prix décroissant"]);
    expect([en.wishlist.sortRecent, en.wishlist.sortPriceAsc, en.wishlist.sortPriceDesc]).toEqual(["Recent", "Price: low to high", "Price: high to low"]);
    expect(fr.wishlist.sortLabel).toBe("Trier vos envies");
    expect(en.wishlist.sortLabel).toBe("Sort your wishlist");
    expect(fr.wishlist.searchLabel).toBe("Rechercher dans vos envies, par nom ou par boutique");
    expect(en.wishlist.searchLabel).toBe("Search your wishlist by name or shop");
    expect(fr.wishlist.clearSearch).toBe("Effacer la recherche");
    expect(en.wishlist.clearSearch).toBe("Clear search");
    expect(fr.wishlist.searchEmpty("veste", false)).toBe("Aucune envie ne correspond à « veste ».");
    expect(fr.wishlist.searchEmpty("veste", true)).toBe("Aucune envie de cette collection ne correspond à « veste ».");
    expect(en.wishlist.searchEmpty("jacket", false)).toBe("No wishes match “jacket”.");
  });

  it("la ligne du total, au singulier et au pluriel", () => {
    expect(fr.wishlist.totalLine(12, "1 249 €", "all")).toBe("12 envies · total 1 249 €");
    expect(fr.wishlist.totalLine(1, "120 €", "search")).toBe("1 envie trouvée · total 120 €");
    expect(fr.wishlist.noPriceLine(3, "collection")).toBe("3 envies dans cette collection · aucun prix indiqué");
    expect(fr.wishlist.totalWithoutPrice(2)).toBe("+ 2 sans prix");
    expect(fr.wishlist.totalOtherCurrency(1)).toBe("+ 1 dans une autre devise");
    expect(fr.wishlist.totalOtherCurrency(3)).toBe("+ 3 dans d'autres devises");
    expect(en.wishlist.totalLine(1, "€120", "all")).toBe("1 wish · total €120");
    expect(en.wishlist.totalLine(12, "€1,249", "collection")).toBe("12 wishes in this collection · total €1,249");
    expect(en.wishlist.totalOtherCurrency(2)).toBe("+ 2 in other currencies");
    expect(en.wishlist.totalWithoutPrice(1)).toBe("+ 1 without a price");
  });

  it("vouvoiement, jamais de tutoiement", () => {
    const french = [fr.wishlist.searchLabel, fr.wishlist.sortLabel, fr.wishlist.partialNote(480), fr.wishlist.totalLoading].join(" ");
    expect(french).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    expect(fr.wishlist.partialNote(480)).toBe("Calculé sur les 480 envies chargées : faites défiler pour voir les suivantes.");
  });
});
