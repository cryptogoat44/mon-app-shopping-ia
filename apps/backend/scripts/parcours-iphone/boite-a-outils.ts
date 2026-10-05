// Vérification de l'app iPhone sur le simulateur (lot 3bis) — boîte à outils.
// Même esprit que parcours-ecran (site) :
// - refuse de tourner si le serveur ou l'app ne visent pas spotto-dev ;
// - démarre le serveur local avec une clé SerpApi volontairement invalide
//   (aucun crédit) et Metro (code de l'app servi au simulateur) ;
// - comptes de test SANS mot de passe : la session est ouverte par le lien
//   « mot de passe oublié » (jetons générés par l'administration de
//   spotto-dev, gardés en mémoire, jamais affichés ni écrits dans un
//   fichier) — aucune saisie d'identifiant dans l'app. Ce lien est ouvert
//   par l'outil lui-même : Maestro, qui consigne ses commandes dans ses
//   journaux, ne le voit jamais ;
// - comptes toujours supprimés à la fin, même en cas d'échec ou d'arrêt.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import { assertDevSupabaseUrl } from "../lib/dev-database.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const ROOT = resolve(HERE, "../../../..");
const BACKEND_DIR = join(ROOT, "apps/backend");
const MOBILE_DIR = join(ROOT, "apps/mobile");
export const API_PORT = 3000;
export const METRO_PORT = 8081;
export const BUNDLE_ID = "com.spottoapp.ios";
/** Ouvre l'app de développement sur le code servi par Metro. */
export const LIEN_DEV_CLIENT = `exp+spotto://expo-development-client/?url=${encodeURIComponent(`http://localhost:${METRO_PORT}`)}`;
const XCODE = "/Applications/Xcode.app/Contents/Developer";
const JAVA_HOME = "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home";

/** Variables d'environnement des outils Apple et de Maestro (sans sudo ni réglage du Mac). */
export const OUTILS_ENV = {
  ...process.env,
  DEVELOPER_DIR: XCODE,
  JAVA_HOME,
  PATH: `${JAVA_HOME}/bin:${process.env.PATH ?? ""}`,
  MAESTRO_CLI_NO_ANALYTICS: "1",
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
};

export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export interface Compte {
  id: string;
  email: string;
  username: string;
  displayName: string;
  /** Jeton d'une session de l'administration, pour préparer les données (jamais affiché). */
  jeton: string;
}

export interface Outils {
  udid: string;
  apiUrl: string;
  admin: SupabaseClient;
  sortie: string;
  creerCompte(label: string, displayName: string): Promise<Compte>;
  /** Lien « mot de passe oublié » qui ouvre une session dans l'app (jetons frais, jamais affichés). */
  lienSession(compte: Compte): Promise<string>;
  api(compte: Compte, method: string, path: string, body?: unknown): Promise<Response>;
  xcrun(args: string[]): string;
  /** Ouvre un lien dans le simulateur (jamais transmis à Maestro ni affiché). */
  ouvrirLien(lien: string): void;
  /** Relance l'app sur le code servi par Metro, sans le menu de développement. */
  relancerApp(): void;
}

export function xcrun(args: string[]): string {
  const r = spawnSync("xcrun", args, { env: OUTILS_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`xcrun ${args.slice(0, 3).join(" ")} a échoué : ${(r.stderr || r.stdout).slice(-300)}`);
  return r.stdout;
}

/** Simulateur iPhone démarré, avec l'app de développement installée. */
function simulateur(): string {
  const listes = JSON.parse(xcrun(["simctl", "list", "devices", "booted", "-j"])) as { devices: Record<string, { udid: string; name: string }[]> };
  const iphone = Object.values(listes.devices).flat().find((d) => d.name.startsWith("iPhone"));
  if (!iphone) throw new Error("Aucun simulateur iPhone démarré (ouvrez Simulator).");
  xcrun(["simctl", "get_app_container", iphone.udid, BUNDLE_ID]);
  return iphone.udid;
}

async function attendre(url: string, contient: string, delaiMs: number): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    const texte = await fetch(url).then((r) => r.text()).catch(() => "");
    if (texte.includes(contient)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Pas de réponse de ${url}`);
}

async function portLibre(port: number): Promise<boolean> {
  return fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) }).then(() => false, () => true);
}

function verifierEnvironnement(): { mobileEnv: Record<string, string> } {
  loadEnv({ path: join(BACKEND_DIR, ".env") });
  const mobileEnv = loadEnv({ path: join(MOBILE_DIR, ".env"), processEnv: {} }).parsed ?? {};
  assertDevSupabaseUrl(process.env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  assertDevSupabaseUrl(mobileEnv.EXPO_PUBLIC_SUPABASE_URL, "apps/mobile/.env (EXPO_PUBLIC_SUPABASE_URL)");
  if (mobileEnv.EXPO_PUBLIC_API_URL !== `http://localhost:${API_PORT}`) {
    throw new Error(`apps/mobile/.env doit viser le serveur local (http://localhost:${API_PORT}).`);
  }
  if (!existsSync(XCODE)) throw new Error("Xcode est introuvable dans /Applications.");
  if (spawnSync("maestro", ["--version"], { env: OUTILS_ENV }).status !== 0) throw new Error("Maestro est introuvable (brew install mobile-dev-inc/tap/maestro).");
  return { mobileEnv };
}

