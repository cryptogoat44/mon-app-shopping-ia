import type {
  ApiErrorBody,
  AppNotification,
  BlockedUser,
  ConsentStatus,
  VersionedConsentType,
  RecordConsentsRequest,
  CreateReportRequest,
  CreateSearchRequest,
  CreateVaultItemResponse,
  CreateWishlistItemRequest,
  CropRect,
  DeleteAccountRequest,
  FeedPage,
  MatchFeedbackReason,
  MatchFeedbackRequest,
  MerchantLinkContext,
  ModerationActionRequest,
  ModerationActionType,
  ModerationPage,
  ModerationStatus,
  Post,
  PreviewIssue,
  PrivacyLevel,
  Profile,
  ProductMatchClickResponse,
  ProductSearch,
  PublicProfile,
  ReactToPostResponse,
  RemoveImageRequest,
  RunTextSearchRequest,
  TaggedPieceInput,
  UpdateMeRequest,
  UpdateLocaleRequest,
  AppLocale,
  UpdateVaultItemRequest,
  VaultCategory,
  VaultItem,
  VaultItemDetail,
  VaultPage,
  WishlistItem,
  WishlistItemDetail,
  WishlistPage,
  PieceSendsFrom,
  MessagesFrom,
  MessagesStatus,
  PushPlatform,
  RegisterPushTokenRequest,
  DeletePushTokenRequest,
  ConversationsPage,
  ConversationThread,
  SendMessageRequest,
  SendMessageResponse,
  ReceivedPiecesPage,
  CollectionSummary,
  CollectionsList,
  CollectionsStatus,
  KeepSharedItemResponse,
  SharedCollectionItem,
  SharedCollectionPage,
  SharedCollectionSummary,
  SharedCollectionsList,
  UpdateCollectionRequest,
  WishCollections,
  UserProfile,
  CommentsPage,
  PostComment,
  VideoMoment,
  StockReportRequest,
  UpdateWishAlertRequest,
  UpdateWishAlertsSettingsRequest,
  WishAlertState,
  WishAlertsStatus,
} from "@monapp/shared-types";
import { COMPLEMENT_DEFERRED, CONSENT_VERSIONS, parseSearchCapacityStatus, parseVideoMomentsResponse, type SearchCapacityStatus } from "@monapp/shared-types";
import { supabase } from "./supabase";
import { setAnalyticsConsent, track } from "./analytics";
import { acceptLanguage, t } from "../i18n";
import { imageFileFromUri } from "./image-file";
import { ApiError } from "./api-error";
import { isAdjustedCrop } from "./crop-geometry";
import { textSearchFailure } from "./spot-result";
import { requestShops } from "./spot-shops";
import { deviceTimeZone, type ExportFormat, type ExportResponse } from "./export-file";
import { searchLaunched } from "./search-limits";
import { appBuildHeaders, isUpdateRequiredResponse, markUpdateRequired, parseStoreUrl, readAppVersionInfo } from "./app-update";
import { readMessagesStatus, setMessagesStatus } from "./conversations";
import { readCollectionsStatus, setCollectionsStatus } from "./collections";
import { ALERTS_UNAVAILABLE, isAlertsUnavailable, readWishAlertState, readWishAlertStates, readWishAlertsStatus, setWishAlertsStatus } from "./wish-alerts";

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error("EXPO_PUBLIC_API_URL doit être définie (voir apps/mobile/.env.example).");
}

export { ApiError };

async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Aucune session active — impossible d'appeler le backend.");
  }

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  // Ne pas envoyer Content-Type: application/json sans corps — Fastify
  // refuse un JSON body parser sur une requête vide (ex. POST sans body).
  const hasJsonBody = !isFormData && init?.body !== undefined;

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      // App iPhone : son numéro de build (mise à jour obligatoire, app-update.ts).
      ...appBuildHeaders(),
      "Accept-Language": acceptLanguage(),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    // Build sous le minimum réglé sur le serveur : l'écran « Mettez à jour Spotto » prend la place de l'app.
    if (isUpdateRequiredResponse(response.status, body)) markUpdateRequired(parseStoreUrl((body as { storeUrl?: unknown }).storeUrl));
    throw new ApiError(response.status, body ?? { error: "unknown", message: t.common.unknownServerError });
  }

  return response;
}

/** Lot « app iPhone prête » : build minimal exigé de l'app iPhone, lu sans
 * compte (l'accueil aussi doit pouvoir dire « Mettez à jour Spotto »). null :
 * réponse illisible ou en erreur (rien n'est alors bloqué). */
export async function fetchAppVersionInfo(): Promise<{ minimumBuild: number | null; storeUrl: string | null } | null> {
  const response = await fetch(`${apiUrl}/api/app/version`, { headers: { ...appBuildHeaders(), "Accept-Language": acceptLanguage() } });
  if (!response.ok) return null;
  return readAppVersionInfo(await response.json().catch(() => null));
}

/** `signal` : pour abandonner un essai resté sans réponse (lib/retry.ts). */
export async function fetchMyProfile(signal?: AbortSignal): Promise<Profile> {
  const response = await authorizedFetch("/api/me", signal ? { signal } : undefined);
  return response.json();
}

