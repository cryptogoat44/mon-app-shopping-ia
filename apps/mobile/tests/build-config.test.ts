import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Lot « app iPhone prête » (chantier 4, points 2 et 11) : réglages des builds
// iPhone. Les adresses et la clé publique ne sont plus écrites dans eas.json :
// elles viennent des variables d'environnement saisies chez Expo, les seules
// que lisent aussi les mises à jour à distance (eas update). Un contrôle au
// début de chaque build EAS arrête un build inutilisable ou dangereux.
const require = createRequire(import.meta.url);
const { problemesBuild, textesInacheves, passagesProvisoires, REGLAGES_EDITEUR, DOSSIER_LEGAL } = require("../scripts/verifier-build.js");

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const eas = JSON.parse(lire("../eas.json"));
const expo = JSON.parse(lire("../app.json")).expo;
const mobile = JSON.parse(lire("../package.json"));
const racine = JSON.parse(lire("../../../package.json"));

/** Profil de build avec ce dont il hérite (« extends »). */
function profil(nom: string): Record<string, unknown> {
  const brut = eas.build[nom];
  return brut.extends ? { ...profil(brut.extends), ...brut, env: { ...(profil(brut.extends).env as object), ...brut.env } } : brut;
}

describe("eas.json", () => {
  it("aucune adresse ni clé écrite en dur : ni l'ancien projet Supabase, ni aucune variable EXPO_PUBLIC_", () => {
    expect(lire("../eas.json")).not.toContain("qcwnlqkxnhqpyjpkooiw");
    expect(lire("../eas.json")).not.toContain("EXPO_PUBLIC_");
  });

  it("chaque profil vise son environnement EAS et son canal de mises à jour", () => {
    for (const [nom, attendu] of [
      ["development", "development"],
      ["development-simulator", "development"],
      ["preview", "preview"],
      ["production", "production"],
    ]) {
      expect(profil(nom!).environment).toBe(attendu);
      expect(profil(nom!).channel).toBe(attendu);
    }
  });

  it("versions de Node et de pnpm : celles du projet (.node-version, packageManager)", () => {
    for (const nom of ["development", "development-simulator", "preview", "production"]) {
      expect(profil(nom).node).toBe(lire("../../../.node-version").trim());
      expect(`pnpm@${profil(nom).pnpm}`).toBe(racine.packageManager);
    }
  });

  it("développement : installable sur un vrai iPhone ; une variante pour le simulateur", () => {
    expect(profil("development")).toMatchObject({ developmentClient: true, distribution: "internal" });
    expect((profil("development").ios as { simulator?: boolean } | undefined)?.simulator).not.toBe(true);
    expect(profil("development-simulator").ios).toEqual({ simulator: true });
    // Pas d'envoi à Sentry pour un build de développement (le code vient du Mac).
    expect((profil("development").env as Record<string, string>).SENTRY_DISABLE_AUTO_UPLOAD).toBe("true");
  });

  it("preview (TestFlight) et production (App Store) : distribution « store », numéro de build incrémenté par EAS", () => {
    for (const nom of ["preview", "production"]) expect(profil(nom)).toMatchObject({ distribution: "store", autoIncrement: true });
    expect(eas.cli.appVersionSource).toBe("remote");
  });

  it("le contrôle de début de build est branché", () => {
    expect(mobile.scripts["eas-build-pre-install"]).toBe("node scripts/verifier-build.js");
  });
});

