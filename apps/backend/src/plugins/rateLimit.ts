import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { RATE_LIMITS, type RateLimitName } from "../lib/rateLimits.js";

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyInstance {
    /** Renvoie un preHandler qui applique la limite nommée `name` (voir
     * src/lib/rateLimits.ts). À placer APRÈS `requireAuth` dans le tableau
     * `preHandler` de la route, pour que la limite soit comptée par
     * utilisateur plutôt que par IP dès qu'il est connu. */
    rateLimit: (name: RateLimitName) => PreHandler;
  }
  interface FastifyContextConfig {
    /** Cette route gère déjà sa propre limite nommée (posée explicitement
     * dans son propre preHandler) — ne pas lui ajouter la limite "default"
     * par-dessus. */
    rateLimitName?: RateLimitName;
    /** Exclut complètement une route du filet "default" (ex. /health, pour
     * ne jamais faire échouer les sondes de disponibilité de Render). */
    skipDefaultRateLimit?: boolean;
  }
}

// Compteurs uniquement en mémoire — jamais écrits en base, jamais liés à
// une IP stockée durablement (voir la règle sur les IP dans CLAUDE.md). Un
// redémarrage du service (fréquent sur l'offre gratuite de Render, qui se
// met en veille) réinitialise tout : acceptable pour un simple garde-fou
// anti-abus, pas un dispositif de sécurité critique.
const hits = new Map<string, { count: number; resetAt: number }>();

function keyFor(request: FastifyRequest, name: RateLimitName): string {
  const identity = request.user?.id ?? request.ip;
  return `${name}:${identity}`;
}

// Exportée pour un test unitaire rapide de la logique de fenêtre, sans
// passer par une vraie route (voir tests/rateLimit.test.ts).
export function registerHit(
  key: string,
  rule: { max: number; windowMs: number }
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= rule.max) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Vitest fixe NODE_ENV="test" automatiquement, sans configuration
// nécessaire — la suite crée beaucoup de comptes jetables très vite, ce
// qui déclencherait de faux 429 sans ce garde-fou.
function isDisabled(): boolean {
  return process.env.NODE_ENV === "test";
}

function buildPreHandler(name: RateLimitName): PreHandler {
  return async function rateLimitPreHandler(request, reply) {
    if (isDisabled()) return;

    const rule = RATE_LIMITS[name];
    const { allowed, retryAfterMs } = registerHit(keyFor(request, name), rule);

    if (!allowed) {
      reply.header("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      await reply.code(429).send({
        error: "rate_limited",
        message: "Trop de tentatives en peu de temps. Réessaie dans quelques instants.",
      });
    }
  };
}

export default fp(async function rateLimitPlugin(fastify: FastifyInstance) {
  fastify.decorate("rateLimit", buildPreHandler);

  const defaultHandler = buildPreHandler("default");

  // Applique automatiquement la limite "default" à toute route qui ne
  // déclare pas sa propre limite nommée — pour qu'une route ajoutée plus
  // tard ne puisse pas être oubliée, sans avoir à l'ajouter manuellement
  // partout. Ajouté APRÈS les preHandler déjà déclarés par la route (donc
  // après `requireAuth` s'il y en a un), pour pouvoir compter par
  // utilisateur, pas seulement par IP.
  fastify.addHook("onRoute", (routeOptions: RouteOptions) => {
    if (routeOptions.config?.rateLimitName || routeOptions.config?.skipDefaultRateLimit) return;

    const existing = routeOptions.preHandler;
    const merged = Array.isArray(existing) ? [...existing, defaultHandler] : existing ? [existing, defaultHandler] : [defaultHandler];
    routeOptions.preHandler = merged as unknown as RouteOptions["preHandler"];
  });
});
