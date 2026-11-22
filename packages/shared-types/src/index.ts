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
  /** Réglage « Confirmations de lecture » (lot « messages vus », migration
   * 0043), allumé par défaut. Éteint : l'autre membre ne voit plus « Vu »
   * pour vos lectures, et vous ne voyez plus les siennes. Rallumé : seules vos
   * lectures faites à partir de ce moment sont montrées, jamais celles faites
   * pendant qu'il était éteint. Absent : le serveur ne propose pas les
   * confirmations de lecture (migration 0043 absente, ou serveur plus ancien) ;
   * l'app ne montre alors pas le réglage. */
  readReceipts?: boolean;
  /** Compte privé (migration 0045) ; absent tant que la migration manque :
   * l'app cache alors le réglage. */
  isPrivate?: boolean;
  /** Demandes d'abonnement reçues, en attente (migration 0045). */
  followRequestsCount?: number;
  /** Qui peut vous mentionner (migration 0046) ; absent tant que la migration manque : l'app cache alors le réglage. */
  mentionsFrom?: MentionsFrom;
  /** Le lien affiché sous votre bio, ou null (migration 0049) ; absent tant que la migration manque : l'app cache alors le champ. */
  linkUrl?: string | null;
  /** « Proposer mon compte aux autres membres » (migration 0050) ; absent tant que la migration manque : l'app cache alors le réglage. */
  discoverable?: boolean;
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

/** PUT /api/me/read-receipts : réglage « Confirmations de lecture ». */
export interface UpdateReadReceiptsRequest {
  readReceipts: boolean;
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
  /** Lien en bio (migration 0049) : absent, le lien ne change pas ; null ou "" le retire. */
  linkUrl?: string | null;
}

// Bio du profil (lot « profil et icône des réglages ») : 160 caractères et
// 3 lignes au plus. Mêmes règles dans l'app (compteur) et au serveur (seul juge).
export const BIO_MAX_LENGTH = 160;
export const BIO_MAX_LINES = 3;

/** Retire une moitié d'émoji restée seule en fin de texte (coupure à N caractères). */
function withoutBrokenEnd(text: string): string {
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

// Revue de sécurité du 12 novembre 2026 : tout ce qui fait un retour à la
// ligne compte pour une ligne (retour Windows, tabulation verticale, saut de
// page, et les séparateurs Unicode « ligne suivante » U+0085, « ligne »
// U+2028 et « paragraphe » U+2029, qui coupent la ligne sur iPhone), et les
// caractères de contrôle, invisibles, ne sont jamais gardés (la base refuse
// le caractère nul).
const LINE_BREAKS = /\r\n?|[\u000B\u000C\u0085\u2028\u2029]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

/** Retours à la ligne de toute sorte ramenés à « \n », caractères de contrôle retirés (la tabulation reste). */
function withPlainLineBreaks(text: string): string {
  return text.replace(LINE_BREAKS, "\n").replace(CONTROL_CHARACTERS, "");
}

/** Texte d'une seule ligne (nom affiché) : retours à la ligne et tabulations
 * remplacés par une espace, caractères de contrôle retirés, espaces retirés
 * au début et à la fin. */
export function singleLine(text: string): string {
  return withPlainLineBreaks(text).replace(/[\n\t]+/g, " ").trim();
}

/** Bio telle qu'enregistrée : retours à la ligne unifiés (withPlainLineBreaks),
 * espaces de fin de ligne retirés, plusieurs lignes vides de suite réduites à
 * une seule, puis espaces et lignes vides retirés au début et à la fin. */
export function normalizeBio(text: string): string {
  return withPlainLineBreaks(text)
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
  const lines = withPlainLineBreaks(text).replace(/\n{3,}/g, "\n\n").split("\n");
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
// « oembed » : valeur de la base gardée pour relire les recherches d'avant le
// 12 novembre 2026 (image de la vidéo demandée à la plateforme : voie
// retirée) ; plus aucune recherche n'est créée avec.
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
  /** Boutiques douteuses (lot « recherche confiance ») : une mention neutre
   * sur la carte (OFFER_MARKS). Absente (aucune mention, ancien serveur) :
   * rien à afficher. Une app plus ancienne l'ignore. */
  offerMark?: OfferMark;
  /** « Cette pièce dans d'autres boutiques » (origine « shopping »)
   * seulement : le serveur a rangé l'offre en fin de section (prix
   * inhabituellement bas, ou adresse douteuse, qui n'a pas de mention).
   * Jamais affiché : la grande carte prise dans cette section ne la choisit
   * pas. Envoyé seulement quand il est vrai ; absent (ancien serveur, autres
   * sections) = non. Une app plus ancienne l'ignore. */
  demoted?: true;
}

/** Mentions d'une offre, calculées par le serveur (apps/backend/src/lib/shopTrust.ts) :
 * - official_shop : site officiel de la marque (« Boutique officielle de la
 *   marque ») ;
 * - known_shop : boutique de la liste des boutiques connues (« Boutique connue ») ;
 * - unusual_price : prix très inférieur à ceux des autres offres de la même
 *   recherche (« Prix inhabituellement bas »), un constat, jamais une accusation.
 * Les mentions ne rangent que « Cette pièce dans d'autres boutiques » (origine
 * « shopping ») : boutique officielle de la marque de la pièce en tête, quand
 * le serveur l'a reconnue (toute autre est rangée comme une boutique
 * connue), boutiques connues un peu remontées, prix inhabituellement bas en fin. Ailleurs, chaque proposition
 * garde sa place, avec sa mention (décision du fondateur, 21 novembre 2026).
 * Les offres des boutiques masquées, et celles qui cumulent un prix très bas
 * et une adresse douteuse, ne sont jamais envoyées. */
export const OFFER_MARKS = ["official_shop", "known_shop", "unusual_price"] as const;
export type OfferMark = (typeof OFFER_MARKS)[number];

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
  /** Adresse publique de la vidéo TikTok ou Instagram jointe à la recherche
   * (sans paramètre de suivi) ; null pour une photo. Jamais une image. */
  sourceUrl: string | null;
  sourcePlatform: PlatformSource;
  method: RecognitionMethod;
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

/** Lot 4, temps 1 bis : analyse automatique d'une vidéo du téléphone. Étage 1
 * sur l'appareil (images nettes et différentes, réduites) ; étage 2 par une
 * IA, seulement avec le consentement « analyse_video_ia ». La vidéo entière ne
 * quitte jamais l'appareil. (Lien TikTok ou Instagram : jusqu'à 16 images,
 * extraites par le service vidéo séparé.) */
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
  /** Part du mois (lot quotas, 0053) : absente d'un serveur sans elle ; null : aucune part du mois pour vous. */
  monthlyQuota?: SearchMonthlyQuota | null;
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

/** Messages enregistrés par le serveur quand une recherche échoue : l'app
 * s'en sert pour distinguer « rien trouvé » (proposer de recadrer) d'une
 * panne (proposer de réessayer). Source unique pour les deux côtés. */
export const SEARCH_FAILURE_MESSAGES = {
  noMatch: "Aucun produit identifié sur cette image.",
  technical: "La recherche visuelle a échoué.",
} as const;

/** Corps de POST /api/searches/prepare. `sourceUrl` (facultatif) : le lien
 * de la vidéo d'où vient la capture. Le serveur n'en garde que l'adresse
 * publique d'une vidéo TikTok ou Instagram reconnue (normalizeVideoLink) ; il
 * ne demande rien à la plateforme et ne récupère aucune image. */
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
  /** Compte privé (migration 0045) ; absent d'un serveur plus ancien. */
  isPrivate?: boolean;
  /** Suivre / Demandé / Abonné(e) (migration 0045) ; absent d'un serveur plus ancien. */
  followState?: FollowState;
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
  /** Compte privé (migration 0045). Pour un visiteur qui n'est pas un abonné
   * accepté, le profil ne montre alors que nom, photo, bio et compteurs. */
  isPrivate?: boolean;
  /** Suivre / Demandé / Abonné(e) (migration 0045). */
  followState?: FollowState;
  /** Son lien en bio (migration 0049) : null s'il n'en a pas ou s'il est
   * suspendu ; absent sans 0049, et pour qui n'est pas un abonné accepté de
   * son compte privé (qui ne reçoit que nom, photo, bio et compteurs). */
  linkUrl?: string | null;
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
  /** Lien à ouvrir : affilié s'il existe, sinon le lien marchand ; null pour une pièce du Vault. */
  merchantUrl: string | null;
  /** true quand `merchantUrl` est un lien affilié (mention obligatoire). */
  isAffiliate: boolean;
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
  /** Toutes les photos, la première comprise, quand il y en a au moins deux (migration 0047). */
  media?: PostPhoto[];
  /** Membres identifiés que ce lecteur peut voir (migration 0047) ; absent quand il n'y en a aucun. */
  people?: PostAuthor[];
  /** Le lecteur a enregistré cette publication (migration 0048) ; absent sans 0048 : l'app cache le signet. */
  viewerHasSaved?: boolean;
  /** Sa collection où elle est rangée, ou null (migration 0048) : vu de lui seul. */
  viewerSavedCollectionId?: string | null;
  /** Épinglée sur le profil depuis cette date, ou null (migration 0049) : sur
   * ses propres publications seulement ; absent sans 0049 (l'app cache l'entrée). */
  pinnedAt?: string | null;
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
  /** Réponse : le commentaire d'origine (migration 0046). Absent ou null : commentaire ordinaire. */
  parentId?: string | null;
  /** « J'aime » du commentaire, sans les comptes en blocage avec le lecteur (migration 0046, « v=2 »). */
  likeCount?: number;
  viewerHasLiked?: boolean;
  /** Mentions à transformer en liens ; tout autre « @pseudo » reste un simple texte. */
  mentions?: CommentMention[];
  /** Réponses montrées à ce lecteur (commentaire d'origine seulement). */
  replyCount?: number;
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
  // « analyse-video-ia-2026-11-15 » (lot « vidéo auto ») : un seul texte pour
  // les deux écrans d'accord, vidéo du téléphone (12 images au plus, la vidéo
  // ne quitte pas l'appareil) ET lien TikTok ou Instagram (vidéo publique
  // récupérée par le service vidéo de Spotto sans être gardée, 16 images au
  // plus). Texte à faire valider par le juriste avant d'allumer l'analyse des liens.
  analyse_video_ia: "analyse-video-ia-2026-11-15",
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
  // La version du 2026-10-06 (vidéo du téléphone seulement) reste valable pour
  // une vidéo du téléphone : personne n'a à accepter de nouveau. Elle ne vaut
  // PAS pour un lien (VIDEO_LINK_CONSENT_VERSIONS ci-dessous).
  analyse_video_ia: ["analyse-video-ia-2026-10-06", CONSENT_VERSIONS.analyse_video_ia],
};