/** Serveur local et Metro ; leurs journaux vont dans un dossier temporaire
 * (hors du dépôt), utile pour comprendre un échec. */
function demarrerServeurs(): { serveur: ChildProcess; metro: ChildProcess; journaux: string } {
  const journaux = mkdtempSync(join(tmpdir(), "parcours-iphone-journaux-"));
  const serveur = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(API_PORT), SERPAPI_KEY: "cle-invalide-parcours-iphone" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Metro sans « CI » : sinon il ne recharge pas le code modifié.
  const sansCi: NodeJS.ProcessEnv = { ...OUTILS_ENV };
  delete sansCi.CI;
  const metro = spawn("npx", ["expo", "start", "--dev-client", "--port", String(METRO_PORT)], { cwd: MOBILE_DIR, env: sansCi, stdio: ["ignore", "pipe", "pipe"] });
  for (const [nom, processus] of [["serveur", serveur], ["metro", metro]] as const) {
    const fichier = createWriteStream(join(journaux, `${nom}.log`));
    processus.stdout?.pipe(fichier);
    processus.stderr?.pipe(fichier);
  }
  return { serveur, metro, journaux };
}

async function ouvrirSession(admin: SupabaseClient, anon: SupabaseClient, email: string): Promise<Session> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new Error(`Lien de récupération impossible : ${error?.message ?? "?"}`);
  const verif = await anon.auth.verifyOtp({ type: "recovery", token_hash: hash });
  if (verif.error || !verif.data.session) throw new Error(`Session de test impossible : ${verif.error?.message ?? "?"}`);
  return verif.data.session;
}

/** Comptes « à jour » : documents acceptés, choix « statistiques » (refus) enregistré. */
async function accepterDocuments(admin: SupabaseClient, id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("consents").insert([
    { user_id: id, type: "terms", granted_at: now, document_version: CONSENT_VERSIONS.terms },
    { user_id: id, type: "age_declaration", granted_at: now, document_version: CONSENT_VERSIONS.age_declaration },
    { user_id: id, type: "privacy_policy", granted_at: now, document_version: CONSENT_VERSIONS.privacy_policy },
    { user_id: id, type: "analytics", revoked_at: now, document_version: CONSENT_VERSIONS.analytics },
  ]);
  if (error) throw new Error(`Acceptations du compte de test impossibles : ${error.message}`);
}

