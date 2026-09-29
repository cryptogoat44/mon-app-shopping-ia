// Accès BRIDÉ à l'API de Render (décision du fondateur, 2026-09-29), pour
// les déploiements sans navigateur.
//
//   pnpm --filter backend render-bride deployer <spotto-api|site> [--confirmer]
//   pnpm --filter backend render-bride suivre   <spotto-api|site> <dep-…>
//   pnpm --filter backend render-bride api-url  https://spotto-api.onrender.com [--confirmer]
//
// Règles (voir scripts/lib/render-guard.ts) :
// - deux services seulement : spotto-api et le site ; l'ancien serveur
//   (Oregon) et tout autre service sont refusés ;
// - trois actions seulement : lancer un déploiement, suivre son statut,
//   modifier EXPO_PUBLIC_API_URL du site (une seule variable, jamais la
//   liste entière, jamais le groupe de variables des coordonnées) ;
// - aucune suppression ;
// - chaque action qui change quelque chose est d'abord ANNONCÉE ; elle n'est
//   lancée qu'avec --confirmer ;
// - la clé est lue dans apps/backend/.render-api-key (ignoré par Git) et
//   n'est jamais affichée.
import { existsSync, readFileSync } from "node:fs";
import {
  RENDER_KEY_PATH as KEY_PATH,
  EDITABLE_VARIABLE,
  FINAL_DEPLOY_STATUSES,
  RenderGuardError,
  assertApiUrl,
  assertDeployId,
  resolveService,
} from "./lib/render-guard.js";

const API = "https://api.render.com/v1";
const POLL_MS = 10_000;
const POLL_LIMIT_MS = 15 * 60_000;

function readKey(): string {
  if (!existsSync(KEY_PATH)) throw new RenderGuardError("Clé absente : lancez d'abord « pnpm --filter backend configurer-render ».");
  const key = readFileSync(KEY_PATH, "utf8").trim();
  if (!key) throw new RenderGuardError("Fichier de clé vide.");
  return key;
}

async function render(key: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Render a répondu ${response.status}${text ? ` : ${text.slice(0, 200)}` : ""}`);
  return text ? JSON.parse(text) : null;
}

interface Deploy {
  id: string;
  status: string;
  commit?: { id?: string; message?: string };
}

function describeDeploy(deploy: Deploy): string {
  const commit = deploy.commit?.id ? deploy.commit.id.slice(0, 7) : "?";
  return `${deploy.id} — commit ${commit} — statut ${deploy.status}`;
}

async function deploy(args: string[], confirm: boolean): Promise<void> {
  const service = resolveService(args[0]);
  console.log(`ACTION ANNONCÉE : déployer le dernier commit de main sur « ${service.name} » (${service.id}).`);
  if (!confirm) {
    console.log("Rien n'est lancé. Relancer avec --confirmer pour déployer.");
    return;
  }
  const key = readKey();
  const created = (await render(key, "POST", `/services/${service.id}/deploys`, { clearCache: "do_not_clear" })) as Deploy;
  console.log(`Déploiement lancé : ${describeDeploy(created)}`);
  console.log(`Suivi : pnpm --filter backend render-bride suivre ${service.name} ${created.id}`);
}

async function follow(args: string[]): Promise<void> {
  const service = resolveService(args[0]);
  const deployId = assertDeployId(args[1]);
  const key = readKey();
  console.log(`Suivi du déploiement ${deployId} de « ${service.name} » (${service.id}), toutes les ${POLL_MS / 1000} s.`);
  const start = Date.now();
  let last = "";
  for (;;) {
    const current = (await render(key, "GET", `/services/${service.id}/deploys/${deployId}`)) as Deploy;
    if (current.status !== last) {
      console.log(`  ${new Date().toLocaleTimeString("fr-FR")} — ${describeDeploy(current)}`);
      last = current.status;
    }
    if ((FINAL_DEPLOY_STATUSES as readonly string[]).includes(current.status)) {
      if (current.status !== "live") process.exitCode = 1;
      return;
    }
    if (Date.now() - start > POLL_LIMIT_MS) throw new Error("Toujours en cours après 15 min : arrêt du suivi (le déploiement continue chez Render).");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function setApiUrl(args: string[], confirm: boolean): Promise<void> {
  const value = assertApiUrl(args[0]);
  const service = resolveService(EDITABLE_VARIABLE.service);
  const path = `/services/${service.id}/env-vars/${EDITABLE_VARIABLE.key}`;
  const key = readKey();
  // Lecture de la seule variable concernée (adresse publique, pas un secret).
  const before = (await render(key, "GET", path)) as { key: string; value: string };
  console.log(`Valeur actuelle de ${EDITABLE_VARIABLE.key} sur « ${service.name} » : ${before.value}`);
  if (before.value === value) {
    console.log("Déjà à jour : rien à faire.");
    return;
  }
  console.log(`ACTION ANNONCÉE : remplacer ${EDITABLE_VARIABLE.key} par ${value} sur « ${service.name} » (${service.id}), sans déployer.`);
  if (!confirm) {
    console.log("Rien n'est modifié. Relancer avec --confirmer pour appliquer.");
    return;
  }
  await render(key, "PUT", path, { value });
  const after = (await render(key, "GET", path)) as { key: string; value: string };
  console.log(`Nouvelle valeur vérifiée : ${after.value}`);
  if (after.value !== value) throw new Error("La valeur relue ne correspond pas : à vérifier dans le tableau de bord.");
  console.log("Aucun déploiement lancé : le site prendra cette valeur au prochain déploiement.");
}

async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2);
  const confirm = rest.includes("--confirmer");
  const args = rest.filter((arg) => arg !== "--confirmer");
  if (action === "deployer") return deploy(args, confirm);
  if (action === "suivre") return follow(args);
  if (action === "api-url") return setApiUrl(args, confirm);
  throw new RenderGuardError("Action refusée : seules « deployer », « suivre » et « api-url » existent.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
