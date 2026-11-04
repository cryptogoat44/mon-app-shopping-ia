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

  it("analyse automatique (lot 4, temps 1 bis) : nombres et choix seulement — jamais la description ni les images", () => {
    expect(sanitizeProps("video_ai_consent", { decision: "granted", context: "first_use" })).toEqual({ decision: "granted", context: "first_use" });
    expect(sanitizeProps("video_ai_consent", { decision: "veste en daim", context: "settings" })).toEqual({ context: "settings" });
    expect(sanitizeProps("video_ai_frames_sent", { frames_count: 12, duration_s: 14.4, query: "veste en daim marron" })).toEqual({ frames_count: 12, duration_s: 14 });
    expect(sanitizeProps("video_ai_result", { outcome: "found", moments_count: 3, frames: "data:image/jpeg;base64,AAAA" })).toEqual({ outcome: "found", moments_count: 3 });
    expect(sanitizeProps("video_ai_moment_tried", { rank: 2, box: "0.1,0.2" })).toEqual({ rank: 2 });
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

describe("partage d'une envie (lot 5) : propriétés fermées", () => {
  it("jamais le titre, la personne ni le lien ; seulement le canal et des choix", () => {
    expect(sanitizeProps("wish_shared_external", { method: "native", affiliate: true, title: "Sac Kelly", url: "https://shop.test" })).toEqual({
      method: "native",
      affiliate: true,
    });
    expect(sanitizeProps("piece_sent", { recipientId: "u-2", title: "Sac" })).toEqual({});
    expect(sanitizeProps("wish_republished", { visibility: "followers", wishId: "w-1" })).toEqual({ visibility: "followers" });
    expect(sanitizeProps("piece_sends_setting_changed", { value: "everyone" })).toEqual({ value: "everyone" });
    expect(sanitizeProps("piece_sends_setting_changed", { value: "amis" })).toEqual({});
    expect(Object.keys(ANALYTICS_EVENTS)).toEqual(expect.arrayContaining(["wish_republished", "piece_sent", "wish_shared_external", "received_piece_removed"]));
  });
});


describe("voie C (lot c) : complément et recherche par les mots, propriétés fermées", () => {
  it("spot_completed : l'issue du complément et son nombre, jamais la requête", () => {
    expect(
      sanitizeProps("spot_completed", { outcome: "results", results_count: 12, complement: "shown", complement_count: 8, query: "veste daim marron" })
    ).toEqual({ outcome: "results", results_count: 12, complement: "shown", complement_count: 8 });
    // Complément qui n'a pas tourné : « none ».
    expect(sanitizeProps("spot_completed", { outcome: "results", results_count: 3, complement: "none", complement_count: 0 })).toEqual({
      outcome: "results",
      results_count: 3,
      complement: "none",
      complement_count: 0,
    });
    // Une valeur hors liste est retirée : jamais un texte à la place de l'issue.
    expect(sanitizeProps("spot_completed", { outcome: "results", results_count: 3, complement: "veste daim marron" })).toEqual({ outcome: "results", results_count: 3 });
  });

  it("recherche par les mots : le lancement sans rien, puis l'issue et un nombre — jamais les mots", () => {
    expect(sanitizeProps("text_search_launched", { words: "veste daim marron", searchId: "s-1" })).toEqual({});
    expect(sanitizeProps("text_search_completed", { outcome: "shown", results_count: 4.2, words: "veste daim marron", query: "veste daim" })).toEqual({
      outcome: "shown",
      results_count: 4,
    });
    expect(sanitizeProps("text_search_completed", { outcome: "failed", results_count: 0 })).toEqual({ outcome: "failed", results_count: 0 });
    expect(sanitizeProps("text_search_completed", { outcome: "veste daim marron" })).toEqual({});
  });

  it("les nouvelles propriétés sont des listes de valeurs ou des nombres", () => {
    expect(ANALYTICS_EVENTS.spot_completed.complement.kind).toBe("enum");
    expect(ANALYTICS_EVENTS.spot_completed.complement_count.kind).toBe("count");
    expect(ANALYTICS_EVENTS.text_search_completed.outcome.kind).toBe("enum");
    expect(ANALYTICS_EVENTS.text_search_completed.results_count.kind).toBe("count");
    expect(Object.keys(ANALYTICS_EVENTS.text_search_launched)).toEqual([]);
  });
});

describe("prix d'abord (2026-11-03) : place de la proposition cliquée, propriétés fermées", () => {
  it("merchant_link_opened : rang d'origine, place affichée et section « Sans prix », jamais la pièce ni le lien", () => {
    expect(
      sanitizeProps("merchant_link_opened", {
        context: "result",
        rank: 7,
        displayed_position: 2,
        in_no_price_section: false,
        url: "https://boutique.test/veste",
        name: "Veste en daim",
        matchId: "m-1",
      })
    ).toEqual({ context: "result", rank: 7, displayed_position: 2, in_no_price_section: false });
    expect(sanitizeProps("merchant_link_opened", { context: "result", rank: 31, displayed_position: 40, in_no_price_section: true })).toEqual({
      context: "result",
      rank: 31,
      displayed_position: 40,
      in_no_price_section: true,
    });
    // Un oui/non écrit en texte, ou une place en texte, est retiré.
    expect(sanitizeProps("merchant_link_opened", { context: "result", rank: "7", in_no_price_section: "oui" })).toEqual({ context: "result" });
  });

  it("ailleurs (Envies, Vault, publication…) : l'événement reste le même, le contexte seul", () => {
    expect(sanitizeProps("merchant_link_opened", { context: "wishlist" })).toEqual({ context: "wishlist" });
    expect(sanitizeProps("merchant_link_opened", { context: "post" })).toEqual({ context: "post" });
  });

  it("section « Sans prix » ouverte : son nombre de propositions seulement", () => {
    expect(sanitizeProps("no_price_results_opened", { results_count: 24, names: "Veste, Sac" })).toEqual({ results_count: 24 });
    expect(ANALYTICS_EVENTS.no_price_results_opened.results_count.kind).toBe("count");
    expect(ANALYTICS_EVENTS.merchant_link_opened.rank.kind).toBe("count");
    expect(ANALYTICS_EVENTS.merchant_link_opened.displayed_position.kind).toBe("count");
    expect(ANALYTICS_EVENTS.merchant_link_opened.in_no_price_section.kind).toBe("bool");
    // Les événements d'avant restent dans le catalogue.
    expect(Object.keys(ANALYTICS_EVENTS)).toEqual(expect.arrayContaining(["similar_results_opened", "merchant_link_opened", "spot_completed"]));
  });
});
