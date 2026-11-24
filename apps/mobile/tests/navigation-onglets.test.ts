import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSlide, slideTarget, TAP_SLOP, tabIndexAt } from "../src/lib/tab-bar-gesture";

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
    expect(isSlide(0)).toBe(false);
    expect(isSlide(9.5)).toBe(false);
    expect(isSlide(-9)).toBe(false);
    expect(isSlide(10)).toBe(true);
    expect(isSlide(-24)).toBe(true);
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
    expect(bar).toContain("onMoveShouldSetPanResponderCapture: (_event, gesture) => isSlide(gesture.dx)");
  });

  it("VoiceOver : rôle onglet, état choisi et libellés d'avant (dont « Activité, N non lus ») sur chaque bouton", () => {
    expect(bar).toContain('accessibilityRole="tab"');
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

  it("site : la hauteur et la marge du bas d'avant sont gardées (réglage de l'écran appliqué à la barre)", () => {
    expect(layout).toContain('...(Platform.OS === "web" ? { height: 62, paddingBottom: 8 } : null),');
    expect(bar).toContain("focusedOptions.tabBarStyle,");
  });
});

describe("le profil défile en entier (son propre profil)", () => {
  const fixedPart = profile.slice(profile.indexOf("<SafeAreaView style={styles.screen}>"), profile.indexOf("{loading ? ("));

  it("refusé : la photo, les compteurs et les onglets ne restent plus fixes ; permis : la barre du haut (@pseudo, réglages) reste", () => {
    expect(fixedPart).toContain("<View style={styles.nav}>");
    expect(fixedPart).toContain('router.push("/settings")');
    for (const part of ["styles.head", "styles.stats", "styles.seg", "<Avatar"]) expect(fixedPart).not.toContain(part);
  });

  it("l'en-tête est en tête du contenu de chaque onglet, chargement compris", () => {
    expect(profile).toContain("const profileHeader = (inset: boolean) => (");
    // Chargement, Envies, Vault, Lifestyle.
    expect(profile.match(/profileHeader\(/g)).toHaveLength(4);
    expect(profile).toContain("<WishlistPanel news={news} header={profileHeader(false)} />");
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
