import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookPagesStatus, PublicLook } from "@monapp/shared-types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { showsNavigator, rootContent } from "../src/lib/root-route";
import {
  LOOK_PATH,
  lookDateNote,
  lookImagePrefix,
  lookPriceText,
  lookReportMailto,
  lookShareAllowed,
  lookShareMessage,
  lookShopLinkLabel,
  lookStockText,
  lookTokenFrom,
  lookVerdictSentence,
  markSignupFromLook,
  parsePublicLook,
  readLookPagesStatus,
  takeSignupFromLook,
} from "../src/lib/look-page";
import { verdictSentence } from "../src/lib/verdict";
import { affiliateMentionForm } from "../src/lib/affiliate-link";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { __setAnalyticsTestHooks, setAnalyticsUser, track } from "../src/lib/analytics";

// La page look (lot « page look », décisions du fondateur du 23 novembre
// 2026), côté app : la page publique (app/look.tsx, lib/look-page.ts,
// lib/look-public.ts), le bouton du résultat, les statistiques. Un cas
// refusé, un cas permis par règle.

const SRC = join(__dirname, "../src");
const source = (path: string) => readFileSync(join(SRC, path), "utf8");

const SUPABASE = "https://projet.supabase.co";
const PREFIX = lookImagePrefix(SUPABASE)!;
const IMAGE = `${PREFIX}0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.jpg`;
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function page(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    searchedOn: "2026-11-23",
    expiresOn: "2026-12-23",
    piece: { name: "Robe portefeuille en lin", brand: "Exemplor", image: IMAGE },
    verdict: { level: "identified", shopCount: 3, priceRange: { min: 49.95, max: 64, currency: "EUR" } },
    offers: [
      { shop: "Zara", url: "https://www.zara.com/robe", affiliate: false, price: 49.95, currency: "EUR", mark: "official_shop", inStock: true, section: "shared" },
      { shop: "Zalando", url: "https://partenaire.example/zalando?aff=spotto", affiliate: true, price: 59, currency: "EUR", mark: "known_shop", inStock: null, section: "shopping" },
      { shop: "Boutique", url: "https://boutique.example/robe", affiliate: false, price: null, currency: null, mark: null, inStock: false, section: "shopping" },
    ],
    ...overrides,
  };
}

describe("l'écran public s'affiche sans attendre le profil", () => {
  it("permis : /look montre la navigation pendant le démarrage (police prête) ; refusé : un autre chemin", () => {
    expect(LOOK_PATH).toBe("/look");
    expect(showsNavigator("splash", "/look", true)).toBe(true);
    expect(rootContent("splash", "/look", true, "web")).toBe("navigator");
    expect(showsNavigator("splash", "/lookbook", true)).toBe(false);
    expect(showsNavigator("splash", "/", true)).toBe(false);
    expect(showsNavigator("splash", "/look", false)).toBe(false);
  });

  it("l'écran est déclaré hors des groupes protégés, à côté de « aide »", () => {
    const layout = source("app/_layout.tsx");
    expect(layout).toMatch(/<Stack\.Screen name="aide" \/>\s*\{\/\*[^]*?\*\/\}\s*<Stack\.Screen name="look" \/>/);
    const lastProtected = layout.lastIndexOf("</Stack.Protected>");
    expect(layout.indexOf('<Stack.Screen name="look" />')).toBeGreaterThan(lastProtected);
  });
});

describe("le jeton de l'adresse", () => {
  it("permis : 22 signes base64url ; refusé : tout le reste (aucun appel au serveur)", () => {
    expect(lookTokenFrom(TOKEN)).toBe(TOKEN);
    expect(lookTokenFrom([TOKEN, "autre"])).toBe(TOKEN);
    for (const bad of [undefined, "", "court", `${TOKEN}x`, "AbCdEfGhIjKlMnOpQrSt/v", "AbCdEfGhIjKlMnOpQrSt%v", 42]) expect(lookTokenFrom(bad)).toBeNull();
  });
});

