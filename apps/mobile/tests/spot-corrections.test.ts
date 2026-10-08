import { describe, expect, it } from "vitest";
import { failureCorrections, successCorrections, type CorrectionContext } from "../src/lib/spot-corrections";

// Lot 4 ter : les corrections ne s'affichent plus d'emblée. Avec des
// résultats : un seul lien discret, « Ce n'est pas la bonne pièce ? ». Sans
// résultat : deux actions au plus, la plus utile d'abord ; « Réessayer sans le
// texte » en plus si des mots avaient été tapés (décision du fondateur, 2026-10-08).
const video: CorrectionContext = { hasDraft: true, hasVideo: true, remainingMoments: 2, fromLink: false, hadQuery: false };
const videoLastMoment: CorrectionContext = { ...video, remainingMoments: 0 };
const photo: CorrectionContext = { hasDraft: true, hasVideo: false, remainingMoments: 0, fromLink: false, hadQuery: false };
const reopened: CorrectionContext = { hasDraft: false, hasVideo: false, remainingMoments: 0, fromLink: false, hadQuery: false };
const oldLink: CorrectionContext = { ...reopened, fromLink: true };

describe("sous des résultats : recadrer, autres moments, choisir l'image soi-même", () => {
  it("vidéo : les trois corrections, dans cet ordre", () => {
    expect(successCorrections(video)).toEqual(["reframe", "try_another", "choose_myself"]);
    expect(successCorrections(videoLastMoment)).toEqual(["reframe", "choose_myself"]);
  });

  it("photo : recadrer seulement", () => {
    expect(successCorrections(photo)).toEqual(["reframe"]);
  });

  it("résultat rouvert (rien en mémoire) : aucun lien, rien n'est promis", () => {
    expect(successCorrections(reopened)).toEqual([]);
  });

  it("ancienne recherche par lien : ajouter la vidéo (la couverture n'est plus analysée)", () => {
    expect(successCorrections(oldLink)).toEqual(["add_video"]);
  });
});

describe("sans résultat : deux actions au plus, la plus utile d'abord", () => {
  it("panne : réessayer d'abord, puis le choix manuel (vidéo) ou le recadrage (photo)", () => {
    expect(failureCorrections("technical", video)).toEqual(["retry", "choose_myself"]);
    expect(failureCorrections("technical", photo)).toEqual(["retry", "reframe"]);
  });

  it("aucune pièce trouvée : une autre image plutôt qu'un nouvel essai à l'identique", () => {
    expect(failureCorrections("no_match", video)).toEqual(["try_another", "choose_myself"]);
    expect(failureCorrections("no_match", videoLastMoment)).toEqual(["reframe", "choose_myself"]);
    expect(failureCorrections("no_match", photo)).toEqual(["reframe"]);
  });

  it("rien trouvé alors que des mots avaient été tapés : « Réessayer sans le texte » en plus, jamais seul ni pour une panne", () => {
    expect(failureCorrections("no_match", { ...photo, hadQuery: true })).toEqual(["reframe", "retry_without_text"]);
    expect(failureCorrections("no_match", { ...video, hadQuery: true })).toEqual(["try_another", "retry_without_text", "choose_myself"]);
    expect(failureCorrections("technical", { ...photo, hadQuery: true })).toEqual(["retry", "reframe"]);
    expect(failureCorrections("no_match", { ...reopened, hadQuery: true })).toEqual([]);
  });

  it("limite d'identifications atteinte : rien à tenter tout de suite", () => {
    expect(failureCorrections("rate_limited", video)).toEqual([]);
  });

  it("plafond des recherches atteint (lot 4 quater : jour, 31 jours, part de la personne) : rien à tenter, un nouvel essai serait refusé", () => {
    for (const reason of ["capacity_day", "capacity_month", "capacity_user"] as const) {
      expect(failureCorrections(reason, video)).toEqual([]);
      expect(failureCorrections(reason, { ...photo, hadQuery: true })).toEqual([]);
    }
  });

  it("image d'un lien indisponible, ou rien en mémoire", () => {
    expect(failureCorrections("needs_photo", oldLink)).toEqual(["add_video"]);
    expect(failureCorrections("technical", reopened)).toEqual([]);
  });

  it("jamais plus de deux actions, plus « Réessayer sans le texte » quand des mots avaient été tapés", () => {
    for (const reason of ["no_match", "technical", "rate_limited", "needs_photo"] as const)
      for (const context of [video, videoLastMoment, photo, reopened, oldLink]) {
        expect(failureCorrections(reason, context).length).toBeLessThanOrEqual(2);
        expect(failureCorrections(reason, { ...context, hadQuery: true }).filter((c) => c !== "retry_without_text").length).toBeLessThanOrEqual(2);
      }
  });
});
