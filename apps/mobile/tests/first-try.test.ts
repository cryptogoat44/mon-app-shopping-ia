import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CropRect, ProductSearch } from "@monapp/shared-types";

// Lot « premier essai » : cadre, « rien trouvé », « Garder » → Envies,
// boutique à l'étranger, aide du lien. api.ts importe le client Supabase réel
// et lit l'adresse du serveur au chargement : tout est remplacé ici, et
// `fetch` est simulé — jamais un vrai appel réseau.
const { track } = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
  return { track: vi.fn() };
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track, setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { runSearch } from "../src/lib/api";
import { DEFAULT_CROP, WHOLE_IMAGE, isDefaultCrop } from "../src/lib/crop-geometry";
import { isForeignPrice, searchCountryFrom } from "../src/lib/foreign-shop";
import { getDraft, startDraft } from "../src/lib/spot-draft";
import { openWishlistFromSpotter, requestedProfileSegment } from "../src/lib/wishlist-link";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

const moved: CropRect = { x: 0.3, y: 0.2, width: 0.4, height: 0.5 };

describe("« Entourez la pièce » : zone par défaut ou ajustée", () => {
  it("l'ancienne zone par défaut ou l'image entière (« Utiliser toute l'image ») : par défaut ; zone entourée ou absente : non", () => {
    expect(isDefaultCrop(DEFAULT_CROP)).toBe(true);
    expect(isDefaultCrop({ ...DEFAULT_CROP })).toBe(true);
    expect(isDefaultCrop(WHOLE_IMAGE)).toBe(true);
    expect(isDefaultCrop({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isDefaultCrop(moved)).toBe(false);
    expect(isDefaultCrop({ ...DEFAULT_CROP, width: 0.69 })).toBe(false);
    expect(isDefaultCrop({ ...WHOLE_IMAGE, height: 0.98 })).toBe(false);
    expect(isDefaultCrop(null)).toBe(false);
  });
});

describe("statistique « cadre ajusté » : n'est plus toujours vraie", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const completed: ProductSearch = {
    id: "s1",
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status: "completed",
    errorMessage: null,
    query: null,
    createdAt: "2026-11-03T10:00:00.000Z",
    matches: [],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    track.mockReset();
    vi.unstubAllGlobals();
  });

  async function launchedWith(crop: CropRect | null) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200, headers: { "Content-Type": "application/json" } }));
    await runSearch("s1", { crop, imageUri: null });
    return track.mock.calls.filter(([name]) => name === "spot_launched").at(-1)?.[1];
  }

  it("photo lancée avec le cadre par défaut : non ajusté (avant : toujours « oui »)", async () => {
    expect(await launchedWith(DEFAULT_CROP)).toEqual({ zone_adjusted: false, image_imported: false });
  });

  it("pièce entourée : ajusté ; sans zone : non", async () => {
    expect(await launchedWith(moved)).toEqual({ zone_adjusted: true, image_imported: false });
    expect(await launchedWith(null)).toEqual({ zone_adjusted: false, image_imported: false });
  });

  it("« Utiliser toute l'image » : non ajusté, et l'image entière part au serveur", async () => {
    expect(await launchedWith(WHOLE_IMAGE)).toEqual({ zone_adjusted: false, image_imported: false });
    const body = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect(JSON.parse(String(body.get("crop")))).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("le cadre part toujours tel quel au serveur", async () => {
    await launchedWith(DEFAULT_CROP);
    const body = fetchMock.mock.calls[0]![1]?.body as FormData;
    expect(JSON.parse(String(body.get("crop")))).toEqual(DEFAULT_CROP);
  });
});

describe("conseil de cadrage et « rien trouvé » : ne poussent plus à relancer la même image", () => {
  it("le conseil dit d'entourer la pièce seule (lot entourer la pièce), en français et en anglais", () => {
    expect(fr.launch.frameHint).toMatch(/^Entourez la pièce seule, sans visage ni texte autour/);
    expect(en.launch.frameHint).toMatch(/^Circle the piece alone, with no faces or text around it/);
  });

  it("« rien trouvé » : plus de « réessayez dans quelques minutes » ; zone, autre moment, mots", () => {
    for (const text of [fr.result.noMatchTitle, fr.result.noMatchTip]) expect(text).not.toMatch(/pour le moment|quelques minutes/);
    expect(fr.result.noMatchTip).toMatch(/entourer la pièce seule/);
    expect(fr.result.noMatchTip).toMatch(/autre moment de la vidéo/);
    expect(fr.result.noMatchTip).toMatch(/préciser vos mots/);
    expect(en.result.noMatchTip).not.toMatch(/few minutes/);
  });
});

