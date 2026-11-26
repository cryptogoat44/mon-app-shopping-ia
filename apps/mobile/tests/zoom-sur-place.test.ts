import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INPLACE_MAX_ZOOM, INPLACE_MIN_ZOOM, INPLACE_START, VIEWER_MAX_ZOOM, panInPlace, pinchInPlace } from "../src/lib/image-viewer";
import { ZOOM_HINT_KEY, ZOOM_HINT_MS, claimZoomHint, loadZoomHintSeen, markZoomHintSeen, type ZoomHintStore } from "../src/lib/zoom-hint";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

// Retours du build 3 (25 novembre 2026), point 8 : « qu'avec deux doigts
// seulement on puisse zoomer dessus sans cliquer », « enlève ce − et + »,
// « close n'est pas au bon endroit », « en relâchant simplement les deux
// doigts […] revenir au point de départ ». Réponse aux maquettes : « Pincez
// pour zoomer » la toute première fois seulement.
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const CENTER = { x: 0, y: 0 };
const STILL = { dx: 0, dy: 0 };

describe("pincement sur place (calcul pur)", () => {
  it("ratio 1, aucun déplacement : la tuile ne bouge pas", () => {
    expect(pinchInPlace(CENTER, STILL, 1)).toEqual(INPLACE_START);
    expect(pinchInPlace({ x: 80, y: -40 }, STILL, 1)).toEqual(INPLACE_START);
  });

  it("le point sous les doigts reste sous les doigts", () => {
    expect(pinchInPlace(CENTER, STILL, 2)).toEqual({ scale: 2, x: 0, y: 0 });
    // 2·50 + x = 50 → x = −50.
    expect(pinchInPlace({ x: 50, y: 0 }, STILL, 2)).toEqual({ scale: 2, x: -50, y: 0 });
    expect(pinchInPlace({ x: 0, y: 30 }, STILL, 3)).toEqual({ scale: 3, x: 0, y: -60 });
  });

  it("le zoom reste entre 1 et 4 (refusé : au-delà, en deçà, illisible)", () => {
    expect(INPLACE_MIN_ZOOM).toBe(1);
    expect(INPLACE_MAX_ZOOM).toBe(VIEWER_MAX_ZOOM);
    expect(pinchInPlace(CENTER, STILL, 10).scale).toBe(4);
    expect(pinchInPlace(CENTER, STILL, 0.5).scale).toBe(1);
    expect(pinchInPlace(CENTER, STILL, Number.NaN).scale).toBe(1);
    expect(pinchInPlace(CENTER, STILL, Number.POSITIVE_INFINITY).scale).toBe(1);
  });

  it("le déplacement du milieu des doigts est ajouté tel quel", () => {
    expect(pinchInPlace(CENTER, { dx: 12, dy: -7 }, 1)).toEqual({ scale: 1, x: 12, y: -7 });
    expect(pinchInPlace({ x: 50, y: 0 }, { dx: 10, dy: 5 }, 2)).toEqual({ scale: 2, x: -40, y: 5 });
  });

  it("deuxième doigt reposé : on repart du zoom en cours, sans saut", () => {
    const zoomed = pinchInPlace({ x: 50, y: 0 }, STILL, 2);
    // Même écart, mêmes doigts : rien ne bouge.
    expect(pinchInPlace({ x: 20, y: 10 }, STILL, 1, zoomed)).toEqual(zoomed);
    // Écart doublé : 4, au plus.
    expect(pinchInPlace({ x: 20, y: 10 }, STILL, 3, zoomed).scale).toBe(4);
  });

  it("un doigt levé : le zoom reste, le doigt restant déplace l'image", () => {
    expect(panInPlace({ scale: 2.5, x: 10, y: 20 }, 30, -5)).toEqual({ scale: 2.5, x: 40, y: 15 });
    expect(panInPlace(INPLACE_START, Number.NaN, 0)).toEqual(INPLACE_START);
  });
});

describe("« Pincez pour zoomer » : la toute première fois seulement", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    const store: ZoomHintStore = {
      getItem: async (key) => data[key] ?? null,
      setItem: async (key, value) => {
        data[key] = value;
      },
    };
    return { data, store };
  };

  it("jamais vue : montrée une fois, puis plus jamais (permis puis refusé)", async () => {
    const { data, store } = memory();
    expect(await loadZoomHintSeen(store)).toBe(false);
    expect(await claimZoomHint(store, "ios")).toBe(true);
    expect(data[ZOOM_HINT_KEY]).toBe("1");
    expect(await loadZoomHintSeen(store)).toBe(true);
    expect(await claimZoomHint(store, "ios")).toBe(false);
  });

  it("déjà vue : jamais", async () => {
    const { store } = memory({ [ZOOM_HINT_KEY]: "1" });
    expect(await claimZoomHint(store, "ios")).toBe(false);
  });

  it("lecture en erreur : considérée comme vue, jamais montrée", async () => {
    const broken: ZoomHintStore = {
      getItem: async () => {
        throw new Error("stockage indisponible");
      },
      setItem: async () => {},
    };
    expect(await loadZoomHintSeen(broken)).toBe(true);
    expect(await claimZoomHint(broken, "ios")).toBe(false);
  });

  it("écriture en erreur : rien ne casse", async () => {
    const readOnly: ZoomHintStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("plein");
      },
    };
    await expect(markZoomHintSeen(readOnly)).resolves.toBeUndefined();
  });

  it("site : jamais (une souris ne pince pas), et rien n'est rangé", async () => {
    const { data, store } = memory();
    expect(await claimZoomHint(store, "web")).toBe(false);
    expect(data).toEqual({});
  });

  it("la clé reste sur l'appareil ; la pastille disparaît après 4 s", () => {
    expect(ZOOM_HINT_KEY).toBe("spotto.zoom-hint-seen");
    expect(ZOOM_HINT_MS).toBe(4000);
    const hint = read("src/lib/zoom-hint.ts");
    // Aucun appel réseau, aucune statistique.
    expect(hint).not.toMatch(/fetch\(|track\(|from "\.\/api"/);
  });

  it("textes français et anglais", () => {
    expect(fr.common.zoomHint).toBe("Pincez pour zoomer");
    expect(en.common.zoomHint).toBe("Pinch to zoom");
  });
});

