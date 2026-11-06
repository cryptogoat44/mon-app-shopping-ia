import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  INITIAL_ROBOT_CHECK,
  ROBOT_CHECK_PAGE_PATH,
  ROBOT_MESSAGE_SOURCE,
  TURNSTILE_ORIGIN,
  httpsOrigin,
  isRobotPageUrl,
  isTrustedWebMessage,
  parseRobotMessage,
  robotCheckNavigationAllowed,
  robotCheckPageUrl,
  robotCheckReducer,
  turnstileSiteKey,
  withCaptcha,
  withCaptchaOption,
  type RobotCheckState,
} from "../src/lib/robot-check";
import { isCaptchaError, translateAuthError } from "../src/lib/auth-errors";
import { t } from "../src/i18n";

// Protection anti-robots (point 17) : Cloudflare Turnstile, jeton joint aux
// quatre appels d'authentification. Tout est testé sans réseau ni rendu.
const SITE = "https://mon-app-shopping-ia-web.onrender.com";
const PAGE = `${SITE}${ROBOT_CHECK_PAGE_PATH}?sitekey=1x00000000000000000000AA&lang=fr`;
const message = (value: object) => JSON.stringify({ source: ROBOT_MESSAGE_SOURCE, ...value });

describe("interrupteur : EXPO_PUBLIC_TURNSTILE_SITE_KEY", () => {
  it("absente, vide ou mal formée : protection coupée ; sinon la clé, sans espaces autour", () => {
    expect(turnstileSiteKey(undefined)).toBeNull();
    expect(turnstileSiteKey("")).toBeNull();
    expect(turnstileSiteKey("   ")).toBeNull();
    expect(turnstileSiteKey("cle avec espace")).toBeNull();
    expect(turnstileSiteKey("<script>")).toBeNull();
    expect(turnstileSiteKey(" 0x4AAAAAAAabcDEF_12-xyz ")).toBe("0x4AAAAAAAabcDEF_12-xyz");
  });
});

describe("les appels : sans jeton exactement comme avant, avec jeton captchaToken en plus", () => {
  it("sans clé (jeton null) : le même objet, sans aucun champ ajouté", () => {
    const signIn = { email: "a@exemple.test", password: "secret123" };
    expect(withCaptchaOption(signIn, null)).toBe(signIn);
    expect(withCaptchaOption(signIn, null)).toEqual({ email: "a@exemple.test", password: "secret123" });
    const reset = { redirectTo: "spotto://nouveau-mot-de-passe" };
    expect(withCaptcha(reset, null)).toBe(reset);
    expect(Object.keys(withCaptcha(reset, null))).toEqual(["redirectTo"]);
  });

  it("avec un jeton : transmis dans options.captchaToken, les options existantes gardées", () => {
    expect(withCaptchaOption({ email: "a@exemple.test", password: "x" }, "jeton-1")).toEqual({
      email: "a@exemple.test",
      password: "x",
      options: { captchaToken: "jeton-1" },
    });
    const signUp = { email: "a@exemple.test", password: "x", options: { data: { locale: "fr" } } };
    expect(withCaptchaOption(signUp, "jeton-2")).toEqual({ ...signUp, options: { data: { locale: "fr" }, captchaToken: "jeton-2" } });
    expect(signUp.options).toEqual({ data: { locale: "fr" } });
    expect(withCaptchaOption({ type: "signup" as const, email: "a@exemple.test" }, "jeton-3").options).toEqual({ captchaToken: "jeton-3" });
    expect(withCaptcha({ redirectTo: "https://site/x" }, "jeton-4")).toEqual({ redirectTo: "https://site/x", captchaToken: "jeton-4" });
  });

  it("les quatre écrans passent par ces fonctions, avec le jeton pris au moment de l'appel", () => {
    const source = (file: string) => readFileSync(join(__dirname, "../src", file), "utf8");
    expect(source("app/sign-in.tsx")).toMatch(/signInWithPassword\(withCaptchaOption\(\{ email: email\.trim\(\), password \}, robot\.take\(\)\)\)/);
    expect(source("app/sign-up.tsx")).toMatch(/signUp\(\s*withCaptchaOption\([\s\S]*?options: \{ data: \{ locale: getActiveLocale\(\) \} \},[\s\S]*?robot\.take\(\)\s*\)\s*\)/);
    expect(source("app/mot-de-passe-oublie.tsx")).toMatch(/resetPasswordForEmail\(address, withCaptcha\(\{ redirectTo: recoveryRedirectUrl\(\) \}, robot\.take\(\)\)\)/);
    expect(source("lib/use-resend-confirmation.ts")).toMatch(/resend\(withCaptchaOption\(\{ type: "signup" as const, email: address \}, robot\.take\(\)\)\)/);
    // Le bouton d'envoi attend le jeton.
    for (const file of ["app/sign-in.tsx", "app/sign-up.tsx", "app/mot-de-passe-oublie.tsx", "components/signup-help.tsx"]) {
      expect(source(file), file).toMatch(/!robot(\.r|R)eady/);
    }
  });
});