describe("app.json : mises à jour à distance et plantages lisibles", () => {
  it("expo-updates : version figée de SDK 57, version d'exécution liée à la version de l'app", () => {
    expect(mobile.dependencies["expo-updates"]).toBe("57.0.24");
    expect(expo.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(expo.updates).toMatchObject({ checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 });
  });

  it("Sentry : module Expo réglé pour la région UE et le projet de l'app (le jeton reste chez Expo)", () => {
    const sentry = expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo");
    expect(sentry?.[1]).toEqual({ url: "https://de.sentry.io/", project: "4512173801996368" });
    expect(JSON.stringify(expo)).not.toMatch(/sntry[su]_|authToken/);
    expect(lire("../metro.config.js")).toContain("getSentryExpoConfig");
  });
});

describe("contrôle au début d'un build EAS (scripts/verifier-build.js)", () => {
  const BON = {
    EAS_BUILD_PROFILE: "production",
    EXPO_PUBLIC_API_URL: "https://spotto-api.onrender.com",
    EXPO_PUBLIC_SUPABASE_URL: "https://selhqdqfrflsqivgxypf.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_cle-factice",
    EXPO_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.de.sentry.io/2",
    EXPO_PUBLIC_POSTHOG_KEY: "phc_factice",
    EXPO_PUBLIC_WEB_URL: "https://exemple.test",
    EXPO_PUBLIC_ENVIRONMENT: "production",
    // Clé publique de test documentée par Cloudflare (24 caractères).
    EXPO_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    SENTRY_AUTH_TOKEN: "sntrys_factice",
    // Identité de l'éditeur (lot « conformité Apple ») : valeurs factices.
    EXPO_PUBLIC_PUBLISHER_NAME: "Nom Factice",
    EXPO_PUBLIC_PUBLISHER_STATUS: "statut factice",
    EXPO_PUBLIC_PUBLISHER_ADDRESS: "1 rue Factice, 75000 Paris",
    EXPO_PUBLIC_PUBLISHER_EMAIL: "contact@exemple.test",
    EXPO_PUBLIC_PUBLISHER_PHONE: "+33 1 00 00 00 00",
  };

  it("réglages complets : rien à signaler ; profil de développement : rien n'est vérifié", () => {
    expect(problemesBuild(BON)).toEqual({ erreurs: [], avertissements: [] });
    expect(problemesBuild({ EAS_BUILD_PROFILE: "development" })).toEqual({ erreurs: [], avertissements: [] });
  });

  it("adresses ou clé publique absentes : build arrêté, avec le nom de chaque réglage", () => {
    const { erreurs } = problemesBuild({ EAS_BUILD_PROFILE: "preview", SENTRY_AUTH_TOKEN: "sntrys_x" });
    expect(erreurs.join("\n")).toMatch(/EXPO_PUBLIC_API_URL manque[\s\S]*EXPO_PUBLIC_SUPABASE_URL manque[\s\S]*EXPO_PUBLIC_SUPABASE_ANON_KEY manque/);
    expect(erreurs[0]).toContain("« preview »");
  });

  it("ancien projet Supabase, adresse mal formée ou serveur sans https : build arrêté", () => {
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: "https://qcwnlqkxnhqpyjpkooiw.supabase.co" }).erreurs[0]).toContain("ancien projet");
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: "https://exemple.com" }).erreurs[0]).toContain("forme attendue");
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_API_URL: "http://localhost:3000" }).erreurs[0]).toContain("https://");
  });

  // Lot « nettoyage avant le premier build » : un build destiné à Apple ne
  // vise que spotto-prod, jamais la base de test ni une autre base.
  const DEV2 = "https://sedfepcpmhilaxbrgdif.supabase.co";
  const jwt = (charge: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.signature`;

  it("spotto-prod, avec ou sans « / » final : accepté pour preview comme pour production", () => {
    for (const profil of ["preview", "production"]) {
      for (const adresse of ["https://selhqdqfrflsqivgxypf.supabase.co", "https://selhqdqfrflsqivgxypf.supabase.co/", "  https://selhqdqfrflsqivgxypf.supabase.co  "]) {
        expect(problemesBuild({ ...BON, EAS_BUILD_PROFILE: profil, EXPO_PUBLIC_ENVIRONMENT: "x", EXPO_PUBLIC_SUPABASE_URL: adresse }).erreurs, `${profil} ${adresse}`).toEqual([]);
      }
    }
  });

  it("base de TEST (spotto-dev-2) : build arrêté, pour preview comme pour production, avec un message qui la nomme — sans afficher l'adresse", () => {
    for (const profil of ["preview", "production"]) {
      for (const adresse of [DEV2, `${DEV2}/`]) {
        const { erreurs } = problemesBuild({ ...BON, EAS_BUILD_PROFILE: profil, EXPO_PUBLIC_SUPABASE_URL: adresse });
        expect(erreurs).toHaveLength(1);
        expect(erreurs[0]).toContain("EXPO_PUBLIC_SUPABASE_URL vise spotto-dev-2, la base de TEST");
        expect(erreurs[0]).toContain("spotto-prod");
        expect(erreurs[0]).toContain(`« ${profil} »`);
        expect(erreurs[0]).not.toContain("sedfepcpmhilaxbrgdif");
      }
    }
  });

  it("toute autre base que spotto-prod : build arrêté, sans afficher l'adresse saisie", () => {
    for (const adresse of ["https://abcdefghijklmnopqrst.supabase.co", "https://selhqdqfrflsqivgxypg.supabase.co", "https://selhqdqfrflsqivgxypf.supabase.co/rest"]) {
      const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: adresse });
      expect(erreurs, adresse).toHaveLength(1);
      expect(erreurs[0]).toMatch(/ne vise pas spotto-prod|forme attendue/);
      expect(erreurs[0]).not.toContain(adresse.slice(8, 28));
    }
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }).erreurs[0]).toContain("ne vise pas spotto-prod");
    // Une adresse qui contient spotto-prod sans l'être : refusée aussi.
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: "https://selhqdqfrflsqivgxypf.supabase.co.exemple.com" }).erreurs[0]).toContain("forme attendue");
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: "http://selhqdqfrflsqivgxypf.supabase.co" }).erreurs[0]).toContain("forme attendue");
  });

  it("profils de développement : la base de test reste permise (rien n'est vérifié)", () => {
    for (const profil of ["development", "development-simulator", ""]) {
      expect(problemesBuild({ EAS_BUILD_PROFILE: profil, EXPO_PUBLIC_SUPABASE_URL: DEV2 })).toEqual({ erreurs: [], avertissements: [] });
    }
  });

  it("clé publique au format JWT : son projet (« ref ») doit être spotto-prod ; la clé n'est jamais affichée", () => {
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ iss: "supabase", ref: "selhqdqfrflsqivgxypf", role: "anon" }) }).erreurs).toEqual([]);
    for (const [charge, attendu] of [
      [{ iss: "supabase", ref: "sedfepcpmhilaxbrgdif", role: "anon" }, "de spotto-dev-2, la base de TEST"],
      [{ iss: "supabase", ref: "qcwnlqkxnhqpyjpkooiw", role: "anon" }, "de l'ancien projet Supabase"],
      [{ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "anon" }, "d'un autre projet que spotto-prod"],
      // Sans « ref » : pas la clé d'un projet Supabase en ligne.
      [{ role: "anon" }, "d'un autre projet que spotto-prod"],
    ] as const) {
      const cle = jwt(charge);
      const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: cle });
      expect(erreurs, attendu).toHaveLength(1);
      expect(erreurs[0]).toContain(`EXPO_PUBLIC_SUPABASE_ANON_KEY est la clé publique ${attendu}`);
      expect(erreurs[0]).not.toContain(cle);
      expect(erreurs[0]).not.toContain(cle.split(".")[1]);
    }
  });

  it("adresse ET clé de la base de test : les deux erreurs, l'adresse d'abord", () => {
    const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_URL: DEV2, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: "sedfepcpmhilaxbrgdif", role: "anon" }) });
    expect(erreurs).toHaveLength(2);
    expect(erreurs[0]).toContain("EXPO_PUBLIC_SUPABASE_URL vise spotto-dev-2");
    expect(erreurs[1]).toContain("EXPO_PUBLIC_SUPABASE_ANON_KEY est la clé publique de spotto-dev-2");
  });

  it("clé « sb_publishable_… » : elle ne dit pas son projet, le contrôle ne peut pas la vérifier (acceptée)", () => {
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_cle-d-un-projet-inconnu" }).erreurs).toEqual([]);
  });

  it("clé SECRÈTE de Supabase à la place de la clé publique : build arrêté, sans jamais afficher la clé", () => {
    const charge = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    for (const cle of ["sb_secret_abcdef", `eyJhbGciOiJIUzI1NiJ9.${charge}.signature`]) {
      const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: cle });
      expect(erreurs).toHaveLength(1);
      expect(erreurs[0]).toContain("SECRÈTE");
      expect(erreurs[0]).not.toContain(cle);
    }
    // Clé « anon » de spotto-prod : publique, acceptée. Clé secrète de spotto-prod : toujours refusée.
    const anon = Buffer.from(JSON.stringify({ ref: "selhqdqfrflsqivgxypf", role: "anon" })).toString("base64url");
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: `eyJ.${anon}.sig` }).erreurs).toEqual([]);
    const secreteProd = Buffer.from(JSON.stringify({ ref: "selhqdqfrflsqivgxypf", role: "service_role" })).toString("base64url");
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: `eyJ.${secreteProd}.sig` }).erreurs[0]).toContain("SECRÈTE");
  });

  it("Sentry : jeton d'organisation exigé, sauf build d'essai assumé (SENTRY_DISABLE_AUTO_UPLOAD)", () => {
    expect(problemesBuild({ ...BON, SENTRY_AUTH_TOKEN: "" }).erreurs[0]).toContain("SENTRY_AUTH_TOKEN manque");
    expect(problemesBuild({ ...BON, SENTRY_AUTH_TOKEN: "sntryu_perso" }).erreurs[0]).toContain("ORGANISATION");
    const essai = problemesBuild({ ...BON, EAS_BUILD_PROFILE: "preview", SENTRY_AUTH_TOKEN: "", SENTRY_DISABLE_AUTO_UPLOAD: "true" });
    expect(essai).toEqual({ erreurs: [], avertissements: [] });
    expect(problemesBuild({ ...BON, SENTRY_AUTH_TOKEN: "", SENTRY_DISABLE_AUTO_UPLOAD: "true" }).avertissements[0]).toContain("illisibles");
  });

  it("anti-robots (point 17) : clé absente, simple avertissement ; clé secrète à la place de la clé publique, build arrêté sans l'afficher", () => {
    const sans = problemesBuild({ ...BON, EXPO_PUBLIC_TURNSTILE_SITE_KEY: "" });
    expect(sans.erreurs).toEqual([]);
    expect(sans.avertissements).toHaveLength(1);
    expect(sans.avertissements[0]).toContain("anti-robots");
    const secrete = "1x0000000000000000000000000000000AA";
    const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_TURNSTILE_SITE_KEY: secrete });
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("SECRÈTE");
    expect(erreurs[0]).not.toContain(secrete);
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_TURNSTILE_SITE_KEY: "<cle>" }).erreurs[0]).toContain("forme");
  });

  it("réglages facultatifs absents : simple avertissement", () => {
    const { erreurs, avertissements } = problemesBuild({ ...BON, EXPO_PUBLIC_POSTHOG_KEY: "" });
    expect(erreurs).toEqual([]);
    expect(avertissements[0]).toContain("EXPO_PUBLIC_POSTHOG_KEY");
  });

  // Lot « conformité Apple » : règle 2.1 (a) d'Apple, aucun texte provisoire.
  describe("textes provisoires : build « production » arrêté, simple avertissement pour « preview »", () => {
    const dossiers: string[] = [];
    /** Un faux dossier de textes légaux, avec ces fichiers. */
    function dossier(fichiers: Record<string, string>): string {
      const racineTest = mkdtempSync(join(tmpdir(), "textes-legaux-"));
      dossiers.push(racineTest);
      for (const [nom, contenu] of Object.entries(fichiers)) {
        mkdirSync(join(racineTest, nom, ".."), { recursive: true });
        writeFileSync(join(racineTest, nom), contenu);
      }
      return racineTest;
    }
    const PROPRE = { "conditions.ts": 'export const TEXTE = "Texte validé.";\n' };
    const SECRET = "Société Très Secrète";

    it("identité de l'éditeur : un réglage absent, vide ou encore entre crochets arrête le build de production, sans afficher aucune valeur", () => {
      expect(REGLAGES_EDITEUR).toEqual(["NAME", "STATUS", "ADDRESS", "EMAIL", "PHONE"].map((nom) => `EXPO_PUBLIC_PUBLISHER_${nom}`));
      for (const nom of REGLAGES_EDITEUR) {
        for (const valeur of [undefined, "", "   ", "[À compléter : plus tard]"]) {
          const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_PUBLISHER_NAME: SECRET, [nom]: valeur }, dossier(PROPRE));
          expect(erreurs, `${nom} = ${valeur}`).toHaveLength(1);
          expect(erreurs[0]).toContain("Identité de l'éditeur incomplète");
          expect(erreurs[0]).toContain(`${nom} manque chez Expo`);
          expect(erreurs[0]).toContain("environnement « production »");
          expect(erreurs[0]).toContain("règle 2.1");
          expect(erreurs[0]).not.toContain(SECRET);
          expect(erreurs[0]).not.toContain("plus tard");
          expect(erreurs[0]).not.toContain("exemple.test");
        }
      }
      const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_PUBLISHER_EMAIL: "", EXPO_PUBLIC_PUBLISHER_PHONE: "" }, dossier(PROPRE));
      expect(erreurs).toHaveLength(1);
      expect(erreurs[0]).toContain("EXPO_PUBLIC_PUBLISHER_EMAIL, EXPO_PUBLIC_PUBLISHER_PHONE manquent");
    });

    it("identité de l'éditeur : pour « preview », le même constat n'est qu'un avertissement ; rien pour « development »", () => {
      const { erreurs, avertissements } = problemesBuild({ ...BON, EAS_BUILD_PROFILE: "preview", EXPO_PUBLIC_PUBLISHER_PHONE: "" }, dossier(PROPRE));
      expect(erreurs).toEqual([]);
      expect(avertissements).toHaveLength(1);
      expect(avertissements[0]).toContain("EXPO_PUBLIC_PUBLISHER_PHONE manque");
      expect(avertissements[0]).toContain("Ce build « preview » continue ; un build « production » serait arrêté.");
      expect(problemesBuild({ EAS_BUILD_PROFILE: "development" }, dossier({ "conditions.ts": '"[À compléter : tout]"' }))).toEqual({ erreurs: [], avertissements: [] });
    });

    it("textes légaux : chaque crochet resté arrête le build de production, avec la liste des fichiers et jamais leur texte", () => {
      for (const crochet of ["[À compléter", "[À vérifier", "[To be completed", "[To be verified", "[À décider", "[To be decided"]) {
        const { erreurs } = problemesBuild(BON, dossier({ "conditions.ts": `export const T = "Délai : ${crochet} : phrase à garder secrète]";\n` }));
        expect(erreurs, crochet).toHaveLength(1);
        expect(erreurs[0]).toContain("Textes légaux inachevés");
        expect(erreurs[0]).toContain("apps/mobile/src/legal — conditions.ts (1 passage)");
        expect(erreurs[0]).toContain("règle 2.1");
        expect(erreurs[0]).not.toContain("phrase à garder secrète");
      }
      const plusieurs = dossier({
        "confidentialite.ts": 'const A = "[À vérifier : a]";\nconst B = "[À vérifier : b] et [À compléter : c]";\n',
        "conditions.en.ts": 'const A = "[To be completed: a]";\n',
        "en/annexe.ts": 'const A = "[To be verified: a]";\n',
        "propre.ts": 'const A = "Rien à signaler [entre crochets ordinaires].";\n',
      });
      expect(textesInacheves(plusieurs)).toEqual({
        illisible: false,
        fichiers: [
          { nom: "conditions.en.ts", passages: 1 },
          { nom: "confidentialite.ts", passages: 3 },
          { nom: "en/annexe.ts", passages: 1 },
        ],
      });
      expect(problemesBuild(BON, plusieurs).erreurs[0]).toContain("conditions.en.ts (1 passage), confidentialite.ts (3 passages), en/annexe.ts (1 passage)");
    });

    it("textes légaux : pour « preview », avertissement seulement ; textes propres, rien à signaler", () => {
      const inacheve = dossier({ "conditions.ts": 'const T = "[À compléter : délais]";\n' });
      const preview = problemesBuild({ ...BON, EAS_BUILD_PROFILE: "preview" }, inacheve);
      expect(preview.erreurs).toEqual([]);
      expect(preview.avertissements).toHaveLength(1);
      expect(preview.avertissements[0]).toContain("Textes légaux inachevés");
      expect(preview.avertissements[0]).toContain("Ce build « preview » continue");
      expect(problemesBuild(BON, dossier(PROPRE))).toEqual({ erreurs: [], avertissements: [] });
      expect(problemesBuild({ ...BON, EAS_BUILD_PROFILE: "preview" }, dossier(PROPRE))).toEqual({ erreurs: [], avertissements: [] });
    });

    it("ne comptent pas : les commentaires, ni les textes de repli des cinq réglages de l'éditeur (déjà couverts par le contrôle des réglages)", () => {
      const publisher = [
        "// Une variable absente affiche « [À compléter : …] ».",
        "const PLACEHOLDERS = {",
        '  fr: { name: "[À compléter : nom de l\'éditeur]" },',
        '  en: { name: "[To be completed: publisher\'s name]" },',
        "};",
        "/** Complète par « [À compléter : …] »",
        " * ou « [To be completed: …] ». */",
        "export const HOSTS = {",
        '  supabase: "Supabase — [À compléter : téléphone]",',
        "};",
      ].join("\n");
      expect(passagesProvisoires(publisher, "publisher.ts")).toBe(1);
      // Le même bloc dans un autre fichier n'est pas un texte de repli : il compte.
      expect(passagesProvisoires(publisher, "conditions.ts")).toBe(3);
      expect(passagesProvisoires('/* [À vérifier : x] */\nconst A = "ok";\n', "a.ts")).toBe(0);
    });

    it("dossier des textes introuvable : le build de production est arrêté (rien n'a pu être vérifié)", () => {
      const absent = join(tmpdir(), "textes-legaux-absents-" + Date.now());
      expect(textesInacheves(absent)).toEqual({ illisible: true, fichiers: [] });
      expect(problemesBuild(BON, absent).erreurs[0]).toContain("introuvable ou illisible");
      expect(problemesBuild({ ...BON, EAS_BUILD_PROFILE: "preview" }, absent).erreurs).toEqual([]);
    });

    it("lancé par EAS : le script lit les vrais textes de l'app, et son verdict suit leur état", () => {
      expect(existsSync(join(DOSSIER_LEGAL, "conditions.ts"))).toBe(true);
      expect(existsSync(join(DOSSIER_LEGAL, "confidentialite.ts"))).toBe(true);
      expect(lire("../scripts/verifier-build.js")).toContain("problemesBuild(process.env, DOSSIER_LEGAL)");
      // Sans dépendance : il tourne avant l'installation. Seuls sont permis
      // les modules de Node et le fichier unique de la marque — un fichier du
      // dépôt, lu par son chemin, pas un paquet à installer.
      const FICHIER_MARQUE = "../../../packages/shared-types/marque.json";
      const modules = [...lire("../scripts/verifier-build.js").matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
      expect(modules.every((nom) => nom!.startsWith("node:") || nom === FICHIER_MARQUE)).toBe(true);
      expect(modules).toContain(FICHIER_MARQUE);
      expect(existsSync(new URL(`../scripts/${FICHIER_MARQUE}`, import.meta.url))).toBe(true);

      const reste = textesInacheves(DOSSIER_LEGAL);
      expect(reste.illisible).toBe(false);
      const lancer = (profilBuild: string) =>
        spawnSync(process.execPath, ["scripts/verifier-build.js"], {
          cwd: new URL("..", import.meta.url),
          // Seulement ces réglages factices : rien de l'ordinateur qui lance les tests.
          env: { ...BON, EAS_BUILD_PROFILE: profilBuild, EXPO_PUBLIC_PUBLISHER_NAME: SECRET, PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
          encoding: "utf8",
        });
      const production = lancer("production");
      const preview = lancer("preview");
      // « preview » n'est jamais arrêté par des textes provisoires.
      expect(preview.status).toBe(0);
      if (reste.fichiers.length > 0) {
        // Tant que les textes légaux ne sont pas validés : build App Store arrêté, fichiers nommés.
        expect(production.status).toBe(1);
        expect(production.stderr).toContain("Build iPhone arrêté avant de commencer");
        for (const fichier of reste.fichiers) expect(production.stderr).toContain(`${fichier.nom} (${fichier.passages} passage`);
        expect(preview.stderr).toContain("Textes légaux inachevés");
      } else {
        expect(production.status).toBe(0);
      }
      for (const sortie of [production.stdout, production.stderr, preview.stdout, preview.stderr]) {
        expect(sortie).not.toContain(SECRET);
        expect(sortie).not.toContain("[À compléter :");
        expect(sortie).not.toContain("[À vérifier :");
      }
    });

    afterAll(() => {
      for (const racineTest of dossiers) rmSync(racineTest, { recursive: true, force: true });
    });
  });
});
