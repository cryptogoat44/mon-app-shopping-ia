import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/tabs";
import { color, radius } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { isSlide, slideTarget, tabIndexAt } from "@/lib/tab-bar-gesture";
import { useReduceMotion } from "@/lib/use-reduce-motion";

// Barre d'onglets maison (retours du build 2, point 8 : « comme sur
// Instagram… on peut laisser son doigt et ça glisse d'un onglet à un
// autre »). Mêmes cinq places, icônes, pastilles et « + » rond que la barre
// d'expo-router, lus dans les options des écrans ((tabs)/_layout.tsx).
// - Toucher un onglet : comme avant (l'événement tabPress part, le « + »
//   l'intercepte et ouvre la publication).
// - Poser le doigt et glisser de côté (TAP_SLOP points ou plus) : une
//   pastille douce suit le doigt, une légère vibration à chaque nouvel
//   onglet (iPhone seulement) ; lever le doigt ouvre l'onglet dessous.
//   Le glissé saute le « + » : il ne s'ouvre qu'au toucher.
// Seulement PanResponder et Animated de React Native (ni gesture-handler,
// ni reanimated, ni pager : aucun n'est initialisé dans l'app). Avec
// « Réduire les animations », la pastille saute d'un onglet à l'autre sans
// glisser. VoiceOver : chaque bouton garde le rôle « onglet », son état
// et son libellé ; le double-toucher l'ouvre, le glissé n'est qu'un plus.

// Sur le téléphone, mêmes mesures que la barre d'expo-router (49 points de
// haut plus la zone du bas, icône 25 dans un cadre de 31 × 28).
const BAR_HEIGHT = 49;
const ICON_SIZE = 25;
const useNativeDriver = Platform.OS !== "web";

type Measure = { x: number; width: number };

export function TabBar({ state, descriptors, navigation, insets, tapOnlyRoutes }: BottomTabBarProps & { tapOnlyRoutes: readonly string[] }) {
  const reduceMotion = useReduceMotion();
  const routes = state.routes;
  const count = routes.length;
  // Les places qui ne s'ouvrent qu'au toucher, jamais au glissé (le « + » de la publication).
  const tapOnly = new Set(routes.flatMap((route, index) => (tapOnlyRoutes.includes(route.name) ? [index] : [])));

  const rowRef = useRef<View>(null);
  const measure = useRef<Measure>({ x: 0, width: 0 });
  const [rowWidth, setRowWidth] = useState(0);
  const pillX = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  // Onglet sous le doigt pendant un glissé (null : pas de glissé en cours).
  const hovered = useRef<number | null>(null);

  // Le PanResponder est créé une fois : il lit l'état du moment ici.
  const latest = useRef({ state, navigation, count, tapOnly, reduceMotion });
  latest.current = { state, navigation, count, tapOnly, reduceMotion };

  function remeasure() {
    rowRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) measure.current = { x, width };
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

  function finish(open: boolean) {
    const index = hovered.current;
    hovered.current = null;
    if (latest.current.reduceMotion) pillOpacity.setValue(0);
    else Animated.timing(pillOpacity, { toValue: 0, duration: 160, useNativeDriver }).start();
    if (!open || index === null) return;
    const target = slideTarget(index, latest.current.tapOnly);
    if (target !== null && target !== latest.current.state.index) openTab(target);
  }

  const responder = useRef(
    PanResponder.create({
      // Un toucher reste aux boutons ; seul un déplacement de côté prend la main.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_event, gesture) => isSlide(gesture.dx),
      onMoveShouldSetPanResponder: (_event, gesture) => isSlide(gesture.dx),
      onPanResponderGrant: (_event, gesture) => {
        remeasure();
        follow(gesture.moveX || gesture.x0);
      },
      onPanResponderMove: (_event, gesture) => follow(gesture.moveX),
      onPanResponderRelease: () => finish(true),
      onPanResponderTerminate: () => finish(false),
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // Changement d'écran par ailleurs (lien, notification) pendant un glissé : rien ne reste affiché.
  useEffect(() => {
    if (hovered.current === null) pillOpacity.setValue(0);
  }, [state.index, pillOpacity]);

  const focusedOptions = descriptors[routes[state.index]?.key ?? ""]?.options ?? {};
  const pillWidth = rowWidth / Math.max(1, count);

  return (
    // Animated.View : tabBarStyle peut porter des valeurs animées.
    <Animated.View
      style={[
        styles.bar,
        { height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom, paddingHorizontal: Math.max(insets.left, insets.right) },
        // Les réglages de (tabs)/_layout.tsx : couleurs, et sur le site 62 de haut et 8 en bas.
        focusedOptions.tabBarStyle,
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
          const title = typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
          const label =
            typeof options.tabBarLabel === "function" ? (
              options.tabBarLabel({ focused, color: tint, position: "below-icon", children: title })
            ) : (
              // iPhone : comme la barre d'origine, le libellé ne grossit pas ; un appui
              // long avec le grand texte montre la loupe d'iOS (large content viewer).
              <Text style={[styles.label, { color: tint }, options.tabBarLabelStyle]} numberOfLines={1} selectable={false} allowFontScaling={Platform.OS === "ios" ? false : undefined}>
                {title}
              </Text>
            );
          return (
            <Pressable
              key={route.key}
              style={styles.item}
              onPress={() => openTab(index)}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
              accessibilityRole="tab"
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
              {label}
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = themedStyles(() => ({
  bar: { backgroundColor: color.porcelaine, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.filet },
  row: { flex: 1, flexDirection: "row" },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-start", padding: 5 },
  icon: { width: 31, height: 28, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 10, textAlign: "center" },
  badge: { position: "absolute", end: -3, top: -3, width: 9, height: 9, borderRadius: radius.full },
  // La pastille qui suit le doigt : un vert très léger derrière l'icône et le libellé.
  pillTrack: { position: "absolute", top: 2, bottom: 2, left: 0, paddingHorizontal: 6 },
  pill: { flex: 1, borderRadius: radius.lg, backgroundColor: color.vert, opacity: 0.18 },
}));
