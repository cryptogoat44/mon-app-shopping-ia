import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mise en production groupée du lot de novembre 2026 (migrations 0029 à
// 0041, sans 0042) : trois fichiers à coller tels quels dans l'éditeur SQL de
// Supabase (spotto-prod), chacun avec son fichier de vérification. Ce test,
// sans base, garde la règle qui les rend sûrs : après son en-tête, chaque
// fichier groupé est EXACTEMENT la suite de ses migrations, recopiées sans
// aucun changement, chacune précédée de son nom (même forme que
// social-production.sql). Une migration modifiée plus tard sans régénérer le
// fichier groupé fait échouer ce test : le texte collé en production reste
// celui des migrations. Leur passage (deux fois chacun, refus de prod-3 sans
// prod-1, suppression d'un compte par le système de comptes, lignes d'avant
// intactes) est vérifié sur une base Postgres locale et jetable, jamais
// Supabase.

const SUPABASE = join(__dirname, "../supabase");
const read = (path: string) => readFileSync(join(SUPABASE, path), "utf8");
const SEPARATOR = `-- ${"=".repeat(72)}\n`;

const GROUPED = [
  {
    file: "prod-1-technique-production.sql",
    verification: "prod-1-technique-verification.sql",
    migrations: ["0029_garde_fous.sql", "0035_notifications_telephone.sql", "0037_moderation_profil.sql"],
  },
  {
    file: "prod-2-memoire-videos-production.sql",
    verification: "prod-2-memoire-videos-verification.sql",
    migrations: ["0038_memoire_videos.sql", "0039_memoire_videos_garde_fous.sql"],
  },
  {
    file: "prod-3-alertes-production.sql",
    verification: "prod-3-alertes-verification.sql",
    migrations: ["0036_alertes_prix.sql", "0040_alertes_garde_fous.sql", "0041_alertes_v2.sql"],
  },
] as const;

/** Ce qui suit l'en-tête : chaque migration telle quelle, précédée de son nom. */
function expectedBody(migrations: readonly string[]): string {
  return migrations.map((name) => `\n${SEPARATOR}-- ${name}\n${SEPARATOR}\n${read(`migrations/${name}`)}`).join("");
}

/** L'en-tête : tout ce qui précède la première migration. */
function header(group: (typeof GROUPED)[number]): string {
  const text = read(`mise-en-ligne/${group.file}`);
  return text.slice(0, text.length - expectedBody(group.migrations).length);
}

/** Le texte hors commentaires (lignes « -- … ») et hors lignes vides. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("--"))
    .join("\n");
}

/** Les commentaires d'un en-tête, remis en une seule phrase (sans retours à la ligne). */
function prose(sql: string): string {
  return sql.replace(/\n--\s*/g, " ").replace(/\s+/g, " ");
}

/** Le texte sans le contenu des chaînes « '…' ». */
function withoutStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

describe("fichiers groupés de mise en production : la suite exacte de leurs migrations", () => {
  for (const group of GROUPED) {
    it(`${group.file} = en-tête + ${group.migrations.join(" + ")}, recopiées sans changement`, () => {
      const text = read(`mise-en-ligne/${group.file}`);
      for (const name of group.migrations) expect(read(`migrations/${name}`).endsWith("\n"), name).toBe(true);
      expect(text.endsWith(expectedBody(group.migrations))).toBe(true);
      // Le nom de chaque migration n'apparaît comme séparateur qu'une fois, dans l'ordre.
      const names = [...text.matchAll(/^-- (\d{4}_[a-z0-9_]+\.sql)$/gm)].map((match) => match[1]);
      expect(names).toEqual([...group.migrations]);
    });
  }

  it("le lot entier, une seule fois : 0029 et 0035 à 0041 ; ni 0042 (essayage virtuel), ni une migration déjà en production", () => {
    const all = GROUPED.flatMap((group) => group.migrations.map((name) => name.slice(0, 4))).sort();
    expect(all).toEqual(["0029", "0035", "0036", "0037", "0038", "0039", "0040", "0041"]);
    const onDisk = readdirSync(join(SUPABASE, "migrations")).map((name) => name.slice(0, 4));
    expect(onDisk).toContain("0042");
    for (const group of GROUPED) expect(read(`mise-en-ligne/${group.file}`)).not.toMatch(/^-- 0042_/m);
  });
});

describe("en-têtes : rien d'autre à exécuter, et ce que le fondateur doit savoir", () => {
  it("prod-1 et prod-2 : l'en-tête n'est fait que de commentaires", () => {
    expect(statements(header(GROUPED[0]))).toBe("");
    expect(statements(header(GROUPED[1]))).toBe("");
  });

  it("prod-3 : une seule instruction avant 0036, la garde qui arrête une seconde exécution sans rien écrire", () => {
    const guard = statements(header(GROUPED[2]));
    expect(guard).toMatch(/^do \$\$\nbegin\n[\s\S]*\nend;\n\$\$;$/);
    expect(guard.match(/\$\$;/g)).toHaveLength(1);
    expect(guard).toContain("to_regprocedure('public.wish_observe(jsonb, uuid, timestamptz)') is not null");
    expect(guard).toContain("column_name = 'send_after'");
    expect(guard).toContain("raise exception 'prod-3 est déjà appliqué");
    expect(guard).not.toMatch(/\b(create|alter|drop|insert|update|delete|grant|revoke|truncate|notify)\b/i);
  });

  it("prod-3 demande prod-1 : 0036 refuse de s'appliquer sans push_tokens (0035)", () => {
    expect(read("migrations/0036_alertes_prix.sql")).toContain(
      "if to_regclass('public.push_tokens') is null then\n    raise exception '0036 demande la migration 0035 (push_tokens) : appliquez-la d''abord.';"
    );
    expect(header(GROUPED[2])).toContain("prod-1-technique-production.sql doit être passé");
  });

  for (const group of GROUPED) {
    it(`${group.file} : projet visé, aucune sauvegarde, ordre, avertissement, vérification, retour en arrière`, () => {
      const text = header(group);
      const words = prose(text);
      expect(words).toContain("projet spotto-prod (adresse contenant selhqdqfrflsqivgxypf)");
      expect(words).toContain("AUCUNE SAUVEGARDE : la base de production n'en a aucune");
      expect(words).toContain("Faites D'ABORD la copie de sauvegarde de spotto-prod");
      expect(words).toContain("« destructive operation »");
      expect(words).toContain(`Ensuite, coller ${group.verification}`);
      expect(words).toContain(`Vérification : ${group.verification} (lecture seule).`);
      expect(words).toContain("Retour en arrière : voir l'en-tête de chaque migration, dans l'ordre inverse");
      // Les migrations sont nommées dans l'en-tête, dans l'ordre du fichier.
      const positions = group.migrations.map((name) => text.indexOf(`--   ${name.slice(0, 4)} — `));
      for (const position of positions) expect(position).toBeGreaterThan(0);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });
  }
});

describe("fichiers de vérification : lecture seule, à coller tels quels", () => {
  for (const group of GROUPED) {
    it(`${group.verification} : une seule requête « select », sans écriture`, () => {
      const sql = withoutStrings(statements(read(`mise-en-ligne/${group.verification}`)));
      expect(sql.startsWith("select")).toBe(true);
      expect(sql.trimEnd().endsWith(";")).toBe(true);
      expect(sql.match(/;/g)).toHaveLength(1);
      expect(sql).not.toMatch(/\b(create|alter|drop|insert|update|delete|grant|revoke|truncate|notify|do)\b(?!_)/i);
    });
  }

  it("aucune commande de psql (ligne commençant par « \\ ») : l'éditeur de Supabase n'en connaît pas", () => {
    for (const group of GROUPED) {
      for (const name of [group.file, group.verification]) expect(read(`mise-en-ligne/${name}`), name).not.toMatch(/^\s*\\/m);
    }
  });

  it("prod-3 : les contrôles de 0036, 0040 et 0041, sur l'état final (sonde à 3 ; 0040 ne garde que ce que 0041 n'a pas remplacé)", () => {
    const sql = read("mise-en-ligne/prod-3-alertes-verification.sql");
    expect(sql).toContain("wish_alerts_version() = 3 as sonde");
    expect(sql).not.toContain("wish_alerts_version() = 2");
    expect(sql).not.toContain("as un_seul_auteur");
    expect(sql).toContain("v_reporters >= 3");
    for (const migration of ["0036", "0040", "0041"]) expect(sql).toContain(`select '${migration}' as migration`);
  });

  it("prod-2 : la sonde, les droits du serveur seul et le déclencheur « security definer » de la suppression d'un compte", () => {
    const sql = read("mise-en-ligne/prod-2-memoire-videos-verification.sql");
    expect(sql).toContain("video_memory_version() >= 1 as sonde_0038");
    expect(sql).toContain("video_memory_version() >= 2 as sonde_0039");
    expect(sql).toContain("prosecdef and proconfig @> array['search_path=public']");
    expect(sql).toContain("to_regprocedure('public.video_products(text, text, uuid, integer)') is null");
  });
});

describe("registre des migrations", () => {
  it("nomme les trois fichiers groupés et leurs vérifications, sans rien marquer comme appliqué", () => {
    const registry = read("REGISTRE-MIGRATIONS.md");
    for (const group of GROUPED) {
      expect(registry).toContain(`supabase/mise-en-ligne/${group.file}`);
      expect(registry).toContain(`supabase/mise-en-ligne/${group.verification}`);
    }
    for (const number of ["0029", "0035", "0036", "0037", "0038", "0039", "0040", "0041"]) {
      expect(registry).toMatch(new RegExp(`^\\| ${number} \\| [^|]+ \\| \\*\\*à appliquer\\*\\*`, "m"));
    }
  });
});
