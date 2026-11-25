import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import {
  HISTORY_PAGE_SIZE,
  HISTORY_SEARCH_DELAY_MS,
  historyCursor,
  matchesHistoryQuery,
  mergeHistoryPage,
  normalizeHistoryQuery,
  recentSearchesPath,
  reopenParams,
} from "../src/lib/recent-searches";

// Retours du build 2, lot « historique » (« je veux par défaut qu'on voit
// tout l'historique des recherches en descendant et pourquoi pas pouvoir
// rechercher les choses qu'on a déjà recherchées ») : « Récemment spottées »
// devient la liste de l'accueil de Spotter, par pages de 20, avec une
// recherche dans l'historique. Chaque règle : un cas refusé, un cas permis.
const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
/** Code sans ses commentaires de ligne. */
const code = (path: string) => source(path).replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const entry = (searchId: string, createdAt = "2026-11-24T10:00:00+00:00") => ({ searchId, createdAt });

describe("pages de l'historique : fusion, fin, curseur", () => {
  it("refusé : une recherche déjà affichée (serveur plus ancien qui ignore `before`) ; permis : les nouvelles, dans l'ordre", () => {
    const current = [entry("a"), entry("b")];
    const same = mergeHistoryPage(current, [entry("a"), entry("b")]);
    expect(same.added).toBe(0);
    expect(same.entries.map((e) => e.searchId)).toEqual(["a", "b"]);
    const next = mergeHistoryPage(current, [entry("b"), entry("c"), entry("d"), entry("c")]);
    expect(next.added).toBe(2);
    expect(next.entries.map((e) => e.searchId)).toEqual(["a", "b", "c", "d"]);
    // La liste de départ n'est jamais modifiée.
    expect(current.map((e) => e.searchId)).toEqual(["a", "b"]);
  });

  it("une page vide n'ajoute rien : c'est la fin ; le curseur est la date de la dernière ligne", () => {
    expect(mergeHistoryPage([entry("a")], []).added).toBe(0);
    expect(historyCursor([])).toBeNull();
    expect(historyCursor([entry("a", "2026-11-24T10:00:00+00:00"), entry("b", "2026-11-23T09:00:00.123456+00:00")])).toBe("2026-11-23T09:00:00.123456+00:00");
    expect(HISTORY_PAGE_SIZE).toBe(20);
  });

  it("le texte de la recherche : refusé vide, d'un caractère ou de plus de 60 ; permis sans les blancs autour", () => {
    expect(normalizeHistoryQuery("")).toBeNull();
    expect(normalizeHistoryQuery(" a ")).toBeNull();
    expect(normalizeHistoryQuery("x".repeat(61))).toBeNull();
    expect(normalizeHistoryQuery("  sac noir ")).toBe("sac noir");
    expect(normalizeHistoryQuery("x".repeat(60))).toBe("x".repeat(60));
    expect(HISTORY_SEARCH_DELAY_MS).toBe(350);
  });

  it("l'adresse : refusé — un « + » de fuseau ou des mots tapés laissés tels quels ; permis — chaque valeur encodée, aucun paramètre en trop", () => {
    expect(recentSearchesPath()).toBe("/api/searches");
    expect(recentSearchesPath({ limit: 20 })).toBe("/api/searches?limit=20");
    const path = recentSearchesPath({ limit: 20, before: "2026-11-23T09:00:00.123456+00:00", q: "sac & co #1 ?" });
    expect(path).toBe("/api/searches?limit=20&before=2026-11-23T09%3A00%3A00.123456%2B00%3A00&q=sac%20%26%20co%20%231%20%3F");
    expect(path).not.toContain("+");
    expect(recentSearchesPath({ limit: 20, before: null, q: null })).toBe("/api/searches?limit=20");
  });

  it("serveur plus ancien (sans `q`) : refusé — une pièce qui ne correspond pas aux mots ; permis — le nom, la marque ou la boutique, sans tenir compte de la casse", () => {
    const piece = { productName: "Veste en DAIM marron", brand: "Exemplor", merchantName: "Atelier Nuage" };
    expect(matchesHistoryQuery(piece, "daim")).toBe(true);
    expect(matchesHistoryQuery(piece, "exemplor")).toBe(true);
    expect(matchesHistoryQuery(piece, "nuage")).toBe(true);
    expect(matchesHistoryQuery(piece, "sac")).toBe(false);
    expect(matchesHistoryQuery({ productName: "Sac", brand: null, merchantName: null }, "sac")).toBe(true);
    const client = code("api/client.ts");
    expect(client).toContain("if (q && searches.some((search) => search.matches[0] !== undefined && !matchesHistoryQuery(search.matches[0], q))) throw new HistorySearchUnavailableError();");
  });

  it("une ligne trouvée par la recherche rouvre SA pièce en grand (celle que le serveur renvoie)", () => {
    expect(reopenParams({ searchId: "s1", piece: { id: "piece-qui-correspond" } })).toEqual({ searchId: "s1", matchId: "piece-qui-correspond" });
    expect(code("lib/api.ts")).toContain("authorizedFetch(recentSearchesPath({ limit, ...options }))");
  });
});

