// Garde-fou du script render-bride (décision du fondateur, 2026-09-29) :
// une liste FERMÉE de services et d'actions. Tout le reste est refusé.
import { fileURLToPath } from "node:url";

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

/** Seule variable modifiable, et seulement sur le site. */
export const EDITABLE_VARIABLE = { service: "site" as AllowedServiceName, key: "EXPO_PUBLIC_API_URL" } as const;

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

export function assertApiUrl(value: string | undefined): string {
  if (!value) throw new RenderGuardError("Adresse manquante.");
  if (!(ALLOWED_API_URLS as readonly string[]).includes(value)) {
    throw new RenderGuardError(`Adresse refusée : seule ${ALLOWED_API_URLS.join(", ")} est admise (sans barre oblique finale).`);
  }
  return value;
}

/** Identifiant de déploiement renvoyé par Render (« dep-… »). */
export function assertDeployId(value: string | undefined): string {
  if (!value || !/^dep-[a-z0-9]{10,40}$/.test(value)) throw new RenderGuardError("Identifiant de déploiement invalide (attendu : dep-…).");
  return value;
}

export const FINAL_DEPLOY_STATUSES = ["live", "deactivated", "build_failed", "update_failed", "canceled", "pre_deploy_failed"] as const;