/** Lance un parcours sur le simulateur ; tout ce qui a été créé est nettoyé ensuite, quoi qu'il arrive. */
export async function lancerParcours(sortieNom: string, scenario: (o: Outils) => Promise<void>): Promise<void> {
  verifierEnvironnement();
  for (const port of [API_PORT, METRO_PORT]) {
    if (!(await portLibre(port))) throw new Error(`Le port ${port} est déjà utilisé : arrêtez ce qui tourne dessus, puis relancez.`);
  }
  const udid = simulateur();
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const apiUrl = `http://localhost:${API_PORT}`;
  const sortie = join(ROOT, "docs", sortieNom);
  mkdirSync(sortie, { recursive: true });
  const comptes: Compte[] = [];
  const { serveur, metro, journaux } = demarrerServeurs();
  let nettoye = false;

  const nettoyer = async () => {
    if (nettoye) return;
    nettoye = true;
    log("Nettoyage…");
    for (const compte of comptes) {
      const res = await fetch(`${apiUrl}/api/me`, { method: "DELETE", headers: { authorization: `Bearer ${compte.jeton}` } }).catch(() => null);
      if (!res || !(res.ok || res.status === 204)) await admin.auth.admin.deleteUser(compte.id).catch(() => {});
      const { data } = await admin.auth.admin.getUserById(compte.id);
      log(data?.user ? `  ⚠ compte ${compte.username} NON supprimé — à supprimer à la main` : `  compte ${compte.username} supprimé`);
    }
    spawnSync("xcrun", ["simctl", "terminate", udid, BUNDLE_ID], { env: OUTILS_ENV });
    serveur.kill("SIGTERM");
    metro.kill("SIGTERM");
  };
  const surSignal = () => {
    nettoyer().finally(() => process.exit(1));
  };
  process.once("SIGINT", surSignal);
  process.once("SIGTERM", surSignal);

  const outils: Outils = {
    udid,
    apiUrl,
    admin,
    sortie,
    async creerCompte(label, displayName) {
      const suffixe = randomBytes(3).toString("hex");
      const email = `iphone-${label}-${suffixe}@example.com`;
      const username = `iphone_${label}_${suffixe}`.slice(0, 20);
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new Error(`Création du compte de test impossible : ${error?.message ?? "?"}`);
      const compte: Compte = { id: data.user.id, email, username, displayName, jeton: "" };
      comptes.push(compte);
      await admin.from("profiles").update({ username, display_name: displayName }).eq("id", compte.id);
      await accepterDocuments(admin, compte.id);
      compte.jeton = (await ouvrirSession(admin, anon, email)).access_token;
      log(`  compte de test créé : ${username} (${displayName}), sans mot de passe`);
      return compte;
    },
    async lienSession(compte) {
      const session = await ouvrirSession(admin, anon, compte.email);
      const params = new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: String(session.expires_in),
        token_type: "bearer",
        type: "recovery",
      });
      return `spotto://nouveau-mot-de-passe#${params.toString()}`;
    },
    async api(compte, method, path, body) {
      const isForm = body instanceof FormData;
      return fetch(`${apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${compte.jeton}`, ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    },
    xcrun,
    ouvrirLien(lien) {
      // Pas de xcrun() : son message d'erreur pourrait reprendre le lien.
      const r = spawnSync("xcrun", ["simctl", "openurl", udid, lien], { env: OUTILS_ENV, stdio: "ignore" });
      if (r.status !== 0) throw new Error("Ouverture du lien dans le simulateur impossible.");
    },
    relancerApp() {
      spawnSync("xcrun", ["simctl", "terminate", udid, BUNDLE_ID], { env: OUTILS_ENV });
      // Menu de développement : ni bouton flottant, ni présentation (captures propres).
      for (const [cle, valeur] of [["EXDevMenuShowFloatingActionButton", "NO"], ["EXDevMenuIsOnboardingFinished", "YES"]] as const) {
        xcrun(["simctl", "spawn", udid, "defaults", "write", BUNDLE_ID, cle, "-bool", valeur]);
      }
      xcrun(["simctl", "openurl", udid, LIEN_DEV_CLIENT]);
    },
  };

  try {
    log(`Parcours iPhone — simulateur ${udid}, spotto-dev uniquement, aucun crédit SerpApi.`);
    log(`  journaux du serveur local et de Metro : ${journaux}`);
    await attendre(`${apiUrl}/health`, "ok", 60_000);
    await attendre(`http://localhost:${METRO_PORT}/status`, "packager-status:running", 90_000);
    await scenario(outils);
    log(`Parcours terminé. Captures : docs/${sortieNom}/`);
  } finally {
    await nettoyer();
  }
}

/** Lance un fichier de parcours Maestro. Ses captures sont copiées dans
 * `sortie` (celle d'un échec : ECHEC-<capture ou parcours>.png) ; ses
 * journaux restent dans un dossier temporaire, supprimé aussitôt. */
export function maestro(udid: string, fichier: string, sortie: string, variables: Record<string, string> = {}): void {
  const travail = mkdtempSync(join(tmpdir(), "parcours-iphone-maestro-"));
  const nom = variables.CAPTURE ?? (variables.PREFIXE ? `${variables.PREFIXE}-${basename(fichier, ".yaml")}` : basename(fichier, ".yaml"));
  try {
    const args = ["--device", udid, "test", fichier, "--test-output-dir", travail];
    for (const [cle, valeur] of Object.entries(variables)) args.push("-e", `${cle}=${valeur}`);
    const r = spawnSync("maestro", args, { cwd: travail, env: OUTILS_ENV, encoding: "utf8" });
    // Maestro range les captures demandées dans « takeScreenshot » ; les autres
    // accompagnent une étape non aboutie (y compris une attente facultative) :
    // gardées seulement si le parcours échoue (la dernière, par ordre d'étape).
    for (const capture of readdirSync(travail, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".png")).sort()) {
      if (capture.includes("/takeScreenshot/")) copyFileSync(join(travail, capture), join(sortie, basename(capture)));
      else if (r.status !== 0) copyFileSync(join(travail, capture), join(sortie, `ECHEC-${nom}.png`));
    }
    const resume = (r.stdout ?? "").split("\n").filter((l) => /COMPLETED|FAILED|WARNED/.test(l)).map((l) => `    ${l.trim()}`);
    log(resume.join("\n"));
    if (r.status !== 0) throw new Error(`Parcours Maestro « ${nom} » en échec :\n${(r.stdout ?? "").split("\n").filter((l) => /FAILED|Element not found|Assertion|Invalid|Error/.test(l)).slice(0, 5).join("\n")}`);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}
