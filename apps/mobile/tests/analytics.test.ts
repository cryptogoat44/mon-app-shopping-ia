import { beforeEach, describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { POSTHOG_EU_HOST, __setAnalyticsTestHooks, buildCapturePayload, isAnalyticsActive, setAnalyticsConsent, setAnalyticsUser, track } from "../src/lib/analytics";

const sent: { url: string; body: Record<string, unknown> }[] = [];

describe("statistiques d'usage (PostHog UE)", () => {
  beforeEach(() => {
    sent.length = 0;
    __setAnalyticsTestHooks({ apiKey: "phc_test", sender: (url, body) => sent.push({ url, body: JSON.parse(body) }) });
    setAnalyticsUser(null, false);
  });

  it("n'envoie rien sans consentement, sans compte ou sans clé", () => {
    track("like_added");
    setAnalyticsUser("u-1", false);
    track("like_added");
    expect(sent).toHaveLength(0);
    setAnalyticsUser("u-1", true);
    __setAnalyticsTestHooks({ apiKey: null });
    track("like_added");
    expect(sent).toHaveLength(0);
    expect(isAnalyticsActive()).toBe(false);
  });

  it("envoie à l'hôte UE après consentement, et le retrait coupe aussitôt", () => {
    setAnalyticsUser("u-1", true);
    track("comment_posted");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${POSTHOG_EU_HOST}/i/v0/e/`);
    expect(POSTHOG_EU_HOST).toBe("https://eu.i.posthog.com");
    expect(sent[0]!.body).toMatchObject({ event: "comment_posted", distinct_id: "u-1", api_key: "phc_test" });
    setAnalyticsConsent(false);
    track("comment_posted");
    expect(sent).toHaveLength(1);
    // Déconnexion : plus rien, même si le consentement était donné.
    setAnalyticsUser("u-1", true);
    setAnalyticsUser(null, true);
    track("comment_posted");
    expect(sent).toHaveLength(1);
  });

  it("ne laisse passer aucun contenu personnel", () => {
    const props = sanitizeProps("post_published", {
      type: "lifestyle",
      visibility: "public",
      tagged_count: 2,
      caption: "Ma légende",
      email: "camille@example.com",
      username: "camille",
      imageUrl: "https://exemple.com/photo.jpg",
    });
    expect(props).toEqual({ type: "lifestyle", visibility: "public", tagged_count: 2 });
    // Une valeur hors liste est retirée, même pour une propriété admise.
    expect(sanitizeProps("report_submitted", { target_type: "camille@example.com" })).toEqual({});
    expect(sanitizeProps("spot_completed", { outcome: "results", results_count: 12.7 })).toEqual({ outcome: "results", results_count: 13 });
  });

  it("vidéo du Spotter (lot 4) : durée en secondes, source et motif seulement, jamais le contenu", () => {
    expect(sanitizeProps("video_imported", { duration_s: 12.6, source: "library", file_name: "IMG_0042.MOV", uri: "file:///x.mov" })).toEqual({
      duration_s: 13,
      source: "library",
    });
    expect(sanitizeProps("video_rejected", { reason: "too_long", duration_s: 72, source: "file" })).toEqual({ reason: "too_long", duration_s: 72, source: "file" });
    expect(sanitizeProps("video_rejected", { reason: "camille@example.com", source: "tiktok" })).toEqual({});
    expect(sanitizeProps("video_frame_chosen", { duration_s: 45, source: "file", time_s: 12 })).toEqual({ duration_s: 45, source: "file" });
  });

  it("le catalogue n'admet aucun texte libre", () => {
    for (const rules of Object.values(ANALYTICS_EVENTS)) {
      for (const rule of Object.values(rules) as { kind: string }[]) expect(["enum", "count", "bool"]).toContain(rule.kind);
    }
  });

  it("corps envoyé : identifiant interne seulement, sans géolocalisation ni profil", () => {
    const payload = buildCapturePayload("follow_added", { context: "profile", username: "x" }, {
      apiKey: "phc_test",
      userId: "u-1",
      environment: "production",
      platform: "web",
      timestamp: "2026-09-30T10:00:00.000Z",
    });
    expect(payload).toEqual({
      api_key: "phc_test",
      event: "follow_added",
      distinct_id: "u-1",
      timestamp: "2026-09-30T10:00:00.000Z",
      properties: { context: "profile", environment: "production", platform: "web", $geoip_disable: true, $process_person_profile: false },
    });
  });
});
