// Délai de réponse du service de connexion (Supabase Auth) de la PRODUCTION,
// comparé à spotto-dev au même moment — mesure en lecture seule autorisée
// par le fondateur le 2026-10-19.
//
//   pnpm --filter backend mesure-connexion-prod
//
// Garde-fous, qu'aucune option ne peut changer :
// - un seul point d'accès : GET /auth/v1/health, l'état public du service
//   (nom et version, d'après son code source officiel : il ne lit ni n'écrit
//   aucune donnée de personne) ; aucun compte, aucune connexion ;
// - pour la production, la clé PUBLIQUE (« sb_publishable_… ») que le site
//   de production donne déjà à chaque visiteur, lue dans ses fichiers
//   publics ; toute autre clé est refusée ; jamais affichée ;
// - une requête toutes les 5 s par projet, 120 au plus (10 minutes) ;
// - arrêt à la deuxième erreur consécutive d'un projet (réponse autre que
//   200, ou rien en 30 s).
// N'affiche que des heures, des durées et des codes de réponse.
import "dotenv/config";
import { PROD_PROJECT_REF, assertDevSupabaseUrl } from "./lib/dev-database.js";

const SITE = "https://mon-app-shopping-ia-web.onrender.com";
const INTERVALLE_MS = 5_000;
const REQUETES_MAX = 120;
const ABANDON_MS = 30_000;
const LENT_MS = 3_000;
const CLE_PUBLIQUE = /^sb_publishable_[A-Za-z0-9_-]+$/;

interface Projet {
  nom: string;
  sante: string;
  cle: string;
  durees: number[];
  erreurs: number;
  erreursDeSuite: number;
  lents: string[];
}

const heureDeParis = () => new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });

/** Adresse et clé publique de la production, lues dans les fichiers publics du site. */
async function production(): Promise<Projet> {
  const page = await (await fetch(`${SITE}/`)).text();
  const scripts = [...page.matchAll(/\/_expo\/static\/js\/web\/[^"]+\.js/g)].map((m) => m[0]);
  for (const script of scripts) {
    const code = await (await fetch(`${SITE}${script}`)).text();
    const adresse = code.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/);
    const cle = code.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
    if (adresse && cle) {
      if (adresse[1] !== PROD_PROJECT_REF) throw new Error("Le site ne vise pas le projet de production attendu : arrêt.");
      if (!CLE_PUBLIQUE.test(cle)) throw new Error("Clé non publique : refusée.");
      return { nom: "Production", sante: `${adresse[0]}/auth/v1/health`, cle, durees: [], erreurs: 0, erreursDeSuite: 0, lents: [] };
    }
  }
  throw new Error("Adresse ou clé publique introuvable dans le site de production : arrêt.");
}

function spottoDev(): Projet {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL").origin;
  const cle = process.env.SUPABASE_ANON_KEY ?? "";
  if (!CLE_PUBLIQUE.test(cle)) throw new Error("Clé publique de spotto-dev absente ou non publique : refusée.");
  return { nom: "spotto-dev", sante: `${url}/auth/v1/health`, cle, durees: [], erreurs: 0, erreursDeSuite: 0, lents: [] };
}

async function interroger(projet: Projet): Promise<void> {
  const debut = performance.now();
  let code: number | null = null;
  try {
    const reponse = await fetch(projet.sante, { headers: { apikey: projet.cle }, signal: AbortSignal.timeout(ABANDON_MS) });
    await reponse.arrayBuffer(); // contenu ignoré : nom et version du service
    code = reponse.status;
  } catch {
    code = null;
  }
  const ms = performance.now() - debut;
  if (code === 200) {
    projet.durees.push(ms);
    projet.erreursDeSuite = 0;
    if (ms > LENT_MS) projet.lents.push(`${heureDeParis()}  ${(ms / 1000).toFixed(1)} s`);
  } else {
    projet.erreurs += 1;
    projet.erreursDeSuite += 1;
    projet.lents.push(`${heureDeParis()}  ${code === null ? `sans réponse en ${ABANDON_MS / 1000} s` : `réponse ${code}`}`);
  }
}

function bilan(p: Projet): string {
  const tri = [...p.durees].sort((a, b) => a - b);
  const ms = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v)} ms`);
  const rang = (q: number) => tri[Math.min(tri.length - 1, Math.floor(q * (tri.length - 1)))];
  return [
    `${p.nom.padEnd(11)} ${String(tri.length).padStart(3)} réponses  médiane ${ms(rang(0.5)).padStart(7)}  95 % sous ${ms(rang(0.95)).padStart(7)}  max ${ms(tri.at(-1)).padStart(8)}  erreurs ${p.erreurs}`,
    ...(p.lents.length > 0 ? p.lents.map((l) => `    plus de ${LENT_MS / 1000} s ou erreur : ${l}`) : [`    aucune réponse de plus de ${LENT_MS / 1000} s`]),
  ].join("\n");
}

async function main() {
  const projets = [await production(), spottoDev()];
  console.log(`Mesure de GET /auth/v1/health, toutes les ${INTERVALLE_MS / 1000} s, ${REQUETES_MAX} fois au plus, depuis ${heureDeParis()} (heure de Paris)…`);
  for (let n = 0; n < REQUETES_MAX; n += 1) {
    const tour = Date.now();
    await Promise.all(projets.map(interroger));
    const arret = projets.find((p) => p.erreursDeSuite >= 2);
    if (arret) {
      console.log(`Arrêt : deux erreurs de suite pour ${arret.nom}.`);
      break;
    }
    if (n < REQUETES_MAX - 1) await new Promise((resolve) => setTimeout(resolve, Math.max(0, INTERVALLE_MS - (Date.now() - tour))));
  }
  console.log(`Fin à ${heureDeParis()}.`);
  for (const projet of projets) console.log(bilan(projet));
}

main().catch((error: unknown) => {
  console.error(`Mesure impossible : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
