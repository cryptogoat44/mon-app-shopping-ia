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
  /** Qui peut vous écrire (lot messages, migration 0032) : invitations des
   * membres qui ne sont pas vos amis. « everyone » tant que la migration
   * n'est pas appliquée. */
  messagesFrom: MessagesFrom;
}

/** Réglage « Qui peut m'envoyer des pièces » : les comptes que je suis (par
 * défaut), tout le monde, ou personne. */
export type PieceSendsFrom = "following" | "everyone" | "nobody";
export const PIECE_SENDS_FROM = ["following", "everyone", "nobody"] as const satisfies readonly PieceSendsFrom[];

export interface UpdatePieceSendsFromRequest {
  pieceSendsFrom: PieceSendsFrom;
}

/** Réglage « Qui peut m'écrire » (lot messages) : mêmes valeurs que celui
 * des pièces, mais pour les invitations. Vos amis (vous vous suivez l'un
 * l'autre) peuvent toujours vous écrire ; « everyone » : tout membre peut
 * vous envoyer UNE invitation ; « following » : seulement les comptes que
 * vous suivez ; « nobody » : seulement vos amis. */
export type MessagesFrom = PieceSendsFrom;
export const MESSAGES_FROM = PIECE_SENDS_FROM;
/** Valeur par défaut (migration 0032) : une invitation reste une demande,
 * que la personne accepte, refuse ou bloque. */
export const DEFAULT_MESSAGES_FROM: MessagesFrom = "everyone";

