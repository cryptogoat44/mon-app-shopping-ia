// Lot 2 — statistiques d'usage et consentement.
//
//   pnpm --filter backend parcours-ecran lot-2
//
// Le site est construit avec une FAUSSE clé PostHog : chaque envoi vers
// PostHog (UE) est intercepté dans le navigateur de test, examiné, puis
// arrêté là — rien ne part chez PostHog. Vérifie : case facultative
// décochée à l'inscription ; aucune collecte avant le consentement ; demande
// discrète unique ; contenu des envois (identifiant interne seul, aucun
// e-mail, nom, légende) ; retrait immédiat ; bandeau centré sur écran large.
import sharp from "sharp";
import type { Page } from "playwright-core";
import type { Parcours, TestAccount } from "../boite-a-outils.js";

export const name = "Lot 2 — statistiques d'usage et consentement";
export const outputDir = "lot-2-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const PROMPT = "Aidez-nous à améliorer Spotto";
const POLICY = "Notre politique de confidentialité a été mise à jour";

interface Captured {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  raw: string;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

/** Intercepte tout envoi vers PostHog (rien ne sort du navigateur de test). */
async function interceptPostHog(page: Page): Promise<Captured[]> {
  const captured: Captured[] = [];
  await page.route("https://eu.i.posthog.com/**", async (route) => {
    const raw = route.request().postData() ?? "";
    try {
      captured.push({ ...(JSON.parse(raw) as Omit<Captured, "raw">), raw });
    } catch {
      captured.push({ event: "?", distinct_id: "?", properties: {}, raw });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  // Tout autre hôte PostHog serait une fuite hors UE : bloqué et signalé.
  await page.route(/posthog\.com/, async (route) => {
    if (route.request().url().startsWith("https://eu.i.posthog.com/")) return route.fallback();
    captured.push({ event: "HORS_UE", distinct_id: "", properties: {}, raw: route.request().url() });
    await route.abort();
  });
  return captured;
}

async function visible(page: Page, text: string, waitMs = 6000): Promise<boolean> {
  return page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ timeout: waitMs })
    .then(() => true)
    .catch(() => false);
}

async function disappears(page: Page, text: string, waitMs = 10_000): Promise<boolean> {
  return page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "hidden", timeout: waitMs })
    .then(() => true)
    .catch(() => false);
}

async function analyticsRows(p: Parcours, userId: string) {
  const { data } = await p.admin.from("consents").select("granted_at, revoked_at, document_version").eq("user_id", userId).eq("type", "analytics").order("created_at");
  return data ?? [];
}

