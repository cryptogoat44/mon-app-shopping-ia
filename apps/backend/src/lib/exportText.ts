import {
  MINIMUM_AGE,
  type AppLocale,
  type CollectionVisibility,
  type ConsentType,
  type MatchFeedbackReason,
  type MatchOrigin,
  type MerchantLinkContext,
  type MessagesFrom,
  type ModerationActionType,
  type ModerationReason,
  type NotificationType,
  type PieceSendsFrom,
  type PlatformSource,
  type PostType,
  type PrivacyLevel,
  type PushPlatform,
  type RecognitionMethod,
  type ReportReason,
  type ReportTargetType,
  type SearchStatus,
  type StockState,
  type VaultCategory,
  type WishAlertKind,
  type WishAlertStatus,
  type SEARCH_FAILURE_MESSAGES,
} from "@monapp/shared-types";
import type { ExportDataKey } from "./exportData.js";

// Textes du fichier lisible de l'export RGPD, en français et en anglais
// (langue de l'app sur l'appareil). Vouvoiement, mots simples : le fichier
// s'adresse à une personne, pas à un développeur.
//
// Chaque colonne de chaque section de l'export a son libellé ici ; une
// colonne « technique » (identifiant interne) n'apparaît que dans la version
// JSON en fin de fichier. Une colonne absente d'ici (ajoutée par une future
// migration) n'est jamais perdue : le fichier l'affiche sous son nom brut,
// dans « Autres informations », et le serveur le journalise (nom seulement).
//
// Les libellés des valeurs (visibilité, état d'une recherche…) sont typés sur
// les constantes partagées : une valeur ajoutée sans son libellé ne compile
// pas. Une valeur inconnue s'affiche telle quelle.
//
// Attention (tests/messages.test.ts) : jamais une clé finissant par
// « message » suivie d'un texte entre guillemets — le test la prendrait pour
// un message d'erreur à traduire. Les libellés sont toujours des objets
// { fr, en }.

export interface Bilingual {
  readonly fr: string;
  readonly en: string;
}

export interface ExportColumn {
  readonly label: Bilingual;
  /** Identifiant interne : seulement dans la version JSON du fichier. */
  readonly technical?: true;
}

const shown = (fr: string, en: string): ExportColumn => ({ label: { fr, en } });
const technical = (fr: string, en: string): ExportColumn => ({ label: { fr, en }, technical: true });

const ID = technical("Identifiant interne", "Internal identifier");
const USER_ID = technical("Votre identifiant interne", "Your internal identifier");

const PIECE_SEND_COLUMNS = {
  id: ID,
  title: shown("Pièce", "Piece"),
  image_url: shown("Image (copie Spotto)", "Image (Spotto copy)"),
  image_thumb_url: shown("Miniature (copie Spotto)", "Thumbnail (Spotto copy)"),
  merchant_name: shown("Marchand", "Retailer"),
  merchant_url: shown("Lien vers la pièce", "Link to the piece"),
  product_match_id: technical("Pièce proposée d'origine", "Original suggested piece"),
  price_min: shown("Prix", "Price"),
  currency: shown("Devise", "Currency"),
  hidden_at: shown("Masquée par la modération le", "Hidden by moderation on"),
  image_removed_at: shown("Image retirée par la modération le", "Image removed by moderation on"),
} as const;

const MODERATION_DECISION_COLUMNS = {
  id: ID,
  action: shown("Décision", "Decision"),
  target_type: shown("Concerne", "About"),
  target_id: technical("Contenu ou compte concerné", "Content or account concerned"),
  reason: shown("Motif", "Reason"),
  note: shown("Précision", "Note"),
  undoes_action_id: technical("Décision annulée", "Decision reversed"),
  created_at: shown("Date", "Date"),
} as const;

const MESSAGE_WISH_COLUMNS = {
  wish_title: shown("Envie jointe", "Attached wish"),
  wish_image_url: shown("Image de l'envie (copie Spotto)", "Wish image (Spotto copy)"),
  wish_image_thumb_url: shown("Miniature de l'envie (copie Spotto)", "Wish thumbnail (Spotto copy)"),
  wish_merchant_name: shown("Marchand", "Retailer"),
  wish_merchant_url: shown("Lien vers la pièce", "Link to the piece"),
  wish_product_match_id: technical("Pièce proposée d'origine", "Original suggested piece"),
  wish_price_min: shown("Prix", "Price"),
  wish_currency: shown("Devise", "Currency"),
} as const;

