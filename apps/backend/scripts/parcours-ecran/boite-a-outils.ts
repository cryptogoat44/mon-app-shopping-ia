// Boîte à outils du parcours à l'écran (Lot F) : réutilisable pour chaque lot.
//
// - refuse de s'exécuter si le serveur ou le site ne visent pas spotto-dev
//   (même protection que migrer-dev) ;
// - crée des comptes de test dont les mots de passe sont générés ici, gardés
//   en mémoire seulement : jamais affichés, jamais écrits dans un fichier ;
// - démarre le serveur local (clé SerpApi volontairement invalide : aucun
//   crédit ne peut être consommé) et le site local compilé ;
// - pilote un Chrome invisible au format iPhone et enregistre les captures ;
// - supprime TOUJOURS les comptes à la fin, même en cas d'échec ou de Ctrl+C.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { assertDevSupabaseUrl } from "../lib/dev-database.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BACKEND_DIR = join(ROOT, "apps/backend");
const MOBILE_DIR = join(ROOT, "apps/mobile");
const API_PORT = 3000;
const SITE_PORT = 8090;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Format iPhone (écran de 390 × 844 points, captures en 2×).
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "fr-FR",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

export interface TestAccount {
  id: string;
  email: string;
  username: string;
  displayName: string;
  /** Jeton de session, pour préparer des données par l'API (jamais affiché). */
  token: string;
  /** Mot de passe généré : privé à ce module, jamais exposé ni journalisé. */
  readonly signIn: (page: Page) => Promise<void>;
}

export interface Parcours {
  siteUrl: string;
  apiUrl: string;
  outputDir: string;
  createAccount(label: string, displayName: string): Promise<TestAccount>;
  newPhone(): Promise<Page>;
  capture(page: Page, name: string): Promise<void>;
  api(account: TestAccount, method: string, path: string, body?: unknown): Promise<Response>;
  step<T>(title: string, fn: () => Promise<T>): Promise<T>;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const attempt = () => {
      fetch(url)
        .then((r) => (r.ok ? resolvePromise() : retry()))
        .catch(retry);
    };
    const retry = () => (Date.now() > deadline ? reject(new Error(`Pas de réponse de ${url}`)) : setTimeout(attempt, 500));
    attempt();
  });
}

async function portFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

