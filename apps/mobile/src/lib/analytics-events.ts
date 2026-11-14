// Catalogue FERMÉ des événements de statistiques d'usage (lot 2, annexe B du
// programme, adaptée aux fonctions actuelles). Chaque propriété n'accepte
// qu'une liste de valeurs, un nombre ou un oui/non : aucun texte libre ne
// peut passer — donc jamais d'e-mail, de nom d'utilisateur, de commentaire,
// de légende ni d'adresse d'image. Toute propriété absente du catalogue est
// supprimée avant l'envoi. Imports relatifs : fichier testé par vitest.
import {
  COMPLEMENT_STATUSES,
  MERCHANT_LINK_CONTEXTS,
  MODERATION_DECISIONS,
  PIECE_SENDS_FROM,
  PRIVACY_LEVELS,
  REPORT_TARGET_TYPES,
  TEXT_SEARCH_STATUSES,
} from "@monapp/shared-types";
import { RESULT_SORTS } from "./result-sort";
import { WISHLIST_SORTS } from "./wishlist-view";

type Rule = { kind: "enum"; values: readonly string[] } | { kind: "count" } | { kind: "bool" };

const oneOf = (values: readonly string[]): Rule => ({ kind: "enum", values });
const count: Rule = { kind: "count" };
const bool: Rule = { kind: "bool" };
const VISIBILITY = oneOf(PRIVACY_LEVELS);
// Lot 4 : vidéo importée dans le Spotter — photothèque (app iPhone) ou fichier (site) ;
// lot 4 ter : dernière vidéo de la galerie, proposée sur l'accueil (app iPhone) ;
// lot « partager vers Spotto » : vidéo reçue par la feuille de partage d'iOS.
const VIDEO_SOURCE = oneOf(["library", "file", "latest", "share"]);
// Lot « lecteur intégré » (app iPhone) : la plateforme du lecteur officiel.
const PLAYER_PLATFORM = oneOf(["tiktok", "instagram"]);

