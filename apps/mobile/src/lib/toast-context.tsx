import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";

// Petite confirmation flottante pour les actions qui n'ont pas déjà leur
// propre retour visuel (ex. un bouton qui change de libellé). Un seul
// toast affiché à la fois — une nouvelle demande remplace la précédente.
const VISIBLE_DURATION_MS = 2200;
const FADE_IN_MS = 180;
const FADE_OUT_MS = 220;

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (text: string) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setMessage(text);
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() =>
          setMessage(null)
        );
      }, VISIBLE_DURATION_MS);
    },
    [opacity]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
          <Text style={styles.toastText}>{message}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé à l'intérieur de ToastProvider.");
  return ctx;
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: space.xl,
    right: space.xl,
    bottom: 110,
    backgroundColor: color.encre,
    borderRadius: radius.full,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    alignItems: "center",
  },
  toastText: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
});
