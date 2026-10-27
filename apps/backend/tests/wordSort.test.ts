import { describe, expect, it } from "vitest";
import { nameMatches, significantWords, sortByWords } from "../src/lib/wordSort.js";

// Petit lot 2 (décision du fondateur du 2026-10-27) : les mots tapés sous la
// photo remontent en tête les propositions dont le nom les contient. Rien
// n'est retiré, caché ni marqué ; l'ordre ne change pas si rien ne correspond.

const piece = (productName: string) => ({ productName });
const noms = (liste: { productName: string }[]) => liste.map((p) => p.productName);

describe("tri par les mots", () => {
  it("mots qui comptent : accents et majuscules ignorés, petits mots courants écartés", () => {
    expect(significantWords("La VESTE en cuir Noire")).toEqual(["veste", "cuir", "noire"]);
    expect(significantWords("the black leather jacket")).toEqual(["black", "leather", "jacket"]);
    expect(significantWords("  ")).toEqual([]);
    expect(significantWords("à")).toEqual([]);
  });

  it("un mot compte aussi au début d'un mot plus long, jamais au milieu", () => {
    expect(nameMatches("Veste noire en cuir", ["noir"])).toBe(true);
    expect(nameMatches("Vestes d'hiver", ["veste"])).toBe(true);
    expect(nameMatches("Pull à col roulé", ["roule"])).toBe(true);
    expect(nameMatches("Manteau", ["teau"])).toBe(false);
  });

  it("celles qui correspondent remontent en tête, dans leur ordre ; les autres suivent, dans le leur ; rien n'est retiré", () => {
    const propositions = [piece("Chelsea boots"), piece("Sac en cuir noir"), piece("Bottes"), piece("Veste en cuir noire"), piece("Ceinture")];
    const { matches, sorted } = sortByWords(propositions, "la veste en cuir noir");
    expect(sorted).toBe(true);
    expect(noms(matches)).toEqual(["Sac en cuir noir", "Veste en cuir noire", "Chelsea boots", "Bottes", "Ceinture"]);
    expect(matches).toHaveLength(propositions.length);
  });

  it("aucune ne correspond, ni par les mots ni par leurs traductions, pas de mots, ou seulement des petits mots : l'ordre ne change pas", () => {
    const propositions = [piece("Chelsea boots"), piece("Silk scarf")];
    for (const mots of ["veste en cuir noir", "", null, undefined, "la et en"]) {
      const { matches, sorted } = sortByWords(propositions, mots);
      expect(sorted).toBe(false);
      expect(noms(matches)).toEqual(["Chelsea boots", "Silk scarf"]);
    }
  });
});

// Petit dictionnaire de la mode (décision du fondateur du 2026-10-27) : il remonte seulement.
describe("tri par les mots, avec leurs traductions", () => {
  it("des mots en français remontent des noms en anglais, et l'inverse ; l'ordre entre elles est gardé", () => {
    const anglais = [piece("Chelsea boots"), piece("Black leather jacket"), piece("Leather bag"), piece("Silk scarf")];
    expect(noms(sortByWords(anglais, "veste en cuir noir").matches)).toEqual(["Black leather jacket", "Leather bag", "Chelsea boots", "Silk scarf"]);
    const francais = [piece("Bottes"), piece("Veste en cuir noire")];
    expect(noms(sortByWords(francais, "black leather jacket").matches)).toEqual(["Veste en cuir noire", "Bottes"]);
  });

  it("singuliers et pluriels comptent des deux côtés", () => {
    expect(nameMatches("Leather boots", ["bottes"])).toBe(true);
    expect(nameMatches("Running shoes", ["chaussures"])).toBe(true);
    expect(nameMatches("Manteaux en laine", ["coat"])).toBe(true);
    expect(nameMatches("Robe longue", ["dresses"])).toBe(true);
  });

  it("une traduction compte en entier, jamais au début d'un mot plus long", () => {
    expect(nameMatches("Baggy jeans", ["sac"])).toBe(false);
    expect(noms(sortByWords([piece("Baggy jeans"), piece("Leather bag")], "sac").matches)).toEqual(["Leather bag", "Baggy jeans"]);
    expect(sortByWords([piece("Baggy jeans")], "sac").sorted).toBe(false);
  });

  it("les marques passent telles quelles (accents ignorés), sans traduction", () => {
    const { matches, sorted } = sortByWords([piece("Wool coat"), piece("Cardigan Sezane")], "Sézane");
    expect(sorted).toBe(true);
    expect(noms(matches)).toEqual(["Cardigan Sezane", "Wool coat"]);
  });
});