describe("la réponse est revérifiée dans l'app : tout écart donne « introuvable »", () => {
  it("permis : une page bien formée", () => {
    const look = parsePublicLook(page(), PREFIX);
    expect(look?.piece).toEqual({ name: "Robe portefeuille en lin", brand: "Exemplor", image: IMAGE });
    expect(look?.offers).toHaveLength(3);
  });

  it("refusé : un lien javascript:, une image d'un autre site ou hors du dossier des copies, une version 2, une section inconnue", () => {
    const offers = page().offers as Record<string, unknown>[];
    for (const trapped of [
      page({ offers: [{ ...offers[0], url: "javascript:alert(1)" }] }),
      page({ offers: [offers[0], { ...offers[1], url: "data:text/html,<script>" }] }),
      page({ piece: { name: "Robe", brand: null, image: "https://autre-site.example/robe.jpg" } }),
      page({ piece: { name: "Robe", brand: null, image: `${SUPABASE}/storage/v1/object/public/post-media/a0000000-0000-4000-8000-000000000001/look-x.jpg` } }),
      page({ piece: { name: "Robe", brand: null, image: `${PREFIX}../avatars/moi.jpg` } }),
      page({ v: 2 }),
      page({ offers: [{ ...offers[0], section: "words" }] }),
      page({ offers: [offers[1]] }),
      page({ offers: [] }),
      page({ searchedOn: "2026-11-23T10:15:00Z" }),
      null,
      "texte",
    ]) {
      expect(parsePublicLook(trapped, PREFIX)).toBeNull();
    }
    // Sans adresse de stockage connue : aucune image acceptée.
    expect(parsePublicLook(page(), null)).toBeNull();
    expect(parsePublicLook(page({ piece: { name: "Robe", brand: null, image: null } }), null)).not.toBeNull();
  });

  it("refusé : les champs en trop ne passent pas", () => {
    const look = parsePublicLook(page({ username: "alice", sourceUrl: "https://www.tiktok.com/@alice/video/1", piece: { name: "Robe", brand: null, image: null, query: "mes mots" } }), PREFIX)!;
    expect(JSON.stringify(look)).not.toMatch(/alice|tiktok|mes mots/);
    expect(Object.keys(look).sort()).toEqual(["expiresOn", "offers", "piece", "searchedOn", "v", "verdict"]);
  });
});

