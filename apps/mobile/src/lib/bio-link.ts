import { checkBioLink } from "@monapp/shared-types";
import { t } from "../i18n";

// Lien en bio (lot « vie sociale », migration 0049), côté app : la logique
// sans écran, testée à part (tests/epingles-lien.test.ts). La règle elle-même
// est celle du serveur (checkBioLink, @monapp/shared-types) : l'app ne s'en
// sert que pour prévenir tout de suite ; le serveur reste seul juge. Et l'app
// ne fait pas non plus confiance au serveur : avant d'ouvrir un lien, elle le
// relit et n'ouvre rien d'autre qu'une adresse « https: ».

// Espaces (y compris insécables) et caractères de contrôle, n'importe où.
const FORBIDDEN = /[\s\u0000-\u001f\u007f-\u009f]/u;

/** La phrase à montrer sous le champ « Lien », ou null s'il est bon (ou vide). */
export function bioLinkError(typed: string): string | null {
  const checked = checkBioLink(typed);
  if (checked.ok) return null;
  return checked.problem === "too_long" ? t.profilePins.linkTooLong : t.profilePins.linkInvalid;
}

/** Ce qu'il faut envoyer au serveur en enregistrant le profil : `undefined`
 * quand le lien ne change pas (ou que le serveur ne connaît pas les liens :
 * `current` absent) — le champ n'est alors pas envoyé du tout, et un
 * enregistrement du profil ne compte pas comme un changement de lien ; sinon
 * le lien mis en forme, ou null pour le retirer. Un lien refusé part tel quel :
 * le serveur répond avec sa phrase. */
export function linkToSend(current: string | null | undefined, typed: string): string | null | undefined {
  if (current === undefined) return undefined;
  const checked = checkBioLink(typed);
  if (!checked.ok) return typed.trim();
  return checked.url === (current ?? null) ? undefined : checked.url;
}

/** Une adresse « https: » relue par le parseur standard : son nom de site et
 * le reste de l'adresse, ou null. Jamais une autre forme de lien (http:,
 * javascript:, data:…), jamais un nom ou un mot de passe dans l'adresse. */
export interface HttpsParts {
  href: string;
  host: string;
  /** Ce qui suit le nom du site (« /chemin?x=1 »), ou "" pour la page d'accueil. */
  rest: string;
}

export function httpsParts(value: unknown): HttpsParts | null {
  if (typeof value !== "string" || FORBIDDEN.test(value) || !/^https:\/\/[^/\\]/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
  const href = url.href;
  const prefix = `https://${url.host}`;
  if (!href.startsWith(prefix)) return null;
  const rest = href.slice(prefix.length);
  return { href, host: url.host, rest: rest === "/" ? "" : rest };
}

/** Ce que le profil montre du lien : le nom du site en clair (« exemple.com »),
 * suivi de « /… » quand le lien mène plus loin que la page d'accueil. null :
 * rien à montrer (pas de lien, ou un lien que la règle refuserait). */
export function linkDisplay(url: string | null | undefined): { host: string; label: string; href: string } | null {
  if (typeof url !== "string" || url === "") return null;
  const checked = checkBioLink(url);
  if (!checked.ok || checked.url === null) return null;
  const parts = httpsParts(checked.url);
  if (!parts) return null;
  return { host: parts.host, label: parts.rest === "" ? parts.host : `${parts.host}/…`, href: parts.href };
}
