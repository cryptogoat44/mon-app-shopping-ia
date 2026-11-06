// Événement « ouverture de l'app » (lot « app iPhone prête », point 21) :
// sans lui, on ne sait pas si les gens reviennent. Envoyé comme tous les
// autres (analytics.ts) : seulement avec un compte connecté qui a accepté les
// statistiques d'usage, sans rien d'autre que « launch » ou « resume ».
// - « launch » : une fois par lancement, dès que les statistiques sont actives ;
// - « resume » : retour dans l'app (iPhone : après une autre app ; site :
//   onglet de nouveau visible), si la dernière ouverture comptée date d'au
//   moins 30 minutes — aller voir TikTok et revenir n'est pas une ouverture.
// Logique pure et testée ; imports relatifs (vitest).
import { isAnalyticsActive, track } from "./analytics";

/** Écart minimal entre deux ouvertures comptées (la « session » de PostHog). */
export const RESUME_GAP_MS = 30 * 60_000;

let lastOpenedAt: number | null = null;

/** Compte une ouverture si elle est admise ; rend vrai si l'événement est parti. */
export function trackAppOpened(context: "launch" | "resume", now: number = Date.now()): boolean {
  if (!isAnalyticsActive()) return false;
  if (context === "launch" && lastOpenedAt !== null) return false;
  if (context === "resume" && lastOpenedAt !== null && now - lastOpenedAt < RESUME_GAP_MS) return false;
  lastOpenedAt = now;
  track("app_opened", { context });
  return true;
}

/** Tests uniquement. */
export function __resetAppOpening(): void {
  lastOpenedAt = null;
}
