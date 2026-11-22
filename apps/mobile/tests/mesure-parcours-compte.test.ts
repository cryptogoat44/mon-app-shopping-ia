import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";

// Lot « mesure du parcours » : spot_completed part jusqu'à 40 s après les
// résultats (boutiques ensuite), avec les temps d'attente de la recherche. Il
// ne part que sous le compte qui l'a lancée, et seulement si ce compte avait
// donné son accord au lancement : jamais l'attente d'un compte sous un autre
// (déconnexion puis autre compte dans la même app, ou le même onglet du site,
// qui ne se recharge pas), ni celle d'un lancement sans accord. Vrai chemin :
// runSearch, la demande des boutiques, l'envoi (simulé : rien ne part chez
// PostHog). api.ts lit l'adresse du serveur au chargement et importe le
// client Supabase réel : remplacé ici, et `fetch` est simulé.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { runSearch } from "../src/lib/api";
import { __setAnalyticsTestHooks, analyticsAccount, setAnalyticsConsent, setAnalyticsUser } from "../src/lib/analytics";
import { __resetServerFirstResponse, forgetServerFirstResponse } from "../src/lib/server-first-response";
import { forgetShopsRequests, requestShops } from "../src/lib/spot-shops";
import { __setWaitClock } from "../src/lib/wait-clock";

const match = (id: string, origin?: ProductMatch["origin"]): ProductMatch => ({
  id,
  rank: 1,
  productName: `Pièce ${id}`,
  brand: null,
  imageUrl: `https://boutique.test/${id}.jpg`,
  imageHdUrl: null,
  priceMin: 50,
  priceMax: 50,
  currency: "EUR",
  merchantName: "Boutique",
  merchantUrl: `https://boutique.test/${id}`,
  affiliateUrl: `https://boutique.test/${id}`,
  feedbackReason: null,
  ...(origin ? { origin } : {}),
});

const LAUNCHED: ProductSearch = {
  id: "s1",
  sourceUrl: null,
  sourcePlatform: "photo",
  method: "manual_screenshot",
  status: "completed",
  errorMessage: null,
  query: null,
  createdAt: "2026-11-21T10:00:00.000Z",
  matches: [match("l1"), match("l2")],
  complement: { status: null, suggestText: false, textStatus: null, pending: true },
};
const SHOPS: ProductSearch = { ...LAUNCHED, matches: [...LAUNCHED.matches, match("b1", "shopping")], complement: { status: "shown", query: "veste", suggestText: false, textStatus: null } };
/** Serveur d'avant : tout arrive en une fois, sans boutiques en attente. */
const ALL_AT_ONCE: ProductSearch = SHOPS;

const fetchMock = vi.fn<typeof fetch>();
const posthog: { event: string; distinct_id: string; properties: Record<string, unknown> }[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const sentBy = () => posthog.map((item) => [item.event, item.distinct_id]);
let now = 0;
let deliverShops: (() => void) | null = null;

/** Déconnexion : le nettoyage de components/analytics-session.tsx. */
function signOut() {
  setAnalyticsUser(null, false);
  forgetServerFirstResponse();
}

/** Lancement : la recherche visuelle répond en 7,3 s ; les boutiques attendent `deliverShops`. */
function serverAnswers(launch: ProductSearch, duringLaunch: () => void = () => {}) {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/run")) {
      duringLaunch();
      now += 7_300;
      return json(launch);
    }
    return new Promise<Response>((resolve) => {
      deliverShops = () => resolve(json(SHOPS));
    });
  });
}

/** Les boutiques arrivent 12 s plus tard ; rend la main une fois leur issue traitée par runSearch. */
async function shopsArrive() {
  await vi.waitFor(() => expect(deliverShops).not.toBeNull());
  now += 12_000;
  deliverShops!();
  // La même demande, déjà partie (aucune nouvelle requête) : ses suites, dont celle de runSearch, ont tourné.
  await requestShops("s1", async () => {
    throw new Error("aucune nouvelle demande des boutiques");
  });
}