export async function updateMyProfile(payload: UpdateMeRequest): Promise<Profile> {
  const response = await authorizedFetch("/api/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function updateMyLocale(locale: AppLocale): Promise<void> {
  const payload: UpdateLocaleRequest = { locale };
  await authorizedFetch("/api/me/locale", { method: "PUT", body: JSON.stringify(payload) });
}

export async function uploadAvatar(imageUri: string): Promise<Profile> {
  const formData = new FormData();
  await appendImageFile(formData, "file", imageUri);

  const response = await authorizedFetch("/api/me/avatar", { method: "POST", body: formData });
  const profile: Profile = await response.json();
  track("photo_changed", { target: "avatar" });
  return profile;
}

/** Temps 1 du Spotter — gratuit : crée la recherche et renvoie l'image qui
 * sera analysée (`thumbnailUrl`), sans aucun appel SerpApi. */
export async function prepareSearch(payload: CreateSearchRequest): Promise<ProductSearch & { previewIssue?: PreviewIssue | null }> {
  const response = await authorizedFetch("/api/searches/prepare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const search: ProductSearch & { previewIssue?: PreviewIssue | null } = await response.json();
  track("spot_started", { source: payload.sourceUrl ? "link" : "photo", platform: search.sourcePlatform });
  return search;
}

/** Temps 2 du Spotter — 1 à 3 recherches par photo (la recherche visuelle,
 * puis, voie C, le complément ; la recherche par les mots compte dans les
 * mêmes 3) : lance l'identification sur la zone choisie. `imageUri` (capture
 * ou photo importée) remplace l'image préparée. `signal` permet d'abandonner
 * la requête (bouton « Annuler »). Boutiques ensuite (2026-11-08) : la
 * réponse arrive dès la recherche visuelle ; quand le serveur annonce les
 * boutiques en attente, leur demande part aussitôt (lib/spot-shops.ts), et
 * l'écran Résultat la retrouve. Un serveur plus ancien ignore la demande :
 * tout arrive alors en une fois, comme avant. */
export async function runSearch(
  searchId: string,
  params: { crop: CropRect | null; imageUri: string | null; words?: string | null; zoneByAi?: boolean },
  signal?: AbortSignal
): Promise<ProductSearch> {
  searchLaunched();
  const formData = new FormData();
  if (params.crop) formData.append("crop", JSON.stringify(params.crop));
  if (params.imageUri) await appendImageFile(formData, "file", params.imageUri);
  // Mots d'une photo : le serveur s'en sert seulement pour trier les
  // propositions ; jamais envoyés à Google Lens, jamais enregistrés (petit lot 2).
  if (params.words) formData.append("query", params.words);
  // Boutiques ensuite : les résultats d'abord, les autres boutiques juste après.
  formData.append("complement", COMPLEMENT_DEFERRED);

  // Ciblage : seulement des oui / non (statistiques : ni les mots, ni leur présence).
  // « Zone ajustée » : la personne a entouré la pièce — ni l'image entière, ni
  // l'ancienne zone par défaut (lots « premier essai » et « entourer la pièce ») ;
  // la zone trouvée par l'IA compte toujours, même si c'est l'image entière.
  track("spot_launched", { zone_adjusted: params.zoneByAi === true || isAdjustedCrop(params.crop), image_imported: params.imageUri !== null });
  const response = await authorizedFetch(`/api/searches/${searchId}/run`, { method: "POST", body: formData, signal });
  const search: ProductSearch = await response.json();
  if (search.complement?.pending) {
    // spot_completed attend l'issue des boutiques, pour la compter une fois.
    void requestShops(search.id, (shopsSignal) => fetchShops(search.id, shopsSignal)).then((outcome) =>
      trackSpotCompleted(search, outcome.kind === "added" ? outcome.search : null)
    );
  } else {
    trackSpotCompleted(search, search);
  }
  return search;
}

const isLensMatch = (match: ProductSearch["matches"][number]) => match.origin === undefined || match.origin === "lens";

/** spot_completed, une fois par lancement. Voie C (lot c) : results_count
 * reste celui de la recherche visuelle (réponse du lancement) ; le complément
 * a son issue et son nombre (jamais la requête). Boutiques ensuite : compté
 * quand l'issue des boutiques est connue (`final`) ; « unknown » quand l'app
 * ne l'a pas reçue (réseau, délai, refus). */
function trackSpotCompleted(launched: ProductSearch, final: ProductSearch | null): void {
  track("spot_completed", {
    outcome: launched.status === "failed" ? "failed" : launched.matches.length > 0 ? "results" : "none",
    results_count: launched.matches.filter(isLensMatch).length,
    complement: final ? (final.complement?.status ?? "none") : "unknown",
    complement_count: final ? final.matches.filter((match) => !isLensMatch(match)).length : 0,
  });
}

/** Boutiques ensuite (2026-11-08) : « Cette pièce dans d'autres boutiques »
 * pour une recherche lancée avec « complement: deferred », dont les
 * résultats sont déjà affichés. Le serveur ne fait l'étape payante qu'une
 * fois par recherche et renvoie la recherche entière, avec son complément
 * (et la requête de l'IA, seulement dans cette réponse). */
export async function fetchShops(searchId: string, signal?: AbortSignal): Promise<ProductSearch> {
  const response = await authorizedFetch(`/api/searches/${searchId}/complement`, { method: "POST", signal });
  return response.json();
}

/** Voie B (lot c) — « Que cherchez-vous ? » sous un résultat : 1 recherche
 * avec les mots de la personne, une seule fois par recherche et dans les 3
 * de la photo. Les mots partent vers la recherche en ligne ; le serveur ne
 * les enregistre pas, les statistiques n'en disent rien. Renvoie la recherche
 * entière, avec les propositions ajoutées (origine « words »). `signal` :
 * bouton « Annuler ». */
export async function runTextSearch(searchId: string, words: string, signal?: AbortSignal): Promise<ProductSearch> {
  searchLaunched();
  const payload: RunTextSearchRequest = { words };
  track("text_search_launched");
  try {
    const response = await authorizedFetch(`/api/searches/${searchId}/text`, { method: "POST", body: JSON.stringify(payload), signal });
    const search: ProductSearch = await response.json();
    track("text_search_completed", {
      outcome: search.complement?.textStatus ?? "failed",
      results_count: search.matches.filter((match) => match.origin === "words").length,
    });
    return search;
  } catch (error) {
    // Seule une panne (réseau ou serveur) est comptée « failed ». « Annuler »,
    // ou un refus avant toute recherche (mots refusés, plafond ou trop de
    // recherches d'un coup, fonction coupée, recherche non admissible ou déjà
    // lancée) : pas d'issue à compter, comme au lancement.
    if (!signal?.aborted && textSearchFailure(error).kind === "technical") track("text_search_completed", { outcome: "failed", results_count: 0 });
    throw error;
  }
}

/** Joint une photo locale à un envoi (site et iPhone, voir image-file.ts).
 * Sans extension reconnue, le nom suit le type réel du fichier. */
async function appendImageFile(formData: FormData, fieldName: string, imageUri: string): Promise<void> {
  const file = await imageFileFromUri(imageUri);
  const filename = imageUri.split("/").pop()?.split("?")[0] ?? "";
  formData.append(fieldName, file, /\.\w+$/.test(filename) ? filename : `photo.${file.type === "image/png" ? "png" : "jpg"}`);
}

/** `signal` : relecture abandonnée avec la recherche par les mots (voie B). */
export async function fetchSearch(searchId: string, signal?: AbortSignal): Promise<ProductSearch> {
  const response = await authorizedFetch(`/api/searches/${searchId}`, signal ? { signal } : undefined);
  return response.json();
}

export async function listRecentSearches(limit?: number): Promise<ProductSearch[]> {
  const query = limit ? `?limit=${limit}` : "";
  const response = await authorizedFetch(`/api/searches${query}`);
  return response.json();
}

export async function trackProductMatchClick(
  matchId: string,
  context: MerchantLinkContext
): Promise<ProductMatchClickResponse> {
  const response = await authorizedFetch(`/api/product-matches/${matchId}/click`, {
    method: "POST",
    body: JSON.stringify({ context }),
    // Ce suivi est envoyé en arrière-plan, jamais attendu avant d'ouvrir le
    // lien marchand (voir merchant-links.ts) — keepalive laisse la requête
    // se terminer même si l'onglet/la page d'origine se ferme juste après.
    keepalive: true,
  });
  return response.json();
}

/** Lot limites annoncées : le compteur des recherches, lu sans rien réserver
 * (gratuit, aucune recherche lancée) ; null si la réponse est illisible. */
export async function fetchSearchCapacity(): Promise<SearchCapacityStatus | null> {
  const response = await authorizedFetch("/api/searches/capacity");
  return parseSearchCapacityStatus(await response.json());
}

export async function fetchVault(cursor?: string): Promise<VaultPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/vault${query}`);
  return response.json();
}

export async function fetchVaultItem(id: string): Promise<VaultItemDetail> {
  const response = await authorizedFetch(`/api/vault/${id}`);
  return response.json();
}

/** « Je l'ai achetée » (résultat ou envie). Proposition déjà dans le Vault :
 * le serveur renvoie la pièce déjà là (`alreadyInVault`), rien n'est créé. */
export async function addVaultItemFromMatch(params: {
  title: string;
  imageUrl: string;
  category: VaultCategory;
  productMatchId: string;
}): Promise<CreateVaultItemResponse> {
  const formData = new FormData();
  formData.append("title", params.title);
  formData.append("category", params.category);
  formData.append("imageUrl", params.imageUrl);
  formData.append("productMatchId", params.productMatchId);

  const response = await authorizedFetch("/api/vault", { method: "POST", body: formData });
  const item: CreateVaultItemResponse = await response.json();
  if (item.alreadyInVault !== true) track("vault_item_added", { source: "spotter", category: params.category });
  return item;
}

export async function addVaultItemFromPhoto(params: {
  title: string;
  category: VaultCategory;
  imageUri: string;
}): Promise<VaultItem> {
  const formData = new FormData();
  formData.append("title", params.title);
  formData.append("category", params.category);
  await appendImageFile(formData, "file", params.imageUri);

  const response = await authorizedFetch("/api/vault", { method: "POST", body: formData });
  const item: VaultItem = await response.json();
  track("vault_item_added", { source: "photo", category: params.category });
  return item;
}

export async function updateVaultItem(id: string, payload: UpdateVaultItemRequest): Promise<VaultItem> {
  const response = await authorizedFetch(`/api/vault/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response.json();
}

/** « Changer la photo » d'une pièce du Vault (photo prise ou importée). */
export async function changeVaultItemPhoto(id: string, imageUri: string): Promise<VaultItem> {
  const formData = new FormData();
  await appendImageFile(formData, "file", imageUri);
  const response = await authorizedFetch(`/api/vault/${id}/photo`, { method: "POST", body: formData });
  const item: VaultItem = await response.json();
  track("photo_changed", { target: "vault" });
  return item;
}

export async function deleteVaultItem(id: string): Promise<void> {
  await authorizedFetch(`/api/vault/${id}`, { method: "DELETE" });
}

export async function fetchWishlist(cursor?: string): Promise<WishlistPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/wishlist${query}`);
  return response.json();
}

export async function addWishlistItem(payload: CreateWishlistItemRequest): Promise<WishlistItem> {
  const response = await authorizedFetch("/api/wishlist", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const item: WishlistItem = await response.json();
  track("wishlist_item_added", { context: "result" });
  return item;
}

export async function searchUsers(query: string): Promise<PublicProfile[]> {
  const response = await authorizedFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
  return response.json();
}

export async function followUser(userId: string, context: "search" | "profile"): Promise<void> {
  await authorizedFetch(`/api/follows/${userId}`, { method: "POST" });
  track("follow_added", { context });
}

export async function unfollowUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/follows/${userId}`, { method: "DELETE" });
}

