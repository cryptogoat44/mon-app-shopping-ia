import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LuxuryResale, ProductMatch, ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../src/api/types";
import { APP_NAME_DISPLAY as BRAND } from "../src/constants/brand";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { luxuryResaleToTrack, openResaleSite, parseLuxuryResale, resaleHost } from "../src/lib/luxury-resale";
import { allPieces } from "../src/lib/result-sections";
import { toSpotResult, withTextSearch } from "../src/lib/spot-result";
import { withShops } from "../src/lib/spot-shops";

// Seconde main de luxe (lot « seconde main de luxe ») côté app : le serveur
// décide (apps/backend/src/lib/luxuryResale.ts) ; l'app relit le champ,
// montre l'entrée et la feuille, ouvre la recherche du site de revente par
// openExternalLink — jamais openMerchantLink, aucun clic enregistré sur le
// serveur — et ne change l'ordre de rien.

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const code = (path: string) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const RESALE: LuxuryResale = {
  house: "Dior",
  words: "Dior Sac Saddle toile Oblique",
  sites: [{ name: "Vestiaire Collective", url: "https://fr.vestiairecollective.com/search/?q=Dior%20Sac%20Saddle%20toile%20Oblique" }],
};

const match = (id: string, extra: Partial<ProductMatch> = {}): ProductMatch =>
  ({
    id,
    rank: Number(id.replace(/\D/g, "")) || 1,
    productName: `Sac ${id}`,
    brand: null,
    imageUrl: `https://boutique.test/${id}.jpg`,
    imageHdUrl: null,
    priceMin: 2900,
    priceMax: 2900,
    currency: "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique.test/${id}`,
    affiliateUrl: `https://boutique.test/${id}`,
    feedbackReason: null,
    ...extra,
  }) as ProductMatch;

const search = (extra: Partial<ProductSearch> = {}): ProductSearch => ({
  id: "recherche-luxe",
  sourceUrl: null,
  sourcePlatform: "photo",
  method: "manual_screenshot",
  status: "completed",
  errorMessage: null,
  query: "manteau de ma tante",
  createdAt: "2026-11-23T10:00:00.000Z",
  matches: [match("m1"), match("m2", { origin: "shopping" }), match("m3", { origin: "shopping" })],
  complement: { status: "shown", suggestText: false, textStatus: null },
  ...extra,
});

describe("lecture du champ : seulement une forme connue", () => {
  it("permis : un champ complet, gardé tel quel", () => {
    expect(parseLuxuryResale(RESALE)).toEqual(RESALE);
    const five = { ...RESALE, sites: [1, 2, 3, 4, 5].map((index) => ({ name: `Site ${index}`, url: `https://s${index}.exemple.com/?q=Dior` })) };
    expect(parseLuxuryResale(five)?.sites).toHaveLength(5);
  });

  it("refusé : une adresse javascript: ou http est retirée, et sans site rien ne s'affiche ; les autres sites restent", () => {
    const bad = [{ name: "Piège", url: "javascript:alert(1)" }, { name: "Clair", url: "http://revente.exemple.com/?q=Dior" }];
    expect(parseLuxuryResale({ ...RESALE, sites: bad })).toBeUndefined();
    expect(parseLuxuryResale({ ...RESALE, sites: [...bad, RESALE.sites[0]] })?.sites).toEqual(RESALE.sites);
  });

  it("refusé : absent (ancien serveur), `house` vide ou trop long, mots vides ou trop longs, plus de 5 sites, aucun site, un nom de site vide", () => {
    for (const raw of [
      undefined,
      null,
      "Dior",
      { ...RESALE, house: "" },
      { ...RESALE, house: "   " },
      { ...RESALE, house: "x".repeat(41) },
      { ...RESALE, words: "" },
      { ...RESALE, words: "x".repeat(81) },
      { ...RESALE, sites: [] },
      { ...RESALE, sites: [1, 2, 3, 4, 5, 6].map((index) => ({ name: `Site ${index}`, url: `https://s${index}.exemple.com/?q=Dior` })) },
      { ...RESALE, sites: [{ name: "", url: RESALE.sites[0]!.url }] },
      { ...RESALE, sites: [{ name: "x".repeat(41), url: RESALE.sites[0]!.url }] },
    ]) {
      expect(parseLuxuryResale(raw), JSON.stringify(raw)).toBeUndefined();
    }
  });

  it("l'hôte montré sous le bouton est celui de l'adresse ouverte ; refusé : rien pour une adresse non https", () => {
    expect(resaleHost(RESALE.sites[0]!.url)).toBe("fr.vestiairecollective.com");
    expect(resaleHost("http://fr.vestiairecollective.com/search/?q=x")).toBeNull();
    expect(resaleHost("javascript:alert(1)")).toBeNull();
  });
});

