import { beforeEach, describe, expect, it } from "vitest";
import { __setAnalyticsTestHooks, setAnalyticsConsent, setAnalyticsUser, track } from "../src/lib/analytics";
import type { AnalyticsEvent, AnalyticsProps } from "../src/lib/analytics-events";

// Lot « mesure du parcours » : les nouveaux événements et les nouvelles
// propriétés passent par le même envoi que tout le reste (analytics.ts) —
// rien sans compte ni sans accord « statistiques d'usage », et seulement le
// catalogue fermé. Envoi simulé : rien ne part chez PostHog.
const sent: { event: string; properties: Record<string, unknown> }[] = [];

const NEW: [AnalyticsEvent, AnalyticsProps][] = [
  ["journey_started", { entry: "link_share", link_platform: "tiktok", url: "https://vm.tiktok.com/ZMabc123/" }],
  ["server_first_response", { wait_ms: 41_234, context: "launch", ok: true, path: "/api/consents" }],
  ["plan_b_screenshot_chosen", { link_platform: "instagram", cause: "refused", query: "veste en daim" }],
  ["first_search_guide", { action: "skipped", step: 2, text: "Entourez la pièce" }],
  ["spot_completed", { outcome: "results", results_count: 12, complement: "shown", complement_count: 3, wait_ms: 2_349, shops_wait_ms: 9_951, searchId: "s-1" }],
  ["merchant_link_opened", { context: "result", rank: 2, displayed_position: 1, in_no_price_section: false, mark: "official_shop", merchant: "Marque" }],
];

beforeEach(() => {
  sent.length = 0;
  __setAnalyticsTestHooks({ apiKey: "phc_test", platform: "ios", sender: (_url, body) => sent.push(JSON.parse(body)) });
  setAnalyticsUser(null, false);
});

describe("même accord, même catalogue fermé", () => {
  it("sans compte, sans accord, ou après le retrait : rien n'est envoyé", () => {
    for (const [event, props] of NEW) track(event, props);
    setAnalyticsUser("u-1", false);
    for (const [event, props] of NEW) track(event, props);
    setAnalyticsUser("u-1", true);
    setAnalyticsConsent(false);
    for (const [event, props] of NEW) track(event, props);
    expect(sent).toEqual([]);
  });

  it("avec l'accord : seulement les propriétés admises, durées arrondies ; « link_platform » arrive, « platform » reste l'appareil", () => {
    setAnalyticsUser("u-1", true);
    for (const [event, props] of NEW) track(event, props);
    const common = { environment: "development", platform: "ios", $geoip_disable: true, $process_person_profile: false };
    expect(sent.map(({ event, properties }) => [event, properties])).toEqual([
      ["journey_started", { entry: "link_share", link_platform: "tiktok", ...common }],
      ["server_first_response", { wait_ms: 41_200, context: "launch", ok: true, ...common }],
      ["plan_b_screenshot_chosen", { link_platform: "instagram", cause: "refused", ...common }],
      ["first_search_guide", { action: "skipped", step: 2, ...common }],
      ["spot_completed", { outcome: "results", results_count: 12, complement: "shown", complement_count: 3, wait_ms: 2_300, shops_wait_ms: 10_000, ...common }],
      ["merchant_link_opened", { context: "result", rank: 2, displayed_position: 1, in_no_price_section: false, mark: "official_shop", ...common }],
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/tiktok\.com|consents|daim|pièce|s-1|Marque/);
  });
});
