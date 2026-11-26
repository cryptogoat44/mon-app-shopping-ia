import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lot « alertes visibles » : les nouveautés en tête des Envies (bandeau,
// pastille de l'onglet Envies, « vu » noté sur l'appareil par compte).
// Logique pure et lecture des sources, comme les autres tests de l'app (pas
// de rendu de composants, vitest.config.ts). Une règle : un cas refusé et un
// cas permis. Pièces et boutiques fictives.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../src/lib/analytics", () => ({ track, isAnalyticsActive: () => true }));

import { LEGAL_DOCUMENT_VERSIONS, type WishAlertNews } from "@monapp/shared-types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { setActiveLocale } from "../src/i18n";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { FROM_ALERT, notificationHref } from "../src/lib/push-state";
import {
  bannerItems,
  loadSeenNews,
  markNewsSeen,
  newsLine,
  readNewsItem,
  readNewsList,
  readSeen,
  SEEN_MAX,
  seenNewsKey,
  trackNewsOpened,
  trackNewsShown,
  unseenItems,
  withSeen,
  type SeenStore,
} from "../src/lib/wish-alert-news";

const SRC = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
/** Code sans ses commentaires. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WISH = "e0000000-0000-4000-8000-000000000001";

const drop = (overrides: Partial<WishAlertNews> = {}): WishAlertNews => ({
  id: id(1),
  wishlistItemId: WISH,
  kind: "price_drop",
  title: "Veste Nuage 07",
  merchantName: "Boutique Exemple",
  price: 69,
  threshold: 89,
  currency: "EUR",
  seenOn: "2026-11-21",
  ...overrides,
});
const restock = (overrides: Partial<WishAlertNews> = {}): WishAlertNews => ({
  ...drop({ kind: "restock", price: null, threshold: null, currency: null, id: id(2) }),
  ...overrides,
});

/** Un stockage en mémoire (AsyncStorage, localStorage sur le site). */
function memoryStore(): SeenStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
  };
}

afterEach(() => setActiveLocale("fr"));

describe("1. Réponse du serveur lue avec prudence", () => {
  it("refusé : illisible, sorte inconnue ou « Épuisé », identifiant ou jour invalides, baisse sans prix, sans devise ou pas sous le seuil → pas montrée", () => {
    for (const bad of [
      null,
      "texte",
      { ...drop(), kind: "sold_out" },
      { ...drop(), id: "pas-un-id" },
      { ...drop(), wishlistItemId: 12 },
      { ...drop(), seenOn: "21/11" },
      { ...drop(), title: "  " },
      { ...drop(), price: null },
      { ...drop(), currency: "€" },
      { ...drop(), price: 89, threshold: 89 },
      { ...drop(), threshold: -1 },
    ]) {
      expect(readNewsItem(bad)).toBeNull();
    }
    expect(readNewsList(null)).toEqual([]);
    expect(readNewsList({ items: "non" })).toEqual([]);
  });

  it("permis : baisse complète et retour en stock (sans prix) ; boutique vide → null ; doublons retirés", () => {
    expect(readNewsItem(drop())).toEqual(drop());
    expect(readNewsItem({ ...restock(), price: 50, currency: "EUR" })).toEqual(restock());
    expect(readNewsItem(drop({ merchantName: " " }))?.merchantName).toBeNull();
    expect(readNewsList({ items: [drop(), drop(), restock(), { kind: "sold_out" }] })).toEqual([drop(), restock()]);
  });
});

