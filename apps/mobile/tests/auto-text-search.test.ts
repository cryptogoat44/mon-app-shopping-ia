import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Piece, SpotComplement, SpotResult } from "../src/api/types";
import { autoTextSearchDue, autoTextSearchWords, claimAutoTextSearch, forgetAutoTextSearches, noPriceAtAll } from "../src/lib/auto-text-search";
import type { SpotDraft } from "../src/lib/spot-draft";
import { withShops } from "../src/lib/spot-shops";
import { withoutTextPrompt, withTextSearch } from "../src/lib/spot-result";

// Lien vidéo sans prix (décision du fondateur du 17 novembre 2026) : pour une
// recherche partie d'un moment d'une vidéo TikTok ou Instagram, quand rien
// n'affiche de prix, l'écran Résultat lance de lui-même la recherche
// « Que cherchez-vous ? » avec la description tapée, une seule fois. Jamais
// pour une photo ni une vidéo du téléphone, jamais quand un prix existe.
// Logique pure, et garanties lues dans le code de l'écran (aucun rendu).

const DESCRIPTION = "la veste en cuir beige";

function piece(id: string, priceFrom: number | null, origin?: Piece["origin"]): Piece {
  return {
    id,
    name: `Pièce ${id}`,
    reference: null,
    material: null,
    imageUrl: `https://images.exemple.test/${id}.jpg`,
    imageHdUrl: null,
    priceFrom,
    currency: priceFrom === null ? null : "EUR",
    merchantName: "Boutique",
    merchantUrl: `https://boutique.exemple.test/${id}`,
    affiliateUrl: null,
    real: true,
    ...(origin ? { origin } : {}),
  };
}

function complement(overrides: Partial<SpotComplement> = {}): SpotComplement {
  return { shopping: [], words: [], status: "skipped", query: null, suggestText: false, textStatus: null, ...overrides };
}

function result(overrides: Partial<SpotResult> = {}): SpotResult {
  return {
    searchId: "s-1",
    query: null,
    sourceUrl: null,
    status: "success",
    pieces: [piece("l1", null), piece("l2", null)],
    similarPieces: [],
    complement: complement(),
    ...overrides,
  };
}

function draft(overrides: Partial<SpotDraft> = {}): SpotDraft {
  return { searchId: null, localImageUri: "data:image/jpeg;base64,AAAA", imageSize: { width: 720, height: 1280 }, crop: null, words: DESCRIPTION, textSearchIfNoPrice: true, ...overrides };
}

beforeEach(() => forgetAutoTextSearches());

describe("les mots de la recherche automatique : seulement la description d'un lien vidéo, sur le résultat qui vient d'être calculé", () => {
  it("brouillon d'un lien vidéo, résultat du lancement : la description", () => {
    expect(autoTextSearchWords(true, draft())).toBe(DESCRIPTION);
    expect(autoTextSearchWords(true, draft({ words: `  ${DESCRIPTION}  ` }))).toBe(DESCRIPTION);
  });

  it("photo ou vidéo du téléphone (aucune marque) : rien ne part de soi-même, même avec des mots", () => {
    expect(autoTextSearchWords(true, draft({ textSearchIfNoPrice: undefined }))).toBeNull();
    expect(autoTextSearchWords(true, draft({ textSearchIfNoPrice: false }))).toBeNull();
  });

  it("résultat rouvert (historique, page rechargée, second écran), brouillon perdu ou sans mots : rien", () => {
    expect(autoTextSearchWords(false, draft())).toBeNull();
    expect(autoTextSearchWords(true, null)).toBeNull();
    expect(autoTextSearchWords(true, draft({ words: null }))).toBeNull();
    expect(autoTextSearchWords(true, draft({ words: "   " }))).toBeNull();
  });
});