/** Libellé de chaque colonne connue, par section de l'export. */
export const EXPORT_COLUMNS = {
  account: {
    email: shown("Adresse e-mail", "Email address"),
  },
  profile: {
    id: USER_ID,
    username: shown("Nom d'utilisateur", "Username"),
    display_name: shown("Nom affiché", "Display name"),
    avatar_url: shown("Photo de profil", "Profile photo"),
    bio: shown("Bio", "Bio"),
    locale: shown("Langue de l'app", "App language"),
    default_privacy: shown("Visibilité proposée pour vos publications", "Suggested visibility for your posts"),
    piece_sends_from: shown("Qui peut vous envoyer des pièces", "Who can send you pieces"),
    // Lot messages (migration 0032).
    messages_from: shown("Qui peut vous écrire", "Who can write to you"),
    // Lot alertes prix et stock (migration 0036).
    price_alerts_enabled: shown("Alertes prix et stock", "Price and stock alerts"),
    created_at: shown("Compte créé le", "Account created on"),
    updated_at: shown("Profil modifié le", "Profile updated on"),
  },
  productSearches: {
    id: ID,
    user_id: USER_ID,
    source_url: shown("Lien de la vidéo ou de la publication", "Link to the video or post"),
    source_platform: shown("Origine", "Source"),
    method: shown("Image analysée", "Analysed image"),
    thumbnail_url: shown("Image de la vidéo", "Video image"),
    screenshot_url: technical("Adresse interne de l'image analysée", "Internal address of the analysed image"),
    status: shown("État", "Status"),
    error_message: shown("Raison de l'échec", "Reason for the failure"),
    created_at: shown("Date", "Date"),
    query: shown("Texte ajouté", "Text you added"),
    // Mesure de la qualité des résultats (migration 0025) : des nombres et
    // des valeurs d'une liste fermée, dans la version JSON seulement.
    outcome: technical("Issue de la recherche (mesure de qualité)", "Search outcome (quality measure)"),
    failure_kind: technical("Type de panne (mesure de qualité)", "Kind of failure (quality measure)"),
    received_count: technical("Propositions reçues de la recherche visuelle", "Results received from the visual search"),
    removed_incomplete: technical("Propositions écartées : sans titre, lien ou image, ou illisibles", "Results set aside: no title, link or image, or unreadable"),
    removed_social: technical("Propositions écartées : réseaux sociaux et pages où rien ne s'achète", "Results set aside: social networks and pages with nothing for sale"),
    removed_professional: technical("Propositions écartées : vente aux professionnels", "Results set aside: trade-only sellers"),
    removed_duplicates: technical("Propositions écartées : doublons", "Results set aside: duplicates"),
    kept_count: technical("Propositions gardées", "Results kept"),
    kept_with_price: technical("Propositions gardées avec un prix", "Results kept with a price"),
    kept_other_currency: technical("Propositions gardées dans une autre devise", "Results kept in another currency"),
    distinct_sites: technical("Sites différents parmi les propositions", "Different sites among the results"),
    lens_sections: technical("Rubriques de la réponse de la recherche visuelle", "Sections of the visual search answer"),
    google_state: technical("État signalé par la recherche visuelle", "State reported by the visual search"),
    crop_area_pct: technical("Part de l'image analysée (pour cent)", "Share of the image analysed (percent)"),
    call_seconds: technical("Durée de la recherche (secondes)", "Search duration (seconds)"),
    refused_before_call: technical("Lancements refusés avant la recherche", "Launches refused before the search"),
    // Colonnes de la migration 0027, décrites d'avance : l'export reste complet
    // dès que la base est migrée, même avec le serveur d'avant (mise en ligne).
    provider: technical("Fournisseur de la recherche", "Search provider"),
    provider_status_code: technical("Code de réponse du fournisseur (mesure)", "Provider response code (measure)"),
    run_started_at: technical("Heure du lancement de la recherche", "Search start time"),
    // Colonnes de la migration 0028 (voie C), décrites d'avance : des nombres
    // et des valeurs d'une liste fermée, dans la version JSON seulement. La
    // requête des boutiques et vos mots ne sont jamais enregistrés.
    complement_status: technical("Issue du complément « autres boutiques » (mesure)", "Outcome of the “other retailers” complement (measure)"),
    shopping_calls: technical("Recherches en boutiques comptées pour cette photo", "Retailer searches counted for this photo"),
    lens_from_cache: technical("Recherche visuelle reprise du cache (24 h)", "Visual search taken from the cache (24 h)"),
    served_from_cache: technical("Recherche servie entièrement par le cache (24 h)", "Search served entirely from the cache (24 h)"),
    text_suggested: technical("« Que cherchez-vous ? » proposé", "“What are you looking for?” suggested"),
    text_requested_at: technical("Heure de la recherche avec vos mots", "Time of the search with your words"),
    text_status: technical("Issue de la recherche avec vos mots (mesure)", "Outcome of the search with your words (measure)"),
    total_seconds: technical("Durée du lancement (secondes)", "Launch duration (seconds)"),
    // Colonnes de la migration 0031 (boutiques ensuite), décrites d'avance :
    // l'état de la recherche dans d'autres boutiques faite après l'affichage.
    complement_deferred: technical("Recherche dans d'autres boutiques après l'affichage : état", "Search at other retailers after display: state"),
    complement_deferred_at: technical("Recherche dans d'autres boutiques après l'affichage : heure de l'état", "Search at other retailers after display: time of the state"),
  },
  productMatches: {
    id: ID,
    search_id: technical("Recherche", "Search"),
    rank: shown("Rang", "Rank"),
    product_name: shown("Nom de la pièce", "Piece name"),
    brand: shown("Marque", "Brand"),
    image_url: shown("Image (aperçu)", "Image (preview)"),
    image_hd_url: shown("Image en grand", "Large image"),
    price_min: shown("Prix", "Price"),
    price_max: shown("Prix le plus haut", "Highest price"),
    currency: shown("Devise", "Currency"),
    confidence_score: shown("Indice de confiance", "Confidence"),
    merchant_name: shown("Marchand", "Retailer"),
    merchant_url: shown("Lien vers la pièce", "Link to the piece"),
    // Même date que la recherche : seulement dans la version JSON.
    created_at: technical("Proposée le", "Suggested on"),
    // Colonnes de la migration 0027 (« Voir les boutiques »), décrites d'avance.
    provider_page_token: technical("Référence de la pièce chez le fournisseur", "Piece reference at the provider"),
    provider_product_id: technical("Identifiant de la pièce chez le fournisseur", "Piece ID at the provider"),
    stores: technical("Boutiques consultées (« Voir les boutiques »)", "Retailers viewed (“View retailers”)"),
    stores_requested_at: technical("Heure de « Voir les boutiques »", "Time of “View retailers”"),
    // Colonne de la migration 0028 (voie C), décrite d'avance : recherche
    // visuelle, boutiques ou vos mots (libellés : MATCH_ORIGIN_LABELS).
    origin: shown("Origine", "Origin"),
    // Colonne de la migration 0031 (boutiques ensuite), décrite d'avance :
    // place dans la réponse de la recherche visuelle avant le tri par vos
    // mots, effacée dès que la recherche dans d'autres boutiques démarre.
    lens_rank: technical("Place dans la réponse de la recherche visuelle (avant le tri par vos mots)", "Place in the visual search answer (before sorting by your words)"),
  },
  resultFeedback: {
    id: ID,
    user_id: USER_ID,
    match_id: technical("Pièce proposée signalée", "Reported suggested piece"),
    reason: shown("Motif", "Reason"),
    created_at: shown("Signalée le", "Reported on"),
    updated_at: technical("Motif modifié le", "Reason changed on"),
  },
  vaultItems: {
    id: ID,
    user_id: USER_ID,
    product_match_id: technical("Pièce proposée d'origine", "Original suggested piece"),
    affiliate_conversion_id: technical("Achat suivi", "Tracked purchase"),
    title: shown("Nom", "Name"),
    image_url: shown("Image", "Image"),
    category: shown("Catégorie", "Category"),
    verified: shown("Achat vérifié", "Verified purchase"),
    created_at: shown("Ajoutée le", "Added on"),
  },
  wishlistItems: {
    id: ID,
    user_id: USER_ID,
    product_match_id: technical("Pièce proposée d'origine", "Original suggested piece"),
    title: shown("Nom", "Name"),
    image_url: shown("Image", "Image"),
    reference: shown("Référence", "Reference"),
    price_min: shown("Prix", "Price"),
    currency: shown("Devise", "Currency"),
    merchant_name: shown("Marchand", "Retailer"),
    merchant_url: shown("Lien vers la pièce", "Link to the piece"),
    created_at: shown("Ajoutée le", "Added on"),
  },
  posts: {
    id: ID,
    user_id: USER_ID,
    type: shown("Type", "Type"),
    vault_item_id: technical("Pièce du Vault montrée", "Vault piece shown"),
    wishlist_item_id: technical("Envie montrée", "Wish shown"),
    caption: shown("Légende", "Caption"),
    media_kind: shown("Format", "Format"),
    media_url: shown("Photo ou vidéo", "Photo or video"),
    media_thumb_url: shown("Miniature", "Thumbnail"),
    media_removed_at: shown("Image retirée par la modération le", "Image removed by moderation on"),
    mux_playback_id: technical("Identifiant de lecture vidéo", "Video playback identifier"),
    privacy: shown("Visible par", "Visible to"),
    hidden_at: shown("Masquée par la modération le", "Hidden by moderation on"),
    created_at: shown("Publiée le", "Posted on"),
  },
  postTaggedPieces: {
    id: ID,
    post_id: technical("Publication", "Post"),
    vault_item_id: shown("Pièce de votre Vault", "Piece from your Vault"),
    product_match_id: shown("Pièce d'une de vos recherches", "Piece from one of your searches"),
    position: shown("Position", "Position"),
    created_at: shown("Ajoutée le", "Added on"),
  },
  reactionsGiven: {
    post_id: shown("Sur", "On"),
    created_at: shown("Aimée le", "Liked on"),
  },
  followers: {
    follower_id: shown("Compte", "Account"),
    created_at: shown("Depuis le", "Since"),
  },
  following: {
    followee_id: shown("Compte", "Account"),
    created_at: shown("Depuis le", "Since"),
  },
  blockedAccounts: {
    blocked_id: shown("Compte", "Account"),
    created_at: shown("Bloqué le", "Blocked on"),
  },
  reportsSubmitted: {
    id: ID,
    reporter_id: USER_ID,
    target_type: shown("Signalé", "Reported"),
    target_id: shown("Compte signalé", "Reported account"),
    reason: shown("Motif", "Reason"),
    note: shown("Votre précision", "Your note"),
    created_at: shown("Signalé le", "Reported on"),
    handled_at: shown("Traité le", "Handled on"),
    moderation_action_id: technical("Décision", "Decision"),
  },
  comments: {
    id: ID,
    user_id: USER_ID,
    post_id: shown("Sur", "On"),
    body: shown("Commentaire", "Comment"),
    hidden_at: shown("Masqué par la modération le", "Hidden by moderation on"),
    created_at: shown("Écrit le", "Written on"),
  },
  notifications: {
    id: ID,
    user_id: USER_ID,
    actor_id: shown("De", "From"),
    type: shown("Notification", "Notification"),
    post_id: technical("Publication", "Post"),
    comment_id: technical("Commentaire", "Comment"),
    moderation_action_id: technical("Décision", "Decision"),
    piece_send_id: technical("Pièce reçue", "Piece received"),
    read_at: shown("Lue le", "Read on"),
    hidden_at: shown("Masquée le", "Hidden on"),
    created_at: shown("Reçue le", "Received on"),
  },
  affiliateClicks: {
    id: ID,
    user_id: USER_ID,
    affiliate_link_id: shown("Pièce ouverte", "Piece opened"),
    clicked_at: shown("Date", "Date"),
    user_agent: shown("Navigateur et appareil", "Browser and device"),
    context: shown("Ouverte depuis", "Opened from"),
  },
  affiliateConversions: {
    id: ID,
    affiliate_click_id: technical("Clic", "Click"),
    external_conversion_id: technical("Référence du marchand", "Retailer reference"),
    amount: shown("Montant", "Amount"),
    currency: shown("Devise", "Currency"),
    commission: shown("Commission versée à Spotto", "Commission paid to Spotto"),
    status: shown("État", "Status"),
    confirmed_at: shown("Confirmé le", "Confirmed on"),
    created_at: shown("Enregistré le", "Recorded on"),
  },
  consents: {
    id: ID,
    user_id: USER_ID,
    type: shown("Document ou choix", "Document or choice"),
    granted_at: shown("Accepté le", "Accepted on"),
    revoked_at: shown("Refusé ou retiré le", "Declined or withdrawn on"),
    document_version: shown("Version du texte", "Text version"),
    created_at: shown("Enregistré le", "Recorded on"),
  },
  dataExportRequests: {
    id: ID,
    user_id: USER_ID,
    status: shown("État", "Status"),
    file_url: technical("Adresse du fichier", "File address"),
    requested_at: shown("Demandé le", "Requested on"),
    completed_at: shown("Prêt le", "Ready on"),
  },
  piecesSent: {
    ...PIECE_SEND_COLUMNS,
    sender_id: USER_ID,
    recipient_id: shown("Envoyée à", "Sent to"),
    created_at: shown("Envoyée le", "Sent on"),
  },
  piecesReceived: {
    ...PIECE_SEND_COLUMNS,
    sender_id: shown("Envoyée par", "Sent by"),
    recipient_id: USER_ID,
    // Jamais écrite dans le fichier lisible : la personne qui a reçu la pièce
    // est la seule à pouvoir la signaler, elle apprendrait la décision prise
    // (version JSON seulement).
    hidden_at: technical("Masquée par la modération le", "Hidden by moderation on"),
    // Même raison : le fichier lisible dit seulement « Image indisponible »,
    // comme l'app (lot 5, partie B).
    image_removed_at: technical("Image retirée par la modération le", "Image removed by moderation on"),
    created_at: shown("Reçue le", "Received on"),
  },
  adminRole: {
    created_at: shown("Rôle d'administration depuis le", "Administrator role since"),
  },
  suspension: {
    created_at: shown("Compte suspendu depuis le", "Account suspended since"),
    moderation_action_id: technical("Décision", "Decision"),
  },
  moderationDecisionsAboutMe: MODERATION_DECISION_COLUMNS,
  moderationDecisionsTaken: MODERATION_DECISION_COLUMNS,
  // Lot messages (migration 0032) : votre côté de chaque conversation…
  conversations: {
    conversation_id: technical("Conversation", "Conversation"),
    other_user_id: technical("Autre membre", "Other member"),
    other_username: shown("Avec", "With"),
    invitation: shown("Invitation", "Invitation"),
    invitation_at: shown("Invitation envoyée ou réponse le", "Invitation sent or answered on"),
    unread: shown("Message non lu", "Unread message"),
    last_read_at: shown("Lue pour la dernière fois le", "Last read on"),
    cleared_at: shown("Messages antérieurs cachés pour vous depuis le", "Earlier messages hidden for you since"),
    last_message_at: shown("Dernier message le", "Last message on"),
    created_at: shown("Commencée le", "Started on"),
  },
  // … et ses messages, envoyés et reçus.
  messages: {
    id: ID,
    conversation_id: technical("Conversation", "Conversation"),
    sender_id: shown("De", "From"),
    body: shown("Message", "Message"),
    ...MESSAGE_WISH_COLUMNS,
    hidden_at: shown("Masqué par la modération le", "Hidden by moderation on"),
    created_at: shown("Envoyé le", "Sent on"),
  },
  // Lot collections (migration 0033) : vos collections…
  collections: {
    id: ID,
    name: shown("Nom", "Name"),
    visibility: shown("Qui la voit", "Who can see it"),
    visibility_changed_at: shown("Visibilité changée le", "Visibility changed on"),
    // Lot modération des collections (migration 0034).
    hidden_at: shown("Masquée par la modération le", "Hidden by moderation on"),
    created_at: shown("Créée le", "Created on"),
    updated_at: shown("Modifiée le", "Updated on"),
  },
  // … et les envies rangées dans chacune.
  collectionItems: {
    id: ID,
    collection_id: technical("Collection", "Collection"),
    wishlist_item_id: technical("Envie rangée", "Saved wish"),
    wishlist_item_title: shown("Envie", "Wish"),
    friends_image_url: shown("Image montrée à vos amis (copie Spotto)", "Image shown to your friends (Spotto copy)"),
    friends_image_thumb_url: shown("Miniature montrée à vos amis (copie Spotto)", "Thumbnail shown to your friends (Spotto copy)"),
    // Lot modération des collections (migration 0034).
    friends_image_removed_at: shown("Image montrée à vos amis retirée par la modération le", "Image shown to your friends removed by moderation on"),
    created_at: shown("Ajoutée le", "Added on"),
  },
  // Lot notifications (migration 0035) : les appareils prévenus des nouveaux
  // messages ; jamais le jeton de l'appareil.
  pushDevices: {
    platform: shown("Appareil", "Device"),
    // Lot alertes prix et stock (migration 0036).
    notify_messages: shown("Prévenu des nouveaux messages", "Notified of new messages"),
    notify_alerts: shown("Prévenu des alertes prix et stock", "Notified of price and stock alerts"),
    created_at: shown("Notifications activées le", "Notifications turned on on"),
    updated_at: shown("Dernière mise à jour le", "Last updated on"),
  },
  // Lot alertes prix et stock (migration 0036) : la cloche de vos envies…
  wishWatches: {
    wishlist_item_id: technical("Envie", "Wish"),
    wishlist_item_title: shown("Envie", "Wish"),
    notify_price_drop: shown("Prévenir d'une baisse de prix", "Notify me of a price drop"),
    notify_restock: shown("Prévenir d'un retour en stock", "Notify me when back in stock"),
    notify_sold_out: shown("Prévenir quand elle est épuisée", "Notify me when sold out"),
    created_at: shown("Cloche activée le", "Bell turned on on"),
    updated_at: shown("Cloche modifiée le", "Bell changed on"),
  },
  // … le suivi de vos envies (jamais d'où vient une observation)…
  wishTracking: {
    wishlist_item_id: technical("Envie", "Wish"),
    wishlist_item_title: shown("Envie", "Wish"),
    ref_price: shown("Prix de référence", "Reference price"),
    ref_currency: shown("Devise du prix de référence", "Reference price currency"),
    ref_set_on: shown("Prix de référence depuis le", "Reference price since"),
    last_price: shown("Dernier prix vu", "Last price seen"),
    last_currency: shown("Devise du dernier prix vu", "Last price seen currency"),
    last_seen_on: shown("Dernière fois vue le", "Last seen on"),
    stock_state: shown("Stock", "Stock"),
    stock_on: shown("Stock connu le", "Stock known on"),
  },
  // … vos alertes…
  wishAlertEvents: {
    id: ID,
    wishlist_item_id: technical("Envie", "Wish"),
    wishlist_item_title: shown("Envie", "Wish"),
    kind: shown("Alerte", "Alert"),
    old_price: shown("Ancien prix", "Previous price"),
    new_price: shown("Nouveau prix", "New price"),
    currency: shown("Devise", "Currency"),
    status: shown("État", "Status"),
    created_on: shown("Le", "On"),
  },
  // … et vos signalements « Plus disponible ».
  stockReports: {
    id: ID,
    match_key_hash: technical("Empreinte de la pièce signalée", "Fingerprint of the reported piece"),
    created_on: shown("Signalée « Plus disponible » le", "Reported “No longer available” on"),
  },
} as const satisfies Record<ExportDataKey, Record<string, ExportColumn>>;

