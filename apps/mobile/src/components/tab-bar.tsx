import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/tabs";
import { color, getActiveScheme, radius } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { isSlide, liftedAbove, slideTarget, tabIndexAt } from "@/lib/tab-bar-gesture";
import { FLOATING_BAR, barBottom, barFrame } from "@/lib/tab-bar-metrics";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { useReduceTransparency } from "@/lib/use-reduce-transparency";

// Barre d'onglets maison (retours du build 2, point 8 : « comme sur
// Instagram… on peut laisser son doigt et ça glisse d'un onglet à un
// autre »). Mêmes cinq places, icônes, pastilles et « + » rond que la barre
// d'expo-router, lus dans les options des écrans ((tabs)/_layout.tsx).
// - Toucher un onglet : comme avant (l'événement tabPress part, le « + »
//   l'intercepte et ouvre la publication).
// - Poser le doigt et glisser de côté (TAP_SLOP points ou plus) : la
//   pastille suit le doigt, une légère vibration à chaque nouvel onglet
//   (iPhone seulement) ; lever le doigt ouvre l'onglet dessous.
//   Le glissé saute le « + » : il ne s'ouvre qu'au toucher.
// Seulement PanResponder et Animated de React Native (ni gesture-handler,
// ni reanimated, ni pager : aucun n'est initialisé dans l'app). Avec
// « Réduire les animations », la pastille saute d'un onglet à l'autre sans
// glisser. VoiceOver : chaque bouton garde le rôle d'avant (« bouton » sur
// iPhone, comme la barre d'expo-router, « onglet » ailleurs), son état et
// son libellé ; le double-toucher l'ouvre, le glissé n'est qu'un plus.
//
// Retours du build 3, point 5 (« quelque chose comme Instagram… légèrement
// transparent mais très très légèrement et pas collé aux bords de
// l'iPhone ») : une pilule qui flotte au-dessus du contenu, détachée des
// bords (mesures dans lib/tab-bar-metrics.ts), fond à 94 % (plein avec
// « Réduire la transparence »), icônes seules (le nom de l'onglet reste pour
// VoiceOver et pour la loupe d'iOS du grand texte), et une pastille
// discrète, toujours là, derrière l'onglet ouvert. Aucune vue pleine
// largeur : à côté de la pilule, c'est le contenu qui reçoit le toucher.
// Les listes des onglets gardent la place qu'il faut en bas (lib/use-tab-bar-space.ts).

// Icône 25 dans un cadre de 31 × 28 (mêmes mesures que la barre d'expo-router).
const ICON_SIZE = 25;
const useNativeDriver = Platform.OS !== "web";

type Measure = { x: number; y: number; width: number };