describe("le jeton : attendu, transmis une fois, puis redemandé", () => {
  const recu = (state: RobotCheckState, token: string) => robotCheckReducer(state, { type: "token", token, generation: state.generation });

  it("avec clé : d'abord en attente, puis prêt quand le widget renvoie un jeton", () => {
    expect(INITIAL_ROBOT_CHECK).toEqual({ generation: 0, token: null, status: "loading" });
    expect(recu(INITIAL_ROBOT_CHECK, "jeton-1")).toEqual({ generation: 0, token: "jeton-1", status: "ready" });
  });

  it("après chaque appel, réussi ou non : jeton oublié et nouveau widget (usage unique)", () => {
    const pret = recu(INITIAL_ROBOT_CHECK, "jeton-1");
    const apres = robotCheckReducer(pret, { type: "used" });
    expect(apres).toEqual({ generation: 1, token: null, status: "loading" });
    expect(recu(apres, "jeton-2")).toEqual({ generation: 1, token: "jeton-2", status: "ready" });
  });

  it("jeton expiré (≈ 300 s) ou défi non résolu : nouveau widget", () => {
    const pret = recu(INITIAL_ROBOT_CHECK, "jeton-1");
    expect(robotCheckReducer(pret, { type: "expired", generation: 0 })).toEqual({ generation: 1, token: null, status: "loading" });
  });

  it("erreur : message et bouton « Réessayer », qui redemande un widget ; un jeton arrivé ensuite reste bon", () => {
    const erreur = robotCheckReducer(INITIAL_ROBOT_CHECK, { type: "error", generation: 0 });
    expect(erreur).toEqual({ generation: 0, token: null, status: "error" });
    expect(robotCheckReducer(erreur, { type: "retry" })).toEqual({ generation: 1, token: null, status: "loading" });
    expect(recu(erreur, "jeton-tardif").status).toBe("ready");
  });

  it("un message d'un ancien widget est ignoré", () => {
    const nouveau = robotCheckReducer(recu(INITIAL_ROBOT_CHECK, "jeton-1"), { type: "used" });
    expect(robotCheckReducer(nouveau, { type: "token", token: "ancien", generation: 0 })).toBe(nouveau);
    expect(robotCheckReducer(nouveau, { type: "expired", generation: 0 })).toBe(nouveau);
  });
});

