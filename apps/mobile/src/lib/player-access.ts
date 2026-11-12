// Lecteur intégré (lot « lecteur intégré ») : ce qui reste dans l'app sans la
// capture — quelles plateformes s'ouvrent dans le lecteur, et l'accord
// préalable par plateforme. Un seul fichier pour l'app iPhone et pour le site.
//
// Lot « nettoyage avant le premier build » (2026-11-10) : le module natif qui
// prenait l'image affichée par le lecteur (apps/mobile/modules/
// spotto-frame-capture, en Swift) et son pont (lib/player-capture.ts) ont été
// RETIRÉS de l'app. Aucune plateforme n'a autorisé cet usage par écrit, et une
// fonction dormante ne part pas chez Apple (règles App Store 2.5.19 et 5.2.3).
// Sans ce module, le lecteur n'est proposé nulle part, même si
// LINK_PLAYER_ENABLED passait à true : il faut les deux. Le retour se fait en
// annulant (git revert) le commit de ce lot, une fois l'accord écrit d'une
// plateforme reçu — jamais en remettant seulement la constante à true.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { enabledPlayerPlatforms, playerAllowed, type PlayerPlatform } from "./player-link";
import { PLAYER_CONSENT_KEY, parsePlayerConsent, type PlayerConsent } from "./player-state";
import { LINK_PLAYER_ENABLED, PLAYER_INSTAGRAM_ENABLED, PLAYER_TIKTOK_ENABLED } from "./spot-flags";

/** Le module de capture n'est plus dans l'app (voir l'en-tête) : constante
 * figée dans le code, jamais un réglage à distance (règle App Store 2.5.19). */
export const PLAYER_CAPTURE_IN_BUILD = false;

/** Plateformes ouvertes dans le lecteur intégré : aucune tant que le module de capture est hors de l'app, ni sur le site, ni quand LINK_PLAYER_ENABLED est coupé. */
export function playerPlatforms(): PlayerPlatform[] {
  return enabledPlayerPlatforms(playerAllowed(Platform.OS, LINK_PLAYER_ENABLED, PLAYER_CAPTURE_IN_BUILD), {
    tiktok: PLAYER_TIKTOK_ENABLED,
    instagram: PLAYER_INSTAGRAM_ENABLED,
  });
}

/** Lecteur proposé (pour cette plateforme, ou pour au moins une). */
export function isPlayerAvailable(platform?: PlayerPlatform): boolean {
  const platforms = playerPlatforms();
  return platform ? platforms.includes(platform) : platforms.length > 0;
}

/** Accord préalable au lecteur officiel, par plateforme (contre-expertise n° 5). */
export async function readPlayerConsent(): Promise<PlayerConsent> {
  return parsePlayerConsent(await AsyncStorage.getItem(PLAYER_CONSENT_KEY).catch(() => null));
}

export async function grantPlayerConsent(platform: PlayerPlatform): Promise<void> {
  const consent = await readPlayerConsent();
  await AsyncStorage.setItem(PLAYER_CONSENT_KEY, JSON.stringify({ ...consent, [platform]: true })).catch(() => {});
}

/** Réglages : accord retiré pour toutes les plateformes. */
export async function withdrawPlayerConsent(): Promise<void> {
  await AsyncStorage.removeItem(PLAYER_CONSENT_KEY).catch(() => {});
}
