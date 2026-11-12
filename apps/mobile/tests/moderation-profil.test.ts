import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModerationPreview } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { sanitizeProps } from "../src/lib/analytics-events";
import { moderationActionLabel, moderationNoticeLines, profileRemovalActions } from "../src/lib/moderation-labels";

// Lot « conformité Apple » (migration 0037 ; règle 1.2 d'Apple) : un
// administrateur retire la bio ou la photo d'un profil signalé. Ce que lit
// la personne concernée, ce que voit l'administrateur (seulement si le
// serveur l'annonce), les textes FR / EN, et le branchement de l'écran. La
// logique sans rendu (comme tests/moderation-collections.test.ts).

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

afterEach(() => setActiveLocale("fr"));

const author = { id: "alice", username: "alice", displayName: "Alice", avatarUrl: "https://stockage/alice.jpg", suspended: false };
const userPreview: ModerationPreview = { kind: "user", author, bio: "Une bio" };
const commentPreview: ModerationPreview = { kind: "comment", author, body: "Un commentaire", postId: "p1", createdAt: "2026-11-10T10:00:00.000Z", hidden: false };

describe("ce que la personne concernée apprend", () => {
  it("bio retirée, photo retirée : la décision, le motif choisi et la précision, jamais qui l'a prise", () => {
    expect(moderationNoticeLines({ action: "remove_bio", targetType: "user", reason: "harassment", note: "Propos visant une personne." })).toEqual([
      "Votre bio a été retirée par la modération.",
      "Motif : Harcèlement",
      "Précision : « Propos visant une personne. »",
    ]);
    expect(moderationNoticeLines({ action: "remove_avatar", targetType: "user", reason: "inappropriate", note: null })).toEqual([
      "Votre photo de profil a été retirée par la modération : son fichier est effacé.",
      "Motif : Contenu inapproprié",
    ]);
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(moderationNoticeLines({ action: "remove_bio", targetType: "user", reason: "spam", note: null })[0]).toBe("Your bio was removed by moderation.");
    expect(moderationNoticeLines({ action: "remove_avatar", targetType: "user", reason: "spam", note: null })[0]).toBe(
      "Your profile photo was removed by moderation: its file has been deleted."
    );
  });

  it("compte suspendu : la personne apprend aussi que sa bio et sa photo ne sont plus montrées aux autres", () => {
    expect(moderationNoticeLines({ action: "suspend", targetType: "user", reason: "spam", note: null })[0]).toBe(
      "Votre compte a été suspendu : vous ne pouvez plus publier, commenter, suivre, réagir ni modifier votre profil. Votre bio et votre photo de profil ne sont plus montrées aux autres membres."
    );
    setActiveLocale("en");
    expect(moderationNoticeLines({ action: "suspend", targetType: "user", reason: "spam", note: null })[0]).toContain("Your bio and profile photo are no longer shown to other members.");
  });
});

describe("ce que voit l'administrateur", () => {
  it("un profil signalé : « Retirer la bio » et « Retirer la photo de profil », chacun avec son avertissement (définitif) et son message de réussite", () => {
    const actions = profileRemovalActions({ preview: userPreview, canRemoveBio: true, canRemoveAvatar: true });
    expect(actions.map((action) => [action.part, action.label, action.saved])).toEqual([
      ["bio", "Retirer la bio", "Bio retirée."],
      ["avatar", "Retirer la photo de profil", "Photo de profil retirée : son fichier est effacé."],
    ]);
    for (const action of actions) {
      expect(action.warning).toContain("cette décision ne s'annule pas");
      expect(action.warning).toContain("La personne sera prévenue, avec le motif choisi.");
    }
    expect(profileRemovalActions({ preview: userPreview, canRemoveBio: false, canRemoveAvatar: true }).map((action) => action.part)).toEqual(["avatar"]);
    expect(profileRemovalActions({ preview: userPreview, canRemoveBio: true, canRemoveAvatar: false }).map((action) => action.part)).toEqual(["bio"]);
  });

  it("rien sans la migration 0037, avec un ancien serveur (champs absents), ou pour un autre contenu", () => {
    expect(profileRemovalActions({ preview: userPreview, canRemoveBio: false, canRemoveAvatar: false })).toEqual([]);
    expect(profileRemovalActions({ preview: userPreview })).toEqual([]);
    expect(profileRemovalActions({ preview: commentPreview, canRemoveBio: true, canRemoveAvatar: true })).toEqual([]);
    expect(profileRemovalActions({ preview: { kind: "missing" }, canRemoveBio: true, canRemoveAvatar: true })).toEqual([]);
  });

  it("l'historique nomme les deux décisions, en français et en anglais ; l'avertissement de suspension dit ce qui est caché", () => {
    expect(moderationActionLabel("remove_bio")).toBe("Bio retirée");
    expect(moderationActionLabel("remove_avatar")).toBe("Photo de profil retirée");
    expect(source("i18n/fr.ts")).toContain("Sa bio et sa photo de profil ne seront plus montrées aux autres membres.");
    setActiveLocale("en");
    expect(moderationActionLabel("remove_bio")).toBe("Bio removed");
    expect(moderationActionLabel("remove_avatar")).toBe("Profile photo removed");
    expect(profileRemovalActions({ preview: userPreview, canRemoveBio: true, canRemoveAvatar: true }).map((action) => action.label)).toEqual([
      "Remove the bio",
      "Remove the profile photo",
    ]);
  });
});

describe("branchement de l'écran et de l'envoi au serveur", () => {
  it("la carte de la file passe par profileRemovalActions, demande un motif (même panneau que masquer et suspendre) et appelle la route de 0037", () => {
    const card = source("components/moderation-item.tsx");
    expect(card).toContain("const removals = profileRemovalActions(item);");
    expect(card).toContain("removal={{ warning: removal.warning }}");
    expect(card).toContain("removeProfilePart({ userId: item.targetId, part, reason");
    expect(card).toMatch(/removals\.map\(\(entry\) => \(\s*<ActionButton key=\{entry\.part\} label=\{entry\.label\}/);
    const api = source("lib/api.ts");
    expect(api).toContain('authorizedFetch("/api/admin/moderation/remove-profile-part", { method: "POST"');
    // Le panneau annonce le caractère définitif avant de confirmer, en rouge.
    const panel = source("components/moderation-decision.tsx");
    expect(panel).toContain("const danger = suspend || removal !== undefined;");
    expect(panel).toContain("const warning = removal?.warning ?? (suspend ? t.moderationQueue.suspendWarning : null);");
  });

  it("statistiques d'usage : la décision et le type, jamais le profil ni le motif", () => {
    expect(sanitizeProps("moderation_decision", { decision: "remove_bio", target_type: "user" })).toEqual({ decision: "remove_bio", target_type: "user" });
    expect(sanitizeProps("moderation_decision", { decision: "remove_avatar", target_type: "user" })).toEqual({ decision: "remove_avatar", target_type: "user" });
  });
});
