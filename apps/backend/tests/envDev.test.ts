import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { avecVariables, configurerEnvDev, genreDeCle, type OptionsEnvDev } from "../scripts/lib/env-dev.js";

// configurer-env-dev (lot outils, 30 octobre 2026) : testé sans aucune vraie clé ni aucun appel ;
// toutes les clés ci-dessous sont fausses. La fausse clé secrète est assemblée à l'exécution : écrite
// en toutes lettres, elle ressemblerait à une vraie clé pour la détection des secrets de GitHub
// (dépôt public).
const URL_DEV_2 = "https://sedfepcpmhilaxbrgdif.supabase.co";
const FAUSSE_SECRETE = ["sb", "secret", "FAUX-pour-le-test-0123456789"].join("_");
const FAUSSE_PUBLIQUE = "sb_publishable_FAUX-pour-le-test-0123456789";
const jeton = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature-fausse`;

const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

function preparer(acces: unknown): { options: (cle: string) => OptionsEnvDev; d: string; journal: string[] } {
  const d = mkdtempSync(join(tmpdir(), "env-dev-"));
  dossiers.push(d);
  writeFileSync(join(d, "acces.json"), JSON.stringify(acces));
  writeFileSync(join(d, "serveur.env"), ["# serveur", "SUPABASE_URL=https://sbtwsmxfdfxzgcohbznd.supabase.co", "SUPABASE_SERVICE_ROLE_KEY=ancienne-secrete", "SERPAPI_KEY=garder-telle-quelle", "SUPABASE_ANON_KEY=ancienne-publique", "DEV_DATABASE_URL=postgresql://postgres.sbtwsmxfdfxzgcohbznd:x@aws-1-eu-west-1.pooler.supabase.com:5432/postgres", ""].join("\n"), { mode: 0o644 });
  writeFileSync(join(d, "app.env"), ["EXPO_PUBLIC_SUPABASE_URL=https://sbtwsmxfdfxzgcohbznd.supabase.co", "EXPO_PUBLIC_SUPABASE_ANON_KEY=ancienne-publique", "EXPO_PUBLIC_API_URL=http://localhost:3000", ""].join("\n"));
  const journal: string[] = [];
  const options = (cle: string): OptionsEnvDev => ({ acces: join(d, "acces.json"), envServeur: join(d, "serveur.env"), envApp: join(d, "app.env"), demanderClePublique: async () => cle, journal: (l) => journal.push(l), horodatage: "essai" });
  return { options, d, journal };
}

describe("configurer-env-dev : .env de développement vers spotto-dev-2", () => {
  it("reconnaît une clé publique ou secrète, nouvelle ou ancienne, sans jamais l'afficher", () => {
    expect([FAUSSE_PUBLIQUE, jeton("anon")].map(genreDeCle)).toEqual(["publique", "publique"]);
    expect([FAUSSE_SECRETE, jeton("service_role")].map(genreDeCle)).toEqual(["secrete", "secrete"]);
    expect(["", "n'importe quoi", "a.b.c", jeton("autre"), "sb_publishable_court"].map(genreDeCle)).toEqual(["inconnue", "inconnue", "inconnue", "inconnue", "inconnue"]);
  });

  it("remplace ou ajoute les variables demandées ; toutes les autres lignes restent", () => {
    expect(avecVariables("# note\nA=1\nB=2\n", { B: "3", C: "4" })).toBe("# note\nA=1\nB=3\nC=4\n");
    expect(avecVariables("# B=commentaire\nB=2", { B: "3" })).toBe("# B=commentaire\nB=3\n");
  });

  it("remplit les deux fichiers, garde une copie de chacun (lisible par vous seul) et n'affiche aucune valeur", async () => {
    const { options, d, journal } = preparer({ url: URL_DEV_2, cle: FAUSSE_SECRETE });
    await configurerEnvDev(options(FAUSSE_PUBLIQUE));
    const serveur = readFileSync(join(d, "serveur.env"), "utf8");
    expect(serveur).toContain(`SUPABASE_URL=${URL_DEV_2}\n`);
    expect(serveur).toContain(`SUPABASE_SERVICE_ROLE_KEY=${FAUSSE_SECRETE}\n`);
    expect(serveur).toContain(`SUPABASE_ANON_KEY=${FAUSSE_PUBLIQUE}\n`);
    expect(serveur).toContain("SERPAPI_KEY=garder-telle-quelle\n");
    const app = readFileSync(join(d, "app.env"), "utf8");
    expect(app).toBe(`EXPO_PUBLIC_SUPABASE_URL=${URL_DEV_2}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${FAUSSE_PUBLIQUE}\nEXPO_PUBLIC_API_URL=http://localhost:3000\n`);
    expect(app).not.toContain(FAUSSE_SECRETE);
    expect(readFileSync(join(d, "serveur.env.sauvegarde-essai"), "utf8")).toContain("SUPABASE_SERVICE_ROLE_KEY=ancienne-secrete");
    for (const f of ["serveur.env", "serveur.env.sauvegarde-essai", "app.env.sauvegarde-essai"]) expect(statSync(join(d, f)).mode & 0o777).toBe(0o600);
    const affiche = journal.join("\n");
    for (const valeur of [FAUSSE_SECRETE, FAUSSE_PUBLIQUE, URL_DEV_2, "ancienne-secrete", "sedfepcpmhilaxbrgdif"]) expect(affiche).not.toContain(valeur);
    expect(affiche).toMatch(/DEV_DATABASE_URL vise encore l'ancien spotto-dev/);
  });

  it("refuse, sans rien écrire : une clé secrète saisie comme publique, un accès qui vise la production ou l'ancien spotto-dev, une clé enregistrée qui n'est pas secrète", async () => {
    const cas: [unknown, string, RegExp][] = [
      [{ url: URL_DEV_2, cle: FAUSSE_SECRETE }, FAUSSE_SECRETE, /clé SECRÈTE/],
      [{ url: URL_DEV_2, cle: FAUSSE_SECRETE }, jeton("service_role"), /clé SECRÈTE/],
      [{ url: URL_DEV_2, cle: FAUSSE_SECRETE }, "pas-une-cle", /pas une clé publique/],
      [{ url: "https://selhqdqfrflsqivgxypf.supabase.co", cle: FAUSSE_SECRETE }, FAUSSE_PUBLIQUE, /PRODUCTION/],
      [{ url: "https://sbtwsmxfdfxzgcohbznd.supabase.co", cle: FAUSSE_SECRETE }, FAUSSE_PUBLIQUE, /ancien spotto-dev/],
      [{ url: URL_DEV_2, cle: FAUSSE_PUBLIQUE }, FAUSSE_PUBLIQUE, /n'est pas une clé secrète/],
      [{ adresse: URL_DEV_2 }, FAUSSE_PUBLIQUE, /illisible/],
    ];
    for (const [acces, saisie, attendu] of cas) {
      const { options, d } = preparer(acces);
      const avant = readFileSync(join(d, "serveur.env"), "utf8");
      await expect(configurerEnvDev(options(saisie))).rejects.toThrow(attendu);
      expect(readFileSync(join(d, "serveur.env"), "utf8")).toBe(avant);
      expect(readdirSync(d).filter((f) => f.includes("sauvegarde"))).toEqual([]);
    }
  });

  it("accès de configurer-banc absent : rien n'est écrit, et la marche à suivre est donnée", async () => {
    const { options } = preparer({ url: URL_DEV_2, cle: FAUSSE_SECRETE });
    await expect(configurerEnvDev({ ...options(FAUSSE_PUBLIQUE), acces: "/chemin/inexistant.json" })).rejects.toThrow(/configurer-banc/);
  });
});