export type ExportColumnName<K extends ExportDataKey> = keyof (typeof EXPORT_COLUMNS)[K] & string;

/** Sections du fichier lisible, dans l'ordre, avec les clés de l'export
 * qu'elles présentent (chaque clé dans une seule section). */
export const EXPORT_SECTIONS = {
  account: {
    title: { fr: "Votre compte et votre profil", en: "Your account and profile" },
    intro: {
      fr: "Les informations de votre compte, et ce que les autres membres voient sur votre profil.",
      en: "Your account details, and what other members see on your profile.",
    },
    keys: ["account", "profile"],
  },
  searches: {
    title: { fr: "Vos recherches", en: "Your searches" },
    intro: {
      fr: "Chaque recherche faite à partir d'une vidéo, d'un lien ou d'une photo, avec les pièces que Spotto vous a proposées.",
      en: "Every search made from a video, a link or a photo, with the pieces Spotto suggested to you.",
    },
    keys: ["productSearches", "productMatches", "resultFeedback"],
  },
  wishlist: {
    title: { fr: "Vos Envies", en: "Your Wishlist" },
    intro: {
      fr: "Les pièces que vous avez gardées pour plus tard. Vos Envies sont privées, sauf celles que vous rangez dans une collection montrée à vos amis.",
      en: "The pieces you saved for later. Your Wishlist is private, except the wishes you put in a collection shown to your friends.",
    },
    keys: ["wishlistItems"],
  },
  collections: {
    title: { fr: "Vos collections", en: "Your collections" },
    intro: {
      fr: "Les collections où vous rangez vos Envies, et qui peut les voir : vous seul, ou vos amis (les membres que vous suivez et qui vous suivent).",
      en: "The collections where you sort your Wishlist, and who can see them: you alone, or your friends (members you follow who follow you back).",
    },
    keys: ["collections", "collectionItems"],
  },
  alerts: {
    title: { fr: "Vos alertes prix et stock", en: "Your price and stock alerts" },
    intro: {
      fr: "Les envies dont vous suivez le prix ou le stock (la cloche), ce que Spotto sait de leur dernier prix et de leur stock, les alertes préparées pour vous, et les pièces que vous avez signalées « Plus disponible ». Les dates sont au jour près ; qui a cherché, acheté ou signalé une pièce n'est jamais gardé.",
      en: "The wishes whose price or stock you follow (the bell), what Spotto knows about their last price and stock, the alerts prepared for you, and the pieces you reported as no longer available. Dates are to the day; who searched for, bought or reported a piece is never kept.",
    },
    keys: ["wishWatches", "wishTracking", "wishAlertEvents", "stockReports"],
  },
  vault: {
    title: { fr: "Votre Vault", en: "Your Vault" },
    intro: {
      fr: "Les pièces que vous possédez, rangées dans votre Vault. Il est privé.",
      en: "The pieces you own, kept in your Vault. It is private.",
    },
    keys: ["vaultItems"],
  },
  posts: {
    title: { fr: "Vos publications", en: "Your posts" },
    intro: {
      fr: "Ce que vous avez publié sur votre profil, et qui peut le voir.",
      en: "What you posted on your profile, and who can see it.",
    },
    keys: ["posts", "postTaggedPieces"],
  },
  comments: {
    title: { fr: "Vos commentaires", en: "Your comments" },
    intro: { fr: "Les commentaires que vous avez écrits sous des publications.", en: "The comments you wrote under posts." },
    keys: ["comments"],
  },
  likes: {
    title: { fr: "Vos « j'aime »", en: "Your likes" },
    intro: { fr: "Les publications que vous avez aimées.", en: "The posts you liked." },
    keys: ["reactionsGiven"],
  },
  following: {
    title: { fr: "Comptes que vous suivez", en: "Accounts you follow" },
    intro: { fr: "Les comptes dont vous suivez les publications.", en: "The accounts whose posts you follow." },
    keys: ["following"],
  },
  followers: {
    title: { fr: "Vos abonnés", en: "Your followers" },
    intro: { fr: "Les comptes qui suivent vos publications.", en: "The accounts that follow your posts." },
    keys: ["followers"],
  },
  blocked: {
    title: { fr: "Comptes bloqués", en: "Blocked accounts" },
    intro: {
      fr: "Les comptes que vous avez bloqués : ils ne voient plus votre profil et ne peuvent plus interagir avec vous.",
      en: "The accounts you blocked: they no longer see your profile and can no longer interact with you.",
    },
    keys: ["blockedAccounts"],
  },
  piecesSent: {
    title: { fr: "Pièces envoyées", en: "Pieces sent" },
    intro: {
      fr: "Les pièces de vos Envies que vous avez envoyées à une personne sur Spotto.",
      en: "The pieces from your Wishlist that you sent to someone on Spotto.",
    },
    keys: ["piecesSent"],
  },
  piecesReceived: {
    title: { fr: "Pièces reçues", en: "Pieces received" },
    intro: { fr: "Les pièces que d'autres membres vous ont envoyées.", en: "The pieces other members sent you." },
    keys: ["piecesReceived"],
  },
  messages: {
    title: { fr: "Vos messages", en: "Your messages" },
    intro: {
      fr: "Vos conversations privées avec d'autres membres : les messages que vous avez envoyés et ceux que vous avez reçus.",
      en: "Your private conversations with other members: the messages you sent and the ones you received.",
    },
    keys: ["conversations", "messages"],
  },
  devices: {
    title: { fr: "Vos appareils pour les notifications", en: "Your devices for notifications" },
    intro: {
      fr: "Les téléphones sur lesquels une notification vous prévient d'un nouveau message. Pour chacun, Spotto garde une adresse technique, donnée par Apple et Expo pour vous envoyer ces notifications ; elle n'est pas recopiée ici.",
      en: "The phones on which a notification tells you about a new message. For each one, Spotto keeps a technical address, given by Apple and Expo to send you these notifications; it isn't copied here.",
    },
    keys: ["pushDevices"],
  },
  notifications: {
    title: { fr: "Vos notifications", en: "Your notifications" },
    intro: { fr: "Les notifications de l'onglet Activité de l'app.", en: "The notifications from the app's Activity tab." },
    keys: ["notifications"],
  },
  clicks: {
    title: { fr: "Vos clics vers les marchands", en: "Your clicks to retailers" },
    intro: {
      fr: "Chaque fois que vous avez ouvert le site d'un marchand depuis Spotto : la pièce, l'endroit de l'app, le navigateur utilisé et la date.",
      en: "Each time you opened a retailer's site from Spotto: the piece, where in the app, the browser used and the date.",
    },
    keys: ["affiliateClicks", "affiliateConversions"],
  },
  reports: {
    title: { fr: "Vos signalements", en: "Your reports" },
    intro: {
      fr: "Les comptes et les contenus que vous avez signalés. Vous voyez si chaque signalement a été traité ; la décision prise ne vous est pas communiquée.",
      en: "The accounts and content you reported. You can see whether each report was handled; the decision itself is not shared with you.",
    },
    keys: ["reportsSubmitted"],
  },
  consents: {
    title: { fr: "Vos consentements", en: "Your consents" },
    intro: {
      fr: "Chaque accord, refus ou retrait que vous avez donné, avec la version du texte concerné.",
      en: "Every agreement, refusal or withdrawal you gave, with the version of the text concerned.",
    },
    keys: ["consents"],
  },
  moderation: {
    title: { fr: "Modération", en: "Moderation" },
    intro: {
      fr: "Un éventuel rôle d'administration, une suspension en cours, et les décisions de modération liées à votre compte.",
      en: "Any administrator role, any current suspension, and the moderation decisions linked to your account.",
    },
    keys: ["adminRole", "suspension", "moderationDecisionsAboutMe", "moderationDecisionsTaken"],
  },
  exports: {
    title: { fr: "Vos exports précédents", en: "Your previous exports" },
    intro: { fr: "Les fois où vous avez demandé une copie de vos données.", en: "The times you asked for a copy of your data." },
    keys: ["dataExportRequests"],
  },
} as const satisfies Record<string, { title: Bilingual; intro: Bilingual; keys: readonly ExportDataKey[] }>;

