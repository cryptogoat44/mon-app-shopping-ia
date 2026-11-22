import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « mesure du parcours » : les gestes du parcours ajoutés aux statistiques
// — la capture choisie au plan B (vidéo privée, supprimée ou refusée), le
// guide de la première recherche (montré, passé, terminé) — et les deux
// enregistrements de l'écran Résultat, déjà comptés (rien à combler).
// api.ts importe le client Supabase réel : remplacé ici, `fetch` simulé.
const { track } = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
  return { track: vi.fn() };
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track, setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { addVaultItemFromMatch, addWishlistItem } from "../src/lib/api";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { trackFirstRunGuide } from "../src/lib/first-run-guide";
import { LINK_AI_FAILURES } from "../src/lib/video-link-failures";
import { linkFailureView, planBChoice } from "../src/lib/video-link-analysis";

const SRC = join(__dirname, "../src");
/** Code sans ses commentaires. */
const code = (path: string) =>
  readFileSync(join(SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => track.mockReset());

describe("plan B : « Faire une capture d'écran » après une vidéo privée, supprimée ou refusée", () => {
  it("la cause et la plateforme du lien ; aucun autre échec n'est le plan B", () => {
    expect(planBChoice({ failure: "private", capacity: null }, "tiktok")).toEqual({ link_platform: "tiktok", cause: "private_or_removed" });
    expect(planBChoice({ failure: "refused", capacity: null }, "instagram")).toEqual({ link_platform: "instagram", cause: "refused" });
    for (const failure of LINK_AI_FAILURES.filter((value) => value !== "private" && value !== "refused")) {
      expect(planBChoice({ failure, capacity: null }, "tiktok"), failure).toBeNull();
    }
    expect(planBChoice({ failure: "private", capacity: null }, null)).toBeNull();
  });

  it("ces deux échecs montrent un seul bouton, la capture (le plan B)", () => {
    for (const failure of ["private", "refused"] as const) {
      expect(linkFailureView({ failure, capacity: null }, "fr", "TikTok")).toMatchObject({ primary: "capture", secondary: null });
    }
  });

  it("le plan B montré se lit déjà dans video_link_ai_result (reason) : pas d'événement en double, la plateforme en link_platform", () => {
    expect(Object.keys(ANALYTICS_EVENTS)).not.toContain("plan_b_shown");
    expect(ANALYTICS_EVENTS.video_link_ai_result.reason).toEqual({ kind: "enum", values: LINK_AI_FAILURES });
    expect(sanitizeProps("video_link_ai_result", { platform: "tiktok", outcome: "failed", reason: "private", moments_count: 0, wait_ms: 3_000, link_platform: "tiktok" })).toEqual({
      platform: "tiktok",
      outcome: "failed",
      reason: "private",
      moments_count: 0,
      wait_ms: 3_000,
      link_platform: "tiktok",
    });
  });

  it("catalogue fermé : la plateforme et la cause, rien d'autre", () => {
    expect(sanitizeProps("plan_b_screenshot_chosen", { link_platform: "instagram", cause: "refused", url: "https://www.instagram.com/reel/x/", query: "veste" })).toEqual({
      link_platform: "instagram",
      cause: "refused",
    });
    expect(sanitizeProps("plan_b_screenshot_chosen", { link_platform: "youtube", cause: "private" })).toEqual({});
  });

  it("compté au geste, juste avant la capture ; l'écran donne la plateforme", () => {
    const view = code("components/video-link-analysis.tsx");
    const failure = view.slice(view.indexOf("export function LinkFailureView("), view.indexOf("const styles"));
    expect(failure).toContain("const planB = planBChoice(info, platform);");
    expect(failure).toContain('if (planB) track("plan_b_screenshot_chosen", planB);\n    onCapture();');
    expect(failure).toContain('if (action === "capture") return { label: t.videoLinkAuto.planB.capture, onPress: capture };');
    expect(code("app/(app)/spot/lecteur.tsx")).toContain("platformName={name || undefined} platform={platform} onRetry={auto.retry} onEditQuery={auto.editQuery} onCapture={showCapture}");
  });
});

describe("guide de la première recherche : montré, passé, terminé", () => {
  it("l'action, et l'étape (1 à 3) où la personne passe ou termine", () => {
    trackFirstRunGuide("shown");
    trackFirstRunGuide("skipped", 1);
    trackFirstRunGuide("finished", 2);
    expect(track.mock.calls).toEqual([
      ["first_search_guide", { action: "shown" }],
      ["first_search_guide", { action: "skipped", step: 2 }],
      ["first_search_guide", { action: "finished", step: 3 }],
    ]);
  });

  it("catalogue fermé : un choix et un nombre", () => {
    expect(sanitizeProps("first_search_guide", { action: "skipped", step: 1, text: "Entourez la pièce" })).toEqual({ action: "skipped", step: 1 });
    expect(sanitizeProps("first_search_guide", { action: "closed", step: "deux" })).toEqual({});
  });

  it("au bon moment : montré une fois (marque rangée, écran encore là), « Passer », puis la dernière étape", () => {
    const hook = code("lib/use-first-run-guide.ts");
    const claimed = hook.slice(hook.indexOf("claimFirstRunGuide(AsyncStorage).then("));
    expect(claimed.indexOf("if (!mounted.current) return;")).toBeLessThan(claimed.indexOf('if (claimed) trackFirstRunGuide("shown");'));
    expect(hook.match(/trackFirstRunGuide\(/g)).toHaveLength(1);
    const guide = code("components/first-run-guide.tsx");
    expect(guide).toContain('if (following === null) {\n      trackFirstRunGuide("finished", step);\n      return onStart();\n    }');
    expect(guide).toContain('function skip() {\n    trackFirstRunGuide("skipped", step);\n    onClose();\n  }');
    expect(guide).toContain("<Pressable onPress={skip} hitSlop={8} style={styles.skip}");
  });
});

describe("enregistrer depuis l'écran Résultat : les deux gestes sont déjà comptés", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("« Garder » : wishlist_item_added ; « Je l'ai achetée » : vault_item_added (rien si la pièce y était déjà)", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "w-1" }));
    await addWishlistItem({ title: "Veste", imageUrl: "https://boutique.test/v.jpg", reference: null, priceMin: 50, currency: "EUR", merchantName: "Boutique", merchantUrl: "https://boutique.test/v", productMatchId: "m-1" });
    fetchMock.mockResolvedValueOnce(json({ id: "v-1" }));
    await addVaultItemFromMatch({ title: "Veste", imageUrl: "https://boutique.test/v.jpg", category: "clothing", productMatchId: "m-1" });
    fetchMock.mockResolvedValueOnce(json({ id: "v-1", alreadyInVault: true }));
    await addVaultItemFromMatch({ title: "Veste", imageUrl: "https://boutique.test/v.jpg", category: "clothing", productMatchId: "m-1" });
    expect(track.mock.calls).toEqual([
      ["wishlist_item_added", { context: "result" }],
      ["vault_item_added", { source: "spotter", category: "clothing" }],
    ]);
  });

  it("les boutons de l'écran passent par ces deux appels", () => {
    const screen = code("app/(app)/spot/result.tsx");
    expect(screen.slice(screen.indexOf("async function handleKeep()"), screen.indexOf("function openCategory()"))).toContain("await addToWishlist(piece);");
    expect(screen.slice(screen.indexOf("async function handleBought("), screen.indexOf("function openReport()"))).toContain("await addVaultItemFromMatch(");
    expect(code("api/client.ts")).toContain("await addWishlistItem({");
  });
});
