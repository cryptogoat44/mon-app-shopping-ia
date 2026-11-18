import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Confirmations de lecture (lot « messages vus ») : ce que le FICHIER de la
// migration 0043 doit garantir, vérifié sans base. Son passage (refus sans
// 0032, des conversations déjà lues, deux fois de suite, vérification, retour
// en arrière) a été essayé sur une base Postgres locale et jetable, jamais
// Supabase. Le comportement du serveur, avec et sans elle :
// confirmationsLecture.test.ts.

const SUPABASE = join(__dirname, "../supabase");
const SQL = readFileSync(join(SUPABASE, "migrations/0043_confirmations_lecture.sql"), "utf8");
const VERIFICATION = readFileSync(join(SUPABASE, "verifications/0043-verification.sql"), "utf8");
const REGISTRY = readFileSync(join(SUPABASE, "REGISTRE-MIGRATIONS.md"), "utf8");

/** Le fichier sans ses commentaires ni ses lignes vides. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("--"))
    .join("\n");
}
/** Les commentaires remis en une seule phrase (sans retours à la ligne). */
function prose(sql: string): string {
  return sql.replace(/\n--\s*/g, " ").replace(/\s+/g, " ");
}

const STATEMENTS = statements(SQL);
/** Ce que le fichier exécute après sa garde (0032). */
const AFTER_GUARD = STATEMENTS.slice(STATEMENTS.indexOf("$$;") + "$$;".length).trim();
const HEADER = SQL.slice(0, SQL.indexOf("\ndo $$"));
const ROLLBACK = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));

describe("en-tête de 0043", () => {
  it("dit ce qu'elle fait, qu'elle est facultative, rejouable, où l'appliquer, et le retour en arrière", () => {
    expect(HEADER).toMatch(/^-- 0043 \(lot « messages vus », 2026-11-17\)/);
    for (const words of ["Retour en arrière", "Ce qu'elle ajoute :", "Facultative pour le serveur", "Rejouable sans effet", "spotto-dev-2", "RLS active, aucune politique"]) {
      expect(prose(HEADER), words).toContain(words);
    }
    expect(prose(HEADER)).toContain("ne supprime ni ne modifie aucune donnée existante : elle n'écrit que dans la nouvelle colonne read_receipts_since");
  });

  it("dit depuis quand les lectures d'un membre peuvent être montrées : jamais celles d'avant la migration, ni celles faites réglage éteint", () => {
    const words = prose(HEADER);
    expect(words).toContain("profiles.read_receipts_since : le moment à partir duquel les lectures de ce membre peuvent être montrées");
    expect(words).toContain("Une lecture d'avant ce moment n'est jamais montrée, même plus tard");
    expect(words).toContain("membres déjà inscrits : le moment où cette migration est appliquée (rien de ce qu'ils ont lu avant que « Vu » existe n'est montré)");
    expect(words).toContain("nouveaux membres : la création de leur profil");
    expect(words).toContain("à chaque fois qu'un membre rallume le réglage, le serveur y écrit le moment où il le rallume (ce qu'il a lu pendant que le réglage était éteint n'est jamais montré ensuite)");
    // La date de la lecture elle-même reste écrite comme avant (compteurs de non-lus, export).
    expect(words).toContain("(conversation_participants.last_read_at) ; elle reste écrite comme avant");
    expect(words).toContain("ni pour une lecture d'avant read_receipts_since (lib/readReceipts.ts)");
  });

  it("dit les règles du réglage : allumé par défaut, réciproque, jamais pour une invitation", () => {
    const words = prose(HEADER);
    expect(words).toContain("allumé par défaut (true)");
    expect(words).toContain("réciproque : il suffit que l'un des deux l'ait éteint");
    expect(words).toContain("jamais pour une invitation en attente ou refusée, ni pour une lecture faite avant que l'invitation soit acceptée");
    // Sans elle, personne n'est exposé : rien n'est montré, et le réglage n'est pas proposé.
    expect(words).toContain("sans elle, personne ne voit « Vu » ni « Envoyé », et l'app ne propose pas le réglage");
    expect(words).toContain("personne n'est exposé avant de pouvoir refuser");
  });

  it("le retour en arrière est en tête, et ne retire que les deux colonnes de 0043", () => {
    expect(SQL.indexOf("-- Retour en arrière")).toBeGreaterThan(0);
    expect(SQL.indexOf("-- Retour en arrière")).toBeLessThan(SQL.indexOf("do $$"));
    const commands = ROLLBACK.split("\n").filter((line) => line.startsWith("--   "));
    expect(commands).toEqual(["--   alter table profiles drop column if exists read_receipts_since;", "--   alter table profiles drop column if exists read_receipts;"]);
    // Chaque colonne ajoutée est retirée, et rien d'autre.
    const added = [...AFTER_GUARD.matchAll(/add column (?:if not exists )?([a-z_]+) /g)].map((match) => match[1]).sort();
    const dropped = commands.map((command) => /drop column if exists ([a-z_]+);$/.exec(command)?.[1]).sort();
    expect(dropped).toEqual(added);
    expect(prose(ROLLBACK)).toContain("le serveur actuel fonctionne sans 0043");
    expect(prose(ROLLBACK)).toContain("le choix de chaque membre est alors perdu");
    // Appliquée de nouveau : tout le monde repart de ce moment-là.
    expect(prose(ROLLBACK)).toContain("Appliquée de nouveau ensuite, elle repart de zéro : aucune lecture d'avant n'est montrée");
  });
});

