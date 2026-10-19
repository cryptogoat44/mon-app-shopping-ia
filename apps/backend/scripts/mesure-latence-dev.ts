// Délai de réponse de spotto-dev (diagnostic des lenteurs des tests,
// 2026-10-15) — depuis ce Mac ou depuis GitHub.
//
//   pnpm --filter backend mesure-latence-dev
//   pnpm --filter backend mesure-latence-dev --surveiller 30   (minutes)
//
// « --surveiller » (2026-10-16, pages vides de plus de 30 s dans les
// vérifications à l'écran) : toutes les 2 s, en parallèle, les gestes que le
// serveur fait à chaque requête connectée — vérifier un jeton auprès d'Auth,
// lire une ligne — et la santé d'Auth. Chaque geste de plus de 3 s est noté
// avec l'heure de Paris ; au bout de 90 s sans réponse, il est abandonné.
//
// Refuse toute adresse qui ne désigne pas spotto-dev (même protection que
// les tests). Chronomètre les gestes que font les tests, et n'affiche QUE des
// durées : ni clé, ni adresse e-mail, ni identifiant. Les comptes et fichiers
// d'essai sont toujours supprimés, même en cas d'échec ; le mot de passe est
// généré et gardé en mémoire seulement.
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";

interface Mesure {
  etape: string;
  durees: number[];
  echecs: number;
}

async function chrono(mesure: Mesure, geste: () => PromiseLike<{ error: unknown } | void>): Promise<boolean> {
  const debut = performance.now();
  try {
    const resultat = await geste();
    if (resultat && resultat.error) throw new Error("refusé");
    mesure.durees.push(performance.now() - debut);
    return true;
  } catch {
    mesure.echecs += 1;
    return false;
  }
}

function nouvelle(etape: string): Mesure {
  return { etape, durees: [], echecs: 0 };
}