export type ExportSectionId = keyof typeof EXPORT_SECTIONS;

// ---- Valeurs (libellés typés sur les constantes partagées) ----

export const PRIVACY_LABELS: Record<PrivacyLevel, Bilingual> = {
  public: { fr: "Tout le monde (public)", en: "Everyone (public)" },
  followers: { fr: "Vos abonnés", en: "Your followers" },
  private: { fr: "Vous uniquement (privé)", en: "Only you (private)" },
};

export const PIECE_SENDS_FROM_LABELS: Record<PieceSendsFrom, Bilingual> = {
  following: { fr: "Les comptes que vous suivez", en: "Accounts you follow" },
  everyone: { fr: "Tout le monde", en: "Everyone" },
  nobody: { fr: "Personne", en: "Nobody" },
};

/** « Qui peut m'écrire » (lot messages) : vos amis peuvent toujours vous écrire. */
export const MESSAGES_FROM_LABELS: Record<MessagesFrom, Bilingual> = {
  following: { fr: "Vos amis et les comptes que vous suivez", en: "Your friends and accounts you follow" },
  everyone: { fr: "Tout le monde (sous forme d'invitation)", en: "Everyone (as an invitation)" },
  nobody: { fr: "Seulement vos amis", en: "Only your friends" },
};

/** Qui voit une collection (lot collections). */
export const COLLECTION_VISIBILITY_LABELS: Record<CollectionVisibility, Bilingual> = {
  private: { fr: "Vous seul (privée)", en: "You alone (private)" },
  friends: { fr: "Vos amis", en: "Your friends" },
};

