export type PrivacyLevel = "public" | "followers" | "private";
export const PRIVACY_LEVELS = ["public", "followers", "private"] as const satisfies readonly PrivacyLevel[];

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
  /** Administrateur (lot 5, table « admins », attribuée par SQL) : seule
   * condition d'affichage de l'entrée « Modération » des Réglages. Le serveur
   * revérifie le rôle à chaque route d'administration. */
  isAdmin: boolean;
  /** Qui peut vous envoyer des pièces (lot 5, section 5.C). */
  pieceSendsFrom: PieceSendsFrom;
}

/** Réglage « Qui peut m'envoyer des pièces » : les comptes que je suis (par
 * défaut), tout le monde, ou personne. */
export type PieceSendsFrom = "following" | "everyone" | "nobody";
export const PIECE_SENDS_FROM = ["following", "everyone", "nobody"] as const satisfies readonly PieceSendsFrom[];

export interface UpdatePieceSendsFromRequest {
  pieceSendsFrom: PieceSendsFrom;
}

/** True once the user has picked a username — the app shows the
 * "complete your profile" screen until this is true. */
export function isProfileComplete(profile: Profile): boolean {
  return profile.username !== null;
}

/** Langues de l'interface (lot 3) — colonne profiles.locale. */
export const APP_LOCALES = ["fr", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export interface UpdateLocaleRequest {
  locale: AppLocale;
}

/** Mot à taper pour confirmer la suppression de son compte (lot 5), dans la
 * langue de l'app. */
export const ACCOUNT_DELETION_WORDS = { fr: "SUPPRIMER", en: "DELETE" } as const satisfies Record<AppLocale, string>;

/** Vrai si `typed` est le mot de confirmation de `locale` — ou, sans langue
 * (le serveur, qui vérifie l'intention), de l'une des langues —, sans tenir
 * compte de la casse ni des espaces autour. */
export function isAccountDeletionWord(typed: string, locale?: AppLocale): boolean {
  const word = typed.trim().toUpperCase();
  return (locale ? [locale] : APP_LOCALES).some((l) => word === ACCOUNT_DELETION_WORDS[l]);
}

/** Corps de DELETE /api/me. */
export interface DeleteAccountRequest {
  confirmation: string;
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

// Listes de valeurs : servent aussi au serveur pour valider les lignes lues
// dans la base (charte, règle 19).
export const PLATFORM_SOURCES = ["tiktok", "instagram", "other", "photo"] as const;
export type PlatformSource = (typeof PLATFORM_SOURCES)[number];
export const RECOGNITION_METHODS = ["oembed", "manual_screenshot"] as const;
export type RecognitionMethod = (typeof RECOGNITION_METHODS)[number];
export const SEARCH_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

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
  /** Motif choisi si la personne a signalé cette proposition comme
   * incohérente (bouton « Résultat incohérent »), sinon null. */
  feedbackReason: MatchFeedbackReason | null;
}

// ---- Bouton « Résultat incohérent » (fiabilité des résultats, 2026-10-15) ----

/** Les cinq motifs, validés par le fondateur le 2026-10-15, dans l'ordre de
 * l'écran. Seuls l'identifiant de la proposition et le motif partent : ni
 * texte libre, ni image. */
export const MATCH_FEEDBACK_REASONS = ["image_title_mismatch", "wrong_item", "not_for_sale", "wrong_price", "duplicate"] as const;
export type MatchFeedbackReason = (typeof MATCH_FEEDBACK_REASONS)[number];

/** Signalements au plus par personne et par jour (jour de Paris), comptés
 * par le serveur dans la base. Changer de motif ou retirer ne compte pas. */
export const MATCH_FEEDBACK_DAILY_LIMIT = 30;

export interface MatchFeedbackRequest {
  reason: MatchFeedbackReason;
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
  /** true : la recherche a échoué chez le fournisseur, qui l'a refusée, et
   * n'a été comptée dans aucune limite (place rendue, 0027). Affiché par l'app
   * à partir de la mise en ligne 2 (« Cette tentative n'a pas été comptée. »). */
  notCounted?: boolean;
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

/** Zone analysée par défaut : centrée, 70 % de l'image (cadre proposé au
 * recadrage ; photo lancée sans recadrage au lot 4 ter). */
export const DEFAULT_CROP: CropRect = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 };

/** Longueur maximale du texte « Que cherchez-vous ? ». */
export const SEARCH_QUERY_MAX_LENGTH = 60;

/** Lot 4, temps 1 bis : analyse automatique d'une vidéo. Étage 1 sur
 * l'appareil (images nettes et différentes, réduites) ; étage 2 par une IA,
 * seulement avec le consentement « analyse_video_ia ». La vidéo entière ne
 * quitte jamais l'appareil. */
export const VIDEO_AI = {
  /** Images envoyées au plus (8 à 12 quand la vidéo en offre autant de différentes). */
  maxFrames: 12,
  /** Grand côté des images envoyées, en pixels. */
  frameEdge: 512,
  /** Moments proposés par l'IA. */
  moments: 3,
  /** Texte de l'utilisateur : quelques mots (la limite haute est SEARCH_QUERY_MAX_LENGTH). */
  queryMinLength: 2,
} as const;

/** Un moment proposé : une des images envoyées, et le cadre de la pièce. */
export interface VideoMoment {
  /** Position de l'image dans l'envoi (0 = la première). */
  frame: number;
  /** Cadre de la pièce dans cette image, en proportions 0–1. */
  box: CropRect;
}

export interface VideoMomentsResponse {
  moments: VideoMoment[];
}

/** La fonction est-elle active sur le serveur (clé d'API présente) ? */
export interface VideoAiStatus {
  enabled: boolean;
}

export type VideoAiErrorCode =
  | "video_ai_disabled"
  | "video_ai_consent_required"
  | "video_ai_user_limit"
  | "video_ai_global_limit"
  | "video_ai_unavailable"
  | "invalid_frames";

/** Plafond des recherches atteint (lot 4 quater) : réponse 429 du lancement
 * d'une recherche, et de l'analyse automatique avant tout envoi à l'IA.
 * « day » : tout le service, jusqu'à minuit (heure de Paris) ; « month » : tout
 * le service, cycle mensuel de SerpApi, de nouveau possible le jour
 * `resumesOn` (son prochain renouvellement, date de Paris « AAAA-MM-JJ ») ;
 * « user » : la part de la personne pour la journée. */
export type SearchCapacityLimit = "day" | "month" | "user";
export const SEARCH_CAPACITY_LIMITS = ["day", "month", "user"] as const satisfies readonly SearchCapacityLimit[];
export const SEARCH_CAPACITY_ERRORS = {
  day: "search_capacity_day",
  month: "search_capacity_month",
  user: "search_capacity_user",
} as const satisfies Record<SearchCapacityLimit, string>;

export interface SearchCapacityReached {
  limit: SearchCapacityLimit;
  /** Plafond du mois seulement : jour du prochain renouvellement (« AAAA-MM-JJ »), sinon null. */
  resumesOn: string | null;
}

export interface SearchCapacityErrorBody extends ApiErrorBody {
  resumesOn?: string;
}

/** Une vraie date du calendrier, au format « AAAA-MM-JJ ». */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Lit le corps d'une erreur sans lui faire confiance ; null si ce n'est pas un plafond atteint. */
export function parseSearchCapacityError(body: unknown): SearchCapacityReached | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const limit = SEARCH_CAPACITY_LIMITS.find((candidate) => SEARCH_CAPACITY_ERRORS[candidate] === body.error);
  if (!limit) return null;
  const resumesOn = limit === "month" && "resumesOn" in body && isCalendarDay(body.resumesOn) ? body.resumesOn : null;
  return { limit, resumesOn };
}

