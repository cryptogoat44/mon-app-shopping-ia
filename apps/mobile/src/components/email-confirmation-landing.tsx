import { useEffect } from "react";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { INITIAL_WEB_URL } from "@/lib/initial-url";
import { parseConfirmationUrl } from "@/lib/email-confirmation";
import { useToast } from "@/lib/toast-context";
import { t } from "@/i18n";

// Site seulement (chantier 3, flux PKCE) : arrivée par le lien de
// confirmation d'un e-mail. Même navigateur que l'inscription : la session
// s'ouvre. Autre appareil : l'adresse est confirmée quand même, on invite à
// se connecter. Le code est retiré de l'adresse affichée. Rien sur iPhone :
// ces liens mènent au site.
export function EmailConfirmationLanding() {
  const { showToast } = useToast();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const link = parseConfirmationUrl(INITIAL_WEB_URL);
    if (link.kind !== "code") return;
    let cancelled = false;
    supabase.auth
      .exchangeCodeForSession(link.code)
      .then(({ error }) => {
        if (error && !cancelled) showToast(t.accountSafety.emailConfirmed, { durationMs: 6000 });
      })
      .catch(() => {
        if (!cancelled) showToast(t.accountSafety.emailConfirmed, { durationMs: 6000 });
      })
      .finally(() => {
        if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  return null;
}
