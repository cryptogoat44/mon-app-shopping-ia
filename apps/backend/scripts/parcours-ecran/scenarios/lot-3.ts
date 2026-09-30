// Lot 3 — langues et mode sombre.
//
//   pnpm --filter backend parcours-ecran lot-3
//
// Tous les écrans principaux, dans les 4 combinaisons (français clair,
// français sombre, anglais clair, anglais sombre). Sur chaque écran, le
// texte visible ET les libellés lus par les lecteurs d'écran sont examinés :
// aucun mot français en anglais, aucun mot anglais en français. Les données
// de test sont volontairement neutres (« Kelly 28 », « ✦✦✦ »).
//
// Combinaisons : l'anglais vient de la langue du navigateur (en-GB, détection
// automatique) ; le sombre vient une fois de l'appareil (« Système »), une
// fois d'un choix explicite. Puis, dans les Réglages : changement de langue
// et d'apparence sans quitter l'écran, enregistrement dans le profil, et
// événements language_changed / theme_changed (clé PostHog FACTICE, envois
// interceptés : rien ne sort).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "playwright-core";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";

export const name = "Lot 3 — langues et mode sombre";
export const outputDir = "lot-3-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

type Locale = "fr" | "en";
type Words = Record<Locale, string>;

interface Combo {
  id: string;
  locale: Locale;
  browserLocale: string;
  deviceScheme: "light" | "dark";
  /** Préférence enregistrée dans l'app (absente : « Système »). */
  preference?: "light" | "dark";
  expected: "light" | "dark";
}

const COMBOS: Combo[] = [
  { id: "fr-clair", locale: "fr", browserLocale: "fr-FR", deviceScheme: "light", expected: "light" },
  { id: "fr-sombre", locale: "fr", browserLocale: "fr-FR", deviceScheme: "dark", expected: "dark" },
  { id: "en-clair", locale: "en", browserLocale: "en-GB", deviceScheme: "dark", preference: "light", expected: "light" },
  { id: "en-sombre", locale: "en", browserLocale: "en-GB", deviceScheme: "light", preference: "dark", expected: "dark" },
];

const BACKGROUND = { light: "rgb(251, 251, 250)", dark: "rgb(20, 19, 18)" };

// Mots qui trahissent l'autre langue (texte visible et libellés d'accessibilité).
const FRENCH = /[àâçéèêëîïôûùœ«»]|\b(vous|votre|vos|le|la|les|des|une|du|et|pour|avec|sur|dans|Réglages|Retour|Fil|Profil|Envies|Publier|Suivre|Rechercher|Annuler|Fermer)\b/i;
const ENGLISH = /\b(the|and|your|you|with|from|Settings|Back|Feed|Profile|Search|Sign in|Try again|Wishlist|Follow|Share|Cancel|Close|Post)\b/;
// Noms de langue du sélecteur : chacun est écrit dans sa propre langue.
const LANGUAGE_NAMES = ["Français", "English"];

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

/** Coordonnées de l'éditeur (variables du site) : écartées de l'analyse,
 * jamais affichées. Ce sont les mêmes valeurs dans les deux langues. */
