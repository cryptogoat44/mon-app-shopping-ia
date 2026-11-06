import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { translateAuthError } from "@/lib/auth-errors";
import { RESEND_COOLDOWN_MS, secondsUntil, serverWaitSeconds } from "@/lib/signup-help";
import { supabase } from "@/lib/supabase";
import { withCaptchaOption } from "@/lib/robot-check";

/** La vérification anti-robots de l'écran (point 17, components/robot-check.tsx). */
type RobotToken = { ready: boolean; take: () => { token: string | null } | null };

type ResendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

/** « Renvoyer l'e-mail » de confirmation (lot « premier essai ») : une minute
 * d'attente entre deux envois. `sentAt` : heure d'un e-mail qui vient de
 * partir (inscription), qui compte dans la première attente. `robot` : la
 * vérification anti-robots de l'écran, dont le jeton part avec l'envoi. */
export function useResendConfirmation(email: string, sentAt: number | null, robot: RobotToken) {
  const [availableAt, setAvailableAt] = useState<number | null>(sentAt === null ? null : sentAt + RESEND_COOLDOWN_MS);
  const [state, setState] = useState<ResendState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const wait = secondsUntil(availableAt, now);
  const waiting = wait > 0;

  // Décompte affiché sur le bouton, à la seconde, seulement pendant l'attente.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function resend() {
    const address = email.trim();
    if (!address || waiting || state.kind === "sending") return;
    const check = robot.take();
    if (!check) return;
    setState({ kind: "sending" });
    try {
      // Type « signup » : renvoie le lien de confirmation de l'inscription
      // (signature de @supabase/auth-js 2.114 : { type, email, options? }).
      const { error } = await supabase.auth.resend(withCaptchaOption({ type: "signup" as const, email: address }, check.token));
      const answeredAt = Date.now();
      setNow(answeredAt);
      if (!error) {
        setAvailableAt(answeredAt + RESEND_COOLDOWN_MS);
        return setState({ kind: "sent" });
      }
      // Trop tôt pour Supabase : le bouton attend ce qu'il demande, sans message d'erreur.
      const serverWait = serverWaitSeconds(error.message);
      if (serverWait !== null) {
        setAvailableAt(answeredAt + serverWait * 1000);
        return setState({ kind: "idle" });
      }
      setState({ kind: "failed", message: translateAuthError(error.message) });
    } catch {
      setState({ kind: "failed", message: t.common.genericError });
    }
  }

  return {
    wait,
    robotReady: robot.ready,
    sending: state.kind === "sending",
    sent: state.kind === "sent",
    error: state.kind === "failed" ? state.message : null,
    resend: () => void resend(),
  };
}