export async function fetchFeed(cursor?: string): Promise<FeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/feed${query}`);
  return response.json();
}

export async function fetchMyLifestylePosts(): Promise<Post[]> {
  const response = await authorizedFetch("/api/posts/mine");
  return response.json();
}

export async function fetchPost(id: string): Promise<Post> {
  const response = await authorizedFetch(`/api/posts/${id}`);
  return response.json();
}

export async function updatePostPrivacy(id: string, privacy: PrivacyLevel): Promise<Post> {
  const response = await authorizedFetch(`/api/posts/${id}`, { method: "PATCH", body: JSON.stringify({ privacy }) });
  const post: Post = await response.json();
  track("post_visibility_changed", { visibility: post.privacy });
  return post;
}

export async function deletePost(id: string): Promise<void> {
  await authorizedFetch(`/api/posts/${id}`, { method: "DELETE" });
}

export async function fetchComments(postId: string, cursor?: string): Promise<CommentsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/posts/${postId}/comments${query}`);
  return response.json();
}

export async function createComment(postId: string, body: string): Promise<PostComment> {
  const response = await authorizedFetch(`/api/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  const comment: PostComment = await response.json();
  track("comment_posted");
  return comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  await authorizedFetch(`/api/comments/${commentId}`, { method: "DELETE" });
}

export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const response = await authorizedFetch(`/api/users/${userId}`);
  return response.json();
}

export async function fetchUserPosts(userId: string, cursor?: string): Promise<FeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/users/${userId}/posts${query}`);
  return response.json();
}