describe("ce que montre la page : prix datés, stock daté, verdict daté, « Lien affilié »", () => {
  const look = parsePublicLook(page(), PREFIX)!;

  it("chaque prix est suivi de sa date ; sans prix, « Prix à vérifier chez le marchand » (FR et EN)", () => {
    expect(lookPriceText(look.offers[0]!, look.searchedOn, fr.look, fr.result.priceOnSite, "fr")).toBe("49,95 € · vu le 23 nov. 2026");
    expect(lookPriceText(look.offers[0]!, look.searchedOn, en.look, en.result.priceOnSite, "en")).toBe("€49.95 · seen on Nov 23, 2026");
    expect(lookPriceText(look.offers[2]!, look.searchedOn, fr.look, fr.result.priceOnSite, "fr")).toBe(fr.result.priceOnSite);
    expect(lookShopLinkLabel(look.offers[1]!, look.searchedOn, fr.look, "fr")).toBe("Voir chez Zalando, 59 €, vu le 23 nov. 2026");
    expect(lookShopLinkLabel(look.offers[2]!, look.searchedOn, en.look, "en")).toBe("View at Boutique, check the price with the retailer");
    expect(lookDateNote(look.searchedOn, fr.look, "fr")).toBe("Prix et stock vus dans les boutiques le 23 novembre 2026. Ils ont pu changer depuis : vérifiez sur le site de la boutique.");
  });

  it("le stock dit d'où et de quand il vient ; rien quand il est inconnu", () => {
    expect(lookStockText(look.offers[0]!, look.searchedOn, fr.look, "fr")).toBe("En stock, d'après Google le 23 nov. 2026");
    expect(lookStockText(look.offers[2]!, look.searchedOn, en.look, "en")).toBe("Sold out, according to Google on Nov 23, 2026");
    expect(lookStockText(look.offers[1]!, look.searchedOn, fr.look, "fr")).toBeNull();
  });

  it("le verdict : la date à la place de « au moment de la recherche » ; les autres niveaux, la phrase du résultat telle quelle", () => {
    const identified = lookVerdictSentence(look.verdict!, look.searchedOn, fr, "fr");
    expect(identified).toBe("Pièce identifiée, d'après les titres des boutiques : 3 boutiques, de 49,95 € à 64 € le 23 nov. 2026.");
    expect(identified).not.toContain("au moment de la recherche");
    expect(lookVerdictSentence({ level: "identified", shopCount: 2, priceRange: { min: 70, max: 70, currency: "EUR" } }, look.searchedOn, en, "en")).toBe(
      "Piece identified from the shops' titles: 2 shops, all at €70 on Nov 23, 2026."
    );
    for (const verdict of [{ level: "close" as const }, { level: "lookalikes" as const }, { level: "identified" as const, shopCount: 2 }]) {
      expect(lookVerdictSentence(verdict, look.searchedOn, fr, "fr")).toBe(verdictSentence(verdict, fr.result.verdict, "fr"));
    }
  });

  it("« Lien affilié » : permis sous une offre affiliée, refusé sous les autres", () => {
    expect(affiliateMentionForm(look.offers[1]!.affiliate, { explain: false })).toBe("plain");
    expect(affiliateMentionForm(look.offers[0]!.affiliate, { explain: true })).toBe("none");
    const screen = source("app/look.tsx");
    expect(screen).toContain("<AffiliateMention isAffiliate={shared.affiliate} explain centered />");
    expect(screen).toContain("<AffiliateMention isAffiliate={offer.affiliate} />");
  });

  it("le message partagé : la phrase et le lien de la page, sans mention « lien affilié »", () => {
    expect(lookShareMessage("Robe", "https://site.example/look?l=x", fr.look)).toBe("Regardez ce que j'ai trouvé avec Spotto : Robe\nhttps://site.example/look?l=x");
    expect(lookShareMessage("Robe", "https://site.example/look?l=x", en.look)).toBe("Look what I found with Spotto: Robe\nhttps://site.example/look?l=x");
    expect(lookShareMessage("Robe", "https://x", fr.look)).not.toMatch(/affili/i);
  });

  it("« Signaler cette page » : un e-mail avec le lien de la page ; sans adresse réelle, rien (l'écran mène à l'aide)", () => {
    expect(lookReportMailto("contact@exemple.fr", "https://site.example/look?l=x", fr.look)).toBe(
      `mailto:contact@exemple.fr?subject=${encodeURIComponent("Signalement d'une page look")}&body=${encodeURIComponent("https://site.example/look?l=x")}`
    );
    expect(lookReportMailto(null, "https://site.example/look?l=x", fr.look)).toBeNull();
  });
});