function publisherValues(): string[] {
  const env = readFileSync(join(process.cwd(), "../mobile/.env"), "utf8");
  return [...env.matchAll(/^EXPO_PUBLIC_PUBLISHER_\w+=(.+)$/gm)].map((m) => m[1]!.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

async function screenText(page: Page): Promise<string> {
  return (await page.evaluate(`(() => {
    const labels = [...document.querySelectorAll("[aria-label], [placeholder], [title]")]
      .flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("title")])
      .filter(Boolean);
    return document.body.innerText + "\\n" + labels.join("\\n");
  })()`)) as string;
}

async function demoImage(label: string, background: string): Promise<Buffer> {
  const svg = `<svg width="900" height="1100" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${background}"/>
    <text x="50%" y="52%" font-family="Georgia, serif" font-size="84" fill="#FAF9F7" text-anchor="middle">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function ok(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what} impossible (${response.status})`);
  return response;
}

interface Seed {
  kellyId: string;
  postId: string;
  searchId: string;
  wishId: string;
}

async function seed(p: Parcours, louise: TestAccount, camille: TestAccount): Promise<Seed> {
  const now = new Date().toISOString();
  for (const account of [louise, camille]) {
    await p.admin.from("consents").insert([
      { user_id: account.id, type: "terms", granted_at: now, document_version: CONSENT_VERSIONS.terms },
      { user_id: account.id, type: "age_declaration", granted_at: now, document_version: CONSENT_VERSIONS.age_declaration },
      { user_id: account.id, type: "privacy_policy", granted_at: now, document_version: CONSENT_VERSIONS.privacy_policy },
    ]);
  }
  // Louise partage des statistiques (pour vérifier les événements) ; Camille
  // n'a pas encore répondu : la demande discrète s'affiche en bas d'écran.
  await ok(await p.api(louise, "POST", "/api/consents", { consents: [{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted: true }] }), "Consentement");

  const addPiece = async (title: string, category: string, background: string) => {
    const form = new FormData();
    form.append("title", title);
    form.append("category", category);
    form.append("file", new Blob([new Uint8Array(await demoImage(title, background))], { type: "image/jpeg" }), "piece.jpg");
    return (await (await ok(await p.api(louise, "POST", "/api/vault", form), "Ajout au Vault")).json()) as { id: string; imageUrl: string };
  };
  const kelly = await addPiece("Kelly 28", "bags", "#6B4A3A");
  await addPiece("Tank 2024", "watches", "#3A4A5A");

  const purchase = new FormData();
  purchase.append("type", "purchase");
  purchase.append("vaultItemId", kelly.id);
  purchase.append("privacy", "public");
  await ok(await p.api(louise, "POST", "/api/posts", purchase), "Publication achat");

  const photo = new FormData();
  photo.append("type", "lifestyle");
  photo.append("privacy", "public");
  photo.append("caption", "Marais ✦");
  photo.append("file", new Blob([new Uint8Array(await demoImage("✦", "#7A8B6F"))], { type: "image/jpeg" }), "photo.jpg");
  const post = (await (await ok(await p.api(louise, "POST", "/api/posts", photo), "Publication photo")).json()) as { id: string };

  await ok(await p.api(camille, "POST", `/api/follows/${louise.id}`), "Abonnement");
  await ok(await p.api(camille, "POST", `/api/posts/${post.id}/comments`, { body: "✦✦✦" }), "Commentaire");
  await ok(await p.api(camille, "POST", `/api/posts/${post.id}/react`), "J'aime");

  const wish = (await (
    await ok(
      await p.api(louise, "POST", "/api/wishlist", {
        title: "Kelly 28",
        imageUrl: kelly.imageUrl,
        priceMin: 1250,
        currency: "EUR",
        merchantName: "Mercer & Co",
        merchantUrl: "https://example.com/kelly",
      }),
      "Envie"
    )
  ).json()) as { id: string };

  // Un résultat du Spotter, écrit directement (aucun appel SerpApi).
  const { data: search, error } = await p.admin
    .from("product_searches")
    .insert({ user_id: louise.id, source_platform: "photo", method: "manual_screenshot", status: "done" })
    .select("id")
    .single();
  if (error || !search) throw new Error(`Recherche de démonstration impossible : ${error?.message ?? "?"}`);
  const { error: matchError } = await p.admin.from("product_matches").insert([
    { search_id: search.id, rank: 1, product_name: "Kelly 28", image_url: kelly.imageUrl, price_min: 1250, price_max: 1250, currency: "EUR", merchant_name: "Mercer & Co", merchant_url: "https://example.com/kelly" },
    { search_id: search.id, rank: 2, product_name: "Tank 2024", image_url: kelly.imageUrl, price_min: 89.5, price_max: 89.5, currency: "USD", merchant_name: "Mercer & Co", merchant_url: "https://example.com/tank" },
  ]);
  if (matchError) throw new Error(`Propositions de démonstration impossibles : ${matchError.message}`);

  return { kellyId: kelly.id, postId: post.id, searchId: search.id as string, wishId: wish.id };
}

interface Screen {
  name: string;
  path: (s: Seed, other: TestAccount) => string;
  ready: Words;
}

const SIGNED_OUT: Screen[] = [
  { name: "bienvenue", path: () => "/bienvenue", ready: { fr: "Commencer", en: "Get started" } },
  { name: "connexion", path: () => "/sign-in", ready: { fr: "Bon retour", en: "Welcome back" } },
  { name: "inscription", path: () => "/sign-up", ready: { fr: "Créer un compte", en: "Create an account" } },
  { name: "mot-de-passe-oublie", path: () => "/mot-de-passe-oublie", ready: { fr: "Envoyer le lien", en: "Send the link" } },
  { name: "conditions", path: () => "/conditions", ready: { fr: "Qui édite Spotto", en: "Who publishes Spotto" } },
  { name: "confidentialite", path: () => "/confidentialite", ready: { fr: "Les données que nous utilisons", en: "The data we use" } },
];

const SIGNED_IN: Screen[] = [
  { name: "spotter", path: () => "/", ready: { fr: "Récemment spottées", en: "Recently spotted" } },
  { name: "resultat", path: (s) => `/spot/result?searchId=${s.searchId}`, ready: { fr: "Meilleure proposition", en: "Best suggestion" } },
  { name: "fil", path: () => "/feed", ready: { fr: "Marais ✦", en: "Marais ✦" } },
  { name: "publication-commentaires", path: (s) => `/publication?id=${s.postId}`, ready: { fr: "Qui peut voir cette publication", en: "Who can see this post" } },
  { name: "activite", path: () => "/activite", ready: { fr: "a commenté votre publication.", en: "commented on your post." } },
  { name: "profil-vault", path: () => "/profile", ready: { fr: "Kelly 28", en: "Kelly 28" } },
  { name: "piece-du-vault", path: (s) => `/vault-item/${s.kellyId}`, ready: { fr: "Votre Vault est privé", en: "Your Vault is private" } },
  { name: "envie", path: (s) => `/envie?id=${s.wishId}`, ready: { fr: "Retirer de mes Envies", en: "Remove from my Wishlist" } },
  { name: "nouvelle-publication", path: () => "/post-item/new", ready: { fr: "Nouvelle publication", en: "New post" } },
  { name: "recherche-profils", path: () => "/people-search", ready: { fr: "", en: "" } },
  { name: "profil-autre", path: (_s, other) => `/profil?id=${other.id}`, ready: { fr: "Publications", en: "Posts" } },
  { name: "reglages", path: () => "/settings", ready: { fr: "Statistiques d'usage", en: "Usage statistics" } },
  { name: "modifier-profil", path: () => "/edit-profile", ready: { fr: "Nom affiché", en: "Display name" } },
  { name: "comptes-bloques", path: () => "/blocked-users", ready: { fr: "Aucun compte bloqué.", en: "No blocked accounts." } },
];

export async function run(p: Parcours): Promise<void> {
  const louise = await p.createAccount("l3a", "Louise (test)");
  const camille = await p.createAccount("l3b", "Camille (test)");
  const data = await seed(p, louise, camille);
  const hidden = publisherValues();
  const problems: string[] = [];
  let count = 0;

  async function inspect(page: Page, combo: Combo, screen: string) {
    let text = await screenText(page);
    for (const value of [...hidden, ...LANGUAGE_NAMES, louise.username, camille.username]) text = text.split(value).join(" ");
    const leak = (combo.locale === "en" ? FRENCH : ENGLISH).exec(text);
    if (leak) {
      const around = text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, " ");
      problems.push(`${combo.id}/${screen} : « ${leak[0]} » dans « …${around}… »`);
    }
    const background = (await page.evaluate("getComputedStyle(document.body).backgroundColor")) as string;
    if (background !== BACKGROUND[combo.expected]) problems.push(`${combo.id}/${screen} : fond ${background}, attendu ${BACKGROUND[combo.expected]}`);
    const lang = await page.evaluate("document.documentElement.lang");
    if (lang !== combo.locale) problems.push(`${combo.id}/${screen} : langue de la page « ${String(lang)} »`);
  }

  async function show(page: Page, combo: Combo, screen: Screen) {
    count += 1;
    const label = `${combo.id}-${String(count).padStart(2, "0")}-${screen.name}`;
    await page.goto(`${p.siteUrl}${screen.path(data, camille)}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const ready = screen.ready[combo.locale];
    if (ready) await page.getByText(ready, { exact: false }).first().waitFor({ timeout: 20_000 });
    await p.capture(page, label);
    await inspect(page, combo, screen.name);
  }

  async function applyPreference(page: Page, combo: Combo) {
    if (!combo.preference) return;
    await page.evaluate(`localStorage.setItem("spotto.apparence", "${combo.preference}")`);
  }

  for (const combo of COMBOS) {
    count = 0;
    await p.step(`${combo.id} : écrans sans compte`, async () => {
      const phone = await p.newPhone({ locale: combo.browserLocale, colorScheme: combo.deviceScheme });
      await phone.goto(`${p.siteUrl}/bienvenue`);
      await applyPreference(phone, combo);
      for (const screen of SIGNED_OUT) await show(phone, combo, screen);
      await phone.context().close();
    });

    await p.step(`${combo.id} : écrans principaux (Louise)`, async () => {
      const phone = await p.newPhone({ locale: combo.browserLocale, colorScheme: combo.deviceScheme });
      await phone.goto(`${p.siteUrl}/bienvenue`);
      await applyPreference(phone, combo);
      await louise.signIn(phone);
      for (const screen of SIGNED_IN) await show(phone, combo, screen);
      // Message en bas d'écran (confirmation) : visibilité changée.
      await phone.goto(`${p.siteUrl}/publication?id=${data.postId}`);
      await phone.getByRole("radio", { name: combo.locale === "fr" ? "Abonnés" : "Followers" }).click();
      await phone.getByText(combo.locale === "fr" ? "Visibilité : Abonnés" : "Visibility: Followers").waitFor();
      await p.capture(phone, `${combo.id}-${String(++count).padStart(2, "0")}-message-confirmation`);
      await inspect(phone, combo, "message-confirmation");
      await phone.getByRole("radio", { name: "Public" }).click();
      await phone.context().close();
    });

    await p.step(`${combo.id} : demande discrète en bas d'écran (Camille)`, async () => {
      const phone = await p.newPhone({ locale: combo.browserLocale, colorScheme: combo.deviceScheme });
      await phone.goto(`${p.siteUrl}/bienvenue`);
      await applyPreference(phone, combo);
      await camille.signIn(phone);
      await phone.getByText(combo.locale === "fr" ? "Aidez-nous à améliorer Spotto" : "Help us improve Spotto").waitFor({ timeout: 20_000 });
      await p.capture(phone, `${combo.id}-${String(++count).padStart(2, "0")}-demande-statistiques`);
      await inspect(phone, combo, "demande-statistiques");
      await phone.context().close();
    });
  }

  await p.step("Dernière étape (compte tout juste créé), dans les 4 combinaisons", async () => {
    for (const combo of COMBOS) {
      const fresh = await p.createAccount(`l3c${combo.id.slice(0, 2)}${combo.expected[0]}`, "", { incompleteProfile: true });
      const phone = await p.newPhone({ locale: combo.browserLocale, colorScheme: combo.deviceScheme });
      await phone.goto(`${p.siteUrl}/bienvenue`);
      await applyPreference(phone, combo);
      await fresh.signIn(phone);
      await p.capture(phone, `${combo.id}-99-derniere-etape`);
      await inspect(phone, combo, "derniere-etape");
      await phone.context().close();
    }
  });

  await p.step("Réglages : changer d'apparence et de langue sans quitter l'écran", async () => {
    const phone = await p.newPhone({ locale: "fr-FR", colorScheme: "light" });
    const sent: { event: string; properties: Record<string, unknown> }[] = [];
    await phone.route("https://eu.i.posthog.com/**", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { event?: string; properties?: Record<string, unknown> };
      sent.push({ event: body.event ?? "?", properties: body.properties ?? {} });
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await louise.signIn(phone);
    await phone.goto(`${p.siteUrl}/settings`);
    await phone.getByText("Statistiques d'usage").waitFor();
    await phone.getByRole("radio", { name: "Sombre" }).click();
    await phone.getByText("Statistiques d'usage").waitFor();
    check(new URL(phone.url()).pathname === "/settings", "on reste sur les Réglages après le changement d'apparence");
    check((await phone.evaluate("getComputedStyle(document.body).backgroundColor")) === BACKGROUND.dark, "fond sombre appliqué");
    await p.capture(phone, "reglages-01-apparence-sombre");
    await phone.getByRole("radio", { name: "English" }).click();
    await phone.getByText("Usage statistics").waitFor();
    check(new URL(phone.url()).pathname === "/settings", "on reste sur les Réglages après le changement de langue");
    await p.capture(phone, "reglages-02-anglais-sombre");
    await phone.reload();
    await phone.getByText("Usage statistics").waitFor();
    check((await phone.evaluate("getComputedStyle(document.body).backgroundColor")) === BACKGROUND.dark, "apparence mémorisée après rechargement");
    await phone.waitForTimeout(1500);
    const { data: profile } = await p.admin.from("profiles").select("locale").eq("id", louise.id).single();
    check(profile?.locale === "en", "langue enregistrée dans le profil (profiles.locale)");
    // Les messages du serveur suivent la langue : erreur volontaire (identifiant invalide).
    const serverMessage = (await phone.evaluate(`fetch("${p.apiUrl}/api/posts/pas-un-identifiant", { headers: { "Accept-Language": "en" } }).then((r) => r.json())`)) as { message?: string };
    check(typeof serverMessage.message === "string" && !FRENCH.test(serverMessage.message), `message du serveur en anglais (${serverMessage.message ?? "?"})`);
    await phone.getByRole("radio", { name: "System" }).click();
    await phone.getByRole("radio", { name: "Français" }).click();
    await phone.getByText("Statistiques d'usage").waitFor();
    check((await phone.evaluate("getComputedStyle(document.body).backgroundColor")) === BACKGROUND.light, "« Système » suit l'appareil (clair)");
    await p.capture(phone, "reglages-03-retour-francais-systeme");

    const languageEvents = sent.filter((s) => s.event === "language_changed");
    const themeEvents = sent.filter((s) => s.event === "theme_changed");
    check(languageEvents.length === 2 && themeEvents.length === 2, `événements reçus (${sent.map((s) => s.event).join(", ")})`);
    for (const event of [...languageEvents, ...themeEvents]) {
      const own = Object.keys(event.properties).filter((key) => !key.startsWith("$") && key !== "platform" && key !== "environment");
      const allowed = event.event === "language_changed" ? ["locale", "context"] : ["theme"];
      check(own.every((key) => allowed.includes(key)), `${event.event} : seulement ${allowed.join(", ")} (${own.join(", ")})`);
    }
    check(languageEvents[0]!.properties.locale === "en" && languageEvents[0]!.properties.context === "settings", "language_changed { locale: en, context: settings }");
    check(themeEvents[0]!.properties.theme === "dark", "theme_changed { theme: dark }");
    process.stdout.write(`  événements : ${sent.filter((s) => s.event.endsWith("_changed")).map((s) => `${s.event} ${JSON.stringify(Object.fromEntries(Object.entries(s.properties).filter(([k]) => !k.startsWith("$"))))}`).join(" ; ")}\n`);
    await phone.context().close();
  });

  await p.step("Bienvenue : choix de la langue avant l'inscription, mémorisé", async () => {
    const phone = await p.newPhone({ locale: "fr-FR", colorScheme: "light" });
    await phone.goto(`${p.siteUrl}/bienvenue`);
    await phone.getByText("Commencer").waitFor();
    await phone.getByRole("radio", { name: "English" }).click();
    await phone.getByText("Get started").waitFor();
    await phone.reload();
    await phone.getByText("Get started").waitFor();
    await p.capture(phone, "bienvenue-choix-anglais-memorise");
    await phone.context().close();
  });

  if (problems.length > 0) {
    throw new Error(`Vérification échouée :\n  - ${problems.join("\n  - ")}`);
  }
  process.stdout.write(`  aucun texte de l'autre langue, fonds conformes, sur ${COMBOS.length} combinaisons\n`);
}