export function TabBar({ state, descriptors, navigation, insets, tapOnlyRoutes }: BottomTabBarProps & { tapOnlyRoutes: readonly string[] }) {
  const reduceMotion = useReduceMotion();
  const reduceTransparency = useReduceTransparency();
  const window = useWindowDimensions();
  const routes = state.routes;
  const count = routes.length;
  // Les places qui ne s'ouvrent qu'au toucher, jamais au glissé (le « + » de la publication).
  const tapOnly = new Set(routes.flatMap((route, index) => (tapOnlyRoutes.includes(route.name) ? [index] : [])));

  const rowRef = useRef<View>(null);
  const measure = useRef<Measure>({ x: 0, y: 0, width: 0 });
  const [rowWidth, setRowWidth] = useState(0);
  const pillX = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  // La pastille a-t-elle déjà été posée une première fois (sans glisser depuis le bord) ?
  const pillPlaced = useRef(false);
  // Onglet sous le doigt pendant un glissé (null : pas de glissé en cours).
  const hovered = useRef<number | null>(null);
  // Site : le clic du navigateur arrive aussi après un glissé à la souris ;
  // jusqu'à cette heure, un appui sur un bouton est la fin d'un glissé et n'ouvre rien.
  const slidUntil = useRef(0);

  // Le PanResponder est créé une fois : il lit l'état du moment ici.
  const latest = useRef({ state, navigation, count, tapOnly, reduceMotion });
  latest.current = { state, navigation, count, tapOnly, reduceMotion };

  function remeasure() {
    rowRef.current?.measureInWindow((x, y, width) => {
      if (width > 0) measure.current = { x, y, width };
    });
  }

  function onRowLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    measure.current = { ...measure.current, width };
    setRowWidth(width);
    remeasure();
  }

  function openTab(index: number) {
    const { state: current, navigation: nav } = latest.current;
    const route = current.routes[index];
    if (!route) return;
    const focused = index === current.index;
    const event = nav.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) nav.navigate(route.name, route.params);
  }

  function showPill(index: number) {
    const { count: n, tapOnly: skip, reduceMotion: still } = latest.current;
    const width = measure.current.width / Math.max(1, n);
    const x = index * width;
    // Sur le « + », la pastille s'efface : lever le doigt là n'ouvre rien.
    const opacity = skip.has(index) ? 0 : 1;
    if (still) {
      pillX.setValue(x);
      pillOpacity.setValue(opacity);
      return;
    }
    Animated.parallel([
      Animated.spring(pillX, { toValue: x, useNativeDriver, speed: 28, bounciness: 4 }),
      Animated.timing(pillOpacity, { toValue: opacity, duration: 120, useNativeDriver }),
    ]).start();
  }

  function follow(pageX: number) {
    const { count: n, tapOnly: skip } = latest.current;
    const index = tabIndexAt(pageX - measure.current.x, measure.current.width, n);
    if (index === hovered.current) return;
    const first = hovered.current === null;
    hovered.current = index;
    if (first) pillX.setValue(index * (measure.current.width / Math.max(1, n)));
    showPill(index);
    // Une légère vibration à chaque nouvel onglet (jamais sur le « + » ni sur le site).
    if (!first && !skip.has(index) && Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
  }

  function finish(open: boolean, releaseY?: number) {
    const index = hovered.current;
    hovered.current = null;
    slidUntil.current = Date.now() + 300;
    // Retours du build 3 : la pastille ne s'efface plus, elle revient derrière l'onglet ouvert
    // (puis suit le nouvel onglet s'il s'ouvre, voir plus bas).
    showPill(latest.current.state.index);
    if (!open || index === null) return;
    // Doigt levé bien au-dessus de la barre, dans le contenu : rien ne s'ouvre.
    if (releaseY !== undefined && liftedAbove(releaseY, measure.current.y)) return;
    const target = slideTarget(index, latest.current.tapOnly);
    if (target !== null && target !== latest.current.state.index) openTab(target);
  }

  const responder = useRef(
    PanResponder.create({
      // Un toucher reste aux boutons ; seul un déplacement de côté prend la main.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_event, gesture) => isSlide(gesture.dx, gesture.dy),
      onMoveShouldSetPanResponder: (_event, gesture) => isSlide(gesture.dx, gesture.dy),
      onPanResponderGrant: (_event, gesture) => {
        slidUntil.current = Number.MAX_SAFE_INTEGER;
        remeasure();
        follow(gesture.moveX || gesture.x0);
      },
      onPanResponderMove: (_event, gesture) => follow(gesture.moveX),
      onPanResponderRelease: (_event, gesture) => finish(true, gesture.moveY),
      onPanResponderTerminate: () => finish(false),
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // La pastille permanente : derrière l'onglet ouvert, hors glissé. Posée d'un coup la
  // première fois (et quand la pilule change de largeur), puis elle suit l'onglet ouvert
  // (ressort, ou saut avec « Réduire les animations ») ; jamais sur le « + ».
  useEffect(() => {
    if (rowWidth <= 0 || hovered.current !== null) return;
    if (!pillPlaced.current) {
      pillPlaced.current = true;
      pillX.setValue(state.index * (rowWidth / Math.max(1, count)));
      pillOpacity.setValue(tapOnly.has(state.index) ? 0 : 1);
      return;
    }
    showPill(state.index);
    // showPill et tapOnly sont relus à chaque rendu (latest) ; seuls l'onglet ouvert et la largeur comptent ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, rowWidth, count, pillX, pillOpacity]);

  const pillWidth = rowWidth / Math.max(1, count);
  const frame = barFrame(window.width, Math.max(insets.left, insets.right));

  return (
    <View
      style={[
        styles.bar,
        reduceTransparency ? styles.barSolid : null,
        {
          bottom: barBottom(insets.bottom),
          height: Platform.OS === "web" ? FLOATING_BAR.webHeight : FLOATING_BAR.height,
          left: frame.left,
          width: frame.width,
        },
      ]}
    >
      <View ref={rowRef} style={styles.row} onLayout={onRowLayout} accessibilityRole="tablist" {...responder.panHandlers}>
        {rowWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.pillTrack, { width: pillWidth, opacity: pillOpacity, transform: [{ translateX: pillX }] }]}
          >
            <View style={styles.pill} />
          </Animated.View>
        ) : null}
        {routes.map((route, index) => {
          const options = descriptors[route.key]?.options ?? {};
          const focused = index === state.index;
          const tint = String(focused ? (options.tabBarActiveTintColor ?? color.encre) : (options.tabBarInactiveTintColor ?? color.acier));
          // Plus de libellé affiché (icônes seules) : le nom de l'onglet sert à VoiceOver
          // (tabBarAccessibilityLabel) et à la loupe d'iOS du grand texte (appui long).
          const title = typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
          return (
            <Pressable
              key={route.key}
              style={styles.item}
              onPress={() => {
                if (Date.now() < slidUntil.current) return;
                openTab(index);
              }}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
              accessibilityRole={Platform.OS === "ios" ? "button" : "tab"}
              accessibilityState={{ selected: focused }}
              aria-selected={focused}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              accessibilityLargeContentTitle={title}
              accessibilityShowsLargeContentViewer
              testID={options.tabBarButtonTestID}
            >
              <View style={styles.icon}>
                {options.tabBarIcon?.({ focused, color: tint, size: ICON_SIZE })}
                {/* Pastille ronde, sans chiffre (Spotter qui attend un partage, Activité). */}
                {options.tabBarBadge !== undefined ? <View style={[styles.badge, options.tabBarBadgeStyle as StyleProp<ViewStyle>]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  // La pilule : position absolue (left, width, bottom et hauteur calculés au rendu), bouts
  // entièrement arrondis, filet fin tout autour, fond très légèrement translucide (jeton `barre`).
  // Ombre douce en clair seulement (en sombre elle ne se verrait pas : le filet suffit). Rien
  // n'est coupé au bord (iOS couperait aussi l'ombre) : la pastille reste à l'intérieur.
  bar: {
    position: "absolute",
    flexDirection: "row",
    paddingHorizontal: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.filet,
    backgroundColor: color.barre,
    ...(getActiveScheme() === "light"
      ? { shadowColor: color.encre, shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }
      : null),
  },
  // « Réduire la transparence » (iPhone) : la pilule devient pleine.
  barSolid: { backgroundColor: color.surface },
  row: { flex: 1, flexDirection: "row" },
  // Toute la hauteur de la pilule (60) et au moins 57 de large : bien plus que 44 × 44.
  item: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Au moins 31 × 28 ; le disque du « + » (46) y tient sans être coupé.
  icon: { minWidth: 31, minHeight: 28, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", end: -3, top: -3, width: 9, height: 9, borderRadius: radius.full },
  // La pastille de l'onglet ouvert (56 × 44, maquettes « Écrin ») : toujours là hors glissé,
  // elle suit le doigt pendant le glissé. Couleur du filet : discrète dans les deux thèmes.
  pillTrack: { position: "absolute", top: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  pill: { width: 56, maxWidth: "100%", height: 44, borderRadius: radius.full, backgroundColor: color.filet },
}));
