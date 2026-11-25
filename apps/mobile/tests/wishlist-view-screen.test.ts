import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { searchFieldOpen } from "../src/lib/wishlist-view";

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

  it("retours du build 2 : le champ derrière une loupe nommée ; « Fermer la recherche » efface le texte et ferme le champ", () => {
    expect(tools).toContain("const searching = searchFieldOpen(searchOpened, query);");
    expect(tools).toContain('onPress={() => setSearchOpened(true)}');
    expect(tools).toMatch(/testID="ouvrir-recherche-envies"/);
    expect(tools).toMatch(/onPress=\{\(\) => \{\s*onQueryChange\(""\);\s*setSearchOpened\(false\);\s*\}\}/);
    expect(tools).toContain("accessibilityLabel={t.wishlist.searchClose}");
    // Ouvert d'un geste : le clavier vient tout de suite.
    expect(tools).toContain("autoFocus={searchOpened}");
  });

  it("le champ reste ouvert tant qu'un texte est tapé (refusé : le refermer en gardant un filtre invisible)", () => {
    expect(searchFieldOpen(false, "veste")).toBe(true);
    expect(searchFieldOpen(false, "")).toBe(false);
    expect(searchFieldOpen(true, "")).toBe(true);
  });

  it("aucun résultat : le dire, et proposer d'effacer la recherche (dans la collection choisie aussi)", () => {
    expect(panel).toContain('<WishlistSearchEmpty message={t.wishlist.searchEmpty(query.trim(), inCollection)} onClear={() => setQuery("")} />');
    const empty = tools.slice(tools.indexOf("export function WishlistSearchEmpty"));
    expect(empty).toContain('accessibilityRole="button"');
    expect(empty).toContain("{t.wishlist.clearSearch}");
  });
});

