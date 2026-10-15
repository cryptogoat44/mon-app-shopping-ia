// Bouton « Résultat incohérent » (fiabilité des résultats, 2026-10-15) : les
// cinq motifs validés par le fondateur, dans la langue active au moment de
// l'affichage ; l'erreur montrée selon la réponse du serveur.
import { afterEach, describe, expect, it } from "vitest";
import { MATCH_FEEDBACK_REASONS, type ProductMatch } from "@monapp/shared-types";
import { setActiveLocale, t } from "../src/i18n";
import { ApiError } from "../src/lib/api-error";
import { feedbackErrorMessage, feedbackReasonChoices, feedbackReasonLabel } from "../src/lib/result-feedback";
import { matchToPiece } from "../src/lib/spot-result";

afterEach(() => setActiveLocale("fr"));

describe("motifs du bouton « Résultat incohérent »", () => {
  it("les cinq motifs validés, dans l'ordre, en français", () => {
    expect(feedbackReasonChoices().map((choice) => choice.label)).toEqual([
      "L'image et le titre ne correspondent pas",
      "Ce n'est pas la pièce cherchée (autre type, autre couleur, autre modèle)",
      "Impossible à acheter (la page ne vend rien)",
      "Prix faux ou absent",
      "Doublon d'une autre proposition",
    ]);
  });

  it("en anglais quand l'app passe en anglais, sans relancer l'écran", () => {
    setActiveLocale("en");
    expect(feedbackReasonChoices().map((choice) => choice.label)).toEqual([
      "The image and the title don't match",
      "Not the item I was looking for (different type, color or model)",
      "Can't be bought (the page doesn't sell anything)",
      "Wrong or missing price",
      "Duplicate of another result",
    ]);
    expect(t.result.reportedLine(feedbackReasonLabel("wrong_price"))).toBe("Reported: Wrong or missing price");
  });

  it("chaque motif a un libellé dans chaque langue", () => {
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      for (const reason of MATCH_FEEDBACK_REASONS) expect(feedbackReasonLabel(reason).trim()).not.toBe("");
    }
  });

  it("erreur : le message du serveur pour un refus (limite du jour), le texte de repli pour une panne ou sans connexion", () => {
    const limit = new ApiError(429, { error: "feedback_limit", message: "Vous avez atteint la limite de signalements pour aujourd'hui." });
    expect(feedbackErrorMessage(limit, t.result.reportError)).toBe(limit.message);
    expect(feedbackErrorMessage(new ApiError(500, { error: "internal_error", message: "Erreur." }), t.result.reportError)).toBe(t.result.reportError);
    expect(feedbackErrorMessage(new TypeError("Network request failed"), t.result.reportError)).toBe(
      "Le signalement n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez."
    );
  });

  it("le motif déjà choisi arrive avec la proposition", () => {
    const match: ProductMatch = {
      id: "m1",
      rank: 1,
      productName: "Veste",
      brand: null,
      imageUrl: "https://example.com/v.jpg",
      priceMin: null,
      priceMax: null,
      currency: null,
      merchantName: null,
      merchantUrl: "https://example.com/v",
      imageHdUrl: null,
      affiliateUrl: "https://example.com/v",
      feedbackReason: "duplicate",
    };
    expect(matchToPiece(match).feedbackReason).toBe("duplicate");
    expect(matchToPiece({ ...match, feedbackReason: null }).feedbackReason).toBeNull();
  });
});