export interface UpdateMessagesFromRequest {
  messagesFrom: MessagesFrom;
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

// Bio du profil (lot « profil et icône des réglages ») : 160 caractères et
// 3 lignes au plus. Mêmes règles dans l'app (compteur) et au serveur (seul juge).
export const BIO_MAX_LENGTH = 160;
export const BIO_MAX_LINES = 3;

/** Retire une moitié d'émoji restée seule en fin de texte (coupure à N caractères). */
function withoutBrokenEnd(text: string): string {
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

/** Bio telle qu'enregistrée : retours à la ligne unifiés, espaces de fin de
 * ligne retirés, plusieurs lignes vides de suite réduites à une seule, puis
 * espaces et lignes vides retirés au début et à la fin. */
export function normalizeBio(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Nombre de lignes d'une bio (0 si elle est vide). */
export function bioLineCount(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}

export type BioProblem = "too_long" | "too_many_lines";

/** Ce qui empêche d'enregistrer une bio déjà normalisée, ou null. */
export function bioProblem(normalized: string): BioProblem | null {
  if (normalized.length > BIO_MAX_LENGTH) return "too_long";
  if (bioLineCount(normalized) > BIO_MAX_LINES) return "too_many_lines";
  return null;
}

/** Pendant la saisie : 3 lignes au plus (le texte d'éventuelles lignes en
 * plus, collé par exemple, rejoint la 3ᵉ ; un retour à la ligne de trop est
 * ignoré), une seule ligne vide de suite, 160 caractères au plus. Les espaces
 * ne sont pas retirés ici (on tape une espace avant le mot suivant) :
 * normalizeBio s'en charge à l'enregistrement. */
export function limitBioInput(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").split("\n");
  if (lines.length > BIO_MAX_LINES) {
    const last = lines
      .slice(BIO_MAX_LINES - 1)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .join(" ");
    lines.splice(BIO_MAX_LINES - 1, lines.length, last);
  }
  return withoutBrokenEnd(lines.join("\n").slice(0, BIO_MAX_LENGTH));
}

// Photo de profil (même lot) : l'app envoie un carré JPEG déjà recadré sur
// l'appareil (une photo HEIC d'iPhone y est convertie) ; le serveur le refait
// en AVATAR_SIDE × AVATAR_SIDE, sans aucune métadonnée.
/** Taille maximale du fichier reçu par le serveur. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Côté du carré enregistré, en pixels. */
export const AVATAR_SIDE = 512;

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

// ---- Voie C (lot c, 2026-11-02) : complément des résultats Lens ----
// Les résultats Lens sont toujours gardés, montrés en premier et jamais
// remplacés ; toute panne du complément laisse les résultats Lens seuls.

/** Origine d'une proposition (product_matches.origin, 0028, « lens » par
 * défaut) : « lens », la recherche visuelle ; « shopping », la même pièce dans
 * d'autres boutiques (Google Shopping, requête tirée des titres Lens) ;
 * « words », la recherche lancée avec les mots de la personne (voie B). */
export const MATCH_ORIGINS = ["lens", "shopping", "words"] as const;
export type MatchOrigin = (typeof MATCH_ORIGINS)[number];

/** Issue du complément (product_searches.complement_status, 0028 ; null quand
 * la voie C n'a pas tourné). Toute issue autre que « shown » = Lens seul.
 * - shown : des propositions du complément sont montrées ;
 * - empty : requête valable, mais rien de gardé après les filtres ;
 * - no_query : pas de requête sûre (Lens n'a rien gardé, ou la requête
 *   proposée est vide, invente des mots ou contient des opérateurs) ;
 * - ai_failed : l'IA a échoué, refusé, dépassé son temps ou mal répondu ;
 * - shopping_failed : la recherche Shopping a échoué, ou ses lignes n'ont
 *   pas pu être enregistrées ;
 * - no_time : plus assez de temps dans le budget de la recherche ;
 * - no_capacity : plafond des recherches ou limite de l'IA atteints (jamais
 *   de 429 pour le complément) ;
 * - skipped : étape IA coupée (interrupteur) ;
 * - error : exception inattendue — distincte de « skipped », pour que la
 *   mesure révèle les anomalies. */
export const COMPLEMENT_STATUSES = ["shown", "empty", "no_query", "ai_failed", "shopping_failed", "no_time", "no_capacity", "skipped", "error"] as const;
export type ComplementStatus = (typeof COMPLEMENT_STATUSES)[number];

/** Issue de la recherche par mots (voie B ; product_searches.text_status,
 * 0028 ; null tant qu'elle n'a pas été lancée). */
export const TEXT_SEARCH_STATUSES = ["shown", "empty", "shopping_failed"] as const;
export type TextSearchStatus = (typeof TEXT_SEARCH_STATUSES)[number];

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
  /** Voie C (lot c) : d'où vient la proposition. Absente = « lens » — le
   * serveur ne l'envoie que pour « shopping » et « words », et un ancien
   * serveur ne l'envoie jamais. */
  origin?: MatchOrigin;
  /** Alertes prix et stock (lot 2) : la pièce a une clé « même pièce »
   * (même boutique, même produit) ; seulement alors « Plus disponible ? »
   * s'affiche sur sa carte. Envoyée seulement quand elle est vraie ; absente
   * (ancien serveur, place de marché, page de liste…) = non. */
  alertTrackable?: true;
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
  /** Réponse du lancement seulement (petit lot 2) : les propositions dont le
   * nom contient un des mots tapés sous la photo ont été remontées en tête.
   * Les mots ne sont pas enregistrés : une recherche relue n'en dit rien. */
  sortedByWords?: boolean;
  /** Voie C (lot c) : absent quand elle n'a pas tourné sur cette recherche
   * (interrupteur coupé, recherche plus ancienne, ancien serveur). Les
   * propositions du complément sont dans `matches`, avec leur `origin`. */
  complement?: SearchComplement;
  /** Relecture d'une recherche (GET /api/searches/:id) seulement : ses
   * propositions déjà gardées dans les Envies de la personne, ou rangées dans
   * son Vault — le résultat rouvert affiche « Gardée » et « Ajoutée au Vault ».
   * Absents ailleurs, et d'un ancien serveur. */
  wishlistMatchIds?: string[];
  vaultMatchIds?: string[];
}

/** Complément d'une recherche (voie C, lot c). */
export interface SearchComplement {
  /** Issue du complément ; null quand il n'a pas tourné sur cette recherche. */
  status: ComplementStatus | null;
  /** Requête envoyée à la recherche Shopping : réponse du lancement (ou,
   * boutiques ensuite, de POST /api/searches/:id/complement) seulement,
   * jamais enregistrée — une recherche relue n'en dit rien. */
  query?: string;
  /** Proposer « Que cherchez-vous ? » (voie B) : enregistré par le serveur
   * (text_suggested), et faux dès que la recherche par mots a été lancée.
   * L'invitation survit donc à un rechargement et à l'historique. */
  suggestText: boolean;
  /** Issue de la recherche par mots ; null tant qu'elle n'a pas été lancée. */
  textStatus: TextSearchStatus | null;
  /** Boutiques ensuite (lancement avec `complement: "deferred"`) : la
   * recherche dans d'autres boutiques n'est pas encore faite. L'app montre
   * les résultats Lens, puis appelle POST /api/searches/:id/complement, qui
   * renvoie la recherche avec son complément. Absent sinon (un ancien serveur
   * ne l'envoie jamais) ; `status` est alors null. */
  pending?: boolean;
}

/** Boutiques ensuite : valeur du champ « complement » du lancement
 * (POST /api/searches/:id/run). Avec elle, et la voie C en service, la
 * réponse arrive dès Lens ; « Cette pièce dans d'autres boutiques » est
 * cherchée ensuite, par POST /api/searches/:id/complement. Sans elle (app
 * déjà installée), rien ne change. */
export const COMPLEMENT_DEFERRED = "deferred";

/** Refus propres à POST /api/searches/:id/complement (l'app retire alors la
 * ligne « Recherche dans d'autres boutiques… », sans rien dire) :
 * - unavailable : voie C coupée sur le serveur (404) ;
 * - notDeferred : recherche lancée sans « boutiques ensuite » (409). */
export const COMPLEMENT_ERRORS = {
  unavailable: "complement_unavailable",
  notDeferred: "complement_not_deferred",
} as const;

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

/** Compteur des recherches, lu sans rien réserver (lot limites annoncées,
 * GET /api/searches/capacity) : l'app annonce une pause du service, ou les
 * dernières recherches du jour, AVANT qu'on prépare une photo. Instants en
 * ISO 8601 (UTC) ; l'app les affiche à l'heure de l'appareil.
 * - user : la part de la personne pour la journée (heure de Paris), en
 *   photos ; remaining = limit − used, jamais négatif ; resetsAt : le minuit
 *   (heure de Paris) qui vient ;
 * - service : ouvert, ou en pause jusqu'à `reopensAt` (plafond du jour :
 *   minuit, heure de Paris ; du mois : minuit du jour du renouvellement) ;
 * - remainingToday : ce que la personne peut encore lancer aujourd'hui, le
 *   plus petit de sa part et de ce que le service peut encore servir
 *   (converti prudemment en photos par le serveur). */
export interface SearchCapacityStatus {
  user: { used: number; limit: number; remaining: number; resetsAt: string };
  service: { status: "open" } | { status: "paused"; reason: Exclude<SearchCapacityLimit, "user">; reopensAt: string };
  remainingToday: number;
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Lit le compteur sans lui faire confiance ; null si la forme est mauvaise (l'app n'affiche alors rien). */
export function parseSearchCapacityStatus(value: unknown): SearchCapacityStatus | null {
  const user = fieldOf(value, "user");
  const [used, limit, remaining, resetsAt] = ["used", "limit", "remaining", "resetsAt"].map((key) => fieldOf(user, key));
  const remainingToday = fieldOf(value, "remainingToday");
  if (!isCount(used) || !isCount(limit) || !isCount(remaining) || !isInstant(resetsAt) || !isCount(remainingToday)) return null;
  const parsedUser = { used, limit, remaining, resetsAt };
  const service = fieldOf(value, "service");
  const status = fieldOf(service, "status");
  if (status === "open") return { user: parsedUser, service: { status }, remainingToday };
  const reason = fieldOf(service, "reason");
  const reopensAt = fieldOf(service, "reopensAt");
  if (status !== "paused" || (reason !== "day" && reason !== "month") || !isInstant(reopensAt)) return null;
  return { user: parsedUser, service: { status, reason, reopensAt }, remainingToday };
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

/** Corps de POST /api/searches/:id/text (voie B, lot c) : une recherche
 * Google Shopping avec les mots de la personne, ajoutée à la MÊME recherche,
 * une seule fois. `words` : SEARCH_QUERY_MAX_LENGTH caractères au plus. Les
 * mots ne sont ni enregistrés, ni journalisés, ni mis en cache. */
export interface RunTextSearchRequest {
  words: string;
}

/** Refus propres à la recherche par mots (le plafond des recherches garde
 * ses codes, SEARCH_CAPACITY_ERRORS) :
 * - alreadyUsed : déjà lancée pour cette recherche (409) — l'app retire
 *   l'invitation ;
 * - unavailable : fonction coupée sur le serveur (404) ;
 * - notAllowed : recherche non admissible, ou budget de la photo épuisé (409). */
export const TEXT_SEARCH_ERRORS = {
  alreadyUsed: "text_search_already_used",
  unavailable: "text_search_unavailable",
  notAllowed: "text_search_not_allowed",
} as const;

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

/** Réponse de POST /api/vault. `alreadyInVault` : la même proposition du
 * Spotter était déjà dans le Vault de la personne — c'est cette pièce qui
 * est renvoyée et rien n'est créé (un second « Je l'ai achetée » ne fait
 * plus de doublon). Absent d'un ancien serveur. */
export interface CreateVaultItemResponse extends VaultItem {
  alreadyInVault?: boolean;
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
  /** Sa proposition d'origine est déjà dans le Vault de la personne : la
   * fiche affiche « Ajoutée au Vault » au lieu de « Je l'ai achetée ».
   * Absent d'un ancien serveur. */
  inVault?: boolean;
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
  // « projet-2026-10-27 » (petit lot 2) : les mots tapés ne sont envoyés ni à
  // SerpApi ni à Google, ni enregistrés ; sous une photo, notre serveur s'en
  // sert seulement pour trier les propositions — simple information, sans
  // nouvelle acceptation ni message (décision du fondateur du 2026-10-27).
  // « projet-2026-11-05 » (lot politique exacte) : la voie C décrite
  // interrupteurs allumés — recherche de la même pièce dans d'autres boutiques
  // (une IA d'Anthropic lit les titres et les sites des premiers résultats,
  // jamais l'image ni les mots, sans consentement), « Que cherchez-vous ? »
  // (les mots partent vers SerpApi puis Google Shopping), cache commun de 24 h,
  // aucun identifiant du compte transmis à SerpApi ni à Google — simple
  // information, sans nouvelle acceptation, AVEC le court message promis par
  // la section « Modifications » (POLICY_UPDATE_NOTICE ci-dessous). Textes du
  // document pour l'avocat du 2026-11-05 ; à valider par le fondateur.
  privacy_policy: "projet-2026-11-05",
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
  privacy_policy: ["projet-2026-09-25", "projet-2026-09-29", "projet-2026-09-30", "projet-2026-09-30-b", "projet-2026-10-05", "projet-2026-10-05-b", "projet-2026-10-06", "projet-2026-10-25", "projet-2026-10-27", "projet-2026-11-05"],
  age_declaration: [CONSENT_VERSIONS.age_declaration],
  analytics: [CONSENT_VERSIONS.analytics],
  analyse_video_ia: [CONSENT_VERSIONS.analyse_video_ia],
};

/** Information à montrer une fois aux personnes connectées après une mise à
 * jour qui ne demande pas de nouvelle acceptation (un identifiant par
 * information, pour ne la montrer qu'une fois). */
export const POLICY_UPDATE_NOTICE = {
  // Version « projet-2026-11-05 » (voie C) : nouvel identifiant, donc montré
  // une fois à toute personne qui a accepté une version antérieure, même si
  // elle avait déjà vu l'information précédente. Remplace l'information du
  // 2026-09-30 (serveur en Europe, erreurs, statistiques), elle-même venue
  // après celle du 2026-09-29 : un seul message à la fois, le plus récent ; le
  // lien mène à la politique entière, qui contient les deux.
  id: "politique-2026-11-05-boutiques-et-mots",
  document: "privacy_policy" as LegalDocumentType,
  /** Versions dont le texte contient déjà cette information : la
   * personne qui en a accepté une ne voit pas le message. */
  alreadyCovered: ["projet-2026-11-05"] as readonly string[],
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

/** « piece » (lot 5) : une pièce reçue d'une autre personne. « message »
 * (lot messages) : un message reçu dans une conversation. « collection »
 * (lot modération des collections, migration 0034) : une collection qu'un
 * ami vous montre. */
export type ReportTargetType = "user" | "post" | "comment" | "piece" | "message" | "collection";
export const REPORT_TARGET_TYPES = ["user", "post", "comment", "piece", "message", "collection"] as const satisfies readonly ReportTargetType[];
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
 * image copiée par Spotto (lot 5 : définitif, le fichier est effacé) ;
 * retirer la bio ou la photo d'un profil (lot modération des profils,
 * migration 0037 : définitif aussi). */
export type ModerationActionType = "dismiss" | "hide" | "suspend" | "restore" | "unsuspend" | "remove_image" | "remove_bio" | "remove_avatar";
export const MODERATION_ACTION_TYPES = [
  "dismiss",
  "hide",
  "suspend",
  "restore",
  "unsuspend",
  "remove_image",
  "remove_bio",
  "remove_avatar",
] as const satisfies readonly ModerationActionType[];
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
  | {
      kind: "message";
      author: ModerationAuthor;
      text: string | null;
      /** Titre de l'envie jointe, sinon null. */
      wishTitle: string | null;
      createdAt: string;
      hidden: boolean;
      /** Le message signalé et quelques messages autour (jamais toute la conversation). */
      context: ModerationMessageContext[];
    }
  | {
      kind: "collection";
      author: ModerationAuthor;
      name: string;
      visibility: CollectionVisibility;
      itemCount: number;
      /** Les envies les plus récemment ajoutées (MODERATION_COLLECTION_PREVIEW_ITEMS
       * au plus), telles que les amis les voient : titre et copie de l'image. */
      items: ModerationCollectionItem[];
      createdAt: string;
      /** Masquée par la modération : les amis ne la voient plus. */
      hidden: boolean;
    }
  | { kind: "missing" };

/** Envies montrées dans l'aperçu d'une collection signalée. */
export const MODERATION_COLLECTION_PREVIEW_ITEMS = 6;

/** Une envie d'une collection signalée (vue de la modération). */
export interface ModerationCollectionItem {
  /** L'envie dans la collection (à donner pour retirer la copie de son image). */
  id: string;
  title: string;
  /** Copie faite par Spotto (miniature) ; null sans copie, ou après un retrait. */
  imageUrl: string | null;
  /** Copie retirée par la modération : les amis voient « Image indisponible ». */
  imageRemoved: boolean;
  /** Une copie est en place : « Retirer l'image » est proposé. */
  canRemoveImage: boolean;
}

/** Un message de l'extrait montré à la modération autour d'un message signalé. */
export interface ModerationMessageContext {
  authorUsername: string;
  text: string | null;
  wishTitle: string | null;
  createdAt: string;
  /** Le message signalé lui-même. */
  reported: boolean;
  hidden: boolean;
}

/** Messages lus avant et après un message signalé (vue de la modération). */
export const MODERATION_MESSAGE_CONTEXT = 2;

export interface ModerationLogEntry {
  id: string;
  action: ModerationActionType;
  reason: ModerationReason | null;
  note: string | null;
  createdAt: string;
  /** Administrateur qui a pris la décision (visible des seuls administrateurs). */
  adminUsername: string | null;
  /** Chantier 3 : décision prise automatiquement (masquage après plusieurs
   * signalements de personnes différentes), sans administrateur. */
  automatic: boolean;
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
  /** Chantier 3 : ce masquage est automatique (plusieurs signalements), en
   * attente de décision. « Masquer » le confirme ; « Classer sans suite » le
   * lève et rétablit le contenu. */
  activeHideAutomatic: boolean;
  /** Suspension en vigueur du compte concerné (à lever), sinon null. */
  activeSuspendActionId: string | null;
  /** Lot 5 : l'image est une copie faite par Spotto (publication « envie »,
   * pièce envoyée), encore en place — elle peut être retirée. */
  canRemoveImage: boolean;
  /** Lot modération des profils (migration 0037) : profil signalé dont la bio
   * peut être retirée (il en a une, et la base a la migration). */
  canRemoveBio: boolean;
  /** Idem pour sa photo de profil. */
  canRemoveAvatar: boolean;
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

/** Contenus dont l'image peut être une copie faite par Spotto (lot 5) ; lot
 * modération des collections : la copie de l'image d'une envie d'une
 * collection montrée aux amis. */
export const IMAGE_REMOVAL_TARGET_TYPES = ["post", "piece", "collection"] as const satisfies readonly ReportTargetType[];

/** Retirer l'image copiée d'une publication « envie », d'une pièce envoyée
 * (lot 5) ou d'une envie d'une collection : motif neutre fixé par le serveur,
 * note facultative. Le serveur efface d'abord le fichier ; s'il n'y parvient
 * pas, rien n'est changé. */
export interface RemoveImageRequest {
  targetType: (typeof IMAGE_REMOVAL_TARGET_TYPES)[number];
  /** Le contenu signalé (pour une collection : la collection). */
  targetId: string;
  /** Collection seulement (obligatoire) : l'envie de la collection dont la
   * copie est retirée (ModerationCollectionItem.id). */
  itemId?: string;
  note?: string;
}

/** Lot modération des profils (migration 0037 ; règle 1.2 d'Apple) : ce
 * qu'un administrateur peut retirer d'un profil. */
export const PROFILE_PARTS = ["bio", "avatar"] as const;
export type ProfilePart = (typeof PROFILE_PARTS)[number];

/** Retirer la bio ou la photo d'un profil : motif obligatoire (comme masquer
 * ou suspendre), note facultative montrée à la personne. Définitif. Pour la
 * photo, le serveur efface d'abord le fichier ; s'il n'y parvient pas, rien
 * n'est changé. */
export interface RemoveProfilePartRequest {
  userId: string;
  part: ProfilePart;
  reason: ReportReason;
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

// --- Lot « app iPhone prête » (chantier 4, point 11) : mise à jour obligatoire ---

/** En-tête par lequel l'app iPhone donne son numéro de build (CFBundleVersion)
 * à chaque appel du serveur. Le site ne l'envoie jamais. */
export const APP_BUILD_HEADER = "x-spotto-build";

/** Code d'erreur (réponse 426) : ce build est sous le minimum réglé sur le serveur. */
export const UPDATE_REQUIRED_ERROR = "update_required";

/** Réponse 426 : l'adresse de Spotto sur l'App Store, quand elle est réglée. */
export interface UpdateRequiredErrorBody extends ApiErrorBody {
  storeUrl?: string | null;
}

/** GET /api/app/version (sans compte) : build minimal exigé de l'app iPhone
 * (null : aucun minimum, réglage par défaut) et adresse de la fiche App Store. */
export interface AppVersionInfo {
  ios: {
    minimumBuild: number | null;
    storeUrl: string | null;
  };
}

// ---- Messages privés (lot messages, migration 0032) ----
// Deux amis (chacun suit l'autre) s'écrivent directement. Sinon, UNE
// invitation : la personne l'accepte (la conversation s'ouvre), la refuse
// (elle disparaît pour elle ; pas de nouvelle invitation pendant 30 jours)
// ou bloque. Texte seul, et une envie jointe en option.

/** Longueur maximale d'un message (texte). */
export const MESSAGE_MAX_LENGTH = 1000;
/** Le compteur de caractères s'affiche à partir de cette longueur. */
export const MESSAGE_COUNTER_FROM = 900;
/** Après un refus, pas de nouvelle invitation à cette personne pendant ce délai. */
export const INVITATION_DECLINE_COOLDOWN_DAYS = 30;

/** GET /api/messages/status : la messagerie est-elle disponible sur le
 * serveur (migration 0032 appliquée), et combien de conversations ont un
 * message non lu (invitations comprises). `push` : les notifications sur le
 * téléphone sont allumées sur le serveur (PUSH_ENABLED et migration 0035) ;
 * absent chez un serveur plus ancien (lu comme faux). */
export interface MessagesStatus {
  enabled: boolean;
  unreadCount: number;
  push?: boolean;
}

// ---- Notifications des nouveaux messages sur le téléphone (migration 0035) ----

/** Systèmes d'un appareil enregistré pour les notifications. */
export const PUSH_PLATFORMS = ["ios", "android"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Forme d'un jeton de notification d'Expo : « ExponentPushToken[…] » ou
 * « ExpoPushToken[…] », lettres, chiffres, « - » et « _ » entre crochets. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_PUSH_TOKEN_PATTERN.test(value);
}

/** PUT /api/me/push-token : enregistrer (ou rafraîchir) l'appareil.
 * Lot alertes prix (migration 0036), une réponse par sorte, sur CET appareil :
 * - `messages` : reçoit-il les notifications des nouveaux messages ? false
 *   le garde pour les seules alertes. Absent : inchangé pour un appareil déjà
 *   enregistré, oui pour un nouveau (comme avant) ;
 * - `alerts` : reçoit-il les notifications des alertes prix et stock ?
 *   Absent : inchangé pour un appareil déjà enregistré, non pour un nouveau
 *   (jamais d'alerte sans la réponse « Activer » donnée pour elles).
 * Les deux à false : l'appareil est oublié. Un serveur sans 0036 ne sait pas
 * garder un appareil pour les seules alertes : `messages: false` l'oublie. */
export interface RegisterPushTokenRequest {
  token: string;
  platform: PushPlatform;
  messages?: boolean;
  alerts?: boolean;
}

/** DELETE /api/me/push-token : oublier cet appareil (déconnexion, notifications coupées). */
export interface DeletePushTokenRequest {
  token: string;
}

/** Codes d'erreur propres aux messages. */
export const MESSAGES_ERRORS = {
  /** Migration 0032 absente (404) : l'app cache les messages. */
  unavailable: "messages_unavailable",
  /** Invitation déjà envoyée, en attente de réponse (409). */
  invitationPending: "invitation_pending",
  /** La personne n'accepte pas de message de vous (403). */
  notAccepting: "recipient_not_accepting",
} as const;

/** Une envie jointe à un message : l'image est la copie faite par Spotto
 * (jamais l'adresse du marchand), le lien est un lien web ordinaire. */
export interface MessageWishCard {
  title: string;
  imageUrl: string;
  imageThumbUrl: string;
  merchantName: string | null;
  merchantUrl: string | null;
  /** Lien affilié (mention obligatoire). */
  isAffiliate: boolean;
  productMatchId: string | null;
  priceMin: number | null;
  currency: string | null;
}

export interface ChatMessage {
  id: string;
  /** Envoyé par la personne qui lit. */
  mine: boolean;
  text: string | null;
  wish: MessageWishCard | null;
  createdAt: string;
}

/** État d'une conversation, vu par la personne qui la lit :
 * - open : conversation ouverte ;
 * - invitation_sent : vous avez invité, en attente de réponse ;
 * - invitation_received : on vous invite (section « Invitations ») ;
 * - new : aucune conversation visible pour vous (premier message à écrire). */
export type ConversationState = "open" | "invitation_sent" | "invitation_received" | "new";

/** Ce que la personne qui lit peut écrire :
 * - direct : envoyer librement ;
 * - invitation : le prochain message est une invitation (une seule) ;
 * - waiting : invitation envoyée, en attente de réponse ;
 * - answer : invitation reçue, à accepter, refuser ou bloquer ;
 * - not_allowed : la personne n'accepte pas de message de vous. */
export type ConversationSendMode = "direct" | "invitation" | "waiting" | "answer" | "not_allowed";

export interface ConversationLastMessage {
  text: string | null;
  hasWish: boolean;
  mine: boolean;
  /** Masqué par la modération, ou signalé par vous : son texte n'est pas montré. */
  hidden: boolean;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  other: PostAuthor;
  state: Exclude<ConversationState, "new">;
  lastMessage: ConversationLastMessage | null;
  lastMessageAt: string;
  unread: boolean;
}

/** GET /api/conversations : conversations (ouvertes et invitations
 * envoyées), et invitations reçues (première page seulement). */
export interface ConversationsPage {
  conversations: ConversationSummary[];
  invitations: ConversationSummary[];
  nextCursor: string | null;
}

/** Une conversation et ses messages (du plus ancien au plus récent). `id`
 * null : pas encore de conversation avec cette personne. */
export interface ConversationThread {
  id: string | null;
  other: PostAuthor;
  state: ConversationState;
  sendMode: ConversationSendMode;
  messages: ChatMessage[];
  /** Des messages plus anciens restent à charger. */
  hasOlder: boolean;
}

/** POST /api/messages : à une personne (la conversation est trouvée ou
 * créée par le serveur). Un texte, une carte (`wishId`, une de vos Envies,
 * `collectionItemId`, une envie d'une de ses collections, ou `matchId`, un
 * résultat d'une de vos recherches), ou les deux. Une seule carte à la fois. */
export interface SendMessageRequest {
  recipientId: string;
  text?: string;
  wishId?: string;
  /** Lot collections : une envie d'une collection de la personne à qui vous
   * écrivez (« En parler »), au lieu d'une de vos Envies. */
  collectionItemId?: string;
  /** « Envoyer à un ami » depuis l'écran Résultat : une proposition d'une de
   * vos recherches (product_matches), sans la garder dans vos Envies. */
  matchId?: string;
}

export interface SendMessageResponse {
  conversationId: string;
  message: ChatMessage;
  state: ConversationState;
  sendMode: ConversationSendMode;
}

// ---- Collections d'envies (lot collections, migration 0033) ----
// Un membre range ses envies dans des collections nommées. Une collection
// est privée par défaut ; « Mes amis » la montre aux membres qui le suivent
// et qu'il suit (les mêmes amis que pour les messages). Les amis voient le
// titre, la copie de l'image faite par Spotto, le prix et le lien vers la
// boutique — jamais l'image du marchand elle-même.

/** Longueur maximale du nom d'une collection. */
export const COLLECTION_NAME_MAX_LENGTH = 40;
/** Nombre maximal de collections par membre. */
export const COLLECTIONS_MAX = 50;
/** Nombre maximal d'envies dans une collection. */
export const COLLECTION_ITEMS_MAX = 100;

/** Qui voit une collection : vous seul, ou vos amis. */
export type CollectionVisibility = "private" | "friends";
export const COLLECTION_VISIBILITIES = ["private", "friends"] as const satisfies readonly CollectionVisibility[];
export const DEFAULT_COLLECTION_VISIBILITY: CollectionVisibility = "private";

/** GET /api/collections/status : les collections sont-elles disponibles sur
 * le serveur (migration 0033 appliquée) ? Sinon l'app les cache toutes. */
export interface CollectionsStatus {
  enabled: boolean;
  /** Lot modération des collections (migration 0034) : une collection d'un
   * ami peut être signalée. Faux (ou absent : ancien serveur) : l'app cache
   * « Signaler ». Le serveur l'envoie toujours. */
  reportable?: boolean;
}

/** Codes d'erreur propres aux collections. */
export const COLLECTIONS_ERRORS = {
  /** Migration 0033 absente (404) : l'app cache les collections. */
  unavailable: "collections_unavailable",
  /** Collection inexistante, d'un autre, ou pas visible pour vous (404). */
  notFound: "collection_not_found",
  /** 50 collections déjà (409). */
  limit: "collection_limit",
  /** 100 envies déjà dans la collection (409). */
  full: "collection_full",
  /** Masquée par la modération : elle ne peut pas être remontrée aux amis (409). */
  hidden: "collection_hidden",
} as const;

/** Une de vos collections. */
export interface CollectionSummary {
  id: string;
  name: string;
  visibility: CollectionVisibility;
  itemCount: number;
  createdAt: string;
  /** Lot modération des collections : masquée par la modération (vos amis ne
   * la voient plus ; « Mes amis » est refusé tant qu'elle l'est). Absent
   * (ancien serveur) : non. Le serveur l'envoie toujours. */
  hidden?: boolean;
}

export interface CollectionsList {
  collections: CollectionSummary[];
}

export interface CreateCollectionRequest {
  name: string;
}

/** Renommer et/ou changer la visibilité. */
export interface UpdateCollectionRequest {
  name?: string;
  visibility?: CollectionVisibility;
}

/** Les collections qui contiennent une envie (GET et PUT
 * /api/wishlist/:id/collections). */
export interface WishCollections {
  collectionIds: string[];
}

/** Une collection d'un ami, sur son profil. */
export interface SharedCollectionSummary {
  id: string;
  name: string;
  itemCount: number;
  /** Couverture : la copie Spotto de l'image de la première envie, ou null. */
  coverUrl: string | null;
}

export interface SharedCollectionsList {
  collections: SharedCollectionSummary[];
}

/** Une envie d'une collection d'un ami. L'image est toujours la copie faite
 * par Spotto ; null si la copie n'a pas pu être faite (« Image indisponible »). */
export interface SharedCollectionItem {
  id: string;
  title: string;
  imageUrl: string | null;
  imageThumbUrl: string | null;
  merchantName: string | null;
  /** Lien à ouvrir : affilié s'il existe, sinon le lien marchand ; null sans lien web. */
  merchantUrl: string | null;
  /** Lien affilié (mention obligatoire). */
  isAffiliate: boolean;
  productMatchId: string | null;
  priceMin: number | null;
  currency: string | null;
  addedAt: string;
}

/** GET /api/collections/:id/shared : une collection d'un ami, ses envies
 * (les plus récemment ajoutées d'abord). */
export interface SharedCollectionPage {
  collection: { id: string; name: string; itemCount: number; owner: PostAuthor };
  items: SharedCollectionItem[];
  nextCursor: string | null;
}

/** POST /api/collection-items/:id/keep : « Garder » une envie d'un ami. */
export interface KeepSharedItemResponse {
  item: WishlistItem;
  /** Déjà dans vos Envies : rien n'a été ajouté. */
  alreadyKept: boolean;
}

// ---- Alertes prix et stock (lot 2, migration 0036) ----
// Une envie surveillée (la cloche) prévient son membre quand une recherche
// ou un achat fait dans Spotto montre la même pièce (même boutique, même
// produit) moins chère, ou de retour en stock. Aucune surveillance en tâche
// de fond : seulement les recherches que les membres font déjà. Jamais qui a
// cherché, acheté ou signalé.

/** « Épuisé » est construit côté serveur mais caché dans l'app (décision du
 * fondateur du 9 novembre 2026) : il ne part que sur un « in_stock: false »
 * explicite de Google, jamais observé jusqu'ici. */
export const SOLD_OUT_ALERTS_VISIBLE = false;

/** Les trois sortes d'alertes. */
export const WISH_ALERT_KINDS = ["price_drop", "restock", "sold_out"] as const;
export type WishAlertKind = (typeof WISH_ALERT_KINDS)[number];

/** Dernier état de stock connu d'une pièce suivie. */
export const STOCK_STATES = ["unknown", "in_stock", "sold_out"] as const;
export type StockState = (typeof STOCK_STATES)[number];

/** États d'une alerte (wish_alert_events.status) : en attente, envoyée,
 * expirée (72 h sans envoi), périmée (la baisse ou le stock a disparu avant
 * l'envoi), limitée (anti-répétition), désactivée (interrupteur ou cloche coupés). */
export const WISH_ALERT_STATUSES = ["pending", "sent", "expired", "stale", "limited", "disabled"] as const;
export type WishAlertStatus = (typeof WISH_ALERT_STATUSES)[number];

/** Règles chiffrées des alertes (tenues par la base, migration 0036). */
export const WISH_ALERT_RULES = {
  /** Une alerte est due dès sa création (décision du fondateur : « à la
   * seconde près ») : envoyée juste après l'observation qui l'a créée, en
   * arrière-plan après la réponse ; sinon (pas d'appareil, notifications
   * coupées, limites) au prochain passage d'envoi. */
  sendDelayHours: 0,
  /** Au-delà, une alerte jamais envoyée expire. */
  expiryHours: 72,
  /** Au plus une alerte envoyée par envie et par sorte sur ce nombre de jours. */
  perWishKindDays: 7,
  /** Au plus ce nombre d'alertes envoyées par personne et par jour (heure de Paris). */
  perPersonPerDay: 5,
  /** « Plus disponible » : signalements par membre et par jour (heure de Paris). */
  stockReportsPerDay: 20,
  /** « Je l'ai achetée » ne vaut pas « disponible » quand l'acheteur a lui-même
   * signalé la pièce « Plus disponible » dans ce nombre de jours (jamais de
   * faux « De retour en stock » fabriqué par un seul membre). */
  purchaseAfterOwnReportDays: 30,
  /** Alertes et signalements effacés au bout de ce nombre de jours. */
  retentionDays: 30,
} as const;

// ---- Devises : LA table de l'app et du serveur ----
// Une seule table des écritures d'une devise, partagée par les alertes
// (alertCurrency), la mesure et le classement de Lens (services/lensMeasure.ts),
// Google Shopping (services/textSearch.ts), le tri des résultats
// (mobile lib/result-sort.ts) et « Boutique à l'étranger » (mobile
// lib/foreign-shop.ts). Jamais de copie ailleurs : une écriture ajoutée ici
// vaut partout à la fois.

/** Écritures d'une devise vues chez Google (Lens écrit souvent un symbole,
 * Google Shopping un code) → code ISO. Table FERMÉE : toute autre écriture
 * vaut « devise inconnue », donc aucune comparaison de prix. « $ » seul n'y
 * est pas : voir alertCurrency. */
export const ALERT_CURRENCY_MARKS: Readonly<Record<string, string>> = {
  "€": "EUR",
  "£": "GBP",
  US$: "USD",
  $US: "USD",
  $CA: "CAD",
  CA$: "CAD",
  $AU: "AUD",
  $MX: "MXN",
};

/** Devise d'un prix pour les alertes : le code ISO, ou null (devise inconnue
 * ou ambiguë : aucune comparaison). `country` : pays de la recherche. Un
 * « $ » seul n'est le dollar américain que pour une recherche aux États-Unis.
 * Les espaces sont retirées (une colonne char(3) renvoie « €  »). */
export function alertCurrency(raw: string | null | undefined, country: string | null): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  const mark = ALERT_CURRENCY_MARKS[text] ?? ALERT_CURRENCY_MARKS[text.toUpperCase()];
  if (mark) return mark;
  if (text === "$") return country === "us" ? "USD" : null;
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

/** Devise de chaque pays de recherche connu (les quatre pays du domaine de
 * Google, serpapi.ts) ; un autre pays : devise inconnue ici. */
export const COUNTRY_CURRENCIES: Readonly<Record<string, string>> = { fr: "EUR", gb: "GBP", ch: "CHF", us: "USD" };

/** Le prix est-il dans la devise du pays de la recherche ? null : la devise
 * de ce pays n'est pas connue ici. Sans devise lisible : non. */
export function isCountryCurrency(raw: string | null | undefined, country: string): boolean | null {
  const local = COUNTRY_CURRENCIES[country];
  if (!local) return null;
  return alertCurrency(raw, country) === local;
}

/** GET /api/alerts/status : les alertes sont-elles disponibles (migration
 * 0036 appliquée) ? Faux : l'app cache la cloche, l'interrupteur et « Plus
 * disponible ». `enabled` : l'interrupteur « Alertes prix et stock » de la
 * personne (coupé par défaut). `push` : les notifications sur le téléphone
 * sont allumées sur le serveur (PUSH_ENABLED et migration 0035) ; faux : les
 * alertes sont enregistrées mais ne partent pas encore. */
export interface WishAlertsStatus {
  available: boolean;
  enabled: boolean;
  push: boolean;
}

/** PUT /api/alerts/settings : l'interrupteur des Réglages. */
export interface UpdateWishAlertsSettingsRequest {
  enabled: boolean;
}

/** La cloche d'une envie. `trackable` : la pièce a une clé (lien de boutique
 * reconnu) ; sinon, ni cloche ni « Plus disponible ». `bought` : la pièce est
 * dans votre Vault (« Je l'ai achetée ») ; aucune alerte ne part pour elle,
 * la cloche est cachée. `stock` : le dernier état connu, en direct (décision
 * du fondateur : le savoir tout de suite est le but) ; jamais qui a cherché,
 * acheté ou signalé la pièce. */
export interface WishAlertState {
  wishlistItemId: string;
  trackable: boolean;
  bought: boolean;
  priceDrop: boolean;
  restock: boolean;
  soldOut: boolean;
  stock: StockState;
}

/** GET /api/alerts/wishes : la cloche de chacune de vos envies suivies. */
export interface WishAlertStatesList {
  items: WishAlertState[];
}

/** PUT /api/wishlist/:id/alerts. Tout à false : la cloche est retirée.
 * `enableAlerts` : allume aussi l'interrupteur général (première cloche,
 * après la feuille d'explication des notifications). */
export interface UpdateWishAlertRequest {
  priceDrop: boolean;
  restock: boolean;
  soldOut?: boolean;
  enableAlerts?: boolean;
}

export interface UpdateWishAlertResponse {
  state: WishAlertState;
  status: WishAlertsStatus;
}

/** POST /api/alerts/stock-reports : « Plus disponible », sur un résultat
 * d'une de vos recherches OU sur une de vos envies (exactement un des deux). */
export type StockReportRequest = { productMatchId: string; wishlistItemId?: never } | { wishlistItemId: string; productMatchId?: never };

/** Codes d'erreur propres aux alertes. */
export const WISH_ALERT_ERRORS = {
  /** Migration 0036 absente (404) : l'app cache tout. */
  unavailable: "alerts_unavailable",
  /** La pièce n'a pas de clé (422) : ni cloche ni « Plus disponible ». */
  notTrackable: "alert_not_trackable",
  /** 20 signalements « Plus disponible » déjà aujourd'hui (429). */
  reportLimit: "stock_report_limit",
  /** La pièce est dans votre Vault (422) : pas de cloche, aucune alerte ne partirait. */
  bought: "alert_wish_bought",
} as const;

/** Sorte des données jointes à une notification d'alerte. */
export const WISH_ALERT_PUSH_KIND = "wish_alert";

/** Données d'une notification d'alerte : `wishlistItemId` quand elle ne
 * concerne qu'une envie (toucher ouvre sa fiche) ; absent pour une
 * notification groupée (toucher ouvre vos Envies). Rien d'autre. */
export interface WishAlertPushData {
  kind: typeof WISH_ALERT_PUSH_KIND;
  wishlistItemId?: string;
}

const PUSH_DATA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les données d'une notification d'alerte, ou null si ce n'en est pas une
 * (ou si elles sont illisibles). */
export function parseWishAlertPushData(data: unknown): WishAlertPushData | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.kind !== WISH_ALERT_PUSH_KIND) return null;
  const id = record.wishlistItemId;
  if (id === undefined) return { kind: WISH_ALERT_PUSH_KIND };
  return typeof id === "string" && PUSH_DATA_UUID.test(id) ? { kind: WISH_ALERT_PUSH_KIND, wishlistItemId: id } : null;
}

// ---- Nom du produit (lot « nom et identifiants configurables ») ----
// Le nom et les identifiants qui en dépendent sont écrits à UN seul endroit :
// packages/shared-types/marque.json (voir MARQUE.md à la racine du dépôt).
// L'app (apps/mobile/src/constants/brand.ts), le serveur
// (apps/backend/src/lib/brand.ts) et la configuration Expo
// (apps/mobile/app.config.js) lisent ce fichier ; rien n'est recopié ici.

/** Nom du produit pour un nom de fichier (« Spotto » → « spotto ») :
 * minuscules, sans accent, tirets à la place de tout autre signe. */
export function brandFileSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "app" : slug;
}
