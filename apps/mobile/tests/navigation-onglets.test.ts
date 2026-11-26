import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSlide, LIFT_MARGIN, liftedAbove, slideTarget, TAP_SLOP, tabIndexAt } from "../src/lib/tab-bar-gesture";
import { barBottom, barFrame, FLOATING_BAR, tabBarSpace } from "../src/lib/tab-bar-metrics";
import { darkPalette, lightPalette } from "../src/theme/tokens";

// Retours du build 2, lot « navigation » : la barre d'onglets maison où l'on
// glisse le doigt d'un onglet à l'autre, le léger glissement entre les
// écrans, et le profil qui défile en entier. Pas de rendu de composants ici
// (vitest.config.ts) : la logique du glissé est testée, les fichiers lus.
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const layout = read("app/(app)/(tabs)/_layout.tsx");
const bar = read("components/tab-bar.tsx");
const profile = read("app/(app)/(tabs)/profile/index.tsx");
const panel = read("components/wishlist-panel.tsx");

// Les cinq places : Spotter, Fil, +, Activité, Profil ; le « + » est la 3ᵉ.
const PUBLISH = new Set([2]);

describe("le glissé sur la barre (logique pure)", () => {
  it("refusé : moins de 10 points de côté, c'est un toucher ; permis : 10 points ou plus, c'est un glissé", () => {
    expect(TAP_SLOP).toBe(10);
    expect(isSlide(0, 0)).toBe(false);
    expect(isSlide(9.5, 0)).toBe(false);
    expect(isSlide(-9, 0)).toBe(false);
    expect(isSlide(10, 0)).toBe(true);
    expect(isSlide(-24, 0)).toBe(true);
  });

  it("refusé : un pouce qui part vers le haut (ou le bas) en dérivant un peu de côté n'est pas un glissé ; permis : un glissé surtout de côté", () => {
    expect(isSlide(12, 40)).toBe(false);
    expect(isSlide(15, -150)).toBe(false);
    expect(isSlide(-12, 12)).toBe(false);
    expect(isSlide(12, 3)).toBe(true);
    expect(isSlide(-30, -20)).toBe(true);
  });

  it("refusé : doigt levé bien au-dessus de la barre, rien ne s'ouvre ; permis : levé sur la barre ou juste au-dessus", () => {
    expect(LIFT_MARGIN).toBe(24);
    // Haut de la rangée à 760 points.
    expect(liftedAbove(600, 760)).toBe(true);
    expect(liftedAbove(735, 760)).toBe(true);
    expect(liftedAbove(736, 760)).toBe(false);
    expect(liftedAbove(780, 760)).toBe(false);
  });

  it("l'onglet sous le doigt : cinq places égales, les bords comptent pour la place la plus proche", () => {
    expect(tabIndexAt(0, 375, 5)).toBe(0);
    expect(tabIndexAt(74, 375, 5)).toBe(0);
    expect(tabIndexAt(75, 375, 5)).toBe(1);
    expect(tabIndexAt(300, 375, 5)).toBe(4);
    expect(tabIndexAt(374.9, 375, 5)).toBe(4);
    expect(tabIndexAt(-30, 375, 5)).toBe(0);
    expect(tabIndexAt(900, 375, 5)).toBe(4);
    // Rangée pas encore mesurée : aucune erreur.
    expect(tabIndexAt(100, 0, 5)).toBe(0);
  });

  it("refusé : lever le doigt sur le « + » après un glissé n'ouvre rien ; permis : sur Activité, Activité s'ouvre", () => {
    expect(slideTarget(2, PUBLISH)).toBeNull();
    expect(slideTarget(3, PUBLISH)).toBe(3);
    expect(slideTarget(0, PUBLISH)).toBe(0);
  });
});