describe("le champ arrive avec le résultat : lancement, boutiques ensuite, relecture", () => {
  it("permis : gardé sur un résultat ; refusé : absent (ancien serveur), illisible, ou sur l'écran d'échec (rien trouvé)", () => {
    expect(toSpotResult(search({ luxuryResale: RESALE })).luxuryResale).toEqual(RESALE);
    expect("luxuryResale" in toSpotResult(search())).toBe(false);
    expect("luxuryResale" in toSpotResult(search({ luxuryResale: { ...RESALE, house: "" } }))).toBe(false);
    const failed = toSpotResult(search({ matches: [], luxuryResale: RESALE }));
    expect(failed.status).toBe("failed");
    expect("luxuryResale" in failed).toBe(false);
  });

  it("permis : boutiques ensuite — withShops reprend le champ de la réponse ; refusé : une réponse sans champ l'enlève (une seconde maison rend le cas douteux)", () => {
    const pending: SpotResult = toSpotResult(search({ matches: [match("m1")], complement: { status: null, suggestText: false, textStatus: null, pending: true } }));
    expect(pending.luxuryResale).toBeUndefined();
    const after = withShops(pending, search({ luxuryResale: RESALE }));
    expect(after.luxuryResale).toEqual(RESALE);
    expect(after.complement?.late).toBe(true);
    const gone = withShops({ ...pending, luxuryResale: RESALE }, search());
    expect("luxuryResale" in gone).toBe(false);
  });

  it("permis : après « Que cherchez-vous ? », celui de la recherche relue", () => {
    expect(withTextSearch(toSpotResult(search()), search({ luxuryResale: RESALE })).luxuryResale).toEqual(RESALE);
    expect("luxuryResale" in withTextSearch(toSpotResult(search({ luxuryResale: RESALE })), search())).toBe(false);
  });

  it("refusé : le champ ne change ni l'ordre, ni le nombre, ni les mentions des propositions", () => {
    const marked = search({ matches: [match("m1", { offerMark: "official_shop" }), match("m2", { origin: "shopping", offerMark: "known_shop" }), match("m3", { origin: "shopping" })] });
    const without = toSpotResult(marked);
    const withField = toSpotResult({ ...marked, luxuryResale: RESALE });
    expect(allPieces(withField)).toEqual(allPieces(without));
    const { luxuryResale: _field, ...rest } = withField;
    expect(rest).toEqual(without);
    for (const file of ["src/lib/price-first.ts", "src/lib/result-sort.ts", "src/lib/result-sections.ts", "src/components/offer-mark.tsx", "src/components/proposal-card.tsx"]) {
      expect(read(file), file).not.toMatch(/luxury|seconde main/i);
    }
  });
});

describe("l'écran : l'entrée sous la grande carte, ou sous « Ce n'est pas la bonne pièce ? » sans elle", () => {
  const screen = code("src/app/(app)/spot/result.tsx");

  it("permis : avec la grande carte, juste sous « Plus disponible ? » ; sans grande carte (tri par prix), juste sous le lien des corrections", () => {
    const withCard = screen.indexOf("<LuxuryResaleEntry resale={result.luxuryResale} />");
    expect(withCard).toBeGreaterThan(screen.indexOf("<StockReportLink"));
    expect(withCard).toBeLessThan(screen.indexOf("{keptSaved.has(piece.id) ? ("));
    const withoutCard = screen.indexOf("{!showBigCard ? <LuxuryResaleEntry style={styles.luxuryResaleTop} resale={result.luxuryResale} /> : null}");
    expect(withoutCard).toBeGreaterThan(screen.indexOf("{!showBigCard && sheetActions.length > 0 ? <CorrectionsLink"));
    expect(withoutCard).toBeLessThan(screen.indexOf("{priceSort ? ("));
    expect(screen.match(/<LuxuryResaleEntry /g)).toHaveLength(2);
  });

  it("refusé : jamais sur l'écran d'échec (l'entrée vient après le retour de l'écran d'échec), jamais sans champ (ancien serveur)", () => {
    const failure = screen.indexOf('if (!result || result.status === "failed" || !piece)');
    expect(failure).toBeGreaterThan(-1);
    expect(screen.indexOf("<LuxuryResaleEntry")).toBeGreaterThan(failure);
    const component = code("src/components/luxury-resale.tsx");
    expect(component).toContain("if (!resale) return null;");
  });

  it("le même composant sur iPhone et sur le site (pas dans les actions propres au site)", () => {
    expect(() => read("src/components/luxury-resale.web.tsx")).toThrow();
    expect(read("src/components/piece-extra-actions.web.tsx")).not.toMatch(/luxury/i);
  });
});

