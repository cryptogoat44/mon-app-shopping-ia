export type PrivacyLevel = "public" | "followers" | "private";

export interface Profile {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  locale: string;
  defaultPrivacy: PrivacyLevel;
  followersCount: number;
  followingCount: number;
  /** Ses publications (toutes). Le nombre de pièces du Vault n'est jamais
   * exposé ici : il ne s'affiche que sur son propre profil. */
  postsCount: number;
  createdAt: string;
  updatedAt: string;
}

/** True once the user has picked a username — the app shows the
 * "complete your profile" screen until this is true. */
export function isProfileComplete(profile: Profile): boolean {
  return profile.username !== null;
}

export interface UpdateMeRequest {
  username: string;
  displayName: string;
  bio?: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export type PlatformSource = "tiktok" | "instagram" | "other" | "photo";
export type RecognitionMethod = "oembed" | "manual_screenshot";
export type SearchStatus = "pending" | "processing" | "completed" | "failed";

export interface ProductMatch {
  id: string;
  rank: number;
  productName: string;
  brand: string | null;
  imageUrl: string;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string;
  /** Image originale du marchand (haute définition), quand Google Lens la
   * fournit — à afficher en priorité, avec repli sur `imageUrl` (petite
   * vignette) si elle ne se charge pas : certains marchands bloquent
   * l'affichage de leurs images hors de leur site. */
  imageHdUrl: string | null;
  /** Lien à ouvrir au clic — affilié si un programme d'affiliation est
   * rejoint pour ce marchand, sinon identique à `merchantUrl`. Renvoyé dès
   * les résultats de recherche pour que l'app puisse l'ouvrir immédiatement,
   * sans attendre un aller-retour serveur au moment du clic. */
  affiliateUrl: string;
}

export interface ProductSearch {
  id: string;
  sourceUrl: string | null;
  sourcePlatform: PlatformSource;
  method: RecognitionMethod;
  thumbnailUrl: string | null;
  status: SearchStatus;
  errorMessage: string | null;
  /** Texte « Que cherchez-vous ? » saisi au lancement, s'il y en a un. */
  query: string | null;
  createdAt: string;
  matches: ProductMatch[];
}

/** Zone choisie par l'utilisateur sur l'image, en proportions (0 à 1) de
 * la largeur et de la hauteur de l'image : indépendante de la taille à
 * laquelle l'image est affichée à l'écran. Seule cette zone est analysée. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longueur maximale du texte « Que cherchez-vous ? ». */
export const SEARCH_QUERY_MAX_LENGTH = 60;

/** Pourquoi l'image d'un lien n'a pas pu être récupérée à la préparation
 * (Spotter, Lot S2) — l'app affiche un message précis et la suite à donner.
 * - unavailable : la plateforme ne trouve pas le contenu (vidéo privée,
 *   supprimée, ou lien incomplet — TikTok ne distingue pas ces cas) ;
 * - not_a_video : le lien mène à un profil ou une page, pas à une vidéo ;
 * - service_down : la plateforme ne répond pas (lente, en panne) ;
 * - no_official_access : aucune voie officielle pour ce site (Instagram
 *   sans jeton Meta, Pinterest) — seule la capture d'écran est possible ;
 * - unsupported_site : site qui n'est ni TikTok, ni Instagram, ni Pinterest. */
export type PreviewIssue = "unavailable" | "not_a_video" | "service_down" | "no_official_access" | "unsupported_site";

/** Messages enregistrés par le serveur quand une recherche échoue : l'app
 * s'en sert pour distinguer « rien trouvé » (proposer de recadrer) d'une
 * panne (proposer de réessayer). Source unique pour les deux côtés. */
export const SEARCH_FAILURE_MESSAGES = {
  noMatch: "Aucun produit identifié sur cette image.",
  technical: "La recherche visuelle a échoué.",
} as const;

export interface CreateSearchRequest {
  sourceUrl?: string;
}

export interface ProductMatchClickResponse {
  url: string;
}

/** D'où l'utilisateur a ouvert un lien marchand — sert à mesurer l'usage
 * réel des différentes surfaces sans identifier personne (remplace l'IP
 * hachée, retirée de `affiliate_clicks`). Source unique : le mobile et le
 * backend importent `MERCHANT_LINK_CONTEXTS` plutôt que de dupliquer la
 * liste, pour qu'une faute de frappe ou un contexte oublié soit impossible. */
export const MERCHANT_LINK_CONTEXTS = ["result", "similar", "vault", "wishlist", "post", "price_alert"] as const;
export type MerchantLinkContext = (typeof MERCHANT_LINK_CONTEXTS)[number];

export interface TrackProductMatchClickRequest {
  context?: MerchantLinkContext;
}

export type VaultCategory = "clothing" | "watches" | "accessories" | "shoes" | "bags" | "home" | "other";

export interface VaultItem {
  id: string;
  title: string;
  imageUrl: string;
  /** Image haute définition du marchand, quand la pièce vient du Spotter et
   * garde son image d'origine — à afficher en priorité, avec repli sur
   * `imageUrl`. Null pour une photo personnelle. */
  imageHdUrl: string | null;
  category: VaultCategory;
  verified: boolean;
  productMatchId: string | null;
  createdAt: string;
}

/** Détail d'un objet (GET /api/vault/:id) — ajoute le nombre de
 * publications "achat" qui le montrent, pour avertir l'utilisateur avant
 * un retrait qui les supprimerait aussi. */
export interface VaultItemDetail extends VaultItem {
  purchasePostCount: number;
  /** Marchand de la pièce identifiée d'origine — null pour une pièce
   * ajoutée à la main (aucun bouton « Voir chez le marchand »). */
  merchantName: string | null;
  merchantUrl: string | null;
  affiliateUrl: string | null;
  /** Publication « achat » qui montre déjà cette pièce (la plus récente),
   * ou null. Une pièce ne se partage qu'une fois à la fois (Lot F). */
  sharedPost: { id: string; privacy: PrivacyLevel; createdAt: string } | null;
}

// Le Vault est toujours entièrement privé (décision 5 du Lot Q) : aucune
// confidentialité par pièce. Pour montrer une pièce, on la partage en
// publication « achat », avec la confidentialité de son choix.
export interface UpdateVaultItemRequest {
  title?: string;
  category?: VaultCategory;
}

export interface VaultPage {
  items: VaultItem[];
  nextCursor: string | null;
  /** Nombre total d'objets, tous les toutes pages confondues — seulement
   * calculé pour la première page (sans curseur), `null` au-delà. */
  totalCount: number | null;
}

export interface WishlistItem {
  id: string;
  title: string;
  imageUrl: string;
  /** Image haute définition du marchand (pièce venue du Spotter), avec
   * repli sur `imageUrl`. */
  imageHdUrl: string | null;
  reference: string | null;
  priceMin: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string | null;
  /** Lien affilié de la pièce identifiée d'origine, s'il existe. */
  affiliateUrl: string | null;
  productMatchId: string | null;
  createdAt: string;
}

export interface CreateWishlistItemRequest {
  title: string;
  imageUrl: string;
  reference?: string | null;
  priceMin?: number | null;
  currency?: string | null;
  merchantName?: string | null;
  merchantUrl?: string | null;
  productMatchId?: string | null;
}

export interface WishlistPage {
  items: WishlistItem[];
  nextCursor: string | null;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isFollowing: boolean;
}

/** Profil d'un autre utilisateur (Lot Q, décision 6). Jamais son Vault,
 * ni même le nombre de pièces qu'il contient. */
export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number;
  followingCount: number;
  /** Publications que le visiteur peut voir (jamais le Vault). */
  postsCount: number;
  isFollowing: boolean;
  /** true quand c'est le profil de la personne connectée elle-même. */
  isMe: boolean;
}