/** Sorte d'une alerte (lot alertes prix et stock). */
export const WISH_ALERT_KIND_LABELS: Record<WishAlertKind, Bilingual> = {
  price_drop: { fr: "Baisse de prix", en: "Price drop" },
  restock: { fr: "De retour en stock", en: "Back in stock" },
  sold_out: { fr: "Épuisée", en: "Sold out" },
};

/** État d'une alerte (lot alertes prix et stock). */
export const WISH_ALERT_STATUS_LABELS: Record<WishAlertStatus, Bilingual> = {
  pending: { fr: "En attente d'envoi", en: "Waiting to be sent" },
  sent: { fr: "Envoyée", en: "Sent" },
  expired: { fr: "Jamais envoyée (expirée)", en: "Never sent (expired)" },
  stale: { fr: "Jamais envoyée (plus d'actualité)", en: "Never sent (no longer accurate)" },
  limited: { fr: "Jamais envoyée (trop d'alertes)", en: "Never sent (too many alerts)" },
  disabled: { fr: "Jamais envoyée (alertes coupées)", en: "Never sent (alerts turned off)" },
};

/** Dernier état de stock connu (lot alertes prix et stock). */
export const STOCK_STATE_LABELS: Record<StockState, Bilingual> = {
  unknown: { fr: "Inconnu", en: "Unknown" },
  in_stock: { fr: "Disponible", en: "Available" },
  sold_out: { fr: "Épuisée", en: "Sold out" },
};