describe("2. Textes : toujours le prix vu, son jour et sa boutique ; jamais « promotion » ni prix barré", () => {
  it("permis : les phrases exactes, en français et en anglais", () => {
    setActiveLocale("fr");
    expect(fr.wishAlerts.newsTitle(1)).toBe("1 nouveauté");
    expect(fr.wishAlerts.newsTitle(2)).toBe("2 nouveautés");
    expect(newsLine(drop(), "fr")).toBe("Veste Nuage 07 : 69 €, 20 € sous votre seuil · prix vu le 21 novembre chez Boutique Exemple");
    expect(newsLine(restock(), "fr")).toBe("De nouveau disponible : Veste Nuage 07 · vu le 21 novembre chez Boutique Exemple");
    expect(newsLine(drop({ seenOn: "2026-12-01", price: 69.5 }), "fr")).toBe("Veste Nuage 07 : 69,50 €, 19,50 € sous votre seuil · prix vu le 1er décembre chez Boutique Exemple");
    setActiveLocale("en");
    expect(en.wishAlerts.newsTitle(1)).toBe("1 update");
    expect(en.wishAlerts.newsTitle(3)).toBe("3 updates");
    expect(newsLine(drop(), "en")).toBe("Veste Nuage 07: €69, €20 below your threshold · price seen on November 21 at Boutique Exemple");
    expect(newsLine(restock(), "en")).toBe("Available again: Veste Nuage 07 · seen on November 21 at Boutique Exemple");
  });

  it("boutique inconnue : refusé « chez … » inventé ; permis : le prix et le jour seuls", () => {
    setActiveLocale("fr");
    const line = newsLine(drop({ merchantName: null }), "fr");
    expect(line).not.toMatch(/chez/);
    expect(line).toBe("Veste Nuage 07 : 69 €, 20 € sous votre seuil · prix vu le 21 novembre");
    setActiveLocale("en");
    expect(newsLine(restock({ merchantName: null }), "en")).toBe("Available again: Veste Nuage 07 · seen on November 21");
  });

  it("refusé : aucun mot interdit dans les nouveaux textes ; permis : « votre seuil », « vous »", () => {
    const texts = [fr, en].flatMap((catalog) => [
      catalog.wishAlerts.newsTitle(2),
      catalog.wishAlerts.newsSource,
      catalog.wishAlerts.newsPriceDrop("Pièce", "69 €", "20 €", "21 novembre", "Boutique"),
      catalog.wishAlerts.newsRestock("Pièce", "21 novembre", "Boutique"),
      catalog.wishAlerts.newsOpenHint,
      catalog.wishAlerts.newsHide,
      catalog.wishAlerts.newsHideLabel,
      catalog.wishAlerts.newsTabLabel("Envies"),
    ]);
    for (const text of texts) expect(text).not.toMatch(/promo|authenti|barré|crossed|référence|reference|sale\b|\btu\b|\bton\b|\bta\b/i);
    expect(fr.wishAlerts.newsPriceDrop("P", "1", "2", "3", null)).toContain("votre seuil");
    // Nouvelles clés en bloc à la fin de la section.
    expect(Object.keys(fr.wishAlerts).slice(-8)).toEqual(["newsTitle", "newsSource", "newsPriceDrop", "newsRestock", "newsOpenHint", "newsHide", "newsHideLabel", "newsTabLabel"]);
    expect(Object.keys(en.wishAlerts)).toEqual(Object.keys(fr.wishAlerts));
  });
});