export type PostType = "lifestyle" | "purchase";

export interface PostAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PostVaultItem {
  id: string;
  title: string;
  verified: boolean;
}

/** Une pièce taguée sur une publication (étape 1.E) — issue soit d'un objet
 * du Vault de l'auteur, soit d'un `product_match` d'une de ses recherches
 * récentes. `merchantUrl`/`merchantName` restent `null` pour une pièce
 * d'origine Vault (aucun lien marchand associé dans ce cas). */
export interface PostTaggedPiece {
  id: string;
  productName: string;
  imageUrl: string;
  merchantName: string | null;
  merchantUrl: string | null;
  productMatchId: string | null;
}

/** Entrée envoyée par le client pour taguer une pièce à la création d'une
 * publication : exactement l'une des deux origines. */
export type TaggedPieceInput = { vaultItemId: string } | { productMatchId: string };

export interface Post {
  id: string;
  type: PostType;
  caption: string | null;
  mediaUrl: string;
  /** « Achat » venu du Spotter : image haute définition du marchand, avec
   * repli sur `mediaUrl`. Null sinon. */
  mediaHdUrl: string | null;
  /** Photo publiée : miniature (480 px) pour les grilles. Null pour un
   * « achat » ou une photo publiée avant l'optimisation. */
  mediaThumbUrl: string | null;
  privacy: PrivacyLevel;
  createdAt: string;
  author: PostAuthor;
  vaultItem: PostVaultItem | null;
  taggedPieces: PostTaggedPiece[];
  reactionCount: number;
  viewerHasReacted: boolean;
  /** Commentaires visibles (Lot F). */
  commentCount: number;
}

