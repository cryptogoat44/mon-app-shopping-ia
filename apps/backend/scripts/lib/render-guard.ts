// Garde-fou du script render-bride (décision du fondateur, 2026-09-29) :
// une liste FERMÉE de services et d'actions. Tout le reste est refusé.
import { fileURLToPath } from "node:url";
import { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";

/** Fichier local de la clé d'API Render (ignoré par Git, jamais affiché). */
export const RENDER_KEY_PATH = fileURLToPath(new URL("../../.render-api-key", import.meta.url));

export class RenderGuardError extends Error {}

/** Seuls services autorisés. */
export const ALLOWED_SERVICES = {
  "spotto-api": { id: "srv-darcqk3tqb8s73f082f0", kind: "serveur (Francfort)" },
  site: { id: "srv-dagsaamk1f9s73do3isg", kind: "site web" },
} as const;

export type AllowedServiceName = keyof typeof ALLOWED_SERVICES;

/** Ancien serveur (Oregon) : toujours refusé, même par son identifiant. */
export const FORBIDDEN_OLD_SERVER = "srv-dags7bmk1f9s73dnolng";

/** Variables modifiables : liste FERMÉE par service, chacune avec la seule
 * forme de valeur admise. Aucun secret (clé, jeton, mot de passe) n'y figure :
 * les secrets sont saisis par le fondateur lui-même dans le tableau de bord.
 * Les coordonnées de l'éditeur (groupe de variables) n'y figurent pas non plus. */
interface VariableRule {
  check: (value: string) => boolean;
  expected: string;
  /** La variable doit déjà exister (sinon : refus, pas de création). */
  mustExist: boolean;
}

const SENTRY_EU_DSN = SENTRY_EU_DSN_PATTERN;

export const EDITABLE_VARIABLES: Record<AllowedServiceName, Record<string, VariableRule>> = {
  site: {
    EXPO_PUBLIC_API_URL: { check: (v) => (ALLOWED_API_URLS as readonly string[]).includes(v), expected: "https://spotto-api.onrender.com", mustExist: true },
    EXPO_PUBLIC_SENTRY_DSN: { check: (v) => SENTRY_EU_DSN.test(v), expected: "adresse Sentry de la région UE (…ingest.de.sentry.io/…)", mustExist: false },
    EXPO_PUBLIC_POSTHOG_KEY: { check: (v) => /^phc_[A-Za-z0-9]{20,64}$/.test(v), expected: "clé publique de projet PostHog (phc_…)", mustExist: false },
    EXPO_PUBLIC_ENVIRONMENT: { check: (v) => v === "production", expected: "production", mustExist: false },
  },
  "spotto-api": {
    SENTRY_DSN: { check: (v) => SENTRY_EU_DSN.test(v), expected: "adresse Sentry de la région UE (…ingest.de.sentry.io/…)", mustExist: false },
    SENTRY_ENVIRONMENT: { check: (v) => v === "production", expected: "production", mustExist: false },
  },
};

export function assertEditableVariable(service: AllowedServiceName, key: string | undefined, value: string | undefined): { key: string; value: string; mustExist: boolean } {
  const rule = key ? EDITABLE_VARIABLES[service][key] : undefined;
  if (!key || !rule) {
    const allowed = Object.keys(EDITABLE_VARIABLES[service]).join(", ");
    throw new RenderGuardError(`Variable « ${key ?? ""} » refusée sur « ${service} » : seules ${allowed} sont modifiables.`);
  }
  if (!value || !rule.check(value)) throw new RenderGuardError(`Valeur refusée pour ${key} : attendu ${rule.expected}.`);
  return { key, value, mustExist: rule.mustExist };
}

/** Adresse admise pour EXPO_PUBLIC_API_URL : un serveur Render, en https,
 * sans chemin, et jamais l'ancien serveur (Oregon). */
export const ALLOWED_API_URLS = ["https://spotto-api.onrender.com"] as const;

export function resolveService(nameOrId: string | undefined): { name: AllowedServiceName; id: string } {
  if (!nameOrId) throw new RenderGuardError("Service manquant : « spotto-api » ou « site ».");
  if (nameOrId === FORBIDDEN_OLD_SERVER || nameOrId === "mon-app-shopping-ia") {
    throw new RenderGuardError("Ancien serveur (Oregon) : refusé. Ce script n'y touche jamais.");
  }
  for (const [name, service] of Object.entries(ALLOWED_SERVICES) as [AllowedServiceName, (typeof ALLOWED_SERVICES)[AllowedServiceName]][]) {
    if (nameOrId === name || nameOrId === service.id) return { name, id: service.id };
  }
  throw new RenderGuardError(`Service « ${nameOrId} » refusé : seuls « spotto-api » et « site » sont autorisés.`);
}

/** Identifiant de déploiement renvoyé par Render (« dep-… »). */
export function assertDeployId(value: string | undefined): string {
  if (!value || !/^dep-[a-z0-9]{10,40}$/.test(value)) throw new RenderGuardError("Identifiant de déploiement invalide (attendu : dep-…).");
  return value;
}

export const FINAL_DEPLOY_STATUSES = ["live", "deactivated", "build_failed", "update_failed", "canceled", "pre_deploy_failed"] as const;