function ligne(m: Mesure): string {
  const tri = [...m.durees].sort((a, b) => a - b);
  const ms = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v)} ms`);
  const mediane = tri.length ? tri[Math.floor((tri.length - 1) / 2)] : undefined;
  return `${m.etape.padEnd(44)} ${String(tri.length).padStart(3)}  min ${ms(tri[0]).padStart(8)}  médiane ${ms(mediane).padStart(8)}  max ${ms(tri.at(-1)).padStart(8)}${m.echecs ? `  (${m.echecs} échec·s)` : ""}`;
}

async function compteEssai(admin: SupabaseClient, anon: SupabaseClient, mesures: Record<string, Mesure>): Promise<void> {
  const email = `mesure-${randomUUID().slice(0, 8)}@example.com`;
  const motDePasse = randomBytes(24).toString("base64url");
  const cree: { id: string | null } = { id: null };
  await chrono(mesures.creation!, async () => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
    cree.id = data.user?.id ?? null;
    return { error: error ?? (cree.id ? null : "aucun compte") };
  });
  const id = cree.id;
  if (!id) return;
  try {
    await chrono(mesures.connexion!, () => anon.auth.signInWithPassword({ email, password: motDePasse }));
  } finally {
    await chrono(mesures.suppression!, () => admin.auth.admin.deleteUser(id));
  }
}

async function imageEssai(admin: SupabaseClient, image: Buffer, mesures: Record<string, Mesure>): Promise<void> {
  const chemin = `mesure-latence/${randomUUID()}.jpg`;
  const envoye = await chrono(mesures.envoi!, () => admin.storage.from("screenshots").upload(chemin, image, { contentType: "image/jpeg" }));
  if (envoye) await chrono(mesures.effacement!, () => admin.storage.from("screenshots").remove([chemin]));
}

const LENT_MS = 3_000;
const ABANDON_MS = 90_000;

/** Durée de `geste`, ou null s'il n'a pas répondu (ou a échoué) en ABANDON_MS. */
async function duree(geste: () => PromiseLike<{ error: unknown } | void>): Promise<number | null> {
  const debut = performance.now();
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const abandon = new Promise<"abandon">((resolve) => {
    minuterie = setTimeout(() => resolve("abandon"), ABANDON_MS);
  });
  try {
    const resultat = await Promise.race([geste(), abandon]);
    if (resultat === "abandon" || (resultat && resultat.error)) return null;
    return performance.now() - debut;
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

const heureDeParis = () => new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" });

/** Surveille spotto-dev pendant `minutes` et liste les blocages. */
async function surveiller(minutes: number, url: string, admin: SupabaseClient, anon: SupabaseClient, anonKey: string): Promise<void> {
  const email = `mesure-${randomUUID().slice(0, 8)}@example.com`;
  const motDePasse = randomBytes(24).toString("base64url");
  const cree = await admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
  const id = cree.data.user?.id;
  if (!id) throw new Error("Compte d'essai impossible à créer.");
  try {
    const session = await anon.auth.signInWithPassword({ email, password: motDePasse });
    const jeton = session.data.session?.access_token;
    if (!jeton) throw new Error("Connexion du compte d'essai impossible.");
    const gestes: [Mesure, () => PromiseLike<{ error: unknown } | void>][] = [
      [nouvelle("Auth : vérifier un jeton (chaque requête)"), () => admin.auth.getUser(jeton)],
      [nouvelle("Base : lecture d'une ligne"), () => admin.from("profiles").select("id").limit(1)],
      [nouvelle("Auth : santé du service"), async () => {
        const reponse = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
        return { error: reponse.ok ? null : reponse.status };
      }],
    ];
    const lents: string[] = [];
    const fin = Date.now() + minutes * 60_000;
    console.log(`Surveillance de spotto-dev pendant ${minutes} min, depuis ${heureDeParis()} (heure de Paris)…`);
    while (Date.now() < fin) {
      const tour = Date.now();
      await Promise.all(
        gestes.map(async ([mesure, geste]) => {
          const ms = await duree(geste);
          if (ms === null) {
            mesure.echecs += 1;
            lents.push(`${heureDeParis()}  ${mesure.etape} : sans réponse ou en échec`);
          } else {
            mesure.durees.push(ms);
            if (ms > LENT_MS) lents.push(`${heureDeParis()}  ${mesure.etape} : ${(ms / 1000).toFixed(1)} s`);
          }
        })
      );
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 2_000 - (Date.now() - tour))));
    }
    console.log(`Fin à ${heureDeParis()}.`);
    for (const [mesure] of gestes) console.log(ligne(mesure));
    console.log(lents.length > 0 ? `Gestes de plus de ${LENT_MS / 1000} s ou sans réponse :\n${lents.join("\n")}` : `Aucun geste de plus de ${LENT_MS / 1000} s.`);
  } finally {
    await admin.auth.admin.deleteUser(id);
  }
}

async function main() {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL").origin;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!serviceKey || !anonKey) throw new Error("Clés de spotto-dev absentes.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, options);
  const anon = createClient(url, anonKey, options);
  const surveillance = process.argv.indexOf("--surveiller");
  if (surveillance >= 0) {
    const minutes = Number(process.argv[surveillance + 1]);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error("Durée de surveillance invalide (1 à 240 minutes).");
    await surveiller(minutes, url, admin, anon, anonKey);
    return;
  }
  // Une image comme celles des tests (400 × 600, JPEG).
  const image = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#6b4a3a" } }).jpeg().toBuffer();

  const mesures: Record<string, Mesure> = {
    reseau: nouvelle("Réseau seul (santé du service Auth)"),
    lecture: nouvelle("Base : lecture d'une ligne"),
    creation: nouvelle("Compte d'essai : création"),
    connexion: nouvelle("Compte d'essai : connexion"),
    suppression: nouvelle("Compte d'essai : suppression"),
    envoi: nouvelle(`Stockage : envoi d'une image (${Math.round(image.length / 1024)} Ko)`),
    effacement: nouvelle("Stockage : effacement de l'image"),
  };

  const debut = performance.now();
  for (let i = 0; i < 10; i += 1) {
    await chrono(mesures.reseau!, async () => {
      const reponse = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
      return { error: reponse.ok ? null : reponse.status };
    });
    await chrono(mesures.lecture!, () => admin.from("profiles").select("id").limit(1));
  }
  for (let i = 0; i < 3; i += 1) {
    await compteEssai(admin, anon, mesures);
    await imageEssai(admin, image, mesures);
  }

  const depuis = process.env.GITHUB_ACTIONS === "true" ? "GitHub (machine de GitHub Actions)" : "ce Mac";
  console.log(`Délai de réponse de spotto-dev — depuis ${depuis} — ${new Date().toISOString().slice(0, 16)} UTC`);
  for (const mesure of Object.values(mesures)) console.log(ligne(mesure));
  console.log(`Durée totale de la mesure : ${(Math.round(performance.now() - debut) / 1000).toFixed(1)} s`);
}

main().catch((error: unknown) => {
  console.error(`Mesure impossible : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