describe("quand partir : boutiques connues, aucun prix nulle part", () => {
  it("aucun prix, boutiques connues (IA coupée, en panne, rien trouvé) : elle part", () => {
    for (const status of ["skipped", "ai_failed", "no_time", "shopping_failed", "error", "empty", "no_query"] as const) {
      expect(autoTextSearchDue(result({ complement: complement({ status }) })), status).toBe(true);
    }
    // Invitation déjà proposée par le serveur : la même recherche part aussi d'elle-même.
    expect(autoTextSearchDue(result({ complement: complement({ status: "no_query", suggestText: true }) }))).toBe(true);
  });

  it("« rien trouvé » par la recherche visuelle : elle part ; une panne, un plafond ou une recherche en cours : jamais", () => {
    const failed = (failReason: SpotResult["failReason"]) => result({ status: "failed", pieces: [], failReason, complement: complement({ status: "no_query", suggestText: true }) });
    expect(autoTextSearchDue(failed("no_match"))).toBe(true);
    for (const reason of ["technical", "running", "needs_photo", "rate_limited", "paused", "capacity_day"] as const) {
      expect(autoTextSearchDue(failed(reason)), reason).toBe(false);
    }
  });

  it("boutiques encore attendues : pas encore ; arrivées sans prix : elle part ; arrivées avec un prix : jamais (aucun crédit dépensé)", () => {
    const waiting = result({ complement: complement({ status: null, pending: true }) });
    expect(autoTextSearchDue(waiting)).toBe(false);
    const search = (shopping: { priceMin: number | null }[]) =>
      ({
        id: "s-1",
        status: "completed",
        errorMessage: null,
        query: null,
        sourceUrl: null,
        matches: [
          { id: "l1", rank: 1, productName: "l1", brand: null, imageUrl: "x", priceMin: null, priceMax: null, currency: null, merchantName: null, merchantUrl: "https://a.test/1", affiliateUrl: null },
          ...shopping.map((item, index) => ({ id: `b${index}`, rank: 10 + index, productName: "b", brand: null, imageUrl: "x", priceMin: item.priceMin, priceMax: item.priceMin, currency: "EUR", merchantName: null, merchantUrl: `https://b.test/${index}`, affiliateUrl: null, origin: "shopping" })),
        ],
        complement: { status: "shown", suggestText: false, textStatus: null },
      }) as unknown as Parameters<typeof withShops>[1];
    const pricedShops = withShops(waiting, search([{ priceMin: 49 }]));
    // À l'affichage, des boutiques arrivées tard ne replient rien… mais leur prix compte ici.
    expect(pricedShops.complement?.late).toBe(true);
    expect(noPriceAtAll(pricedShops)).toBe(false);
    expect(autoTextSearchDue(pricedShops)).toBe(false);
    const noPriceShops = withShops(waiting, search([{ priceMin: null }]));
    expect(autoTextSearchDue(noPriceShops)).toBe(true);
  });

  it("un seul prix, recherche visuelle ou boutiques (même 0) : jamais", () => {
    expect(autoTextSearchDue(result({ pieces: [piece("l1", null), piece("l2", 59)] }))).toBe(false);
    expect(autoTextSearchDue(result({ complement: complement({ status: "shown", shopping: [piece("b1", 0, "shopping")] }) }))).toBe(false);
  });

  it("plafond atteint pour les boutiques, voie C coupée (complément absent), aucun numéro de recherche : rien n'est tenté", () => {
    expect(autoTextSearchDue(result({ complement: complement({ status: "no_capacity" }) }))).toBe(false);
    expect(autoTextSearchDue(result({ complement: undefined }))).toBe(false);
    expect(autoTextSearchDue(result({ searchId: null }))).toBe(false);
    expect(autoTextSearchDue(null)).toBe(false);
  });

  it("recherche avec les mots déjà faite (issue ou propositions « words ») : jamais une seconde fois", () => {
    expect(autoTextSearchDue(result({ complement: complement({ textStatus: "empty" }) }))).toBe(false);
    expect(autoTextSearchDue(result({ complement: complement({ words: [piece("w1", null, "words")] }) }))).toBe(false);
  });

  it("après son issue, le résultat remplacé ne la rappelle plus ; refusée, non plus", () => {
    const before = result();
    const after = withTextSearch(before, {
      id: "s-1",
      status: "completed",
      errorMessage: null,
      query: null,
      sourceUrl: null,
      matches: [{ id: "w1", rank: 3, productName: "Veste cuir beige", brand: null, imageUrl: "x", priceMin: 89, priceMax: 89, currency: "EUR", merchantName: null, merchantUrl: "https://c.test/1", affiliateUrl: null, origin: "words" }],
      complement: { status: "skipped", suggestText: false, textStatus: "shown" },
    } as unknown as Parameters<typeof withTextSearch>[1]);
    expect(autoTextSearchDue(after)).toBe(false);
    const empty = withTextSearch(before, { id: "s-1", status: "completed", errorMessage: null, query: null, sourceUrl: null, matches: [], complement: { status: "skipped", suggestText: false, textStatus: "empty" } } as unknown as Parameters<typeof withTextSearch>[1]);
    expect(autoTextSearchDue(empty)).toBe(false);
    // Refus (« hidden ») : l'invitation disparaît, l'écran note « done » (vérifié dans le code ci-dessous).
    expect(withoutTextPrompt(before).complement?.suggestText).toBe(false);
  });
});

describe("une seule fois par recherche", () => {
  it("la première demande seulement ; une autre recherche a la sienne", () => {
    expect(claimAutoTextSearch("s-1")).toBe(true);
    expect(claimAutoTextSearch("s-1")).toBe(false);
    expect(claimAutoTextSearch("s-1")).toBe(false);
    expect(claimAutoTextSearch("s-2")).toBe(true);
  });

  it("mémoire bornée : les plus anciennes sont oubliées, jamais les récentes", () => {
    for (let index = 0; index < 60; index += 1) claimAutoTextSearch(`s-${index}`);
    expect(claimAutoTextSearch("s-59")).toBe(false);
    expect(claimAutoTextSearch("s-20")).toBe(false);
  });
});

