import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « mesure du parcours » : « server_first_response », une fois par
// ouverture comptée par app_opened, la durée de la première requête au
// serveur qui aboutit ou échoue (serveur endormi de l'offre gratuite de
// Render). D'abord la logique seule (horloge simulée), puis le vrai chemin :
// authorizedFetch, app_opened et l'envoi à PostHog (simulé : rien ne part),
// avec le même accord que tout le reste. api.ts lit l'adresse du serveur au
// chargement et importe le client Supabase réel : remplacé ici, `fetch` simulé.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { fetchConsentStatus, fetchMyProfile, fetchSearch } from "../src/lib/api";
import { __setAnalyticsTestHooks, setAnalyticsConsent, setAnalyticsUser } from "../src/lib/analytics";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { RESUME_GAP_MS, __resetAppOpening, trackAppOpened } from "../src/lib/app-opening";
import { __resetServerFirstResponse, createFirstResponseMeter, type FirstResponse } from "../src/lib/server-first-response";
import { __setWaitClock } from "../src/lib/wait-clock";

describe("la logique seule : une mesure par ouverture comptée", () => {
  let now = 0;
  let sent: FirstResponse[] = [];
  const meter = () => createFirstResponseMeter(() => now, (event) => sent.push(event));

  beforeEach(() => {
    now = 0;
    sent = [];
  });

  it("lancement : la première requête, souvent finie avant que l'accord soit lu, part quand app_opened est compté", () => {
    const m = meter();
    const first = m.requestStarted();
    const second = m.requestStarted();
    now = 41_000;
    first("ok");
    now = 42_000;
    second("ok");
    expect(sent).toEqual([]);
    m.openingCounted("launch");
    expect(sent).toEqual([{ wait_ms: 41_000, context: "launch", ok: true }]);
    // Une seule fois : ni un second lancement, ni les requêtes suivantes.
    m.openingCounted("launch");
    m.requestStarted()("ok");
    expect(sent).toHaveLength(1);
  });

  it("ouverture comptée d'abord : la mesure part dès la fin de la première requête", () => {
    const m = meter();
    m.openingCounted("launch");
    const settled = m.requestStarted();
    now = 1_200;
    settled("failed");
    expect(sent).toEqual([{ wait_ms: 1_200, context: "launch", ok: false }]);
  });

  it("requête abandonnée (« Annuler », essai trop long) : rien ; la suivante qui aboutit ou échoue compte", () => {
    const m = meter();
    m.openingCounted("launch");
    const cancelled = m.requestStarted();
    const answered = m.requestStarted();
    now = 15_000;
    cancelled("cancelled");
    expect(sent).toEqual([]);
    now = 52_000;
    answered("ok");
    expect(sent).toEqual([{ wait_ms: 52_000, context: "launch", ok: true }]);
  });

  it("toutes les requêtes abandonnées, ou ouverture jamais comptée (pas d'accord) : rien", () => {
    const cancelledOnly = meter();
    cancelledOnly.openingCounted("launch");
    cancelledOnly.requestStarted()("cancelled");
    const neverCounted = meter();
    neverCounted.requestStarted()("ok");
    expect(sent).toEqual([]);
  });

  it("retour dans l'app : la première requête partie après app_opened, pas une requête d'avant", () => {
    const m = meter();
    m.openingCounted("launch");
    m.requestStarted()("ok");
    expect(sent).toHaveLength(1);
    now = 10_000_000;
    const startedBefore = m.requestStarted();
    m.openingCounted("resume");
    const startedAfter = m.requestStarted();
    now += 800;
    startedBefore("ok");
    expect(sent).toHaveLength(1);
    now += 57_000;
    startedAfter("ok");
    expect(sent[1]).toEqual({ wait_ms: 57_800, context: "resume", ok: true });
    // Lancement de nouveau signalé (autre compte) : déjà compté, rien.
    m.openingCounted("launch");
    m.requestStarted()("ok");
    expect(sent).toHaveLength(2);
  });

  it("catalogue fermé : une durée, l'ouverture et un oui/non, rien d'autre", () => {
    expect(ANALYTICS_EVENTS.server_first_response).toEqual({ wait_ms: { kind: "duration" }, context: { kind: "enum", values: ["launch", "resume"] }, ok: { kind: "bool" } });
    expect(sanitizeProps("server_first_response", { wait_ms: 41_234, context: "launch", ok: true, path: "/api/consents", status: 200 })).toEqual({ wait_ms: 41_200, context: "launch", ok: true });
    expect(sanitizeProps("server_first_response", { wait_ms: 900_000, context: "reveil", ok: "oui" })).toEqual({ wait_ms: 600_000 });
  });
});

