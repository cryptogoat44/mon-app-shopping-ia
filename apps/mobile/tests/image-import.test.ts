import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot 4 ter : la photo est une entrée à part entière du Spotter. Un échec du
// sélecteur (photo restée sur iCloud, sans connexion) n'est plus muet.
const { launchImageLibraryAsync, manipulate } = vi.hoisted(() => ({ launchImageLibraryAsync: vi.fn(), manipulate: vi.fn() }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync }));
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate }, SaveFormat: { JPEG: "jpeg" } }));

import { importPhotoForSpotter } from "../src/lib/image-import";

function context(saved: { uri: string; width: number; height: number }) {
  return { resize: vi.fn(), renderAsync: vi.fn(async () => ({ saveAsync: vi.fn(async () => saved) })) };
}

beforeEach(() => vi.clearAllMocks());

describe("import d'une photo pour le Spotter", () => {
  it("photo indisponible : on le dit (« unavailable »), jamais d'échec muet", async () => {
    launchImageLibraryAsync.mockRejectedValue(new Error("Failed to read the image"));
    expect(await importPhotoForSpotter()).toEqual({ kind: "unavailable" });
  });

  it("photo illisible après le choix : même message", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/a.heic", width: 4000, height: 3000 }] });
    manipulate.mockReturnValue({ resize: vi.fn(), renderAsync: vi.fn(async () => Promise.reject(new Error("decode"))) });
    expect(await importPhotoForSpotter()).toEqual({ kind: "unavailable" });
  });

  it("choix annulé : rien à dire", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await importPhotoForSpotter()).toEqual({ kind: "cancelled" });
  });

  it("grande photo : réduite à 1 600 px, en JPEG", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/a.heic", width: 4000, height: 3000 }] });
    const ctx = context({ uri: "file:///cache/b.jpg", width: 1600, height: 1200 });
    manipulate.mockReturnValue(ctx);
    expect(await importPhotoForSpotter()).toEqual({ kind: "picked", uri: "file:///cache/b.jpg", width: 1600, height: 1200 });
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1600 });
  });
});