describe("le tri, comme sur l'écran Résultat", () => {
  it("trois choix exclusifs, dans une petite feuille, annoncés comme un groupe de boutons radio (état coché aussi sur le site)", () => {
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
    expect(tools).toMatch(/onPress=\{\(\) => \{\s*if \(!selected\) onSortChange\(option\.value\);\s*setSortOpen\(false\);/);
    // Retours du build 2 : la feuille, ouverte par un bouton qui montre le tri choisi en court et le dit en entier à VoiceOver.
    const sheet = tools.slice(tools.indexOf("<Modal visible={sortOpen}"), tools.indexOf("</Modal>"));
    expect(sheet).toContain('accessibilityRole="radiogroup"');
    expect(sheet).toContain("onRequestClose={() => setSortOpen(false)}");
    expect(tools).toContain("onPress={() => setSortOpen(true)}");
    expect(tools).toContain("accessibilityLabel={t.wishlist.sortButtonLabel(currentSort.label)}");
    expect(tools).toContain("{t.wishlist.sortShort[sort]}");
  });

  it("zones tactiles de 44 points au moins (ligne, champ, loupe et fermer, tri, choix du tri, bouton du résultat vide)", () => {
    expect(tools.match(/minHeight: size\.touchTarget/g)?.length).toBeGreaterThanOrEqual(6);
    expect(tools).toContain("iconButton: { minWidth: size.touchTarget, minHeight: size.touchTarget");
    expect(tools).toMatch(/sortButton: \{\s*minWidth: size\.touchTarget,\s*minHeight: size\.touchTarget/);
    // En grand texte ou à 320 points : la ligne passe à la ligne, jamais une hauteur fixe.
    expect(tools).toContain('row: { flexDirection: "row", flexWrap: "wrap"');
    expect(tools).not.toMatch(/\b(row|sortButton|searchBar|iconButton): \{[^}]*\bheight:/);
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
    expect(panel).toContain("data={loading ? [] : chunk(view.visible, 3)}");
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
    expect(panel).toContain("ListHeaderComponent={header}");
    const header = panel.slice(panel.indexOf("  const header = ("), panel.indexOf("  return (\n    <>"));
    expect(header).toContain("<WishlistTools");
  });

  it("retours du build 2 : tout le haut des Envies défile avec la grille (permis : dans l'en-tête de la liste)", () => {
    const header = panel.slice(panel.indexOf("  const header = ("), panel.indexOf("  return (\n    <>"));
    for (const part of ["{switcher}", 'testID="entree-enregistrees"', 'testID="qui-voit-vos-envies"', 'accessibilityRole="tablist"', 'testID="options-collection"', "<WishAlertNewsBanner", "<WishlistTools"]) {
      expect(header).toContain(part);
    }
  });

  it("refusé : rien de fixe entre les onglets du profil et la grille (ni sous-onglets, ni phrase, ni signet, ni puces)", () => {
    const outside = panel.slice(panel.indexOf("  return (\n    <>"), panel.indexOf("<FlatList"));
    for (const part of ["{switcher}", 'testID="entree-enregistrees"', 'accessibilityRole="tablist"', "<WishlistTools", "<Text style={styles.privateNote}"]) {
      expect(outside).not.toContain(part);
    }
    // « Mes envies » : la liste seule ; « Reçues » : les sous-onglets en haut de sa propre liste.
    // Lot « navigation » : l'en-tête du profil (header) passe tout en haut de chacune des deux listes.
    expect(panel).toContain("<MyWishlist news={news} switcher={switcher} profileHeader={header} />");
    expect(panel).toMatch(/<ScrollView>\s*\{header\}\s*<View style=\{styles\.switcher\}>\{switcher\}<\/View>\s*<ReceivedPieces \/>/);
    // Chargement compris : une seule liste, l'en-tête n'est jamais recréé quand une puce est choisie.
    expect(panel.match(/<FlatList/g)).toHaveLength(1);
    expect(panel).not.toContain("{loading ? (\n        <View");
  });

  it("liste vide (collection neuve ou Envies vides) : le message ne remonte pas sur les puces, qui restent touchables", () => {
    // Le message vide est rendu juste après l'en-tête de la liste (puces,
    // « + Nouvelle collection », « … ») : une marge négative le ferait passer
    // par-dessus et prendre leurs touchers.
    const empty = panel.match(/^  empty: \{[^\n]*\},$/m)?.[0] ?? "";
    // Permis : centré dans la place qui reste sous l'en-tête.
    expect(empty).toContain('flex: 1, alignItems: "center", justifyContent: "center"');
    // Refusé : aucune marge négative qui recouvrirait l'en-tête.
    expect(empty).not.toMatch(/margin\w*: -/);
    expect(panel).toContain("<View style={styles.empty}>\n                <Text style={styles.emptyText}>{t.collections.empty}</Text>");
  });

  it("le signet des publications enregistrées et le cadenas : icônes nommées de 44 points", () => {
    const header = panel.slice(panel.indexOf("  const header = ("), panel.indexOf("  return (\n    <>"));
    expect(header).toMatch(/\{collectionsAvailable\.savedPosts \? \(\s*<Pressable[\s\S]*?accessibilityLabel=\{t\.savedPosts\.listTitle\}/);
    expect(header).toContain("accessibilityLabel={t.wishlist.privacyTitle}");
    expect(header).toContain("accessibilityLabel={t.collections.ownOptionsLabel(selected.name)}");
    expect(panel).toContain("iconButton: { minWidth: size.touchTarget, minHeight: size.touchTarget");
  });

  it("« Qui voit vos Envies » : la phrase de confidentialité, mot pour mot, dans une feuille qui se ferme", () => {
    const sheet = panel.slice(panel.indexOf("<Modal visible={privacyOpen}"), panel.indexOf("</Modal>"));
    expect(sheet).toContain("{t.wishlist.privacyTitle}");
    expect(sheet).toContain("{collectionsAvailable.enabled ? t.wishlist.privateNoteCollections : t.wishlist.privateNote}");
    expect(sheet).toContain("onRequestClose={() => setPrivacyOpen(false)}");
    expect(sheet).toContain("{t.wishlist.privacyOk}");
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

  it("retours du build 2 : les nouveaux textes, en français et en anglais", () => {
    expect(fr.wishlist.privacyTitle).toBe("Qui voit vos Envies");
    expect(en.wishlist.privacyTitle).toBe("Who can see your Wishlist");
    expect([fr.wishlist.privacyOk, en.wishlist.privacyOk]).toEqual(["Compris", "Got it"]);
    expect([fr.wishlist.searchClose, en.wishlist.searchClose]).toEqual(["Fermer la recherche", "Close search"]);
    expect(fr.wishlist.sortShort).toEqual({ recent: "Récentes", price_asc: "Prix ↑", price_desc: "Prix ↓" });
    expect(en.wishlist.sortShort).toEqual({ recent: "Recent", price_asc: "Price ↑", price_desc: "Price ↓" });
    // VoiceOver lit le nom entier du tri, jamais la flèche.
    expect(fr.wishlist.sortButtonLabel(fr.wishlist.sortPriceAsc)).toBe("Trier, actuellement : Prix croissant");
    expect(en.wishlist.sortButtonLabel(en.wishlist.sortPriceDesc)).toBe("Sort, currently: Price: high to low");
    expect(fr.collections.ownOptionsLabel("Montres")).toBe("Options de la collection Montres");
    expect(en.collections.ownOptionsLabel("Watches")).toBe("Options for the collection Watches");
    expect([fr.collections.ownOptionsPosts, en.collections.ownOptionsPosts]).toEqual(["Publications rangées ici", "Posts filed here"]);
    // Titre neutre : il ne promet pas « privées » (un réglage « montrer mes Envies à mes amis » pourra venir).
    expect(fr.wishlist.privacyTitle).not.toMatch(/priv/i);
    expect(en.wishlist.privacyTitle).not.toMatch(/priv/i);
  });

  it("vouvoiement, jamais de tutoiement", () => {
    const french = [fr.wishlist.searchLabel, fr.wishlist.sortLabel, fr.wishlist.partialNote(480), fr.wishlist.totalLoading, fr.wishlist.privacyTitle, fr.wishlist.searchClose, fr.collections.ownOptionsPosts].join(" ");
    expect(french).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    expect(fr.wishlist.partialNote(480)).toBe("Calculé sur les 480 envies chargées : faites défiler pour voir les suivantes.");
  });
});