// Site compilé servi localement : « /x » → x.html, « /a/<id> » → a/[id].html.
function serveStatic(dir: string, port: number): Promise<Server> {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };
  const resolveFile = (pathname: string): string | null => {
    const clean = decodeURIComponent(pathname).replace(/\/+$/, "") || "/index";
    const candidates = [join(dir, clean), join(dir, `${clean}.html`), join(dir, clean, "index.html")];
    const segments = clean.split("/");
    candidates.push(join(dir, `${segments.slice(0, -1).join("/")}/[id].html`));
    for (const file of candidates) {
      if (file.startsWith(dir) && existsSync(file) && statSync(file).isFile()) return file;
    }
    return null;
  };
  const server = createServer((req, res) => {
    const file = resolveFile(new URL(req.url ?? "/", "http://localhost").pathname);
    if (!file) {
      res.writeHead(404).end("introuvable");
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolvePromise) => server.listen(port, "127.0.0.1", () => resolvePromise(server)));
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} a échoué : ${stderr.slice(-400)}`))));
  });
}

/** Lance un parcours. `scenario` reçoit la boîte à outils ; tout ce qui a
 * été créé est nettoyé ensuite, quoi qu'il arrive. */
export async function runParcours(name: string, outputDirName: string, scenario: (p: Parcours) => Promise<void>): Promise<void> {
  loadEnv({ path: join(BACKEND_DIR, ".env") });
  const mobileEnv = loadEnv({ path: join(MOBILE_DIR, ".env"), processEnv: {} }).parsed ?? {};

  // 1. Protection : serveur ET site doivent viser spotto-dev.
  assertDevSupabaseUrl(process.env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  assertDevSupabaseUrl(mobileEnv.EXPO_PUBLIC_SUPABASE_URL, "apps/mobile/.env (EXPO_PUBLIC_SUPABASE_URL)");
  if (mobileEnv.EXPO_PUBLIC_API_URL !== `http://localhost:${API_PORT}`) {
    throw new Error(`apps/mobile/.env doit viser le serveur local (http://localhost:${API_PORT}).`);
  }
  if (!existsSync(CHROME)) throw new Error("Google Chrome est introuvable dans /Applications.");
  for (const port of [API_PORT, SITE_PORT]) {
    if (!(await portFree(port))) throw new Error(`Le port ${port} est déjà utilisé : arrêtez ce qui tourne dessus, puis relancez.`);
  }

  const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const anon: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  const accounts: TestAccount[] = [];
  let backend: ChildProcess | null = null;
  let site: Server | null = null;
  let browser: Browser | null = null;
  const contexts: BrowserContext[] = [];
  const buildDir = mkdtempSync(join(tmpdir(), "parcours-ecran-"));
  const outputDir = resolve(ROOT, "docs", outputDirName);
  mkdirSync(outputDir, { recursive: true });
  const apiUrl = `http://localhost:${API_PORT}`;
  const siteUrl = `http://localhost:${SITE_PORT}`;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    log("Nettoyage…");
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    // Suppression des comptes par l'app elle-même (« Supprimer mon compte ») :
    // fichiers, publications, commentaires… ; à défaut, par l'administration.
    for (const account of accounts) {
      let deleted = false;
      if (backend) {
        const res = await fetch(`${apiUrl}/api/me`, { method: "DELETE", headers: { authorization: `Bearer ${account.token}` } }).catch(() => null);
        deleted = Boolean(res && (res.ok || res.status === 204));
      }
      if (!deleted) await admin.auth.admin.deleteUser(account.id).catch(() => {});
      const { data } = await admin.auth.admin.getUserById(account.id);
      log(data?.user ? `  ⚠ compte ${account.username} NON supprimé — à supprimer à la main` : `  compte ${account.username} supprimé`);
    }
    site?.close();
    backend?.kill("SIGTERM");
    rmSync(buildDir, { recursive: true, force: true });
  };
  const onSignal = () => {
    cleanup().finally(() => process.exit(1));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    log(`Parcours « ${name} » — spotto-dev uniquement, aucun crédit SerpApi.`);
    log("Compilation du site local (≈ 1 min)…");
    await run("npx", ["expo", "export", "--platform", "web", "--output-dir", buildDir], MOBILE_DIR);
    site = await serveStatic(buildDir, SITE_PORT);

    log("Démarrage du serveur local…");
    backend = spawn("npx", ["tsx", "src/server.ts"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(API_PORT), SERPAPI_KEY: "cle-invalide-parcours-ecran" },
      stdio: "ignore",
    });
    await waitForUrl(`${apiUrl}/health`, 60_000);

    browser = await chromium.launch({ executablePath: CHROME, headless: true });

    const toolkit: Parcours = {
      siteUrl,
      apiUrl,
      outputDir,
      async createAccount(label, displayName) {
        const suffix = randomBytes(3).toString("hex");
        const email = `ecran-${label}-${suffix}@example.com`;
        const username = `ecran_${label}_${suffix}`.slice(0, 20);
        const password = `${randomBytes(18).toString("base64url")}A1!`; // jamais affiché ni écrit
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) throw new Error(`Création du compte de test impossible : ${error?.message ?? "inconnue"}`);
        const id = data.user.id;
        await admin.from("profiles").update({ username, display_name: displayName }).eq("id", id);
        const session = await anon.auth.signInWithPassword({ email, password });
        if (session.error || !session.data.session) throw new Error("Connexion du compte de test impossible.");
        const account: TestAccount = {
          id,
          email,
          username,
          displayName,
          token: session.data.session.access_token,
          signIn: async (page: Page) => {
            await page.goto(`${siteUrl}/sign-in`);
            await page.getByLabel("Email", { exact: true }).fill(email);
            await page.getByLabel("Mot de passe", { exact: true }).fill(password);
            await page.getByRole("button", { name: "Se connecter" }).click();
            await page.getByText("Retrouvez une pièce vue dans une vidéo ou sur une photo.").waitFor({ timeout: 30_000 });
          },
        };
        accounts.push(account);
        log(`  compte de test créé : ${username} (${displayName})`);
        return account;
      },
      async newPhone() {
        const context = await browser!.newContext(IPHONE);
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: siteUrl });
        contexts.push(context);
        return context.newPage();
      },
      async capture(page, captureName) {
        await page.waitForTimeout(600); // animations et images
        await page.screenshot({ path: join(outputDir, `${captureName}.png`) });
        log(`  📸 ${captureName}.png`);
      },
      async api(account, method, path, body) {
        const isForm = typeof FormData !== "undefined" && body instanceof FormData;
        return fetch(`${apiUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${account.token}`,
            ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
          },
          body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        });
      },
      async step(title, fn) {
        log(`→ ${title}`);
        return fn();
      },
    };

    await scenario(toolkit);
    log(`Parcours terminé. Captures : docs/${outputDirName}/`);
  } catch (error) {
    // Capture de l'écran au moment de l'échec, pour comprendre.
    for (const [index, context] of contexts.entries()) {
      const page = context.pages()[0];
      if (page) await page.screenshot({ path: join(outputDir, `ECHEC-telephone-${index + 1}.png`) }).catch(() => {});
    }
    throw error;
  } finally {
    await cleanup();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