function isProportion(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Lit la réponse du serveur sans lui faire confiance : moments distincts,
 * numéros d'images existants, cadres dans l'image. Null si la forme est
 * mauvaise. */
export function parseVideoMomentsResponse(value: unknown, frameCount: number): VideoMoment[] | null {
  if (typeof value !== "object" || value === null || !("moments" in value) || !Array.isArray(value.moments)) return null;
  const moments: VideoMoment[] = [];
  for (const item of value.moments) {
    if (typeof item !== "object" || item === null || !("frame" in item) || !("box" in item)) return null;
    const { frame, box } = item;
    if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0 || frame >= frameCount) return null;
    if (typeof box !== "object" || box === null || !("x" in box) || !("y" in box) || !("width" in box) || !("height" in box)) return null;
    const { x, y, width, height } = box;
    if (!isProportion(x) || !isProportion(y) || !isProportion(width) || !isProportion(height)) return null;
    if (width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return null;
    if (moments.some((moment) => moment.frame === frame)) return null;
    moments.push({ frame, box: { x, y, width, height } });
  }
  return moments.length <= VIDEO_AI.moments ? moments : null;
}

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
export const MERCHANT_LINK_CONTEXTS = ["result", "similar", "vault", "wishlist", "post", "price_alert", "received"] as const;
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

/** Détail d'une envie (GET /api/wishlist/:id) : ajoute sa publication
 * « envie » si elle a été republiée (une seule à la fois, lot 5). */
export interface WishlistItemDetail extends WishlistItem {
  sharedPost: { id: string; privacy: PrivacyLevel; createdAt: string } | null;
}

// ---- Partage d'une envie (lot 5, section 5.C) ----
// Toujours un geste volontaire : les envies restent privées par défaut.

/** Republier une envie sur son profil (publication « envie »). */
export interface RepublishWishRequest {
  privacy: PrivacyLevel;
}

/** Envoyer une envie à une personne sur Spotto. */
export interface SendPieceRequest {
  recipientId: string;
}

/** Une pièce reçue (onglet « Reçues ») : un instantané de l'envie au moment
 * de l'envoi, avec la copie de son image faite par notre serveur. */
export interface ReceivedPiece {
  id: string;
  sender: PostAuthor;
  title: string;
  /** Null quand l'image a été retirée par la modération (`imageRemoved`). */
  imageUrl: string | null;
  imageThumbUrl: string | null;
  /** Lot 5 : image retirée par la modération (droits sur l'image) — afficher
   * « Image indisponible », le titre et le lien du marchand. */
  imageRemoved: boolean;
  merchantName: string | null;
  /** Lien à ouvrir : affilié s'il existe, sinon le lien marchand ; null sans marchand. */
  merchantUrl: string | null;
  /** true quand `merchantUrl` est un lien affilié (mention obligatoire). */
  isAffiliate: boolean;
  productMatchId: string | null;
  priceMin: number | null;
  currency: string | null;
  createdAt: string;
}

export interface ReceivedPiecesPage {
  pieces: ReceivedPiece[];
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

/** « wish » (lot 5) : une envie republiée sur son profil — jamais un achat,
 * jamais de badge d'achat vérifié. */
export type PostType = "lifestyle" | "purchase" | "wish";
export const POST_TYPES = ["lifestyle", "purchase", "wish"] as const satisfies readonly PostType[];

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

/** Publication « envie » : la pièce, son marchand et son prix. */
export interface PostWish {
  title: string;
  merchantName: string | null;
  /** Lien à ouvrir : affilié s'il existe, sinon le lien marchand ; null sans marchand. */
  merchantUrl: string | null;
  /** true quand `merchantUrl` est un lien affilié (mention obligatoire). */
  isAffiliate: boolean;
  productMatchId: string | null;
  priceMin: number | null;
  currency: string | null;
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
  /** Null quand l'image copiée d'une envie a été retirée par la modération
   * (`mediaRemoved`). */
  mediaUrl: string | null;
  /** Lot 5 : image copiée retirée par la modération (droits sur l'image) —
   * la publication reste, avec « Image indisponible ». */
  mediaRemoved: boolean;
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
  /** Publication « envie » (lot 5) ; null pour les autres types. */
  wish: PostWish | null;
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

/** Types de consentement enregistrés (une seule liste, serveur et app). */
export const CONSENT_TYPES = ["terms", "privacy_policy", "age_declaration", "analytics", "marketing_email", "analyse_video_ia"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Consentements facultatifs : ils peuvent être refusés ou retirés à tout
 * moment (chaque choix est un nouvel événement daté). « analyse_video_ia »
 * (lot 4, temps 1 bis) : quelques images réduites d'une vidéo envoyées à un
 * prestataire d'IA pour y trouver la pièce. */
export const OPTIONAL_CONSENTS: readonly ConsentType[] = ["analytics", "analyse_video_ia"];

/** Documents juridiques dont l'acceptation est enregistrée avec sa version. */
export type LegalDocumentType = "terms" | "privacy_policy";

/** Version en vigueur de chaque document (Lot Q, bloc 5). À changer à
 * chaque modification du texte : le serveur refuse l'acceptation d'une
 * autre version, et l'historique garde la version acceptée. */
export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentType, string> = {
  terms: "projet-2026-09-25",
  // 2026-09-29 : serveur déménagé à Francfort (UE) ; 2026-09-30 : rapports
  // d'erreur (Sentry) et statistiques d'usage facultatives (PostHog) —
  // simples informations, pas de nouvelle acceptation (décisions du
  // fondateur) ; pour PostHog, c'est le consentement « statistiques » qui fait foi.
  // « projet-2026-09-30-b » (lot 3) : langue et thème enregistrés sur
  // l'appareil — simple information, sans nouvelle acceptation ni message.
  // « projet-2026-10-05 » (lot 3bis) : identifiant d'installation pseudonyme
  // dans les rapports de plantage de l'app iPhone — simple information, sans
  // nouvelle acceptation ni message (décision du fondateur).
  // « projet-2026-10-05-b » (lot 4) : vidéo importée lue seulement sur
  // l'appareil, jamais envoyée ni conservée — simple information, sans
  // nouvelle acceptation ni message (décision du fondateur).
  // « projet-2026-10-06 » (lot 4, temps 1 bis ; remplace le brouillon
  // « -10-05-c », jamais publié) : analyse automatique d'une vidéo par une IA
  // (Anthropic, États-Unis ; ce que prévoient ses conditions : pas
  // d'entraînement, suppression sous 30 jours, exceptions, lieux), seulement
  // avec le consentement « analyse_video_ia » — simple information, sans
  // nouvelle acceptation (décision du fondateur, 2026-10-06 : le consentement
  // propre à la fonction, demandé à son premier usage, fait foi ; à confirmer
  // par le juriste).
  // « projet-2026-10-25 » (petit lot) : les mots tapés ne partent plus avec
  // l'image vers SerpApi et Google, et ne sont plus enregistrés avec la
  // recherche ; la description d'une vidéo n'est pas enregistrée — simple
  // information, sans nouvelle acceptation ni message (décision du fondateur).
  privacy_policy: "projet-2026-10-25",
};

/** Suivi des erreurs (lot 2) : seule adresse Sentry admise, région UE
 * (Francfort) — serveur comme site. */
export const SENTRY_EU_DSN_PATTERN = /^https:\/\/[a-f0-9]+@o\d+\.ingest\.de\.sentry\.io\/\d+$/;

/** Âge minimum pour utiliser Spotto (décision du fondateur, 2026-09-25) :
 * simple déclaration à l'inscription, aucune vérification d'âge. */
export const MINIMUM_AGE = 15;

/** Consentements enregistrés avec la version du texte accepté : les deux
 * documents, et la déclaration d'âge (« Je certifie avoir au moins 15 ans »). */
export type VersionedConsentType = LegalDocumentType | "age_declaration" | "analytics" | "analyse_video_ia";

export const CONSENT_VERSIONS: Record<VersionedConsentType, string> = {
  ...LEGAL_DOCUMENT_VERSIONS,
  age_declaration: `${MINIMUM_AGE}-ans-2026-09-25`,
  // Texte de la case « statistiques d'usage » (lot 2).
  analytics: "statistiques-2026-09-30",
  // Texte de l'écran « Analyse automatique de la vidéo » (lot 4, temps 1 bis).
  // Texte complété le 2026-10-06 (durée de conservation chez Anthropic), avant
  // toute mise en ligne : aucun accord n'avait été donné sur la version du 10-05.
  analyse_video_ia: "analyse-video-ia-2026-10-06",
};

/** Versions dont l'acceptation reste valable. Une mise à jour qui demande
 * seulement d'INFORMER (ex. lieu d'hébergement) garde les versions
 * précédentes dans la liste : personne n'a à accepter de nouveau. Une mise à
 * jour qui demande une nouvelle acceptation remet la liste à la seule
 * version en vigueur. Une nouvelle acceptation se fait toujours dans la
 * version en vigueur (CONSENT_VERSIONS). À faire valider par le juriste :
 * quels changements relèvent de l'un ou de l'autre. */
export const ACCEPTED_CONSENT_VERSIONS: Record<VersionedConsentType, readonly string[]> = {
  terms: ["projet-2026-09-25"],
  privacy_policy: ["projet-2026-09-25", "projet-2026-09-29", "projet-2026-09-30", "projet-2026-09-30-b", "projet-2026-10-05", "projet-2026-10-05-b", "projet-2026-10-06", "projet-2026-10-25"],
  age_declaration: [CONSENT_VERSIONS.age_declaration],
  analytics: [CONSENT_VERSIONS.analytics],
  analyse_video_ia: [CONSENT_VERSIONS.analyse_video_ia],
};

/** Information à montrer une fois aux personnes connectées après une mise à
 * jour qui ne demande pas de nouvelle acceptation (un identifiant par
 * information, pour ne la montrer qu'une fois). */
export const POLICY_UPDATE_NOTICE = {
  // Remplace l'information du 2026-09-29 (serveur en Europe) : le message
  // couvre les deux mises à jour, une seule fois.
  id: "politique-2026-09-30-erreurs-statistiques",
  document: "privacy_policy" as LegalDocumentType,
  /** Versions dont le texte contient déjà cette information : la
   * personne qui en a accepté une ne voit pas le message. */
  alreadyCovered: ["projet-2026-09-30", "projet-2026-09-30-b", "projet-2026-10-05", "projet-2026-10-05-b", "projet-2026-10-06", "projet-2026-10-25"] as readonly string[],
} as const;

export interface ConsentStatus {
  type: ConsentType;
  /** Date de l'accord, si le dernier choix est un accord ; sinon null. */
  grantedAt: string | null;
  /** Date du dernier choix (accord, refus ou retrait) ; null si jamais demandé. */
  decidedAt: string | null;
  /** Version du document acceptée (null : consentement antérieur au suivi des versions). */
  version: string | null;
  /** Vrai si la version acceptée est celle en vigueur. */
  isCurrent: boolean;
}

export interface ConsentInput {
  type: ConsentType;
  /** false = refus ou retrait (consentements facultatifs seulement). Par défaut : accord. */
  granted?: boolean;
  /** Obligatoire (et égale à la version en vigueur, CONSENT_VERSIONS) pour
   * les documents juridiques et la déclaration d'âge. */
  version?: string;
}

export interface RecordConsentsRequest {
  consents: ConsentInput[];
}

/** « piece_received » (lot 5) : une personne vous a envoyé une pièce (in-app, jamais push). */
export type NotificationType = "follow" | "like" | "comment" | "moderation" | "report_handled" | "piece_received";
export const NOTIFICATION_TYPES = ["follow", "like", "comment", "moderation", "report_handled", "piece_received"] as const satisfies readonly NotificationType[];

export interface AppNotification {
  id: string;
  type: NotificationType;
  /** Auteur de l'action ; null pour la modération (aucun administrateur n'est nommé). */
  actor: PostAuthor | null;
  createdAt: string;
  read: boolean;
  /** Publication concernée (« j'aime », commentaire), sinon null. */
  postId: string | null;
  /** « moderation » : la décision qui vous concerne et son motif ; sinon null. */
  moderation: ModerationNotice | null;
  /** « report_handled » : le type du contenu que vous aviez signalé (jamais la
   * décision prise) ; sinon null. */
  reportedType: ReportTargetType | null;
}

/** « piece » (lot 5) : une pièce reçue d'une autre personne. */
export type ReportTargetType = "user" | "post" | "comment" | "piece";
export const REPORT_TARGET_TYPES = ["user", "post", "comment", "piece"] as const satisfies readonly ReportTargetType[];
export type ReportReason = "spam" | "inappropriate" | "harassment" | "other";
export const REPORT_REASONS = ["spam", "inappropriate", "harassment", "other"] as const satisfies readonly ReportReason[];
/** Motif d'une décision de la modération : ceux des signalements, plus le
 * motif neutre du retrait d'une image copiée (lot 5), jamais proposé dans
 * « Signaler ». */
export type ModerationReason = ReportReason | "image_rights";
export const MODERATION_REASONS = [...REPORT_REASONS, "image_rights"] as const satisfies readonly ModerationReason[];

// ---- Modération (lot 5, section 5.B) : visible des seuls administrateurs ----

/** Décisions possibles : classer sans suite, masquer un contenu, suspendre un
 * compte, et leurs annulations (rétablir, lever la suspension) ; retirer une
 * image copiée par Spotto (lot 5 : définitif, le fichier est effacé). */
export type ModerationActionType = "dismiss" | "hide" | "suspend" | "restore" | "unsuspend" | "remove_image";
export const MODERATION_ACTION_TYPES = ["dismiss", "hide", "suspend", "restore", "unsuspend", "remove_image"] as const satisfies readonly ModerationActionType[];
export const MODERATION_DECISIONS = ["dismiss", "hide", "suspend"] as const satisfies readonly ModerationActionType[];
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];
/** Longueur maximale de la note d'une décision (montrée à la personne concernée). */
export const MODERATION_NOTE_MAX_LENGTH = 500;

/** Ce que la personne concernée apprend d'une décision : jamais qui l'a prise. */
export interface ModerationNotice {
  action: ModerationActionType;
  targetType: ReportTargetType;
  reason: ModerationReason | null;
  note: string | null;
}

export type ModerationStatus = "open" | "handled";

export interface ModerationAuthor extends PostAuthor {
  suspended: boolean;
}

/** Aperçu du contenu signalé ; « missing » : supprimé depuis par son auteur.
 * `imageRemoved` (lot 5) : image copiée retirée par la modération. */
export type ModerationPreview =
  | {
      kind: "post";
      author: ModerationAuthor;
      caption: string | null;
      imageUrl: string | null;
      imageRemoved: boolean;
      privacy: PrivacyLevel;
      createdAt: string;
      hidden: boolean;
    }
  | { kind: "comment"; author: ModerationAuthor; body: string; postId: string; createdAt: string; hidden: boolean }
  | { kind: "user"; author: ModerationAuthor; bio: string | null }
  | { kind: "piece"; author: ModerationAuthor; title: string; imageUrl: string | null; imageRemoved: boolean; createdAt: string; hidden: boolean }
  | { kind: "missing" };

export interface ModerationLogEntry {
  id: string;
  action: ModerationActionType;
  reason: ModerationReason | null;
  note: string | null;
  createdAt: string;
  /** Administrateur qui a pris la décision (visible des seuls administrateurs). */
  adminUsername: string | null;
}

/** Les signalements d'un même contenu, regroupés. */
export interface ModerationItem {
  targetType: ReportTargetType;
  targetId: string;
  reportCount: number;
  reasons: Partial<Record<ReportReason, number>>;
  notes: string[];
  firstReportedAt: string;
  lastReportedAt: string;
  preview: ModerationPreview;
  /** Masquage en vigueur (à annuler pour rétablir), sinon null. */
  activeHideActionId: string | null;
  /** Suspension en vigueur du compte concerné (à lever), sinon null. */
  activeSuspendActionId: string | null;
  /** Lot 5 : l'image est une copie faite par Spotto (publication « envie »,
   * pièce envoyée), encore en place — elle peut être retirée. */
  canRemoveImage: boolean;
  history: ModerationLogEntry[];
}

export interface ModerationPage {
  items: ModerationItem[];
  nextCursor: string | null;
}

export interface ModerationActionRequest {
  targetType: ReportTargetType;
  targetId: string;
  action: ModerationDecision;
  reason?: ReportReason;
  note?: string;
}

export interface ModerationUndoRequest {
  note?: string;
}

/** Contenus dont l'image peut être une copie faite par Spotto (lot 5). */
export const IMAGE_REMOVAL_TARGET_TYPES = ["post", "piece"] as const satisfies readonly ReportTargetType[];

/** Retirer l'image copiée d'une publication « envie » ou d'une pièce envoyée
 * (lot 5) : motif neutre fixé par le serveur, note facultative. Le serveur
 * efface d'abord le fichier ; s'il n'y parvient pas, rien n'est changé. */
export interface RemoveImageRequest {
  targetType: (typeof IMAGE_REMOVAL_TARGET_TYPES)[number];
  targetId: string;
  note?: string;
}

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