describe("messages de la page hôte : la forme exacte, rien d'autre", () => {
  it("jeton, expiration, erreur", () => {
    expect(parseRobotMessage(message({ type: "token", token: "0.abc_DEF-123.xyz" }))).toEqual({ type: "token", token: "0.abc_DEF-123.xyz" });
    expect(parseRobotMessage(message({ type: "expired" }))).toEqual({ type: "expired" });
    expect(parseRobotMessage(message({ type: "error" }))).toEqual({ type: "error" });
  });

  it("refusés : autre source, objet au lieu de texte, JSON invalide, jeton vide, avec espaces ou trop long, type inconnu", () => {
    expect(parseRobotMessage(JSON.stringify({ source: "autre", type: "token", token: "x" }))).toBeNull();
    expect(parseRobotMessage({ source: ROBOT_MESSAGE_SOURCE, type: "token", token: "x" })).toBeNull();
    expect(parseRobotMessage("{pas du json")).toBeNull();
    expect(parseRobotMessage("null")).toBeNull();
    expect(parseRobotMessage(message({ type: "token", token: "" }))).toBeNull();
    expect(parseRobotMessage(message({ type: "token", token: "a b" }))).toBeNull();
    expect(parseRobotMessage(message({ type: "token", token: "a\nb" }))).toBeNull();
    expect(parseRobotMessage(message({ type: "token", token: 42 }))).toBeNull();
    expect(parseRobotMessage(message({ type: "token", token: "x".repeat(5000) }))).toBeNull();
    expect(parseRobotMessage(message({ type: "navigate", url: "https://exemple.test" }))).toBeNull();
  });

  it("site : seulement les messages de NOTRE iframe, sur l'origine du site", () => {
    const frame = {};
    expect(isTrustedWebMessage({ origin: SITE, source: frame }, { origin: SITE, source: frame })).toBe(true);
    expect(isTrustedWebMessage({ origin: "https://exemple.test", source: frame }, { origin: SITE, source: frame })).toBe(false);
    expect(isTrustedWebMessage({ origin: SITE, source: {} }, { origin: SITE, source: frame })).toBe(false);
    expect(isTrustedWebMessage({ origin: SITE, source: null }, { origin: SITE, source: null })).toBe(false);
    expect(isTrustedWebMessage({ origin: "null", source: frame }, { origin: SITE, source: frame })).toBe(false);
  });

  it("iPhone : seulement les messages envoyés par la page hôte, sur l'origine du site", () => {
    expect(isRobotPageUrl(PAGE, SITE)).toBe(true);
    expect(isRobotPageUrl(`${SITE}${ROBOT_CHECK_PAGE_PATH}`, SITE)).toBe(true);
    expect(isRobotPageUrl(`${TURNSTILE_ORIGIN}/cdn-cgi/challenge-platform/x`, SITE)).toBe(false);
    expect(isRobotPageUrl(`${SITE}.exemple.test${ROBOT_CHECK_PAGE_PATH}`, SITE)).toBe(false);
    expect(isRobotPageUrl(`${SITE}${ROBOT_CHECK_PAGE_PATH}.exemple`, SITE)).toBe(false);
    expect(isRobotPageUrl(`${SITE}/`, SITE)).toBe(false);
    expect(isRobotPageUrl(undefined, SITE)).toBe(false);
  });
});

describe("vue web (iPhone) : navigation", () => {
  it("en haut : la page hôte seulement ; dans un cadre : le widget de Cloudflare seulement", () => {
    expect(robotCheckNavigationAllowed({ url: PAGE, isTopFrame: true }, SITE)).toBe(true);
    expect(robotCheckNavigationAllowed({ url: PAGE }, SITE)).toBe(true);
    expect(robotCheckNavigationAllowed({ url: `${TURNSTILE_ORIGIN}/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2`, isTopFrame: false }, SITE)).toBe(true);
    expect(robotCheckNavigationAllowed({ url: "about:blank", isTopFrame: false }, SITE)).toBe(true);
  });

  it("refusé : tout le reste (autre page du site, Cloudflare en haut, sosie, autres schémas, autres cadres)", () => {
    for (const url of [
      `${SITE}/`,
      `${SITE}/sign-in`,
      `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`,
      "https://www.cloudflare.com/privacypolicy/",
      `https://mon-app-shopping-ia-web.onrender.com.exemple.test${ROBOT_CHECK_PAGE_PATH}`,
      `http://mon-app-shopping-ia-web.onrender.com${ROBOT_CHECK_PAGE_PATH}`,
      "javascript:alert(1)",
      "tel:0600000000",
      "spotto://nouveau-mot-de-passe",
      "about:blank",
    ]) {
      expect(robotCheckNavigationAllowed({ url, isTopFrame: true }, SITE), url).toBe(false);
    }
    for (const url of ["https://exemple.test/", "https://challenges.cloudflare.com.exemple.test/", `${SITE}/sign-in`, "data:text/html,x"]) {
      expect(robotCheckNavigationAllowed({ url, isTopFrame: false }, SITE), url).toBe(false);
    }
  });

  it("adresse du site : https seulement, origine exacte", () => {
    expect(httpsOrigin("https://Mon-App-Shopping-IA-web.onrender.com/")).toBe(SITE);
    expect(httpsOrigin("https://spotto.app")).toBe("https://spotto.app");
    expect(httpsOrigin("https://spotto.app:8443/x?y")).toBe("https://spotto.app:8443");
    expect(httpsOrigin("http://spotto.app")).toBeNull();
    expect(httpsOrigin("https://pirate.test@spotto.app")).toBeNull();
    expect(httpsOrigin("javascript:alert(1)")).toBeNull();
  });

  it("adresse de la page : clé encodée, langue fr/en, sinon automatique", () => {
    expect(robotCheckPageUrl(SITE, "1x00000000000000000000AA", "fr")).toBe(PAGE);
    expect(robotCheckPageUrl(SITE, "a&b", "en")).toBe(`${SITE}${ROBOT_CHECK_PAGE_PATH}?sitekey=a%26b&lang=en`);
    expect(robotCheckPageUrl(SITE, "k", "fr&x=1")).toBe(`${SITE}${ROBOT_CHECK_PAGE_PATH}?sitekey=k&lang=auto`);
  });
});

