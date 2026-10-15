import { SEARCH_FAILURE_MESSAGES } from "@monapp/shared-types";
import type { ExportData, ExportDataKey, ExportRow } from "./exportData.js";
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPrice,
  isOwnStorageImage,
  looksLikeTimestamp,
  safeHref,
  siteOf,
  summarizeUserAgent,
  toAmount,
} from "./exportFormat.js";
import type { ExportLookups } from "./exportLookups.js";
import {
  APP_LOCALE_LABELS,
  CONSENT_TYPE_LABELS,
  CONVERSION_STATUS_LABELS,
  EXPORT_COLUMNS,
  EXPORT_SECTIONS,
  EXPORT_STATUS_LABELS,
  EXPORT_TEXT,
  MEDIA_KIND_LABELS,
  MERCHANT_LINK_CONTEXT_LABELS,
  MODERATION_ACTION_LABELS,
  NOTIFICATION_LABELS,
  PIECE_SENDS_FROM_LABELS,
  PLATFORM_LABELS,
  POST_TYPE_LABELS,
  PRIVACY_LABELS,
  RECOGNITION_METHOD_LABELS,
  REPORT_HANDLED_LABELS,
  REPORT_REASON_LABELS,
  FEEDBACK_REASON_LABELS,
  REPORT_TARGET_LABELS,
  SEARCH_FAILURE_LABELS,
  SEARCH_STATUS_LABELS,
  VAULT_CATEGORY_LABELS,
  type Bilingual,
  type ExportColumn,
  type ExportColumnName,
  type ExportSectionId,
} from "./exportText.js";
import type { Locale } from "./locale.js";

// Fichier lisible de l'export RGPD (droit d'accès, article 15) : une page
// HTML autonome, construite par le serveur dans la langue de l'app. Elle
// s'ouvre sans connexion dans n'importe quel navigateur, et contient aussi,
// en fin de fichier, la version JSON complète (portabilité, article 20).
//
// Sécurité : légendes, bios, commentaires, titres et adresses viennent des
// personnes. Tout passe par le gabarit `html`, qui échappe chaque valeur ;
// un lien n'est cliquable que s'il est en http ou https ; aucun script ; une
// politique de sécurité (CSP) n'autorise que les styles du fichier et les
// images de notre propre stockage. Une image d'un autre site (Google,
// marchand, TikTok) n'est jamais chargée : c'est un simple lien.
//
// Fonction pure (aucun accès à la base) : testée sur des données en mémoire
// (tests/exportHtml.test.ts).

// ---- Échappement ----

/** Texte HTML déjà sûr (produit par le gabarit `html`). */
export class Html {
  constructor(readonly value: string) {}
}

type Part = Html | string | number | null | undefined | false | readonly Part[];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

function partToString(part: Part): string {
  if (part instanceof Html) return part.value;
  if (Array.isArray(part)) return part.map(partToString).join("");
  if (part === null || part === undefined || part === false) return "";
  return escapeHtml(String(part));
}

/** Gabarit qui échappe chaque valeur insérée, sauf un Html déjà construit. */
export function html(strings: TemplateStringsArray, ...values: Part[]): Html {
  let out = strings[0] ?? "";
  values.forEach((value, index) => {
    out += partToString(value) + (strings[index + 1] ?? "");
  });
  return new Html(out);
}

function isEmpty(part: Part): boolean {
  if (part instanceof Html) return part.value.trim() === "";
  if (Array.isArray(part)) return part.every(isEmpty);
  if (part === null || part === undefined || part === false) return true;
  return String(part).trim() === "";
}

// ---- Contexte ----

export interface ExportHtmlOptions {
  locale: Locale;
  /** Fuseau horaire des dates (déjà validé, voir resolveTimeZone). */
  timeZone: string;
  /** Origine de notre stockage Supabase (seules images affichées), ou null. */
  storageOrigin: string | null;
  /** Colonne inconnue rencontrée : l'appelant la journalise (section et nom
   * de colonne seulement, jamais sa valeur). */
  onUnknownColumn?: (section: ExportDataKey, column: string) => void;
}

interface Ctx extends ExportHtmlOptions {
  data: ExportData;
  lookups: ExportLookups;
  selfId: string | null;
  warned: Set<string>;
}

