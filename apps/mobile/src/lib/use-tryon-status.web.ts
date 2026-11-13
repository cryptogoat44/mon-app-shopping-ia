// Essayage virtuel photo (site) : l'état partagé, pour un écran. Demande le
// statut au serveur une fois par compte (rien sans compte connecté) et suit
// ses changements (lib/tryon-status.web.ts). Fichier .web : jamais dans l'app
// iPhone.
import { useEffect, useState } from "react";
import type { TryonStatus } from "@monapp/shared-types";
import { useAuth } from "./auth-context";
import { ensureTryonStatus, onTryonStatus, tryonStatus } from "./tryon-status.web";

export function useTryonStatus(): TryonStatus {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [status, setStatus] = useState<TryonStatus>(tryonStatus);
  useEffect(() => {
    setStatus(tryonStatus());
    return onTryonStatus(setStatus);
  }, []);
  useEffect(() => {
    void ensureTryonStatus(userId);
  }, [userId]);
  return status;
}
