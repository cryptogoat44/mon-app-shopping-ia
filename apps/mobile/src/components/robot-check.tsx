import { useCallback, useReducer, useRef, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { getActiveLocale, t } from "@/i18n";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { RobotCheckFrame } from "@/components/robot-check-frame";
import { INITIAL_ROBOT_CHECK, robotCheckReducer, turnstileSiteKey, type RobotCheckStatus, type RobotMessage } from "@/lib/robot-check";

// Protection anti-robots (point 17) : voir src/lib/robot-check.ts et
// apps/mobile/ANTI-ROBOTS.md. Clé publique lue au build (EXPO_PUBLIC_*).
const SITE_KEY = turnstileSiteKey(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY);

export interface RobotCheck {
  /** Vrai sans protection (clé absente), ou quand un jeton attend. */
  ready: boolean;
  /** Prend le jeton pour UN appel (null sans protection) et redemande aussitôt un nouveau jeton. */
  take: () => string | null;
  /** Le widget à afficher au-dessus du bouton d'envoi ; null sans protection. */
  widget: ReactElement | null;
}

/** Une vérification anti-robots par écran ; le jeton est à usage unique. */
export function useRobotCheck(): RobotCheck {
  const [state, dispatch] = useReducer(robotCheckReducer, INITIAL_ROBOT_CHECK);
  // Jeton lu au moment de l'appel, même si l'écran n'a pas encore été redessiné.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = state.token;
  const generation = state.generation;

  const onMessage = useCallback((message: RobotMessage) => dispatch({ ...message, generation }), [generation]);
  const take = useCallback(() => {
    if (SITE_KEY === null) return null;
    const token = tokenRef.current;
    tokenRef.current = null;
    dispatch({ type: "used" });
    return token;
  }, []);

  if (SITE_KEY === null) return { ready: true, take, widget: null };
  return {
    ready: state.token !== null,
    take,
    widget: (
      <RobotCheckBox status={state.status} onRetry={() => dispatch({ type: "retry" })}>
        <RobotCheckFrame key={generation} siteKey={SITE_KEY} locale={getActiveLocale()} title={t.robotCheck.frameTitle} onMessage={onMessage} />
      </RobotCheckBox>
    ),
  };
}

function RobotCheckBox({ status, onRetry, children }: { status: RobotCheckStatus; onRetry: () => void; children: ReactElement }) {
  return (
    <View style={styles.box}>
      {children}
      {status === "loading" ? (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {t.robotCheck.checking}
        </Text>
      ) : null}
      {status === "error" ? (
        <>
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {t.robotCheck.failed}
          </Text>
          <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.retryLabel}>{t.robotCheck.retry}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { alignItems: "center", marginTop: space.lg, gap: space.xs },
  status: { fontSize: font.caption, color: color.acier, textAlign: "center", lineHeight: 18 },
  retry: { minHeight: 36, paddingHorizontal: space.md, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, justifyContent: "center" },
  retryLabel: { fontSize: font.caption, fontWeight: "600", color: color.vert },
}));