function tr(ctx: Ctx, label: Bilingual, vars: Record<string, string> = {}): string {
  return label[ctx.locale].replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Libellé d'une valeur connue ; une valeur inconnue s'affiche telle quelle. */
function enumLabel(ctx: Ctx, labels: Readonly<Record<string, Bilingual>>, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const key = String(value);
  return Object.prototype.hasOwnProperty.call(labels, key) ? tr(ctx, labels[key]!) : key;
}

function plainDate(ctx: Ctx, value: unknown): string {
  return (typeof value === "string" ? formatDateTime(value, ctx.locale, ctx.timeZone) : null) ?? String(value ?? "");
}

function date(ctx: Ctx, value: unknown): Part {
  if (typeof value !== "string" || value === "") return null;
  const text = formatDateTime(value, ctx.locale, ctx.timeZone);
  return text === null ? value : html`<time datetime="${value}">${text}</time>`;
}

function multiline(value: unknown): Part {
  const text = str(value);
  return text === null ? null : html`<span class="text">${text}</span>`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Lien au libellé court (jamais l'adresse elle-même, souvent très longue) ;
 * une valeur qui n'est pas une adresse web reste du texte. */
function link(ctx: Ctx, value: unknown, label: (site: string) => string): Part {
  const raw = str(value);
  if (raw === null) return null;
  const href = safeHref(raw);
  if (href === null) return tr(ctx, EXPORT_TEXT.notWebLink, { value: truncate(raw, 80) });
  return html`<a href="${href}" rel="noopener noreferrer">${label(siteOf(href))}</a>`;
}

/** Image de notre stockage : affichée ; toute autre : simple lien. */
function imageOrLink(ctx: Ctx, value: unknown, label: (site: string) => string): Part {
  const href = safeHref(value);
  if (href !== null && isOwnStorageImage(href, ctx.storageOrigin)) {
    return html`<img src="${href}" alt="${tr(ctx, EXPORT_TEXT.photoAlt)}" loading="lazy" referrerpolicy="no-referrer">`;
  }
  return link(ctx, value, label);
}

function price(ctx: Ctx, min: unknown, max: unknown, currency: unknown): string | null {
  const low = toAmount(min);
  const high = toAmount(max);
  if (low === null && high === null) return null;
  if (low === null || high === null || low === high) return formatPrice((low ?? high)!, currency, ctx.locale);
  return tr(ctx, EXPORT_TEXT.priceRange, { min: formatPrice(low, currency, ctx.locale), max: formatPrice(high, currency, ctx.locale) });
}

type Person = { username: string | null; displayName: string };

/** Un autre compte, tel qu'il peut être nommé ; null : « un compte Spotto ».
 * Un compte en relation de blocage avec la personne, dans un sens comme dans
 * l'autre, n'est jamais nommé (règle 8), sauf dans « Comptes bloqués »
 * (blockedSection, qui lit ses propres noms). */
function knownPerson(ctx: Ctx, id: unknown): Person | null {
  if (typeof id !== "string" || ctx.lookups.blockedMe.has(id) || ctx.lookups.blockedByMe.has(id)) return null;
  const found = ctx.lookups.people.get(id);
  return found && (found.username || found.displayName) ? found : null;
}

function personName(ctx: Ctx, found: Person | null | undefined): string {
  if (!found) return tr(ctx, EXPORT_TEXT.someone);
  if (!found.username) return found.displayName || tr(ctx, EXPORT_TEXT.someone);
  return found.displayName && found.displayName !== found.username ? `@${found.username} (${found.displayName})` : `@${found.username}`;
}

/** « @nom (Nom affiché) », « vous », ou « un compte Spotto ». */
function person(ctx: Ctx, id: unknown): string {
  if (typeof id === "string" && id === ctx.selfId) return tr(ctx, EXPORT_TEXT.yourself);
  return personName(ctx, knownPerson(ctx, id));
}

/** « votre publication », « une publication de @nom » ou « une publication
 * d'un compte Spotto ». */
function onPost(ctx: Ctx, postId: unknown): string {
  if (typeof postId === "string" && ctx.data.posts.some((post) => post.id === postId)) return tr(ctx, EXPORT_TEXT.yourPost);
  const author = knownPerson(ctx, typeof postId === "string" ? ctx.lookups.postAuthors.get(postId) : undefined);
  return author ? tr(ctx, EXPORT_TEXT.postBy, { person: personName(ctx, author) }) : tr(ctx, EXPORT_TEXT.postBySomeone);
}

/** Valeur d'une colonne sans présentation particulière. */
function defaultValue(ctx: Ctx, value: unknown): Part {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return tr(ctx, value ? EXPORT_TEXT.yes : EXPORT_TEXT.no);
  if (typeof value === "number") return formatNumber(value, ctx.locale);
  if (typeof value === "string") {
    if (looksLikeTimestamp(value)) return date(ctx, value);
    if (safeHref(value) !== null) return link(ctx, value, (site) => tr(ctx, EXPORT_TEXT.openLink, { site }));
    return multiline(value);
  }
  return html`<code>${JSON.stringify(value)}</code>`;
}

/** Le plus récent d'abord. Dates ISO renvoyées par la base (même fuseau) :
 * l'ordre du texte suffit (jamais localeCompare, qui ignore la ponctuation). */
function newestFirst(rows: readonly ExportRow[], column: string): ExportRow[] {
  return [...rows].sort((a, b) => {
    const x = String(a[column] ?? "");
    const y = String(b[column] ?? "");
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

function groupBy(rows: readonly ExportRow[], column: string): Map<string, ExportRow[]> {
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const key = String(row[column] ?? "");
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// ---- Cartes (une ligne de l'export) ----

const rowItem = (label: string, value: Part): Html => html`<div class="row"><dt>${label}</dt><dd>${value}</dd></div>`;
/** Ligne sans libellé (phrase, explication) : intitulé vide, masqué. */
const singleItem = (value: Part): Html => html`<div class="row single"><dt></dt><dd>${value}</dd></div>`;

/** Une ligne de l'export, présentée en « libellé : valeur ». Chaque colonne
 * affichée (ou présentée autrement : titre, phrase) est notée ; à la fin,
 * une colonne connue oubliée s'affiche quand même sous son libellé, une
 * colonne technique reste dans la version JSON, et une colonne inconnue est
 * montrée sous son nom brut (« Autres informations ») : rien n'est perdu. */
class Card<K extends ExportDataKey> {
  private readonly used = new Set<string>();
  private readonly items: Html[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly key: K,
    readonly row: ExportRow
  ) {}

  private label(column: string): string {
    const known = (EXPORT_COLUMNS[this.key] as Record<string, ExportColumn>)[column];
    return known ? tr(this.ctx, known.label) : column;
  }

  /** Colonnes déjà présentées ailleurs (titre de la carte, phrase). */
  use(...columns: ExportColumnName<K>[]): this {
    for (const column of columns) this.used.add(column);
    return this;
  }

  /** Une colonne sous son libellé ; rien si la valeur est vide. */
  field(column: ExportColumnName<K>, value?: Part): this {
    this.used.add(column);
    const shown = value === undefined ? defaultValue(this.ctx, this.row[column]) : value;
    if (!isEmpty(shown)) this.items.push(rowItem(this.label(column), shown));
    return this;
  }

  /** Une ligne qui réunit plusieurs colonnes (prix, image) ou une phrase. */
  line(label: string | null, value: Part, columns: ExportColumnName<K>[] = []): this {
    this.use(...columns);
    if (isEmpty(value)) return this;
    this.items.push(label === null ? singleItem(value) : rowItem(label, value));
    return this;
  }

  note(text: string): this {
    this.items.push(singleItem(html`<span class="note">${text}</span>`));
    return this;
  }

  /** Les lignes de la carte, avec ce qui n'a pas encore été présenté. */
  rows(): Html {
    const known = EXPORT_COLUMNS[this.key] as Record<string, ExportColumn>;
    const rest: Html[] = [];
    const others: Html[] = [];
    for (const [column, value] of Object.entries(this.row)) {
      if (this.used.has(column)) continue;
      const entry = Object.prototype.hasOwnProperty.call(known, column) ? known[column] : undefined;
      if (entry?.technical) continue;
      if (entry) {
        const shown = defaultValue(this.ctx, value);
        if (!isEmpty(shown)) rest.push(rowItem(tr(this.ctx, entry.label), shown));
        continue;
      }
      const marker = `${this.key}.${column}`;
      if (!this.ctx.warned.has(marker)) {
        this.ctx.warned.add(marker);
        this.ctx.onUnknownColumn?.(this.key, column);
      }
      const shown = defaultValue(this.ctx, value);
      others.push(rowItem(column, isEmpty(shown) ? tr(this.ctx, EXPORT_TEXT.emptyValue) : shown));
    }
    return html`<dl>${this.items}${rest}</dl>${
      others.length > 0 ? html`<div class="others"><h4>${tr(this.ctx, EXPORT_TEXT.otherInfo)}</h4><dl>${others}</dl></div>` : null
    }`;
  }

  render(title?: Part, nested?: Part): Html {
    return article(title, this.rows(), nested);
  }
}

function article(title: Part, ...body: Part[]): Html {
  return html`<article class="card">${isEmpty(title ?? null) ? null : html`<h3>${title}</h3>`}${body}</article>`;
}

// ---- Sections ----

function sectionTitle(ctx: Ctx, id: ExportSectionId): string {
  return tr(ctx, EXPORT_SECTIONS[id].title);
}

function section(ctx: Ctx, id: ExportSectionId, body: Part, lead: Part = null): Html {
  const content = isEmpty(body) ? html`<p class="empty">${tr(ctx, EXPORT_TEXT.noData)}</p>` : body;
  return html`<section id="${id}"><h2>${sectionTitle(ctx, id)}</h2><p class="lead">${tr(ctx, EXPORT_SECTIONS[id].intro)}</p>${lead}${content}</section>`;
}

function subsection(ctx: Ctx, title: string, intro: string | null, body: Part): Html {
  const content = isEmpty(body) ? html`<p class="empty">${tr(ctx, EXPORT_TEXT.noData)}</p>` : body;
  return html`<h3 class="sub">${title}</h3>${intro ? html`<p class="lead">${intro}</p>` : null}${content}`;
}

function accountSection(ctx: Ctx): Html {
  const account = new Card(ctx, "account", ctx.data.account).field("email");
  const row = ctx.data.profile;
  if (!row) return section(ctx, "account", article(null, account.rows()));
  const profile = new Card(ctx, "profile", row)
    .field("username", str(row.username) ? `@${row.username as string}` : null)
    .field("display_name")
    .field("avatar_url", imageOrLink(ctx, row.avatar_url, (site) => tr(ctx, EXPORT_TEXT.viewImage, { site })))
    .field("bio", multiline(row.bio))
    .field("locale", enumLabel(ctx, APP_LOCALE_LABELS, row.locale))
    .field("default_privacy", enumLabel(ctx, PRIVACY_LABELS, row.default_privacy))
    .field("piece_sends_from", enumLabel(ctx, PIECE_SENDS_FROM_LABELS, row.piece_sends_from))
    .field("created_at")
    .field("updated_at");
  return section(ctx, "account", article(null, account.rows(), profile.rows()));
}

function failureReason(ctx: Ctx, value: unknown): string | null {
  const text = str(value);
  if (text === null) return null;
  const key = (Object.keys(SEARCH_FAILURE_MESSAGES) as (keyof typeof SEARCH_FAILURE_MESSAGES)[]).find((k) => SEARCH_FAILURE_MESSAGES[k] === text);
  return key ? tr(ctx, SEARCH_FAILURE_LABELS[key]) : text;
}

/** `feedback` : le signalement « Résultat incohérent » de cette pièce, s'il y en a un. */
function matchCard(ctx: Ctx, row: ExportRow, feedback?: ExportRow): Html {
  const merchant = str(row.merchant_name);
  const reported = feedback
    ? tr(ctx, EXPORT_TEXT.reportedInconsistentValue, { reason: enumLabel(ctx, FEEDBACK_REASON_LABELS, feedback.reason) ?? "", date: plainDate(ctx, feedback.created_at) })
    : null;
  return new Card(ctx, "productMatches", row)
    .use("product_name")
    .field("rank")
    .field("brand")
    .line(tr(ctx, EXPORT_COLUMNS.productMatches.price_min.label), price(ctx, row.price_min, row.price_max, row.currency), ["price_min", "price_max", "currency"])
    .field("merchant_name")
    .field(
      "merchant_url",
      link(ctx, row.merchant_url, (site) => (merchant ? tr(ctx, EXPORT_TEXT.viewPieceAt, { merchant }) : tr(ctx, EXPORT_TEXT.viewPiece, { site })))
    )
    .field("image_url", imageOrLink(ctx, row.image_url, (site) => tr(ctx, EXPORT_TEXT.viewImage, { site })))
    .field("image_hd_url", link(ctx, row.image_hd_url, (site) => tr(ctx, EXPORT_TEXT.viewLargeImage, { site })))
    // Indice absent (cas courant) : rien plutôt qu'un pourcentage vide.
    .field("confidence_score", formatPercent(row.confidence_score, ctx.locale))
    .line(tr(ctx, EXPORT_TEXT.reportedInconsistent), reported)
    .render(str(row.product_name));
}

function matchesBlock(ctx: Ctx, matches: readonly ExportRow[], feedbackByMatch: ReadonlyMap<string, ExportRow>): Part {
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => (toAmount(a.rank) ?? 0) - (toAmount(b.rank) ?? 0));
  return html`<h4>${tr(ctx, EXPORT_TEXT.matchesTitle, { count: String(matches.length) })}</h4>${sorted.map((row) => matchCard(ctx, row, feedbackByMatch.get(String(row.id))))}`;
}

function searchesSection(ctx: Ctx): Html {
  const matchesBySearch = groupBy(ctx.data.productMatches, "search_id");
  const feedbackByMatch = new Map(ctx.data.resultFeedback.map((row) => [String(row.match_id), row]));
  const searchIds = new Set(ctx.data.productSearches.map((row) => String(row.id)));
  const cards = newestFirst(ctx.data.productSearches, "created_at").map((row) => {
    const platform = row.source_platform;
    const card = new Card(ctx, "productSearches", row)
      .use("created_at")
      .field("source_platform", enumLabel(ctx, PLATFORM_LABELS, platform))
      .field(
        "source_url",
        link(ctx, row.source_url, (site) =>
          platform === "tiktok"
            ? tr(ctx, EXPORT_TEXT.openTiktok)
            : platform === "instagram"
              ? tr(ctx, EXPORT_TEXT.openInstagram)
              : tr(ctx, EXPORT_TEXT.openLink, { site })
        )
      )
      // Miniature fournie par la plateforme : adresse signée qui expire.
      .field("thumbnail_url", link(ctx, row.thumbnail_url, (site) => tr(ctx, EXPORT_TEXT.temporaryImage, { site })))
      .field("method", enumLabel(ctx, RECOGNITION_METHOD_LABELS, row.method))
      .field("query", multiline(row.query))
      .field("status", enumLabel(ctx, SEARCH_STATUS_LABELS, row.status))
      .field("error_message", failureReason(ctx, row.error_message));
    if (row.status === "pending") card.note(tr(ctx, EXPORT_TEXT.pendingExplained));
    else if (platform === "photo" || row.method === "manual_screenshot") card.note(tr(ctx, EXPORT_TEXT.analysedImageDeleted));
    return card.render(tr(ctx, EXPORT_TEXT.searchTitle, { date: plainDate(ctx, row.created_at) }), matchesBlock(ctx, matchesBySearch.get(String(row.id)) ?? [], feedbackByMatch));
  });
  // Propositions sans recherche retrouvée : jamais perdues.
  const orphans = ctx.data.productMatches.filter((row) => !searchIds.has(String(row.search_id)));
  return section(ctx, "searches", [
    cards,
    orphans.length > 0 ? html`<h3 class="sub">${tr(ctx, EXPORT_TEXT.orphanMatches)}</h3>${orphans.map((row) => matchCard(ctx, row, feedbackByMatch.get(String(row.id))))}` : null,
  ]);
}

function wishlistSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.wishlistItems, "created_at").map((row) => {
    const merchant = str(row.merchant_name);
    return new Card(ctx, "wishlistItems", row)
      .use("title")
      .field("image_url", imageOrLink(ctx, row.image_url, (site) => tr(ctx, EXPORT_TEXT.viewImage, { site })))
      .field("reference")
      .line(tr(ctx, EXPORT_COLUMNS.wishlistItems.price_min.label), price(ctx, row.price_min, null, row.currency), ["price_min", "currency"])
      .field("merchant_name")
      .field(
        "merchant_url",
        link(ctx, row.merchant_url, (site) => (merchant ? tr(ctx, EXPORT_TEXT.viewPieceAt, { merchant }) : tr(ctx, EXPORT_TEXT.viewPiece, { site })))
      )
      .field("created_at")
      .render(str(row.title));
  });
  return section(ctx, "wishlist", cards);
}

function vaultSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.vaultItems, "created_at").map((row) =>
    new Card(ctx, "vaultItems", row)
      .use("title")
      .field("image_url", imageOrLink(ctx, row.image_url, (site) => tr(ctx, EXPORT_TEXT.viewImage, { site })))
      .field("category", enumLabel(ctx, VAULT_CATEGORY_LABELS, row.category))
      .field("verified")
      .field("created_at")
      .render(str(row.title))
  );
  return section(ctx, "vault", cards);
}

function titleOf(rows: readonly ExportRow[], id: unknown, column: string): string | null {
  return typeof id === "string" ? str(rows.find((row) => row.id === id)?.[column]) : null;
}

function taggedCard(ctx: Ctx, row: ExportRow): Html {
  const gone = tr(ctx, EXPORT_TEXT.pieceGone);
  const card = new Card(ctx, "postTaggedPieces", row).use("position");
  if (row.vault_item_id) card.field("vault_item_id", titleOf(ctx.data.vaultItems, row.vault_item_id, "title") ?? gone);
  if (row.product_match_id) card.field("product_match_id", titleOf(ctx.data.productMatches, row.product_match_id, "product_name") ?? gone);
  return card.use("vault_item_id", "product_match_id").field("created_at").render();
}

function postMedia(ctx: Ctx, row: ExportRow): Part {
  const openMedia = (site: string) => tr(ctx, EXPORT_TEXT.openMedia, { site });
  const thumb = safeHref(row.media_thumb_url);
  const full = safeHref(row.media_url);
  const isPhoto = row.media_kind === "photo";
  // La miniature d'abord ; la photo elle-même seulement pour une photo (une
  // vidéo n'est jamais intégrée, juste son lien).
  if (thumb && isOwnStorageImage(thumb, ctx.storageOrigin)) {
    return [imageOrLink(ctx, thumb, openMedia), isPhoto ? null : link(ctx, row.media_url, openMedia)];
  }
  if (full && isPhoto) return imageOrLink(ctx, full, openMedia);
  return [link(ctx, row.media_thumb_url, openMedia), link(ctx, row.media_url, openMedia)];
}

function postsSection(ctx: Ctx): Html {
  const taggedByPost = groupBy(ctx.data.postTaggedPieces, "post_id");
  const postIds = new Set(ctx.data.posts.map((row) => String(row.id)));
  const cards = newestFirst(ctx.data.posts, "created_at").map((row) => {
    const type = enumLabel(ctx, POST_TYPE_LABELS, row.type) ?? "";
    const shownPiece = titleOf(ctx.data.vaultItems, row.vault_item_id, "title") ?? titleOf(ctx.data.wishlistItems, row.wishlist_item_id, "title");
    const tagged = [...(taggedByPost.get(String(row.id)) ?? [])].sort((a, b) => (toAmount(a.position) ?? 0) - (toAmount(b.position) ?? 0));
    return new Card(ctx, "posts", row)
      .use("type", "created_at")
      .line(tr(ctx, EXPORT_COLUMNS.posts.media_url.label), postMedia(ctx, row), ["media_url", "media_thumb_url"])
      .field("caption", multiline(row.caption))
      .field("privacy", enumLabel(ctx, PRIVACY_LABELS, row.privacy))
      .field("media_kind", enumLabel(ctx, MEDIA_KIND_LABELS, row.media_kind))
      .line(tr(ctx, EXPORT_TEXT.shownPiece), shownPiece)
      .field("hidden_at")
      .render(
        tr(ctx, EXPORT_TEXT.postTitle, { type, date: plainDate(ctx, row.created_at) }),
        tagged.length > 0 ? html`<h4>${tr(ctx, EXPORT_TEXT.taggedTitle, { count: String(tagged.length) })}</h4>${tagged.map((t) => taggedCard(ctx, t))}` : null
      );
  });
  const orphans = ctx.data.postTaggedPieces.filter((row) => !postIds.has(String(row.post_id)));
  return section(ctx, "posts", [
    cards,
    orphans.length > 0 ? html`<h3 class="sub">${tr(ctx, EXPORT_TEXT.orphanTagged)}</h3>${orphans.map((row) => taggedCard(ctx, row))}` : null,
  ]);
}

function commentsSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.comments, "created_at").map((row) =>
    new Card(ctx, "comments", row)
      .field("body", multiline(row.body))
      .field("post_id", onPost(ctx, row.post_id))
      .field("hidden_at")
      .field("created_at")
      .render()
  );
  return section(ctx, "comments", cards);
}

function likesSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.reactionsGiven, "created_at").map((row) =>
    new Card(ctx, "reactionsGiven", row).field("post_id", onPost(ctx, row.post_id)).field("created_at").render()
  );
  return section(ctx, "likes", cards);
}

function followingSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.following, "created_at").map((row) =>
    new Card(ctx, "following", row).use("followee_id").field("created_at").render(person(ctx, row.followee_id))
  );
  return section(ctx, "following", cards);
}

function followersSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.followers, "created_at").map((row) =>
    new Card(ctx, "followers", row).use("follower_id").field("created_at").render(person(ctx, row.follower_id))
  );
  return section(ctx, "followers", cards);
}

function blockedSection(ctx: Ctx): Html {
  // Les comptes que la personne a bloqués gardent leur nom ici (comme dans
  // l'app), même s'ils l'ont bloquée eux aussi.
  const cards = newestFirst(ctx.data.blockedAccounts, "created_at").map((row) =>
    new Card(ctx, "blockedAccounts", row)
      .use("blocked_id")
      .field("created_at")
      .render(personName(ctx, typeof row.blocked_id === "string" ? ctx.lookups.blockedByMe.get(row.blocked_id) : undefined))
  );
  return section(ctx, "blocked", cards);
}

/** Pièce envoyée ou reçue ; `other` : l'autre personne (destinataire ou
 * expéditeur), jamais nommée si elle est en relation de blocage avec la
 * personne.
 *
 * Pièce reçue : son état « masquée » n'est jamais écrit (version JSON
 * seulement). Seule la personne qui l'a reçue peut la signaler : le lire lui
 * apprendrait la décision prise sur son signalement (masquer ou classer).
 * Pour la même raison, son image (copie rangée chez l'expéditeur) reste un
 * simple lien pour TOUTES les pièces reçues : une image affichée pour les
 * unes et pas pour les autres trahirait la décision, et un contenu masqué par
 * la modération ne se réaffiche pas de lui-même. */
