// « Envoyer à un ami » depuis l'écran Résultat : une proposition d'une de vos
// recherches part dans une conversation privée, sans être gardée dans vos
// Envies. Le serveur en fait la carte (copie de l'image, lien vérifié) au
// moment de l'envoi (POST /api/messages, `matchId`). Logique sans écran,
// testée à part (tests/send-to-friend.test.ts). Imports relatifs : fichier
// testé par vitest.
import type { MessagesStatus } from "@monapp/shared-types";
import type { Piece } from "../api/types";
import { pieceTitle } from "./spot-result";

/** D'où la proposition part (statistiques, liste fermée). */
export const SEND_TO_FRIEND_FROM = ["big_card", "section", "price_list"] as const;
export type SendToFriendFrom = (typeof SEND_TO_FRIEND_FROM)[number];

/** L'action « Envoyer à un ami » d'une carte, ou rien. */
export type SendAction = (piece: Piece) => (() => void) | undefined;

/** L'action n'apparaît qu'avec la messagerie disponible sur le serveur, et
 * pour une vraie proposition d'une recherche (jamais une pièce de démonstration). */
export function canSendToFriend(piece: Pick<Piece, "real">, status: Pick<MessagesStatus, "enabled">): boolean {
  return status.enabled && piece.real === true;
}

/** Ce que l'écran de la conversation montre de la pièce jointe, et d'où elle
 * part. Gardé en mémoire, jamais dans l'adresse de l'écran : le titre dirait
 * ce que la personne cherche. */
export interface PieceToSend {
  matchId: string;
  title: string;
  imageUrl: string;
  from: SendToFriendFrom;
}

let pending: PieceToSend | null = null;

/** Retient la pièce de CETTE carte et renvoie l'écran à ouvrir : le choix
 * d'une conversation, avec la proposition (son identifiant seulement). */
export function sendToFriend(piece: Pick<Piece, "id" | "name" | "imageUrl">, from: SendToFriendFrom) {
  pending = { matchId: piece.id, title: pieceTitle(piece.name), imageUrl: piece.imageUrl, from };
  return { pathname: "/choisir-conversation", params: { matchId: piece.id } } as const;
}

/** La pièce retenue pour cette proposition, ou null (page rechargée sur le site). */
export function pieceToSend(matchId: string): PieceToSend | null {
  return pending?.matchId === matchId ? pending : null;
}

/** Une fois la pièce envoyée. */
export function forgetPieceToSend(): void {
  pending = null;
}
