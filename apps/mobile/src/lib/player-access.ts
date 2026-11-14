// Lecteur intégré (mission « liens vidéo ») : ce que l'app installée permet
// (options du build, lib/features.ts) et l'accord préalable par plateforme
// (CNIL : les lecteurs officiels peuvent déposer leurs propres traceurs).
// La décision complète, avec les interrupteurs du serveur : lib/player-decision.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { features } from "./features";
import { playerPossible } from "./player-decision";
import type { PlayerPlatform } from "./player-link";
import { PLAYER_CONSENT_KEY, parsePlayerConsent, type PlayerConsent } from "./player-state";

/** Lecteur possible dans cette app (pour cette plateforme, ou pour au moins
 * une) : app iPhone, option du build allumée. Le serveur peut encore le
 * couper au moment d'ouvrir une vidéo. Jamais sur le site. */
export function isPlayerAvailable(platform?: PlayerPlatform): boolean {
  return playerPossible(Platform.OS, features, platform);
}

/** Accord préalable au lecteur officiel, par plateforme. Illisible : aucun accord. */
export async function readPlayerConsent(): Promise<PlayerConsent> {
  try {
    return parsePlayerConsent(await AsyncStorage.getItem(PLAYER_CONSENT_KEY));
  } catch {
    return parsePlayerConsent(null);
  }
}

export async function grantPlayerConsent(platform: PlayerPlatform): Promise<void> {
  const consent = await readPlayerConsent();
  try {
    await AsyncStorage.setItem(PLAYER_CONSENT_KEY, JSON.stringify({ ...consent, [platform]: true }));
  } catch {
    // Stockage indisponible : l'accord vaut pour cette fois, la question sera reposée.
  }
}

/** Réglages : accord retiré pour toutes les plateformes. */
export async function withdrawPlayerConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PLAYER_CONSENT_KEY);
  } catch {
    // Stockage indisponible : rien à retirer.
  }
}
