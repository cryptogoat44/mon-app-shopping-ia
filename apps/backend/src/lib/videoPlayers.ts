// Interrupteurs des lecteurs TikTok et Instagram, côté serveur (mission
// « liens vidéo », règle 6). Ils ne peuvent que COUPER : un lecteur n'existe
// dans l'app que s'il a été compilé avec elle (options de build
// features.tiktokPlayer et features.instagramPlayer). Coupé ici, l'app
// passe à la recherche automatique si VIDEO_LINK_ANALYSIS_ENABLED est allumée
// et prête, sinon à l'écran de secours « Spottez cette vidéo » ; rallumé, elle
// retrouve le lecteur qu'elle avait déjà lors de la validation d'Apple.
// Jamais l'inverse : aucune valeur du serveur ne fait apparaître une fonction
// absente de l'app.
//
// Variables d'environnement (Render) : TIKTOK_PLAYER_ENABLED et
// INSTAGRAM_PLAYER_ENABLED. Allumés par défaut ; seule la valeur exacte
// « false » coupe. Voir apps/mobile/BUILD-IPHONE.md (« La vidéo d'abord »).
import type { VideoPlayersStatus } from "@monapp/shared-types";
import { env } from "../env.js";

/** Les lecteurs que le serveur laisse allumés. */
export function videoPlayers(): VideoPlayersStatus {
  return { tiktok: env.TIKTOK_PLAYER_ENABLED, instagram: env.INSTAGRAM_PLAYER_ENABLED };
}
