import { describe, expect, it } from "vitest";
import { lightSort, referenceTokens, sameToken, titleTier } from "../src/lib/lightSort.js";

// Voie C (lot c, 2026-11-02) : tri léger, sans IA, de la section « Cette
// pièce dans d'autres boutiques » par la marque et le modèle lus dans les
// titres Lens. Rien n'est retiré ; l'ordre de Google est gardé dans chaque
// palier. Marques fictives seulement.

const piece = (productName: string) => ({ productName });
const noms = (liste: { productName: string }[]) => liste.map((p) => p.productName);
const REF = { brand: "Marque Exemple", model: "X-200" };

describe("tri léger — paliers", () => {
  it("0 = marque et modèle complets ; 1 = un seul des deux ; 2 = aucun", () => {
    expect(titleTier("Baskets Marque Exemple X-200 cuir blanc", REF)).toBe(0);
    expect(titleTier("Baskets Marque Exemple blanches", REF)).toBe(1);
    expect(titleTier("Baskets X-200 blanches", REF)).toBe(1);
    expect(titleTier("Sneakers blanches femme", REF)).toBe(2);
    // Marque incomplète (un seul de ses mots) : pas complète.
    expect(titleTier("Baskets Marque X-200", REF)).toBe(1);
  });

  it("accents et majuscules ignorés, des deux côtés", () => {
    const ref = { brand: "Éclat Brodé", model: "Été 3" };
    expect(titleTier("VESTE ECLAT BRODE ETE 3 bleue", ref)).toBe(0);
    expect(titleTier("veste éclat brodé été 3", ref)).toBe(0);
  });

  it("modèles en chiffres : « 1 », « 07 », « 501 » comptent, à l'identique", () => {
    expect(titleTier("Jean Atelier Fictif 501 brut", { brand: "Atelier Fictif", model: "501" })).toBe(0);
    expect(titleTier("Jean Atelier Fictif 5010 brut", { brand: "Atelier Fictif", model: "501" })).toBe(1);
    expect(titleTier("Montre Atelier Fictif série 07", { brand: "Atelier Fictif", model: "07" })).toBe(0);
    expect(titleTier("Montre Atelier Fictif série 7", { brand: "Atelier Fictif", model: "07" })).toBe(1);
    expect(titleTier("Sac Atelier Fictif 1 cuir", { brand: "Atelier Fictif", model: "1" })).toBe(0);
    expect(titleTier("Sac Atelier Fictif cuir", { brand: "Atelier Fictif", model: "1" })).toBe(1);
  });

  it("pluriel en s, x ou es toléré pour les mots en lettres de 4 lettres au moins, jamais en dessous ni pour un mélange lettres-chiffres", () => {
    expect(sameToken("basket", "baskets")).toBe(true);
    expect(sameToken("manteaux", "manteau")).toBe(true);
    expect(sameToken("robe", "robes")).toBe(true);
    expect(sameToken("sac", "sacs")).toBe(false);
    expect(sameToken("x200", "x200s")).toBe(false);
    expect(sameToken("robe", "robert")).toBe(false);
    expect(titleTier("Ateliers Fictifs veste", { brand: "Atelier Fictif", model: "" })).toBe(0);
  });

  it("marque en lettres seules (style A.P.C.) : chaque lettre est gardée et exigée", () => {
    const ref = { brand: "Q.R.T.", model: "" };
    expect(referenceTokens("Q.R.T.")).toEqual(["q", "r", "t"]);
    expect(titleTier("Veste Q.R.T. bleue marine", ref)).toBe(0);
    expect(titleTier("Veste Q R T bleue", ref)).toBe(0);
    expect(titleTier("Veste bleue marine", ref)).toBe(2);
    expect(titleTier("Veste Q.R. bleue", ref)).toBe(2);
  });

  it("marque ou modèle vide : jamais « présent par défaut »", () => {
    expect(titleTier("Baskets Marque Exemple", { brand: "Marque Exemple", model: "" })).toBe(0);
    expect(titleTier("Baskets blanches", { brand: "Marque Exemple", model: "" })).toBe(2);
    expect(titleTier("Baskets X-200", { brand: "", model: "X-200" })).toBe(0);
    expect(titleTier("Baskets blanches", { brand: "", model: "X-200" })).toBe(2);
    expect(titleTier("N'importe quel titre", { brand: "", model: "" })).toBe(2);
    // Fait seulement de signes ou de petits mots : ensemble vide, jamais présent.
    expect(titleTier("Baskets les plus belles", { brand: "Les", model: "" })).toBe(2);
    expect(titleTier("Baskets ... --", { brand: "...", model: "--" })).toBe(2);
  });

  it("les petits mots courants de la marque ne sont pas exigés", () => {
    expect(titleTier("Robe Ateliers Exemple longue", { brand: "Les Ateliers Exemple", model: "" })).toBe(0);
  });
});

describe("tri léger — ordre", () => {
  const propositions = [
    piece("Sneakers blanches femme"),
    piece("Baskets X-200 blanches"),
    piece("Marque Exemple X-200 basses"),
    piece("Chaussures Marque Exemple"),
    piece("Baskets Marque Exemple X-200 cuir"),
    piece("Tennis en toile"),
  ];

  it("palier 0, puis 1, puis 2 ; l'ordre de Google est gardé dans chaque palier ; nombres par palier", () => {
    const { items, tierCounts } = lightSort(propositions, REF);
    expect(noms(items)).toEqual([
      "Marque Exemple X-200 basses",
      "Baskets Marque Exemple X-200 cuir",
      "Baskets X-200 blanches",
      "Chaussures Marque Exemple",
      "Sneakers blanches femme",
      "Tennis en toile",
    ]);
    expect(tierCounts).toEqual([2, 2, 2]);
  });

  it("rien n'est retiré ni modifié : mêmes objets, même nombre", () => {
    const { items, tierCounts } = lightSort(propositions, REF);
    expect(items).toHaveLength(propositions.length);
    expect(new Set(items)).toEqual(new Set(propositions));
    expect(tierCounts.reduce((a, b) => a + b, 0)).toBe(propositions.length);
  });

  it("aucune référence utilisable : l'ordre ne change pas, tout au palier 2", () => {
    const { items, tierCounts } = lightSort(propositions, { brand: "", model: "" });
    expect(items).toEqual(propositions);
    expect(tierCounts).toEqual([0, 0, propositions.length]);
  });

  it("liste vide : liste vide", () => {
    expect(lightSort([], REF)).toEqual({ items: [], tierCounts: [0, 0, 0] });
  });
});
