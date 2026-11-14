// Essayage virtuel photo (site) : le consentement du membre, lu sur le serveur
// (GET /api/tryon/consent) même quand l'essayage est éteint, pour que la ligne
// de retrait des Réglages reste là tant qu'un consentement est donné (le
// droit de retrait prime). Relu à chaque affichage et à chaque changement de
// compte ; une réponse partie pour un autre compte est ignorée, rien du
// compte précédent n'est gardé. null : pas (encore) de réponse lisible.
// Fichier .web : jamais dans l'app iPhone.
import { useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { fetchTryonConsent } from "./tryon-api.web";

export function useTryonConsentGiven(): boolean | null {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [given, setGiven] = useState<boolean | null>(null);
  useEffect(() => {
    setGiven(null);
    if (!userId) return;
    let current = true;
    fetchTryonConsent().then(
      (consent) => {
        if (current) setGiven(consent.given);
      },
      // Hors ligne, ancien serveur, réponse illisible : inconnu ; la ligne suit alors le statut.
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [userId]);
  return given;
}
