import { describe, expect, it, vi } from "vitest";

const { share, track } = vi.hoisted(() => ({ share: vi.fn(), track: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Share: { share, sharedAction: "sharedAction", dismissedAction: "dismissedAction" } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../src/lib/analytics", () => ({ track }));

import { postLink, postShareMessage, sharePost } from "../src/lib/share-post";

describe("partage d'une publication", () => {
  it("construit un lien vers la page de la publication", () => {
    expect(postLink("abc-123")).toBe("https://mon-app-shopping-ia-web.onrender.com/publication?id=abc-123");
  });

  it("le message contient l'auteur, la légende et le lien", () => {
    const message = postShareMessage({ id: "p1", caption: "Dimanche", author: { id: "u", username: "lea", displayName: "Léa", avatarUrl: null } });
    expect(message).toBe("Léa sur Spotto : « Dimanche »\nhttps://mon-app-shopping-ia-web.onrender.com/publication?id=p1");
  });

  it("iPhone : une feuille de partage fermée sans partager n'est pas comptée (lot 3bis)", async () => {
    const post = { id: "p1", caption: null, author: { id: "u", username: "lea", displayName: "Léa", avatarUrl: null } };
    share.mockResolvedValueOnce({ action: "dismissedAction" });
    expect(await sharePost(post)).toBe("cancelled");
    expect(track).not.toHaveBeenCalled();
    share.mockResolvedValueOnce({ action: "sharedAction" });
    expect(await sharePost(post)).toBe("shared");
    expect(track).toHaveBeenCalledWith("post_shared", { method: "native" });
  });
});
