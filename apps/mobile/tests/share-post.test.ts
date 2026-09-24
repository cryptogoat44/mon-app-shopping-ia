import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Share: { share: vi.fn() } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

import { postLink, postShareMessage } from "../src/lib/share-post";

describe("partage d'une publication", () => {
  it("construit un lien vers la page de la publication", () => {
    expect(postLink("abc-123")).toBe("https://mon-app-shopping-ia-web.onrender.com/publication?id=abc-123");
  });

  it("le message contient l'auteur, la légende et le lien", () => {
    const message = postShareMessage({ id: "p1", caption: "Dimanche", author: { id: "u", username: "lea", displayName: "Léa", avatarUrl: null } });
    expect(message).toBe("Léa sur Spotto : « Dimanche »\nhttps://mon-app-shopping-ia-web.onrender.com/publication?id=p1");
  });
});