async function publishPhoto(p: Parcours, author: TestAccount, caption: string): Promise<string> {
  const image = await sharp({ create: { width: 600, height: 750, channels: 3, background: "#7A8B6F" } }).jpeg().toBuffer();
  const form = new FormData();
  form.append("type", "lifestyle");
  form.append("privacy", "public");
  form.append("caption", caption);
  form.append("file", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "photo.jpg");
  const res = await p.api(author, "POST", "/api/posts", form);
  if (!res.ok) throw new Error(`Publication impossible (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

/** Aucun envoi ne doit contenir d'e-mail, de nom d'utilisateur ni de légende. */
function assertNoPersonalContent(captured: Captured[], forbidden: string[]): void {
  for (const item of captured) {
    for (const value of forbidden) check(!item.raw.includes(value), `envoi « ${item.event} » sans « ${value} »`);
    check(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(item.raw), `envoi « ${item.event} » sans adresse e-mail`);
  }
}

export async function run(p: Parcours): Promise<void> {
  const auteur = await p.createAccount("l2a", "Auteur (test)");
  const legende = "Légende privée de test";
  const postId = await publishPhoto(p, auteur, legende);

  await p.step("Inscription : case « statistiques » facultative et décochée", async () => {
    const visitor = await p.newPhone();
    await visitor.goto(`${p.siteUrl}/sign-up`);
    const box = visitor.getByRole("checkbox", { name: /statistiques d'usage/ });
    await box.waitFor();
    check(!(await box.isChecked()), "case décochée par défaut");
    await p.capture(visitor, "01-inscription-case-facultative");
  });

  await p.step("Compte existant : aucune collecte avant le choix, demande discrète unique, « Non merci »", async () => {
    const ancien = await p.createAccount("l2b", "Ancien (test)");
    const phone = await p.newPhone();
    const captured = await interceptPostHog(phone);
    await ancien.signIn(phone);
    // Information de mise à jour d'abord, puis la demande « statistiques ».
    if (await visible(phone, POLICY)) await phone.getByRole("button", { name: "Fermer cette information" }).click();
    check(await visible(phone, PROMPT), "demande « statistiques » affichée");
    await p.capture(phone, "02-demande-statistiques");
    // Une action avant tout choix : rien ne doit partir.
    await phone.goto(`${p.siteUrl}/publication?id=${postId}`);
    await phone.getByRole("button", { name: "Aimer" }).click();
    await phone.waitForTimeout(1500);
    check(captured.length === 0, `aucun envoi avant le consentement (obtenu : ${captured.length})`);
    await phone.goto(`${p.siteUrl}/`);
    await phone.getByRole("button", { name: "Non merci" }).click();
    check(await disappears(phone, PROMPT), "demande fermée");
    await phone.reload();
    check(!(await visible(phone, PROMPT, 5000)), "demande non réaffichée (choix gardé sur le serveur)");
    const rows = await analyticsRows(p, ancien.id);
    check(rows.length === 1 && rows[0]!.revoked_at !== null && rows[0]!.granted_at === null, "refus enregistré (événement daté)");
    check(captured.length === 0, "toujours aucun envoi après « Non merci »");
    await p.capture(phone, "03-apres-non-merci");

    await p.step("Réglages : accord, envois examinés, puis retrait immédiat", async () => {
      await phone.goto(`${p.siteUrl}/settings`);
      const sw = phone.getByRole("switch", { name: "Partager des statistiques d'usage" });
      await sw.waitFor();
      await p.capture(phone, "04-reglages-statistiques-desactivees");
      await sw.click();
      await phone.getByText("Vous partagez des statistiques d'usage", { exact: false }).waitFor();
      await p.capture(phone, "05-reglages-statistiques-activees");
      await phone.goto(`${p.siteUrl}/publication?id=${postId}`);
      // Après un chargement de page, l'app relit le consentement avant de collecter.
      await phone.waitForLoadState("networkidle").catch(() => {});
      await phone.waitForTimeout(2000);
      await phone.getByRole("button", { name: /Aimer|Je n'aime plus/ }).first().click();
      await phone.waitForTimeout(800);
      const nameOrUnlike = phone.getByRole("button", { name: /Aimer|Je n'aime plus/ }).first();
      if ((await nameOrUnlike.getAttribute("aria-label")) === "Aimer") await nameOrUnlike.click();
      await phone.waitForTimeout(1500);
      check(captured.length > 0, `envoi après l'accord (bouton : ${await nameOrUnlike.getAttribute("aria-label")})`);
      check(captured.every((c) => c.event !== "HORS_UE"), "tous les envois vers l'hôte UE");
      check(captured.every((c) => c.distinct_id === ancien.id), "identifiant interne du compte seulement");
      assertNoPersonalContent(captured, [ancien.email, ancien.username, legende, auteur.username]);
      const before = captured.length;
      console.log(`    envois interceptés : ${captured.map((c) => `${c.event} ${JSON.stringify(c.properties)}`).join(" | ")}`);
      // Retrait : effet immédiat.
      await phone.goto(`${p.siteUrl}/settings`);
      await phone.getByRole("switch", { name: "Partager des statistiques d'usage" }).click();
      await phone.getByText("Vous ne partagez pas de statistiques d'usage", { exact: false }).waitFor();
      await phone.goto(`${p.siteUrl}/publication?id=${postId}`);
      await phone.getByRole("button", { name: /Aimer|Je n'aime plus/ }).first().click();
      await phone.waitForTimeout(800);
      await phone.getByRole("button", { name: /Aimer|Je n'aime plus/ }).first().click();
      await phone.waitForTimeout(1500);
      check(captured.length === before, `aucun envoi après le retrait (avant : ${before}, après : ${captured.length})`);
      const rows2 = await analyticsRows(p, ancien.id);
      check(rows2.length === 3, `trois choix datés (refus, accord, retrait) — obtenu : ${rows2.length}`);
      await p.capture(phone, "06-apres-retrait");
    });
  });

  await p.step("Nouveau compte : case cochée à la Dernière étape, inscription comptée, aucune demande ensuite", async () => {
    const nouveau = await p.createAccount("l2c", "Nouveau (test)", { incompleteProfile: true });
    const phone = await p.newPhone();
    const captured = await interceptPostHog(phone);
    await nouveau.signIn(phone);
    await phone.getByLabel("Nom d'utilisateur").fill(nouveau.username);
    await phone.getByLabel("Nom affiché").fill("Nouveau (test)");
    await phone.getByRole("checkbox", { name: "Je certifie avoir au moins 15 ans." }).click();
    await phone.getByRole("checkbox", { name: "J'accepte les conditions d'utilisation et la politique de confidentialité." }).click();
    const box = phone.getByRole("checkbox", { name: /statistiques d'usage/ });
    check(!(await box.isChecked()), "case « statistiques » décochée par défaut");
    await box.click();
    await p.capture(phone, "07-derniere-etape-statistiques");
    await phone.getByRole("button", { name: "Continuer" }).click();
    await phone.getByText("Retrouvez une pièce vue dans une vidéo ou sur une photo.").waitFor({ timeout: 30_000 });
    await phone.waitForTimeout(1500);
    check(captured.some((c) => c.event === "signup_completed" && c.distinct_id === nouveau.id), "inscription comptée");
    assertNoPersonalContent(captured, [nouveau.email, nouveau.username]);
    check(!(await visible(phone, PROMPT, 4000)), "aucune demande « statistiques » (choix déjà fait)");
    const rows = await analyticsRows(p, nouveau.id);
    check(rows.length === 1 && rows[0]!.granted_at !== null, "accord enregistré à l'inscription");
    await p.capture(phone, "08-accueil-sans-demande");
  });

  await p.step("Écran large : le message est centré", async () => {
    const autre = await p.createAccount("l2d", "Ordinateur (test)");
    const desktop = await p.newPhone({ desktop: true });
    await autre.signIn(desktop);
    check(await visible(desktop, POLICY), "message affiché");
    const box = await desktop.getByText(POLICY, { exact: false }).first().boundingBox();
    const width = desktop.viewportSize()!.width;
    check(!!box && Math.abs(box.x + box.width / 2 - width / 2) < 60, `message centré (centre ${box ? Math.round(box.x + box.width / 2) : "?"} / ${width / 2})`);
    await p.capture(desktop, "09-ordinateur-message-centre");
  });
}
