// Nouveautés des Envies (lot « alertes visibles ») : la logique sans écran,
// testée à part (tests/alertes-visibles.test.ts). Imports relatifs : fichier
// testé par vitest.
//
// Règles :
// - le serveur (GET /api/alerts/news) donne vos alertes des 30 derniers
//   jours encore vraies aujourd'hui : baisse de prix (prix vu, votre seuil) et
//   retour en stock, une ligne par Envie et par sorte ; rien sans les alertes
//   sur le serveur, ou avec un serveur plus ancien (route inconnue) ;
// - « vu » est noté seulement sur l'appareil, par compte (AsyncStorage dans
//   l'app, localStorage sur le site), comme les autres marques de l'app : les
//   identifiants des alertes déjà montrées, rien d'autre ; rien n'est envoyé
//   au serveur ;
// - une nouveauté devient « vue » dès que le bandeau l'a affichée ; il reste
//   affiché tant que vos Envies restent ouvertes (onglet Envies du Profil),
//   puis disparaît ; la pastille de l'onglet Envies dit qu'il reste du non-vu ;
// - chaque ligne dit le prix vu, son jour et sa boutique (jamais
//   « promotion » ni prix barré) ; l'écart est celui avec VOTRE seuil, pas un
//   « ancien prix » ;
// - la mention « Baisse de prix » de la grille (lib/wish-alerts.ts) dit l'état
//   d'aujourd'hui ; le bandeau, ce qui est arrivé et quand : le serveur ne
//   garde que les nouveautés encore vraies, donc jamais de contradiction.
import type { WishAlertNews } from "@monapp/shared-types";
import { t } from "../i18n";
import { track } from "./analytics";
import { formatDayMonth, formatPrice } from "./format";
import type { Locale } from "./preferences";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function amountOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Une nouveauté telle que le serveur la renvoie, ou null si elle est
 * illisible (elle n'est alors pas montrée). Une baisse doit avoir son prix,
 * son seuil (plus haut) et sa devise. */
export function readNewsItem(body: unknown): WishAlertNews | null {
  if (typeof body !== "object" || body === null) return null;
  const fields = body as Record<string, unknown>;
  const { id, wishlistItemId, kind, title, merchantName, seenOn } = fields;
  if (typeof id !== "string" || !UUID.test(id) || typeof wishlistItemId !== "string" || !UUID.test(wishlistItemId)) return null;
  if (kind !== "price_drop" && kind !== "restock") return null;
  if (typeof title !== "string" || title.trim() === "" || typeof seenOn !== "string" || !DAY.test(seenOn)) return null;
  const merchant = typeof merchantName === "string" && merchantName.trim() !== "" ? merchantName : null;
  if (kind === "restock") return { id, wishlistItemId, kind, title, merchantName: merchant, price: null, threshold: null, currency: null, seenOn };
  const price = amountOrNull(fields.price);
  const threshold = amountOrNull(fields.threshold);
  const currency = typeof fields.currency === "string" && /^[A-Z]{3}$/.test(fields.currency) ? fields.currency : null;
  if (price === null || threshold === null || currency === null || Math.round(price * 100) >= Math.round(threshold * 100)) return null;
  return { id, wishlistItemId, kind, title, merchantName: merchant, price, threshold, currency, seenOn };
}

/** GET /api/alerts/news : les nouveautés lisibles, sans doublon. */
export function readNewsList(body: unknown): WishAlertNews[] {
  const items = typeof body === "object" && body !== null ? (body as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const news: WishAlertNews[] = [];
  for (const item of items) {
    const read = readNewsItem(item);
    if (!read || seen.has(read.id)) continue;
    seen.add(read.id);
    news.push(read);
  }
  return news;
}

/** La ligne d'une nouveauté, dans la langue de l'app : toujours le prix vu,
 * son jour et sa boutique (si elle est connue). */
export function newsLine(item: WishAlertNews, locale: Locale): string {
  const day = formatDayMonth(item.seenOn, locale);
  if (item.kind === "restock") return t.wishAlerts.newsRestock(item.title, day, item.merchantName);
  const currency = item.currency ?? "";
  const gap = Math.round(((item.threshold ?? 0) - (item.price ?? 0)) * 100) / 100;
  return t.wishAlerts.newsPriceDrop(item.title, formatPrice(item.price ?? 0, currency, locale), formatPrice(gap, currency, locale), day, item.merchantName);
}

/** Ce que le bandeau montre : les nouveautés pas encore vues, et celles déjà
 * affichées pendant cette visite (`shown`), dans l'ordre du serveur. */
export function bannerItems(items: readonly WishAlertNews[], seen: ReadonlySet<string>, shown: ReadonlySet<string>): WishAlertNews[] {
  return items.filter((item) => !seen.has(item.id) || shown.has(item.id));
}

/** Les nouveautés pas encore vues (la pastille, et celles à marquer vues). */
export function unseenItems(items: readonly WishAlertNews[], seen: ReadonlySet<string>): WishAlertNews[] {
  return items.filter((item) => !seen.has(item.id));
}

// ---- Statistiques (catalogue fermé : jamais la pièce, la boutique, le prix ni le jour) ----

/** « news_banner_shown » : le bandeau affiche `count` nouveautés pas encore vues. */
export function trackNewsShown(count: number): void {
  if (count > 0) track("news_banner_shown", { count });
}

/** « news_line_opened » : une ligne du bandeau touchée ; sa sorte seulement. */
export function trackNewsOpened(item: Pick<WishAlertNews, "kind">): void {
  track("news_line_opened", { kind: item.kind });
}

// ---- La mémoire de l'appareil ----

/** Au plus ce nombre d'identifiants gardés (les plus récents) : bien plus que
 * les nouveautés de 30 jours que le serveur peut renvoyer. */
export const SEEN_MAX = 200;

/** Clé du stockage, par compte. */
export function seenNewsKey(userId: string): string {
  return `spotto.nouveautes-vues.${userId}`;
}

/** Les identifiants gardés ; rien, ou une valeur illisible : aucun. */
export function readSeen(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(-SEEN_MAX);
}

/** `seen` avec `ids` en plus, à la fin, sans doublon, borné à SEEN_MAX. */
export function withSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const added = ids.filter((id, index) => !seen.includes(id) && ids.indexOf(id) === index);
  return [...seen, ...added].slice(-SEEN_MAX);
}

/** Ce qu'il faut du stockage (AsyncStorage dans l'app, localStorage sur le site). */
export interface SeenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Les nouveautés déjà vues par ce compte sur cet appareil ; stockage
 * illisible : aucune (le bandeau les remontre, rien de plus). */
export async function loadSeenNews(store: SeenStore, userId: string): Promise<string[]> {
  try {
    return readSeen(await store.getItem(seenNewsKey(userId)));
  } catch {
    return [];
  }
}

/** Note ces nouveautés vues (relit d'abord : un autre écran a pu en noter).
 * Rend la liste gardée ; stockage impossible : null. */
export async function markNewsSeen(store: SeenStore, userId: string, ids: readonly string[]): Promise<string[] | null> {
  try {
    const key = seenNewsKey(userId);
    const next = withSeen(readSeen(await store.getItem(key)), ids);
    await store.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}
