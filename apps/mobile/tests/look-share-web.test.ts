import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Page look, site : le partage après l'attente de la création du lien (le
// navigateur exige un toucher récent). Chaque règle : un cas refusé, un cas permis.
vi.mock("react-native", () => ({ Platform: { OS: "web" }, Share: { share: vi.fn(), sharedAction: "sharedAction" } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../src/lib/api", () => ({ ApiError: class extends Error {}, authorizedFetch: vi.fn() }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ session: null }) }));

import * as Clipboard from "expo-clipboard";
import { track } from "../src/lib/analytics";
import { rememberedLookReused, rememberLookUrl, shareLookLink, shareRefusal } from "../src/lib/look-pages";

const URL = "https://spotto.example/look?l=AbCdEfGhIjKlMnOpQrStUv";
const clipboard = vi.mocked(Clipboard.setStringAsync);
const trackMock = vi.mocked(track);

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

beforeEach(() => {
  clipboard.mockReset();
  trackMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("partage du lien sur le site", () => {
  it("refusé : partage refusé par le navigateur (toucher trop ancien) → « needs_tap », rien n'est compté", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(domError("NotAllowedError")) });
    expect(await shareLookLink("Robe", URL, false)).toBe("needs_tap");
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("permis : feuille de partage ouverte → « shared » ; fermée par le membre → « cancelled », sans message", async () => {
    vi.stubGlobal("navigator", { share: vi.fn().mockResolvedValue(undefined) });
    expect(await shareLookLink("Robe", URL, false)).toBe("shared");
    expect(trackMock).toHaveBeenCalledWith("look_shared", { method: "native", reused: false });
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(domError("AbortError")) });
    expect(await shareLookLink("Robe", URL, true)).toBe("cancelled");
  });

  it("refusé : copie de secours qui rend false → « needs_tap », jamais « Lien copié. » ; permis : copie réussie → « copied »", async () => {
    vi.stubGlobal("navigator", {});
    clipboard.mockResolvedValue(false);
    expect(await shareLookLink("Robe", URL, false)).toBe("needs_tap");
    expect(trackMock).not.toHaveBeenCalled();
    clipboard.mockResolvedValue(true);
    expect(await shareLookLink("Robe", URL, false)).toBe("copied");
    expect(clipboard).toHaveBeenLastCalledWith(expect.stringContaining(URL));
    expect(trackMock).toHaveBeenCalledWith("look_shared", { method: "copy", reused: false });
  });

  it("refusé : page créée puis partage refusé (« needs_tap ») → elle n'est pas comptée comme reprise, le nouveau toucher envoie reused = false", async () => {
    rememberLookUrl("piece-neuve", URL, true);
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(domError("NotAllowedError")) });
    expect(await shareLookLink("Robe", URL, rememberedLookReused("piece-neuve"), "piece-neuve")).toBe("needs_tap");
    expect(rememberedLookReused("piece-neuve")).toBe(false);
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(domError("AbortError")) });
    expect(await shareLookLink("Robe", URL, rememberedLookReused("piece-neuve"), "piece-neuve")).toBe("cancelled");
    expect(rememberedLookReused("piece-neuve")).toBe(false);
    vi.stubGlobal("navigator", { share: vi.fn().mockResolvedValue(undefined) });
    expect(await shareLookLink("Robe", URL, rememberedLookReused("piece-neuve"), "piece-neuve")).toBe("shared");
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("look_shared", { method: "native", reused: false });
  });

  it("permis : après un premier partage réussi (ou une page qui existait déjà), le partage suivant compte reused = true", async () => {
    rememberLookUrl("piece-copiee", URL, true);
    vi.stubGlobal("navigator", {});
    clipboard.mockResolvedValue(true);
    expect(await shareLookLink("Robe", URL, rememberedLookReused("piece-copiee"), "piece-copiee")).toBe("copied");
    expect(trackMock).toHaveBeenLastCalledWith("look_shared", { method: "copy", reused: false });
    expect(rememberedLookReused("piece-copiee")).toBe(true);
    expect(await shareLookLink("Robe", URL, rememberedLookReused("piece-copiee"), "piece-copiee")).toBe("copied");
    expect(trackMock).toHaveBeenLastCalledWith("look_shared", { method: "copy", reused: true });
    rememberLookUrl("piece-existante", URL, false);
    expect(rememberedLookReused("piece-existante")).toBe(true);
  });

  it("shareRefusal : seule NotAllowedError demande un nouveau toucher", () => {
    expect(shareRefusal(domError("NotAllowedError"))).toBe("needs_tap");
    expect(shareRefusal(domError("AbortError"))).toBe("cancelled");
    expect(shareRefusal("NotAllowedError")).toBe("cancelled");
    expect(shareRefusal(null)).toBe("cancelled");
  });
});