beforeEach(() => {
  now = 1_000;
  posthog.length = 0;
  deliverShops = null;
  __setWaitClock(() => now);
  __resetServerFirstResponse();
  __setAnalyticsTestHooks({ apiKey: "phc_test", platform: "ios", sender: (_url, body) => posthog.push(JSON.parse(body)) });
  setAnalyticsUser(null, false);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  forgetShopsRequests();
  __setWaitClock(null);
  vi.unstubAllGlobals();
  setAnalyticsUser(null, false);
});

describe("analyticsAccount : le compte dont les statistiques partent", () => {
  it("refusé : null sans compte, sans accord, après le retrait ou sans clé", () => {
    expect(analyticsAccount()).toBeNull();
    setAnalyticsUser("u-a", false);
    expect(analyticsAccount()).toBeNull();
    setAnalyticsUser("u-a", true);
    setAnalyticsConsent(false);
    expect(analyticsAccount()).toBeNull();
    setAnalyticsUser("u-a", true);
    __setAnalyticsTestHooks({ apiKey: null });
    expect(analyticsAccount()).toBeNull();
  });

  it("permis : le compte connecté, avec son accord", () => {
    setAnalyticsUser("u-a", true);
    expect(analyticsAccount()).toBe("u-a");
  });
});

describe("spot_completed : seulement sous le compte qui a lancé, avec son accord", () => {
  it("refusé : A lance, se déconnecte, B se connecte avec accord avant les boutiques : rien sous B, ni l'issue ni les attentes de A", async () => {
    for (const consentOfA of [true, false]) {
      posthog.length = 0;
      deliverShops = null;
      forgetShopsRequests();
      serverAnswers(LAUNCHED);
      setAnalyticsUser("u-a", consentOfA);
      await runSearch("s1", { crop: null, imageUri: null });
      signOut();
      setAnalyticsUser("u-b", true);
      await shopsArrive();
      expect(sentBy()).toEqual(consentOfA ? [["spot_launched", "u-a"]] : []);
      signOut();
    }
  });

  it("permis : A se déconnecte puis revient (même compte) avant les boutiques : spot_completed part sous A, avec ses attentes", async () => {
    serverAnswers(LAUNCHED);
    setAnalyticsUser("u-a", true);
    await runSearch("s1", { crop: null, imageUri: null });
    signOut();
    setAnalyticsUser("u-a", true);
    await shopsArrive();
    expect(sentBy()).toEqual([
      ["spot_launched", "u-a"],
      ["spot_completed", "u-a"],
    ]);
    expect(posthog[1]!.properties).toMatchObject({ outcome: "results", results_count: 2, complement: "shown", complement_count: 1, wait_ms: 7_300, shops_wait_ms: 19_300 });
  });

  it("refusé : lancement sans accord, accord donné avant les boutiques : spot_completed ne part pas (jamais sans son spot_launched)", async () => {
    serverAnswers(LAUNCHED);
    setAnalyticsUser("u-a", false);
    await runSearch("s1", { crop: null, imageUri: null });
    setAnalyticsConsent(true);
    await shopsArrive();
    expect(posthog).toEqual([]);
  });

  it("refusé : serveur d'avant (tout en une fois), lancement avant que l'accord soit lu, lu pendant la recherche : rien pour cette recherche", async () => {
    serverAnswers(ALL_AT_ONCE, () => setAnalyticsUser("u-a", true));
    await runSearch("s1", { crop: null, imageUri: null });
    expect(posthog).toEqual([]);
  });

  it("permis : serveur d'avant, même compte avec accord du lancement à la réponse : spot_launched puis spot_completed, sous A", async () => {
    serverAnswers(ALL_AT_ONCE);
    setAnalyticsUser("u-a", true);
    await runSearch("s1", { crop: null, imageUri: null });
    expect(sentBy()).toEqual([
      ["spot_launched", "u-a"],
      ["spot_completed", "u-a"],
    ]);
    expect(posthog[1]!.properties).toMatchObject({ wait_ms: 7_300, shops_wait_ms: 7_300 });
  });
});
