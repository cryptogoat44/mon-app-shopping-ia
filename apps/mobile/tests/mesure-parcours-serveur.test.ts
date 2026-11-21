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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deleteMyAccount, fetchConsentStatus, fetchMyProfile, fetchSearch, recordAnalyticsChoice } from "../src/lib/api";
import { __setAnalyticsTestHooks, isAnalyticsActive, setAnalyticsConsent, setAnalyticsUser } from "../src/lib/analytics";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { RESUME_GAP_MS, __resetAppOpening, trackAppOpened } from "../src/lib/app-opening";
import { abortForTimeout, wasTimedOut } from "../src/lib/app-timeout";
import { AttemptTimeoutError, withTimeout } from "../src/lib/retry";
import { __resetServerFirstResponse, createFirstResponseMeter, forgetServerFirstResponse, type FirstResponse } from "../src/lib/server-first-response";
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

  it("requête annulée par la personne (« Annuler », écran quitté) : rien ; la suivante qui aboutit ou échoue compte", () => {
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

  it("essai trop long que l'app cesse d'attendre (15 s) : un échec, compté à 15 s ; la réponse plus tardive d'une autre requête ne compte plus", () => {
    const m = meter();
    m.openingCounted("launch");
    const timedOut = m.requestStarted();
    const answered = m.requestStarted();
    now = 15_000;
    timedOut("failed");
    now = 40_000;
    answered("ok");
    expect(sent).toEqual([{ wait_ms: 15_000, context: "launch", ok: false }]);
  });

  it("toutes les requêtes annulées, ou ouverture jamais comptée (pas d'accord) : rien", () => {
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

  it("déconnexion ou autre compte (forget) : la mesure en attente est oubliée, une requête encore en route aussi ; la suivante compte", () => {
    const m = meter();
    // Compte A : lancement mesuré (30 s), jamais compté ; une autre requête encore en route.
    const a = m.requestStarted();
    now = 30_000;
    a("ok");
    const aStillRunning = m.requestStarted();
    m.forget();
    // Compte B : sa propre requête, puis son lancement compté.
    const b = m.requestStarted();
    now = 30_200;
    aStillRunning("ok");
    now = 30_700;
    b("ok");
    m.openingCounted("launch");
    expect(sent).toEqual([{ wait_ms: 700, context: "launch", ok: true }]);
  });

  it("déconnexion pendant un retour compté : la réponse arrivée ensuite ne part pas", () => {
    const m = meter();
    m.openingCounted("resume");
    const a = m.requestStarted();
    m.forget();
    now = 2_000;
    a("ok");
    expect(sent).toEqual([]);
  });

  it("lancement refusé faute d'accord : sa mesure ne part jamais, même comptée plus tard ; après un changement de compte, une nouvelle part", () => {
    const m = meter();
    const a = m.requestStarted();
    now = 25_000;
    a("ok");
    m.launchRefused();
    m.openingCounted("launch");
    m.requestStarted()("ok");
    expect(sent).toEqual([]);
    m.forget();
    const b = m.requestStarted();
    now = 25_400;
    b("ok");
    m.openingCounted("launch");
    expect(sent).toEqual([{ wait_ms: 400, context: "launch", ok: true }]);
  });

  it("lancement refusé : sans effet sur un retour déjà compté", () => {
    const m = meter();
    m.openingCounted("resume");
    m.launchRefused();
    const settled = m.requestStarted();
    now = 900;
    settled("ok");
    expect(sent).toEqual([{ wait_ms: 900, context: "resume", ok: true }]);
  });
});

describe("le vrai chemin : authorizedFetch, app_opened, puis l'envoi (avec accord seulement)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const posthog: { event: string; distinct_id: string; properties: Record<string, unknown> }[] = [];
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

  it("essai du profil que l'app cesse d'attendre (serveur endormi) : un échec compté à la durée de l'attente, pas une annulation", async () => {
    setAnalyticsUser("u-1", true);
    expect(trackAppOpened("launch")).toBe(true);
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => {
            now += 15_000;
            reject(new DOMException("Aborted", "AbortError"));
          })
        )
    );
    // Comme auth-context.tsx (PROFILE_ATTEMPT_TIMEOUT_MS, ici raccourci).
    await expect(withTimeout(20, (signal) => fetchMyProfile(signal))).rejects.toBeInstanceOf(AttemptTimeoutError);
    await vi.waitFor(() => expect(firstResponses()).toHaveLength(1));
    expect(firstResponses()).toEqual([expect.objectContaining({ wait_ms: 15_000, context: "launch", ok: false })]);
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

  it("compte A sans accord, déconnexion, puis compte B avec accord dans la même app : la durée de B, jamais celle de A", async () => {
    // A : sa lecture des accords attend le réveil du serveur (35 s) ; pas d'accord.
    fetchMock.mockImplementationOnce(answersAfter(35_000, []));
    await fetchConsentStatus();
    setAnalyticsUser("u-a", false);
    expect(trackAppOpened("launch")).toBe(false);
    // Déconnexion : le nettoyage de components/analytics-session.tsx (le site ne se recharge pas).
    setAnalyticsUser(null, false);
    forgetServerFirstResponse();
    // B : sa propre lecture des accords, puis son lancement compté.
    fetchMock.mockImplementationOnce(answersAfter(700, []));
    await fetchConsentStatus();
    setAnalyticsUser("u-b", true);
    expect(trackAppOpened("launch")).toBe(true);
    expect(firstResponses()).toEqual([expect.objectContaining({ wait_ms: 700, context: "launch", ok: true })]);
    expect(posthog.map((item) => item.distinct_id)).toEqual(["u-b", "u-b"]);
  });

  it("compte sans accord : la mesure de son lancement ne part jamais, même si l'accord arrive ensuite et qu'un lancement est compté", async () => {
    fetchMock.mockImplementationOnce(answersAfter(25_000, []));
    await fetchConsentStatus();
    setAnalyticsUser("u-1", false);
    expect(trackAppOpened("launch")).toBe(false);
    setAnalyticsConsent(true);
    expect(trackAppOpened("launch")).toBe(true);
    fetchMock.mockImplementationOnce(answersAfter(300, {}));
    await fetchSearch("s1");
    expect(posthog.map((item) => item.event)).toEqual(["app_opened"]);
  });
});

