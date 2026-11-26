import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIEWER_DOUBLE_TAP_ZOOM,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
  VIEWER_START,
  clampViewerView,
  doubleTapViewer,
  isTap,
  panViewer,
  pinchViewerZoom,
  zoomViewerTo,
} from "../src/lib/image-viewer";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

// Retours du build 2 (« la qualité des images quand elles sont grossies est
// nulle et les gens ne peuvent pas voir correctement la pièce ») : l'image
// d'une envie, d'une pièce du Vault ou de la grande carte d'un résultat
// s'ouvre en plein écran, avec zoom. Jamais sur les images des grilles.
const FRAME = { width: 390, height: 600 };
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("zoom et déplacement de l'image en grand", () => {
  it("au zoom 1, l'image entière ne se déplace pas", () => {
    expect(panViewer(VIEWER_START, 120, -80, FRAME)).toEqual(VIEWER_START);
  });

  it("zoomée, elle se déplace sans que son bord quitte le cadre", () => {
    const zoomed = zoomViewerTo(VIEWER_START, 2, FRAME);
    expect(panViewer(zoomed, 100, 50, FRAME)).toEqual({ zoom: 2, x: 100, y: 50 });
    // Permis jusqu'à la moitié de ce qui dépasse (390 / 2 = 195, 600 / 2 = 300) ; refusé au-delà.
    expect(panViewer(zoomed, 1000, -1000, FRAME)).toEqual({ zoom: 2, x: 195, y: -300 });
  });

  it("le zoom reste entre 1 et 4, et dézoomer ramène l'image dans le cadre", () => {
    expect(zoomViewerTo(VIEWER_START, 10, FRAME).zoom).toBe(VIEWER_MAX_ZOOM);
    expect(zoomViewerTo(VIEWER_START, 0.2, FRAME).zoom).toBe(VIEWER_MIN_ZOOM);
    expect(zoomViewerTo({ zoom: 4, x: 500, y: 800 }, 1, FRAME)).toEqual(VIEWER_START);
    expect(clampViewerView({ zoom: Number.NaN, x: 10, y: 10 }, FRAME)).toEqual(VIEWER_START);
  });

  it("pincement : le zoom suit l'écart des doigts, dans les limites", () => {
    expect(pinchViewerZoom(1, 100, 200)).toBe(2);
    expect(pinchViewerZoom(2, 100, 1000)).toBe(VIEWER_MAX_ZOOM);
    expect(pinchViewerZoom(2, 0, 50)).toBe(2);
  });

  it("double toucher : zoome depuis l'image entière, revient à l'image entière sinon", () => {
    expect(doubleTapViewer(VIEWER_START, FRAME).zoom).toBe(VIEWER_DOUBLE_TAP_ZOOM);
    expect(doubleTapViewer({ zoom: 3, x: 40, y: 40 }, FRAME)).toEqual(VIEWER_START);
  });

  it("un geste presque immobile est un toucher ; un glissement n'en est pas un", () => {
    expect(isTap(2, 3)).toBe(true);
    expect(isTap(30, 0)).toBe(false);
  });
});

