import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@monapp/shared-types";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { fetchMyProfile } from "./api";
import { supabase } from "./supabase";

interface AuthContextValue {
  /** null tant que le premier appel à getSession() n'a pas répondu. */
  session: Session | null | undefined;
  profile: Profile | null;
  /** true pendant le chargement initial de la session ou du profil. */
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Auto-refresh du jeton uniquement quand l'app est au premier plan,
  // recommandation officielle Supabase pour React Native.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => subscription.remove();
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const nextProfile = await fetchMyProfile();
      setProfile(nextProfile);
    } catch (error) {
      console.error("Impossible de charger le profil", error);
      setProfile(null);
    }
  }, []);

  const initialized = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return; // session pas encore résolue

    if (session === null) {
      setProfile(null);
      setLoading(false);
      initialized.current = true;
      return;
    }

    loadProfile().finally(() => {
      setLoading(false);
      initialized.current = true;
    });
  }, [session, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile: loadProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>.");
  return ctx;
}