describe("boutique à l'étranger", () => {
  it("pays de la recherche lu dans l'en-tête de langue, comme le serveur", () => {
    expect(searchCountryFrom("fr")).toBe("fr");
    expect(searchCountryFrom("en")).toBe("us");
    expect(searchCountryFrom("en-GB")).toBe("gb");
    expect(searchCountryFrom("en-FR")).toBe("fr");
  });

  it("France : un prix en pesos mexicains ou en dollars est signalé, pas un prix en euros (symbole, code, ou complété d'espaces par la base)", () => {
    expect(isForeignPrice(269, "$MX", "fr")).toBe(true);
    expect(isForeignPrice(45, "$US", "fr")).toBe(true);
    expect(isForeignPrice(49, "€", "fr")).toBe(false);
    expect(isForeignPrice(49, "€  ", "fr")).toBe(false);
    expect(isForeignPrice(49, "EUR", "fr")).toBe(false);
  });

  it("sans prix ou sans devise : rien à signaler ; pays dont la devise n'est pas connue ici : rien non plus", () => {
    expect(isForeignPrice(null, "$MX", "fr")).toBe(false);
    expect(isForeignPrice(45, null, "fr")).toBe(false);
    expect(isForeignPrice(45, "   ", "fr")).toBe(false);
    expect(isForeignPrice(45, "$MX", "de")).toBe(false);
  });

  it("anglais aux États-Unis : le dollar est local, l'euro est étranger", () => {
    expect(isForeignPrice(45, "$", "us")).toBe(false);
    expect(isForeignPrice(45, "€", "us")).toBe(true);
  });

  it("la mention, dans les deux langues", () => {
    expect(fr.firstTry.foreignShop).toBe("Boutique à l'étranger");
    expect(en.firstTry.foreignShop).toBe("Retailer abroad");
  });
});

describe("« Voir mes Envies » : le Profil s'ouvre sur l'onglet Envies", () => {
  it("seul « wishlist » change d'onglet ; sans paramètre, le Profil reste sur le Vault", () => {
    expect(requestedProfileSegment("wishlist")).toBe("wishlist");
    expect(requestedProfileSegment(undefined)).toBeNull();
    expect(requestedProfileSegment("vault")).toBeNull();
    expect(requestedProfileSegment("autre")).toBeNull();
    expect(requestedProfileSegment(["wishlist"])).toBeNull();
  });

  it("depuis un résultat : le parcours du Spotter est oublié, puis le Profil s'ouvre sur les Envies", () => {
    startDraft({ searchId: null, sourceUrl: null, platform: "photo", previewUrl: null, localImageUri: "file:///capture.jpg" });
    const dismissTo = vi.fn();
    openWishlistFromSpotter({ dismissTo } as unknown as Parameters<typeof openWishlistFromSpotter>[0]);
    expect(dismissTo).toHaveBeenCalledWith({ pathname: "/profile", params: { segment: "wishlist" } });
    expect(getDraft()).toBeNull();
  });
});

describe("aide du lien : la capture d'écran d'abord", () => {
  it.each([
    ["fr", fr],
    ["en", en],
  ] as const)("%s : quatre étapes, la dernière nomme le bouton principal ; trois étapes pour « Comment ça marche »", (_locale, catalog) => {
    const steps = [...catalog.preview.captureSteps(catalog.preview.theApp, catalog.preview.screenshotShortcut.ios).slice(0, 3), catalog.firstTry.linkHelp.lastStep(catalog.firstTry.linkHelp.addScreenshot)];
    expect(steps).toHaveLength(4);
    expect(steps[2]).toContain(catalog.preview.screenshotShortcut.ios);
    expect(steps[3]).toContain(catalog.firstTry.linkHelp.addScreenshot);
    expect(catalog.firstTry.howItWorks.steps(catalog.spotter.addPhoto)).toHaveLength(3);
    expect(catalog.firstTry.howItWorks.steps(catalog.spotter.addPhoto)[1]).toContain(catalog.spotter.addPhoto);
  });
});