describe("où l'image s'ouvre en grand (lecture du code)", () => {
  it("fiche d'une envie, pièce du Vault, grande carte d'un résultat", () => {
    expect(read("src/app/(app)/envie.tsx")).toMatch(/<ProductFrame [^>]*enlargeable \/>/);
    // Lot « vitrine » : la grande tuile de pièce porte le geste (enlargeable → EnlargeableImage).
    expect(read("src/app/(app)/vault-item/[id].tsx")).toMatch(/<PieceTile\s+variant="hero"\s+enlargeable\s/);
    expect(read("src/app/(app)/spot/result.tsx").match(/<PieceTile\s+variant="hero"\s+enlargeable\s/g)).toHaveLength(1);
    expect(read("src/components/piece-tile.tsx")).toMatch(/<EnlargeableImage\s/);
    expect(read("src/components/piece-tile.tsx")).toContain("enlargeable = false");
  });

  it("jamais sur les images des grilles ni dans le fil", () => {
    for (const path of [
      "src/components/wishlist-panel.tsx",
      "src/app/(app)/(tabs)/profile/index.tsx",
      "src/components/proposal-card.tsx",
      "src/components/post-card.tsx",
    ]) {
      const source = read(path);
      expect(source, path).not.toContain("EnlargeableImage");
      expect(source, path).not.toMatch(/ProductFrame[^>]*enlargeable/);
      expect(source, path).not.toMatch(/PieceTile[^>]*enlargeable/);
    }
    // ProductFrame n'agrandit que si on le lui demande.
    expect(read("src/components/product-frame.tsx")).toContain("enlargeable = false");
  });

  it("plein écran et les trois grandes images zoomables : décodées en entier (zoom net) ; grilles : réduites comme avant", () => {
    const viewer = read("src/components/image-viewer.tsx");
    expect(viewer).toMatch(/<SpotImage\s[^>]*\n\s*fullResolution\n/);
    const spotImage = read("src/components/spot-image.tsx");
    expect(spotImage).toContain("fullResolution = false");
    // Les trois images d'expo-image (deux temps et une seule) suivent la demande.
    expect(spotImage.match(/allowDownscaling=\{!fullResolution\}/g)).toHaveLength(3);
    // Retours du build 3 (zoom sur place) : permis pour l'unique grande image de l'envie, du Vault et de la grande carte.
    expect(read("src/app/(app)/envie.tsx")).toMatch(/<ProductFrame [^>]*fullResolution[^>]*enlargeable \/>/);
    for (const path of ["src/app/(app)/vault-item/[id].tsx", "src/app/(app)/spot/result.tsx"]) {
      const source = read(path);
      expect(source.match(/\bfullResolution\b/g), path).toHaveLength(1);
      expect(source, path).toMatch(/<PieceTile\s+variant="hero"\s+enlargeable\s[^>]*fullResolution/);
    }
    // La tuile et le cadre ne décodent en entier que si on le leur demande.
    expect(read("src/components/piece-tile.tsx")).toContain("fullResolution = false");
    expect(read("src/components/product-frame.tsx")).toContain("fullResolution = false");
    // Refusé : les grilles et les autres écrans ne décodent jamais en pleine taille.
    for (const path of [
      "src/components/wishlist-panel.tsx",
      "src/components/proposal-card.tsx",
      "src/app/(app)/(tabs)/profile/index.tsx",
      "src/components/post-card.tsx",
      "src/app/look.tsx",
    ]) {
      expect(read(path), path).not.toContain("fullResolution");
    }
  });

  it("barre d'état claire sur le fond sombre, dans le plein écran seulement", () => {
    const viewer = read("src/components/image-viewer.tsx");
    expect(viewer).toContain('<StatusBar style="light" />');
    expect(viewer.indexOf('<StatusBar style="light" />')).toBeGreaterThan(viewer.indexOf("<Modal "));
    // Refusé : la vignette qui ouvre l'image ne change pas la barre d'état de l'écran.
    const enlargeable = viewer.slice(viewer.indexOf("export function EnlargeableImage"), viewer.indexOf("export function ImageViewer"));
    expect(enlargeable).not.toContain("StatusBar");
  });

  it("« Fermer », Échap sur le site (onRequestClose), gestes de React Native seulement, VoiceOver", () => {
    const source = read("src/components/image-viewer.tsx");
    expect(source).toContain("onRequestClose={onClose}");
    expect(source).toContain("accessibilityLabel={t.common.close}");
    expect(source).toContain("PanResponder.create");
    expect(source).toContain('accessibilityRole="adjustable"');
    // Site : « button » (react-native-web n'écrit aucun rôle « imagebutton ») ; iPhone : « imagebutton ».
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityRole="imagebutton"');
    expect(source).toContain("accessibilityViewIsModal");
    // Aucune dépendance nouvelle : ni gesture-handler, ni reanimated, ni bibliothèque de zoom.
    expect(source).not.toMatch(/react-native-gesture-handler|react-native-reanimated|zoom-view|image-viewing/);
    // Boutons de 44 points au moins.
    expect(source).toMatch(/width: 44,\s*height: 44/);
    expect(source).toMatch(/minHeight: 44, minWidth: 44/);
  });
});

describe("textes", () => {
  it("français et anglais, vrais de l'iPhone comme du site", () => {
    // iPhone : seul VoiceOver lit ce libellé, et VoiceOver ne laisse pas passer le pincement ;
    // il annonce le geste qui marche (balayer vers le haut ou le bas, rôle « adjustable »).
    expect(fr.common.imageViewer.viewerLabel).toBe("Image de la pièce en grand. Balayez vers le haut ou le bas pour zoomer.");
    expect(en.common.imageViewer.viewerLabel).toBe("Large image of the piece. Swipe up or down to zoom.");
    expect(fr.common.imageViewer.viewerLabel).not.toContain("Pincez");
    expect(en.common.imageViewer.viewerLabel).not.toContain("Pinch");
    // Le site n'a pas de pincement : il ne le promet pas.
    expect(fr.common.imageViewer.viewerLabelWeb).not.toContain("Pincez");
    expect(en.common.imageViewer.viewerLabelWeb).not.toContain("Pinch");
    expect(fr.common.imageViewer.openHint).toBe("Ouvre l'image en grand");
    expect(en.common.imageViewer.openHint).toBe("Opens the image full screen");
  });
});

describe("politique de confidentialité : la page de la boutique lue par notre serveur", () => {
  it("la phrase existe en français et en anglais, sans rien transmettre du membre", () => {
    expect(read("src/legal/confidentialite.ts")).toContain(
      "notre serveur peut consulter la page publique de la boutique pour y lire l'adresse d'une image plus grande, puis télécharger cette image pour vérifier sa taille. Il le fait comme le robot d'aperçu d'un lien : la boutique ne reçoit ni votre identité, ni votre adresse IP, ni aucun cookie, seulement l'adresse de sa propre page."
    );
    expect(read("src/legal/confidentialite.en.ts")).toContain(
      "our server may visit the shop's public page to read the address of a larger image, then download that image to check its size. It does so like a link-preview robot: the shop receives neither your identity, nor your IP address, nor any cookie, only the address of its own page."
    );
  });
});
