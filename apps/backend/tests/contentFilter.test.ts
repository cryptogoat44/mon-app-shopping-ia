import { describe, expect, it } from "vitest";
import { CONTENT_NOT_ALLOWED, containsBannedWords, firstBannedText } from "../src/lib/contentFilter.js";
import { EN_MESSAGES } from "../src/lib/messages.js";

// Filtre des mots interdits (chantier 3, règle 1.2 d'Apple). Hors base.

describe("filtre des mots interdits", () => {
  it("refuse les insultes et injures, en français et en anglais", () => {
    for (const text of [
      "quelle pute",
      "Espèce de CONNARD",
      "t'es qu'un enfoiré",
      "l'enculé",
      "fils de pute",
      "nique ta mère",
      "sale juif",
      "what a bitch",
      "fuck this",
      "you motherfucker",
      "kill yourself",
      "go back n1gger",
    ]) {
      expect(containsBannedWords(text), text).toBe(true);
    }
  });

  it("voit à travers les déguisements simples", () => {
    for (const text of ["p.u.t.e", "s4l0pe", "f-u-c-k you", "fuuuuck", "connnnnard", "Fils-de-pute", "connard !", "PUTES", "salopes", "trou du c.u.l"]) {
      expect(containsBannedWords(text), text).toBe(true);
    }
  });

  it("vérifie aussi les noms d'utilisateur (lettres, chiffres, _)", () => {
    expect(containsBannedWords("fuck_off")).toBe(true);
    expect(containsBannedWords("le_connard_75")).toBe(true);
    expect(containsBannedWords("marie_dupont")).toBe(false);
  });

  it("laisse passer le vocabulaire courant de la mode et de la vie", () => {
    for (const text of [
      "Ma salopette préférée",
      "Habillée comme un fagot, j'adore",
      "Colis en retard, mais quelle veste !",
      "Un baiser de Paris",
      "Pussy bow blouse in silk",
      "Spic and span",
      "Robe à pois, taille 38",
      "Conseil : la doudoune longue",
      "Mon chat sur le canapé",
      "Sac Puteaux, cuir camel",
      "A bite of cake",
      "Constance et Cocoon",
      "Snickers aux pieds",
      "Shiitake et risotto",
      "Scunthorpe United scarf",
      "Bitte schön",
      "Trench Burberry 100% coton, 2024",
      "@marie superbe !",
      "",
    ]) {
      expect(containsBannedWords(text), text).toBe(false);
    }
    expect(containsBannedWords(null)).toBe(false);
    expect(containsBannedWords(undefined)).toBe(false);
  });

  it("désigne le premier texte refusé parmi plusieurs champs", () => {
    expect(firstBannedText("marie", "Marie D.", "J'aime le lin")).toBeNull();
    expect(firstBannedText("marie", "Marie la salope", null)).toBe("Marie la salope");
  });

  it("explique le refus en français, avec sa traduction anglaise", () => {
    expect(CONTENT_NOT_ALLOWED.error).toBe("content_not_allowed");
    expect(EN_MESSAGES[CONTENT_NOT_ALLOWED.message]).toMatch(/isn't allowed on Spotto/);
  });
});