describe("3. « Vu » : sur l'appareil, par compte", () => {
  it("refusé : un autre compte ne voit jamais les marques du premier ; permis : le même compte les retrouve", async () => {
    const store = memoryStore();
    await markNewsSeen(store, "u-1", [id(1)]);
    expect(seenNewsKey("u-1")).toBe("spotto.nouveautes-vues.u-1");
    expect(await loadSeenNews(store, "u-2")).toEqual([]);
    expect(await loadSeenNews(store, "u-1")).toEqual([id(1)]);
    // Seuls des identifiants d'alertes sont gardés : ni titre, ni boutique, ni prix.
    expect(store.data.get(seenNewsKey("u-1"))).toBe(JSON.stringify([id(1)]));
  });

  it("refusé : valeur illisible ou étrangère → aucune marque ; permis : liste bornée, sans doublon, marques déjà là gardées", async () => {
    expect(readSeen("{")).toEqual([]);
    expect(readSeen(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(readSeen(JSON.stringify(["pas-un-id", id(3)]))).toEqual([id(3)]);
    expect(withSeen([id(1)], [id(1), id(2), id(2)])).toEqual([id(1), id(2)]);
    const many = Array.from({ length: SEEN_MAX + 10 }, (_, n) => id(n + 10));
    expect(withSeen([], many)).toEqual(many.slice(-SEEN_MAX));
    const store = memoryStore();
    await markNewsSeen(store, "u-1", [id(1)]);
    expect(await markNewsSeen(store, "u-1", [id(2)])).toEqual([id(1), id(2)]);
  });

  it("refusé : stockage impossible → rien ne casse (null, aucune marque) ; permis : stockage qui marche → marques gardées", async () => {
    const broken: SeenStore = { getItem: () => Promise.reject(new Error("plein")), setItem: () => Promise.reject(new Error("plein")) };
    expect(await markNewsSeen(broken, "u-1", [id(1)])).toBeNull();
    expect(await loadSeenNews(broken, "u-1")).toEqual([]);
    expect(await markNewsSeen(memoryStore(), "u-1", [id(1)])).toEqual([id(1)]);
  });
});

describe("4. Bandeau et pastille", () => {
  it("refusé : une nouveauté déjà vue n'est plus dans le bandeau ni dans la pastille ; permis : non vue, ou affichée pendant cette visite", () => {
    const items = [drop(), restock()];
    expect(unseenItems(items, new Set([id(1)]))).toEqual([restock()]);
    expect(bannerItems(items, new Set([id(1), id(2)]), new Set())).toEqual([]);
    expect(bannerItems(items, new Set([id(1), id(2)]), new Set([id(1)]))).toEqual([drop()]);
    expect(bannerItems(items, new Set(), new Set())).toEqual(items);
  });

  it("la grille : « vu » seulement une fois la grille affichée ; la ligne ouvre l'Envie sans contexte « alerte » ; « Masquer » vide le bandeau", () => {
    const panel = code("components/wishlist-panel.tsx");
    expect(panel).toContain("if (!gridShown) return;");
    expect(panel.indexOf("if (!gridShown) return;")).toBeLessThan(panel.indexOf("markNewsSeen(fresh);"));
    expect(panel).toContain('router.push({ pathname: "/envie", params: { id: item.wishlistItemId } })');
    expect(panel).toContain("onHide={() => setNewsShown(new Set())}");
    // Le bandeau est en tête de la liste (il défile avec elle : jamais un écran bouché).
    expect(panel.indexOf("<WishAlertNewsBanner")).toBeLessThan(panel.indexOf("<WishlistTools"));
  });

  it("refusé : une ligne du bandeau n'ouvre jamais l'Envie en « price_alert » (la confidentialité dit « seulement » le nombre et la sorte) ; permis : la fiche ouverte par une notification, elle, garde « price_alert »", () => {
    const panel = code("components/wishlist-panel.tsx");
    expect(panel).not.toMatch(/from:\s*FROM_ALERT/);
    expect(panel).not.toContain("FROM_ALERT");
    expect(notificationHref({ kind: "wish", id: "w1" })).toEqual({ pathname: "/envie", params: { id: "w1", from: FROM_ALERT } });
    expect(code("app/(app)/envie.tsx")).toContain('context={from === FROM_ALERT ? "price_alert" : "wishlist"}');
  });

  it("le Profil : pastille et libellé VoiceOver seulement s'il reste du non-vu ; nouveautés relues à chaque retour", () => {
    const profile = code("app/(app)/(tabs)/profile/index.tsx");
    expect(profile).toContain('{news.hasUnseen ? <View style={styles.segDot} testID="pastille-envies" /> : null}');
    expect(profile).toContain("accessibilityLabel={news.hasUnseen ? t.wishAlerts.newsTabLabel(t.wishlist.title) : t.wishlist.title}");
    expect(profile).toContain("refreshNews();");
    // Lot « navigation » : l'en-tête du profil défile avec les Envies.
    expect(profile).toContain("<WishlistPanel news={news} header={profileHeader(false)} bottomSpace={tabBarSpace} />");
  });

  it("refusé : rien du compte précédent après un changement de compte ; « vu » jamais envoyé au serveur", () => {
    const hook = code("lib/use-wish-alert-news.ts");
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*run\.current \+= 1;\s*setItems\(\[\]\);\s*setSeen\(new Set\(\)\);\s*\}, \[userId\]\);/);
    expect(code("lib/wish-alert-news.ts")).not.toMatch(/fetch|authorizedFetch/);
    // La seule requête : la lecture GET /api/alerts/news ; un serveur plus ancien (404) : aucune nouveauté.
    const api = code("lib/api.ts");
    const fetchNews = api.slice(api.indexOf("export async function fetchWishAlertNews"), api.indexOf("export async function fetchWishAlert("));
    expect(fetchNews).toContain('authorizedFetch("/api/alerts/news")');
    expect(fetchNews).not.toContain("method:");
    expect(fetchNews).toContain("if (e instanceof ApiError) return [];");
  });

  it("le bandeau : rôles et libellés pour VoiceOver ; texte libre de passer à la ligne (aucune coupure)", () => {
    const banner = code("components/wish-alert-news-banner.tsx");
    expect(banner).toContain('accessibilityRole="header"');
    expect(banner).toContain('accessibilityRole="link"');
    expect(banner).toContain("accessibilityHint={t.wishAlerts.newsOpenHint}");
    expect(banner).toContain("accessibilityLabel={t.wishAlerts.newsHideLabel}");
    expect(banner).not.toContain("numberOfLines");
    expect(banner).toContain("if (items.length === 0) return null;");
  });
});

describe("5. Statistiques (catalogue fermé, ajout seulement)", () => {
  it("permis : news_banner_shown (count) et news_line_opened (kind) ; refusé : toute autre propriété (pièce, boutique, prix, platform)", () => {
    expect(sanitizeProps("news_banner_shown", { count: 2, title: "Veste", platform: "tiktok" })).toEqual({ count: 2 });
    expect(sanitizeProps("news_line_opened", { kind: "restock", merchant: "Boutique", price: 69 })).toEqual({ kind: "restock" });
    expect(sanitizeProps("news_line_opened", { kind: "sold_out" })).toEqual({});
    for (const event of ["news_banner_shown", "news_line_opened"] as const) {
      for (const forbidden of ["platform", "matchId", "url", "merchant", "price", "title", "wishlist_item_id", "seenOn"]) expect(Object.keys(ANALYTICS_EVENTS[event])).not.toContain(forbidden);
    }
    // Envoyés par lib/wish-alert-news.ts (la grille n'appelle jamais track elle-même) ; rien pour zéro nouveauté.
    track.mockReset();
    trackNewsShown(0);
    trackNewsShown(2);
    trackNewsOpened(drop());
    expect(track.mock.calls).toEqual([
      ["news_banner_shown", { count: 2 }],
      ["news_line_opened", { kind: "price_drop" }],
    ]);
    expect(code("components/wishlist-panel.tsx")).not.toContain("track(");
    const doc = readFileSync(join(__dirname, "../STATISTIQUES.md"), "utf8");
    expect(doc).toContain("`news_banner_shown`");
    expect(doc).toContain("`news_line_opened`");
  });
});