describe("l'accueil de Spotter : une liste, l'historique en descendant", () => {
  const home = code("app/(app)/(tabs)/index.tsx");
  const hook = code("lib/use-search-history.ts");

  it("refusé : la rangée horizontale et « Tout voir » ; permis : une FlatList, les lignes de l'historique, la suite au bas de la liste", () => {
    expect(home).not.toMatch(/\bhorizontal\b/);
    expect(home).not.toContain("SeeAllRecentLink");
    expect(home).not.toContain("<ScrollView");
    expect(home).toContain("<FlatList");
    expect(home).toContain("renderItem={({ item }) => <RecentSearchRow entry={item} onOpen={() => openEntry(item)} />}");
    expect(home).toContain("onEndReached={history.loadMore}");
    expect(home).toContain("onEndReachedThreshold={0.5}");
    expect(home).toContain('keyboardShouldPersistTaps="handled"');
    expect(home).toContain("automaticallyAdjustKeyboardInsets");
    expect(home).toContain("list.current?.scrollToOffset({ offset: 0, animated: true })");
    // L'en-tête est un élément, jamais un composant recréé à chaque rendu (les champs perdraient le clavier).
    expect(home).toContain("ListHeaderComponent={header}");
    expect(home).toContain("const header = (");
    // Largeur maximale du site, comme avant.
    expect(home).toContain('maxWidth: 480, alignSelf: "center", width: "100%"');
    // La réouverture : toujours relue sur le serveur, la pièce de la ligne en grand.
    const open = home.slice(home.indexOf("function openEntry("), home.indexOf("const header = ("));
    expect(open.indexOf("clearLastSpotResult();")).toBeLessThan(open.indexOf('router.push({ pathname: "/spot/result", params: reopenParams(entry) });'));
  });

  it("refusé : deux pages demandées à la fois, ou après la fin, un échec ou sans curseur ; permis : la suite avec `before`", () => {
    const more = hook.slice(hook.indexOf("const loadMore = useCallback("), hook.indexOf("const retry = useCallback("));
    expect(more).toContain('if (busyRef.current || current.ended || current.status !== "idle" || before === null) return;');
    expect(more).toContain("getHistoryPage({ before, q: current.query })");
    expect(more).toContain("} else if (merged.added === 0) setEnded(true);");
    // Seule la réponse de la dernière demande compte.
    expect(hook.match(/if \(request !== requestRef\.current\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("« Fin de votre historique » : refusé quand la page ne rapporte que des lignes déjà là (serveur plus ancien qui ignore `before`) ; permis après une page vide", () => {
    const more = hook.slice(hook.indexOf("const loadMore = useCallback("), hook.indexOf("const retry = useCallback("));
    expect(more).toContain("if (page.length === 0) {\n        setEnded(true);\n        setEndConfirmed(true);\n      } else if (merged.added === 0) setEnded(true);");
    expect(more.match(/setEndConfirmed\(true\)/g)).toHaveLength(1);
    expect(home).toContain("if (history.endConfirmed && entries.length > 0) return <Text style={styles.historyEnd}>{t.retrouverPieces.historyEnd}</Text>;");
    expect(home).not.toContain("history.ended &&");
    // Chaque nouveau départ (autre mode, autre recherche) oublie la fin vue.
    expect(hook.match(/setEnded\(false\);\n\s+setEndConfirmed\(false\);/g)).toHaveLength(2);
  });

  it("la recherche : 350 ms après la dernière frappe ; la croix rend tout l'historique tout de suite ; les mots ne sont gardés nulle part", () => {
    expect(hook).toContain("debounceRef.current = setTimeout(() => search(next), HISTORY_SEARCH_DELAY_MS);");
    const clear = hook.slice(hook.indexOf("const clear = useCallback("), hook.indexOf("return {"));
    expect(clear).toContain("search(null);");
    expect(hook).not.toMatch(/AsyncStorage|SecureStore|localStorage|track\(/);
    expect(home).not.toMatch(/track\(/);
  });

  it("le champ : refusé tant que l'historique est vide ou pas encore lu ; permis sous le titre, avec son libellé et sa croix", () => {
    const header = home.slice(home.indexOf("function HistoryHeader("), home.indexOf("function HistoryFooter("));
    expect(header).toContain("if (!failedFirst && (!history.loaded || history.empty)) return null;");
    expect(header.indexOf("{t.spotter.recentlySpotted}")).toBeLessThan(header.indexOf("<HistorySearchField"));
    const field = code("components/recent-searches.tsx");
    expect(field).toContain("accessibilityLabel={t.retrouverPieces.historySearchLabel}");
    expect(field).toContain("accessibilityLabel={t.retrouverPieces.historySearchClear}");
    expect(field).toContain("maxLength={60}");
    expect(field).toContain("minWidth: size.touchTarget, minHeight: size.touchTarget");
  });

  it("chaque état sous la liste : chargement (dit à VoiceOver), aucune correspondance, échec avec « Réessayer », fin de l'historique, recherche indisponible", () => {
    const footer = home.slice(home.indexOf("function HistoryFooter("), home.indexOf("export default function SpotterScreen"));
    expect(footer).toContain("accessibilityLabel={t.retrouverPieces.historyLoading}");
    expect(footer).toContain("t.retrouverPieces.historyNoMatch(query)");
    expect(footer).toContain("t.retrouverPieces.historyMoreFailed");
    expect(footer).toContain("t.retrouverPieces.recentLoadError");
    expect(footer).toContain("onPress={history.retry}");
    expect(footer).toContain("{t.common.retry}");
    expect(footer).toContain("t.retrouverPieces.historyEnd");
    expect(footer).toContain("t.retrouverPieces.historyUnavailable");
    expect(hook).toContain("AccessibilityInfo.announceForAccessibility(page.length === 0 ? t.retrouverPieces.historyNoMatch(q) : t.retrouverPieces.historyResultsShown)");
  });

  it("« Tout voir » quitte l'accueil ; refusé : la note « vos 20 dernières recherches » ; permis : l'adresse /recentes ramène à l'accueil (anciens liens)", () => {
    expect(existsSync(join(__dirname, "../src/app/(app)/recentes.tsx"))).toBe(true);
    expect(code("app/(app)/recentes.tsx")).toContain('<Redirect href="/" />');
    for (const lang of [fr, en]) {
      expect(lang.retrouverPieces).not.toHaveProperty("recentLimitNote");
      expect(lang.retrouverPieces).not.toHaveProperty("seeAll");
    }
    expect(code("components/recent-searches.tsx")).not.toContain("/recentes");
  });
});

describe("textes : français (« vous ») et anglais, à égalité ; politique de confidentialité exacte", () => {
  const keys = ["historySearchPlaceholder", "historySearchLabel", "historySearchClear", "historyEnd", "historyMoreFailed", "historyLoading", "historyUnavailable", "historyResultsShown"] as const;

  it("chaque nouveau texte existe dans les deux langues ; le français vouvoie", () => {
    for (const key of keys) {
      expect(typeof fr.retrouverPieces[key], key).toBe("string");
      expect(typeof en.retrouverPieces[key], key).toBe("string");
      expect(fr.retrouverPieces[key], key).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    }
    expect(fr.retrouverPieces.historyNoMatch("sac noir")).toBe("Aucune recherche ne correspond à « sac noir ».");
    expect(en.retrouverPieces.historyNoMatch("black bag")).toBe("No search matches “black bag”.");
    expect(fr.retrouverPieces.historyMoreFailed).toContain("votre historique");
  });

  it("la recherche dans l'historique est dite : mots envoyés à notre serveur, jamais enregistrés ; la section garde son nom", () => {
    const frText = JSON.stringify(privacyPolicy);
    const enText = JSON.stringify(privacyPolicyEn);
    expect(frText).toContain("L'historique de vos recherches vous est remontré (« Récemment spottées ») ; il est conservé 12 mois (voir « Combien de temps »).");
    expect(frText).toContain(
      "Vous pouvez y rechercher une pièce, une marque ou une boutique : les mots tapés sont envoyés à notre serveur, qui s'en sert seulement pour filtrer votre historique, et ne les enregistre pas."
    );
    expect(enText).toContain(
      "You can search it for a piece, a brand or a shop: the words you type are sent to our server, which only uses them to filter your history, and does not save them."
    );
    expect(fr.spotter.recentlySpotted).toBe("Récemment spottées");
    expect(en.spotter.recentlySpotted).toBe("Recently spotted");
  });
});
