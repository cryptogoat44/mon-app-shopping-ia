import type { ComplementStatus, MatchFeedbackReason, MatchOrigin, TextSearchStatus } from "@monapp/shared-types";
import type { CapacityFailReason } from "../lib/spot-capacity";

export interface Piece {
  id: string;
  name: string;
  reference: string | null;
  material: string | null;
  imageUrl: string;
  /** Image originale du marchand (haute définition) quand elle existe ;
   * à afficher en priorité, avec repli sur `imageUrl`. */
  imageHdUrl?: string | null;
  priceFrom: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string | null;
  /** Lien à ouvrir au clic (affilié si connu, sinon identique à
   * merchantUrl) — déjà résolu par le backend, aucun appel réseau
   * supplémentaire n'est nécessaire pour l'ouvrir. */
  affiliateUrl: string | null;
  /** true seulement pour une pièce issue d'une vraie recherche IA (id =
   * l'id réel d'un product_match côté serveur) — permet de distinguer
   * une pièce réelle d'une pièce de démonstration (catalogue mock). */
  real?: boolean;
  /** Motif choisi si la personne a signalé cette proposition comme
   * incohérente (résultats d'une recherche seulement), sinon null. */
  feedbackReason?: MatchFeedbackReason | null;
  /** Voie C (lot c) : d'où vient la proposition (résultats d'une recherche
   * seulement). Absente = « lens », la recherche visuelle. */
  origin?: MatchOrigin;
}

export type SpotStatus = "success" | "failed";

/** "no_match" : l'analyse a eu lieu mais n'a rien trouvé (proposer de
 * recadrer). "technical" : panne réseau ou du service (proposer de
 * réessayer). "needs_photo" : aucune image exploitable, il faut importer une
 * capture. "rate_limited" : trop d'identifications en peu de temps (429).
 * "capacity_day", "capacity_month", "capacity_user" : plafond des recherches
 * atteint — du jour ou du mois pour tout le service, ou part de la
 * personne pour la journée (429, lot 4 quater). "running" : recherche relue
 * encore en cours côté serveur, jamais « rien trouvé » (lot recherche coupée).
 * "paused" : recherche en pause, le fournisseur est en panne (disjoncteur,
 * 503 « search_paused », lot garde-fous) ; rien n'a été compté. */
export type SpotFailReason = "no_match" | "technical" | "needs_photo" | "rate_limited" | "running" | "paused" | CapacityFailReason;

export interface SpotResult {
  /** Identifiant de la recherche côté serveur — null si elle n'a pas pu
   * être créée (limite atteinte, réseau...). Permet à l'écran Résultat de
   * la relire après un rechargement de page. */
  searchId: string | null;
  /** Texte « Que cherchez-vous ? » utilisé, s'il y en avait un. */
  query?: string | null;
  /** Lien d'origine de la recherche (null pour une photo importée) — permet
   * de recadrer un résultat rouvert depuis « Récemment spottées ». */
  sourceUrl?: string | null;
  status: SpotStatus;
  /** Une entrée par pièce détectée dans l'image. Vide si status === "failed". */
  pieces: Piece[];
  similarPieces: Piece[];
  failReason?: SpotFailReason;
  /** Plafond du mois atteint : jour de la reprise (« AAAA-MM-JJ »). */
  resumesOn?: string | null;
  /** Propositions remontées selon les mots tapés sous la photo (petit lot 2). */
  sortedByWords?: boolean;
  /** Voie C (lot c) : absent quand elle n'a pas tourné sur cette recherche.
   * `pieces` ne garde alors que les propositions de la recherche visuelle. */
  complement?: SpotComplement;
  /** Résultat relu sur le serveur seulement : propositions déjà gardées
   * (Envies) ou achetées (Vault) par la personne (lib/owned-marks.ts). */
  owned?: { kept: string[]; bought: string[] };
}

/** Complément des propositions de la recherche visuelle (voie C, lot c) :
 * deux sections sous elles, jamais à leur place. */
export interface SpotComplement {
  /** La même pièce dans d'autres boutiques (requête tirée des titres). */
  shopping: Piece[];
  /** Recherche lancée avec les mots de la personne (« Que cherchez-vous ? »). */
  words: Piece[];
  status: ComplementStatus | null;
  /** Requête de la section « shopping » : réponse du lancement seulement,
   * jamais enregistrée — null pour une recherche relue. */
  query: string | null;
  /** Proposer « Que cherchez-vous ? » sous les résultats (ou après « rien
   * trouvé ») : décidé et gardé par le serveur, donc aussi après un rechargement. */
  suggestText: boolean;
  /** Issue de la recherche par les mots ; null tant qu'elle n'a pas été lancée. */
  textStatus: TextSearchStatus | null;
}

export type VaultVerificationState = "pending" | "verified" | "refused";

export interface VaultItem extends Piece {
  verificationState: VaultVerificationState;
  addedAt: string;
}

export interface WishlistItem extends Piece {
  addedAt: string;
  /** Pièce identifiée d'origine (suivi du clic marchand), si elle existe. */
  productMatchId: string | null;
}

export interface Profile {
  id: string;
  name: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
}

export type PostType = "lifestyle" | "purchase";

export interface Post {
  id: string;
  type: PostType;
  mediaUrl: string;
  caption: string | null;
  taggedPieces: Pick<Piece, "id" | "name" | "imageUrl">[];
  createdAt: string;
}
