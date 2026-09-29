// Catalogue FERMÉ des événements de statistiques d'usage (lot 2, annexe B du
// programme, adaptée aux fonctions actuelles). Chaque propriété n'accepte
// qu'une liste de valeurs, un nombre ou un oui/non : aucun texte libre ne
// peut passer — donc jamais d'e-mail, de nom d'utilisateur, de commentaire,
// de légende ni d'adresse d'image. Toute propriété absente du catalogue est
// supprimée avant l'envoi. Imports relatifs : fichier testé par vitest.
import { MERCHANT_LINK_CONTEXTS } from "@monapp/shared-types";

type Rule = { kind: "enum"; values: readonly string[] } | { kind: "count" } | { kind: "bool" };

const oneOf = (values: readonly string[]): Rule => ({ kind: "enum", values });
const count: Rule = { kind: "count" };
const bool: Rule = { kind: "bool" };
const VISIBILITY = oneOf(["public", "followers", "private"]);

export const ANALYTICS_EVENTS = {
  signup_completed: { locale: oneOf(["fr", "en"]) },
  spot_started: { source: oneOf(["link", "photo"]), platform: oneOf(["tiktok", "instagram", "pinterest", "photo", "other"]) },
  // Ciblage et précision : zone recadrée, texte ajouté, capture importée (jamais le texte lui-même).
  spot_launched: { zone_adjusted: bool, query_added: bool, image_imported: bool },
  spot_cancelled: {},
  spot_completed: { outcome: oneOf(["results", "none", "failed"]), results_count: count },
  similar_results_opened: {},
  wishlist_item_added: { context: oneOf(["result"]) },
  vault_item_added: { source: oneOf(["spotter", "photo"]), category: oneOf(["clothing", "watches", "accessories", "shoes", "bags", "home", "other"]) },
  merchant_link_opened: { context: oneOf(MERCHANT_LINK_CONTEXTS) },
  post_published: { type: oneOf(["lifestyle", "purchase"]), visibility: VISIBILITY, tagged_count: count },
  post_visibility_changed: { visibility: VISIBILITY },
  post_shared: { method: oneOf(["native", "copy"]) },
  comment_posted: {},
  like_added: {},
  follow_added: { context: oneOf(["search", "profile"]) },
  report_submitted: { target_type: oneOf(["user", "post", "comment"]) },
  photo_changed: { target: oneOf(["vault", "avatar"]) },
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
