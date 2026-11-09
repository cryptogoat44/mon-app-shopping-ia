import { afterEach, describe, expect, it } from "vitest";
import { BIO_MAX_LENGTH, BIO_MAX_LINES, bioLineCount, bioProblem, limitBioInput, normalizeBio } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { bioCounter, bioError, nextBioInput } from "../src/lib/bio-input";

// Lot « profil et icône des réglages » : bio de 160 caractères et 3 lignes
// au plus, mêmes règles que le serveur ; compteur en direct.

afterEach(() => setActiveLocale("fr"));

describe("règles partagées avec le serveur", () => {
  it("160 caractères et 3 lignes", () => {
    expect([BIO_MAX_LENGTH, BIO_MAX_LINES]).toEqual([160, 3]);
    expect(bioProblem("a".repeat(160))).toBeNull();
    expect(bioProblem("a".repeat(161))).toBe("too_long");
    expect(bioProblem("1\n2\n3")).toBeNull();
    expect(bioProblem("1\n2\n3\n4")).toBe("too_many_lines");
    expect(bioLineCount("")).toBe(0);
  });

  it("enregistrée sans espaces autour ni en fin de ligne, une seule ligne vide de suite", () => {
    expect(normalizeBio("  Mode lente  \r\n\r\n\r\n\r\nParis\t \n\n ")).toBe("Mode lente\n\nParis");
    expect(normalizeBio("\n\n\n")).toBe("");
    expect(normalizeBio("Une\n\nDeux")).toBe("Une\n\nDeux");
  });
});

describe("pendant la saisie", () => {
  it("au plus 3 lignes : un 4ᵉ retour à la ligne est ignoré, un texte collé rejoint la 3ᵉ ligne", () => {
    expect(limitBioInput("Une\nDeux\nTrois\n")).toBe("Une\nDeux\nTrois");
    expect(limitBioInput("Une\nDeux\nTrois\nQuatre\nCinq")).toBe("Une\nDeux\nTrois Quatre Cinq");
    expect(bioLineCount(limitBioInput("a\nb\nc\nd\ne\nf"))).toBe(3);
    // Collé avec des lignes vides : jamais d'espace en tête de la 3ᵉ ligne.
    expect(limitBioInput("Mode lente\nParis · Lyon\n\n\n\nEt plus encore")).toBe("Mode lente\nParis · Lyon\nEt plus encore");
    expect(limitBioInput("Une\nDeux\n\nTrois")).toBe("Une\nDeux\nTrois");
  });

  it("une seule ligne vide de suite ; 160 caractères au plus ; jamais un émoji coupé en deux", () => {
    expect(limitBioInput("Une\n\n\n\nDeux")).toBe("Une\n\nDeux");
    expect(limitBioInput("x".repeat(400))).toHaveLength(160);
    const cut = limitBioInput(`${"x".repeat(159)}😀`);
    expect(cut).toBe("x".repeat(159));
    expect(limitBioInput(`${"x".repeat(158)}😀`)).toBe(`${"x".repeat(158)}😀`);
  });

  it("les espaces tapés restent jusqu'à l'enregistrement", () => {
    expect(limitBioInput("Bonjour ")).toBe("Bonjour ");
  });

  it("une bio trop longue d'avant (280 caractères permis) se raccourcit librement, sans être coupée d'un coup", () => {
    const old = "a".repeat(250);
    expect(nextBioInput(old, old.slice(0, 249))).toBe(old.slice(0, 249));
    expect(nextBioInput(old, `${old}b`)).toHaveLength(160);
    expect(nextBioInput("Bonjour", "Bonjour !")).toBe("Bonjour !");
  });
});

describe("compteur et message", () => {
  it("compteur « 42/160 », signalé quand il est dépassé, lu en entier par VoiceOver", () => {
    expect(bioCounter("a".repeat(42))).toEqual({ text: "42/160", over: false, label: "42 caractères sur 160" });
    expect(bioCounter("a".repeat(170)).over).toBe(true);
    setActiveLocale("en");
    expect(bioCounter("abc").label).toBe("3 of 160 characters");
  });

  it("message clair tant que la bio ne peut pas être enregistrée (en français et en anglais)", () => {
    expect(bioError("Une bio courte")).toBeNull();
    expect(bioError(`  ${"a".repeat(160)}  `)).toBeNull();
    expect(bioError("a".repeat(161))).toBe("Votre bio dépasse 160 caractères : raccourcissez-la pour enregistrer.");
    expect(bioError("1\n2\n3\n4")).toBe("Votre bio dépasse 3 lignes : raccourcissez-la pour enregistrer.");
    setActiveLocale("en");
    expect(bioError("a".repeat(161))).toBe("Your bio is longer than 160 characters: shorten it to save.");
  });
});
