// Protection anti-robots (point 17 de la feuille de route V1) : Cloudflare
// Turnstile, vérifié par Supabase Auth (« captcha »). Le widget vit dans une
// seule page statique du site (public/verification-robot.html), affichée dans
// une iframe sur le site et dans une vue web sur iPhone ; elle renvoie un jeton
// que l'app joint aux quatre appels : connexion, inscription, « mot de passe
// oublié » et renvoi de l'e-mail de confirmation (options.captchaToken).
//
// Logique pure, sans React Native : testée par tests/robot-check.test.ts.
// Interrupteur : EXPO_PUBLIC_TURNSTILE_SITE_KEY. Absente, aucun widget et les
// appels partent exactement comme avant (aucun champ ajouté).

/** Chemin de la page hôte du widget, servie par le site. */
export const ROBOT_CHECK_PAGE_PATH = "/verification-robot.html";
/** Seule origine du widget de Cloudflare (script et cadre). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
/** Signature des messages envoyés par la page hôte. */
export const ROBOT_MESSAGE_SOURCE = "spotto-verification-robot";

/** Un jeton Turnstile fait au plus 2048 caractères : marge, rien de plus. */
const MAX_TOKEN_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = MAX_TOKEN_LENGTH + 200;

/** Clé publique (« sitekey ») utilisable, ou null : protection coupée. */
export function turnstileSiteKey(value: string | undefined | null): string | null {
  const key = (value ?? "").trim();
  return /^[0-9A-Za-z_-]{1,64}$/.test(key) ? key : null;
}

/** Origine (https://hôte[:port]) d'une adresse https, ou null. */
export function httpsOrigin(url: string): string | null {
  const match = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d{1,5})?(?:[/?#].*)?$/i.exec(url.trim());
  return match ? `https://${match[1].toLowerCase()}${match[2] ?? ""}` : null;
}

/** Adresse de la page hôte, avec la clé publique et la langue du widget. */
export function robotCheckPageUrl(siteOrigin: string, siteKey: string, locale: string): string {
  const lang = /^[a-z]{2}$/.test(locale) ? locale : "auto";
  return `${siteOrigin}${ROBOT_CHECK_PAGE_PATH}?sitekey=${encodeURIComponent(siteKey)}&lang=${lang}`;
}

/** Vrai seulement pour la page hôte elle-même, sur l'origine du site. */
export function isRobotPageUrl(url: string | undefined | null, siteOrigin: string): boolean {
  if (typeof url !== "string") return false;
  const page = `${siteOrigin}${ROBOT_CHECK_PAGE_PATH}`;
  return url === page || url.startsWith(`${page}?`);
}

/** Navigation demandée dans la vue web (iPhone) : la page hôte en haut ; dans
 * les cadres, seulement le widget de Cloudflare. Tout le reste est refusé
 * (liens, redirections, ouvertures de fenêtres, autres schémas). */
export function robotCheckNavigationAllowed(request: { url: string; isTopFrame?: boolean }, siteOrigin: string): boolean {
  if (request.isTopFrame === false) {
    return request.url.startsWith(`${TURNSTILE_ORIGIN}/`) || request.url === "about:blank" || request.url === "about:srcdoc";
  }
  return isRobotPageUrl(request.url, siteOrigin);
}

/** Message reçu par une page web : il doit venir de NOTRE iframe, sur l'origine du site. */
export function isTrustedWebMessage(event: { origin: string; source: unknown }, expected: { origin: string; source: unknown }): boolean {
  return expected.source != null && event.source === expected.source && event.origin === expected.origin;
}

export type RobotMessage = { type: "token"; token: string } | { type: "expired" } | { type: "error" };

/** Message de la page hôte (texte JSON), ou null s'il n'en a pas la forme exacte. */
export function parseRobotMessage(data: unknown): RobotMessage | null {
  if (typeof data !== "string" || data.length > MAX_MESSAGE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { source, type, token } = value as Record<string, unknown>;
  if (source !== ROBOT_MESSAGE_SOURCE) return null;
  if (type === "expired" || type === "error") return { type };
  if (type === "token" && typeof token === "string" && token.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7e]+$/.test(token)) {
    return { type: "token", token };
  }
  return null;
}

export type RobotCheckStatus = "loading" | "ready" | "error";

/** `generation` change à chaque nouveau widget : un message d'un ancien widget est ignoré. */
export interface RobotCheckState {
  generation: number;
  token: string | null;
  status: RobotCheckStatus;
}

export type RobotCheckEvent =
  | (RobotMessage & { generation: number })
  /** Jeton pris pour un appel (à usage unique) : on en redemande un. */
  | { type: "used" }
  /** « Réessayer » après une erreur. */
  | { type: "retry" };

export const INITIAL_ROBOT_CHECK: RobotCheckState = { generation: 0, token: null, status: "loading" };

function freshWidget(state: RobotCheckState): RobotCheckState {
  return { generation: state.generation + 1, token: null, status: "loading" };
}

export function robotCheckReducer(state: RobotCheckState, event: RobotCheckEvent): RobotCheckState {
  switch (event.type) {
    case "used":
    case "retry":
      return freshWidget(state);
    default:
      if (event.generation !== state.generation) return state;
      if (event.type === "token") return { ...state, token: event.token, status: "ready" };
      // Jeton expiré (≈ 300 s) ou défi non résolu à temps : nouveau widget.
      if (event.type === "expired") return freshWidget(state);
      return { ...state, token: null, status: "error" };
  }
}

/** Les options d'un appel, avec le jeton s'il y en a un ; sans jeton, l'objet tel quel. */
export function withCaptcha<O extends object>(options: O, token: string | null): O & { captchaToken?: string } {
  return token === null ? options : { ...options, captchaToken: token };
}

/** Les paramètres d'un appel, avec `options.captchaToken` s'il y a un jeton ; sans jeton, l'objet tel quel. */
export function withCaptchaOption<P extends { options?: object }>(params: P, token: string | null): P & { options?: { captchaToken?: string } } {
  return token === null ? params : { ...params, options: { ...params.options, captchaToken: token } };
}