/** Analyse d'un lien TikTok ou Instagram (lot « vidéo auto ») : seuls les
 * accords donnés sur un texte qui parle des liens comptent (le serveur
 * refuse l'analyse sinon, l'app redemande l'accord avec le texte commun). */
export const VIDEO_LINK_CONSENT_VERSIONS: readonly string[] = [CONSENT_VERSIONS.analyse_video_ia];

/** Anciennes versions qu'une app déjà installée peut encore envoyer (POST
 * /api/consents) : l'accord ou le refus est enregistré sous la version
 * ENVOYÉE, celle du texte que la personne a lu, et ne vaut que pour ce que
 * ce texte couvre (une vidéo du téléphone, pas un lien). Toute autre version
 * que celle en vigueur reste refusée. */
export const LEGACY_RECORDABLE_CONSENT_VERSIONS: Partial<Record<VersionedConsentType, readonly string[]>> = {
  analyse_video_ia: ["analyse-video-ia-2026-10-06"],
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
  /** Obligatoire (et égale à la version en vigueur, CONSENT_VERSIONS, ou à
   * une ancienne version encore acceptée d'une app installée,
   * LEGACY_RECORDABLE_CONSENT_VERSIONS) pour les consentements versionnés. */
  version?: string;
}

export interface RecordConsentsRequest {
  consents: ConsentInput[];
}

/** « piece_received » (lot 5) : une personne vous a envoyé une pièce (in-app, jamais push).
 * « follow_request » et « follow_accepted » (compte privé, migration 0045),
 * « reply » et « mention » (commentaires, migration 0046), « tag » (identification
 * sur une publication, migration 0047) :
 * envoyés seulement à une app qui les demande (LEGACY_NOTIFICATION_TYPES, en fin de fichier). */
export type NotificationType =
  | "follow"
  | "like"
  | "comment"
  | "moderation"
  | "report_handled"
  | "piece_received"
  | "follow_request"
  | "follow_accepted"
  | "reply"
  | "mention"
  | "tag";
export const NOTIFICATION_TYPES = [
  "follow",
  "like",
  "comment",
  "moderation",
  "report_handled",
  "piece_received",
  "follow_request",
  "follow_accepted",
  "reply",
  "mention",
  "tag",
] as const satisfies readonly NotificationType[];

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
      /** Toutes les photos (miniatures), la première comprise, quand il y en a au moins deux (migration 0047). */
      images?: string[];
    }
  | { kind: "comment"; author: ModerationAuthor; body: string; postId: string; createdAt: string; hidden: boolean }
  | {
      kind: "user";
      author: ModerationAuthor;
      bio: string | null;
      /** Lien en bio (migration 0049), en texte : « Retirer la bio » le retire aussi. Absent sans lien ou sans 0049. */
      linkUrl?: string;
    }
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
      /** Lot « messages, plus de confort » : supprimé par son auteur à cette date (son contenu n'est conservé que s'il avait été signalé avant). */
      deletedAt?: string | null;
      /** Ce message portait une publication. */
      sharedPost?: boolean;
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
  /** Lot « messages, plus de confort » : supprimé par son auteur (jamais son contenu, sauf pour le message signalé lui-même). */
  deleted?: boolean;
  /** Ce message portait une publication. */
  sharedPost?: boolean;
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
   * peut être retirée (il en a une, ou un lien en bio avec 0049, que ce
   * retrait emporte aussi ; et la base a la migration). */
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
  /** Lot « messages, plus de confort » (migration 0044) : aimer, répondre, supprimer, envoyer une publication. Absent chez un serveur plus ancien (lu comme faux). */
  actions?: boolean;
  /** Lot « découverte » (migration 0051) : les notifications d'activité sur le téléphone sont possibles (PUSH_ENABLED et 0051), même sans la messagerie. Absent chez un serveur plus ancien (lu comme faux) : l'app cache leurs quatre interrupteurs. */
  activityPush?: boolean;
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
 * garder un appareil pour les seules alertes : `messages: false` l'oublie.
 * Lot « découverte » (migration 0051) : `likes`, `comments`, `follows` et
 * `mentions` (ACTIVITY_PUSH_KINDS), une réponse par sorte d'activité. Absent :
 * inchangé ; non pour un nouvel appareil. Un serveur sans 0051 les ignore.
 * Avec 0051, l'appareil n'est oublié que quand ses six réponses sont à false. */