function pieceSendCard(ctx: Ctx, key: "piecesSent" | "piecesReceived", row: ExportRow, other: "recipient_id" | "sender_id"): Html {
  const merchant = str(row.merchant_name);
  const sent = key === "piecesSent";
  const viewImage = (site: string) => tr(ctx, EXPORT_TEXT.viewImage, { site });
  const image = row.image_thumb_url ?? row.image_url;
  const card = new Card(ctx, key, row)
    .use("title")
    .field(other, person(ctx, row[other]))
    .line(tr(ctx, EXPORT_COLUMNS.piecesSent.image_url.label), sent ? imageOrLink(ctx, image, viewImage) : link(ctx, image, viewImage), [
      "image_url",
      "image_thumb_url",
    ])
    .line(tr(ctx, EXPORT_COLUMNS.piecesSent.price_min.label), price(ctx, row.price_min, null, row.currency), ["price_min", "currency"])
    .field("merchant_name")
    .field(
      "merchant_url",
      link(ctx, row.merchant_url, (site) => (merchant ? tr(ctx, EXPORT_TEXT.viewPieceAt, { merchant }) : tr(ctx, EXPORT_TEXT.viewPiece, { site })))
    );
  // Pièce envoyée : la décision concerne la personne (elle en est notifiée).
  if (sent) card.field("hidden_at");
  else card.use("hidden_at");
  return card.field("created_at").render(str(row.title));
}

