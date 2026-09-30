import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { StatusBar } from "expo-status-bar";
import { setActiveLocale, setDeviceRegion } from "@/i18n";
import { color, setActiveScheme } from "@/theme/tokens";
import { useAuth } from "@/lib/auth-context";
import { updateMyLocale } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import {
  LOCALE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  detectLocale,
  parseLocale,
  parseThemePreference,
  resolveScheme,
  type Locale,
  type ThemePreference,
} from "@/lib/preferences";

// Langue et apparence de l'app (lot 3). Mémorisées sur l'appareil ; la
// langue est aussi enregistrée dans le profil (profiles.locale) dès qu'un
// compte est connecté — le choix fait sur cet appareil fait foi.
//
// Changer l'une ou l'autre REMONTE l'arbre des écrans (clé ci-dessous) :
// textes et couleurs sont lus au rendu, et le compilateur React garde en
// mémoire les parties qui n'ont pas changé. L'adresse de la page (site) est
// conservée ; la session aussi (AuthProvider est au-dessus).

interface PreferencesValue {
  locale: Locale;
  themePreference: ThemePreference;
  chooseLocale: (locale: Locale, context: "welcome" | "settings") => Promise<void>;
  chooseTheme: (preference: ThemePreference) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

async function readStored(): Promise<{ locale: Locale; theme: ThemePreference }> {
  const [locale, theme] = await Promise.all([
    AsyncStorage.getItem(LOCALE_STORAGE_KEY).catch(() => null),
    AsyncStorage.getItem(THEME_STORAGE_KEY).catch(() => null),
  ]);
  return {
    locale: parseLocale(locale) ?? detectLocale(getLocales().map((entry) => entry.languageCode)),
    theme: parseThemePreference(theme),
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<{ locale: Locale; theme: ThemePreference } | null>(null);
  const system = useColorScheme();
  const { session, profile } = useAuth();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    setDeviceRegion(getLocales()[0]?.regionCode ?? null);
    readStored().then(setStored);
  }, []);

  const locale = stored?.locale ?? null;
  const scheme = resolveScheme(stored?.theme ?? "system", system);
  // Avant le rendu des écrans : ils lisent directement textes et couleurs.
  setActiveScheme(scheme);
  if (locale) setActiveLocale(locale);

  useEffect(() => {
    if (!locale || !session || !profile || profile.locale === locale) return;
    const key = `${profile.id}:${locale}`;
    if (synced.current === key) return;
    synced.current = key;
    // Échec (réseau) : nouvel essai au prochain lancement ou changement ; les
    // messages du serveur suivent de toute façon la langue envoyée par l'app.
    updateMyLocale(locale).catch(() => {
      synced.current = null;
    });
  }, [locale, session, profile]);

  // Même langue pour les e-mails envoyés par Supabase (confirmation, mot de
  // passe oublié) : lue par leurs modèles dans les métadonnées du compte.
  useEffect(() => {
    if (!locale || !session || session.user.user_metadata?.locale === locale) return;
    supabase.auth.updateUser({ data: { locale } }).catch(() => {
      // Sans effet visible : nouvel essai au prochain lancement.
    });
  }, [locale, session]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (locale) document.documentElement.lang = locale;
    document.documentElement.style.colorScheme = scheme;
    document.body.style.backgroundColor = color.porcelaine;
  }, [locale, scheme]);

  if (!stored || !locale) return null;

  async function chooseLocale(next: Locale, context: "welcome" | "settings") {
    setStored((current) => (current ? { ...current, locale: next } : current));
    track("language_changed", { locale: next, context });
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, next).catch(() => {});
  }

  async function chooseTheme(next: ThemePreference) {
    setStored((current) => (current ? { ...current, theme: next } : current));
    track("theme_changed", { theme: next });
    await AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
  }

  return (
    <PreferencesContext.Provider value={{ locale, themePreference: stored.theme, chooseLocale, chooseTheme }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Fragment key={`${scheme}-${locale}`}>{children}</Fragment>
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences doit être utilisé à l'intérieur de PreferencesProvider.");
  return value;
}