/** Système d'un appareil des notifications (lot notifications). */
export const PUSH_PLATFORM_LABELS: Record<PushPlatform, Bilingual> = {
  ios: { fr: "iPhone", en: "iPhone" },
  android: { fr: "Téléphone Android", en: "Android phone" },
};

/** Votre côté d'une conversation (conversation_participants.invitation). */
export const INVITATION_LABELS: Record<"none" | "sent" | "received" | "declined", Bilingual> = {
  none: { fr: "Aucune : conversation ouverte", en: "None: open conversation" },
  sent: { fr: "Envoyée par vous, en attente de réponse", en: "Sent by you, awaiting a reply" },
  received: { fr: "Reçue, en attente de votre réponse", en: "Received, awaiting your reply" },
  declined: { fr: "Reçue, refusée par vous", en: "Received, declined by you" },
};

export const APP_LOCALE_LABELS: Record<AppLocale, Bilingual> = {
  fr: { fr: "Français", en: "French" },
  en: { fr: "Anglais", en: "English" },
};

export const PLATFORM_LABELS: Record<PlatformSource, Bilingual> = {
  tiktok: { fr: "Lien TikTok", en: "TikTok link" },
  instagram: { fr: "Lien Instagram", en: "Instagram link" },
  other: { fr: "Autre lien", en: "Other link" },
  photo: { fr: "Photo importée", en: "Imported photo" },
};

export const RECOGNITION_METHOD_LABELS: Record<RecognitionMethod, Bilingual> = {
  oembed: { fr: "Image de la vidéo fournie par la plateforme", en: "Video image provided by the platform" },
  manual_screenshot: { fr: "Image importée ou choisie par vous", en: "Image you imported or chose" },
};

export const SEARCH_STATUS_LABELS: Record<SearchStatus, Bilingual> = {
  pending: { fr: "Préparée, jamais lancée", en: "Prepared, never started" },
  processing: { fr: "Analyse commencée, sans résultat enregistré", en: "Analysis started, no result saved" },
  completed: { fr: "Terminée", en: "Completed" },
  failed: { fr: "Échouée", en: "Failed" },
};

/** Raisons d'échec enregistrées en français par le serveur (constantes
 * partagées), traduites ici ; une autre raison s'affiche telle quelle. */
export const SEARCH_FAILURE_LABELS: Record<keyof typeof SEARCH_FAILURE_MESSAGES, Bilingual> = {
  noMatch: { fr: "Aucune pièce identifiée sur cette image.", en: "No piece was identified in this image." },
  technical: { fr: "La recherche visuelle a échoué (incident technique).", en: "The visual search failed (technical problem)." },
};

export const VAULT_CATEGORY_LABELS: Record<VaultCategory, Bilingual> = {
  clothing: { fr: "Vêtements", en: "Clothing" },
  watches: { fr: "Montres", en: "Watches" },
  accessories: { fr: "Accessoires", en: "Accessories" },
  shoes: { fr: "Chaussures", en: "Shoes" },
  bags: { fr: "Sacs", en: "Bags" },
  home: { fr: "Maison", en: "Home" },
  other: { fr: "Autre", en: "Other" },
};

export const POST_TYPE_LABELS: Record<PostType, Bilingual> = {
  lifestyle: { fr: "Photo", en: "Photo" },
  purchase: { fr: "Achat", en: "Purchase" },
  wish: { fr: "Envie", en: "Wish" },
};

/** Liste locale (aucune constante partagée) : type media_kind de la base. */
export const MEDIA_KIND_LABELS: Record<"photo" | "video", Bilingual> = {
  photo: { fr: "Photo", en: "Photo" },
  video: { fr: "Vidéo", en: "Video" },
};

/** Origine d'une proposition (voie C, migration 0028). */
export const MATCH_ORIGIN_LABELS: Record<MatchOrigin, Bilingual> = {
  lens: { fr: "Recherche visuelle", en: "Visual search" },
  shopping: { fr: "Boutiques", en: "Retailers" },
  words: { fr: "Vos mots", en: "Your words" },
};

export const MERCHANT_LINK_CONTEXT_LABELS: Record<MerchantLinkContext, Bilingual> = {
  result: { fr: "Résultat d'une recherche", en: "Search result" },
  similar: { fr: "Pièces similaires", en: "Similar pieces" },
  vault: { fr: "Votre Vault", en: "Your Vault" },
  wishlist: { fr: "Vos Envies", en: "Your Wishlist" },
  post: { fr: "Une publication", en: "A post" },
  price_alert: { fr: "Alerte de prix", en: "Price alert" },
  received: { fr: "Une pièce reçue", en: "A piece you received" },
};

export const CONSENT_TYPE_LABELS: Record<ConsentType, Bilingual> = {
  terms: { fr: "Conditions d'utilisation", en: "Terms of use" },
  privacy_policy: { fr: "Politique de confidentialité", en: "Privacy policy" },
  age_declaration: { fr: `Déclaration d'âge (${MINIMUM_AGE} ans ou plus)`, en: `Age declaration (${MINIMUM_AGE} or older)` },
  analytics: { fr: "Statistiques d'usage", en: "Usage statistics" },
  marketing_email: { fr: "E-mails d'information", en: "Information emails" },
  analyse_video_ia: { fr: "Analyse automatique des vidéos par une IA", en: "Automatic video analysis by an AI" },
};

/** Phrase qui suit l'auteur de la notification. */
export const NOTIFICATION_LABELS: Record<NotificationType, Bilingual> = {
  follow: { fr: "a commencé à vous suivre.", en: "started following you." },
  like: { fr: "a aimé votre publication.", en: "liked your post." },
  comment: { fr: "a commenté votre publication.", en: "commented on your post." },
  moderation: { fr: "a pris une décision qui vous concerne.", en: "made a decision about you." },
  report_handled: { fr: "a traité votre signalement.", en: "handled your report." },
  piece_received: { fr: "vous a envoyé une pièce.", en: "sent you a piece." },
};

export const REPORT_TARGET_LABELS: Record<ReportTargetType, Bilingual> = {
  user: { fr: "Un profil", en: "A profile" },
  post: { fr: "Une publication", en: "A post" },
  comment: { fr: "Un commentaire", en: "A comment" },
  piece: { fr: "Une pièce reçue", en: "A piece you received" },
  message: { fr: "Un message reçu", en: "A message you received" },
  // Lot modération des collections : la collection d'un ami (ou la vôtre, pour une décision qui vous concerne).
  collection: { fr: "Une collection", en: "A collection" },
};

/** « Signalement traité » : seulement le type du contenu signalé, jamais la
 * décision prise (comme dans l'app). */
