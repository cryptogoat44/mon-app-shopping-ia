import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Keyboard, Platform, Text, type KeyboardEvent } from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { TOAST_BOTTOM, toastBottom } from "./toast-placement";

// Petite confirmation flottante pour les actions qui n'ont pas déjà leur
// propre retour visuel (ex. un bouton qui change de libellé). Un seul
// toast affiché à la fois — une nouvelle demande remplace la précédente.
const VISIBLE_DURATION_MS = 2200;
const FADE_IN_MS = 180;
const FADE_OUT_MS = 220;

export interface ToastOptions {
  /** Durée d'affichage d'un message plus long à lire (2,2 s sinon). */
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  // Chaque message a son numéro : sur l'iPhone, sa couche est posée au-dessus
  // de ce qui est ouvert au moment où il s'affiche.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastId = useRef(0);

  const showToast = useCallback(
    (text: string, options?: ToastOptions) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      lastId.current += 1;
      const id = lastId.current;
      setToast({ id, message: text });
      // Les lecteurs d'écran ne voyaient pas passer ces confirmations
      // (audit Lot Q, A11Y-03). Sur le web, la zone annoncée ci-dessous (aria-live)
      // s'en charge.
      if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(text);
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        // Un message arrivé pendant que celui-ci disparaît reste affiché.
        Animated.timing(opacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() =>
          setToast((current) => (current?.id === id ? null : current))
        );
      }, options?.durationMs ?? VISIBLE_DURATION_MS);
    },
    [opacity]
  );
  // Valeur stable : les écrans qui s'en servent ne sont pas redessinés à chaque message.
  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastBubble key={toast.id} message={toast.message} opacity={opacity} /> : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé à l'intérieur de ToastProvider.");
  return ctx;
}

/** Hauteur du clavier de l'iPhone, suivie tant que le message est affiché. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() => (Platform.OS === "ios" ? (Keyboard.metrics()?.height ?? 0) : 0));
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const shown = (event: KeyboardEvent) => setHeight(event.endCoordinates.height);
    const hidden = () => setHeight(0);
    const subscriptions = [
      Keyboard.addListener("keyboardWillShow", shown),
      Keyboard.addListener("keyboardDidShow", shown),
      Keyboard.addListener("keyboardWillHide", hidden),
      Keyboard.addListener("keyboardDidHide", hidden),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return height;
}

/** Le message. Sur l'iPhone, dans une couche au-dessus de toute l'app : une
 * feuille ouverte par-dessus les écrans (« Nouvelle publication », ajout au
 * Vault) le cachait, comme le clavier, au-dessus duquel il se place. VoiceOver
 * le lit par l'annonce : la couche ne le retient pas, et le message n'y est
 * pas lu une seconde fois. */
function ToastBubble({ message, opacity }: { message: string; opacity: Animated.Value }) {
  const keyboardHeight = useKeyboardHeight();
  const ios = Platform.OS === "ios";
  const bubble = (
    <Animated.View pointerEvents="none" accessibilityElementsHidden={ios} style={[styles.toast, { opacity, bottom: toastBottom(keyboardHeight) }]}>
      <Text style={styles.toastText} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </Animated.View>
  );
  if (!ios) return bubble;
  return <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{bubble}</FullWindowOverlay>;
}

const styles = themedStyles(() => ({
  toast: {
    position: "absolute",
    left: space.xl,
    right: space.xl,
    bottom: TOAST_BOTTOM,
    backgroundColor: color.encre,
    borderRadius: radius.full,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    alignItems: "center",
  },
  toastText: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
}));
