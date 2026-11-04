// Mesure de la voie C : les ports réels — le serveur local dans un processus
// enfant, spotto-dev-2 (comptes d'essai, compteurs, lignes relues), les
// requêtes HTTP de l'app, les images, les fichiers de sortie. Le déroulé
// (mesure.ts) est testé avec des faux ; ici, seulement le branchement.
// Rien de secret n'est affiché ni écrit : tout texte passe par masquerSecrets.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import { prepareImageForAnalysis } from "../../../src/lib/imageProcessing.js";
import { imageHash } from "../../../src/lib/searchCache.js";
import { SHOPPING_QUERY_AI_SETTINGS } from "../../../src/services/shoppingQueryAi.js";
import { lireEtatLens } from "../essai-pieces.js";
import { supprimerCompteParLApp } from "../suppression-compte-test.js";
import { masquerSecrets } from "./environnement.js";
import { ErreurMesure } from "./jeu-de-verite.js";
import type { CompteEssai, PortsMesure, ServeurLocal } from "./mesure.js";
import { codeErreur, COLONNES_LIGNE, LIGNE_RECHERCHE, lireLigneJournal, type LigneJournal } from "./resultats.js";

export const DOSSIER_BACKEND = fileURLToPath(new URL("../../../", import.meta.url));
/** Le serveur de la mesure : src/server.ts, mais seulement sur cette machine. */
const LANCEUR = fileURLToPath(new URL("./serveur-local.ts", import.meta.url));
/** L'app envoie la langue de l'appareil ; le fondateur utilise l'app en français. */
const LANGUE = "fr";
/** Au-delà, le lancement est abandonné côté outil (le serveur, lui, a son propre budget de 14 s). */
const DELAI_LANCEMENT_MS = 90_000;
const DELAI_DEMARRAGE_MS = 60_000;

const COMPTEURS = z.array(z.object({ day_count: z.number(), month_count: z.number() })).length(1);
const MODELES = z.object({ data: z.array(z.object({ id: z.string() })) });

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ConfigReelle {
  /** Environnement effectif (apps/backend/.env et Terminal), déjà vérifié : spotto-dev-2. */
  environnement: Record<string, string>;
  /** Secrets à masquer ; l'outil y ajoute les jetons et mots de passe des comptes d'essai. */
  secrets: string[];
}