export const REPORT_HANDLED_LABELS: Record<ReportTargetType, Bilingual> = {
  user: { fr: "Votre signalement d'un profil a été traité.", en: "Your report about a profile was handled." },
  post: { fr: "Votre signalement d'une publication a été traité.", en: "Your report about a post was handled." },
  comment: { fr: "Votre signalement d'un commentaire a été traité.", en: "Your report about a comment was handled." },
  piece: { fr: "Votre signalement d'une pièce reçue a été traité.", en: "Your report about a piece you received was handled." },
  message: { fr: "Votre signalement d'un message a été traité.", en: "Your report about a message was handled." },
  collection: { fr: "Votre signalement d'une collection a été traité.", en: "Your report about a collection was handled." },
};

export const REPORT_REASON_LABELS: Record<ReportReason, Bilingual> = {
  spam: { fr: "Spam", en: "Spam" },
  inappropriate: { fr: "Contenu inapproprié", en: "Inappropriate content" },
  harassment: { fr: "Harcèlement", en: "Harassment" },
  other: { fr: "Autre", en: "Other" },
};

/** Motifs du bouton « Résultat incohérent » (validés par le fondateur, 2026-10-15). */
export const FEEDBACK_REASON_LABELS: Record<MatchFeedbackReason, Bilingual> = {
  image_title_mismatch: { fr: "L'image et le titre ne correspondent pas", en: "The image and the title don't match" },
  wrong_item: {
    fr: "Ce n'est pas la pièce cherchée (autre type, autre couleur, autre modèle)",
    en: "Not the piece I was looking for (different type, color or model)",
  },
  not_for_sale: { fr: "Impossible à acheter (la page ne vend rien)", en: "Can't be bought (the page doesn't sell anything)" },
  wrong_price: { fr: "Prix faux ou absent", en: "Wrong or missing price" },
  duplicate: { fr: "Doublon d'une autre proposition", en: "Duplicate of another suggestion" },
};

/** Motifs d'une décision : ceux des signalements, plus le motif neutre du
 * retrait d'une image copiée (lot 5, partie B). */
export const MODERATION_REASON_LABELS: Record<ModerationReason, Bilingual> = {
  ...REPORT_REASON_LABELS,
  image_rights: { fr: "Droits sur l'image", en: "Image rights" },
};

export const MODERATION_ACTION_LABELS: Record<ModerationActionType, Bilingual> = {
  dismiss: { fr: "Classé sans suite", en: "Dismissed" },
  hide: { fr: "Contenu masqué", en: "Content hidden" },
  suspend: { fr: "Compte suspendu", en: "Account suspended" },
  restore: { fr: "Contenu rétabli", en: "Content restored" },
  unsuspend: { fr: "Suspension levée", en: "Suspension lifted" },
  remove_image: { fr: "Image retirée", en: "Image removed" },
};

/** Liste locale (aucune constante partagée) : type conversion_status de la base. */
export const CONVERSION_STATUS_LABELS: Record<"pending" | "confirmed" | "rejected", Bilingual> = {
  pending: { fr: "En attente de confirmation", en: "Awaiting confirmation" },
  confirmed: { fr: "Confirmé", en: "Confirmed" },
  rejected: { fr: "Refusé par le marchand", en: "Rejected by the retailer" },
};

/** Liste locale (aucune constante partagée) : type export_status de la base. */
export const EXPORT_STATUS_LABELS: Record<"requested" | "processing" | "ready" | "failed", Bilingual> = {
  requested: { fr: "Demandé", en: "Requested" },
  processing: { fr: "En préparation", en: "Being prepared" },
  ready: { fr: "Prêt", en: "Ready" },
  failed: { fr: "Échoué", en: "Failed" },
};

// ---- Phrases du fichier ({nom} : valeur insérée, puis échappée) ----