// Commentaires (Lot F, section 5.A du programme) : à plat, 1 000 caractères
// au plus ; le compteur de caractères ne s'affiche qu'à partir de 900.
export const COMMENT_MAX_LENGTH = 1000;
export const COMMENT_COUNTER_FROM = 900;

export interface PostComment {
  id: string;
  body: string;
  createdAt: string;
  author: PostAuthor;
  /** Son propre commentaire, ou un commentaire sous sa propre publication. */
  canDelete: boolean;
}

export interface CommentsPage {
  comments: PostComment[];
  nextCursor: string | null;
}

export interface ReactToPostResponse {
  reactionCount: number;
  viewerHasReacted: boolean;
}

export interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
}

export type ConsentType = "terms" | "privacy_policy" | "age_declaration" | "marketing_email";

/** Documents juridiques dont l'acceptation est enregistrée avec sa version. */
export type LegalDocumentType = "terms" | "privacy_policy";

/** Version en vigueur de chaque document (Lot Q, bloc 5). À changer à
 * chaque modification du texte : le serveur refuse l'acceptation d'une
 * autre version, et l'historique garde la version acceptée. */
export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentType, string> = {
  terms: "projet-2026-09-25",
  privacy_policy: "projet-2026-09-25",
};

/** Âge minimum pour utiliser Spotto (décision du fondateur, 2026-09-25) :
 * simple déclaration à l'inscription, aucune vérification d'âge. */
export const MINIMUM_AGE = 15;

/** Consentements enregistrés avec la version du texte accepté : les deux
 * documents, et la déclaration d'âge (« Je certifie avoir au moins 15 ans »). */
export type VersionedConsentType = LegalDocumentType | "age_declaration";

export const CONSENT_VERSIONS: Record<VersionedConsentType, string> = {
  ...LEGAL_DOCUMENT_VERSIONS,
  age_declaration: `${MINIMUM_AGE}-ans-2026-09-25`,
};

export interface ConsentStatus {
  type: ConsentType;
  grantedAt: string | null;
  /** Version du document acceptée (null : consentement antérieur au suivi des versions). */
  version: string | null;
  /** Vrai si la version acceptée est celle en vigueur. */
  isCurrent: boolean;
}

export interface ConsentInput {
  type: ConsentType;
  /** Obligatoire (et égale à la version en vigueur, CONSENT_VERSIONS) pour
   * les documents juridiques et la déclaration d'âge. */
  version?: string;
}

export interface RecordConsentsRequest {
  consents: ConsentInput[];
}

export type NotificationType = "follow" | "like" | "comment";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: PostAuthor;
  createdAt: string;
  read: boolean;
  /** Publication concernée (« j'aime », commentaire), sinon null. */
  postId: string | null;
}

export type ReportTargetType = "user" | "post" | "comment";
export type ReportReason = "spam" | "inappropriate" | "harassment" | "other";

export interface CreateReportRequest {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  note?: string;
}

export interface BlockedUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}
