import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { surtitre } from "../src/theme/surtitre";
import type { Piece, SpotResult } from "../src/api/types";
import { resultLayout, shownProposalCount, type ResultView } from "../src/lib/result-sort";

// Lot « fidélité aux maquettes » (lot 10, 26 novembre 2026) : les vrais écrans
// ressemblent aux maquettes « Écrin » approuvées par le fondateur (« tout ce
// que tu m'as montré me convient »), dans ses limites : « Envoyer à un ami » et
// « Plus disponible ? » jamais sous « Plus », aucun bouton pour une fonction
// absente, aucune phrase nécessaire retirée. Pas de rendu de composants ici
// (vitest.config.ts) : les fichiers sont lus. Un cas refusé et un cas permis par règle.
const SRC = join(__dirname, "..", "src");
const code = (path: string) => readFileSync(join(SRC, path), "utf8");

/** Un style nommé (`name: { … }`) d'un fichier, tel qu'écrit (styles plats, sur une ou plusieurs lignes). */
function styleOf(source: string, name: string): string {
  const start = source.search(new RegExp(`\\n\\s*${name}: \\{`));
  expect(start, name).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("}", start) + 1);
}

const HOME = "app/(app)/(tabs)/index.tsx";

describe("pièces communes", () => {
  it("surtitre : 11 pt en capitales, défini une fois ; refusé : un surtitre écrit en dur ailleurs", () => {
    expect(surtitre.fontSize).toBe(11);
    expect(surtitre.textTransform).toBe("uppercase");
    expect(surtitre.lineHeight).toBe(14);
    const ecrans = [HOME, "app/(app)/spot/result.tsx", "app/(app)/envie.tsx", "app/(app)/settings.tsx", "components/result-sort-bar.tsx"];
    for (const path of ecrans) expect(code(path), path).not.toContain('textTransform: "uppercase"');
  });

  it("icônes : chevron vers la gauche, lien externe, sac coché ; refusé : l'icône de réglages du Résultat (décision 12)", () => {
    const icons = code("components/icons.tsx");
    expect(icons).toContain('direction: "up" | "down" | "left"');
    expect(icons).toContain("M14.5 6l-6 6 6 6");
    expect(icons).toContain("export function ExternalLinkIcon(");
    expect(icons).toContain("export function BagCheckIcon(");
    expect(icons).not.toContain("SlidersIcon");
  });

  it.each(["app/(app)/spot/lancer.tsx", "app/(app)/spot/lecteur.tsx", "app/(app)/spot/ciblage.tsx", "app/(app)/spot/video.tsx"])(
    "barre du haut de %s : 44 de haut, texte à 16 pt du bord, 17 pt en graisse 400 ; refusé : hitSlop sur la barre",
    (path) => {
      const screen = code(path);
      expect(styleOf(screen, "nav")).toContain("height: 44,");
      expect(styleOf(screen, "nav")).toContain("paddingHorizontal: 8");
      expect(styleOf(screen, "navSide")).toContain("minHeight: 44, minWidth: 44, paddingHorizontal: 8");
      for (const label of ["back", "close"]) expect(styleOf(screen, label)).toContain('fontSize: font.body, fontWeight: "400", color: color.encre');
      expect(screen).not.toMatch(/hitSlop=\{\d+\} style=\{\[?styles\.navSide/);
      expect(screen).not.toContain("height: 47");
    }
  );
});

describe("Spotter (maquettes 1-accueil)", () => {
  const home = code(HOME);
  const entry = code("components/link-entry.tsx");
  const tiles = code("components/spot-entry.tsx");
  const recent = code("components/recent-searches.tsx");

  it("gouttière de 16 pt ; refusé : 24 ; la largeur maximale du site ne change pas", () => {
    expect(styleOf(home, "content")).toContain("paddingHorizontal: space.md");
    expect(styleOf(home, "content")).not.toContain("paddingHorizontal: space.lg");
    expect(styleOf(home, "content")).toContain("maxWidth: 480");
  });

  it("champ du lien : un bloc plein ; refusé : le trait du bas, le texte d'attente supprimé, « Coller » souligné ou de moins de 44 pt", () => {
    expect(entry).not.toContain("t.spotter.linkPlaceholder");
    expect(styleOf(entry, "field")).not.toContain("borderBottomWidth");
    expect(styleOf(entry, "field")).toContain("minHeight: 52");
    expect(styleOf(entry, "field")).toContain("backgroundColor: color.surface");
    expect(styleOf(entry, "field")).toContain('getActiveScheme() === "light" ? 1 : 0');
    expect(styleOf(entry, "field")).not.toMatch(/\bheight: /);
    expect(styleOf(entry, "pasteLabel")).not.toContain("lienSouligne");
    expect(styleOf(entry, "pasteLabel")).toContain("color: color.encre");
    expect(styleOf(entry, "pasteButton")).toContain("minHeight: 44");
    expect(styleOf(entry, "pasteButton")).not.toContain("minHeight: 40");
    // Safari sur iPhone zoome la page sous 16 px : 16 sur le site.
    expect(styleOf(entry, "input")).toContain('fontSize: Platform.OS === "web" ? 16 : font.secondary');
    expect(entry).toContain("placeholder={label}");
    expect(entry).toContain("accessibilityLabel={label}");
    expect(entry).toContain('{Platform.OS === "web" ? <Text style={styles.hint}>{t.player.linkHintWeb}</Text> : null}');
    expect(fr.spotter).not.toHaveProperty("linkPlaceholder");
    expect(en.spotter).not.toHaveProperty("linkPlaceholder");
  });

  it("tuiles pleines aux libellés courts ; refusé : une hauteur fixe", () => {
    expect(styleOf(tiles, "tile")).toContain("minHeight: 76");
    expect(styleOf(tiles, "tile")).not.toMatch(/\n\s*height: /);
    expect(styleOf(tiles, "tile")).toContain("backgroundColor: color.surface");
    expect(tiles).toContain("accessibilityLabel={accessibilityLabel}");
    expect([fr.spotter.tileVideo, fr.spotter.tilePhoto, fr.spotter.tileCamera]).toEqual(["Vidéo", "Photo", "Appareil photo"]);
    expect([en.spotter.tileVideo, en.spotter.tilePhoto, en.spotter.tileCamera]).toEqual(["Video", "Photo", "Camera"]);
    // Toujours lus par VoiceOver, et ailleurs (lecteur, aide).
    for (const catalog of [fr, en]) {
      expect(catalog.spotter.addVideo).toBeTruthy();
      expect(catalog.spotter.addPhoto).toBeTruthy();
      expect(catalog.cameraCapture.takePhoto).toBeTruthy();
    }
  });

  it.each([
    ["fr", fr],
    ["en", en],
  ] as const)("%s : le nom lu de chaque tuile contient son libellé visible (Commande vocale) ; refusé : « Prendre une photo » seul sur la tuile de l'appareil", (_l, catalog) => {
    const lower = (text: string) => text.toLowerCase();
    expect(lower(catalog.spotter.addVideo)).toContain(lower(catalog.spotter.tileVideo));
    expect(lower(catalog.spotter.otherVideo)).toContain(lower(catalog.spotter.tileVideo));
    expect(lower(catalog.spotter.addPhoto)).toContain(lower(catalog.spotter.tilePhoto));
    expect(tiles).toContain("accessibilityLabel={`${t.spotter.tileCamera}, ${t.cameraCapture.takePhoto}`}");
    expect(tiles).not.toContain("accessibilityLabel={t.cameraCapture.takePhoto}");
  });

  // Relecture du lot : le nom lu commence par le mot visible, sur les trois tuiles (comme « Plus, Signaler… »).
  it("le nom lu des tuiles Vidéo et Photo commence par leur libellé visible ; refusé : la phrase seule", () => {
    expect(tiles).toContain("accessibilityLabel={`${t.spotter.tileVideo}, ${videoLabel}`}");
    expect(tiles).toContain("accessibilityLabel={`${t.spotter.tilePhoto}, ${t.spotter.addPhoto}`}");
    expect(tiles).not.toContain("accessibilityLabel={videoLabel}");
    expect(tiles).not.toContain("accessibilityLabel={t.spotter.addPhoto}");
  });

  it("grand texte : le libellé d'une tuile n'est jamais coupé (refusé : numberOfLines) ; la tuile grandit (minHeight, pas height)", () => {
    expect(tiles).toContain("<Text style={styles.tileLabel}>{label}</Text>");
    expect(tiles).not.toMatch(/<Text style=\{styles\.tileLabel\}[^>]*numberOfLines/);
    expect(styleOf(tiles, "tile")).toContain("minHeight: 76,");
    expect(styleOf(tiles, "tile")).not.toMatch(/\bheight:/);
  });

  it("les phrases qui nommaient les tuiles suivent leur nouveau nom ; refusé : l'ancien nom entre guillemets", () => {
    const anciens = ["« Ajouter une vidéo »", "« Ajouter une photo »", "« Prendre une photo »", "“Add a video”", "“Add a photo”", "“Take a photo”"];
    // Espaces insécables ramenés à des espaces : « » s'écrivent des deux façons dans les catalogues.
    const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
    for (const path of ["i18n/fr.ts", "i18n/en.ts"]) for (const ancien of anciens) expect(plain(code(path)), `${path} ${ancien}`).not.toContain(ancien);
    expect(home).toContain("t.cameraCapture.unavailable(t.spotter.tilePhoto)");
    expect(home).toContain("t.share.imageUnreadable(t.spotter.tilePhoto)");
    expect(code("components/how-it-works.tsx")).toContain("t.firstTry.howItWorks.steps(t.spotter.tilePhoto)");
    expect(plain(fr.firstTry.howItWorks.steps(fr.spotter.tilePhoto).join(" "))).toContain("« Photo »");
    expect(plain(fr.spotter.latestVideoAskNote)).toContain("« Vidéo »");
    expect(en.settings.latestVideoOff).toContain("“Video”");
  });

  it("tuile « Appareil photo » : iPhone seulement ; refusé : proposée sans condition (le site n'a pas l'appareil)", () => {
    expect(home).toContain('takePhoto: Platform.OS === "ios" ? () => void takePhoto() : undefined,');
    expect(home).not.toMatch(/takePhoto: \(\) => void takePhoto\(\)/);
  });

  it("phrase du quota : gardée, raccourcie, sous le champ de recherche ; refusé : retirée ou au-dessus du champ", () => {
    expect(fr.retrouverPieces.recentLead).toContain("Rouvrir");
    expect(en.retrouverPieces.recentLead).toContain("Reopening");
    const header = home.slice(home.indexOf("function HistoryHeader("), home.indexOf("function HistoryFooter("));
    expect(header.indexOf("<HistorySearchField")).toBeGreaterThan(-1);
    expect(header.indexOf("{t.retrouverPieces.recentLead}")).toBeGreaterThan(header.indexOf("<HistorySearchField"));
  });

  it("« Récemment spottées » en Bodoni 23/34 ; refusé : le titre en police système 17", () => {
    expect(styleOf(home, "recentTitle")).toContain("fontFamily: serifFont");
    expect(styleOf(home, "recentTitle")).toContain("fontSize: font.title, lineHeight: serifLineHeight.title");
    expect(styleOf(home, "recentTitle")).not.toContain("font.body");
  });

  it("grille : 8 pt entre les colonnes, nom sur une ligne ; refusé : deux lignes réservées", () => {
    expect(recent).toContain("cellLeft: { paddingRight: 4 }");
    expect(recent).toContain("cellRight: { paddingLeft: 4 }");
    expect(styleOf(recent, "name")).not.toContain("minHeight");
    expect(recent).toContain("<Text style={styles.name} numberOfLines={1}>");
    expect(styleOf(recent, "searchBar")).toContain("backgroundColor: color.surface");
    expect(styleOf(recent, "searchBar")).not.toContain("radius.full");
  });
});

describe("Résultat, la grande carte (maquettes 4-resultat-grande-carte)", () => {
  const screen = code("app/(app)/spot/result.tsx");
  const bar = code("components/result-sort-bar.tsx");
  const verdict = code("components/verdict-line.tsx");
  const feedback = code("components/result-feedback-sheet.tsx");

  it("gouttière de 16 pt, échec compris ; refusé : 24", () => {
    for (const name of ["content", "failContent"]) {
      expect(styleOf(screen, name)).toContain("paddingHorizontal: space.md");
      expect(styleOf(screen, name)).toContain("maxWidth: 480");
    }
  });

  it("barre : « Fermer » 17/400 sans hitSlop, titre système 15/500 ; la case vide de droite reste (pas d'icône de réglages)", () => {
    expect(styleOf(screen, "nav")).toContain("height: 44,");
    expect(styleOf(screen, "close")).toContain('fontSize: font.body, fontWeight: "400", color: color.encre');
    expect(styleOf(screen, "navTitle")).toContain('fontSize: font.secondary, fontWeight: "500", color: color.encre');
    expect(styleOf(screen, "navTitle")).not.toContain("serifFont");
    const nav = screen.slice(screen.indexOf("const renderNav = "), screen.indexOf("const nav = renderNav("));
    expect(nav).not.toContain("hitSlop");
    expect(nav).toContain('accessibilityRole="header" accessibilityLabel={label}');
    expect(nav).toContain("<View style={styles.navSide} />");
    // Chargement et échec : « Résultats » ; jamais le nombre de la seule recherche visuelle.
    expect(screen).toContain("const nav = renderNav(t.result.title);");
    expect(screen).not.toContain("t.result.count(result.pieces.length");
  });

  // Relecture du lot : au grand texte, le titre posé par-dessus prenait les touchers de « Fermer ».
  it("barre : le titre ne prend aucun toucher et s'écarte de « Fermer » mesuré (permis : 76 au moins)", () => {
    const nav = screen.slice(screen.indexOf("const renderNav = "), screen.indexOf("const nav = renderNav("));
    expect(nav).toContain('<View style={[styles.navTitleZone, { left: titleInset, right: titleInset }]} pointerEvents="none">');
    expect(screen).toContain("const titleInset = Math.max(NAV_TITLE_INSET, closeWidth + 8);");
    expect(screen).toContain("const NAV_TITLE_INSET = 76;");
  });

  it("refusé : un titre de barre en position absolue qui peut recevoir les touchers", () => {
    expect(styleOf(screen, "navTitle")).not.toContain("position: \"absolute\"");
    expect(screen).not.toMatch(/<Text style=\{styles\.navTitle\}[^>]*>\s*\{title\}\s*<\/Text>\s*<View style=\{styles\.navSide\} \/>/);
  });

  it("grande image carrée ; refusé : carrée ailleurs (fiche d'une envie, Vault, look restent en 4:5)", () => {
    expect(screen).toMatch(/<PieceTile\s+variant="hero"\s+enlargeable\s+aspectRatio=\{1\}/);
    expect(styleOf(screen, "heroSkeleton")).toContain("aspectRatio: 1,");
    for (const path of ["components/product-frame.tsx", "app/(app)/envie.tsx", "app/(app)/vault-item/[id].tsx", "app/look.tsx"]) {
      expect(code(path), path).not.toContain("aspectRatio={1}");
    }
    // Le défaut de la tuile reste 4:5 ; la forme donnée ne s'applique que si elle est donnée.
    const tile = code("components/piece-tile.tsx");
    expect(tile).toContain("aspectRatio: 4 / 5");
    expect(tile).toContain("aspectRatio !== undefined ? { aspectRatio } : null");
  });

  it("verdict : la même phrase sans encadré, 13 pt acier ; refusé : fond, filet, demi-gras ; sa boîte reste la première de la liste", () => {
    expect(styleOf(verdict, "box")).not.toContain("backgroundColor");
    expect(styleOf(verdict, "box")).not.toContain("borderWidth");
    expect(styleOf(verdict, "sentence")).toContain("fontSize: font.caption");
    expect(verdict).not.toContain("affirmed");
    // Lot « finitions de l'œil » : « ⓘ » lié au dernier mot par une espace insécable (jamais seul sur une ligne).
    expect(verdict).toContain('{sentence}{"\\u00A0"}<Text style={styles.more}>ⓘ</Text>');
    expect(verdict).not.toContain("{sentence} <Text style={styles.more}>ⓘ</Text>");
    expect(verdict).toContain("<VerdictSheet");
    const list = screen.slice(screen.indexOf("<ScrollView\n        ref={scrollRef}"));
    expect(list.indexOf('testID="verdict-place"')).toBeGreaterThan(-1);
    expect(list.indexOf('testID="verdict-place"')).toBeLessThan(list.indexOf("<ResultSortBar"));
  });

  it("tri : une pastille qui ouvre la feuille des trois tris ; filtres aux libellés courts contenus dans leur nom lu", () => {
    expect(bar).toContain('testID="sort-menu"');
    expect(bar).toContain('accessibilityRole="button"');
    expect(bar).toContain("t.result.sortMenuLabel(");
    expect(bar).toContain("<Modal visible transparent");
    expect(styleOf(bar, "chipZone")).toContain("minHeight: size.touchTarget");
    expect(bar).not.toContain("hitSlop");
    expect(bar).toContain("accessibilityLabel={t.result.withPriceOnly}");
    expect(bar).toContain("accessibilityLabel={t.result.inStockOnly}");
    // Refusé : le libellé court comme nom lu (« seulement » se perdrait pour VoiceOver).
    expect(bar).not.toContain("accessibilityLabel={t.result.withPriceShort}");
    expect(bar).not.toContain("accessibilityLabel={t.result.inStockShort}");
    for (const catalog of [fr, en]) {
      expect(catalog.result.withPriceOnly.toLowerCase()).toContain(catalog.result.withPriceShort.toLowerCase());
      expect(catalog.result.inStockOnly.toLowerCase()).toContain(catalog.result.inStockShort.toLowerCase());
    }
    expect(fr.result.withPriceShort).not.toBe("Avec un prix");
    expect(fr.result.sortMenuLabel("Pertinence")).toBe("Trier les résultats : Pertinence");
    expect(en.result.sortMenuLabel("Relevance")).toBe("Sort results: Relevance");
  });

  it("surtitre de la grande carte : le style commun ; refusé : un demi-gras 13 écrit à la main", () => {
    expect(styleOf(screen, "rankLabel")).toContain("...surtitre, color: color.acier");
    expect(styleOf(screen, "rankLabel")).not.toContain('fontWeight: "600"');
  });

  it("« Ce n'est pas la bonne pièce ? » sur la ligne du prix ; toutes les mentions gardées", () => {
    const row = screen.slice(screen.indexOf("<View style={styles.metaRow}>"), screen.indexOf("<ForeignShopNote piece={piece} />"));
    expect(row).toContain("<CorrectionsLink");
    expect(styleOf(screen, "metaRow")).toContain('flexWrap: "wrap", justifyContent: "space-between"');
    for (const mention of ["<CheapestBadge />", "<ForeignShopNote piece={piece} />", "<OfferMarkNote piece={piece} />", "<StockNote piece={piece} />", "<AffiliateMention"]) {
      expect(screen, mention).toContain(mention);
    }
    expect(styleOf(code("components/stock-note.tsx"), "inStock")).not.toContain('fontWeight: "600"');
  });

  it("« Plus » ne contient que le signalement ; « Envoyer à un ami » et « Plus disponible ? » restent deux liens sous la rangée (limite du fondateur)", () => {
    const actions = screen.slice(screen.indexOf("<View style={[styles.actions"), screen.indexOf("<PieceExtraActions"));
    expect(actions).toContain("<ResultFeedbackButton");
    expect(actions).not.toContain("SendToFriendLink");
    expect(actions).not.toContain("StockReportLink");
    const links = screen.slice(screen.indexOf("<View style={styles.quietLinks}>"));
    expect(links.indexOf("<SendToFriendLink")).toBeGreaterThan(-1);
    expect(links.indexOf("<StockReportLink")).toBeGreaterThan(-1);
    expect(screen.indexOf("<View style={styles.quietLinks}>")).toBeGreaterThan(screen.indexOf("<View style={[styles.actions"));
    expect(feedback).toContain("accessibilityLabel={`${t.result.moreShort}, ${t.result.reportMenuLabel}`}");
    expect(feedback).not.toContain("SendToFriendLink");
    expect([fr.result.moreShort, en.result.moreShort]).toEqual(["Plus", "More"]);
  });

  it("rangée soudée : un cadre, des cases qui grandissent ; refusé : une hauteur fixe, un libellé coupé ; permis : deux rangées en grand texte", () => {
    const actions = styleOf(screen, "actions");
    expect(actions).toContain("minHeight: 56");
    expect(actions).toContain("borderWidth: 1");
    expect(actions).toContain('overflow: "hidden"');
    expect(styleOf(screen, "action")).toContain("flex: 1, minHeight: 56");
    expect(screen).not.toMatch(/[{ ,]height: 56/);
    expect(screen).not.toMatch(/style=\{styles\.actionLabel\} numberOfLines/);
    expect(feedback).not.toMatch(/style=\{styles\.actionLabel\} numberOfLines/);
    expect(screen).toContain("const wideText = fontScale > 1.3;");
    expect(styleOf(screen, "actionsWrap")).toContain('flexWrap: "wrap"');
    expect(styleOf(screen, "actionHalf")).toContain('width: "50%"');
  });

  it.each([
    ["components/send-to-friend-link.tsx", "label"],
    ["components/stock-report-sheet.tsx", "linkLabel"],
    ["components/spot-corrections.tsx", "linkLabel"],
    ["components/proposal-card.tsx", "shopLinkLabel"],
  ])("lien %s (%s) : le soulignement commun, graisse 400 ; refusé : 600 ou un trait écrit à la main", (path, name) => {
    const style = styleOf(code(path), name);
    expect(style).toContain("...lienSouligne");
    expect(style).toContain('fontWeight: "400"');
    expect(style).not.toContain('fontWeight: "600"');
    expect(style).not.toContain("textDecorationLine");
  });
});

describe("le nombre de la barre du Résultat (shownProposalCount)", () => {
  const piece = (id: string, price: number | null, extra: Partial<Piece> = {}): Piece => ({
    id,
    name: `Pièce ${id}`,
    reference: null,
    material: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    priceFrom: price,
    currency: price === null ? null : "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    real: true,
    ...extra,
  });
  // Recherche visuelle : la grande carte, trois autres avec prix, une sans prix ; deux boutiques.
  const result: Pick<SpotResult, "pieces" | "complement"> = {
    pieces: [piece("a", 50), piece("b", 60), piece("c", 70, { inStock: false }), piece("d", 80, { inStock: false }), piece("e", null)],
    complement: {
      shopping: [piece("s1", 40, { origin: "shopping" }), piece("s2", 45, { origin: "shopping" })],
      words: [],
      status: "shown",
      query: null,
      suggestText: false,
      textStatus: null,
    },
  };
  const layout = (view: ResultView, pickedInPriceList = false) => resultLayout(result, view, { selectedIndex: 0, pickedInPriceList });

  it("grande carte + 3 autres + 2 boutiques + 1 sans prix (repliée) = 7 ; la grande carte comptée une fois", () => {
    expect(shownProposalCount(layout({ sort: "relevance", withPriceOnly: false }))).toBe(7);
  });

  it("trié par prix sans carte touchée : la liste seule (7) ; une carte touchée : 1 + la liste sans elle", () => {
    const sorted = layout({ sort: "price_asc", withPriceOnly: false });
    expect(sorted.bigCard).toBeNull();
    expect(shownProposalCount(sorted)).toBe(sorted.priceList!.length);
    const picked = layout({ sort: "price_asc", withPriceOnly: false }, true);
    expect(shownProposalCount(picked)).toBe(1 + picked.priceList!.length);
    expect(shownProposalCount(picked)).toBe(7);
  });

  it("« En stock » qui retire deux cartes : deux de moins ; « Avec prix » retire la sans prix", () => {
    expect(shownProposalCount(layout({ sort: "relevance", withPriceOnly: false, inStockOnly: true }))).toBe(5);
    expect(shownProposalCount(layout({ sort: "relevance", withPriceOnly: true }))).toBe(6);
  });
});

describe("Résultat, « Autres propositions » (maquette 5)", () => {
  const screen = code("app/(app)/spot/result.tsx");
  const card = code("components/proposal-card.tsx");

  it("titre en Bodoni 23/34 avec son nombre à droite ; refusé : le titre système 17", () => {
    expect(styleOf(screen, "sectionTitle")).toContain("fontFamily: serifFont");
    expect(styleOf(screen, "sectionTitle")).toContain("fontSize: font.title, lineHeight: serifLineHeight.title");
    expect(screen).toContain("accessibilityLabel={t.result.count(others.length, null)}");
    for (const path of ["components/result-complement.tsx", "components/no-price-section.tsx"]) expect(code(path), path).toContain("fontSize: font.title, lineHeight: serifLineHeight.title");
  });

  it("deux colonnes à 8 pt portés par chaque carte ; refusé : space-between et 48 % dans ces grilles", () => {
    expect(styleOf(screen, "grid")).not.toContain("space-between");
    expect(screen).toContain('column={i % 2 === 0 ? "left" : "right"}');
    expect(styleOf(card, "cardLeft")).toContain("paddingRight: 4");
    expect(styleOf(card, "cardRight")).toContain("paddingLeft: 4");
    expect(styleOf(card, "cardColumn")).toContain('width: "50%"');
    expect(card).not.toMatch(/cardColumn: \{[^}]*flexGrow/);
  });

  it("carte : nom 15/20 sur deux lignes réservées (minHeight, jamais height) ; « › » hors du soulignement", () => {
    expect(styleOf(card, "cardName")).toContain("minHeight: 40");
    expect(styleOf(card, "cardName")).not.toMatch(/[^n]height: 40/);
    expect(card).toContain("<Text style={styles.shopLinkLabel}>{label}</Text>");
    expect(card).toContain("<Text style={styles.shopLinkChevron}>");
    expect(styleOf(card, "shopLinkChevron")).not.toContain("lienSouligne");
  });
});

describe("Fiche d'une envie (maquette 6)", () => {
  const envie = code("app/(app)/envie.tsx");

  it("barre : « ‹ Envies » 17/400 sans hitSlop ; partage en haut à droite seulement avec un lien de boutique ; refusé : sans condition", () => {
    expect(styleOf(envie, "nav")).toContain("height: 44,");
    expect(styleOf(envie, "backLabel")).toContain('fontSize: font.body, fontWeight: "400", color: color.encre');
    expect(envie).toContain("<Text style={styles.backLabel}>‹ {t.wishlistItem.back}</Text>");
    const nav = envie.slice(envie.indexOf("<View style={styles.nav}>"), envie.indexOf("{state !== \"ready\" || !item ? ("));
    expect(nav).not.toContain("hitSlop");
    expect(nav).toContain('{state === "ready" && item?.merchantUrl ? (');
    expect(nav).toContain("onPress={handleShareOutside}");
    expect(nav).toContain("accessibilityLabel={t.wishlistItem.shareOutside}");
    // Le bouton du bas « Partager hors de Spotto » reste.
    expect(envie).toContain("<Text style={styles.secondaryLabel}>{t.wishlistItem.shareOutside}</Text>");
  });

  it("gouttière de 16 pt, photo en 4:5 (jamais carrée) ; refusé : 24", () => {
    expect(styleOf(envie, "content")).toContain("paddingHorizontal: space.md");
    expect(styleOf(envie, "content")).not.toContain("padding: space.lg");
    expect(envie).not.toContain("aspectRatio={1}");
  });

  it("ligne du prix : boutique et prix à gauche, dernier prix vu et stock à droite ; refusé : la marge négative d'avant", () => {
    const row = envie.slice(envie.indexOf("<View style={styles.priceRow}>\n"), envie.indexOf("})()}"));
    expect(row).toContain('testID="dernier-prix-vu"');
    expect(row).toContain('testID="etat-du-stock"');
    expect(styleOf(envie, "priceRow")).toContain('flexWrap: "wrap", justifyContent: "space-between"');
    expect(envie).not.toContain("marginTop: -space.md");
    // « Baisse de prix » reste au-dessus de la rangée.
    expect(envie.indexOf('testID="baisse-de-prix"')).toBeLessThan(envie.indexOf('testID="dernier-prix-vu"'));
  });

  it("« Je l'ai achetée » et la cloche côte à côte (l'un sous l'autre en grand texte) ; « Plus disponible ? » juste dessous, jamais sous « Plus »", () => {
    const pair = envie.slice(envie.indexOf("<View style={[styles.pairRow"), envie.indexOf("<View style={styles.alerts}>"));
    expect(pair).toContain("<WishBoughtButton");
    expect(pair).toContain("<WishAlertButton");
    expect(pair).toContain('flexDirection: fontScale > 1.3 ? "column" : "row"');
    expect(envie.slice(envie.indexOf("<View style={styles.alerts}>"))).toContain('<StockReportLink');
    expect(code("components/stock-report-sheet.tsx")).toContain('testID="plus-disponible"');
    expect(envie).toContain("externalIcon");
    const bought = code("components/wish-bought-button.tsx");
    expect(bought).toContain("<BagCheckIcon />");
    expect(styleOf(bought, "button")).toContain("minHeight: 44");
    expect(styleOf(bought, "button")).not.toMatch(/[{ ]height: /);
    expect(styleOf(code("components/merchant-link-button.tsx"), "primary")).toContain("minHeight: 52");
  });
});

describe("Réglages (maquette 7)", () => {
  const settings = code("app/(app)/settings.tsx");
  const group = code("components/settings-group.tsx");

  it("barre « ‹ Retour » 17/400 ; refusé : le « ‹ » seul, un hitSlop ; titre « Réglages » en grand Bodoni", () => {
    expect(settings).toContain("<Text style={styles.back}>‹ {t.common.back}</Text>");
    expect(settings).not.toContain(">‹</Text>");
    expect(settings).not.toContain("hitSlop");
    expect(styleOf(settings, "back")).toContain('fontSize: font.body, fontWeight: "400"');
    expect(styleOf(settings, "title")).toContain("fontSize: font.display, lineHeight: serifLineHeight.display");
    expect(styleOf(settings, "content")).toContain("paddingHorizontal: space.md");
  });

  it("le kit des blocs : surtitre commun, carte en surface, lignes de 44 (jamais une hauteur fixe), lien souligné en 400", () => {
    expect(styleOf(group, "label")).toContain("...surtitre");
    expect(group).toContain("backgroundColor: color.surface");
    expect(styleOf(group, "row")).toContain("minHeight: 44");
    expect(styleOf(group, "row")).not.toMatch(/[{ ]height: /);
    expect(styleOf(group, "link")).toContain("...lienSouligne");
    expect(styleOf(group, "link")).toContain('fontWeight: "400"');
  });

  it("ligne « Nom d'utilisateur » : un texte, pas un bouton ; refusé : un rôle", () => {
    expect(fr.settings.usernameLabel).toBe("Nom d'utilisateur");
    expect(en.settings.usernameLabel).toBe("Username");
    const row = settings.slice(settings.indexOf("{profile?.username ? ("), settings.indexOf("<View style={group.divider} />"));
    expect(row).toContain("{t.settings.usernameLabel}");
    expect(row).toContain("@{profile.username}");
    expect(row).not.toContain("accessibilityRole");
  });

  it("les phrases nécessaires restent rendues, mot pour mot (consentements, statistiques, compte privé, analyse vidéo)", () => {
    for (const phrase of ["t.settings.analyticsOn", "t.settings.analyticsOff", 'consentLine("terms")', 'consentLine("privacy_policy")']) expect(settings, phrase).toContain(phrase);
    expect(code("components/private-account-setting.tsx")).toContain("<Text style={styles.hint}>{t.privateAccount.settingHelp}</Text>");
    expect(code("components/video-ai-setting.tsx")).toContain("t.settings.videoAiOn : t.settings.videoAiOff");
  });

  it.each(["components/video-ai-setting.tsx", "components/latest-video-setting.tsx", "components/player-consent-setting.tsx", "components/extra-data-settings.web.tsx"])(
    "%s : dans la carte « Vos données », un filet en tête ; refusé : une carte à lui (carte dans la carte)",
    (path) => {
      const source = code(path);
      expect(source).toContain("<View style={settingsGroup.divider} />");
      expect(source).not.toContain("settingsGroup.card");
      expect(source).not.toContain("g.card");
    }
  );

  // Relecture du lot : la ligne de l'essayage garde son filet après « Retirer » (consentement retiré).
  it("extra-data-settings.web.tsx : un filet en tête de chaque état affiché, retiré compris ; refusé : l'état retiré sans filet", () => {
    const source = code("components/extra-data-settings.web.tsx");
    const withdrawn = source.slice(source.indexOf('if (phase === "withdrawn") {'), source.indexOf("if (!canWithdrawConsent("));
    expect(withdrawn).toMatch(/<>\s*<View style=\{settingsGroup\.divider\} \/>\s*<Text style=\{styles\.title\}>/);
    expect(source.match(/<View style=\{settingsGroup\.divider\} \/>/g)).toHaveLength(2);
  });

  it.each(["components/discoverable-setting.tsx", "components/read-receipts-setting.tsx", "components/message-push-setting.tsx", "components/wish-alerts-setting.tsx"])(
    "%s : la vue extérieure est la carte ; refusé : la marge du bas de 24 (40 pt entre deux cartes)",
    (path) => {
      const source = code(path);
      expect(source).toMatch(/section: \{ \.\.\.g\.card, marginTop: space\.(sm|md) \}/);
      expect(source).not.toContain("marginBottom: space.lg");
    }
  );

  it("ordre : Compte, confidentialité, notifications, Langue, Apparence, Vos données, Documents, Aide ; refusé : un surtitre « Notifications » commun", () => {
    const order = [
      "{t.settings.account}",
      "<PrivateAccountSetting />",
      "<ReadReceiptsSetting />",
      "<MessagePushSetting />",
      "<ActivityPushSetting />",
      "{t.preferences.language}",
      "{t.preferences.appearance}",
      "{t.settings.dataSection}",
      "{t.settings.documents}",
      "{t.contact.settingsSection}",
      "{t.settings.signOut}",
      "<DeleteAccountSection",
    ];
    let from = 0;
    for (const marker of order) {
      const at = settings.indexOf(marker, from);
      expect(at, marker).toBeGreaterThan(from);
      from = at;
    }
    expect(settings).not.toMatch(/t\.push\.title|t\.settings\.notifications\b|>Notifications</);
  });
});

describe("« Entourez la pièce » (maquette 3-entourer-poudre)", () => {
  const launch = code("app/(app)/spot/lancer.tsx");
  const views = code("components/spot-launch-views.tsx");
  const ask = views.slice(views.indexOf("export function AskView("), views.indexOf("export function ConsentView("));

  it("gouttière de 16 pt ; refusé : 24", () => {
    expect(styleOf(launch, "content")).toContain("paddingHorizontal: space.md");
  });

  it("photo : la note des mots AVANT le bouton, le conseil de cadrage après ; refusé : la note des mots après le bouton", () => {
    const note = ask.indexOf("{p.linkWords ? t.launch.linkWordsNote : t.launch.photoWordsNote}");
    const button = ask.indexOf("<Pressable\n        style={[styles.primary");
    const hint = ask.indexOf("{t.launch.frameHint}");
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(button);
    expect(hint).toBeGreaterThan(button);
    expect(ask.slice(button)).not.toContain("photoWordsNote");
    expect(ask.slice(button)).not.toContain("linkWordsNote");
  });

  it("la vidéo associée sous la photo, avant le bouton ; refusé : au-dessus du titre", () => {
    expect(ask.indexOf("{p.context ?")).toBeGreaterThan(-1);
    expect(ask.indexOf("{p.context ?")).toBeLessThan(ask.indexOf("<Pressable\n        style={[styles.primary"));
    expect(launch).not.toContain('flow.phase.kind === "ask" && photoUri ? <VideoContextLabel /> : null');
    expect(launch).toContain("context: photoUri ? <VideoContextLabel /> : undefined");
  });

  it("un seul champ, en bloc, 16 sur le site ; refusé : le libellé visible au-dessus pour une photo", () => {
    expect(ask).not.toContain("styles.fieldLabel");
    expect(ask).toContain("placeholder={`${t.launch.photoLabel} · ${t.launch.photoPlaceholder}`}");
    expect(ask).toContain("label={t.launch.photoLabel}");
    expect(styleOf(views, "inputBoxed")).toContain('fontSize: Platform.OS === "web" ? 16 : font.secondary');
    // La question des vidéos garde son champ souligné.
    expect(styleOf(views, "input")).toContain("borderBottomWidth: 1");
  });

  it("« Chercher cette pièce » pour une photo ; la vidéo garde « Lancer »", () => {
    expect(fr.launch.searchPiece).toBe("Chercher cette pièce");
    expect(en.launch.searchPiece).toBe("Search for this piece");
    expect(launch).toContain("launchLabel: photoWords ? t.launch.searchPiece : isVideo && flow.declined ? t.launch.chooseImage : t.launch.launch,");
  });

  it("la photo grandit avec l'écran (zones sûres comprises), entre 220 et 480 ; ce qui part au serveur ne change pas", () => {
    expect(launch).toContain("const insets = useSafeAreaInsets();");
    expect(launch).toContain("clamp(windowHeight - insets.top - insets.bottom - PHOTO_FIXED_HEIGHT - contextHeight, 220, 480)");
    expect(launch).toContain("const PHOTO_FIXED_HEIGHT = 283;");
    // Aucune occurrence nouvelle du calcul de la zone (piece-tracer.tsx, lot E, n'est pas touché).
    expect(launch.match(/zoneFromCrop/g)).toHaveLength(2);
    expect(launch).not.toContain("zoneFromTrace");
    expect(launch).toContain("crop: media.source === \"photo\" ? (zone?.crop ?? null) : null");
  });

  it("« Utiliser toute l'image » : le lien commun ; refusé : un trait écrit à la main", () => {
    expect(styleOf(views, "wholeImageLabel")).toContain("...lienSouligne");
    expect(styleOf(views, "wholeImageLabel")).not.toContain("textDecorationLine");
  });
});

describe("Lecteur, deux lignes (maquettes 2-lecteur)", () => {
  const player = code("app/(app)/spot/lecteur.tsx");
  it("le fond de la première fois se détache du fond de l'écran ; « Ouvrir dans TikTok » sans demi-gras", () => {
    expect(styleOf(player, "poster")).toContain("backgroundColor: color.nuitCadre");
    expect(styleOf(player, "linkLabel")).not.toContain('fontWeight: "600"');
  });
});

describe("partie B1 : l'interrupteur du site", () => {
  const web = code("components/switch.web.tsx");
  const users = ["app/(app)/settings.tsx", "components/activity-push-setting.tsx", "components/discoverable-setting.tsx", "components/latest-video-setting.tsx", "components/message-push-setting.tsx", "components/private-account-setting.tsx", "components/read-receipts-setting.tsx", "components/video-ai-setting.tsx", "components/wish-alert-sheet.tsx", "components/wish-alerts-setting.tsx"];

  it("iPhone : le Switch de React Native, inchangé ; site : un interrupteur annoncé comme tel, piste 51 × 31, zone de 44", () => {
    expect(code("components/switch.tsx")).toContain('export { Switch } from "react-native";');
    expect(web).toContain("export function Switch(");
    expect(web).toContain('accessibilityRole="switch"');
    expect(web).toContain("aria-checked={value}");
    expect(web).toContain("const TRACK = { width: 51, height: 31 };");
    expect(styleOf(web, "zone")).toContain("minHeight: 44");
    // Couleurs : celles de couleursInterrupteur (aucune couleur en dur) ; « Réduire les animations » respecté.
    expect(web).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(web).toContain("if (reduceMotion) left.setValue(to);");
  });

  // Relecture du lot : react-native-web ne traite la barre d'espace que pour un rôle « button ».
  it("clavier : la barre d'espace bascule l'interrupteur (sans faire défiler), jamais quand il est désactivé", () => {
    expect(web).toContain('if (event.key !== " " && event.key !== "Spacebar") return;');
    expect(web).toContain("event.preventDefault();");
    expect(web).toContain("if (!disabled && !event.repeat) onValueChange?.(!value);");
    expect(web).toContain("{...webKeys}");
  });

  it("refusé : basculer à l'espace sans regarder `disabled`, ou un Pressable sans `onKeyDown`", () => {
    expect(web).not.toMatch(/preventDefault\(\);\s*onValueChange/);
    expect(web).toContain("onKeyDown: (event:");
  });

  it.each(users)("%s : l'interrupteur commun ; refusé : celui de react-native-web importé directement", (path) => {
    const source = code(path);
    expect(source).toContain('import { Switch } from "@/components/switch";');
    expect(source).not.toMatch(/import \{[^}]*\bSwitch\b[^}]*\} from "react-native";/);
    expect(source).toContain("{...couleursInterrupteur(");
  });
});
