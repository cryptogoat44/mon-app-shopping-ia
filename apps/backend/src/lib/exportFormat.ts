import type { Locale } from "./locale.js";

// Mise en forme des valeurs du fichier lisible de l'export (dates, prix,
// liens, navigateur). Fonctions pures, testées sans base de données
// (tests/exportHtml.test.ts).

const INTL: Record<Locale, string> = { fr: "fr-FR", en: "en-US" };

/** Fuseau par défaut quand l'app n'en envoie pas (ou un invalide). */
export const DEFAULT_TIME_ZONE: Record<Locale, string> = { fr: "Europe/Paris", en: "UTC" };

/** Fuseau horaire envoyé par l'app (en-tête X-Time-Zone, nom IANA comme
 * « Europe/Paris ») : accepté seulement s'il est court, fait des seuls
 * caractères attendus, et reconnu par le moteur. Sinon : Europe/Paris en
 * français, UTC en anglais. Le fuseau retenu est écrit dans le fichier. */
export function resolveTimeZone(header: string | string[] | undefined, locale: Locale): string {
  const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? "";
  if (value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(value)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return value;
    } catch {
      // Fuseau inconnu du moteur : repli ci-dessous.
    }
  }
  return DEFAULT_TIME_ZONE[locale];
}

/** Jour (AAAA-MM-JJ) dans le fuseau donné : sert au nom du fichier. */
export function localDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Date lisible (« 13 octobre 2026 à 01:19 » / « October 13, 2026 at 1:19 AM »)
 * dans le fuseau de la personne ; null si la valeur n'est pas une date. */
export function formatDateTime(value: string, locale: Locale, timeZone: string): string | null {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const text = new Intl.DateTimeFormat(INTL[locale], { dateStyle: "long", timeStyle: "short", timeZone }).format(new Date(time));
  // « 1er octobre », comme dans l'app (apps/mobile/src/lib/format.ts).
  return locale === "fr" ? text.replace(/^1 /, "1er ") : text;
}

/** Texte qui ressemble à une date enregistrée par la base (ISO 8601). */
export function looksLikeTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

export function formatNumber(value: number, locale: Locale): string {
  return value.toLocaleString(INTL[locale], { maximumFractionDigits: 2 });
}

/** Montant lu dans la base : nombre, ou texte numérique ; sinon null. */
export function toAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Prix dans sa devise d'origine, jamais converti (même règle que l'app,
 * apps/mobile/src/lib/format.ts). La colonne est un char(3) complété par des
 * espaces (« $  », « €  ») et pas toujours un code ISO (« $US ») : on retire
 * les espaces ; Intl seulement pour un code de trois lettres, sinon le
 * montant suivi du symbole. */
export function formatPrice(amount: number, currency: unknown, locale: Locale): string {
  const code = typeof currency === "string" ? currency.trim() : "";
  const digits = { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 };
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(INTL[locale], { style: "currency", currency: code, ...digits }).format(amount);
    } catch {
      // Code refusé par le moteur : repli ci-dessous.
    }
  }
  return `${amount.toLocaleString(INTL[locale], digits)} ${code}`.trim();
}

/** Indice de confiance (0 à 1) en pourcentage ; null s'il est absent. */
export function formatPercent(value: unknown, locale: Locale): string | null {
  const amount = toAmount(value);
  if (amount === null) return null;
  return new Intl.NumberFormat(INTL[locale], { style: "percent", maximumFractionDigits: 0 }).format(amount);
}

/** Adresse web (http ou https) normalisée ; null pour tout le reste
 * (javascript:, data:, texte quelconque) — jamais un lien cliquable. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Nom court du site d'une adresse (« asos.com », « tiktokcdn-eu.com ») pour
 * le libellé d'un lien. */
export function siteOf(href: string): string {
  const host = new URL(href).hostname.replace(/^www\./, "");
  const labels = host.split(".");
  return labels.length > 2 && !/^\d+$/.test(labels[labels.length - 1]!) ? labels.slice(-2).join(".") : host;
}

/** Buckets publics de NOTRE stockage dont les images peuvent s'afficher dans
 * le fichier (photos de la personne, copies faites par notre serveur). */
const DISPLAYABLE_BUCKETS = ["post-media", "avatars", "vault-media"] as const;

/** Image de notre propre stockage public (même origine que SUPABASE_URL, un
 * des buckets ci-dessus) : la seule qui peut être affichée. Toute autre
 * image (Google, marchand, TikTok) reste un simple lien : ouvrir le fichier
 * ne contacte aucun site tiers. */
export function isOwnStorageImage(href: string, storageOrigin: string | null): boolean {
  if (!storageOrigin) return false;
  const url = new URL(href);
  return url.origin === storageOrigin && DISPLAYABLE_BUCKETS.some((bucket) => url.pathname.startsWith(`/storage/v1/object/public/${bucket}/`));
}

/** Navigateur et appareil, en clair (« Chrome · Mac ») ; l'en-tête complet
 * reste dans la version JSON. null si rien n'est reconnu. */
export function summarizeUserAgent(userAgent: string): { browser: string | null; device: string | null; app: boolean } {
  const ua = userAgent;
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? "Safari"
              : null;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  // Requêtes natives de l'app : « Spotto/… CFNetwork/… Darwin/… » (iOS),
  // « okhttp/… » (Android).
  const ios = /CFNetwork\/|Darwin\//.test(ua);
  const android = /okhttp\//i.test(ua);
  const app = browser === null && (ios || android);
  return { browser, device: device ?? (app ? (ios ? "iOS" : "Android") : null), app };
}