describe("le retrait coupe la collecte avant l'envoi au serveur", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const posthog: { event: string; properties: Record<string, unknown> }[] = [];
  let now = 0;
  const answersAfter = (ms: number, body: unknown, status = 200) => async () => {
    now += ms;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  const opened = 1_000_000;

  beforeEach(async () => {
    now = 0;
    posthog.length = 0;
    __setWaitClock(() => now);
    __resetServerFirstResponse();
    __resetAppOpening();
    __setAnalyticsTestHooks({ apiKey: "phc_test", platform: "ios", sender: (_url, body) => posthog.push(JSON.parse(body)) });
    vi.stubGlobal("fetch", fetchMock);
    // Un membre avec accord : lancement mesuré, puis retour dans l'app 30 minutes plus tard, en attente de sa première réponse.
    setAnalyticsUser("u-1", true);
    trackAppOpened("launch", opened);
    fetchMock.mockImplementationOnce(answersAfter(400, []));
    await fetchConsentStatus();
    expect(trackAppOpened("resume", opened + RESUME_GAP_MS)).toBe(true);
    posthog.length = 0;
  });

  afterEach(() => {
    fetchMock.mockReset();
    __setWaitClock(null);
    vi.unstubAllGlobals();
  });

  it("retrait de l'accord (Réglages), première requête du retour : rien ne part, même la réponse du serveur", async () => {
    fetchMock.mockImplementationOnce(answersAfter(1_500, {}));
    await recordAnalyticsChoice(false);
    expect(posthog).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
  });

  it("retrait dont l'envoi échoue : la collecte reste coupée pour la session", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Network request failed");
    });
    await expect(recordAnalyticsChoice(false)).rejects.toBeInstanceOf(TypeError);
    expect(posthog).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
  });

  it("suppression du compte, première requête du retour : rien ne part sous ce compte", async () => {
    fetchMock.mockImplementationOnce(answersAfter(2_000, {}));
    await deleteMyAccount("SUPPRIMER");
    expect(posthog).toEqual([]);
    expect(isAnalyticsActive()).toBe(false);
  });

  it("permis : une autre requête du retour part avec sa durée ; l'accord ne s'allume qu'une fois enregistré par le serveur", async () => {
    fetchMock.mockImplementationOnce(answersAfter(1_200, {}));
    await fetchSearch("s1");
    expect(posthog.map((item) => [item.event, item.properties.wait_ms, item.properties.context])).toEqual([["server_first_response", 1_200, "resume"]]);
    // Accord donné de nouveau : refusé par le serveur, rien ne s'allume ; enregistré, la collecte reprend.
    setAnalyticsConsent(false);
    fetchMock.mockImplementationOnce(answersAfter(100, { error: "internal_error", message: "x" }, 503));
    await expect(recordAnalyticsChoice(true)).rejects.toMatchObject({ status: 503 });
    expect(isAnalyticsActive()).toBe(false);
    fetchMock.mockImplementationOnce(answersAfter(100, {}));
    await recordAnalyticsChoice(true);
    expect(isAnalyticsActive()).toBe(true);
  });
});

describe("délais de l'app : leur abandon est marqué, celui de la personne non", () => {
  it("abortForTimeout abandonne et marque ; un abandon ordinaire (« Annuler », écran quitté) n'est pas marqué", () => {
    const timedOut = new AbortController();
    abortForTimeout(timedOut);
    expect(timedOut.signal.aborted).toBe(true);
    expect(wasTimedOut(timedOut.signal)).toBe(true);
    const cancelled = new AbortController();
    cancelled.abort();
    expect(wasTimedOut(cancelled.signal)).toBe(false);
  });

  it("withTimeout : marqué au délai dépassé, pas quand la réponse arrive à temps", async () => {
    let late: AbortSignal | null = null;
    const neverAnswers = (signal: AbortSignal) => {
      late = signal;
      return new Promise<never>(() => {});
    };
    await expect(withTimeout(20, neverAnswers)).rejects.toBeInstanceOf(AttemptTimeoutError);
    expect(wasTimedOut(late!)).toBe(true);
    let onTime: AbortSignal | null = null;
    await withTimeout(1_000, async (signal) => {
      onTime = signal;
      return "profil";
    });
    expect(wasTimedOut(onTime!)).toBe(false);
  });

  it("le délai de l'essayage du site passe aussi par abortForTimeout", () => {
    const sheet = readFileSync(join(__dirname, "../src/components/tryon-sheet.web.tsx"), "utf8");
    expect(sheet).toContain("setTimeout(() => abortForTimeout(controller), CLIENT_TIMEOUT_MS)");
    expect(sheet).not.toContain("setTimeout(() => controller.abort()");
  });
});