export interface RegisterPushTokenRequest {
  token: string;
  platform: PushPlatform;
  messages?: boolean;
  alerts?: boolean;
  likes?: boolean;
  comments?: boolean;
  follows?: boolean;
  mentions?: boolean;
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
  /** Lot « messages, plus de confort » : supprimé par la personne qui l'a écrit (ni texte ni carte). */
  deleted?: boolean;
  /** « J'aime » de chacun des deux membres. */
  liked?: MessageLikes;
  /** Le message auquel celui-ci répond ; null : aucun. */
  replyTo?: MessageQuote | null;
  /** La publication envoyée dans ce message ; null : aucune. */
  post?: MessagePostCard | null;
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
  /** Lot « messages, plus de confort » : supprimé par la personne qui l'a écrit. */
  deleted?: boolean;
  /** Ce message porte une publication (jamais rien d'elle dans l'aperçu). */
  hasPost?: boolean;
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

/** Confirmations de lecture d'une conversation (lot « messages vus »,
 * migration 0043), pour la personne qui la lit. Sous son dernier message,
 * l'app affiche « Vu » si `seenAt` n'est pas antérieur à ce message,
 * « Envoyé » sinon.
 * `seenAt` : la date de VOTRE dernier message, quand l'autre membre a ouvert
 * la conversation après lui (« Vu ») ; jamais l'heure de sa lecture, qui ne
 * sort pas du serveur. null (« Envoyé ») : pas encore lu, ou seulement par
 * une lecture qui n'est pas montrée (faite avant que la conversation soit
 * ouverte aux deux, avant que « Vu » existe pour lui, ou pendant que l'un
 * des deux réglages était éteint). */
export interface ConversationReadReceipts {
  seenAt: string | null;
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
  /** Confirmations de lecture, à chaque lecture et relecture. null : rien à
   * montrer — migration 0043 absente, réglage éteint chez l'un des deux
   * membres, compte de l'autre membre suspendu, ou conversation qui n'est pas
   * ouverte aux deux (jamais pour une invitation : la personne qui invite
   * n'apprend pas si elle a été regardée). Absent chez un serveur plus ancien
   * (lu comme null). */
  readReceipts?: ConversationReadReceipts | null;
  /** Lot « messages, plus de confort » : les messages aimés ou supprimés depuis `changedSince` (relecture). */
  changed?: ChatMessage[];
  /** À renvoyer dans `changedSince` à la relecture suivante. */
  syncedAt?: string;
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
  /** Lot « messages, plus de confort » : une publication que vous pouvez voir, à la place d'une autre carte. */
  postId?: string;
  /** Le message de cette conversation auquel vous répondez. */
  replyToId?: string;
}

export interface SendMessageResponse {
  conversationId: string;
  message: ChatMessage;
  state: ConversationState;
  sendMode: ConversationSendMode;
  /** Confirmations de lecture juste après l'envoi (mêmes règles que pour
   * ConversationThread) ; absent chez un serveur plus ancien. */
  readReceipts?: ConversationReadReceipts | null;
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

/** Nombre maximal d'envies par membre (lot « durcissement des alertes »,
 * revue de sécurité : chaque envie a son suivi de prix et de stock). Au-delà,
 * POST /api/wishlist et « Garder » une envie d'un ami répondent 409
 * « wishlist_full ». */
export const WISHLIST_ITEMS_MAX = 1000;

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
  /** Publications enregistrées (migration 0048) : signet et liste « Publications
   * enregistrées ». Faux ou absent (ancien serveur) : l'app les cache. */
  savedPosts?: boolean;
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

// ---- Alertes prix et stock (lot 2, migration 0036 ; nouvelle version, 0041) ----
// Une envie surveillée (la cloche) prévient son membre quand une recherche
// faite dans Spotto montre la même pièce (même lien de boutique) sous le prix
// qu'il a choisi, ou de retour en stock. Aucune surveillance en tâche de
// fond : seulement les recherches que les membres font déjà. Un achat ne
// sert jamais aux alertes des autres. Une alerte ne dit jamais quelle
// recherche, quel signalement ni quel membre est à son origine.

/** « Épuisé » est construit côté serveur mais caché dans l'app (décision du
 * fondateur du 9 novembre 2026) : il ne part que sur une rupture établie
 * (Google l'annonce, ou trois membres l'ont signalée d'affilée). */
export const SOLD_OUT_ALERTS_VISIBLE = false;

/** Les trois sortes d'alertes. */
export const WISH_ALERT_KINDS = ["price_drop", "restock", "sold_out"] as const;
export type WishAlertKind = (typeof WISH_ALERT_KINDS)[number];

/** Dernier état de stock connu d'une pièce suivie. */
export const STOCK_STATES = ["unknown", "in_stock", "sold_out"] as const;
export type StockState = (typeof STOCK_STATES)[number];

/** États d'une alerte (wish_alert_events.status) : en attente, envoyée,
 * expirée (3 jours sans envoi), périmée (la baisse ou le stock a disparu
 * avant l'envoi), limitée (ancienne règle, avant 0041), désactivée
 * (interrupteur ou cloche coupés). */
export const WISH_ALERT_STATUSES = ["pending", "sent", "expired", "stale", "limited", "disabled"] as const;
export type WishAlertStatus = (typeof WISH_ALERT_STATUSES)[number];

/** Règles chiffrées des alertes (tenues par la base, migration 0041). */
export const WISH_ALERT_RULES = {
  /** Une alerte est due dès sa création (décision du fondateur : « à la
   * seconde près ») : envoyée juste après l'observation qui l'a créée, en
   * arrière-plan après la réponse ; sinon (pas d'appareil, notifications
   * coupées, limite du jour) au prochain passage d'envoi. */
  sendDelayHours: 0,
  /** Une alerte jamais envoyée expire le 3e jour après celui de sa création
   * (jours de Paris : seule la date est gardée). */
  expiryDays: 3,
  /** Au plus ce nombre d'alertes envoyées par personne et par jour (heure de Paris). */
  perPersonPerDay: 5,
  /** « Plus disponible » : signalements par membre et par jour (heure de Paris). */
  stockReportsPerDay: 20,
  /** Alertes et signalements effacés au bout de ce nombre de jours. */
  retentionDays: 30,
  /** « Plus disponible » : la rupture d'une pièce n'est établie pour les
   * membres d'un pays qu'une fois signalée par ce nombre de membres
   * différents d'affilée depuis ce pays (sans aucun « en stock » observé dans
   * ce pays entre deux signalements ; les membres qui n'aident pas les autres
   * ne comptent pas). Avant, seules les envies de l'auteur passent « épuisée ». */
  stockReportersToConfirm: 3,
  /** Réservation d'une alerte pendant son envoi (la seule heure précise
   * gardée, effacée dès la fin de l'envoi). */
  leaseMinutes: 15,
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

/** Pays pris en charge par les ALERTES : liste FERMÉE, celle dont la devise
 * (COUNTRY_CURRENCIES) et le domaine de Google (serveur, services/serpapi.ts)
 * sont connus. La recherche elle-même garde le pays de l'appareil, quel qu'il
 * soit (serveur lib/locale.ts) ; mais seul un prix observé dans l'un de ces
 * pays sert aux alertes (lib/wishObserve.ts), et seul l'un d'eux est gardé
 * comme pays du membre (lib/wishAlerts.ts). Revue de sécurité : une recherche
 * « en-NZ » pouvait figer le prix de référence des autres membres. */
export const SEARCH_COUNTRIES = ["fr", "gb", "ch", "us"] as const;
export type SearchCountry = (typeof SEARCH_COUNTRIES)[number];

/** Le prix est-il dans la devise du pays de la recherche ? null : la devise
 * de ce pays n'est pas connue ici. Sans devise lisible : non. */
export function isCountryCurrency(raw: string | null | undefined, country: string): boolean | null {
  const local = COUNTRY_CURRENCIES[country];
  if (!local) return null;
  return alertCurrency(raw, country) === local;
}

/** GET /api/alerts/status : les alertes sont-elles disponibles (migrations
 * 0036 à 0041 appliquées) ? Faux : l'app cache la cloche, les réglages et
 * « Plus disponible ». `enabled` : l'interrupteur « Alertes prix et stock »
 * de la personne (coupé par défaut). `helpOthers` : « Aider les autres
 * membres » (allumé par défaut) : ses recherches et ses signalements « Plus
 * disponible » servent, sans son nom, aux alertes des autres membres ;
 * coupé, ils ne servent qu'à ses propres envies. `push` : les notifications
 * sur le téléphone sont allumées sur le serveur (PUSH_ENABLED et migration
 * 0035) ; faux : les alertes sont enregistrées mais ne partent pas encore. */
export interface WishAlertsStatus {
  available: boolean;
  enabled: boolean;
  helpOthers: boolean;
  push: boolean;
}

/** PUT /api/alerts/settings : les réglages des alertes (au moins un des deux). */
export interface UpdateWishAlertsSettingsRequest {
  enabled?: boolean;
  helpOthers?: boolean;
}

/** La cloche d'une envie. `trackable` : la pièce a une empreinte (lien de
 * boutique reconnu) ; sinon, ni cloche ni « Plus disponible ». `bought` : la
 * pièce est dans votre Vault (« Je l'ai achetée ») ; aucune alerte ne part
 * pour elle, la cloche est cachée. `stock` : le dernier état connu, en direct
 * (décision du fondateur : le savoir tout de suite est le but) ; jamais qui a
 * cherché ou signalé la pièce. `targetPrice` : « Prévenez-moi si le prix passe
 * sous… » (dans `targetCurrency`, la devise de votre pays ; pour une envie dont
 * le pays n'est pas encore connu, celle du pays de votre recherche, s'il est
 * pris en charge ; sinon null et pas de champ) ; `lastPrice` : le dernier prix
 * vu dans votre pays (`lastCurrency`), qui pré-remplit ce seuil et que la
 * fiche de l'envie affiche. */
export interface WishAlertState {
  wishlistItemId: string;
  trackable: boolean;
  bought: boolean;
  priceDrop: boolean;
  restock: boolean;
  soldOut: boolean;
  stock: StockState;
  targetPrice: number | null;
  targetCurrency: string | null;
  lastPrice: number | null;
  lastCurrency: string | null;
}

/** GET /api/alerts/wishes : la cloche de chacune de vos envies suivies. */
export interface WishAlertStatesList {
  items: WishAlertState[];
}

/** Une nouveauté montrée en tête de vos Envies (lot « alertes visibles ») :
 * une alerte des 30 derniers jours, encore vraie aujourd'hui. `id` : celui de
 * l'alerte (l'app note sur l'appareil, par compte, celles déjà vues).
 * `seenOn` : le jour où le prix ou le stock a été vu (« AAAA-MM-JJ », heure de
 * Paris). Baisse de prix : `price` est le prix vu, `threshold` votre seuil
 * (jamais un « ancien prix »), dans `currency` ; retour en stock : les trois à
 * null. `merchantName` : la boutique de l'Envie. */
export interface WishAlertNews {
  id: string;
  wishlistItemId: string;
  kind: "price_drop" | "restock";
  title: string;
  merchantName: string | null;
  price: number | null;
  threshold: number | null;
  currency: string | null;
  seenOn: string;
}

/** GET /api/alerts/news : vos nouveautés (vide sans les alertes sur le serveur). */
export interface WishAlertNewsList {
  items: WishAlertNews[];
}

/** Plus haut seuil accepté pour une baisse de prix. */
export const MAX_TARGET_PRICE = 99_999_999.99;

/** PUT /api/wishlist/:id/alerts. Tout à false : la cloche est retirée.
 * `enableAlerts` : allume aussi l'interrupteur général (première cloche,
 * après la feuille d'explication des notifications). `targetPrice` : le
 * seuil de la baisse de prix (absent : inchangé ; null : le dernier prix vu,
 * ou le premier qui sera vu). */
export interface UpdateWishAlertRequest {
  priceDrop: boolean;
  restock: boolean;
  soldOut?: boolean;
  enableAlerts?: boolean;
  targetPrice?: number | null;
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
  /** Migrations des alertes absentes (404) : l'app cache tout. */
  unavailable: "alerts_unavailable",
  /** La pièce n'a pas d'empreinte (422) : ni cloche ni « Plus disponible ». */
  notTrackable: "alert_not_trackable",
  /** 20 signalements « Plus disponible » déjà aujourd'hui (429). */
  reportLimit: "stock_report_limit",
  /** La pièce est dans votre Vault (422) : pas de cloche, aucune alerte ne partirait. */
  bought: "alert_wish_bought",
} as const;

/** Données d'une notification d'alerte : `wishlistItemId` quand elle ne
 * concerne qu'une envie (toucher ouvre sa fiche, qui charge tout depuis le
 * serveur) ; rien du tout pour une notification groupée (toucher ouvre vos
 * Envies). Jamais un titre, une boutique, un prix ni une sorte d'alerte. Une
 * notification de message porte toujours `conversationId` : jamais confondue. */
export interface WishAlertPushData {
  wishlistItemId?: string;
}

const PUSH_DATA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les données d'une notification d'alerte, ou null si ce n'en est pas une
 * (une notification de message porte `conversationId`) ou si elles sont
 * illisibles. Données vides (ou absentes) : la notification groupée. */
export function parseWishAlertPushData(data: unknown): WishAlertPushData | null {
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || keys[0] !== "wishlistItemId") return null;
  const id = (data as Record<string, unknown>).wishlistItemId;
  return typeof id === "string" && PUSH_DATA_UUID.test(id) ? { wishlistItemId: id } : null;
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

// ---------------------------------------------------------------------
// Liens de vidéos TikTok et Instagram (mission « liens vidéo »)
// ---------------------------------------------------------------------
// Reconnaître un lien partagé depuis TikTok ou Instagram, sans jamais rien
// télécharger : tout se lit dans l'adresse elle-même. Sert à l'app (lien reçu
// de l'extension de partage ou collé), au site (lien collé) et au serveur
// (mémoire collective : une vidéo = une plateforme et une clé).
//
// Un lien court TikTok (vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…) ne
// contient pas l'identifiant de la vidéo : seul le serveur peut le résoudre,
// en suivant sa redirection (en-têtes seulement, jamais le contenu de la
// page). `parseVideoLink` le signale ; `normalizeVideoLink` rend alors null.

export const VIDEO_PLATFORMS = ["tiktok", "instagram"] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

/** Une vidéo reconnue. `videoKey` : l'identifiant numérique TikTok, ou le
 * code Instagram (majuscules et minuscules comptent). `canonicalUrl` :
 * l'adresse publique sans aucun paramètre de suivi. `creatorHandle` : le
 * pseudo sans « @ », seulement s'il figure dans l'adresse. */
export interface VideoLink {
  platform: VideoPlatform;
  videoKey: string;
  canonicalUrl: string;
  creatorHandle: string | null;
}

/** Ce qu'un texte partagé contient : une vidéo reconnue, ou un lien court
 * TikTok à faire résoudre par le serveur. */
export type ParsedVideoLink = { kind: "video"; link: VideoLink } | { kind: "tiktok_short"; shortUrl: string };

/** Hôtes des liens courts TikTok : les seuls que le serveur accepte de suivre. */
export const TIKTOK_SHORT_HOSTS = ["vm.tiktok.com", "vt.tiktok.com"] as const;
const TIKTOK_HOSTS: ReadonlySet<string> = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);
const INSTAGRAM_HOSTS: ReadonlySet<string> = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);

/** Longueur maximale d'un texte examiné (un texte de partage fait quelques centaines de caractères). */
export const VIDEO_LINK_INPUT_MAX_LENGTH = 4096;

const TIKTOK_ID = /^\d{6,25}$/;
const TIKTOK_HANDLE = /^[a-z0-9._]{1,30}$/;
const TIKTOK_SHORT_CODE = /^[A-Za-z0-9_-]{4,40}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,64}$/;
const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/;
/** Types de publication Instagram reconnus, et celui gardé dans l'adresse canonique. */
const INSTAGRAM_KINDS: Record<string, string> = { reel: "reel", reels: "reel", p: "p", tv: "tv" };

