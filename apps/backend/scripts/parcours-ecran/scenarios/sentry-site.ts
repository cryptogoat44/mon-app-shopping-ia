// Lot 2 — erreur de test du site vers Sentry (environnement development).
//
//   pnpm --filter backend parcours-ecran sentry-site
//
// Nécessite EXPO_PUBLIC_SENTRY_DSN (région UE) dans apps/mobile/.env. Un
// compte de test se connecte, ouvre une page dont l'adresse porte un
// paramètre, puis une erreur volontaire est levée. L'envoi vers Sentry part
// VRAIMENT (pour vérification dans Sentry), mais son contenu est lu au
// passage : ni e-mail, ni nom d'utilisateur, ni paramètre d'adresse.
import type { Parcours } from "../boite-a-outils.js";

export const name = "Sentry — erreur de test du site";
export const outputDir = "sentry-site-captures";
// Fournir une variable force une construction SANS cache (sinon l'adresse
// Sentry ajoutée au .env peut être ignorée — voir boite-a-outils.ts).
export const buildEnv = { EXPO_PUBLIC_ENVIRONMENT: "development" };

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

export async function run(p: Parcours): Promise<void> {
  const compte = await p.createAccount("sen", "Essai Sentry (test)");
  const phone = await p.newPhone();
  const sent: { url: string; body: string }[] = [];
  phone.on("request", (request) => {
    if (request.url().includes("sentry.io")) sent.push({ url: request.url(), body: request.postData() ?? "" });
  });

  await p.step("Erreur volontaire sur une page à paramètre", async () => {
    await compte.signIn(phone);
    await phone.goto(`${p.siteUrl}/profil?id=${compte.id}&email=${encodeURIComponent(compte.email)}`);
    await phone.waitForLoadState("networkidle").catch(() => {});
    // Sentry est chargé à part, après le démarrage : on lui laisse le temps.
    await phone.waitForTimeout(4000);
    await phone.evaluate(`setTimeout(() => { throw new Error("Essai lot 2 — erreur site volontaire (Spotto)"); }, 0)`);
    await phone.waitForTimeout(6000);
    await p.capture(phone, "01-page-apres-erreur");
  });

  check(sent.length > 0, "au moins un envoi vers Sentry");
  check(sent.every((s) => new URL(s.url).hostname.endsWith(".ingest.de.sentry.io")), "envois vers la région UE uniquement");
  const all = sent.map((s) => s.body).join("\n");
  check(all.includes("Essai lot 2 — erreur site volontaire"), "l'erreur de test fait partie des envois");
  check(all.includes(compte.id), "identifiant interne du compte joint");
  for (const forbidden of [compte.email, encodeURIComponent(compte.email), compte.username, "email=", "?id="]) {
    check(!all.includes(forbidden), `envoi sans « ${forbidden} »`);
  }
  console.log(`    ${sent.length} envoi(s) vers ${[...new Set(sent.map((s) => new URL(s.url).hostname))].join(", ")} ; contrôles de contenu réussis`);
}