const MOBILE = join(__dirname, "..");
/** Code sans ses commentaires. */
const code = (path: string) =>
  readFileSync(join(MOBILE, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("écran Résultat : la même recherche que « Chercher », une seule fois, sans boucle", () => {
  const screen = code("src/app/(app)/spot/result.tsx");
  const prompt = code("src/components/text-search-prompt.tsx");

  it("les mots sont lus une fois, du brouillon du lancement (jamais d'un résultat rouvert)", () => {
    expect(screen).toContain("const [autoWords] = useState(() => autoTextSearchWords(fromLaunch.current, getDraft()));");
  });

  it("elle part quand le résultat l'appelle, après avoir été réservée pour cette recherche ; déjà réservée : jamais", () => {
    expect(screen).toContain('const autoTextDue = autoWords !== null && autoText === "idle" && autoTextSearchDue(result);');
    expect(screen).toContain('setAutoText(claimAutoTextSearch(autoTextSearchId) ? "running" : "done");');
    expect(screen).toContain("}, [autoTextSearchId]);");
  });

  it("la même invitation (« Que cherchez-vous ? »), lancée d'elle-même avec la description ; son issue ou un refus la termine", () => {
    expect(screen).toContain("result?.searchId && (result.complement?.suggestText || autoTextRunning) ? (");
    expect(screen).toContain("initialWords={autoTextRunning ? autoWords : fromLaunch.current ? getDraft()?.words : null}");
    expect(screen).toContain("autoStart={autoTextRunning}");
    expect(screen).toContain('setAutoText((current) => (current === "running" ? "done" : current));');
    for (const handler of ["function handleTextSearchDone(search: ProductSearch) {\n    endAutoTextSearch();", "function handleTextSearchClosed(alreadyUsed: boolean) {\n    endAutoTextSearch();"]) {
      expect(screen).toContain(handler);
    }
  });

  it("l'invitation la lance une seule fois (jamais relancée après un refus ou une panne), par le même chemin que « Chercher »", () => {
    expect(prompt).toContain("if (!autoStart || autoStarted.current) return;");
    expect(prompt).toContain("autoStarted.current = true;\n    void search();");
    expect(prompt).toContain("}, [autoStart]);");
    // Même requête, mêmes relectures et refus que le bouton.
    expect(prompt).toContain("const found = await runTextSearch(searchId, words.trim(), current.signal);");
    expect(prompt).toContain("const next = await recoverTextSearch(textSearchFailure(error), () => fetchSearch(searchId, current.signal));");
  });
});

describe("textes : ce qui est dit à la personne avant que sa description parte", () => {
  it("sous la description d'un lien (écran « vidéo partagée ») : l'envoi à Google Shopping par SerpApi si rien n'a de prix, en français comme en anglais", async () => {
    const { fr } = await import("../src/i18n/fr");
    const { en } = await import("../src/i18n/en");
    expect(fr.videoLinkAuto.privacy).toContain("Si les résultats n'affichent aucun prix, votre description est aussi envoyée à Google Shopping par notre prestataire SerpApi pour trouver des boutiques.");
    expect(en.videoLinkAuto.privacy).toContain("If the results show no price, your description is also sent to Google Shopping through our provider SerpApi to find shops.");
    // L'analyse elle-même est toujours dite.
    expect(fr.videoLinkAuto.privacy).toContain("quelques images et votre description sont analysées par une IA");
    expect(en.videoLinkAuto.privacy).toContain("a few frames and your description are analyzed by an AI");
  });

  it("sur l'écran de lancement d'un moment de lien : la phrase des photos (« que si vous lancez vous-même ») est remplacée par celle de la description", async () => {
    const { fr } = await import("../src/i18n/fr");
    const { en } = await import("../src/i18n/en");
    expect(fr.launch.linkWordsNote).toBe(
      "Votre description trie les propositions : elle ne part pas avec l'image vers la recherche. Si aucune proposition n'affiche de prix, elle est envoyée à Google Shopping par notre prestataire SerpApi pour trouver des boutiques, sans votre nom ni votre e-mail."
    );
    expect(en.launch.linkWordsNote).toBe(
      "Your description sorts the suggestions: it isn't sent with the image to the search. If no suggestion shows a price, it is sent to Google Shopping through our provider SerpApi to find shops, without your name or email address."
    );
    expect(code("src/components/spot-launch-views.tsx")).toContain("{p.linkWords ? t.launch.linkWordsNote : t.launch.photoWordsNote}");
    expect(code("src/app/(app)/spot/lancer.tsx")).toContain("linkWords: photoWords && media.draft?.textSearchIfNoPrice === true,");
  });
});