describe("ce que 0043 exécute", () => {
  it("refuse de s'appliquer sans les messages privés (0032), avant de modifier quoi que ce soit", () => {
    expect(STATEMENTS).toMatch(/^do \$\$\nbegin\n  if to_regclass\('public\.conversation_participants'\) is null then\n    raise exception '0043 demande la migration 0032 \(messages privés\) : appliquez-la d''abord\.';\n  end if;\nend;\n\$\$;\n/);
  });

  it("deux colonnes, sur profiles : le réglage (oui ou non, allumé par défaut) et la date « depuis » (jamais vide, now() par défaut) ; rien d'autre", () => {
    expect(AFTER_GUARD).toBe(
      [
        "alter table profiles add column if not exists read_receipts boolean not null default true;",
        "do $$",
        "begin",
        "  if not exists (",
        "    select 1 from information_schema.columns",
        "    where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_receipts_since'",
        "  ) then",
        "    alter table profiles add column read_receipts_since timestamptz not null default now();",
        "    update profiles p",
        "      set read_receipts_since = r.latest + interval '1 millisecond'",
        "      from (select user_id, max(last_read_at) as latest from conversation_participants group by user_id) r",
        "      where r.user_id = p.id and r.latest + interval '1 millisecond' > p.read_receipts_since;",
        "  end if;",
        "end;",
        "$$;",
        "notify pgrst, 'reload schema';",
      ].join("\n")
    );
  });

  it("lectures déjà dans la base : la date « depuis » passe toujours APRÈS la dernière lecture de chaque membre, quelles que soient les horloges", () => {
    // now() pour tous (moment de la migration), puis, pour qui a une lecture
    // datée de ce moment ou d'après (horloge du serveur en avance) : juste après elle.
    expect(AFTER_GUARD).toContain("add column read_receipts_since timestamptz not null default now();");
    expect(AFTER_GUARD).toContain("set read_receipts_since = r.latest + interval '1 millisecond'");
    // « > », jamais « >= » sur la lecture elle-même : une lecture datée de l'instant exact de la migration est couverte aussi.
    expect(AFTER_GUARD).toContain("where r.user_id = p.id and r.latest + interval '1 millisecond' > p.read_receipts_since;");
    // La date ne recule jamais, et seule cette colonne est écrite.
    expect(AFTER_GUARD.match(/\bset\b/g)).toHaveLength(1);
    expect(AFTER_GUARD.match(/\bupdate\b/g)).toHaveLength(1);
    expect(prose(SQL)).toContain("Aucune lecture déjà dans la base n'est donc montrée, quelles que soient les horloges.");
  });

  it("rejouable : la date « depuis » n'est ajoutée et calculée que si la colonne n'existe pas encore ; rien n'est détruit ; aucune table, règle d'accès, fonction ni déclencheur", () => {
    expect(AFTER_GUARD).toContain("add column if not exists read_receipts ");
    // L'ajout de la date ET son calcul sont dans la même garde : rejouée, la migration ne touche à aucune date déjà là.
    const guarded = AFTER_GUARD.slice(AFTER_GUARD.indexOf("  if not exists ("), AFTER_GUARD.indexOf("  end if;"));
    expect(guarded).toContain("column_name = 'read_receipts_since'");
    expect(guarded).toContain("add column read_receipts_since");
    expect(guarded).toContain("update profiles p");
    expect(AFTER_GUARD.replace(guarded, "")).not.toMatch(/\bupdate\b|read_receipts_since/);
    expect(STATEMENTS).not.toMatch(/\b(drop|truncate|delete|insert|grant|revoke)\b/i);
    expect(STATEMENTS).not.toMatch(/create (table|policy|function|or replace|trigger|index)|enable row level security/i);
    // La date de la dernière lecture existe depuis 0032 : lue ici, jamais écrite.
    expect(STATEMENTS).not.toMatch(/set\s+last_read_at|update conversation_participants/);
    expect(readFileSync(join(SUPABASE, "migrations/0032_messages.sql"), "utf8")).toContain("  last_read_at timestamptz,");
  });

  it("le fichier se termine par un retour à la ligne, et porte le numéro qui suit 0042", () => {
    expect(SQL.endsWith("\n")).toBe(true);
    const numbers = readdirSync(join(SUPABASE, "migrations")).map((name) => name.slice(0, 4));
    expect(numbers.filter((number) => number === "0043")).toHaveLength(1);
    expect(numbers).toContain("0042");
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("le serveur et la migration parlent de la même colonne", () => {
  const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

  it("la sonde, la lecture et l'écriture du réglage nomment profiles.read_receipts, la colonne créée par 0043", () => {
    const lib = source("lib/readReceipts.ts");
    expect(lib).toContain('fastify.supabaseAdmin.from("profiles").select("read_receipts").limit(0)');
    expect(lib).toContain('.select("id, read_receipts")');
    expect(lib).toContain("Confirmations de lecture coupées : migration 0043 absente");
    expect(source("routes/me.ts")).toContain(".update({ read_receipts: body.readReceipts, updated_at: new Date().toISOString() })");
  });

  it("les messages eux-mêmes ne demandent jamais cette colonne : leur sonde (0032) ne la lit pas", () => {
    const messaging = source("lib/messaging.ts");
    expect(messaging).not.toContain("read_receipts");
    // Les profils des conversations sont lus sans elle (une base sans 0043 répondrait par une erreur).
    expect(source("routes/conversations.ts")).not.toContain("read_receipts");
  });
});

describe("contrôle de 0043 et registre des migrations", () => {
  it("le contrôle est en lecture seule : une seule requête « select », six réponses", () => {
    const query = statements(VERIFICATION).trim();
    expect(query.startsWith("select")).toBe(true);
    expect(query.match(/;/g)).toHaveLength(1);
    expect(query.endsWith(";")).toBe(true);
    expect(query.replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(create|alter|drop|insert|update|delete|grant|revoke|truncate|notify|do)\b(?!_)/i);
    expect(VERIFICATION).not.toMatch(/^\s*\\/m);
    expect([...VERIFICATION.matchAll(/ as ([a-z_]+)[,;]/g)].map((match) => match[1])).toEqual(["reglage", "allume_par_defaut", "depuis", "depuis_la_creation", "lecture_datee", "fermee_au_public"]);
    expect(VERIFICATION).toContain("Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :");
  });

  it("le contrôle regarde les deux colonnes créées, leurs valeurs par défaut, la date de lecture de 0032 et la RLS de profiles", () => {
    expect(VERIFICATION).toContain("table_name = 'profiles' and column_name = 'read_receipts'");
    expect(VERIFICATION).toContain("data_type = 'boolean' and is_nullable = 'NO'");
    expect(VERIFICATION).toContain("column_default = 'true'");
    expect(VERIFICATION.match(/table_name = 'profiles' and column_name = 'read_receipts_since'/g)).toHaveLength(2);
    expect(VERIFICATION).toContain("data_type = 'timestamp with time zone' and is_nullable = 'NO'");
    expect(VERIFICATION).toContain("column_default = 'now()'");
    expect(VERIFICATION).toContain("table_name = 'conversation_participants' and column_name = 'last_read_at'");
    expect(VERIFICATION).toContain("not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles')");
  });

  it("le registre cite 0043 « à appliquer », son fichier de vérification, et ce qui se passe sans elle", () => {
    expect(REGISTRY).toMatch(/^\| 0043 \| Confirmations de lecture des messages privés[^|]*\| \*\*à appliquer\*\* \(sur spotto-dev-2 d'abord ; demande 0032, déjà en production\) \| — \|$/m);
    expect(REGISTRY).toContain("| 0043 | le fichier de la migration lui-même (**après 0032**) | `supabase/verifications/0043-verification.sql` (une ligne, six `true`) | en tête du fichier de la migration |");
    // Ce que la date « depuis » garantit, dit dans le registre aussi.
    expect(REGISTRY).toContain("le moment à partir duquel ses lectures peuvent être montrées (jamais une lecture d'avant la migration, ni une lecture faite pendant que le réglage était éteint)");
    expect(REGISTRY).toContain("Sans 0043, personne ne voit « Vu » ni « Envoyé » sous ses messages, et l'app ne propose pas le réglage « Confirmations de lecture »");
    // Une seule ligne par tableau.
    expect(REGISTRY.match(/^\| 0043 \|/gm)).toHaveLength(2);
  });
});
