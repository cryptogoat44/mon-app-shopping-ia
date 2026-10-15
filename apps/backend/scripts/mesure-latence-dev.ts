// Délai de réponse de spotto-dev (diagnostic des lenteurs des tests,
// 2026-10-15) — depuis ce Mac ou depuis GitHub.
//
//   pnpm --filter backend mesure-latence-dev
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

async function main() {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL").origin;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!serviceKey || !anonKey) throw new Error("Clés de spotto-dev absentes.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, options);
  const anon = createClient(url, anonKey, options);
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