describe("page hôte statique (public/verification-robot.html)", () => {
  const publicDir = join(__dirname, "../public");
  const html = readFileSync(join(publicDir, "verification-robot.html"), "utf8");
  const script = readFileSync(join(publicDir, "verification-robot.js"), "utf8");

  it("aucun script écrit dans la page (politique de sécurité du site), aucun secret", () => {
    expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script src="/verification-robot.js">']);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(`${html}${script}`).not.toMatch(/secret/i);
    expect(script).toContain(`"${ROBOT_MESSAGE_SOURCE}"`);
    expect(script).toContain(`"${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=spottoTurnstileLoaded"`);
  });

  /** Exécute le script de la page avec un faux navigateur ; renvoie ce qu'il a envoyé. */
  function runPage(search: string, bridge: "iphone" | "site") {
    const sent: { text: unknown; target?: unknown }[] = [];
    const appended: { src: string; onerror?: () => void }[] = [];
    const window: Record<string, unknown> = { location: { search, origin: SITE } };
    if (bridge === "iphone") window.ReactNativeWebView = { postMessage: (text: string) => sent.push({ text }) };
    else window.parent = { postMessage: (text: string, target: string) => sent.push({ text, target }) };
    const document = { createElement: () => ({}), head: { appendChild: (el: { src: string }) => appended.push(el) } };
    runInNewContext(script, { window, document, URLSearchParams, JSON });
    return { sent, appended, window };
  }

  it("site : le jeton part vers la page parente de même origine, jamais vers « * »", () => {
    const { sent, appended, window } = runPage("?sitekey=1x00000000000000000000AA&lang=fr", "site");
    expect(appended.map((el) => el.src)).toEqual([`${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=spottoTurnstileLoaded`]);
    let options: Record<string, unknown> = {};
    window.turnstile = { render: (_where: string, o: Record<string, unknown>) => (options = o) };
    (window.spottoTurnstileLoaded as () => void)();
    expect(options).toMatchObject({ sitekey: "1x00000000000000000000AA", language: "fr", "refresh-expired": "manual" });
    (options.callback as (token: string) => void)("jeton.abc");
    (options["expired-callback"] as () => void)();
    (options["error-callback"] as () => void)();
    expect(sent.map((m) => m.target)).toEqual([SITE, SITE, SITE]);
    expect(sent.map((m) => parseRobotMessage(m.text))).toEqual([{ type: "token", token: "jeton.abc" }, { type: "expired" }, { type: "error" }]);
  });

  it("iPhone : le jeton part vers l'app ; clé absente ou piégée : erreur, et rien n'est chargé", () => {
    const { sent, window } = runPage("?sitekey=1x00000000000000000000AA&lang=en", "iphone");
    let options: Record<string, unknown> = {};
    window.turnstile = { render: (_where: string, o: Record<string, unknown>) => (options = o) };
    (window.spottoTurnstileLoaded as () => void)();
    (options.callback as (token: string) => void)("jeton.xyz");
    expect(sent.map((m) => parseRobotMessage(m.text))).toEqual([{ type: "token", token: "jeton.xyz" }]);
    for (const search of ["", "?sitekey=%3Cscript%3E", "?sitekey=a%20b"]) {
      const page = runPage(search, "iphone");
      expect(page.appended).toEqual([]);
      expect(page.sent.map((m) => parseRobotMessage(m.text))).toEqual([{ type: "error" }]);
    }
  });

  it("script de Cloudflare impossible à charger : erreur", () => {
    const { sent, appended } = runPage("?sitekey=k&lang=fr", "site");
    appended[0].onerror?.();
    expect(sent.map((m) => parseRobotMessage(m.text))).toEqual([{ type: "error" }]);
  });
});

describe("refus de Supabase", () => {
  it("jeton anti-robots refusé : message clair, traduit", () => {
    expect(isCaptchaError("captcha protection: request disallowed (invalid-input-response)")).toBe(true);
    expect(translateAuthError("captcha protection: request disallowed (timeout-or-duplicate)")).toBe(t.robotCheck.rejected);
    expect(isCaptchaError("Invalid login credentials")).toBe(false);
  });
});