describe("appels au serveur depuis la page publique", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.example");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", SUPABASE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("permis : un seul appel, la route publique, sans session ni identifiant ; une page piégée donne « introuvable »", async () => {
    const { fetchPublicLook } = await import("../src/lib/look-public");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page()), { status: 200 }));
    const found = await fetchPublicLook(TOKEN);
    expect(found.kind).toBe("found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.example/api/looks/public/${TOKEN}`);
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(init.credentials).toBe("omit");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page({ v: 2 })), { status: 200 }));
    expect((await fetchPublicLook(TOKEN)).kind).toBe("gone");
  });

  it("introuvable (404) et erreur réseau ou serveur (à réessayer) sont distincts", async () => {
    const { fetchPublicLook } = await import("../src/lib/look-public");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "look_not_found" }), { status: 404 }));
    expect((await fetchPublicLook(TOKEN)).kind).toBe("gone");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect((await fetchPublicLook(TOKEN)).kind).toBe("error");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    expect((await fetchPublicLook(TOKEN)).kind).toBe("error");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await fetchPublicLook(TOKEN)).kind).toBe("error");
  });

  it("« Trouver la mienne » : un seul appel à /health, jamais attendu", async () => {
    const { wakeServer } = await import("../src/lib/look-public");
    fetchMock.mockResolvedValueOnce(new Response("ok"));
    wakeServer();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example/health");
  });

  it("l'écran : aucun appel avec la session, aucun appel à /health à l'affichage, rien d'écrit sur l'appareil, rien de compté, page non indexée", () => {
    const screen = source("app/look.tsx");
    expect(screen).not.toMatch(/from "@\/lib\/api"|authorizedFetch|from "@\/lib\/analytics"|track\(|AsyncStorage|localStorage|sessionStorage|SecureStore/);
    expect(screen).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(screen).toContain("<title>{t.look.pageTitle}</title>");
    // /health : seulement dans le geste « Trouver la mienne ».
    expect(screen.match(/wakeServer\(\)/g)).toHaveLength(1);
    const findMine = screen.slice(screen.indexOf("const findMine = useCallback"), screen.indexOf("const discover"));
    expect(findMine).toContain("wakeServer()");
    // Jeton mal formé : aucun appel.
    expect(screen).toContain("if (!token) {");
    // Le nom du membre n'est jamais affiché : la page ne lit rien du compte, hors « connecté ou non ».
    expect(screen).not.toMatch(/profile|username|displayName/);
    // L'attente habituelle tant que le serveur dort.
    expect(screen).toContain('<ConnectingNotice state="waking" />');
  });
});

describe("le bouton « Partager le look »", () => {
  const ON: LookPagesStatus = { enabled: true, manage: true };
  const recent = { searchId: "s1", status: "success" as const, createdAt: new Date(Date.now() - 3_600_000).toISOString() };
  const real = { real: true };

  it("refusé : sans statut, statut coupé, ancien serveur, pièce de démonstration, recherche de plus de 30 jours, boutiques attendues, échec", () => {
    expect(lookShareAllowed(null, real, recent)).toBe(false);
    expect(lookShareAllowed({ enabled: false, manage: true }, real, recent)).toBe(false);
    expect(lookShareAllowed(readLookPagesStatus(null), real, recent)).toBe(false);
    expect(lookShareAllowed(ON, { real: false }, recent)).toBe(false);
    expect(lookShareAllowed(ON, {}, recent)).toBe(false);
    expect(lookShareAllowed(ON, real, { ...recent, createdAt: new Date(Date.now() - 31 * 86_400_000).toISOString() })).toBe(false);
    expect(lookShareAllowed(ON, real, { ...recent, createdAt: undefined })).toBe(false);
    expect(lookShareAllowed(ON, real, { ...recent, complement: { shopping: [], words: [], status: null, query: null, suggestText: false, textStatus: null, pending: true } })).toBe(false);
    expect(lookShareAllowed(ON, real, { ...recent, status: "failed" })).toBe(false);
  });

  it("permis : statut allumé, vraie proposition, recherche terminée de moins de 30 jours", () => {
    expect(lookShareAllowed(ON, real, recent)).toBe(true);
    expect(lookShareAllowed(ON, real, { ...recent, createdAt: new Date(Date.now() - 29 * 86_400_000).toISOString() })).toBe(true);
  });

  it("le statut : seule une forme connue allume quelque chose", () => {
    expect(readLookPagesStatus({ enabled: true, manage: true })).toEqual({ enabled: true, manage: true });
    expect(readLookPagesStatus({ enabled: true })).toEqual({ enabled: false, manage: false });
    expect(readLookPagesStatus({ enabled: "true", manage: true })).toEqual({ enabled: false, manage: true });
  });

  it("sans statut, l'ancien « Partager » est intact (message, lien de la boutique, mention affiliée)", () => {
    const result = source("app/(app)/spot/result.tsx");
    const handler = result.slice(result.indexOf("async function handleShare()"), result.indexOf("async function confirmLook()"));
    expect(handler).toContain("if (lookAllowed) {");
    expect(handler).toContain("const message = t.result.shareMessage(piece.name, url, isAffiliateLink(piece));");
    expect(handler).toContain("await Share.share({ message });");
    expect(result).toContain("{lookBusy ? t.look.creating : lookAllowed ? t.look.share : t.result.share}");
    expect(fr.look.share).toBe("Partager le look");
    expect(en.look.share).toBe("Share the look");
  });
});