describe("la feuille", () => {
  const component = code("src/components/luxury-resale.tsx");

  it("les textes, mot pour mot, en français et en anglais", () => {
    const frTexts = fr.result.luxuryResale;
    const enTexts = en.result.luxuryResale;
    expect([frTexts.entry, enTexts.entry]).toEqual(["Seconde main de luxe", "Pre-owned luxury"]);
    expect(frTexts.entryLabel("Dior")).toBe("Seconde main de luxe : chercher cette pièce Dior sur des sites de revente");
    expect(enTexts.entryLabel("Dior")).toBe("Pre-owned luxury: search for this Dior piece on resale sites");
    expect([frTexts.entryHint, enTexts.entryHint]).toEqual(["Ouvre la liste des sites de revente.", "Opens the list of resale sites."]);
    expect([frTexts.sheetTitle, enTexts.sheetTitle]).toEqual(["Seconde main de luxe", "Pre-owned luxury"]);
    expect(frTexts.intro("Dior")).toBe(
      `D'après les boutiques trouvées, cette pièce semble venir de la maison Dior. Vous pouvez la chercher d'occasion sur ces sites de revente, choisis par ${BRAND} et rangés par ordre alphabétique.`
    );
    expect(enTexts.intro("Dior")).toBe(`Based on the shops found, this piece seems to come from Dior. You can look for it pre-owned on these resale sites, chosen by ${BRAND} and listed in alphabetical order.`);
    expect(frTexts.words("Dior Saddle")).toBe("Recherche déjà remplie : “Dior Saddle”");
    expect(enTexts.words("Dior Saddle")).toBe("Search already filled in: “Dior Saddle”");
    expect([frTexts.site("Vestiaire Collective"), enTexts.site("Vestiaire Collective")]).toEqual(["Chercher sur Vestiaire Collective", "Search on Vestiaire Collective"]);
    expect(frTexts.siteLabel("Vestiaire Collective", "fr.vestiairecollective.com")).toBe(`Chercher sur Vestiaire Collective, fr.vestiairecollective.com, s'ouvre hors de ${BRAND}`);
    expect(enTexts.siteLabel("Vestiaire Collective", "fr.vestiairecollective.com")).toBe(`Search on Vestiaire Collective, fr.vestiairecollective.com, opens outside ${BRAND}`);
    expect(frTexts.limits).toBe(
      `${BRAND} ne voit pas les pièces de ces sites, ni leur prix, ni leur état : c'est le site de revente qui les présente et en répond, selon ses propres conditions. Vérifiez avant d'acheter.`
    );
    expect(enTexts.limits).toBe(
      `${BRAND} doesn't see the pieces on these sites, their prices or their condition: the resale site presents them and answers for them, under its own terms. Check before you buy.`
    );
    expect(frTexts.leave).toBe(`Vous allez quitter ${BRAND} : le site s'ouvre dans votre navigateur. Aucun de ces liens n'est affilié : ${BRAND} ne touche rien sur ces achats.`);
    expect(enTexts.leave).toBe(`You're about to leave ${BRAND}: the site opens in your browser. None of these links is an affiliate link: ${BRAND} earns nothing on these purchases.`);
    expect([frTexts.close, enTexts.close]).toEqual(["Fermer", "Close"]);
  });

  it("« Vous allez quitter … » : la même annonce que la feuille des liens extérieurs, toujours montrée dans la feuille, avant « Fermer »", () => {
    expect(fr.result.luxuryResale.leave.startsWith(fr.profilePins.leaveTitle)).toBe(true);
    expect(component).toContain("{texts.leave}");
    expect(component.indexOf("{texts.leave}")).toBeGreaterThan(component.indexOf("resale.sites.map("));
    expect(component.indexOf("{texts.leave}")).toBeLessThan(component.indexOf("{texts.close}</Text>"));
  });

  it("dans l'ordre : titre (rôle header), introduction, mots sélectionnables, boutons, limites, « vous quittez », « Fermer »", () => {
    const order = ["{texts.sheetTitle}", "{texts.intro(resale.house)}", "{texts.words(resale.words)}", "resale.sites.map(", "{texts.limits}", "{texts.leave}", "{texts.close}</Text>"].map((part) => component.indexOf(part));
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const part of ['accessibilityRole="header"', "accessibilityViewIsModal", "selectable", '"80%"', "<ScrollView", 'animationType={reduceMotion ? "none" : "slide"}']) expect(component, part).toContain(part);
    // Ni hauteur fixe ni nombre de lignes : tout passe à la ligne (320 points, grand texte).
    expect(component).not.toMatch(/numberOfLines|adjustsFontSizeToFit/);
  });

  it("chaque bouton : rôle « link », le libellé VoiceOver avec l'hôte, l'hôte visible sous le libellé ; l'entrée : rôle « button », libellé et indice", () => {
    expect(component).toContain('accessibilityRole="link"');
    expect(component).toContain("accessibilityLabel={texts.siteLabel(site.name, host)}");
    expect(component.indexOf("{texts.site(site.name)}")).toBeLessThan(component.indexOf("{host}</Text>"));
    expect(component).toContain("accessibilityLabel={t.result.luxuryResale.entryLabel(resale.house)}");
    expect(component).toContain("accessibilityHint={t.result.luxuryResale.entryHint}");
  });

  it("toucher un bouton appelle openExternalLink, jamais openMerchantLink ; aucun trackProductMatchClick", () => {
    expect(component).toContain("openResaleSite(url, position, sitesCount, { open: openExternalLink, track })");
    expect(component).toContain('import { openExternalLink } from "@/components/external-link-sheet";');
    for (const file of ["src/components/luxury-resale.tsx", "src/lib/luxury-resale.ts"]) {
      expect(read(file), file).not.toMatch(/openMerchantLink\(|trackProductMatchClick|merchant-links|merchant_link_opened"/);
    }
  });

  it("permis : l'adresse acceptée s'ouvre, le site est compté par sa place ; refusé : adresse refusée, rien n'est compté et la feuille reste", () => {
    const sent: unknown[] = [];
    const opened = vi.fn(() => true);
    expect(openResaleSite(RESALE.sites[0]!.url, 1, 1, { open: opened, track: (event, props) => sent.push([event, props]) })).toBe(true);
    expect(opened).toHaveBeenCalledWith(RESALE.sites[0]!.url);
    expect(sent).toEqual([["luxury_resale_site_opened", { position: 1, sites_count: 1 }]]);
    const refused = vi.fn(() => false);
    sent.length = 0;
    expect(openResaleSite("http://revente.exemple.com/", 1, 1, { open: refused, track: (event, props) => sent.push([event, props]) })).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe("statistiques : ajouts seulement, sans la pièce", () => {
  it("permis : trois événements juste après verdict_shown, des nombres seulement", () => {
    const keys = Object.keys(ANALYTICS_EVENTS);
    const at = keys.indexOf("verdict_shown");
    expect(keys.slice(at + 1, at + 4)).toEqual(["luxury_resale_shown", "luxury_resale_opened", "luxury_resale_site_opened"]);
    expect(ANALYTICS_EVENTS.luxury_resale_shown).toEqual({ sites_count: { kind: "count" } });
    expect(ANALYTICS_EVENTS.luxury_resale_opened).toEqual({ sites_count: { kind: "count" } });
    expect(ANALYTICS_EVENTS.luxury_resale_site_opened).toEqual({ position: { kind: "count" }, sites_count: { kind: "count" } });
    // Les derniers événements du catalogue restent ceux que leurs tests attendent.
    // Assemblage : la page look ajoute ensuite ses trois événements à la fin.
    expect(keys.slice(-5, -3)).toEqual(["news_banner_shown", "news_line_opened"]);
    expect(keys.slice(-3)).toEqual(["look_shared", "look_stopped", "look_signup"]);
  });

  it("refusé : sanitizeProps ne garde que sites_count et position — jamais la maison, les mots, un site, une pièce, un prix ni platform", () => {
    const props = { position: 1, sites_count: 1, house: "Dior", words: "Dior Saddle", site: "Vestiaire Collective", url: RESALE.sites[0]!.url, piece: "m1", price: 2900, platform: "ios" };
    expect(sanitizeProps("luxury_resale_site_opened", props)).toEqual({ position: 1, sites_count: 1 });
    expect(sanitizeProps("luxury_resale_shown", props)).toEqual({ sites_count: 1 });
    expect(sanitizeProps("luxury_resale_opened", props)).toEqual({ sites_count: 1 });
    expect(sanitizeProps("luxury_resale_site_opened", { position: "Vestiaire Collective" })).toEqual({});
  });

  it("permis : un seul luxury_resale_shown par résultat, et quand l'entrée apparaît avec les boutiques ; refusé : sans entrée, rien", () => {
    expect(luxuryResaleToTrack("r1", undefined, undefined)).toBeNull();
    const first = luxuryResaleToTrack("r1", RESALE, undefined);
    expect(first).toEqual({ searchId: "r1", sitesCount: 1 });
    expect(luxuryResaleToTrack("r1", RESALE, "r1")).toBeNull();
    expect(luxuryResaleToTrack("r2", RESALE, "r1")).toEqual({ searchId: "r2", sitesCount: 1 });
    // Boutiques ensuite : rien au premier affichage, puis l'entrée apparaît — envoyée à ce moment-là.
    expect(luxuryResaleToTrack("r3", undefined, "r2")).toBeNull();
    expect(luxuryResaleToTrack("r3", RESALE, "r2")).toEqual({ searchId: "r3", sitesCount: 1 });
  });

  it("tout passe par track() ; le mode d'emploi dit comment lire l'entonnoir, traduire position et où ces clics ne sont pas", () => {
    const screen = read("src/app/(app)/spot/result.tsx");
    expect(screen).toContain('track("luxury_resale_shown", { sites_count: next.sitesCount });');
    const component = read("src/components/luxury-resale.tsx");
    expect(component).toContain('track("luxury_resale_opened", { sites_count: sitesCount });');
    const doc = read("STATISTIQUES.md");
    expect(doc.indexOf("## Seconde main de luxe")).toBeGreaterThan(doc.indexOf("## Les nouveautés des Envies"));
    for (const words of ["**`luxury_resale_shown`**", "**`luxury_resale_opened`**", "**`luxury_resale_site_opened`**", "en vigueur ce jour-là", "secondeMainDeLuxe.ts", "`merchant_link_opened`", "trackProductMatchClick"]) {
      expect(doc, words).toContain(words);
    }
  });
});

describe("textes interdits et conditions d'utilisation", () => {
  const lotTexts = () => [
    ...Object.values(fr.result.luxuryResale).map((value) => (typeof value === "function" ? (value as (...args: string[]) => string)("Dior", "fr.vestiairecollective.com") : value)),
    ...Object.values(en.result.luxuryResale).map((value) => (typeof value === "function" ? (value as (...args: string[]) => string)("Dior", "fr.vestiairecollective.com") : value)),
  ];
  const section = (doc: typeof termsOfUse, title: string) => doc.sections.find((s) => s.title === title)!.blocks.flat().join("\n");

  it("refusé : aucun texte du lot ne dit « authentique », « certifié », « garanti », ni un prix ou « moins cher »", () => {
    const all = JSON.stringify(lotTexts());
    expect(all).not.toMatch(/authenti|certifi|garanti|guarante|€|\$|moins cher|cheaper|dès |from \d|promotion|promo\b/i);
  });

  it("permis : une phrase de plus dans « Liens vers les marchands », en français et en anglais ; la phrase d'avant reste mot pour mot", () => {
    expect(section(termsOfUse, "Liens vers les marchands")).toContain(
      `Pour une pièce qui semble venir d'une maison de luxe, ${BRAND} peut proposer « Seconde main de luxe » : des liens qui ouvrent, dans votre navigateur, la page de recherche de sites de revente, déjà remplie avec des mots tirés du titre d'une offre trouvée. La liste de ces sites est un choix de ${BRAND} ; ils sont présentés par ordre alphabétique et, à la date de cette version, aucun ne rémunère ${BRAND}. ${BRAND} ne voit pas les pièces proposées par ces sites, ni leur prix, ni leur état : c'est le site de revente qui les présente et en répond, selon ses propres conditions.`
    );
    expect(section(termsOfUseEn, "Links to retailers")).toContain(
      `For a piece that seems to come from a luxury house, ${BRAND} may offer “Pre-owned luxury”: links that open, in your browser, the search page of resale sites, already filled in with words taken from the title of an offer found. The list of these sites is ${BRAND}'s choice; they are listed in alphabetical order and, as of this version, none of them pays ${BRAND}. ${BRAND} doesn't see the pieces offered on these sites, their prices or their condition: the resale site presents them and answers for them, under its own terms.`
    );
    expect(section(termsOfUse, "Liens vers les marchands")).toContain(
      `Les liens marqués « Lien affilié » peuvent, à l'avenir, rapporter une commission à ${BRAND} lorsque vous achetez, sans aucun surcoût pour vous. À la date de cette version, aucun programme d'affiliation n'est actif : ${BRAND} ne perçoit aucune commission.`
    );
    expect(JSON.stringify([termsOfUse, termsOfUseEn])).not.toMatch(/authentique|authentic\b/i);
  });
});