describe("6. Politique de confidentialité", () => {
  const section = (doc: typeof privacyPolicy, title: string) => doc.sections.find((s) => s.title === title)!.blocks.flat().join("\n");

  it("permis : le paragraphe des nouveautés, en français et en anglais ; refusé : une phrase existante changée", () => {
    const frAlerts = section(privacyPolicy, "Alertes prix et stock");
    expect(frAlerts).toContain("Les nouveautés dans l'app : en tête de vos Envies,");
    expect(frAlerts).toContain("Ce que vous avez déjà vu est noté seulement sur votre appareil, pour votre compte");
    expect(frAlerts).toContain("Une alerte qui n'a pas pu partir expire le 3e jour. Les alertes sont effacées au bout de 30 jours.");
    const enAlerts = section(privacyPolicyEn, "Price and stock alerts");
    expect(enAlerts).toContain("Updates in the app: at the top of your Wishlist,");
    expect(enAlerts).toContain("What you have already seen is noted only on your device, for your account");
  });

  it("permis : les deux comptages des nouveautés sont dits (FR et EN), sans nouvelle version ; refusé : « rien de plus n'est envoyé » et « membres prévenus … statistiques d'usage » sans exception", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    const dataFr = privacyPolicy.sections.find((s) => s.title === "Les données que nous utilisons")!.blocks as string[];
    const statsFr = dataFr.findIndex((block) => block.startsWith("Des statistiques d'usage, SEULEMENT si vous l'acceptez"));
    expect(dataFr[statsFr + 2]).toBe("Si vous les acceptez, les statistiques d'usage comptent aussi le nombre de nouveautés affichées en tête de vos Envies et la sorte (baisse de prix ou retour en stock) de celle que vous ouvrez ; jamais la pièce, la boutique, le prix ni le jour.");
    const dataEn = privacyPolicyEn.sections.find((s) => s.title === "The data we use")!.blocks as string[];
    const statsEn = dataEn.findIndex((block) => block.startsWith("Usage statistics, ONLY if you agree"));
    expect(dataEn[statsEn + 2]).toBe("If you accept them, usage statistics also count the number of updates shown at the top of your Wishlist and the kind (price drop or return to stock) of the one you open; never the piece, the shop, the price or the day.");
    const frAlerts = section(privacyPolicy, "Alertes prix et stock");
    const enAlerts = section(privacyPolicyEn, "Price and stock alerts");
    expect(frAlerts).not.toContain("rien de plus n'est envoyé");
    expect(enAlerts).not.toContain("nothing more is sent");
    expect(frAlerts).toContain("ces identifiants ne sont ni envoyés à Spotto ni gardés par notre serveur. Si vous acceptez les statistiques d'usage, elles comptent seulement le nombre de nouveautés affichées et la sorte de celle que vous ouvrez");
    expect(enAlerts).toContain("these identifiers are neither sent to Spotto nor kept by our server. If you accept usage statistics, they only count the number of updates shown and the kind of the one you open");
    // Refusé : « Seule exception » serait faux (une fiche ouverte par une
    // notification compte « price_alert ») ; permis : les deux cas nommés.
    expect(frAlerts).not.toContain("Seule exception");
    expect(enAlerts).not.toContain("The only exception");
    expect(frAlerts).toContain("les rapports d'erreur ou les statistiques d'usage. Exceptions, si vous les acceptez : les statistiques d'usage comptent le nombre de nouveautés affichées en tête de vos Envies et la sorte de celle que vous ouvrez ; et, pour une fiche ouverte depuis une notification d'alerte, le clic vers la boutique qui suit, le retour de la boutique et la question « Vous l'avez achetée ? » sont comptés comme venant d'une alerte, sans la pièce, la boutique ni le prix.");
    expect(enAlerts).toContain("error reports or usage statistics. The exceptions, if you accept them: usage statistics count the number of updates shown at the top of your Wishlist and the kind of the one you open; and, for a wish page opened from an alert notification, the shop click that follows, the return from the shop and the “Did you buy it?” question are counted as coming from an alert, without the piece, the shop or the price.");
  });
});