function piecesSentSection(ctx: Ctx): Html {
  return section(
    ctx,
    "piecesSent",
    newestFirst(ctx.data.piecesSent, "created_at").map((row) => pieceSendCard(ctx, "piecesSent", row, "recipient_id"))
  );
}

function piecesReceivedSection(ctx: Ctx): Html {
  return section(
    ctx,
    "piecesReceived",
    newestFirst(ctx.data.piecesReceived, "created_at").map((row) => pieceSendCard(ctx, "piecesReceived", row, "sender_id"))
  );
}

/** Une décision de la modération : quoi, sur quel type de contenu, pourquoi
 * (jamais qui l'a prise). */
function decisionLines(ctx: Ctx, decision: ExportRow): string[] {
  const lines = [tr(ctx, EXPORT_TEXT.decision, { action: enumLabel(ctx, MODERATION_ACTION_LABELS, decision.action) ?? "" })];
  const target = enumLabel(ctx, REPORT_TARGET_LABELS, decision.target_type);
  if (target) lines.push(tr(ctx, EXPORT_TEXT.decisionAbout, { target }));
  const reason = enumLabel(ctx, REPORT_REASON_LABELS, decision.reason);
  if (reason) lines.push(tr(ctx, EXPORT_TEXT.decisionReason, { reason }));
  const note = str(decision.note);
  if (note) lines.push(tr(ctx, EXPORT_TEXT.decisionNote, { note }));
  return lines;
}

function notificationsSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.notifications, "created_at").map((row) => {
    const actor = row.actor_id === null || row.actor_id === undefined ? tr(ctx, EXPORT_TEXT.moderationActor) : capitalize(person(ctx, row.actor_id));
    const sentence = Object.prototype.hasOwnProperty.call(NOTIFICATION_LABELS, String(row.type))
      ? `${actor} ${tr(ctx, NOTIFICATION_LABELS[row.type as keyof typeof NOTIFICATION_LABELS])}`
      : `${actor} · ${String(row.type ?? "")}`;
    const card = new Card(ctx, "notifications", row).use("actor_id", "type");
    const actionId = row.moderation_action_id;
    if (row.type === "moderation") {
      // Seulement les décisions qui concernent la personne (déjà exportées).
      const decision = typeof actionId === "string" ? ctx.data.moderationDecisionsAboutMe.find((d) => d.id === actionId) : undefined;
      for (const text of decision ? decisionLines(ctx, decision) : [tr(ctx, EXPORT_TEXT.decisionUnknown)]) card.line(null, text);
    } else if (row.type === "report_handled") {
      // Le type du contenu signalé, retrouvé dans les propres signalements de
      // la personne ; jamais la décision prise.
      const report = typeof actionId === "string" ? ctx.data.reportsSubmitted.find((r) => r.moderation_action_id === actionId) : undefined;
      const targetType = String(report?.target_type ?? "");
      card.line(
        null,
        Object.prototype.hasOwnProperty.call(REPORT_HANDLED_LABELS, targetType)
          ? tr(ctx, REPORT_HANDLED_LABELS[targetType as keyof typeof REPORT_HANDLED_LABELS])
          : tr(ctx, EXPORT_TEXT.reportHandled)
      );
    } else if (row.type === "piece_received") {
      card.line(tr(ctx, EXPORT_COLUMNS.piecesReceived.title.label), titleOf(ctx.data.piecesReceived, row.piece_send_id, "title"));
    }
    card.field("created_at");
    if (str(row.read_at)) card.field("read_at");
    else card.line(null, tr(ctx, EXPORT_TEXT.unread), ["read_at"]);
    // « Masquée » seulement quand le contenu masqué est le sien : une de ses
    // publications, dont les « j'aime » et commentaires disparaissent avec
    // elle ; date de cette décision, déjà écrite dans « Vos publications ».
    // Une pièce reçue ou le commentaire d'un autre compte, masqués après un
    // signalement (souvent le sien), ne sont jamais présentés ainsi : la
    // personne apprendrait la décision (version JSON seulement).
    const ownHiddenPost =
      str(row.hidden_at) && typeof row.post_id === "string" ? ctx.data.posts.find((post) => post.id === row.post_id && str(post.hidden_at)) : undefined;
    if (ownHiddenPost) card.field("hidden_at", date(ctx, ownHiddenPost.hidden_at)).note(tr(ctx, EXPORT_TEXT.hiddenWithContent));
    else card.use("hidden_at");
    return card.render(sentence);
  });
  return section(ctx, "notifications", cards);
}

function browserSummary(ctx: Ctx, value: unknown): string | null {
  const userAgent = str(value);
  if (userAgent === null) return null;
  const { browser, device, app } = summarizeUserAgent(userAgent);
  const first = browser ?? (app ? tr(ctx, EXPORT_TEXT.spottoApp) : tr(ctx, EXPORT_TEXT.unknownBrowser));
  return device ? `${first} · ${device}` : first;
}

function clicksSection(ctx: Ctx): Html {
  const clicks = newestFirst(ctx.data.affiliateClicks, "clicked_at").map((row) => {
    const piece = typeof row.affiliate_link_id === "string" ? ctx.lookups.clickedPieces.get(row.affiliate_link_id) : undefined;
    const title = piece
      ? piece.merchantName
        ? tr(ctx, EXPORT_TEXT.pieceAt, { piece: piece.productName, merchant: piece.merchantName })
        : piece.productName
      : tr(ctx, EXPORT_TEXT.pieceGone);
    return new Card(ctx, "affiliateClicks", row)
      .use("affiliate_link_id")
      .field("context", enumLabel(ctx, MERCHANT_LINK_CONTEXT_LABELS, row.context))
      .field("user_agent", browserSummary(ctx, row.user_agent))
      .field("clicked_at")
      .render(title);
  });
  const conversions = newestFirst(ctx.data.affiliateConversions, "created_at").map((row) =>
    new Card(ctx, "affiliateConversions", row)
      .line(tr(ctx, EXPORT_COLUMNS.affiliateConversions.amount.label), price(ctx, row.amount, null, row.currency), ["amount", "currency"])
      .field("commission", price(ctx, row.commission, null, row.currency))
      .field("status", enumLabel(ctx, CONVERSION_STATUS_LABELS, row.status))
      .field("confirmed_at")
      .field("created_at")
      .render()
  );
  const body = clicks.length > 0 || conversions.length > 0 ? [clicks, subsection(ctx, tr(ctx, EXPORT_TEXT.conversionsTitle), tr(ctx, EXPORT_TEXT.conversionsIntro), conversions)] : null;
  return section(ctx, "clicks", body);
}

function reportsSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.reportsSubmitted, "created_at").map((row) => {
    const card = new Card(ctx, "reportsSubmitted", row).use("target_type");
    if (row.target_type === "user") card.field("target_id", person(ctx, row.target_id));
    else card.use("target_id");
    const handled = str(row.handled_at);
    return card
      .field("reason", enumLabel(ctx, REPORT_REASON_LABELS, row.reason))
      .field("note", multiline(row.note))
      .field("created_at")
      // Traité ou non, jamais la décision prise (moderation_action_id reste
      // un identifiant technique, dans la version JSON seulement).
      .line(tr(ctx, EXPORT_TEXT.followUp), handled ? tr(ctx, EXPORT_TEXT.handledOn, { date: plainDate(ctx, handled) }) : tr(ctx, EXPORT_TEXT.notHandled), [
        "handled_at",
      ])
      .render(enumLabel(ctx, REPORT_TARGET_LABELS, row.target_type));
  });
  return section(ctx, "reports", cards);
}

function consentsSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.consents, "created_at").map((row) =>
    new Card(ctx, "consents", row)
      .use("type")
      .field("granted_at")
      .field("revoked_at")
      .field("document_version")
      // Même instant que l'accord ou le refus : seulement dans la version JSON.
      .use("created_at")
      .render(enumLabel(ctx, CONSENT_TYPE_LABELS, row.type))
  );
  return section(ctx, "consents", cards);
}

function decisionCard(ctx: Ctx, key: "moderationDecisionsAboutMe" | "moderationDecisionsTaken", row: ExportRow): Html {
  return new Card(ctx, key, row)
    .use("action")
    .field("target_type", enumLabel(ctx, REPORT_TARGET_LABELS, row.target_type))
    .field("reason", enumLabel(ctx, REPORT_REASON_LABELS, row.reason))
    .field("note", multiline(row.note))
    .field("created_at")
    .render(enumLabel(ctx, MODERATION_ACTION_LABELS, row.action));
}

function moderationSection(ctx: Ctx): Html {
  const { adminRole, suspension, moderationDecisionsAboutMe, moderationDecisionsTaken } = ctx.data;
  const admin = adminRole
    ? article(null, new Card(ctx, "adminRole", adminRole).line(null, tr(ctx, EXPORT_TEXT.adminSince, { date: plainDate(ctx, adminRole.created_at) }), ["created_at"]).rows())
    : html`<p>${tr(ctx, EXPORT_TEXT.adminNone)}</p>`;
  const suspended = suspension
    ? article(
        null,
        new Card(ctx, "suspension", suspension).line(null, tr(ctx, EXPORT_TEXT.suspendedSince, { date: plainDate(ctx, suspension.created_at) }), ["created_at"]).rows()
      )
    : html`<p>${tr(ctx, EXPORT_TEXT.suspendedNone)}</p>`;
  const aboutMe = newestFirst(moderationDecisionsAboutMe, "created_at").map((row) => decisionCard(ctx, "moderationDecisionsAboutMe", row));
  const taken = newestFirst(moderationDecisionsTaken, "created_at").map((row) => decisionCard(ctx, "moderationDecisionsTaken", row));
  return section(ctx, "moderation", [
    admin,
    suspended,
    subsection(ctx, tr(ctx, EXPORT_TEXT.aboutMeTitle), tr(ctx, EXPORT_TEXT.aboutMeIntro), aboutMe),
    adminRole || taken.length > 0 ? subsection(ctx, tr(ctx, EXPORT_TEXT.takenTitle), null, taken) : null,
  ]);
}

function exportsSection(ctx: Ctx): Html {
  const cards = newestFirst(ctx.data.dataExportRequests, "requested_at").map((row) =>
    new Card(ctx, "dataExportRequests", row)
      .use("status")
      .field("requested_at")
      .field("completed_at")
      .render(enumLabel(ctx, EXPORT_STATUS_LABELS, row.status))
  );
  return section(ctx, "exports", cards, html`<p class="note">${tr(ctx, EXPORT_TEXT.currentExportNote)}</p>`);
}

/** Nombre d'éléments affiché dans le sommaire (null : pas de compte). */
function sectionCount(data: ExportData, id: ExportSectionId): number | null {
  const counts: Record<ExportSectionId, number | null> = {
    account: null,
    searches: data.productSearches.length,
    wishlist: data.wishlistItems.length,
    vault: data.vaultItems.length,
    posts: data.posts.length,
    comments: data.comments.length,
    likes: data.reactionsGiven.length,
    following: data.following.length,
    followers: data.followers.length,
    blocked: data.blockedAccounts.length,
    piecesSent: data.piecesSent.length,
    piecesReceived: data.piecesReceived.length,
    notifications: data.notifications.length,
    clicks: data.affiliateClicks.length,
    reports: data.reportsSubmitted.length,
    consents: data.consents.length,
    moderation: null,
    exports: data.dataExportRequests.length,
  };
  return counts[id];
}