export const ANALYTICS_EVENTS = {
  // Lot « app iPhone prête » (point 21) : ouverture de l'app, pour savoir si
  // les gens reviennent (rétention J1, J7). « launch » : au lancement, une
  // fois ; « resume » : retour dans l'app après 30 minutes au moins (app-opening.ts).
  app_opened: { context: oneOf(["launch", "resume"]) },
  signup_completed: { locale: oneOf(["fr", "en"]) },
  spot_started: { source: oneOf(["link", "photo"]), platform: oneOf(["tiktok", "instagram", "pinterest", "photo", "other"]) },
  // Ciblage : zone recadrée, capture importée. Plus de texte depuis le petit lot (2026-10-25) : les mots ne partent plus avec l'image.
  spot_launched: { zone_adjusted: bool, image_imported: bool },
  spot_cancelled: {},
  // Voie C (lot c) : results_count compte la recherche visuelle seule ; le
  // complément a son issue (« none » quand il n'a pas tourné) et son nombre.
  // Boutiques ensuite (2026-11-08) : envoyé quand l'issue des boutiques est
  // connue, quelques secondes après l'affichage ; « unknown » quand l'app ne
  // l'a pas reçue (réseau, délai dépassé, refus du serveur).
  spot_completed: {
    outcome: oneOf(["results", "none", "failed"]),
    results_count: count,
    complement: oneOf([...COMPLEMENT_STATUSES, "none", "unknown"]),
    complement_count: count,
  },
  // Voie C (lot c) : recherche par les mots — l'issue et un nombre, jamais les mots ni la requête.
  text_search_launched: {},
  text_search_completed: { outcome: oneOf([...TEXT_SEARCH_STATUSES, "failed"]), results_count: count },
  // « Voir plus » sous « Autres propositions ». ATTENTION, changement de sens
  // avec le lot « prix d'abord » (2026-11-03) : quand une proposition a un
  // prix, cette section ne montre plus que celles avec prix (les autres sont
  // repliées sous « Sans prix »). price_first dit lequel : vrai, la section ne
  // compte que des propositions avec prix ; faux ou absent (versions
  // d'avant), toute la recherche visuelle, comme avant — séries comparables
  // en filtrant sur price_first différent de vrai (relecture, F5).
  similar_results_opened: { price_first: bool },
  // Prix d'abord (2026-11-03) : section repliée « Sans prix » ouverte, avec son
  // nombre de propositions, et d'où : son bouton (« section ») ou « Ce n'est
  // pas la bonne pièce ? » (« not_right », avant toute nouvelle recherche).
  no_price_results_opened: { results_count: count, context: oneOf(["section", "not_right"]) },
  // Tri des résultats (2026-11-08, lib/result-sort.ts) : tri ou filtre « Avec
  // prix seulement » changé sur l'écran Résultat — le nouveau choix et ce qui
  // a changé, jamais la recherche ni les pièces.
  result_view_changed: { sort: oneOf(RESULT_SORTS), with_price_only: bool, change: oneOf(["sort", "filter"]) },
  // Écran Envies (2026-11-09, lib/wishlist-view.ts) : tri changé — le nouveau
  // tri et s'il est choisi dans une collection, jamais la recherche tapée.
  wishlist_sort_changed: { sort: oneOf(WISHLIST_SORTS), in_collection: bool },
  wishlist_item_added: { context: oneOf(["result"]) },
  vault_item_added: { source: oneOf(["spotter", "photo"]), category: oneOf(["clothing", "watches", "accessories", "shoes", "bags", "home", "other"]) },
  // Prix d'abord (2026-11-03), écran Résultat seulement (lib/price-first.ts) :
  // rang d'origine (ordre du serveur, inchangé), place affichée et section
  // repliée « Sans prix ». La place est celle de la disposition proposée
  // d'office (1 = la grande carte d'office). Sans geste de la personne, c'est
  // celle de l'écran au moment du clic : elle change quand « vos mots »
  // répondent, comme l'écran. Dès qu'elle touche une carte ou agit sur la
  // grande carte, la disposition reste celle qu'elle avait sous les yeux (les
  // propositions de vos mots y prennent leur place), et la carte mise en grand
  // garde la place où elle l'a trouvée (relecture, ORD-6, F6). Ailleurs
  // (Envies, Vault, publication…) : le contexte seul.
  merchant_link_opened: { context: oneOf(MERCHANT_LINK_CONTEXTS), rank: count, displayed_position: count, in_no_price_section: bool },
  post_published: { type: oneOf(["lifestyle", "purchase"]), visibility: VISIBILITY, tagged_count: count },
  post_visibility_changed: { visibility: VISIBILITY },
  post_shared: { method: oneOf(["native", "copy"]) },
  comment_posted: {},
  like_added: {},
  follow_added: { context: oneOf(["search", "profile"]) },
  report_submitted: { target_type: oneOf(REPORT_TARGET_TYPES) },
  // Lot 5 : décisions de la modération (administrateurs) — la décision et le type de contenu, jamais lequel.
  // Partie B : « remove_image », retrait d'une image copiée. Lot « conformité
  // Apple » : « remove_bio » et « remove_avatar », sur un profil.
  moderation_decision: { decision: oneOf([...MODERATION_DECISIONS, "remove_image", "remove_bio", "remove_avatar"]), target_type: oneOf(REPORT_TARGET_TYPES) },
  moderation_undone: { decision: oneOf(["hide", "suspend"]) },
  // Lot 5 : partage d'une envie — le canal et des choix, jamais la pièce ni la personne.
  wish_republished: { visibility: VISIBILITY },
  piece_sent: {},
  // « Envoyer à un ami » (écran Résultat, lib/send-to-friend.ts) : une proposition
  // envoyée dans une conversation, et d'où (grande carte, carte d'une section,
  // ligne de la liste triée par prix) — jamais la pièce, le texte ni la personne.
  piece_sent_to_friend: { from: oneOf(["big_card", "section", "price_list"]) },
  wish_shared_external: { method: oneOf(["native", "copy"]), affiliate: bool },
  received_piece_removed: {},
  piece_sends_setting_changed: { value: oneOf(PIECE_SENDS_FROM) },
  photo_changed: { target: oneOf(["vault", "avatar"]) },
  // Lot 3 : préférences d'affichage.
  language_changed: { locale: oneOf(["fr", "en"]), context: oneOf(["welcome", "settings"]) },
  theme_changed: { theme: oneOf(["system", "light", "dark"]) },
  // Lot 4 : vidéo dans le Spotter — durée en secondes et source, jamais le contenu.
  video_imported: { duration_s: count, source: VIDEO_SOURCE },
  video_rejected: { reason: oneOf(["too_long", "too_large", "unreadable"]), duration_s: count, source: VIDEO_SOURCE },
  video_frame_chosen: { duration_s: count, source: VIDEO_SOURCE },
  // Lot 4, temps 1 bis : analyse automatique — des nombres et des choix, jamais le contenu.
  video_ai_consent: { decision: oneOf(["granted", "declined", "withdrawn"]), context: oneOf(["first_use", "settings"]) },
  video_ai_frames_sent: { frames_count: count, duration_s: count },
  video_ai_result: { outcome: oneOf(["found", "not_found", "unavailable", "limit"]), moments_count: count },
  // Moment essayé parmi les 3 proposés (1 = le meilleur).
  video_ai_moment_tried: { rank: count },
  // Lot « lecteur intégré » (app iPhone) : la plateforme et l'origine du lien
  // (collé ou partagé) — jamais le lien, la vidéo ni l'image. L'événement de
  // la capture (« player_capture ») est parti avec le module natif de capture
  // (lot « nettoyage avant le premier build »).
  player_opened: { platform: PLAYER_PLATFORM, source: oneOf(["paste", "share"]) },
  player_unavailable: {
    platform: PLAYER_PLATFORM,
    reason: oneOf(["build_off", "server_off", "server_unknown", "not_ios", "no_snapshot", "consent_refused", "embed_unavailable", "player_error", "no_answer", "webview_error", "snapshot_failed"]),
  },
  player_fallback: { platform: PLAYER_PLATFORM, choice: oneOf(["screenshot", "open_app"]) },
  player_consent: { platform: PLAYER_PLATFORM, choice: oneOf(["play", "refuse"]) },
  player_spot: { platform: PLAYER_PLATFORM },
} as const satisfies Record<string, Record<string, Rule>>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

/** Ne garde que les propriétés du catalogue dont la valeur est admise. */
export function sanitizeProps(event: AnalyticsEvent, props: AnalyticsProps = {}): Record<string, string | number | boolean> {
  const rules: Record<string, Rule> = ANALYTICS_EVENTS[event];
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = props[key];
    if (rule.kind === "enum" && typeof value === "string" && rule.values.includes(value)) clean[key] = value;
    if (rule.kind === "bool" && typeof value === "boolean") clean[key] = value;
    if (rule.kind === "count" && typeof value === "number" && Number.isFinite(value)) clean[key] = Math.max(0, Math.min(1000, Math.round(value)));
  }
  return clean;
}