/** Adresses contenues dans un texte, dans l'ordre : « https://… », ou un hôte
 * TikTok ou Instagram écrit sans « https:// » (jamais au milieu d'un autre
 * nom de domaine, ni derrière un autre protocole comme « ftp:// »). La
 * ponctuation de fin de phrase est retirée. */
function urlCandidates(text: string): string[] {
  const found = text.match(/(?:https?:\/\/|(?<![A-Za-z0-9.@:\/-])(?:(?:www|m|vm|vt)\.)?(?:tiktok\.com|instagram\.com|instagr\.am)\/)[^\s<>"'`]+/gi) ?? [];
  return found.map((candidate) => (/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`).replace(/[.,;:!?)\]}»…]+$/u, ""));
}

function tiktokCanonical(kind: "video" | "photo", id: string, handle: string | null): string {
  return `https://www.tiktok.com/@${handle ?? ""}/${kind}/${id}`;
}

function parseTikTok(host: string, segments: string[]): ParsedVideoLink | null {
  if ((TIKTOK_SHORT_HOSTS as readonly string[]).includes(host)) {
    const code = segments[0];
    return segments.length === 1 && code !== undefined && TIKTOK_SHORT_CODE.test(code) ? { kind: "tiktok_short", shortUrl: `https://${host}/${code}/` } : null;
  }
  if (!TIKTOK_HOSTS.has(host)) return null;
  const [first, second, third] = segments;
  // tiktok.com/t/CODE : lien court, lui aussi.
  if (first === "t" && segments.length === 2 && second !== undefined && TIKTOK_SHORT_CODE.test(second)) {
    return { kind: "tiktok_short", shortUrl: `https://www.tiktok.com/t/${second}/` };
  }
  const video = (kind: "video" | "photo", id: string, handle: string | null): ParsedVideoLink => ({
    kind: "video",
    link: { platform: "tiktok", videoKey: id, canonicalUrl: tiktokCanonical(kind, id, handle), creatorHandle: handle },
  });
  // tiktok.com/@pseudo/video/ID (ou /photo/ID pour une publication d'images).
  if (first !== undefined && first.startsWith("@") && segments.length === 3 && (second === "video" || second === "photo") && third !== undefined && TIKTOK_ID.test(third)) {
    const handle = first.slice(1).toLowerCase();
    if (handle !== "" && !TIKTOK_HANDLE.test(handle)) return null;
    return video(second, third, handle === "" ? null : handle);
  }
  // m.tiktok.com/v/ID.html
  if (first === "v" && segments.length === 2 && second !== undefined) {
    const id = second.replace(/\.html$/i, "");
    return TIKTOK_ID.test(id) ? video("video", id, null) : null;
  }
  // Adresses du lecteur officiel : /player/v1/ID et /embed/v2/ID.
  if ((first === "player" && second === "v1") || (first === "embed" && second === "v2")) {
    return segments.length === 3 && third !== undefined && TIKTOK_ID.test(third) ? video("video", third, null) : null;
  }
  return null;
}

function parseInstagram(host: string, segments: string[]): ParsedVideoLink | null {
  if (!INSTAGRAM_HOSTS.has(host)) return null;
  // instagram.com/reel/CODE/ ou, depuis 2024, instagram.com/pseudo/reel/CODE/.
  const withHandle = segments.length === 3;
  if (segments.length !== 2 && !withHandle) return null;
  const [kindSegment, code] = withHandle ? [segments[1]!, segments[2]!] : [segments[0]!, segments[1]!];
  const kind = INSTAGRAM_KINDS[kindSegment.toLowerCase()];
  if (kind === undefined || !INSTAGRAM_CODE.test(code)) return null;
  let handle: string | null = null;
  if (withHandle) {
    handle = segments[0]!.toLowerCase();
    // « share », « reels »… ne sont pas des pseudos : ces adresses ne sont pas reconnues.
    if (!INSTAGRAM_HANDLE.test(handle) || handle === "share" || handle in INSTAGRAM_KINDS) return null;
  }
  return { kind: "video", link: { platform: "instagram", videoKey: code, canonicalUrl: `https://www.instagram.com/${kind}/${code}/`, creatorHandle: handle } };
}

function parseVideoUrl(candidate: string): ParsedVideoLink | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  // Un vrai lien web, sans identifiant ni port : « https://tiktok.com@ailleurs.example/ » n'est pas TikTok.
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "" || url.port !== "") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let segments: string[];
  try {
    segments = url.pathname.split("/").filter((segment) => segment !== "").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  return parseTikTok(host, segments) ?? parseInstagram(host, segments);
}

/** La première adresse TikTok ou Instagram d'un texte (une adresse seule, ou
 * un texte de partage qui en contient une) : une vidéo reconnue, un lien
 * court TikTok à résoudre, ou null. Les paramètres de suivi (igsh, _r,
 * utm_…) ne sont jamais gardés. */
export function parseVideoLink(input: string | null | undefined): ParsedVideoLink | null {
  if (typeof input !== "string" || input.length > VIDEO_LINK_INPUT_MAX_LENGTH) return null;
  for (const candidate of urlCandidates(input)) {
    const parsed = parseVideoUrl(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/** La vidéo TikTok ou Instagram qu'un texte désigne, ou null (aucune adresse
 * reconnue, ou lien court TikTok : voir parseVideoLink). */
export function normalizeVideoLink(input: string | null | undefined): VideoLink | null {
  const parsed = parseVideoLink(input);
  return parsed?.kind === "video" ? parsed.link : null;
}

/** « TikTok » ou « Instagram », pour les textes. */
export function videoPlatformName(platform: VideoPlatform): string {
  return platform === "tiktok" ? "TikTok" : "Instagram";
}

// ---- Mémoire collective et lecteurs (mission « liens vidéo ») ----

/** D'où vient l'image d'un spot : le lecteur intégré (« Spotter ce moment »),
 * une capture partagée à l'app, la recherche d'image d'iOS, une photo choisie
 * dans l'app, ou le site. */
export const VIDEO_SPOT_SOURCES = ["tiktok_player", "instagram_player", "share", "visual_intelligence", "app", "web"] as const;
export type VideoSpotSource = (typeof VIDEO_SPOT_SOURCES)[number];

/** Pièces déjà repérées montrées pour une vidéo, au plus. */
export const VIDEO_PRODUCTS_LIMIT = 12;

/** Une pièce déjà repérée dans une vidéo, telle que tous les membres la
 * voient : jamais l'identité de qui l'a trouvée. `productKey` : la clé
 * « même page » (empreinte de l'adresse de la boutique nettoyée), à renvoyer
 * pour « C'est bien cette pièce ». */
export interface VideoProduct {
  productKey: string;
  productName: string;
  brand: string | null;
  imageUrl: string;
  priceMin: number | null;
  currency: string | null;
  merchantName: string | null;
  /** Lien à ouvrir : affilié s'il existe (mention obligatoire), sinon le lien de la boutique. */
  merchantUrl: string;
  isAffiliate: boolean;
  /** Nombre de « C'est bien cette pièce » de membres qui n'ont pas eux-mêmes
   * apporté cette pièce (comptes suspendus écartés). */
  confirmations: number;
  /** Nombre de membres distincts qui ont trouvé cette pièce dans cette vidéo
   * (2 au moins pour qu'elle soit montrée : migration 0039). */
  appearances: number;
  /** La personne qui regarde a déjà confirmé cette pièce. */
  confirmedByMe: boolean;
}

/** Lecteurs laissés allumés par le serveur (ils ne peuvent que couper). */
export interface VideoPlayersStatus {
  tiktok: boolean;
  instagram: boolean;
}

/** GET /api/video-links/status */
export interface VideoLinksStatus {
  players: VideoPlayersStatus;
  /** La mémoire collective est-elle en place (migration 0038) ? */
  memory: boolean;
}

/** Pourquoi un lien n'a pas donné de vidéo : lien court TikTok qui ne mène à
 * aucune vidéo, hôte refusé, trop de redirections, TikTok injoignable, ou
 * limite de débit (les deux derniers : à réessayer). */
export type VideoLinkIssue = "not_a_video" | "host_not_allowed" | "too_many_hops" | "unreachable" | "rate_limited";

/** GET /api/video-links/lookup?url= */
export interface VideoLookupResponse {
  /** La vidéo reconnue, ou null (aucun lien TikTok ou Instagram reconnu). */
  link: VideoLink | null;
  linkIssue: VideoLinkIssue | null;
  players: VideoPlayersStatus;
  memoryAvailable: boolean;
  /** Pièces déjà repérées par plusieurs membres (vide si la vidéo est
   * inconnue), triées par confirmations, puis apparitions, puis récence —
   * jamais par commission. */
  products: VideoProduct[];
}

/** GET /api/video-links/instagram-embed?url= : le code d'intégration officiel. */
export interface InstagramEmbedResponse {
  html: string;
  creatorHandle: string | null;
}

/** POST /api/video-links/spots */
export interface VideoSpotRequest {
  url: string;
  searchId: string;
  source: VideoSpotSource;
  momentSeconds?: number | null;
}

/** POST /api/video-links/confirm */
export interface VideoConfirmRequest {
  url: string;
  productKey: string;
}

// ---- Essayage virtuel photo (lot « essayage virtuel », novembre 2026) ----
// Fonction éteinte par défaut (TRYON_ENABLED et feature_flags.tryon). TYPES
// SEULEMENT dans ce fichier : il est importé par l'app iPhone, et l'app
// construite depuis main ne doit contenir aucune trace de l'essayage (règle
// 2.5.19 d'Apple sur les fonctions cachées). Toute valeur utile à l'exécution
// (version du consentement, listes de motifs…) vit côté serveur ou dans les
// fichiers .web de l'app, jamais ici.

/** Statut d'âge pour l'essayage (réservé aux 18 ans et plus). */
export type TryonAgeGate = "unknown" | "adult" | "minor";

/** Essais restants. */
export interface TryonRemaining {
  /** Essais gratuits restants ce mois civil (fuseau Europe/Paris). */
  free: number;
  /** Essais offerts encore valables. */
  bonus: number;
  /** Début du prochain mois civil à Paris (ISO 8601). */
  nextReset: string;
  /** Essais par mois (lot quotas) : absent d'un serveur plus ancien ; null : aucune limite du mois. */
  monthlyLimit?: number | null;
}

/** Consentement à l'essayage : demandé tant que la version courante n'est pas acceptée. */
export interface TryonConsentState {
  required: boolean;
  version: string;
}

/** GET /api/tryon/status. Éteint : seulement { enabled: false }. */
export type TryonStatus =
  | { enabled: false }
  | {
      enabled: true;
      ageGate: TryonAgeGate;
      consent: TryonConsentState;
      remaining: TryonRemaining;
    };

/** POST /api/tryon/age-gate : date de naissance AAAA-MM-JJ (jamais gardée). */
export interface TryonAgeGateRequest {
  birthDate: string;
}

export interface TryonAgeGateResponse {
  ageGate: Exclude<TryonAgeGate, "unknown">;
}

/** POST /api/tryon/consent : la version lue par le membre. */
export interface TryonConsentRequest {
  version: string;
}

/** POST et DELETE /api/tryon/consent. */
export interface TryonConsentResponse {
  consent: TryonConsentState;
}

/** GET /api/tryon/consent : le consentement du membre, lisible même fonction
 * éteinte (Réglages du site : le retrait reste toujours possible). */
export interface TryonConsentReadResponse {
  consent: {
    /** Un consentement accepté et jamais retiré depuis (quelle que soit sa version). */
    given: boolean;
    /** Version du texte de consentement en vigueur sur le serveur. */
    version: string;
  };
}

/** POST /api/tryon (multipart : photo, itemId, attestSelf). */
export interface TryonRunResponse {
  /** « data:image/jpeg;base64,… », avec le bandeau « Image générée par IA ». */
  image: string;
  remaining: TryonRemaining;
}

/** Motifs d'un signalement de résultat. */
export type TryonReportReason = "inappropriate" | "wrong_piece" | "poor_quality" | "other";

/** POST /api/tryon/report (aucune image). */
export interface TryonReportRequest {
  itemId: string;
  reason: TryonReportReason;
  comment?: string;
}

/** Codes d'erreur propres à l'essayage (champ « error » des réponses). */
export type TryonErrorCode =
  | "feature_disabled"
  | "tryon_age_required"
  | "tryon_minor"
  | "tryon_age_already_set"
  | "tryon_birth_date_invalid"
  | "tryon_consent_required"
  | "tryon_consent_outdated"
  | "tryon_attest_required"
  | "tryon_item_not_found"
  | "tryon_item_not_eligible"
  | "tryon_photo_invalid"
  | "tryon_in_progress"
  | "tryon_quota_exhausted"
  | "tryon_budget_reached"
  | "tryon_busy"
  | "tryon_pose_not_detected"
  | "tryon_moderation_blocked"
  | "tryon_image_unreadable"
  | "tryon_provider_unavailable"
  | "tryon_timeout"
  | "tryon_rate_limited";

// ---- Analyse automatique d'un lien vidéo (lot « vidéo auto », novembre 2026) ----
// Décision du fondateur (14 et 15 novembre 2026) : un lien TikTok ou Instagram
// et ce que le membre cherche suffisent. Le service vidéo (apps/video-worker,
// service à part chez Render) récupère la vidéo publique, sans la garder, et en
// extrait des images ; le serveur les donne à l'IA (étage 2 existant,
// askVideoMoments) et renvoie les moments trouvés. L'app enchaîne ensuite
// exactement comme pour une vidéo du téléphone (image du moment + cadre →
// recherche habituelle). La capture d'écran reste la roue de secours.

/** POST /api/video-links/analyze : le lien partagé et ce que le membre cherche ;
 * ou (lot « propositions », interrupteur VIDEO_PIECES_ENABLED) le lien seul,
 * en mode « pièces » : l'IA propose les pièces qu'elle voit (VIDEO_PIECES). */
export type VideoLinkAnalysisRequest =
  | {
      url: string;
      /** Quelques mots (VIDEO_AI.queryMinLength à SEARCH_QUERY_MAX_LENGTH caractères). */
      query: string;
    }
  | {
      url: string;
      /** Aucun texte du membre ne part : pas même un `query` vide (sinon 400 « invalid_query »). */
      mode: "pieces";
    };

/** Un moment trouvé par l'IA dans la vidéo du lien. */
export interface VideoLinkMoment {
  /** Instant du moment dans la vidéo, en secondes. */
  timeSeconds: number;
  /** Image entière du moment, « data:image/jpeg;base64,… » (1 280 px au plus sur le grand côté). */
  image: string;
  /** Cadre de la pièce dans cette image, en proportions 0–1. */
  box: CropRect;
}

/** Réponse de l'analyse : la vidéo reconnue et 1 à VIDEO_AI.moments moments, le meilleur d'abord. */
export interface VideoLinkAnalysisResponse {
  video: VideoLink;
  moments: VideoLinkMoment[];
  /** Mode « pièces » seulement (lot « propositions », champ additif) : le nom
   * de chaque pièce proposée par l'IA, dans l'ordre de `moments` (une image
   * par pièce, la plus visible d'abord), relu par pieceLabel. Absent quand le
   * membre a écrit. */
  labels?: string[];
}

/** GET /api/video-links/analyze/status : l'analyse d'un lien est-elle possible ?
 * `pieces` (lot « propositions », champ additif) : présent, et seulement à
 * `true`, quand l'analyse des liens ET l'interrupteur VIDEO_PIECES_ENABLED
 * sont allumés ; une app plus ancienne l'ignore. */
export interface VideoLinkAnalysisStatus {
  enabled: boolean;
  pieces?: true;
}

/** Codes d'erreur de l'analyse d'un lien (champ « error »). Toute erreur
 * « vidéo indisponible » ramène le membre à la capture d'écran. */
export type VideoLinkAnalysisErrorCode =
  | "video_analysis_disabled"
  | "video_ai_consent_required"
  | "invalid_query"
  | "invalid_link"
  | "video_unavailable"
  | "video_private"
  | "video_too_long"
  | "video_no_moment"
  | "video_busy"
  | "video_timeout"
  | "video_ai_user_limit"
  | "video_ai_global_limit";

/** Plan B en un geste (lot « recherche confiance ») : pourquoi la vidéo n'a
 * pas pu être récupérée, quand le service vidéo le sait (champ « cause » de
 * l'erreur, additif : une app plus ancienne l'ignore et garde son message).
 * - private_or_removed : vidéo privée, réservée à certains comptes ou
 *   supprimée (« video_private », et « video_unavailable » en 422) ;
 * - refused : TikTok ou Instagram a refusé la demande de notre service
 *   (connexion exigée, accès bloqué : « video_unavailable » en 502).
 * Dans les deux cas, la capture d'écran est le bon chemin : réessayer ne
 * changerait rien. */
export const VIDEO_LINK_FAILURE_CAUSES = ["private_or_removed", "refused"] as const;
export type VideoLinkFailureCause = (typeof VIDEO_LINK_FAILURE_CAUSES)[number];

// ---- Propositions de l'IA (Parcours 2, lot « propositions », 21 novembre 2026) ----
// Décision du fondateur : pour un lien TikTok ou Instagram, « Voir les
// propositions de l'IA » évite d'écrire (écrire reste possible). Le même
// appel à l'IA (mêmes images, même modèle, mêmes plafonds), en mode
// « pièces », sans aucun texte du membre, nomme jusqu'à 3 pièces visibles,
// chacune avec sa meilleure image et son cadre. Les noms ne sont gardés nulle
// part (ni base, ni journaux, ni statistiques, ni mémoire collective) et ne
// sont montrés qu'au membre qui a demandé.

/** Pièces proposées au plus, et bornes d'un nom (« Le manteau camel »). */
export const VIDEO_PIECES = { max: 3, labelMaxLength: 28, labelMaxWords: 5 } as const;

/** Mots qui désignent une personne (ou ce qui la montre : visage, cheveux,
 * tatouage), comparés sans majuscules ni accents, tels quels et sans leur s
 * ou x final : un nom qui en contient un est écarté (« Le sac des filles »,
 * "The woman's coat"). */
const PIECE_LABEL_PERSON_WORDS: ReadonlySet<string> = new Set([
  "fille",
  "femme",
  "homme",
  "garcon",
  "enfant",
  "bebe",
  "dame",
  "monsieur",
  "madame",
  "personne",
  "mannequin",
  "influenceuse",
  "influenceur",
  "visage",
  "cheveux",
  "tatouage",
  "girl",
  "woman",
  "women",
  "man",
  "men",
  "boy",
  "child",
  "children",
  "kid",
  "baby",
  "babies",
  "lady",
  "ladies",
  "person",
  "people",
  "model",
  "influencer",
  "face",
  "hair",
  "tattoo",
]);

/** Une lettre (toutes langues) d'abord, puis des lettres, espaces,
 * apostrophes (' ’) et traits d'union : ni chiffre, ni « @ », ni point,
 * donc ni lien ni pseudo. */
const PIECE_LABEL_SHAPE = /^\p{L}[\p{L} '’-]*$/u;

/** Un texte sans majuscules ni accents. */
function foldPieceText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Nom d'une pièce proposée par l'IA, relu — par le serveur (filtre de la
 * réponse de l'IA) et par l'app (revérification de la réponse du serveur) :
 * en forme NFC, espaces réduits. null s'il est refusé : moins de 2 ou plus de
 * 28 caractères, plus de 5 mots (coupés aux espaces), un caractère autre que
 * des lettres, des espaces, des apostrophes ou des traits d'union (et une
 * lettre en premier), ou un mot qui désigne une personne (mots coupés aux
 * espaces, apostrophes et traits d'union). Une marque ou un mot lu dans la
 * vidéo ne se filtre pas à coup sûr : la consigne de l'IA les interdit, et
 * l'interrupteur VIDEO_PIECES_ENABLED reste coupé jusqu'à l'essai du fondateur. */
export function pieceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > VIDEO_PIECES.labelMaxLength) return null;
  if (!PIECE_LABEL_SHAPE.test(label)) return null;
  if (label.split(" ").length > VIDEO_PIECES.labelMaxWords) return null;
  for (const word of label.split(/[ '’-]+/)) {
    if (word === "") continue;
    const folded = foldPieceText(word);
    if (PIECE_LABEL_PERSON_WORDS.has(folded) || PIECE_LABEL_PERSON_WORDS.has(folded.replace(/[sx]$/, ""))) return null;
  }
  return label;
}

/** Clé d'un nom pour repérer un doublon (« Le Sac noir » = « le sac noir ») :
 * sans majuscules ni accents, espaces réduits. */
export function pieceLabelKey(label: string): string {
  return foldPieceText(label.normalize("NFC").replace(/\s+/g, " ").trim());
}

// ---- Messages, plus de confort (lot messages confort, migration 0044) ----
// Dans une conversation : aimer un message (❤️), répondre à un message
// précis, supprimer un de ses messages, envoyer une publication du fil.
// Ces champs ne sont envoyés qu'à une app qui dit les comprendre
// (paramètre `v=2` des lectures et de l'envoi).

/** Niveau de vocabulaire que l'app annonce au serveur (paramètre `v`). */
export const CLIENT_LEVEL = "2";

/** Longueur maximale de l'extrait d'un message cité. */
export const MESSAGE_QUOTE_MAX_LENGTH = 80;

/** « J'aime » d'un message : le vôtre, et celui de l'autre membre. */
export interface MessageLikes {
  mine: boolean;
  theirs: boolean;
}

/** Le message auquel un message répond, tel que la personne qui lit peut le
 * voir. `unavailable` : masqué, supprimé, signalé par elle, ou d'avant ce
 * qu'elle a effacé de sa vue (jamais d'extrait). `post` : une publication
 * envoyée (jamais rien d'elle ici). */
export interface MessageQuote {
  id: string;
  /** Écrit par la personne qui lit. */
  mine: boolean;
  kind: "text" | "wish" | "post" | "unavailable";
  /** MESSAGE_QUOTE_MAX_LENGTH caractères au plus : le début du texte, ou le titre de l'envie jointe. */
  excerpt: string | null;
}

/** Une publication envoyée dans un message, relue pour la personne qui
 * regarde à chaque affichage. `available: false` : supprimée, masquée,
 * signalée par elle, ou qu'elle n'a pas le droit de voir (rien d'autre n'est
 * transmis : ni auteur, ni légende, ni image). */
export type MessagePostCard =
  | { available: true; id: string; author: PostAuthor; thumbUrl: string | null; caption: string | null }
  | { available: false };

/** PUT /api/messages/:id/reaction : aimer un message, ou ne plus l'aimer. */
export interface MessageReactionRequest {
  liked: boolean;
}

/** Réponse : le message, tel que la personne qui lit le voit maintenant. */
export interface MessageReactionResponse {
  message: ChatMessage;
}

/** Codes d'erreur propres à ces actions. */
export const MESSAGE_ACTIONS_ERRORS = {
  /** Migration 0044 absente (404) : l'app cache ces actions. */
  unavailable: "message_actions_unavailable",
  /** Message inexistant, d'une autre conversation, ou qui n'est pas montré à la personne (404). */
  messageNotFound: "message_not_found",
  /** La conversation n'est pas ouverte aux deux membres (409). */
  notOpen: "conversation_not_open",
} as const;

// ---- Quotas par membre (lot quotas, migration 0053) ----
// Un compte gratuit a une part de recherches par mois civil (du 1er à 0 h,
// heure de Paris), en plus de la part du jour ; un abonné n'en a pas (sauf
// garde-fou du serveur). Champs additifs : une app plus ancienne les ignore.

/** Code du refus « part du mois atteinte » (429), à côté de SEARCH_CAPACITY_ERRORS. */
export const SEARCH_MONTHLY_QUOTA_ERROR = "search_capacity_user_month";

/** Votre part du mois : `resetsOn`, le 1er du mois suivant (« AAAA-MM-JJ »,
 * date de Paris) ; `resetsAt`, son minuit à Paris (ISO 8601, UTC). */
export interface SearchMonthlyQuota {
  limit: number;
  used: number;
  remaining: number;
  resetsOn: string;
  resetsAt: string;
}

/** Lit la part du mois sans lui faire confiance : undefined si le serveur
 * ne l'envoie pas, null si vous n'en avez pas (ou si elle est illisible). */
export function parseSearchMonthlyQuota(value: unknown): SearchMonthlyQuota | null | undefined {
  if (value === undefined) return undefined;
  const [limit, used, remaining, resetsOn, resetsAt] = ["limit", "used", "remaining", "resetsOn", "resetsAt"].map((key) => fieldOf(value, key));
  if (!isCount(limit) || limit < 1 || !isCount(used) || !isCount(remaining) || !isCalendarDay(resetsOn) || !isInstant(resetsAt)) return null;
  return { limit, used, remaining, resetsOn, resetsAt };
}

/** Le compteur des recherches avec la part du mois, quand le serveur l'envoie. */
export function parseSearchCapacity(value: unknown): SearchCapacityStatus | null {
  const status = parseSearchCapacityStatus(value);
  if (!status) return null;
  const monthlyQuota = parseSearchMonthlyQuota(fieldOf(value, "monthlyQuota"));
  return monthlyQuota === undefined ? status : { ...status, monthlyQuota };
}

/** Le corps d'un refus « part du mois atteinte » ; null pour tout autre corps.
 * `resumesOn` : le 1er du mois suivant, quand le serveur le donne. */
export function parseSearchMonthlyQuotaError(body: unknown): { resumesOn: string | null } | null {
  if (fieldOf(body, "error") !== SEARCH_MONTHLY_QUOTA_ERROR) return null;
  const resumesOn = fieldOf(body, "resumesOn");
  return { resumesOn: isCalendarDay(resumesOn) ? resumesOn : null };
}

// ---- Compte privé et demandes d'abonnement (lot « vie sociale », migration 0045) ----

/** Ce que le bouton d'abonnement montre : « Suivre », « Demandé » (demande en
 * attente auprès d'un compte privé) ou « Abonné(e) ». */
export type FollowState = "none" | "following" | "requested";
export const FOLLOW_STATES = ["none", "following", "requested"] as const satisfies readonly FollowState[];

/** Types de notification compris par les apps d'avant le lot « vie sociale ».
 * Une app qui n'envoie pas « v=2 » ne reçoit que ceux-là : elle afficherait
 * tout autre type comme un « j'aime ». */
export const LEGACY_NOTIFICATION_TYPES = ["follow", "like", "comment", "moderation", "report_handled", "piece_received"] as const satisfies readonly NotificationType[];

/** Paramètre d'adresse par lequel l'app dit qu'elle comprend le nouveau
 * vocabulaire (nouveaux types de notification, réponse de l'abonnement) ; sa
 * valeur est CLIENT_LEVEL (section « Messages, plus de confort »). */
export const CLIENT_LEVEL_PARAM = "v";

/** PUT /api/me/private-account. */
export interface UpdatePrivateAccountRequest {
  isPrivate: boolean;
}

/** POST /api/follows/:userId?v=2 : abonné(e) tout de suite (compte public),
 * ou demande envoyée (compte privé). */
export interface FollowResponse {
  state: Exclude<FollowState, "none">;
}

/** Une ligne d'une liste de membres (demandes reçues ; plus tard abonnés,
 * abonnements, « Aimé par »…). Jamais de date : la liste ne dit pas quand. */
export interface MemberRow extends PublicProfile {
  isPrivate: boolean;
  followState: FollowState;
  isMe: boolean;
}

/** Une page d'une liste de membres. Une page peut être plus courte que
 * prévu, ou vide, alors qu'il en reste : seul `nextCursor` dit s'il y a une suite. */
export interface MemberPage {
  members: MemberRow[];
  nextCursor: string | null;
}

/** Codes d'erreur du compte privé (champ « error »). */
export const PRIVATE_ACCOUNTS_UNAVAILABLE_ERROR = "private_accounts_unavailable";
export const PRIVATE_ACCOUNT_UPDATE_REQUIRED_ERROR = "private_account_update_required";
export const FOLLOW_REQUEST_LIMIT_ERROR = "follow_request_limit";

// ---- Listes des abonnés et des abonnements (lot « vie sociale », sans migration) ----

/** Lignes LUES par page d'une liste de membres (GET /api/users/:id/followers
 * et /following). Une page en montre parfois moins : voir MemberPage. */
export const MEMBER_LIST_PAGE_SIZE = 30;

/** 403 : les listes d'un compte privé ne s'ouvrent qu'à ses abonnés acceptés. */
export const PRIVATE_ACCOUNT_ERROR = "private_account";
/** 429 : trop de listes ouvertes en une heure. */
export const MEMBER_LIST_LIMIT_ERROR = "member_list_limit";

// ---- Liste « Aimé par » (lot « vie sociale », sans migration) ----

/** 429 : trop de « j'aime » posés ou retirés en une heure (POST /api/posts/:id/react). */
export const POST_REACT_LIMIT_ERROR = "post_react_limit";

// ---- Commentaires : réponses, « j'aime », mentions (lot « vie sociale », migration 0046) ----

/** Réglage « Qui peut me mentionner » (dans un commentaire, plus tard sur une
 * photo) : tout le monde, les comptes que je suis, ou personne. */
export type MentionsFrom = "everyone" | "following" | "nobody";
export const MENTIONS_FROM = ["everyone", "following", "nobody"] as const satisfies readonly MentionsFrom[];
/** Valeur de départ (migration 0046) : seuls les comptes que vous suivez. */
export const DEFAULT_MENTIONS_FROM: MentionsFrom = "following";

/** Mentions prises en compte dans un même texte ; les suivantes restent un simple texte. */
export const MENTION_MAX_PER_TEXT = 5;

/** Un « @pseudo » trouvé dans un texte : le pseudo en minuscules, et sa place
 * (de l'arobase à la fin du pseudo). */
export interface MentionSpan {
  handle: string;
  start: number;
  end: number;
}

// Un « @ » compte seulement en début de texte ou après un caractère qui n'est
// ni une lettre, ni un chiffre, ni « _ », « . » ou « @ » : une adresse e-mail
// n'est jamais une mention. Le pseudo fait 3 à 20 caractères (comme à
// l'inscription) et s'arrête là : un mot plus long n'est pas une mention.
const MENTION_PATTERN = /(^|[^a-z0-9_.@])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi;

/** Tous les « @pseudo » d'un texte, dans l'ordre, doublons compris. */
export function findMentions(text: string): MentionSpan[] {
  const spans: MentionSpan[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = (match.index ?? 0) + (match[1] ?? "").length;
    const handle = (match[2] ?? "").toLowerCase();
    spans.push({ handle, start, end: start + 1 + handle.length });
  }
  return spans;
}

/** Les pseudos mentionnés dans un texte : en minuscules, sans doublon, les
 * MENTION_MAX_PER_TEXT premiers seulement. */
export function extractMentions(text: string): string[] {
  const handles: string[] = [];
  for (const span of findMentions(text)) {
    if (handles.includes(span.handle)) continue;
    handles.push(span.handle);
    if (handles.length >= MENTION_MAX_PER_TEXT) break;
  }
  return handles;
}

/** Une mention acceptée : le pseudo tel qu'il est écrit, et le compte. */
export interface CommentMention {
  handle: string;
  userId: string;
}

/** POST /api/posts/:id/comments. `parentId` : le commentaire auquel on répond. */
export interface CreateCommentRequest {
  body: string;
  parentId?: string;
}

/** PUT /api/comments/:id/like. */
export interface LikeCommentRequest {
  liked: boolean;
}
export interface LikeCommentResponse {
  likeCount: number;
  viewerHasLiked: boolean;
}

/** PUT /api/me/mentions-from. */
export interface UpdateMentionsFromRequest {
  mentionsFrom: MentionsFrom;
}

/** 404 : réponses, « j'aime » des commentaires et réglage des mentions pas encore disponibles (migration 0046 absente). */
export const COMMENT_THREADS_UNAVAILABLE_ERROR = "comment_threads_unavailable";
/** 429 : trop de « j'aime » posés ou retirés sur des commentaires en une heure. */
export const COMMENT_LIKE_LIMIT_ERROR = "comment_like_limit";

// ---- Plusieurs photos, identifier des personnes (lot « vie sociale », migration 0047) ----

/** Photos d'une publication « Une photo », la première comprise. */
export const POST_PHOTOS_MAX = 5;
/** Membres identifiés sur une publication, au plus. */
export const PEOPLE_TAGS_MAX = 5;
/** Les photos 2 à 5 s'ajoutent dans les minutes qui suivent la publication, plus après. */
export const POST_MEDIA_WINDOW_MIN = 10;

/** Une photo d'une publication : la version d'affichage et sa miniature. */
export interface PostPhoto {
  url: string;
  thumbUrl: string;
}

/** GET /api/posts/status : la base sait-elle garder plusieurs photos et des identifications ? */
export interface PostExtrasStatus {
  carousel: boolean;
  peopleTags: boolean;
}

/** POST /api/posts/:id/media (201) : toutes les photos de la publication, la première comprise. */
export interface AddPostMediaResponse {
  media: PostPhoto[];
}

/** 404 : plusieurs photos et identifications pas encore disponibles (migration 0047 absente). */
export const POST_EXTRAS_UNAVAILABLE_ERROR = "post_extras_unavailable";
/** 409 : plus de 10 minutes après la publication, elle ne reçoit plus de photo. */
export const POST_MEDIA_CLOSED_ERROR = "post_media_closed";
/** 409 : la publication a déjà ses 5 photos. */
export const POST_MEDIA_FULL_ERROR = "post_media_full";
/** 409 : une autre photo de la même publication arrivait au même moment. */
export const POST_MEDIA_CONFLICT_ERROR = "post_media_conflict";
/** 429 : trop de photos ajoutées en une heure. */
export const POST_MEDIA_LIMIT_ERROR = "post_media_limit";
/** 404 : identification introuvable (ou pas la vôtre). */
export const PEOPLE_TAG_NOT_FOUND_ERROR = "people_tag_not_found";

// ---- Publications enregistrées (lot « vie sociale », migration 0048) ----

/** Publications enregistrées par membre, au plus. */
export const SAVED_POSTS_MAX = 1000;
/** Lignes LUES par page de GET /api/saved-posts. Une page en montre parfois
 * moins, ou aucune, alors qu'il en reste : seul `nextCursor` dit s'il y a une suite. */
export const SAVED_POSTS_PAGE_SIZE = 18;

/** PUT /api/posts/:id/save : enregistrer, ou ranger ailleurs. `collectionId` :
 * une de vos collections ; null : sans collection ; absent : la collection
 * actuelle reste si la publication est déjà enregistrée (sans collection sinon). */
export interface SavePostRequest {
  collectionId?: string | null;
}
export interface SavePostResponse {
  saved: true;
  collectionId: string | null;
}

/** GET /api/saved-posts?cursor=&collectionId= : vos publications enregistrées
 * que vous pouvez encore voir, les plus récemment enregistrées d'abord. */
export interface SavedPostsPage {
  posts: Post[];
  nextCursor: string | null;
}

/** 404 : publications enregistrées pas encore disponibles (migration 0048 absente). */
export const SAVED_POSTS_UNAVAILABLE_ERROR = "saved_posts_unavailable";
/** 409 : SAVED_POSTS_MAX publications enregistrées déjà. */
export const SAVED_POSTS_FULL_ERROR = "saved_posts_full";
/** 429 : trop de publications enregistrées en une heure. */
export const SAVE_POST_LIMIT_ERROR = "save_post_limit";

// ---- Épingles et lien en bio (lot « vie sociale », migration 0049) ----

/** Publications épinglées en haut d'un profil, au plus (des photos seulement). */
export const PINNED_POSTS_MAX = 3;
/** Longueur maximale d'un lien en bio, une fois mis en forme (la base la vérifie aussi). */
export const BIO_LINK_MAX_LENGTH = 200;

/** PUT /api/posts/:id/pin : épingler (true) ou retirer l'épingle (false). */
export interface PinPostRequest {
  pinned: boolean;
}
export interface PinPostResponse {
  pinnedAt: string | null;
}

/** GET /api/users/:userId/posts : la première page porte aussi `pinned` (au
 * plus PINNED_POSTS_MAX, les plus récemment épinglées d'abord, filtrées comme
 * la page) ; ces publications restent aussi à leur place dans `posts`. Absent
 * sans 0049, sur les pages suivantes, et pour qui n'est pas un abonné accepté
 * d'un compte privé (la page entière est alors vide). */
export interface UserPostsPage extends FeedPage {
  pinned?: Post[];
}

/** 404 : épingles pas encore disponibles (migration 0049 absente). */
export const PINS_UNAVAILABLE_ERROR = "pins_unavailable";
/** 400 : seule une publication « Une photo » s'épingle. */
export const PIN_NOT_ALLOWED_ERROR = "pin_not_allowed";
/** 409 : déjà PINNED_POSTS_MAX publications épinglées. */
export const PIN_LIMIT_ERROR = "pin_limit";
/** 404 : lien en bio pas encore disponible (migration 0049 absente) ; rien du profil n'est enregistré. */
export const PROFILE_LINK_UNAVAILABLE_ERROR = "profile_link_unavailable";
/** 400 : lien refusé (voir checkBioLink). */
export const LINK_INVALID_ERROR = "link_invalid";
/** 400 : lien de plus de BIO_LINK_MAX_LENGTH caractères. */
export const LINK_TOO_LONG_ERROR = "link_too_long";
/** 429 : trop de changements de lien en 24 heures. */
export const PROFILE_LINK_LIMIT_ERROR = "profile_link_limit";

export type BioLinkProblem = "too_long" | "invalid";
/** `url` : l'adresse à enregistrer, mise en forme (null : pas de lien). */
export type BioLinkCheck = { ok: true; url: string | null } | { ok: false; problem: BioLinkProblem };

// Espaces (y compris insécables) et caractères de contrôle, n'importe où :
// refusés, jamais nettoyés (un navigateur les retire en silence).
const BIO_LINK_FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f]/u;
const BIO_LINK_LABEL = /^[a-z0-9-]+$/;

/** Le lien en bio : LA règle, la même au serveur (seul juge) et dans l'app
 * (pour prévenir tout de suite). Après avoir retiré les espaces autour : vide
 * = pas de lien ; sinon une adresse qui commence par « https:// » suivi du nom
 * d'un site, 200 caractères au plus, sans espace ni caractère de contrôle,
 * sans nom ni mot de passe (« nom@site »), sans autre port que 443. Le nom du
 * site : des lettres sans accent, des chiffres, des points et des tirets
 * seulement, au moins un point, ni adresse IP, ni « localhost » (ni « .local ») ;
 * un nom de site internationalisé est refusé sous ses deux formes (caractères
 * non ASCII, ou partie « xn-- » une fois lu), car un sosie d'une marque connue
 * ne se distingue pas sur un écran de téléphone. Rendu tel que le lit le
 * parseur d'URL standard (WHATWG). */
export function checkBioLink(input: string): BioLinkCheck {
  const invalid: BioLinkCheck = { ok: false, problem: "invalid" };
  const value = input.trim();
  if (value === "") return { ok: true, url: null };
  if (value.length > BIO_LINK_MAX_LENGTH) return { ok: false, problem: "too_long" };
  if (BIO_LINK_FORBIDDEN.test(value) || !/^https:\/\/[^/\\]/i.test(value)) return invalid;
  // Le nom du site tel qu'il est écrit, avant toute conversion : ASCII visible, sans « @ ».
  const authority = value.slice("https://".length).split(/[/\\?#]/, 1)[0] ?? "";
  if (!/^[\x21-\x7e]+$/.test(authority) || authority.includes("@")) return invalid;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return invalid;
  const host = url.hostname;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !BIO_LINK_LABEL.test(label) || label.startsWith("xn--"))) return invalid;
  // Une extension en lettres : ni adresse IP (127.0.0.1, 0x7f.1…), ni extension en chiffres.
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1] ?? "")) return invalid;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return invalid;
  const stored = url.href;
  if (stored.length > BIO_LINK_MAX_LENGTH) return { ok: false, problem: "too_long" };
  if (!stored.startsWith("https://") || BIO_LINK_FORBIDDEN.test(stored)) return invalid;
  return { ok: true, url: stored };
}

// ---- Fil « Pour vous » et suggestions de comptes (lot « découverte », migration 0050) ----

/** « Pour vous » : les publications publiques des FOR_YOU_DAYS derniers jours. */
export const FOR_YOU_DAYS = 14;
/** Publications lues, les plus récentes d'abord, avant le classement (le même pour tous). */
export const FOR_YOU_CANDIDATES = 200;
/** Le classement est gardé en mémoire par le serveur, puis refait. */
export const FOR_YOU_CACHE_MS = 5 * 60_000;
/** Publications proposées à un membre, au plus (après ses propres exclusions). */
export const FOR_YOU_MAX = 60;
/** Publications d'un même auteur dans la liste d'un membre, au plus. */
export const FOR_YOU_PER_AUTHOR = 2;
/** Publications par page de GET /api/feed/for-you. */
export const FOR_YOU_PAGE_SIZE = 15;
/** Les seules positions acceptées (paramètre `offset`) : une page de la liste de FOR_YOU_MAX. */
export const FOR_YOU_OFFSETS = [0, 15, 30, 45] as const;
/** Un compte plus jeune que cela n'est proposé à personne qui ne le suit pas. */
export const FOR_YOU_MIN_ACCOUNT_AGE_HOURS = 24;
/** Comptes suggérés par GET /api/users/suggestions, au plus. */
export const SUGGESTIONS_MAX = 10;

/** GET /api/feed/for-you?offset= : une page de la liste du membre. Une page
 * peut être plus courte que FOR_YOU_PAGE_SIZE, ou vide, alors qu'il en reste
 * (une publication devenue invisible depuis le classement est retirée) : seul
 * `nextOffset` dit s'il y a une suite. Une publication peut revenir d'une page
 * à l'autre si le classement a été refait entre-temps : l'app retire les doublons. */
export interface ForYouPage {
  posts: Post[];
  nextOffset: number | null;
}

/** GET /api/users/suggestions : les comptes à découvrir (SUGGESTIONS_MAX au plus). */
export interface SuggestionsResponse {
  members: MemberRow[];
}

/** PUT /api/me/discoverable. */
export interface UpdateDiscoverableRequest {
  discoverable: boolean;
}

/** 404 : le réglage « Proposer mon compte aux autres membres » n'est pas encore disponible (migration 0050 absente). */
export const DISCOVERY_SETTING_UNAVAILABLE_ERROR = "discovery_setting_unavailable";
/** 429 : trop de pages de « Pour vous » lues en une heure. */
export const FOR_YOU_LIMIT_ERROR = "for_you_limit";

// ---- Notifications d'activité sur le téléphone (lot « découverte », migration 0051) ----
// Un « j'aime », un commentaire, un abonné, une mention : une notification sur
// l'iPhone, seulement pour les sortes que la personne a allumées sur cet
// appareil (toutes éteintes au départ). Elle dit qui a fait quoi, jamais le
// texte d'un commentaire, une légende ni une image.

/** Les quatre sortes d'activité, une réponse (un interrupteur) chacune sur
 * l'appareil : « j'aime » ; commentaires et réponses ; abonnés, demandes
 * d'abonnement et demandes acceptées ; mentions et identifications. */
export const ACTIVITY_PUSH_KINDS = ["likes", "comments", "follows", "mentions"] as const;
export type ActivityPushKind = (typeof ACTIVITY_PUSH_KINDS)[number];

/** Ce que porte une notification d'activité, et rien d'autre : la publication
 * (« j'aime », commentaire, réponse, mention, identification), le membre
 * (nouvel abonné, demande acceptée) ou la liste des demandes reçues. */
export type ActivityPushData = { postId: string } | { userId: string } | { screen: "requests" };

/** Les données d'une notification d'activité, ou null si ce n'en est pas une
 * ou si elles sont illisibles : une seule clé, un identifiant de la forme
 * d'un UUID, ou l'écran « requests » ; tout le reste n'ouvre rien. */
export function parseActivityPushData(data: unknown): ActivityPushData | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const entries = Object.entries(data);
  if (entries.length !== 1) return null;
  const [key, value] = entries[0]!;
  if (key === "screen") return value === "requests" ? { screen: "requests" } : null;
  if (typeof value !== "string" || !PUSH_DATA_UUID.test(value)) return null;
  if (key === "postId") return { postId: value };
  if (key === "userId") return { userId: value };
  return null;
}