const SECTION_RENDERERS: Record<ExportSectionId, (ctx: Ctx) => Html> = {
  account: accountSection,
  searches: searchesSection,
  wishlist: wishlistSection,
  vault: vaultSection,
  posts: postsSection,
  comments: commentsSection,
  likes: likesSection,
  following: followingSection,
  followers: followersSection,
  blocked: blockedSection,
  piecesSent: piecesSentSection,
  piecesReceived: piecesReceivedSection,
  notifications: notificationsSection,
  clicks: clicksSection,
  reports: reportsSection,
  consents: consentsSection,
  moderation: moderationSection,
  exports: exportsSection,
};

/** Identifiant de la version technique en fin de fichier (repère des tests). */
export const EXPORT_APPENDIX_ID = "version-technique";

/** Politique de sécurité du fichier : aucun script, aucun formulaire, aucune
 * ressource externe, sauf les images de notre stockage. */
export function exportContentSecurityPolicy(storageOrigin: string | null): string {
  return `default-src 'none'; img-src ${storageOrigin ?? "'none'"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
}

// Palette de l'app (clair / sombre), texte en 16 px, 720 px de large au plus,
// cartes « libellé : valeur » lisibles sur un téléphone, impression soignée.
const STYLE = `
:root{color-scheme:light dark;--bg:#FBFBFA;--surface:#FFFFFF;--text:#1D1D1F;--muted:#6E6E73;--accent:#1E3D32;--line:#E6E4E0}
@media (prefers-color-scheme:dark){:root{--bg:#141312;--surface:#1E1D1B;--text:#F4F2EE;--muted:#A9A6A0;--accent:#9CC3AE;--line:#34322F}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
.brand{margin:0 0 4px;font-weight:700;letter-spacing:.02em;color:var(--accent)}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 8px}
h2{font-size:1.3rem;line-height:1.3;margin:40px 0 4px;color:var(--accent)}
h3{font-size:1.05rem;line-height:1.35;margin:0 0 8px}
h3.sub{margin:24px 0 4px}
h4{font-size:.95rem;margin:16px 0 4px}
p{margin:0 0 12px}
.meta,.lead,.note,dt{color:var(--muted)}
.note{font-size:.95rem}
a{color:var(--accent);overflow-wrap:anywhere}
nav ol{margin:0;padding-left:22px}
nav li{margin:2px 0}
.count{color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0;break-inside:avoid}
.card .card{background:var(--bg);margin:10px 0 0}
dl{margin:0}
.row{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:2px 12px;padding:6px 0;border-top:1px solid var(--line)}
dl>.row:first-child{border-top:0}
.row.single{grid-template-columns:minmax(0,1fr)}
.row.single dt{display:none}
dd{margin:0;overflow-wrap:anywhere}
.text{white-space:pre-wrap}
img{display:block;max-width:100%;max-height:320px;height:auto;border-radius:8px}
.others h4{color:var(--muted)}
details{margin-top:12px}
summary{cursor:pointer;font-weight:600;color:var(--accent)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
@media (max-width:480px){.row{grid-template-columns:minmax(0,1fr)}}
@media print{:root{color-scheme:light;--bg:#fff;--surface:#fff;--text:#000;--muted:#444;--accent:#000;--line:#bbb}main{max-width:none;padding:0}nav{display:none}h2{break-after:avoid}a{text-decoration:none}}
`;

/** Page HTML complète de l'export, dans la langue demandée. */
export function renderExportHtml(data: ExportData, lookups: ExportLookups, options: ExportHtmlOptions): string {
  const ctx: Ctx = { ...options, data, lookups, selfId: str(data.profile?.id), warned: new Set() };
  const profile = data.profile;
  const accountName = str(profile?.username) ? `@${profile!.username as string}` : (str(profile?.display_name) ?? "");
  const ids = Object.keys(EXPORT_SECTIONS) as ExportSectionId[];
  const sections = ids.map((id) => SECTION_RENDERERS[id](ctx));
  const toc = ids.map((id) => {
    const count = sectionCount(data, id);
    return html`<li><a href="#${id}">${sectionTitle(ctx, id)}</a>${count === null ? null : html` <span class="count">(${count})</span>`}</li>`;
  });
  const title = tr(ctx, EXPORT_TEXT.documentTitle);

  const page = html`<!doctype html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${new Html(exportContentSecurityPolicy(ctx.storageOrigin).replace(/[&<>"]/g, (char) => ESCAPES[char]!))}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>${new Html(STYLE)}</style>
</head>
<body>
<main>
<header>
<p class="brand">Spotto</p>
<h1>${title}</h1>
${accountName ? html`<p class="meta">${tr(ctx, EXPORT_TEXT.accountLine, { account: accountName })}</p>` : null}
<p class="meta">${tr(ctx, EXPORT_TEXT.createdLine, { date: plainDate(ctx, data.exportedAt), zone: ctx.timeZone })}</p>
</header>
<section class="intro">
<p>${tr(ctx, EXPORT_TEXT.introWhat)}</p>
<p>${tr(ctx, EXPORT_TEXT.introPrivate)}</p>
<p>${tr(ctx, EXPORT_TEXT.introPhotos)}</p>
<p>${tr(ctx, EXPORT_TEXT.introPurposes)}</p>
<p>${tr(ctx, EXPORT_TEXT.introTechnical)}</p>
</section>
<nav aria-label="${tr(ctx, EXPORT_TEXT.tocTitle)}">
<h2>${tr(ctx, EXPORT_TEXT.tocTitle)}</h2>
<ol>${toc}<li><a href="#${EXPORT_APPENDIX_ID}">${tr(ctx, EXPORT_TEXT.appendixTitle)}</a></li></ol>
</nav>
${sections}
<section id="${EXPORT_APPENDIX_ID}">
<details>
<summary>${tr(ctx, EXPORT_TEXT.appendixTitle)}</summary>
<p class="note">${tr(ctx, EXPORT_TEXT.appendixIntro)}</p>
<pre>${JSON.stringify(data, null, 2)}</pre>
</details>
</section>
</main>
</body>
</html>
`;
  return page.value;
}
