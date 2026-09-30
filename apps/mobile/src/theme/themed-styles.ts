import { StyleSheet } from "react-native";
import { getActiveScheme, type ColorScheme } from "./tokens";

// Feuilles de style calculées pour le thème actif (lot 3). Avant, chaque
// écran figeait ses couleurs au chargement (StyleSheet.create au niveau du
// fichier) : impossible de changer de thème. `themedStyles(() => ({ … }))`
// calcule la feuille une fois par thème, à la première utilisation, et
// `styles.xxx` renvoie toujours la version du thème en cours.
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: () => T): T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  const current = (): T => {
    const scheme = getActiveScheme();
    return (cache[scheme] ??= StyleSheet.create(factory()));
  };
  return new Proxy({} as T, {
    get: (_target, key: string) => current()[key as keyof T],
  });
}
