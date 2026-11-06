import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Lot « app iPhone prête » (chantier 4, points 2 et 11) : réglages des builds
// iPhone. Les adresses et la clé publique ne sont plus écrites dans eas.json :
// elles viennent des variables d'environnement saisies chez Expo, les seules
// que lisent aussi les mises à jour à distance (eas update). Un contrôle au
// début de chaque build EAS arrête un build inutilisable ou dangereux.
const require = createRequire(import.meta.url);
const { problemesBuild } = require("../scripts/verifier-build.js");

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
    SENTRY_AUTH_TOKEN: "sntrys_factice",
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

  it("clé SECRÈTE de Supabase à la place de la clé publique : build arrêté, sans jamais afficher la clé", () => {
    const charge = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    for (const cle of ["sb_secret_abcdef", `eyJhbGciOiJIUzI1NiJ9.${charge}.signature`]) {
      const { erreurs } = problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: cle });
      expect(erreurs).toHaveLength(1);
      expect(erreurs[0]).toContain("SECRÈTE");
      expect(erreurs[0]).not.toContain(cle);
    }
    const anon = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    expect(problemesBuild({ ...BON, EXPO_PUBLIC_SUPABASE_ANON_KEY: `eyJ.${anon}.sig` }).erreurs).toEqual([]);
  });

  it("Sentry : jeton d'organisation exigé, sauf build d'essai assumé (SENTRY_DISABLE_AUTO_UPLOAD)", () => {
    expect(problemesBuild({ ...BON, SENTRY_AUTH_TOKEN: "" }).erreurs[0]).toContain("SENTRY_AUTH_TOKEN manque");
    expect(problemesBuild({ ...BON, SENTRY_AUTH_TOKEN: "sntryu_perso" }).erreurs[0]).toContain("ORGANISATION");
    const essai = problemesBuild({ ...BON, EAS_BUILD_PROFILE: "preview", SENTRY_AUTH_TOKEN: "", SENTRY_DISABLE_AUTO_UPLOAD: "true" });
    expect(essai).toEqual({ erreurs: [], avertissements: [] });
    expect(problemesBuild({ ...BON, SENTRY_AUTH_TOKEN: "", SENTRY_DISABLE_AUTO_UPLOAD: "true" }).avertissements[0]).toContain("illisibles");
  });

  it("réglages facultatifs absents : simple avertissement", () => {
    const { erreurs, avertissements } = problemesBuild({ ...BON, EXPO_PUBLIC_POSTHOG_KEY: "" });
    expect(erreurs).toEqual([]);
    expect(avertissements[0]).toContain("EXPO_PUBLIC_POSTHOG_KEY");
  });
});
