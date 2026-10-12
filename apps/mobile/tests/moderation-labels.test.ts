import { afterEach, describe, expect, it } from "vitest";
import type { AppNotification } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { ApiError } from "../src/lib/api-error";
import { loadErrorMessage } from "../src/lib/load-error";
import {
  moderationActionLabel,
  moderationNoticeLines,
  mostReportedReason,
  reasonsSummary,
  reportReasonLabel,
  systemNotificationLines,
} from "../src/lib/moderation-labels";

// Lot 5 : ce que lisent la personne concernée (décision, motif, précision —
// jamais qui l'a prise), l'auteur d'un signalement (« traité ») et
// l'administrateur ; dans la langue active.

afterEach(() => setActiveLocale("fr"));

const notification = (overrides: Partial<AppNotification>): AppNotification => ({
  id: "n1",
  type: "moderation",
  actor: null,
  createdAt: "2026-10-11T10:00:00.000Z",
  read: false,
  postId: null,
  moderation: null,
  reportedType: null,
  ...overrides,
});

describe("messages de la modération", () => {
  it("publication masquée : la décision, le motif et la précision entre guillemets", () => {
    expect(moderationNoticeLines({ action: "hide", targetType: "post", reason: "harassment", note: "Propos insultants." })).toEqual([
      "Votre publication a été masquée par la modération.",
      "Motif : Harcèlement",
      "Précision : « Propos insultants. »",
    ]);
  });

  it("commentaire, suspension, rétablissement, levée ; décision illisible", () => {
    expect(moderationNoticeLines({ action: "hide", targetType: "comment", reason: "spam", note: null })[0]).toBe("Votre commentaire a été masqué par la modération.");
    expect(moderationNoticeLines({ action: "suspend", targetType: "post", reason: "spam", note: null })[0]).toMatch(/^Votre compte a été suspendu/);
    expect(moderationNoticeLines({ action: "restore", targetType: "comment", reason: null, note: null })).toEqual(["Votre commentaire a été rétabli."]);
    expect(moderationNoticeLines({ action: "unsuspend", targetType: "user", reason: null, note: null })).toEqual(["La suspension de votre compte a été levée."]);
    expect(moderationNoticeLines(null)).toEqual(["Une décision de la modération vous concerne."]);
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(moderationNoticeLines({ action: "hide", targetType: "post", reason: "inappropriate", note: "Nudity." })).toEqual([
      "Your post was hidden by moderation.",
      "Reason: Inappropriate content",
      "Details: “Nudity.”",
    ]);
  });

  it("notifications sans auteur : modération et signalement traité ; les autres n'en sont pas", () => {
    expect(systemNotificationLines(notification({ type: "report_handled", reportedType: "user" }))).toEqual(["Votre signalement d'un profil a été traité. Merci."]);
    expect(systemNotificationLines(notification({ type: "report_handled" }))).toEqual(["Votre signalement a été traité. Merci."]);
    expect(systemNotificationLines(notification({ moderation: { action: "restore", targetType: "post", reason: null, note: null } }))).toEqual([
      "Votre publication a été rétablie.",
    ]);
    const actor = { id: "u2", username: "camille", displayName: "Camille", avatarUrl: null };
    expect(systemNotificationLines(notification({ type: "like", actor, postId: "p1" }))).toBeNull();
  });
});

describe("pièces envoyées (lot 5, 5.C)", () => {
  it("l'expéditeur apprend le masquage et le rétablissement de SA pièce, avec le motif", () => {
    expect(moderationNoticeLines({ action: "hide", targetType: "piece", reason: "inappropriate", note: null })).toEqual([
      "Une pièce que vous avez envoyée a été masquée par la modération.",
      "Motif : Contenu inapproprié",
    ]);
    expect(moderationNoticeLines({ action: "restore", targetType: "piece", reason: null, note: null })).toEqual([
      "Une pièce que vous avez envoyée a été rétablie.",
    ]);
    setActiveLocale("en");
    expect(moderationNoticeLines({ action: "hide", targetType: "piece", reason: null, note: null })[0]).toBe("A piece you sent was hidden by moderation.");
  });

  it("la personne qui a signalé une pièce apprend seulement qu'elle est traitée", () => {
    expect(systemNotificationLines(notification({ type: "report_handled", reportedType: "piece" }))).toEqual([
      "Votre signalement d'une pièce reçue a été traité. Merci.",
    ]);
  });

  it("« vous a envoyé une pièce » a un auteur : ce n'est pas une notification système", () => {
    const actor = { id: "u2", username: "louise", displayName: "Louise", avatarUrl: null };
    expect(systemNotificationLines(notification({ type: "piece_received", actor }))).toBeNull();
  });
});

describe("libellés de l'administrateur", () => {
  it("les motifs suivent la langue active (défaut du menu de signalement, resté en français)", () => {
    expect(reportReasonLabel("harassment")).toBe("Harcèlement");
    setActiveLocale("en");
    expect(reportReasonLabel("harassment")).toBe("Harassment");
    expect(moderationActionLabel("unsuspend")).toBe("Suspension lifted");
  });

  it("résumé des motifs dans l'ordre de la liste, motif proposé par défaut : le plus signalé", () => {
    expect(reasonsSummary({ harassment: 1, spam: 2 })).toBe("Spam × 2 · Harcèlement × 1");
    expect(mostReportedReason({ harassment: 3, spam: 2 })).toBe("harassment");
    expect(mostReportedReason({ other: 1, inappropriate: 1 })).toBe("inappropriate");
    expect(mostReportedReason({})).toBe("spam");
  });
});

describe("chargement en échec (charte, règle 1)", () => {
  it("hors ligne, message du serveur, ou texte de repli", () => {
    expect(loadErrorMessage(new TypeError("Network request failed"), "Repli")).toBe(
      "Vous semblez hors ligne. Vérifiez votre connexion internet, puis réessayez."
    );
    expect(loadErrorMessage(new ApiError(404, { error: "not_found", message: "Page introuvable." }), "Repli")).toBe("Page introuvable.");
    expect(loadErrorMessage(new Error("autre"), "Repli")).toBe("Repli");
    setActiveLocale("en");
    expect(loadErrorMessage(new TypeError("Failed to fetch"), "Fallback")).toBe("You seem to be offline. Check your internet connection, then try again.");
  });
});
