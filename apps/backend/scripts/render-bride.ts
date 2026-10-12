// Accès BRIDÉ à l'API de Render (décision du fondateur, 2026-09-29), pour
// les déploiements sans navigateur.
//
//   pnpm --filter backend render-bride deployer <spotto-api|site> [--vider-cache] [--confirmer]
//     (--vider-cache : obligatoire pour le site après un changement de variable,
//      sinon la construction peut réutiliser l'ancienne valeur — constaté au lot 2)
//   pnpm --filter backend render-bride suivre   <spotto-api|site> <dep-…>
//   pnpm --filter backend render-bride api-url  https://spotto-api.onrender.com [--confirmer]
//   pnpm --filter backend render-bride variable <spotto-api|site> <NOM> <valeur> [--confirmer]
//   pnpm --filter backend render-bride compteurs-ia spotto-api --depuis <date ISO> [--chronologie]
//     (lecture SEULE des journaux : des compteurs, jamais de contenu — diagnostic
//      du lot 4 ter, demandé par le fondateur le 2026-10-07 ; plafond global
//      SerpApi depuis le lot 4 quater ; --chronologie : l'ordre des événements)
//
// Règles (voir scripts/lib/render-guard.ts) :
// - deux services seulement : spotto-api et le site ; l'ancien serveur
//   (Oregon) et tout autre service sont refusés ;
// - quatre actions seulement : lancer un déploiement, suivre son statut,
//   modifier une variable de la liste fermée EXPO_PUBLIC_API_URL (raccourci
//   « api-url ») ou les variables publiques du lot 2 (Sentry, PostHog,
//   environnement) — une variable à la fois, jamais la liste entière, jamais
//   un secret, jamais le groupe de variables des coordonnées ;
// - aucune suppression ;
// - chaque action qui change quelque chose est d'abord ANNONCÉE ; elle n'est
//   lancée qu'avec --confirmer ;
// - la clé est lue dans apps/backend/.render-api-key (ignoré par Git) et
//   n'est jamais affichée (scripts/lib/render-api.ts).
// La clé de production d'Anthropic (seul secret écrit par ces outils) passe
// par un autre script, à saisie masquée : configurer-anthropic-prod.
import { assertEditableVariable, FINAL_DEPLOY_STATUSES, RenderGuardError, assertDeployId, resolveService } from "./lib/render-guard.js";
import { readRenderKey as readKey, renderRequest as render, RenderNotFound as NotFound } from "./lib/render-api.js";
import { chronologie, compterRequetes, decrireAnalyse, decrireCodes, extraireCompteursIA, extrairePlafond, lireJournaux, parametresJournaux, REQUETES_SUIVIES, resumerPlafond } from "./lib/render-logs.js";
import { z } from "zod";

const POLL_MS = 10_000;
const POLL_LIMIT_MS = 15 * 60_000;

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
  const service = resolveService(args.find((arg) => !arg.startsWith("--")));
  const clearCache = args.includes("--vider-cache");
  console.log(`ACTION ANNONCÉE : déployer le dernier commit de main sur « ${service.name} » (${service.id})${clearCache ? ", cache de construction vidé" : ""}.`);
  if (!confirm) {
    console.log("Rien n'est lancé. Relancer avec --confirmer pour déployer.");
    return;
  }
  const key = readKey();
  const created = (await render(key, "POST", `/services/${service.id}/deploys`, { clearCache: clearCache ? "clear" : "do_not_clear" })) as Deploy;
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