describe("la barre maison (components/tab-bar.tsx)", () => {
  it("passée à Tabs ; le « + » ne s'ouvre qu'au toucher et ouvre toujours la publication", () => {
    expect(layout).toContain('tabBar={(props) => <TabBar {...props} tapOnlyRoutes={["publish"]} />}');
    expect(layout).toMatch(/tabPress: \(e\) => \{\s*e\.preventDefault\(\);\s*router\.push\("\/post-item\/new"\);/);
    // Le toucher passe par l'événement tabPress, que le « + » intercepte.
    expect(bar).toContain('nav.emit({ type: "tabPress", target: route.key, canPreventDefault: true })');
    expect(bar).toContain("if (!focused && !event.defaultPrevented) nav.navigate(route.name, route.params);");
    // Le glissé ne passe que par slideTarget (jamais le « + »).
    expect(bar).toContain("const target = slideTarget(index, latest.current.tapOnly);");
  });

  it("un toucher reste aux boutons : seul un déplacement de côté prend la main", () => {
    expect(bar).toContain("onStartShouldSetPanResponder: () => false");
    expect(bar).toContain("onMoveShouldSetPanResponderCapture: (_event, gesture) => isSlide(gesture.dx, gesture.dy)");
    expect(bar).toContain("onMoveShouldSetPanResponder: (_event, gesture) => isSlide(gesture.dx, gesture.dy)");
    expect(bar).toContain("onPanResponderRelease: (_event, gesture) => finish(true, gesture.moveY),");
    expect(bar).toContain("if (releaseY !== undefined && liftedAbove(releaseY, measure.current.y)) return;");
  });

  it("site : refusé, le clic qui suit un glissé à la souris n'ouvre rien (ni le « + ») ; permis : un toucher ou Entrée hors glissé ouvre l'onglet", () => {
    expect(bar).toContain("slidUntil.current = Number.MAX_SAFE_INTEGER;");
    expect(bar).toContain("slidUntil.current = Date.now() + 300;");
    expect(bar).toMatch(/onPress=\{\(\) => \{\s*if \(Date\.now\(\) < slidUntil\.current\) return;\s*openTab\(index\);\s*\}\}/);
    // Au départ, aucun glissé : le premier appui passe.
    expect(bar).toContain("const slidUntil = useRef(0);");
  });

  it("VoiceOver : rôle d'avant (« bouton » sur iPhone, où « onglet » ne s'annonce pas ; « onglet » ailleurs), état choisi et libellés d'avant (dont « Activité, N non lus ») sur chaque bouton", () => {
    expect(bar).toContain('accessibilityRole={Platform.OS === "ios" ? "button" : "tab"}');
    expect(bar).not.toContain('accessibilityRole="tab"\n');
    expect(bar).toContain("accessibilityState={{ selected: focused }}");
    expect(bar).toContain("accessibilityLabel={options.tabBarAccessibilityLabel}");
    expect(bar).toContain('accessibilityRole="tablist"');
    expect(layout.match(/tabBarAccessibilityLabel:/g)).toHaveLength(5);
    expect(layout).toContain("tabBarAccessibilityLabel: unread > 0 ? t.tabs.unread(t.notifications.title, unread) : t.notifications.title");
  });

  it("refusé : ni gesture-handler, ni reanimated, ni pager (rien n'est initialisé pour eux) ; permis : PanResponder et Animated", () => {
    for (const source of [bar, layout, read("lib/tab-bar-gesture.ts"), read("lib/use-reduce-motion.ts")]) {
      expect(source).not.toMatch(/react-native-gesture-handler|react-native-reanimated|react-native-pager-view|react-native-tab-view/);
    }
    expect(bar).toMatch(/import \{ Animated, PanResponder, [^}]*\} from "react-native";/);
    expect(bar).toContain("PanResponder.create(");
  });

  it("la vibration : jamais sur le site ni sur le « + », et une erreur ne casse rien", () => {
    expect(bar).toContain('if (!first && !skip.has(index) && Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});');
  });

  it("« Réduire les animations » : ni glissement d'écran, ni pastille qui glisse", () => {
    expect(layout).toContain('animation: reduceMotion ? "none" : "shift",');
    expect(bar).toContain("const reduceMotion = useReduceMotion();");
    expect(bar).toMatch(/if \(still\) \{\s*pillX\.setValue\(x\);\s*pillOpacity\.setValue\(opacity\);\s*return;/);
    const hook = read("lib/use-reduce-motion.ts");
    expect(hook).toContain("AccessibilityInfo.isReduceMotionEnabled()");
    expect(hook).toContain('AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)');
  });

  // Retours du build 3 (point 5) : la barre flotte ; elle gère seule sa forme et sa hauteur (62 sur le site).
  it("refusé : la barre dans le flux, pleine largeur, réglée par l'écran ; permis : une pilule en position absolue, calée par barBottom et FLOATING_BAR", () => {
    expect(bar).toContain('position: "absolute",');
    expect(bar).toContain("bottom: barBottom(insets.bottom),");
    expect(bar).toContain('height: Platform.OS === "web" ? FLOATING_BAR.webHeight : FLOATING_BAR.height,');
    expect(bar).toContain("const frame = barFrame(window.width, Math.max(insets.left, insets.right));");
    expect(bar).toContain("left: frame.left,");
    expect(bar).toContain("width: frame.width,");
    expect(layout).not.toContain("height: 62, paddingBottom: 8");
    expect(layout).not.toContain("tabBarStyle");
    expect(bar).not.toContain("focusedOptions.tabBarStyle");
    // L'ancienne hauteur pleine (49 + zone du bas) a disparu.
    expect(bar).not.toContain("BAR_HEIGHT + insets.bottom");
  });
});

describe("la barre flottante : les mesures (lib/tab-bar-metrics.ts)", () => {
  it("le bas de la pilule : 26 sur un iPhone à Face ID, 12 sans zone du bas ; refusé : jamais sous 12", () => {
    expect(FLOATING_BAR).toMatchObject({ height: 60, webHeight: 62, side: 16, maxWidth: 480, aboveHomeIndicator: 8, minBottom: 12, contentGap: 16 });
    expect(barBottom(34)).toBe(26);
    expect(barBottom(0)).toBe(12);
    expect(barBottom(16)).toBe(12);
    expect(barBottom(20)).toBe(12);
    expect(barBottom(21)).toBe(13);
    expect(barBottom(-5)).toBe(12);
    expect(barBottom(Number.NaN)).toBe(12);
  });

  it("l'espace sous les listes : bas de la pilule + hauteur + 16 d'air", () => {
    expect(tabBarSpace(34)).toBe(102);
    expect(tabBarSpace(0)).toBe(88);
    expect(tabBarSpace(0, 62)).toBe(90);
    expect(tabBarSpace(34, FLOATING_BAR.webHeight)).toBe(104);
  });

  it("la largeur : 16 de chaque côté, centrée ; refusé : plus de 480 sur un grand écran", () => {
    expect(barFrame(390, 0)).toEqual({ left: 16, width: 358 });
    expect(barFrame(320, 0)).toEqual({ left: 16, width: 288 });
    expect(barFrame(1440, 0)).toEqual({ left: 480, width: 480 });
    expect(barFrame(1440, 0).width).toBeLessThanOrEqual(480);
    // iPhone couché : la zone sûre des côtés s'ajoute aux 16.
    expect(barFrame(844, 47)).toEqual({ left: 182, width: 480 });
    expect(barFrame(600, 47)).toEqual({ left: 63, width: 474 });
    // Toujours centrée.
    for (const [width, side] of [[390, 0], [430, 0], [1440, 0], [600, 47]] as const) {
      const frame = barFrame(width, side);
      expect(frame.left * 2 + frame.width).toBe(width);
    }
    // Fenêtre pas encore mesurée : aucune largeur négative.
    expect(barFrame(0, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe("la barre flottante : la pilule (components/tab-bar.tsx)", () => {
  it("fond très légèrement translucide (jeton barre), plein avec « Réduire la transparence » ; bouts arrondis, filet tout autour", () => {
    expect(bar).toContain("backgroundColor: color.barre,");
    expect(bar).toContain("const reduceTransparency = useReduceTransparency();");
    expect(bar).toContain("reduceTransparency ? styles.barSolid : null,");
    expect(bar).toContain("barSolid: { backgroundColor: color.surface },");
    expect(bar).toContain("borderRadius: radius.full,");
    expect(bar).toContain("borderWidth: StyleSheet.hairlineWidth,");
    expect(bar).not.toContain("borderTopWidth");
    // Refusé : overflow hidden (iOS couperait l'ombre) ; l'ombre en clair seulement.
    expect(bar).not.toContain('overflow: "hidden"');
    expect(bar).toContain('...(getActiveScheme() === "light"');
  });

  it("refusé : une vue pleine largeur qui avalerait les touchers à côté de la pilule ; permis : la pilule seule", () => {
    const render = bar.slice(bar.indexOf("  return (\n    <View"), bar.indexOf("const styles = themedStyles("));
    expect(render).not.toMatch(/StyleSheet\.absoluteFill|width: "100%"|right: 0/);
    expect(bar).not.toContain("BottomTabBarHeightCallbackContext");
  });

  it("refusé : un libellé affiché sous l'icône ; permis : le nom de l'onglet pour VoiceOver et la loupe du grand texte", () => {
    expect(bar).not.toMatch(/<Text\b/);
    expect(bar).not.toContain("tabBarLabelStyle");
    expect(layout).not.toContain("tabBarLabelStyle");
    expect(bar).toContain("accessibilityLabel={options.tabBarAccessibilityLabel}");
    expect(bar).toContain("accessibilityLargeContentTitle={title}");
    expect(bar).toContain("accessibilityShowsLargeContentViewer");
    expect(layout.match(/tabBarAccessibilityLabel:/g)).toHaveLength(5);
    // Chaque onglet prend toute la hauteur de la pilule (60) : bien plus que 44.
    expect(bar).toContain('item: { flex: 1, alignItems: "center", justifyContent: "center" },');
  });

  it("la pastille de l'onglet ouvert : 56 × 44, discrète, toujours là hors glissé ; refusé : effacée à la fin d'un glissé ; jamais sur le « + »", () => {
    expect(bar).toContain("pill: { width: 56, maxWidth: \"100%\", height: 44, borderRadius: radius.full, backgroundColor: color.filet },");
    // Posée derrière l'onglet ouvert, puis elle le suit.
    expect(bar).toContain("pillOpacity.setValue(tapOnly.has(state.index) ? 0 : 1);");
    expect(bar).toMatch(/\}, \[state\.index, rowWidth, count, pillX, pillOpacity\]\);/);
    expect(bar).toContain("    showPill(state.index);\n");
    // Fin du glissé : elle revient derrière l'onglet ouvert au lieu de s'effacer.
    const finish = bar.slice(bar.indexOf("  function finish("), bar.indexOf("  const responder = useRef("));
    expect(finish).toContain("showPill(latest.current.state.index);");
    expect(finish).not.toContain("toValue: 0");
    expect(finish).not.toContain("pillOpacity.setValue(0)");
    // Le « + » : la pastille s'efface toujours sur lui.
    expect(bar).toContain("const opacity = skip.has(index) ? 0 : 1;");
  });

  it("le « + » : disque de 46 points, centré dans la pilule ; refusé : l'ancien décalage vers les libellés", () => {
    const plus = layout.slice(layout.indexOf('name="publish"'), layout.indexOf('name="activite"'));
    expect(plus).toContain("width: 46,");
    expect(plus).toContain("height: 46,");
    expect(plus).not.toContain("marginBottom: -6");
  });

  it("« Réduire la transparence » : lu et suivi en direct, iPhone seulement (le site n'a pas cette fonction)", () => {
    const hook = read("lib/use-reduce-transparency.ts");
    expect(hook).toContain('if (Platform.OS !== "ios") return;');
    expect(hook).toContain("AccessibilityInfo.isReduceTransparencyEnabled()");
    expect(hook).toContain('AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency)');
    expect(hook).toContain("subscription?.remove();");
    expect(hook).toContain(".catch(() => {});");
  });

  it("le jeton barre : la surface à 94 % dans les deux thèmes", () => {
    expect(lightPalette.barre).toBe("rgba(255, 255, 255, 0.94)");
    expect(darkPalette.barre).toBe("rgba(30, 28, 26, 0.94)");
    for (const palette of [lightPalette, darkPalette]) {
      const [r, g, b, a] = palette.barre.match(/[\d.]+/g)!.map(Number);
      const hex = `#${[r, g, b].map((c) => c!.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
      expect(hex).toBe(palette.surface.toUpperCase());
      expect(a).toBe(0.94);
    }
  });

  it("les icônes restent lisibles sur la pilule, même avec une photo blanche ou noire dessous (3:1 au moins)", () => {
    const channel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const ratio = (a: number[], b: number[]) => {
      const [high, low] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (high! + 0.05) / (low! + 0.05);
    };
    for (const palette of [lightPalette, darkPalette]) {
      const [r, g, b, a] = palette.barre.match(/[\d.]+/g)!.map(Number);
      for (const below of [[255, 255, 255], [0, 0, 0]]) {
        const ground = [r!, g!, b!].map((c, i) => c * a! + below[i]! * (1 - a!));
        for (const icon of [palette.encre, palette.acier]) expect(ratio(rgb(icon), ground), `${icon} sur ${palette.barre}`).toBeGreaterThanOrEqual(3);
        // La pastille (filet) sous l'icône ouverte (encre) : toujours lisible.
        expect(ratio(rgb(palette.encre), rgb(palette.filet))).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("la barre flottante : le contenu passe dessous et garde la place en bas", () => {
  const tabs = {
    spotter: read("app/(app)/(tabs)/index.tsx"),
    fil: read("app/(app)/(tabs)/feed/index.tsx"),
    profil: profile,
    activite: read("app/(app)/(tabs)/activite.tsx"),
  };

  it("refusé : le bord du bas de la zone sûre (la liste s'arrêterait au-dessus) ; permis : haut, gauche et droite seulement", () => {
    for (const [name, source] of Object.entries(tabs)) {
      const screens = source.match(/<SafeAreaView\b[^>]*>/g) ?? [];
      expect(screens.length, name).toBeGreaterThan(0);
      for (const screen of screens) expect(screen, name).toContain('edges={["top", "left", "right"]}');
      expect(source, name).toContain("const tabBarSpace = useTabBarSpace();");
    }
  });

  it("chaque liste qui défile garde l'espace de la barre en bas, barre de défilement comprise ; refusé : l'ancien space.xxl seul", () => {
    const lists = (source: string) => source.split(/\n\s*<(?:FlatList|ScrollView)\b/).slice(1).map((part) => part.slice(0, part.indexOf(">\n") + 1));
    const counts: Record<string, number> = {};
    for (const [name, source] of Object.entries(tabs)) {
      const found = lists(source);
      counts[name] = found.length;
      for (const list of found) {
        expect(list, name).toMatch(/paddingBottom: tabBarSpace|bottomSpace\]|contentContainerStyle=\{bottomSpace\}/);
        expect(list, name).toContain("scrollIndicatorInsets={{ bottom: tabBarSpace }}");
      }
    }
    // Spotter (la grille), Fil (abonnements et « Pour vous »), Profil (chargement, Vault, Lifestyle), Activité.
    expect(counts).toEqual({ spotter: 1, fil: 2, profil: 3, activite: 1 });
    expect(profile).toContain("<WishlistPanel news={news} header={profileHeader(false)} bottomSpace={tabBarSpace} />");
    // Envies : la grille et « Reçues ».
    expect(panel).toContain("bottomSpace !== undefined ? { paddingBottom: bottomSpace } : null]}");
    expect(panel).toContain("contentContainerStyle={bottomSpace !== undefined ? { paddingBottom: bottomSpace } : null}");
    expect(panel.match(/scrollIndicatorInsets=\{bottomSpace !== undefined \? \{ bottom: bottomSpace \} : undefined\}/g)).toHaveLength(2);
    // Plus de 48 en bas sous la grille de l'accueil ni sous l'activité (remplacés par l'espace de la barre).
    expect(tabs.spotter).not.toMatch(/content: \{[^}]*paddingBottom: space\.xxl/);
    expect(tabs.activite).not.toMatch(/content: \{[^}]*paddingBottom: space\.xxl/);
  });

  it("le même calcul que la pilule (62 sur le site)", () => {
    const hook = read("lib/use-tab-bar-space.ts");
    expect(hook).toContain('return tabBarSpace(insets.bottom, Platform.OS === "web" ? FLOATING_BAR.webHeight : FLOATING_BAR.height);');
  });

  it("le bandeau d'annonces : 16 points au-dessus de la pilule ; refusé : les 72 fixes d'avant", () => {
    const banner = read("components/notice-banner.tsx");
    expect(banner).not.toContain("TAB_BAR_CLEARANCE");
    expect(banner).toContain('{ bottom: tabBarSpace(insets.bottom, Platform.OS === "web" ? FLOATING_BAR.webHeight : FLOATING_BAR.height) }');
  });
});

describe("le profil défile en entier (son propre profil)", () => {
  const fixedPart = profile.slice(profile.indexOf('<SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>'), profile.indexOf("{loading ? ("));

  it("refusé : la photo, les compteurs et les onglets ne restent plus fixes ; permis : la barre du haut (@pseudo, réglages) reste", () => {
    expect(fixedPart).toContain("<View style={styles.nav}>");
    expect(fixedPart).toContain('router.push("/settings")');
    for (const part of ["styles.head", "styles.stats", "styles.seg", "<Avatar"]) expect(fixedPart).not.toContain(part);
  });

  it("l'en-tête est en tête du contenu de chaque onglet, chargement compris", () => {
    expect(profile).toContain("const profileHeader = (inset: boolean) => (");
    // Chargement, Envies, Vault, Lifestyle.
    expect(profile.match(/profileHeader\(/g)).toHaveLength(4);
    expect(profile).toContain("<WishlistPanel news={news} header={profileHeader(false)} bottomSpace={tabBarSpace} />");
    expect(profile).toMatch(/ListHeaderComponent=\{\s*<>\s*\{profileHeader\(!\(vaultError \|\| isEmptyVault\)\)\}/);
    expect(profile).toMatch(/refreshControl=\{<RefreshControl[^\n]*\/>\}\s*>\s*\{profileHeader\(false\)\}/);
    // Envies : tout en haut de la liste, avant « Mes envies | Reçues ».
    const header = panel.slice(panel.indexOf("  const header = ("), panel.indexOf("  return (\n    <>"));
    expect(header.indexOf("{profileHeader ?")).toBeGreaterThan(-1);
    expect(header.indexOf("{profileHeader ?")).toBeLessThan(header.indexOf("{switcher}"));
  });

  it("aucune fonction ne disparaît : tirer pour rafraîchir et le chargement par pages restent dans chaque onglet", () => {
    expect(profile.match(/<RefreshControl refreshing=\{refreshing\} onRefresh=\{handleRefresh\}/g)).toHaveLength(2);
    expect(profile).toContain("onEndReached={handleLoadMoreVault}");
    expect(panel).toContain("refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}");
    expect(panel).toContain("onEndReached={handleLoadMore}");
    for (const part of ['router.push("/edit-profile")', "setPhotoOpen(true)", 'memberListRoute("followers"', 'memberListRoute("following"', 'setSegment("vault")', 'setSegment("lifestyle")', 'setSegment("wishlist")', 'testID="pastille-envies"']) {
      expect(profile).toContain(part);
    }
  });

  it("refusé : sous l'en-tête, un message vide ne remonte plus par-dessus les onglets ; permis : centré dans la place qui reste", () => {
    expect(profile).toContain('emptyBelowHeader: { marginTop: 0, paddingVertical: space.xl },');
    expect(profile.match(/<View style=\{\[styles\.empty, styles\.emptyBelowHeader\]\}>/g)).toHaveLength(3);
    expect(profile).not.toMatch(/<View style=\{styles\.empty\}>/);
  });
});
