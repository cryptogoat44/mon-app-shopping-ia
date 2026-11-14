// Interrupteurs des lecteurs TikTok et Instagram, côté serveur (mission
// « liens vidéo », règle 6). Ils ne peuvent que COUPER : un lecteur n'existe
// dans l'app que s'il a été compilé avec elle (options de build
// features.tiktokPlayer et features.instagramPlayer). Coupé ici, l'app
// retombe sur l'écran de secours « Spottez cette vidéo » ; rallumé, elle
// retrouve le lecteur qu'elle avait déjà lors de la validation d'Apple.
// Jamais l'inverse : aucune valeur du serveur ne fait apparaître une fonction
// absente de l'app.
//
// Variables d'environnement (Render) : TIKTOK_PLAYER_ENABLED et
// INSTAGRAM_PLAYER_ENABLED. Allumés par défaut ; seule la valeur exacte
// « false » coupe. Voir docs/liens-video/interrupteurs.md.
import type { VideoPlayersStatus } from "@monapp/shared-types";
import { env } from "../env.js";

/** Les lecteurs que le serveur laisse allumés. */
export function videoPlayers(): VideoPlayersStatus {
  return { tiktok: env.TIKTOK_PLAYER_ENABLED, instagram: env.INSTAGRAM_PLAYER_ENABLED };
}