describe("le vrai chemin : authorizedFetch, app_opened, puis l'envoi (avec accord seulement)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const posthog: { event: string; properties: Record<string, unknown> }[] = [];
  let now = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const answersAfter = (ms: number, body: unknown, status = 200) => async () => {
    now += ms;
    return json(body, status);
  };
  const firstResponses = () => posthog.filter((item) => item.event === "server_first_response").map((item) => item.properties);

  beforeEach(() => {
    now = 0;
    posthog.length = 0;
    __setWaitClock(() => now);
    __resetServerFirstResponse();
    __resetAppOpening();
    __setAnalyticsTestHooks({ apiKey: "phc_test", platform: "ios", sender: (_url, body) => posthog.push(JSON.parse(body)) });
    setAnalyticsUser(null, false);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    __setWaitClock(null);
    vi.unstubAllGlobals();
  });

  it("serveur endormi au lancement : l'accord lu au bout de 42 s, puis app_opened et la première réponse", async () => {
    fetchMock.mockImplementationOnce(answersAfter(42_000, []));
    await fetchConsentStatus();
    // L'accord est lu, comme dans components/analytics-session.tsx.
    setAnalyticsUser("u-1", true);
    expect(trackAppOpened("launch")).toBe(true);
    expect(posthog.map((item) => item.event)).toEqual(["app_opened", "server_first_response"]);
    expect(firstResponses()).toEqual([{ wait_ms: 42_000, context: "launch", ok: true, environment: "development", platform: "ios", $geoip_disable: true, $process_person_profile: false }]);
    // Une seule fois par ouverture.
    fetchMock.mockImplementationOnce(answersAfter(100, {}));
    await fetchSearch("s1");
    expect(firstResponses()).toHaveLength(1);
  });

  it("réponse en erreur : comptée, « ok » faux ; requête abandonnée par la personne : rien, la suivante compte", async () => {
    setAnalyticsUser("u-1", true);
    expect(trackAppOpened("launch")).toBe(true);
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => {
            now += 20_000;
            reject(new DOMException("Aborted", "AbortError"));
          })
        )
    );
    const cancelled = fetchSearch("s1", controller.signal).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await cancelled).toBeInstanceOf(DOMException);
    expect(firstResponses()).toEqual([]);
    // Sa propre durée seulement, depuis son départ (après l'abandon).
    fetchMock.mockImplementationOnce(answersAfter(3_000, { error: "internal_error", message: "x" }, 503));
    await expect(fetchMyProfile()).rejects.toMatchObject({ status: 503 });
    expect(firstResponses()).toEqual([expect.objectContaining({ wait_ms: 3_000, context: "launch", ok: false })]);
  });

  it("panne du réseau : comptée aussi, « ok » faux", async () => {
    setAnalyticsUser("u-1", true);
    trackAppOpened("launch");
    fetchMock.mockImplementationOnce(async () => {
      now += 60_000;
      throw new TypeError("Network request failed");
    });
    await expect(fetchSearch("s1")).rejects.toBeInstanceOf(TypeError);
    expect(firstResponses()).toEqual([expect.objectContaining({ wait_ms: 60_000, context: "launch", ok: false })]);
  });

  it("retour dans l'app après 30 minutes : une nouvelle mesure, sur la première requête partie après", async () => {
    setAnalyticsUser("u-1", true);
    const opened = 1_000_000;
    trackAppOpened("launch", opened);
    fetchMock.mockImplementationOnce(answersAfter(500, {}));
    await fetchSearch("s1");
    expect(trackAppOpened("resume", opened + RESUME_GAP_MS - 1)).toBe(false);
    fetchMock.mockImplementationOnce(answersAfter(400, {}));
    await fetchSearch("s1");
    expect(trackAppOpened("resume", opened + RESUME_GAP_MS)).toBe(true);
    fetchMock.mockImplementationOnce(answersAfter(48_700, {}));
    await fetchSearch("s1");
    expect(firstResponses().map(({ wait_ms, context }) => [wait_ms, context])).toEqual([
      [500, "launch"],
      [48_700, "resume"],
    ]);
  });

  it("sans accord aux statistiques, ou accord retiré avant la réponse : rien n'est envoyé", async () => {
    // Pas d'accord : ni app_opened, ni première réponse.
    setAnalyticsUser("u-1", false);
    fetchMock.mockImplementationOnce(answersAfter(30_000, []));
    await fetchConsentStatus();
    expect(trackAppOpened("launch")).toBe(false);
    expect(posthog).toEqual([]);
    // Accord donné plus tard (Réglages), retour dans l'app compté, puis retiré pendant la requête.
    setAnalyticsConsent(true);
    expect(trackAppOpened("resume")).toBe(true);
    fetchMock.mockImplementationOnce(async () => {
      setAnalyticsConsent(false);
      now += 2_000;
      return json({});
    });
    await fetchSearch("s1");
    expect(posthog.map((item) => item.event)).toEqual(["app_opened"]);
  });
});
