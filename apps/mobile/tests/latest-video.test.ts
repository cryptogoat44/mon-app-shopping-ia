import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot 4 ter, décision du fondateur (2026-10-07) : le sélecteur d'iOS (aucune
// autorisation) reste le parcours par défaut ; la proposition automatique de
// la dernière vidéo est une option, demandée une fois. Accès limité ou refus :
// retour au sélecteur. Ces tests prouvent qu'aucune demande d'accès à la
// photothèque n'est faite sans « oui ».
const { platform, store, media } = vi.hoisted(() => {
  const exeForMetadata = vi.fn();
  const created = vi.fn();
  class Query {
    constructor() {
      created();
    }
    eq() {
      return this;
    }
    orderBy() {
      return this;
    }
    limit() {
      return this;
    }
    exeForMetadata() {
      return exeForMetadata();
    }
  }
  return {
    platform: { OS: "ios" },
    store: new Map<string, string>(),
    media: { getPermissionsAsync: vi.fn(), requestPermissionsAsync: vi.fn(), exeForMetadata, created, Query },
  };
});
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  },
}));
vi.mock("expo-media-library", () => ({
  getPermissionsAsync: media.getPermissionsAsync,
  requestPermissionsAsync: media.requestPermissionsAsync,
  Query: media.Query,
  Asset: class {},
  AssetField: { MEDIA_TYPE: "mediaType", CREATION_TIME: "creationTime" },
  MediaType: { VIDEO: "video" },
}));

import { latestVideoSettings, loadLatestVideo, saveLatestVideoChoice } from "../src/lib/latest-video";
import { galleryAccessFrom } from "../src/lib/latest-video-state";

const UNDETERMINED = { status: "undetermined", granted: false, canAskAgain: true, accessPrivileges: "none" } as const;
const FULL = { status: "granted", granted: true, canAskAgain: true, accessPrivileges: "all" } as const;
const LIMITED = { status: "granted", granted: true, canAskAgain: true, accessPrivileges: "limited" } as const;
const DENIED = { status: "denied", granted: false, canAskAgain: false, accessPrivileges: "none" } as const;

function neverTouchedGallery() {
  expect(media.getPermissionsAsync).not.toHaveBeenCalled();
  expect(media.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(media.created).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  platform.OS = "ios";
});

describe("dernière vidéo de la galerie : une option, jamais le parcours par défaut", () => {
  it("sans réponse : la question, et AUCUNE demande d'accès aux photos", async () => {
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "ask" });
    neverTouchedGallery();
  });

  it("« Non merci » : le sélecteur seulement ; ni accès demandé ni galerie lue, ensuite non plus", async () => {
    await saveLatestVideoChoice("compte-1", "no");
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "off" });
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "off" });
    neverTouchedGallery();
  });

  it("« Oui » : iOS demande l'accès une fois ; accès complet → la vidéo la plus récente", async () => {
    await saveLatestVideoChoice("compte-1", "yes");
    media.getPermissionsAsync.mockResolvedValue(UNDETERMINED);
    media.requestPermissionsAsync.mockResolvedValue(FULL);
    media.exeForMetadata.mockResolvedValue([{ id: "ph://derniere", duration: 12_000 }]);
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "ready", video: { id: "ph://derniere", durationMs: 12_000 } });
    expect(media.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(media.requestPermissionsAsync).toHaveBeenCalledWith(false, ["video"]);
  });

  it("« Oui », accès déjà complet : aucune nouvelle demande", async () => {
    await saveLatestVideoChoice("compte-1", "yes");
    media.getPermissionsAsync.mockResolvedValue(FULL);
    media.exeForMetadata.mockResolvedValue([]);
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "none" });
    expect(media.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("« Oui » mais accès limité : retour au sélecteur, la galerie n'est pas lue", async () => {
    await saveLatestVideoChoice("compte-1", "yes");
    media.getPermissionsAsync.mockResolvedValue(UNDETERMINED);
    media.requestPermissionsAsync.mockResolvedValue(LIMITED);
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "no_access", access: "limited" });
    expect(media.created).not.toHaveBeenCalled();
  });

  it("« Oui » mais accès refusé : retour au sélecteur, sans nouvelle demande", async () => {
    await saveLatestVideoChoice("compte-1", "yes");
    media.getPermissionsAsync.mockResolvedValue(DENIED);
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "no_access", access: "denied" });
    expect(media.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(media.created).not.toHaveBeenCalled();
  });

  it("réponse gardée par compte : un autre compte sur l'appareil se voit poser la question", async () => {
    await saveLatestVideoChoice("compte-1", "yes");
    expect(await loadLatestVideo("compte-2")).toEqual({ kind: "ask" });
    neverTouchedGallery();
  });

  it("sans compte connecté, ou hors iPhone : rien n'est proposé ni demandé", async () => {
    expect(await loadLatestVideo(null)).toEqual({ kind: "off" });
    platform.OS = "android";
    await saveLatestVideoChoice("compte-1", "yes");
    expect(await loadLatestVideo("compte-1")).toEqual({ kind: "off" });
    neverTouchedGallery();
  });

  it("Réglages : lit la réponse et l'accès sans jamais le demander", async () => {
    media.getPermissionsAsync.mockResolvedValue(LIMITED);
    expect(await latestVideoSettings("compte-1")).toEqual({ choice: null, access: "limited" });
    expect(media.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("accès selon iOS", () => {
  it("seul « all » est un accès complet ; un accès accordé sans précision compte comme limité", () => {
    expect(galleryAccessFrom(FULL)).toBe("full");
    expect(galleryAccessFrom(LIMITED)).toBe("limited");
    expect(galleryAccessFrom({ status: "granted", granted: true })).toBe("limited");
    expect(galleryAccessFrom(UNDETERMINED)).toBe("undetermined");
    expect(galleryAccessFrom(DENIED)).toBe("denied");
  });
});
