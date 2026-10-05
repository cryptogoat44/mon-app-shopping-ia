// Lot 3bis — « mot de passe oublié » sur le site (correction commune avec l'iPhone).
//
//   pnpm --filter backend parcours-ecran lot-3bis
//
// Constaté sur iPhone puis sur le site (ancien code rejoué en local) : le
// lien de l'e-mail, ouvert déconnecté, menait à l'accueil de l'app sans le
// formulaire (navigation retirée pendant le chargement du profil). Ici : lien
// ouvert sur un téléphone déconnecté ; le formulaire doit s'afficher et RESTER
// affiché une fois la session ouverte, la session n'être ouverte qu'une fois,
// et les jetons doivent quitter l'adresse sans y revenir (Expo Router les y
// réécrivait). Aucun mot de passe n'est saisi.
import { createClient } from "@supabase/supabase-js";
import type { Parcours } from "../boite-a-outils.js";

export const name = "Lot 3bis — mot de passe oublié (site)";
export const outputDir = "lot-3bis-site-captures";

const CONSIGNE = "Choisissez un mot de passe d'au moins 8 caractères.";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

/** Lien de réinitialisation tel que Supabase le renvoie (jetons après « # ») — jamais affiché. */
async function recoveryLink(p: Parcours, email: string): Promise<string> {
  const { data, error } = await p.admin.auth.admin.generateLink({ type: "recovery", email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new Error(`Lien de réinitialisation impossible : ${error?.message ?? "?"}`);
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: "recovery", token_hash: hash });
  if (verifyError || !verified.session) throw new Error(`Session de réinitialisation impossible : ${verifyError?.message ?? "?"}`);
  const { access_token, refresh_token, expires_in } = verified.session;
  const params = new URLSearchParams({ access_token, refresh_token, expires_in: String(expires_in), token_type: "bearer", type: "recovery" });
  return `${p.siteUrl}/nouveau-mot-de-passe#${params.toString()}`;
}

export async function run(p: Parcours): Promise<void> {
  const compte = await p.createAccount("mdp", "Essai mot de passe (test)", { settled: true });
  const phone = await p.newPhone();
  // Ouverture de la session du lien : appel « user » de Supabase, une fois.
  let ouvertures = 0;
  phone.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/auth/v1/user") ouvertures++;
  });

  await p.step("Lien de l'e-mail ouvert sur un téléphone déconnecté", async () => {
    await phone.goto(await recoveryLink(p, compte.email));
    await phone.getByText(CONSIGNE).waitFor({ timeout: 30_000 });
    // La session ouverte par le lien fait charger le profil : le formulaire doit rester.
    await phone.waitForTimeout(6000);
    check(await phone.getByText(CONSIGNE).isVisible(), "formulaire toujours affiché après l'ouverture de la session");
    const adresse = new URL(phone.url());
    check(adresse.pathname === "/nouveau-mot-de-passe", `page inchangée (${adresse.pathname})`);
    // Détail sans jamais afficher de jeton : longueur de la partie « # » et noms des paramètres.
    const detail = `« # » : ${adresse.hash ? `${adresse.hash.length} caractères${adresse.hash.includes("access_token") ? ", avec jetons" : ""}` : "vide"} ; paramètres : ${[...adresse.searchParams.keys()].join(", ") || "aucun"}`;
    check(adresse.hash === "" && !adresse.href.includes("token"), `jetons retirés de l'adresse (${detail})`);
    process.stdout.write(`  ouvertures de la session du lien : ${ouvertures}\n`);
    check(ouvertures === 1, `session ouverte une seule fois — l'écran n'a pas été démonté puis remonté (${ouvertures})`);
    await p.capture(phone, "01-nouveau-mot-de-passe");
  });
}
