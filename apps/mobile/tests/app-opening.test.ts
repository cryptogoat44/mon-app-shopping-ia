import { beforeEach, describe, expect, it } from "vitest";
import { __setAnalyticsTestHooks, setAnalyticsUser } from "../src/lib/analytics";
import { sanitizeProps } from "../src/lib/analytics-events";
import { RESUME_GAP_MS, __resetAppOpening, trackAppOpened } from "../src/lib/app-opening";

// Lot « app iPhone prête » (point 21) : « ouverture de l'app », pour savoir si
// les gens reviennent. Seulement avec l'accord aux statistiques, dans le
// catalogue fermé, sans rien d'autre que le moment de l'ouverture.
const sent: { event: string; properties: Record<string, unknown> }[] = [];

beforeEach(() => {
  sent.length = 0;
  __resetAppOpening();
  __setAnalyticsTestHooks({ apiKey: "phc_test", sender: (_url, body) => sent.push(JSON.parse(body)) });
  setAnalyticsUser(null, false);
});

describe("événement « ouverture de l'app »", () => {
  it("rien sans compte ni sans accord aux statistiques", () => {
    expect(trackAppOpened("launch")).toBe(false);
    setAnalyticsUser("u-1", false);
    expect(trackAppOpened("launch")).toBe(false);
    expect(trackAppOpened("resume")).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("lancement : une seule fois ; retour dans l'app : après 30 minutes au moins", () => {
    setAnalyticsUser("u-1", true);
    const start = 1_000_000;
    expect(trackAppOpened("launch", start)).toBe(true);
    expect(trackAppOpened("launch", start + 1)).toBe(false);
    expect(trackAppOpened("resume", start + RESUME_GAP_MS - 1)).toBe(false);
    expect(trackAppOpened("resume", start + RESUME_GAP_MS)).toBe(true);
    expect(sent.map((event) => [event.event, event.properties.context])).toEqual([
      ["app_opened", "launch"],
      ["app_opened", "resume"],
    ]);
  });

  it("catalogue fermé : seulement « launch » ou « resume »", () => {
    expect(sanitizeProps("app_opened", { context: "launch", screen: "spotter", email: "camille@example.com" })).toEqual({ context: "launch" });
    expect(sanitizeProps("app_opened", { context: "autre" })).toEqual({});
  });
});