export async function fetchWishlistItem(id: string): Promise<WishlistItemDetail> {
  const response = await authorizedFetch(`/api/wishlist/${id}`);
  return response.json();
}

// ---- Partage d'une envie (lot 5, 5.C) : toujours un geste volontaire ----

/** Republier une envie sur son profil (publication « envie »). */
export async function republishWish(id: string, privacy: PrivacyLevel): Promise<Post> {
  const response = await authorizedFetch(`/api/wishlist/${id}/republish`, { method: "POST", body: JSON.stringify({ privacy }) });
  const post: Post = await response.json();
  track("wish_republished", { visibility: post.privacy });
  return post;
}

/** Envoyer une envie à une personne sur Spotto. */
export async function sendPiece(wishId: string, recipientId: string): Promise<void> {
  await authorizedFetch(`/api/wishlist/${wishId}/send`, { method: "POST", body: JSON.stringify({ recipientId }) });
  track("piece_sent");
}

/** Pièces reçues, des plus récentes aux plus anciennes. */
export async function fetchReceivedPieces(cursor?: string | null): Promise<ReceivedPiecesPage> {
  const response = await authorizedFetch(`/api/pieces/received${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return response.json();
}

export async function removeReceivedPiece(id: string): Promise<void> {
  await authorizedFetch(`/api/pieces/received/${id}`, { method: "DELETE" });
  track("received_piece_removed");
}

/** Réglage « Qui peut m'envoyer des pièces ». */
export async function updatePieceSendsFrom(pieceSendsFrom: PieceSendsFrom): Promise<void> {
  await authorizedFetch("/api/me/piece-sends-from", { method: "PUT", body: JSON.stringify({ pieceSendsFrom }) });
  track("piece_sends_setting_changed", { value: pieceSendsFrom });
}

// ---- Messages privés (lot messages) ----

/** Disponibilité de la messagerie et conversations non lues. Un serveur sans
 * la messagerie (ou en erreur) vaut « indisponible » : l'entrée est cachée.
 * L'état est partagé avec les écrans abonnés (lib/conversations.ts). */
export async function fetchMessagesStatus(): Promise<MessagesStatus> {
  let status: MessagesStatus;
  try {
    const response = await authorizedFetch("/api/messages/status");
    status = readMessagesStatus(await response.json().catch(() => null));
  } catch (e) {
    // Hors ligne : l'état connu reste affiché.
    if (e instanceof TypeError) throw e;
    status = readMessagesStatus(null);
  }
  setMessagesStatus(status);
  return status;
}

export async function fetchConversations(cursor?: string | null): Promise<ConversationsPage> {
  const response = await authorizedFetch(`/api/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return response.json();
}

/** Une conversation : les derniers messages, ou seulement les nouveaux
 * depuis `after` (relecture), ou les plus anciens avant `before`. */
export async function fetchConversation(id: string, options: { after?: string | null; before?: string | null } = {}): Promise<ConversationThread> {
  const query = options.after ? `?after=${encodeURIComponent(options.after)}` : options.before ? `?before=${encodeURIComponent(options.before)}` : "";
  const response = await authorizedFetch(`/api/conversations/${encodeURIComponent(id)}${query}`);
  return response.json();
}

/** La conversation avec une personne (bouton « Message » d'un profil). */
export async function fetchConversationWith(userId: string): Promise<ConversationThread> {
  const response = await authorizedFetch(`/api/conversations/with/${encodeURIComponent(userId)}`);
  return response.json();
}

export async function sendMessage(payload: SendMessageRequest): Promise<SendMessageResponse> {
  const response = await authorizedFetch("/api/messages", { method: "POST", body: JSON.stringify(payload) });
  return response.json();
}

export async function markConversationRead(id: string): Promise<void> {
  await authorizedFetch(`/api/conversations/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export async function acceptInvitation(id: string): Promise<void> {
  await authorizedFetch(`/api/conversations/${encodeURIComponent(id)}/accept`, { method: "POST" });
}

export async function declineInvitation(id: string): Promise<void> {
  await authorizedFetch(`/api/conversations/${encodeURIComponent(id)}/decline`, { method: "POST" });
}

/** Réglage « Qui peut m'écrire ». */
export async function updateMessagesFrom(messagesFrom: MessagesFrom): Promise<void> {
  await authorizedFetch("/api/me/messages-from", { method: "PUT", body: JSON.stringify({ messagesFrom }) });
}

// ---- Notifications des nouveaux messages sur le téléphone (lot notifications) ----
// Appelées seulement par lib/push.ts (app iPhone), jamais par le site.

/** Enregistre (ou rafraîchit) cet appareil pour les notifications.
 * `messages` (lot alertes prix) : false garde l'appareil pour les seules
 * alertes prix et stock (aucune notification de message). */
export async function registerPushToken(token: string, platform: PushPlatform, messages: boolean): Promise<void> {
  const payload: RegisterPushTokenRequest = { token, platform, messages };
  await authorizedFetch("/api/me/push-token", { method: "PUT", body: JSON.stringify(payload) });
}

/** Oublie cet appareil (notifications coupées, déconnexion). `signal` : la
 * déconnexion n'attend jamais longtemps. */
export async function deletePushToken(token: string, signal?: AbortSignal): Promise<void> {
  const payload: DeletePushTokenRequest = { token };
  await authorizedFetch("/api/me/push-token", { method: "DELETE", body: JSON.stringify(payload), ...(signal ? { signal } : {}) });
}

// ---- Alertes prix et stock (lot 2, migration 0036) ----
// Sans 0036 sur le serveur, GET /api/alerts/status dit « indisponible » et
// les autres routes répondent 404 « alerts_unavailable » : l'état partagé
// (lib/wish-alerts.ts) passe alors à « indisponible » et tout est caché.

/** Les alertes sont-elles disponibles, l'interrupteur allumé, les
 * notifications possibles ? Un serveur sans elles (ou en erreur) vaut
 * « indisponible ». L'état est partagé avec les écrans abonnés. */
export async function fetchWishAlertsStatus(): Promise<WishAlertsStatus> {
  let status: WishAlertsStatus;
  try {
    const response = await authorizedFetch("/api/alerts/status");
    status = readWishAlertsStatus(await response.json().catch(() => null));
  } catch (e) {
    // Hors ligne : l'état connu reste affiché.
    if (e instanceof TypeError) throw e;
    status = readWishAlertsStatus(null);
  }
  setWishAlertsStatus(status);
  return status;
}

/** Une route des alertes a répondu « indisponibles » : tout est caché. */
function forgetAlertsOn(e: unknown): never {
  if (isAlertsUnavailable(e)) setWishAlertsStatus(ALERTS_UNAVAILABLE);
  throw e;
}

/** L'interrupteur « Alertes prix et stock » des Réglages. */
export async function updateWishAlertsSettings(enabled: boolean): Promise<WishAlertsStatus> {
  const payload: UpdateWishAlertsSettingsRequest = { enabled };
  try {
    const response = await authorizedFetch("/api/alerts/settings", { method: "PUT", body: JSON.stringify(payload) });
    const status = readWishAlertsStatus(await response.json().catch(() => null));
    setWishAlertsStatus(status);
    return status;
  } catch (e) {
    return forgetAlertsOn(e);
  }
}

/** Les cloches de vos envies suivies (liste des Envies, collections). Une
 * envie absente n'a pas encore d'état : pas de cloche dans la liste. */
export async function fetchWishAlertStates(): Promise<Map<string, WishAlertState>> {
  try {
    const response = await authorizedFetch("/api/alerts/wishes");
    return readWishAlertStates(await response.json().catch(() => null));
  } catch (e) {
    return forgetAlertsOn(e);
  }
}

/** La cloche d'une de vos envies (créée sur le serveur si elle manque). null :
 * réponse illisible (pas de cloche). */
export async function fetchWishAlert(id: string): Promise<WishAlertState | null> {
  try {
    const response = await authorizedFetch(`/api/wishlist/${encodeURIComponent(id)}/alerts`);
    return readWishAlertState(await response.json().catch(() => null));
  } catch (e) {
    return forgetAlertsOn(e);
  }
}

/** Régler la cloche d'une de vos envies. Renvoie la cloche enregistrée ; l'état
 * général (interrupteur allumé par la première cloche) est partagé. */
export async function updateWishAlert(id: string, payload: UpdateWishAlertRequest): Promise<WishAlertState | null> {
  try {
    const response = await authorizedFetch(`/api/wishlist/${encodeURIComponent(id)}/alerts`, { method: "PUT", body: JSON.stringify(payload) });
    const body = (await response.json().catch(() => null)) as { state?: unknown; status?: unknown } | null;
    if (body?.status !== undefined) setWishAlertsStatus(readWishAlertsStatus(body.status));
    return readWishAlertState(body?.state);
  } catch (e) {
    return forgetAlertsOn(e);
  }
}

/** « Plus disponible » : sur une proposition d'une de vos recherches, ou sur
 * une de vos envies. Rien n'est renvoyé (aucune alerte ne part). */
export async function reportStockGone(payload: StockReportRequest): Promise<void> {
  try {
    await authorizedFetch("/api/alerts/stock-reports", { method: "POST", body: JSON.stringify(payload) });
  } catch (e) {
    forgetAlertsOn(e);
  }
}

// ---- Collections d'envies (lot collections) ----

/** Disponibilité des collections. Un serveur sans elles (ou en erreur) vaut
 * « indisponible » : tout est caché. L'état est partagé avec les écrans
 * abonnés (lib/collections.ts). */
export async function fetchCollectionsStatus(): Promise<CollectionsStatus> {
  let status: CollectionsStatus;
  try {
    const response = await authorizedFetch("/api/collections/status");
    status = readCollectionsStatus(await response.json().catch(() => null));
  } catch (e) {
    // Hors ligne : l'état connu reste affiché.
    if (e instanceof TypeError) throw e;
    status = readCollectionsStatus(null);
  }
  setCollectionsStatus(status);
  return status;
}

/** Ses collections, dans l'ordre de création. */
export async function fetchCollections(): Promise<CollectionSummary[]> {
  const response = await authorizedFetch("/api/collections");
  return ((await response.json()) as CollectionsList).collections;
}

/** Nouvelle collection (toujours privée). */
export async function createCollection(name: string): Promise<CollectionSummary> {
  const response = await authorizedFetch("/api/collections", { method: "POST", body: JSON.stringify({ name }) });
  return response.json();
}

/** Renommer, et/ou montrer à ses amis ou rendre privée. */
export async function updateCollection(id: string, payload: UpdateCollectionRequest): Promise<CollectionSummary> {
  const response = await authorizedFetch(`/api/collections/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
  return response.json();
}

/** Supprimer une collection (ses envies restent dans les Envies). */
export async function deleteCollection(id: string): Promise<void> {
  await authorizedFetch(`/api/collections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Ses envies rangées dans une collection, les plus récemment ajoutées d'abord. */
export async function fetchCollectionWishlist(id: string, cursor?: string | null): Promise<WishlistPage> {
  const response = await authorizedFetch(`/api/collections/${encodeURIComponent(id)}/wishlist${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return response.json();
}

/** Les collections qui contiennent une de ses envies. */
export async function fetchWishCollections(wishId: string): Promise<string[]> {
  const response = await authorizedFetch(`/api/wishlist/${encodeURIComponent(wishId)}/collections`);
  return ((await response.json()) as WishCollections).collectionIds;
}

/** Ranger une de ses envies dans ces collections (et la retirer des autres). */
export async function setWishCollections(wishId: string, collectionIds: string[]): Promise<string[]> {
  const response = await authorizedFetch(`/api/wishlist/${encodeURIComponent(wishId)}/collections`, { method: "PUT", body: JSON.stringify({ collectionIds }) });
  return ((await response.json()) as WishCollections).collectionIds;
}

/** Les collections qu'un membre montre à ses amis (vide pour les autres). */
export async function fetchUserCollections(userId: string): Promise<SharedCollectionSummary[]> {
  const response = await authorizedFetch(`/api/users/${encodeURIComponent(userId)}/collections`);
  return ((await response.json()) as SharedCollectionsList).collections;
}

/** Une collection d'un ami et ses envies. */
export async function fetchSharedCollection(id: string, cursor?: string | null): Promise<SharedCollectionPage> {
  const response = await authorizedFetch(`/api/collections/${encodeURIComponent(id)}/shared${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return response.json();
}

/** Une envie d'une collection d'un ami (carte jointe d'avance à « En parler »). */
export async function fetchCollectionItem(id: string): Promise<SharedCollectionItem> {
  const response = await authorizedFetch(`/api/collection-items/${encodeURIComponent(id)}`);
  return response.json();
}

/** « Garder » une envie d'un ami dans ses Envies. */
export async function keepSharedItem(id: string): Promise<KeepSharedItemResponse> {
  const response = await authorizedFetch(`/api/collection-items/${encodeURIComponent(id)}/keep`, { method: "POST" });
  return response.json();
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await authorizedFetch(`/api/wishlist/${id}`, { method: "DELETE" });
}

/** Notifications, des plus récentes aux plus anciennes : 50 par page ;
 * `cursor` = date de la dernière reçue, pour la page suivante. */
export const NOTIFICATIONS_PAGE_SIZE = 50;

export async function fetchNotifications(cursor?: string): Promise<AppNotification[]> {
  const response = await authorizedFetch(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return response.json();
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await authorizedFetch("/api/notifications/unread-count");
  const data = (await response.json()) as { count: number };
  return data.count;
}

export async function markNotificationsRead(): Promise<void> {
  await authorizedFetch("/api/notifications/read-all", { method: "POST" });
}

export async function blockUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/blocks/${userId}`, { method: "POST" });
}

export async function unblockUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/blocks/${userId}`, { method: "DELETE" });
}

export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const response = await authorizedFetch("/api/blocks");
  return response.json();
}

// Modération (lot 5) : réservée aux administrateurs, revérifiée par le serveur à chaque appel.
export async function fetchModerationQueue(status: ModerationStatus, cursor?: string | null): Promise<ModerationPage> {
  const query = `status=${encodeURIComponent(status)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const response = await authorizedFetch(`/api/admin/moderation?${query}`);
  return response.json();
}

export async function applyModerationDecision(payload: ModerationActionRequest): Promise<void> {
  await authorizedFetch("/api/admin/moderation/actions", { method: "POST", body: JSON.stringify(payload) });
  track("moderation_decision", { decision: payload.action, target_type: payload.targetType });
}

/** Retire l'image copiée d'une publication « envie » ou d'une pièce envoyée
 * (lot 5, partie B) : le serveur efface d'abord le fichier, puis enregistre
 * la décision ; définitif. */
export async function removeCopiedImage(payload: RemoveImageRequest): Promise<void> {
  await authorizedFetch("/api/admin/moderation/remove-image", { method: "POST", body: JSON.stringify(payload) });
  track("moderation_decision", { decision: "remove_image", target_type: payload.targetType });
}

/** Annule un masquage (`hide`) ou une suspension (`suspend`) encore en vigueur. */
export async function undoModerationDecision(actionId: string, undone: Extract<ModerationActionType, "hide" | "suspend">): Promise<void> {
  await authorizedFetch(`/api/admin/moderation/actions/${encodeURIComponent(actionId)}/undo`, { method: "POST", body: JSON.stringify({}) });
  track("moderation_undone", { decision: undone });
}

/** Bouton « Résultat incohérent » : seuls l'identifiant de la proposition et
 * le motif partent (ni texte libre, ni image). */
export async function reportInconsistentResult(matchId: string, reason: MatchFeedbackReason): Promise<void> {
  const body: MatchFeedbackRequest = { reason };
  await authorizedFetch(`/api/product-matches/${encodeURIComponent(matchId)}/feedback`, { method: "POST", body: JSON.stringify(body) });
}

export async function withdrawInconsistentReport(matchId: string): Promise<void> {
  await authorizedFetch(`/api/product-matches/${encodeURIComponent(matchId)}/feedback`, { method: "DELETE" });
}

export async function reportContent(payload: CreateReportRequest): Promise<void> {
  await authorizedFetch("/api/reports", { method: "POST", body: JSON.stringify(payload) });
  track("report_submitted", { target_type: payload.targetType });
}

export async function createLifestylePost(params: {
  caption: string;
  imageUri: string;
  privacy?: string;
  taggedPieces?: TaggedPieceInput[];
}): Promise<Post> {
  const formData = new FormData();
  formData.append("type", "lifestyle");
  if (params.caption) formData.append("caption", params.caption);
  if (params.privacy) formData.append("privacy", params.privacy);
  if (params.taggedPieces && params.taggedPieces.length > 0) {
    formData.append("taggedPieces", JSON.stringify(params.taggedPieces));
  }
  await appendImageFile(formData, "file", params.imageUri);

  const response = await authorizedFetch("/api/posts", { method: "POST", body: formData });
  const post: Post = await response.json();
  track("post_published", { type: "lifestyle", visibility: post.privacy, tagged_count: params.taggedPieces?.length ?? 0 });
  return post;
}

export async function sharePurchasePost(vaultItemId: string, privacy: PrivacyLevel, caption?: string): Promise<Post> {
  const formData = new FormData();
  formData.append("type", "purchase");
  formData.append("vaultItemId", vaultItemId);
  formData.append("privacy", privacy);
  if (caption) formData.append("caption", caption);

  const response = await authorizedFetch("/api/posts", { method: "POST", body: formData });
  const post: Post = await response.json();
  track("post_published", { type: "purchase", visibility: post.privacy, tagged_count: 0 });
  return post;
}

export async function reactToPost(postId: string): Promise<ReactToPostResponse> {
  const response = await authorizedFetch(`/api/posts/${postId}/react`, { method: "POST" });
  const result: ReactToPostResponse = await response.json();
  if (result.viewerHasReacted) track("like_added");
  return result;
}

export async function fetchConsentStatus(): Promise<ConsentStatus[]> {
  const response = await authorizedFetch("/api/consents");
  return response.json();
}

/** Enregistre l'acceptation des documents juridiques et la déclaration
 * d'âge, dans la version en vigueur affichée par l'app (le serveur refuse
 * toute autre version). */
export async function acceptConsents(types: VersionedConsentType[]): Promise<void> {
  const body: RecordConsentsRequest = { consents: types.map((type) => ({ type, version: CONSENT_VERSIONS[type] })) };
  await authorizedFetch("/api/consents", { method: "POST", body: JSON.stringify(body) });
}

/** Accord (true) ou refus / retrait (false) des statistiques d'usage ; effet
 * immédiat sur la collecte dès que le serveur a enregistré le choix. */
export async function recordAnalyticsChoice(granted: boolean): Promise<void> {
  const body: RecordConsentsRequest = { consents: [{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted }] };
  await authorizedFetch("/api/consents", { method: "POST", body: JSON.stringify(body) });
  setAnalyticsConsent(granted);
}

/** Consentement « analyse automatique de la vidéo » (lot 4, temps 1 bis) :
 * accord (true) ou refus / retrait (false), événement daté et versionné. */
export async function recordVideoAiChoice(granted: boolean): Promise<void> {
  const body: RecordConsentsRequest = { consents: [{ type: "analyse_video_ia", version: CONSENT_VERSIONS.analyse_video_ia, granted }] };
  await authorizedFetch("/api/consents", { method: "POST", body: JSON.stringify(body) });
}

/** L'analyse automatique est-elle active sur le serveur (clé d'API présente) ? */
export async function fetchVideoAiEnabled(): Promise<boolean> {
  const response = await authorizedFetch("/api/video-moments/status");
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "enabled" in body && body.enabled === true;
}

/** Étage 2 : les images réduites (12 au plus) et quelques mots partent au
 * serveur, qui interroge l'IA ; jusqu'à 3 moments reviennent, vérifiés ici
 * aussi (jamais de confiance aveugle dans le réseau). */
export async function findVideoMoments(frameUris: readonly string[], query: string, signal?: AbortSignal): Promise<VideoMoment[]> {
  searchLaunched();
  const formData = new FormData();
  formData.append("query", query.trim());
  for (const uri of frameUris) await appendImageFile(formData, "frame", uri);
  const response = await authorizedFetch("/api/video-moments", { method: "POST", body: formData, signal });
  const moments = parseVideoMomentsResponse(await response.json(), frameUris.length);
  if (!moments) throw new ApiError(502, { error: "video_ai_unavailable", message: t.common.unknownServerError });
  return moments;
}

/** Export des données (lot 5) : « html », le fichier lisible rendu par le
 * serveur dans la langue de l'app et daté dans le fuseau de l'appareil ;
 * « json », le format technique. Le texte est rendu brut, avec son type :
 * un serveur plus ancien renvoie encore le JSON (voir export-file.ts). */
export async function exportMyData(format: ExportFormat): Promise<ExportResponse> {
  const timeZone = deviceTimeZone();
  const response = await authorizedFetch(`/api/me/export?format=${format}`, {
    headers: timeZone ? { "X-Time-Zone": timeZone } : {},
  });
  return { text: await response.text(), contentType: response.headers.get("Content-Type") };
}

/** Supprime son compte : `confirmation` est le mot tapé par la personne,
 * revérifié par le serveur (lot 5). */
export async function deleteMyAccount(confirmation: string): Promise<void> {
  const body: DeleteAccountRequest = { confirmation };
  await authorizedFetch("/api/me", { method: "DELETE", body: JSON.stringify(body) });
}
