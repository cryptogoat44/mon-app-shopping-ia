import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY doivent être définies (voir apps/mobile/.env.example)."
  );
}

// Expo Router effectue un premier rendu côté serveur (Node) même en mode web
// dev — `window` n'y existe pas encore, donc AsyncStorage (qui vise le
// navigateur sur cette plateforme) plante si on l'appelle à ce stade. On lui
// substitue un stockage inerte pendant cette passe ; côté natif (iOS/Android),
// `window` existe toujours et AsyncStorage est utilisé normalement.
const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof window === "undefined" ? noopStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Chantier 3 (point 13) : flux PKCE. Les liens des e-mails (mot de passe
    // oublié, confirmation) ne portent plus la session elle-même, mais un
    // code que seul l'appareil qui a fait la demande peut échanger (il garde
    // la clé de l'échange dans son stockage). Une autre app de l'iPhone qui
    // déclarerait aussi « spotto:// » ne pourrait rien en faire.
    flowType: "pkce",
  },
});
