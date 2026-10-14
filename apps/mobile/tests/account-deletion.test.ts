// Suppression de son compte (lot 5) : le mot à taper dépend de la langue de
// l'app ; le bouton ne s'active qu'avec ce mot. Le serveur, lui, accepte le
// mot de l'une ou l'autre langue (il vérifie l'intention).
import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETION_WORDS, isAccountDeletionWord } from "@monapp/shared-types";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";

describe("mot de confirmation de la suppression du compte", () => {
  it("un mot par langue, en majuscules", () => {
    expect(ACCOUNT_DELETION_WORDS).toEqual({ fr: "SUPPRIMER", en: "DELETE" });
  });

  it("l'écran français n'accepte que SUPPRIMER, sans tenir compte de la casse ni des espaces autour", () => {
    expect(isAccountDeletionWord("SUPPRIMER", "fr")).toBe(true);
    expect(isAccountDeletionWord("  supprimer ", "fr")).toBe(true);
    expect(isAccountDeletionWord("DELETE", "fr")).toBe(false);
    expect(isAccountDeletionWord("SUPPRIME", "fr")).toBe(false);
    expect(isAccountDeletionWord("SUP PRIMER", "fr")).toBe(false);
    expect(isAccountDeletionWord("", "fr")).toBe(false);
  });

  it("l'écran anglais n'accepte que DELETE", () => {
    expect(isAccountDeletionWord("delete", "en")).toBe(true);
    expect(isAccountDeletionWord("SUPPRIMER", "en")).toBe(false);
  });

  it("sans langue (le serveur), le mot de chaque langue est accepté", () => {
    expect(isAccountDeletionWord("Supprimer")).toBe(true);
    expect(isAccountDeletionWord("Delete")).toBe(true);
    expect(isAccountDeletionWord("oui")).toBe(false);
  });

  it("la consigne cite le mot de la langue de l'écran", () => {
    expect(fr.settings.deleteTypeWord(ACCOUNT_DELETION_WORDS.fr)).toBe("Pour confirmer, tapez SUPPRIMER ci-dessous.");
    expect(en.settings.deleteTypeWord(ACCOUNT_DELETION_WORDS.en)).toBe("To confirm, type DELETE below.");
    expect(fr.settings.deleteWordLabel(ACCOUNT_DELETION_WORDS.fr)).toBe("Mot de confirmation : SUPPRIMER");
    expect(en.settings.deleteWordLabel(ACCOUNT_DELETION_WORDS.en)).toBe("Confirmation word: DELETE");
  });
});
