// En-têtes de sécurité du site (lot garde-fous, point 19 de la feuille de
// route V1). Le site est un site statique sur Render : ses en-têtes se
// règlent dans le tableau de bord de Render (page du site → « Headers »),
// pas dans le code. Cette liste est la source ; EN-TETES-SITE.md en donne la
// copie à coller, et tests/web-headers.test.ts vérifie que les deux disent
// la même chose. Jamais importé par l'app.
//
// Pourquoi : sur le site, la session de la personne est gardée dans le
// navigateur. Si un contenu piégé réussissait un jour à exécuter du code dans
// la page, il pourrait la lire. La « Content-Security-Policy » n'autorise que
// le code du site lui-même, et seulement les services que le site appelle.

import marque from "@monapp/shared-types/marque.json";

/** Le seul script écrit dans la page par Expo (export du site) : autorisé par son empreinte. */
export const EXPO_INLINE_SCRIPT = "globalThis.__EXPO_ROUTER_HYDRATE__=true;";
/** SHA-256 de EXPO_INLINE_SCRIPT, en base 64 (vérifiée par le test). */
export const EXPO_INLINE_SCRIPT_SHA256 = "67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8=";

/** Services appelés par le site. */
export interface SiteServices {
  /** Adresse du serveur de Spotto (EXPO_PUBLIC_API_URL). */
  apiUrl: string;
  /** Adresse de la base Supabase (EXPO_PUBLIC_SUPABASE_URL). */
  supabaseUrl: string;
}

/** Production, telle que réglée sur Render pour le site (base spotto-prod).
 * L'adresse du serveur vient du fichier unique de la marque (adresseServeur, MARQUE.md). */
export const PRODUCTION_SERVICES: SiteServices = {
  apiUrl: marque.adresseServeur,
  supabaseUrl: "https://selhqdqfrflsqivgxypf.supabase.co",
};

/** Sentry (région UE) et PostHog (UE), fixes dans le code de l'app. */
const SENTRY_EU = "https://*.ingest.de.sentry.io";
const POSTHOG_EU = "https://eu.i.posthog.com";
/** Widget anti-robots Cloudflare Turnstile (point 17, ANTI-ROBOTS.md) : son script et son cadre. */
export const TURNSTILE = "https://challenges.cloudflare.com";

function origin(url: string): string {
  return new URL(url).origin;
}

/** La politique de sécurité du contenu, directive par directive. */
export function contentSecurityPolicy(services: SiteServices): string {
  const supabase = origin(services.supabaseUrl);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    // Le code du site seulement, le petit script d'Expo par son empreinte, et
    // le script du widget anti-robots (page /verification-robot.html).
    ["script-src", ["'self'", `'sha256-${EXPO_INLINE_SCRIPT_SHA256}'`, TURNSTILE]],
    // Les styles écrits dans la page par React Native Web.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Images des boutiques (n'importe quel site, en https), photos choisies sur l'appareil.
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    // Vidéo choisie sur l'appareil (lecture de ses images).
    ["media-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'", "data:"]],
    // Le serveur, la base (et son temps réel), Sentry, PostHog ; photos de l'appareil lues avant l'envoi.
    ["connect-src", ["'self'", origin(services.apiUrl), supabase, supabase.replace(/^https:/, "wss:"), SENTRY_EU, POSTHOG_EU, "blob:", "data:"]],
    ["worker-src", ["'self'", "blob:"]],
    // Cadres : la page du widget anti-robots (même origine) et le widget de Cloudflare.
    ["frame-src", ["'self'", TURNSTILE]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    // Jamais affiché dans le cadre d'un autre site ; seulement dans le sien
    // (la page du widget anti-robots, affichée dans une iframe du site).
    ["frame-ancestors", ["'self'"]],
    ["upgrade-insecure-requests", []],
  ];
  return directives.map(([name, values]) => [name, ...values].join(" ")).join("; ");
}

/** Les en-têtes, dans l'ordre de EN-TETES-SITE.md. Chemin : « /* » (tout le site). */
export function webSecurityHeaders(services: SiteServices): { name: string; value: string }[] {
  return [
    { name: "Content-Security-Policy", value: contentSecurityPolicy(services) },
    // HTTPS obligatoire pendant un an (sans les sous-domaines : le nom de domaine n'est pas encore choisi).
    { name: "Strict-Transport-Security", value: "max-age=31536000" },
    { name: "X-Content-Type-Options", value: "nosniff" },
    { name: "X-Frame-Options", value: "SAMEORIGIN" },
    // Les boutiques ne voient que « vient de Spotto », jamais la page exacte.
    { name: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { name: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