export const EXPORT_TEXT = {
  documentTitle: { fr: "Vos données Spotto", en: "Your Spotto data" },
  accountLine: { fr: "Compte {account}", en: "Account {account}" },
  createdLine: { fr: "Fichier créé le {date} (fuseau horaire : {zone})", en: "File created on {date} (time zone: {zone})" },
  introWhat: {
    fr: "Ce fichier rassemble toutes les données personnelles que Spotto conserve sur votre compte, au moment de votre demande. Il s'ouvre sans connexion, dans n'importe quel navigateur.",
    en: "This file brings together all the personal data Spotto holds about your account, at the time of your request. It opens offline, in any browser.",
  },
  introPrivate: {
    fr: "Il contient des informations personnelles : gardez-le pour vous et partagez-le avec prudence.",
    en: "It contains personal information: keep it to yourself and share it with care.",
  },
  introPhotos: {
    fr: "Vos photos s'affichent seulement quand votre appareil est connecté à Internet, et tant que votre compte existe. Les images des marchands, de Google ou de TikTok ne sont jamais chargées : ce sont de simples liens.",
    en: "Your photos only appear while your device is online, and while your account exists. Images from retailers, Google or TikTok are never loaded: they are plain links.",
  },
  introPurposes: {
    fr: "Pourquoi ces données sont utilisées, à qui elles sont transmises et combien de temps elles sont conservées : lisez la politique de confidentialité (Réglages > Politique de confidentialité).",
    en: "Why this data is used, who it is shared with and how long it is kept: read the privacy policy (Settings > Privacy policy).",
  },
  introTechnical: {
    fr: "La version technique complète (JSON), avec les identifiants internes, se trouve à la fin du fichier.",
    en: "The complete technical version (JSON), with internal identifiers, is at the end of the file.",
  },
  tocTitle: { fr: "Sommaire", en: "Contents" },
  noData: { fr: "Aucune donnée.", en: "No data." },
  otherInfo: { fr: "Autres informations", en: "Other information" },
  emptyValue: { fr: "(vide)", en: "(empty)" },
  yes: { fr: "Oui", en: "Yes" },
  no: { fr: "Non", en: "No" },
  someone: { fr: "un compte Spotto", en: "a Spotto account" },
  moderationActor: { fr: "Spotto (modération)", en: "Spotto (moderation)" },
  yourself: { fr: "vous", en: "you" },
  yourPost: { fr: "votre publication", en: "your post" },
  postBy: { fr: "une publication de {person}", en: "a post by {person}" },
  postBySomeone: { fr: "une publication d'un compte Spotto", en: "a post by a Spotto account" },
  priceRange: { fr: "{min} à {max}", en: "{min} to {max}" },
  // Liens : toujours un libellé court, jamais l'adresse elle-même.
  openTiktok: { fr: "Ouvrir la vidéo TikTok", en: "Open the TikTok video" },
  openInstagram: { fr: "Ouvrir la publication Instagram", en: "Open the Instagram post" },
  openLink: { fr: "Ouvrir le lien ({site})", en: "Open the link ({site})" },
  temporaryImage: {
    fr: "Ouvrir l'image ({site}) : lien temporaire, sans doute expiré",
    en: "Open the image ({site}): temporary link, probably expired",
  },
  viewImage: { fr: "Voir l'image ({site})", en: "View the image ({site})" },
  viewLargeImage: { fr: "Voir l'image en grand ({site})", en: "View the large image ({site})" },
  viewPieceAt: { fr: "Voir la pièce chez {merchant}", en: "View the piece at {merchant}" },
  viewPiece: { fr: "Voir la pièce ({site})", en: "View the piece ({site})" },
  openMedia: { fr: "Ouvrir la photo ou la vidéo ({site})", en: "Open the photo or video ({site})" },
  notWebLink: { fr: "adresse qui n'est pas un lien web : {value}", en: "address that is not a web link: {value}" },
  photoAlt: { fr: "Votre photo", en: "Your photo" },
  // Recherches.
  searchTitle: { fr: "Recherche du {date}", en: "Search on {date}" },
  pendingExplained: {
    fr: "Recherche préparée mais jamais lancée : aucune image n'a été analysée.",
    en: "This search was prepared but never started: no image was analysed.",
  },
  analysedImageDeleted: {
    fr: "L'image analysée n'est pas conservée : elle est supprimée juste après la recherche.",
    en: "The analysed image is not kept: it is deleted right after the search.",
  },
  matchesTitle: { fr: "Pièces proposées ({count})", en: "Suggested pieces ({count})" },
  reportedInconsistent: { fr: "Signalée comme incohérente", en: "Reported as inconsistent" },
  reportedInconsistentValue: { fr: "{reason}, le {date}", en: "{reason}, on {date}" },
  orphanMatches: { fr: "Pièces proposées pour une recherche introuvable", en: "Suggested pieces for a search that could not be found" },
  // Publications.
  postTitle: { fr: "{type} publiée le {date}", en: "{type} posted on {date}" },
  shownPiece: { fr: "Pièce montrée", en: "Piece shown" },
  taggedTitle: { fr: "Pièces taguées ({count})", en: "Tagged pieces ({count})" },
  orphanTagged: { fr: "Pièces taguées d'une publication introuvable", en: "Tagged pieces from a post that could not be found" },
  pieceGone: { fr: "Pièce qui n'existe plus", en: "A piece that no longer exists" },
  // Image copiée retirée par la modération (lot 5, partie B) : la date et le
  // motif pour la personne qui l'avait partagée ; « indisponible » seulement
  // pour celle qui a reçu la pièce, comme dans l'app.
  imageRemovedOn: {
    fr: "Retirée par la modération le {date} (droits sur l'image) : le fichier a été effacé",
    en: "Removed by moderation on {date} (image rights): the file has been deleted",
  },
  imageUnavailable: { fr: "Image indisponible", en: "Image unavailable" },
  // Notifications.
  unread: { fr: "Non lue", en: "Unread" },
  // Seulement pour une notification liée à une publication masquée de la
  // personne (jamais une pièce reçue ni le commentaire d'un autre compte).
  hiddenWithContent: {
    fr: "Masquée avec votre publication.",
    en: "Hidden together with your post.",
  },
  decision: { fr: "Décision : {action}", en: "Decision: {action}" },
  decisionAbout: { fr: "Concerne : {target}", en: "About: {target}" },
  decisionReason: { fr: "Motif : {reason}", en: "Reason: {reason}" },
  decisionNote: { fr: "Précision : {note}", en: "Note: {note}" },
  decisionUnknown: { fr: "Une décision de la modération vous concerne.", en: "A moderation decision concerns you." },
  reportHandled: { fr: "Votre signalement a été traité.", en: "Your report was handled." },
  // Clics et achats suivis.
  pieceAt: { fr: "{piece} chez {merchant}", en: "{piece} at {merchant}" },
  unknownBrowser: { fr: "Navigateur non reconnu", en: "Unknown browser" },
  spottoApp: { fr: "App Spotto", en: "Spotto app" },
  conversionsTitle: { fr: "Achats suivis", en: "Tracked purchases" },
  conversionsIntro: {
    fr: "Les achats qu'un marchand partenaire a signalés après un de vos clics.",
    en: "Purchases a partner retailer reported after one of your clicks.",
  },
  // Messages (lot messages).
  conversationWith: { fr: "Conversation avec {person}", en: "Conversation with {person}" },
  messagesTitle: { fr: "Messages échangés ({count})", en: "Messages exchanged ({count})" },
  orphanMessages: { fr: "Messages d'une conversation introuvable", en: "Messages from a conversation that could not be found" },
  // Collections (lot collections).
  collectionItemsTitle: { fr: "Envies rangées ({count})", en: "Saved wishes ({count})" },
  // Alertes prix et stock (lot 2).
  alertWatchesTitle: { fr: "Cloches ({count})", en: "Bells ({count})" },
  alertTrackingTitle: { fr: "Suivi de vos envies ({count})", en: "Tracking of your wishes ({count})" },
  alertEventsTitle: { fr: "Alertes ({count})", en: "Alerts ({count})" },
  stockReportsTitle: { fr: "Signalements « Plus disponible » ({count})", en: "“No longer available” reports ({count})" },
  stockReportPiece: { fr: "Une pièce signalée « Plus disponible »", en: "A piece reported as no longer available" },
  orphanCollectionItems: { fr: "Envies d'une collection introuvable", en: "Wishes from a collection that could not be found" },
  // Signalements.
  followUp: { fr: "Suivi", en: "Follow-up" },
  handledOn: { fr: "Traité le {date}", en: "Handled on {date}" },
  notHandled: { fr: "Pas encore traité", en: "Not handled yet" },
  // Modération.
  adminSince: { fr: "Vous avez un rôle d'administration sur Spotto depuis le {date}.", en: "You have had an administrator role on Spotto since {date}." },
  adminNone: { fr: "Vous n'avez pas de rôle d'administration.", en: "You do not have an administrator role." },
  suspendedSince: { fr: "Votre compte est suspendu depuis le {date}.", en: "Your account has been suspended since {date}." },
  suspendedNone: { fr: "Votre compte n'est pas suspendu.", en: "Your account is not suspended." },
  aboutMeTitle: { fr: "Décisions qui vous concernent", en: "Decisions about you" },
  aboutMeIntro: {
    fr: "Prises par l'équipe de modération ; la personne qui les a prises n'est jamais indiquée.",
    en: "Made by the moderation team; the person who made them is never shown.",
  },
  takenTitle: { fr: "Décisions que vous avez prises", en: "Decisions you made" },
  // Exports.
  currentExportNote: {
    fr: "L'export que vous venez de demander (ce fichier) n'apparaît pas encore : il figurera dans le prochain.",
    en: "The export you just requested (this file) is not listed yet: it will appear in the next one.",
  },
  // Version technique.
  appendixTitle: { fr: "Version technique complète (JSON)", en: "Complete technical version (JSON)" },
  appendixIntro: {
    fr: "Toutes vos données telles qu'elles sont enregistrées, avec les identifiants internes (des codes qui relient les données entre elles). Ce format sert à transférer vos données vers un autre service.",
    en: "All your data as it is stored, with internal identifiers (codes that link the data together). This format is for moving your data to another service.",
  },
} as const satisfies Record<string, Bilingual>;