export function portsReels({ environnement, secrets }: ConfigReelle): PortsMesure {
  // Clients créés au premier usage : la garde « spotto-dev-2 seulement » (mesure.ts) passe toujours avant.
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  let clients: { admin: SupabaseClient; anonyme: SupabaseClient } | null = null;
  const supabase = () =>
    (clients ??= {
      admin: createClient(environnement.SUPABASE_URL!, environnement.SUPABASE_SERVICE_ROLE_KEY!, options),
      anonyme: createClient(environnement.SUPABASE_URL!, environnement.SUPABASE_ANON_KEY!, options),
    });
  const masquer = (texte: string) => masquerSecrets(texte, secrets);
  const renouvellement = Number(environnement.SERPAPI_RENEWAL_DAY ?? "3");

  const entete = (compte: CompteEssai, json: boolean): Record<string, string> => ({
    authorization: `Bearer ${compte.jeton}`,
    "accept-language": LANGUE,
    ...(json ? { "content-type": "application/json" } : {}),
  });

  return {
    maintenant: () => Date.now(),
    afficher: (texte) => console.log(masquer(texte)),
    ecrire: (chemin, contenu) => writeFileSync(chemin, typeof contenu === "string" ? masquer(contenu) : contenu),
    creerDossier: (chemin) => mkdirSync(chemin, { recursive: true }),
    etatLens: () => lireEtatLens(),
    attendre,

    async verifierCleAnthropic(cle) {
      const reponse = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
        headers: { "x-api-key": cle, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (!reponse) return "Anthropic injoignable";
      if (!reponse.ok) return `clé refusée par Anthropic (réponse ${reponse.status})`;
      const liste = MODELES.safeParse(await reponse.json().catch(() => null));
      if (!liste.success) return "réponse inattendue d'Anthropic";
      return liste.data.data.some((modele) => modele.id === SHOPPING_QUERY_AI_SETTINGS.model) ? null : `modèle ${SHOPPING_QUERY_AI_SETTINGS.model} absent pour cette clé`;
    },

    async lireCompteurs() {
      // Lecture seule (p_reserve faux) : rien n'est réservé ; le compte demandé
      // n'existe pas, seuls les compteurs du jour et du cycle servent.
      const { data, error } = await supabase().admin.rpc("serpapi_quota", {
        p_daily_cap: 1_000_000,
        p_monthly_cap: 1_000_000,
        p_user_daily_cap: 1_000_000,
        p_renewal_day: Number.isInteger(renouvellement) ? renouvellement : 3,
        p_user_id: randomUUID(),
        p_reserve: false,
        p_exclude_search: null,
      });
      const lu = COMPTEURS.safeParse(data);
      if (error || !lu.success) throw new ErreurMesure("Compteurs de spotto-dev-2 illisibles (serpapi_quota) : arrêt avant toute dépense.");
      return { jour: lu.data[0]!.day_count, mois: lu.data[0]!.month_count };
    },

    portLibre: () =>
      new Promise((resolve, reject) => {
        const serveur = createServer();
        serveur.once("error", reject);
        serveur.listen(0, "127.0.0.1", () => {
          const adresse = serveur.address();
          serveur.close(() => (typeof adresse === "object" && adresse ? resolve(adresse.port) : reject(new Error("port introuvable"))));
        });
      }),

    async demarrerServeur(env) {
      // Processus à part (detached) : Ctrl-C n'atteint que l'outil, qui supprime
      // d'abord les comptes par l'app, puis arrête le serveur. Si l'outil
      // disparaît, l'entrée standard du serveur se ferme et il s'arrête seul.
      const enfant = spawn(process.execPath, ["--import", "tsx", LANCEUR], { cwd: DOSSIER_BACKEND, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
      const tuer = () => {
        if (enfant.exitCode === null && enfant.signalCode === null) enfant.kill("SIGKILL");
      };
      process.on("exit", tuer);
      const journal: LigneJournal[] = [];
      const derniersMessages: string[] = [];
      createInterface({ input: enfant.stdout! }).on("line", (ligne) => {
        const gardee = lireLigneJournal(ligne);
        if (gardee) journal.push(gardee);
      });
      createInterface({ input: enfant.stderr! }).on("line", (ligne) => {
        derniersMessages.push(masquer(ligne).slice(0, 300));
        if (derniersMessages.length > 15) derniersMessages.shift();
      });
      const termine = new Promise<void>((resolve) => enfant.once("exit", () => resolve()));
      const url = `http://127.0.0.1:${env.PORT}`;
      const arreter = async () => {
        if (enfant.exitCode === null && enfant.signalCode === null) {
          enfant.kill("SIGTERM");
          const force = setTimeout(tuer, 5000);
          await termine;
          clearTimeout(force);
        }
        process.off("exit", tuer);
      };
      const limite = Date.now() + DELAI_DEMARRAGE_MS;
      for (;;) {
        if (enfant.exitCode !== null || enfant.signalCode !== null) {
          process.off("exit", tuer);
          throw new ErreurMesure(`Le serveur local s'est arrêté au démarrage.${derniersMessages.length > 0 ? ` Ses derniers messages : ${derniersMessages.join(" | ")}` : ""}`);
        }
        const sante = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
        if (sante?.ok) break;
        if (Date.now() > limite) {
          await arreter();
          throw new ErreurMesure("Le serveur local ne répond pas après 60 s.");
        }
        await attendre(300);
      }
      const serveur: ServeurLocal = { url, journal, arreter };
      return serveur;
    },

    async creerCompte(numero) {
      const suffixe = randomBytes(4).toString("hex");
      // @example.com : un compte oublié est retrouvé par nettoyer-comptes-test-dev.
      const email = `mesure-voie-c-${suffixe}@example.com`;
      const motDePasse = `${randomBytes(18).toString("base64url")}A1!`;
      secrets.push(motDePasse);
      const cree = await supabase().admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
      if (cree.error || !cree.data.user) throw new ErreurMesure(`Création du compte d'essai impossible (${cree.error?.code ?? cree.error?.status ?? "raison inconnue"}).`);
      const id = cree.data.user.id;
      try {
        const profil = await supabase().admin.from("profiles").update({ username: `mvc_${suffixe}`, display_name: `Mesure voie C ${numero}` }).eq("id", id);
        if (profil.error) throw new ErreurMesure("Profil du compte d'essai impossible.");
        // Comme un vrai compte : conditions, confidentialité et âge acceptés,
        // statistiques refusées. La recherche, elle, n'exige aucun consentement.
        const maintenant = new Date().toISOString();
        const accords = await supabase().admin.from("consents").insert([
          { user_id: id, type: "terms", granted_at: maintenant, document_version: CONSENT_VERSIONS.terms },
          { user_id: id, type: "privacy_policy", granted_at: maintenant, document_version: CONSENT_VERSIONS.privacy_policy },
          { user_id: id, type: "age_declaration", granted_at: maintenant, document_version: CONSENT_VERSIONS.age_declaration },
          { user_id: id, type: "analytics", revoked_at: maintenant, document_version: CONSENT_VERSIONS.analytics },
        ]);
        if (accords.error) throw new ErreurMesure("Acceptations du compte d'essai impossibles.");
        const session = await supabase().anonyme.auth.signInWithPassword({ email, password: motDePasse });
        if (session.error || !session.data.session) throw new ErreurMesure("Connexion du compte d'essai impossible.");
        secrets.push(session.data.session.access_token);
        return { numero, id, jeton: session.data.session.access_token };
      } catch (erreur) {
        await supabase().admin.auth.admin.deleteUser(id).catch(() => undefined);
        throw erreur;
      }
    },

    async supprimerCompte(compte, serveur) {
      // Par l'app d'abord (« Supprimer mon compte » : fichiers compris) ; sinon par l'administration.
      const parLApp = serveur ? await supprimerCompteParLApp(serveur.url, supabase().admin, { id: compte.id, jeton: compte.jeton }) : false;
      if (!parLApp) {
        const fichiers = await supabase().admin.storage.from("screenshots").list(compte.id);
        if (fichiers.data && fichiers.data.length > 0) await supabase().admin.storage.from("screenshots").remove(fichiers.data.map((f) => `${compte.id}/${f.name}`));
        await supabase().admin.auth.admin.deleteUser(compte.id);
      }
      const reste = await supabase().admin.auth.admin.getUserById(compte.id);
      const recherches = await supabase().admin.from("product_searches").select("id", { count: "exact", head: true }).eq("user_id", compte.id);
      return !reste.data?.user && !recherches.error && (recherches.count ?? 0) === 0;
    },

    async preparer(serveur, compte) {
      const reponse = await fetch(`${serveur.url}/api/searches/prepare`, { method: "POST", headers: entete(compte, true), body: "{}", signal: AbortSignal.timeout(30_000) });
      const corps: unknown = await reponse.json().catch(() => null);
      const id = typeof corps === "object" && corps !== null ? (corps as { id?: unknown }).id : null;
      return { statut: reponse.status, id: reponse.ok && typeof id === "string" ? id : null, erreur: reponse.ok ? null : (codeErreur(corps) ?? `réponse ${reponse.status}`) };
    },

    async sonderVoieC(serveur, compte, id) {
      const reponse = await fetch(`${serveur.url}/api/searches/${id}/text`, { method: "POST", headers: entete(compte, true), body: JSON.stringify({ words: "essai" }), signal: AbortSignal.timeout(30_000) });
      return { statut: reponse.status, erreur: codeErreur(await reponse.json().catch(() => null)) };
    },

    async lancer(serveur, compte, id, envoi) {
      // Même formulaire que l'app (apps/mobile/src/lib/api.ts, runSearch) : le cadre, la photo, puis les mots.
      const formulaire = new FormData();
      if (envoi.cadre) formulaire.append("crop", JSON.stringify(envoi.cadre));
      formulaire.append("file", new Blob([new Uint8Array(envoi.image)], { type: "image/jpeg" }), envoi.nomFichier);
      if (envoi.mots) formulaire.append("query", envoi.mots);
      const debut = Date.now();
      const reponse = await fetch(`${serveur.url}/api/searches/${id}/run`, { method: "POST", headers: entete(compte, false), body: formulaire, signal: AbortSignal.timeout(DELAI_LANCEMENT_MS) });
      const corps: unknown = await reponse.json().catch(() => null);
      return { statut: reponse.status, corps, dureeMs: Date.now() - debut };
    },

    async lireLigne(id) {
      const { data, error } = await supabase().admin.from("product_searches").select(COLONNES_LIGNE).eq("id", id).maybeSingle();
      if (error) return null;
      const lu = LIGNE_RECHERCHE.safeParse(data);
      return lu.success ? lu.data : null;
    },

    async imageCommeLApp(chemin) {
      // Import d'une photo dans l'app (apps/mobile/src/lib/image-import.ts) : 1 600 px au plus, JPEG 0,85.
      const { data, info } = await sharp(readFileSync(chemin))
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      return { jpeg: data, largeur: info.width, hauteur: info.height };
    },

    async zoneAnalysee(jpeg, cadre) {
      const zone = await prepareImageForAnalysis(jpeg, cadre);
      return { zone, empreinte: imageHash(zone) };
    },

    surInterruption(action) {
      const gestion = () => {
        console.log("\nInterruption : suppression des comptes d'essai et arrêt du serveur local…");
        void action().finally(() => process.exit(130));
      };
      process.once("SIGINT", gestion);
      process.once("SIGTERM", gestion);
      return () => {
        process.off("SIGINT", gestion);
        process.off("SIGTERM", gestion);
      };
    },
  };
}
