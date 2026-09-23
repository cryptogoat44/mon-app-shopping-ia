import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@monapp/shared-types";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, fetchMyProfile } from "./api";
import { PROFILE_RETRY_DELAYS_MS, RetryCancelledError, retryWithDelays } from "./retry";
import type { ProfileStatus } from "./root-route";
import { supabase } from "./supabase";

interface AuthContextValue {
  /** undefined tant que le premier appel à getSession() n'a pas répondu. */
  session: Session | null | undefined;
  profile: Profile | null;
  profileStatus: ProfileStatus;
  /** Recharge le profil déjà affiché (après une modification). En cas
   * d'échec, le profil actuel est conservé : un simple rafraîchissement
   * raté ne doit jamais déconnecter l'app de son profil. */
  refreshProfile: () => Promise<void>;
  /** Relance le chargement complet (bouton "Réessayer" de l'écran de connexion au serveur). */
  retryProfile: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Une session refusée par le serveur (jeton expiré ou compte supprimé) ne
// se réparera pas en réessayant : on déconnecte proprement.
function isAuthRejected(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");
  // Chaque chargement reçoit un numéro : un chargement plus ancien (session
  // changée, "Réessayer" appuyé entre-temps) n'a plus le droit d'écrire.
  const loadRunRef = useRef(0);

  // Auto-refresh du jeton uniquement quand l'app est au premier plan,
  // recommandation officielle Supabase pour React Native.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // `initialStatus` : "loading" au démarrage ou à la connexion (l'écran de
  // démarrage couvre le premier essai) ; "retrying" quand la personne
  // appuie sur "Réessayer" (l'écran de connexion reste affiché, jamais un
  // écran vide).
  const loadProfile = useCallback(async (initialStatus: "loading" | "retrying" = "loading") => {
    const runId = ++loadRunRef.current;
    const isStale = () => runId !== loadRunRef.current;

    setProfileStatus(initialStatus);
    try {
      const nextProfile = await retryWithDelays(fetchMyProfile, {
        delaysMs: PROFILE_RETRY_DELAYS_MS,
        shouldRetry: (error) => !isAuthRejected(error),
        onRetry: () => {
          if (!isStale()) setProfileStatus("retrying");
        },
        isCancelled: isStale,
      });
      if (isStale()) return;
      setProfile(nextProfile);
      setProfileStatus("ready");
    } catch (error) {
      if (isStale() || error instanceof RetryCancelledError) return;
      if (isAuthRejected(error)) {
        await supabase.auth.signOut();
        return;
      }
      console.error("Impossible de charger le profil", error);
      setProfileStatus("failed");
    }
  }, []);

  // Dépend de l'identifiant de l'utilisateur, pas de l'objet session : le
  // renouvellement automatique du jeton (toutes les heures) remplace
  // l'objet sans changer d'utilisateur, et ne doit pas recharger le profil.
  const userId = session?.user.id;
  const sessionResolved = session !== undefined;
  useEffect(() => {
    if (!sessionResolved) return;

    if (!userId) {
      loadRunRef.current++;
      setProfile(null);
      setProfileStatus("idle");
      return;
    }

    loadProfile();
  }, [userId, sessionResolved, loadProfile]);

  const refreshProfile = useCallback(async () => {
    try {
      const nextProfile = await fetchMyProfile();
      setProfile(nextProfile);
      setProfileStatus("ready");
    } catch (error) {
      console.error("Impossible de rafraîchir le profil", error);
    }
  }, []);

  const retryProfile = useCallback(() => {
    loadProfile("retrying");
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, profile, profileStatus, refreshProfile, retryProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>.");
  return ctx;
}
