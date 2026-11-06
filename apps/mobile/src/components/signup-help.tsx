import { useEffect } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ErrorMessage } from "@/components/error-message";
import { useResendConfirmation } from "@/lib/use-resend-confirmation";
import type { RobotCheck } from "@/components/robot-check";
import { themedStyles } from "@/theme/themed-styles";

// Inscription et connexion (lot « premier essai ») : renvoyer l'e-mail de
// confirmation, et que faire quand l'adresse a déjà un compte.

/** Confirmation discrète, annoncée aussi sur iPhone (VoiceOver ignore les zones annoncées). */
function StatusLine({ message }: { message: string }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return (
    <Text style={styles.status} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

/** « Renvoyer l'e-mail », avec une minute d'attente entre deux envois. Le
 * décompte reste visuel : le libellé lu par VoiceOver ne change pas chaque
 * seconde, l'attente est dite dans l'indication. */
export function ResendEmailButton({ email, sentAt = null, robot, style }: { email: string; sentAt?: number | null; robot: RobotCheck; style?: StyleProp<ViewStyle> }) {
  const { wait, robotReady, sending, sent, error, resend } = useResendConfirmation(email, sentAt, robot);
  // Anti-robots (point 17) : attend le jeton du widget affiché par l'écran.
  const disabled = sending || wait > 0 || !email.trim() || !robotReady;
  const label = sending ? t.firstTry.signUp.resending : wait > 0 ? t.firstTry.signUp.resendIn(wait) : t.firstTry.signUp.resend;
  return (
    <View style={style}>
      <Pressable
        style={styles.button}
        onPress={resend}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t.firstTry.signUp.resend}
        accessibilityHint={wait > 0 ? label : undefined}
        accessibilityState={{ disabled, busy: sending }}
      >
        <Text style={[styles.buttonLabel, disabled ? styles.buttonLabelDisabled : null]}>{label}</Text>
      </Pressable>
      {sent ? <StatusLine message={t.firstTry.signUp.resent} /> : null}
      {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
    </View>
  );
}

/** L'adresse a déjà un compte : se connecter, ou choisir un nouveau mot de passe. */
export function ExistingAccountNotice({ onSignIn, onForgot, style }: { onSignIn: () => void; onForgot: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.box, style]}>
      <ErrorMessage style={styles.message}>{t.auth.errors.alreadyRegistered}</ErrorMessage>
      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={onSignIn} accessibilityRole="button">
          <Text style={styles.buttonLabel}>{t.auth.signIn.cta}</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onForgot} accessibilityRole="button">
          <Text style={styles.buttonLabel}>{t.auth.signIn.forgot}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md },
  message: { fontSize: font.secondary, lineHeight: 21 },
  actions: { gap: space.sm, marginTop: space.md },
  button: {
    minHeight: 44,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert, textAlign: "center" },
  buttonLabelDisabled: { color: color.acier },
  status: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.sm },
  error: { fontSize: font.caption, marginTop: space.sm },
}));