describe("le zoom sur place dans EnlargeableImage (lecture du code)", () => {
  const viewer = read("src/components/image-viewer.tsx");
  const inPlace = viewer.slice(viewer.indexOf("function PinchInPlace"), viewer.indexOf("export function ImageViewer"));

  it("iPhone : zoom sur place ; site : le plein écran au clic, inchangé", () => {
    const enlargeable = viewer.slice(viewer.indexOf("export function EnlargeableImage"), viewer.indexOf("function midpoint"));
    expect(enlargeable).toContain('if (Platform.OS === "web") {');
    expect(enlargeable).toContain("onPress={() => setOpen(true)}");
    expect(enlargeable).toContain("<PinchInPlace ");
  });

  it("deux doigts seulement : un doigt laisse défiler la page", () => {
    expect(inPlace).toContain("PanResponder.create");
    expect(inPlace).toContain("onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2");
    expect(inPlace).toContain("onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2");
    expect(inPlace).toContain("onPanResponderTerminationRequest: () => false");
    // Refusé : prendre le geste dès un doigt.
    expect(inPlace).not.toMatch(/onStartShouldSetPanResponder: \(\) => true/);
    expect(inPlace).toContain("pinchInPlace(");
    expect(inPlace).toContain("panInPlace(");
    // Mesure du centre à chaque toucher.
    expect(inPlace).toContain("onTouchStart={measure}");
    expect(inPlace).toContain("measureInWindow");
  });

  it("au dernier doigt levé, ou geste repris par le système : retour en ressort, piloté en natif", () => {
    expect(inPlace).toContain("onPanResponderRelease: giveBack");
    expect(inPlace).toContain("onPanResponderTerminate: giveBack");
    expect(inPlace).toContain("Animated.spring(value, { toValue, useNativeDriver: true, ...RETURN_SPRING })");
    expect(viewer).toContain("const RETURN_SPRING = { stiffness: 260, damping: 26, mass: 1 } as const;");
    // « Réduire les animations » : retour court, sans ressort.
    expect(inPlace).toContain("useReduceMotion()");
    expect(inPlace).toContain("Animated.timing(value, { toValue, duration: RETURN_REDUCED_MS, useNativeDriver: true })");
    expect(viewer).toContain("const RETURN_REDUCED_MS = 120;");
    // L'écran est prévenu : défilement bloqué, puis rendu.
    expect(inPlace).toContain('changeStateRef.current("zooming")');
    expect(inPlace).toContain('changeStateRef.current("returning")');
    expect(inPlace).toContain('if (finished) changeStateRef.current("idle")');
  });

  it("repincer pendant le retour : la tuile repart d'où elle est, sans saut", () => {
    const grant = inPlace.slice(inPlace.indexOf("onPanResponderGrant"), inPlace.indexOf("onPanResponderMove"));
    const move = inPlace.slice(inPlace.indexOf("onPanResponderMove"), inPlace.indexOf("onPanResponderRelease"));
    // Permis : les valeurs rendues (plus tard, en natif) vont dans la vue elle-même, et le geste les attend.
    expect(grant).toContain("pending = 3;");
    expect(grant).toContain("view = { ...view, ...patch };");
    expect(grant).toContain("scale.stopAnimation((value) => got({ scale: value }));");
    expect(grant).toContain("tx.stopAnimation((value) => got({ x: value }));");
    expect(grant).toContain("ty.stopAnimation((value) => got({ y: value }));");
    expect(move.indexOf("if (pending > 0) return;")).toBeGreaterThan(-1);
    expect(move.indexOf("if (pending > 0) return;")).toBeLessThan(move.indexOf("base = view"));
    // Refusé : recopier une copie locale dans la vue avant l'arrivée des valeurs natives.
    expect(grant).not.toContain("view = stopped");
    expect(grant).not.toMatch(/stopAnimation\(\(value\) => \(stopped/);
  });

  it("toute la tuile grandit et passe devant le titre et les boutons pendant le zoom", () => {
    expect(inPlace).toContain("<Animated.View style={{ transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>");
    expect(inPlace).toContain('style={[style, zoomState !== "idle" ? styles.lifted : null]}');
    expect(viewer).toContain('lifted: { zIndex: 10, overflow: "visible" }');
    // PieceTile : l'enveloppe entoure la tuile entière (fond, coins, coupe), plus le seul premier plan.
    const tile = read("src/components/piece-tile.tsx");
    expect(tile).toMatch(/<EnlargeableImage[\s\S]*?>\s*\{tileView\}\s*<\/EnlargeableImage>/);
    expect(tile).not.toMatch(/<EnlargeableImage[^>]*>\s*\{image\}/);
    expect(tile).toContain("onZoomStateChange={onZoomStateChange}");
    expect(tile).toContain("fullResolution={fullResolution}");
  });

  it("toucher l'image ne l'ouvre en grand qu'avec VoiceOver", () => {
    expect(read("src/lib/use-screen-reader.ts")).toContain('AccessibilityInfo.addEventListener("screenReaderChanged"');
    expect(read("src/lib/use-screen-reader.ts")).toContain("AccessibilityInfo.isScreenReaderEnabled()");
    expect(inPlace).toContain("onPress={screenReader ? onOpen : undefined}");
    expect(inPlace).toContain("disabled={!screenReader}");
  });

  it("« Pincez pour zoomer » : VoiceOver éteint, une seule fois, sans gêner le geste", () => {
    expect(inPlace).toContain("if (screenReader || zoomHintAsked) return;");
    expect(inPlace).toContain("(readerOn ? false : claimZoomHint(AsyncStorage, Platform.OS))");
    expect(inPlace).toContain('pointerEvents="none"');
    expect(inPlace).toContain("{t.common.zoomHint}");
    expect(inPlace).toContain("setTimeout(() => hideHintRef.current(), ZOOM_HINT_MS)");
    // Disparaît au premier pincement.
    expect(inPlace.slice(inPlace.indexOf("onPanResponderGrant"))).toMatch(/^onPanResponderGrant: \(\) => \{\s+changeStateRef\.current\("zooming"\);\s+hideHintRef\.current\(\);/);
    // Couleurs des jetons seulement.
    expect(viewer).toContain("backgroundColor: color.nuit, opacity: 0.72");
    expect(viewer).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba\(/);
  });

  it("refusé : ni gesture-handler, ni reanimated (rien n'est initialisé pour eux)", () => {
    for (const path of ["src/components/image-viewer.tsx", "src/components/piece-tile.tsx", "src/lib/use-screen-reader.ts", "src/lib/zoom-hint.ts"]) {
      expect(read(path), path).not.toMatch(/react-native-gesture-handler|react-native-reanimated|react-native-worklets/);
    }
  });
});

describe("le plein écran (site et VoiceOver)", () => {
  const viewer = read("src/components/image-viewer.tsx");
  const full = viewer.slice(viewer.indexOf("export function ImageViewer"));

  it("« Fermer » sous l'heure et la batterie : marges lues par le crochet, plus de SafeAreaView", () => {
    expect(viewer).not.toContain("<SafeAreaView");
    expect(viewer).not.toMatch(/import \{[^}]*\bSafeAreaView\b/);
    expect(full).toContain("const insets = useSafeAreaInsets();");
    expect(full).toContain("paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right");
    expect(viewer).toMatch(/nav: \{[^}]*justifyContent: "flex-end"[^}]*minHeight: 47/);
  });

  it("− et + sur le site seulement ; VoiceOver zoome en balayant ; Échap ferme", () => {
    expect(full).toMatch(/\{Platform\.OS === "web" \? \(\s*<View style=\{styles\.tools\}>/);
    expect(full.indexOf("t.common.imageViewer.zoomOut")).toBeGreaterThan(full.indexOf('{Platform.OS === "web" ? (\n          <View style={styles.tools}>'));
    expect(full).toContain('accessibilityRole="adjustable"');
    expect(full).toContain("onRequestClose={onClose}");
  });
});

describe("les trois écrans", () => {
  it("la page ne défile pas pendant le pincement ; la grande image est décodée en entier", () => {
    for (const path of ["src/app/(app)/envie.tsx", "src/app/(app)/vault-item/[id].tsx", "src/app/(app)/spot/result.tsx"]) {
      const source = read(path);
      expect(source, path).toContain('const [zoomState, setZoomState] = useState<ZoomState>("idle");');
      expect(source, path).toContain('scrollEnabled={zoomState !== "zooming"}');
      expect(source, path).toContain("onZoomStateChange={setZoomState}");
      expect(source, path).toContain("fullResolution");
    }
    const frame = read("src/components/product-frame.tsx");
    expect(frame).toContain("onZoomStateChange={onZoomStateChange}");
    expect(frame).toContain("fullResolution={fullResolution}");
  });

  it("refusé : pas de zoom dans le fil", () => {
    const post = read("src/components/post-card.tsx");
    expect(post).not.toContain("enlargeable");
    expect(post).not.toContain("onZoomStateChange");
  });
});