describe("statistiques : rien chez le visiteur, catalogue fermé chez le membre", () => {
  const sent: { body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    sent.length = 0;
    __setAnalyticsTestHooks({ apiKey: "phc_test", sender: (_url, body) => sent.push({ body: JSON.parse(body) }) });
    setAnalyticsUser(null, false);
  });

  it("refusé : look_signup jamais sans compte ni sans accord ; permis : avec les deux", () => {
    track("look_signup", {});
    setAnalyticsUser("u-1", false);
    track("look_signup", {});
    expect(sent).toHaveLength(0);
    setAnalyticsUser("u-1", true);
    track("look_signup", {});
    expect(sent).toHaveLength(1);
  });

  it("aucune propriété hors du catalogue (ni pièce, ni boutique, ni lien, ni « platform »)", () => {
    expect(ANALYTICS_EVENTS.look_shared).toBeDefined();
    expect(sanitizeProps("look_shared", { method: "copy", reused: true, piece: "Robe", url: "https://x", platform: "ios", shop: "Zara" })).toEqual({ method: "copy", reused: true });
    expect(sanitizeProps("look_stopped", { from: "settings", id: "abc" })).toEqual({ from: "settings" });
    expect(sanitizeProps("look_signup", { token: TOKEN })).toEqual({});
  });

  it("le drapeau « inscription venue d'une page » : en mémoire, lu une seule fois", () => {
    expect(takeSignupFromLook()).toBe(false);
    markSignupFromLook();
    expect(takeSignupFromLook()).toBe(true);
    expect(takeSignupFromLook()).toBe(false);
    expect(source("lib/look-page.ts")).not.toMatch(/AsyncStorage|localStorage|sessionStorage|SecureStore/);
    const profile = source("app/complete-profile.tsx");
    expect(profile.indexOf('track("look_signup", {})')).toBeGreaterThan(profile.indexOf('track("signup_completed"'));
  });
});

describe("textes FR et EN", () => {
  it("le bloc « look » est le dernier des deux catalogues, avec les mêmes clés et les textes de la fiche", () => {
    expect(Object.keys(fr).at(-1)).toBe("look");
    expect(Object.keys(en).at(-1)).toBe("look");
    expect(Object.keys(en.look)).toEqual(Object.keys(fr.look));
    expect(fr.look.sheetTitle).toBe("Créer un lien vers cette pièce ?");
    expect(en.look.goneTitle).toBe("This page is no longer available");
    expect(fr.look.footer("23 décembre 2026")).toBe("Page partagée par un membre de Spotto. Elle disparaît au plus tard le 23 décembre 2026.");
    for (const text of [fr.look.pageTitle, fr.look.findMineExplain, en.look.pageTitle]) expect(text).not.toMatch(/promotion|authentique|authentic|prix de référence/i);
  });
});

// Garde de type : une page du serveur est lisible par l'app.
const typed: PublicLook | null = parsePublicLook(page(), PREFIX);
void typed;
