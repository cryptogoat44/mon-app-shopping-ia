import { describe, expect, it } from "vitest";
import { failureCorrections, successCorrections, type CorrectionContext } from "../src/lib/spot-corrections";

// Lot 4 ter : les corrections ne s'affichent plus d'emblée. Avec des
// résultats : un seul lien discret, « Ce n'est pas la bonne pièce ? ». Sans
// résultat : deux actions au plus, la plus utile d'abord. « Réessayer sans le
// texte » est retiré (petit lot, décision du fondateur du 2026-10-25).
const video: CorrectionContext = { hasDraft: true, hasVideo: true, remainingMoments: 2, fromLink: false };
const videoLastMoment: CorrectionContext = { ...video, remainingMoments: 0 };
const photo: CorrectionContext = { hasDraft: true, hasVideo: false, remainingMoments: 0, fromLink: false };
const reopened: CorrectionContext = { hasDraft: false, hasVideo: false, remainingMoments: 0, fromLink: false };
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

  it("« Réessayer sans le texte » n'existe plus : les mots ne partent plus avec l'image, il relancerait la même recherche", () => {
    for (const reason of ["no_match", "technical", "rate_limited", "needs_photo"] as const)
      for (const context of [video, videoLastMoment, photo, reopened, oldLink]) {
        expect(JSON.stringify([...failureCorrections(reason, context), ...successCorrections(context)])).not.toContain("without_text");
      }
  });

  it("limite d'identifications atteinte : rien à tenter tout de suite", () => {
    expect(failureCorrections("rate_limited", video)).toEqual([]);
  });

  it("plafond des recherches atteint (lot 4 quater : jour, mois, part de la personne) : rien à tenter, un nouvel essai serait refusé", () => {
    for (const reason of ["capacity_day", "capacity_month", "capacity_user"] as const) {
      expect(failureCorrections(reason, video)).toEqual([]);
      expect(failureCorrections(reason, photo)).toEqual([]);
    }
  });

  it("image d'un lien indisponible, ou rien en mémoire", () => {
    expect(failureCorrections("needs_photo", oldLink)).toEqual(["add_video"]);
    expect(failureCorrections("technical", reopened)).toEqual([]);
  });

  it("jamais plus de deux actions", () => {
    for (const reason of ["no_match", "technical", "rate_limited", "needs_photo"] as const)
      for (const context of [video, videoLastMoment, photo, reopened, oldLink]) {
        expect(failureCorrections(reason, context).length).toBeLessThanOrEqual(2);
      }
  });
});