async function setVariable(args: string[], confirm: boolean): Promise<void> {
  const service = resolveService(args[0]);
  const variable = assertEditableVariable(service.name, args[1], args[2]);
  const path = `/services/${service.id}/env-vars/${variable.key}`;
  const key = readKey();
  // Lecture de la seule variable concernée (valeur publique, jamais un secret).
  let before: string | null = null;
  try {
    before = ((await render(key, "GET", path)) as { key: string; value: string }).value;
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
  }
  if (before === null && variable.mustExist) throw new RenderGuardError(`${variable.key} n'existe pas sur « ${service.name} » : refus de la créer.`);
  console.log(`Valeur actuelle de ${variable.key} sur « ${service.name} » : ${before ?? "(absente)"}`);
  if (before === variable.value) {
    console.log("Déjà à jour : rien à faire.");
    return;
  }
  console.log(`ACTION ANNONCÉE : ${before === null ? "créer" : "remplacer"} ${variable.key} = ${variable.value} sur « ${service.name} » (${service.id}), sans déployer.`);
  if (!confirm) {
    console.log("Rien n'est modifié. Relancer avec --confirmer pour appliquer.");
    return;
  }
  await render(key, "PUT", path, { value: variable.value });
  const after = ((await render(key, "GET", path)) as { key: string; value: string }).value;
  console.log(`Nouvelle valeur vérifiée : ${after}`);
  if (after !== variable.value) throw new Error("La valeur relue ne correspond pas : à vérifier dans le tableau de bord.");
  console.log("Aucun déploiement lancé : la valeur sera prise au prochain déploiement.");
}

/** Lecture seule : compteurs du parcours vidéo dans les journaux de spotto-api (jamais de contenu). */
async function counters(args: string[]): Promise<void> {
  const service = resolveService(args[0]);
  if (service.name !== "spotto-api") throw new RenderGuardError("Compteurs : seul « spotto-api » (le serveur) est concerné.");
  const position = args.indexOf("--depuis");
  const depuis = position >= 0 ? args[position + 1] : undefined;
  if (!depuis || Number.isNaN(Date.parse(depuis))) throw new RenderGuardError("Indiquez --depuis <date ISO>, par exemple 2026-10-07T05:51:00Z.");
  const jusque = new Date().toISOString();
  const key = readKey();
  const { ownerId } = z.object({ ownerId: z.string() }).parse(await render(key, "GET", `/services/${service.id}`));
  console.log(`Compteurs de « spotto-api » du ${depuis} au ${jusque} — lecture seule, aucun contenu :`);
  const lignes = await lireJournaux(key, parametresJournaux(ownerId, service.id, depuis, { type: "app" }, jusque));
  const requetes = compterRequetes(lignes);
  for (const requete of REQUETES_SUIVIES) console.log(`  ${requete.nom} — ${requete.sens} : ${decrireCodes(requetes.get(requete.nom) ?? {})}`);
  const analyses = lignes.flatMap((entree) => {
    const compteurs = extraireCompteursIA(entree.message);
    return compteurs ? [compteurs] : [];
  });
  console.log(`  Analyses par l'IA (compteurs écrits par le serveur) : ${analyses.length}`);
  for (const analyse of analyses) console.log(`    - ${decrireAnalyse(analyse)}`);
  const plafonds = lignes.flatMap((entree) => {
    const plafond = extrairePlafond(entree.message);
    return plafond ? [plafond] : [];
  });
  console.log(`  Plafond global SerpApi (compteur de la base) : ${resumerPlafond(plafonds)}`);
  // --chronologie : l'ordre des événements, heure de Paris (jamais d'identifiant, d'adresse ni de contenu).
  if (!args.includes("--chronologie")) return;
  console.log("  Ordre des événements (heure de Paris) :");
  for (const evenement of chronologie(lignes)) {
    const heure = new Date(evenement.heure).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });
    console.log(`    ${heure} — ${evenement.nom} — ${evenement.issue}`);
  }
}

async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2);
  const confirm = rest.includes("--confirmer");
  const args = rest.filter((arg) => arg !== "--confirmer");
  if (action === "deployer") return deploy(args, confirm);
  if (action === "suivre") return follow(args);
  if (action === "api-url") return setVariable(["site", "EXPO_PUBLIC_API_URL", args[0] ?? ""], confirm);
  if (action === "variable") return setVariable(args, confirm);
  if (action === "compteurs-ia") return counters(args);
  throw new RenderGuardError("Action refusée : seules « deployer », « suivre », « api-url », « variable » et « compteurs-ia » existent.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
