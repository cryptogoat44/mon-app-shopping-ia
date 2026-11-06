// Contrôle au tout début d'un build EAS (lot « app iPhone prête », chantier 4).
// Lancé par EAS avant l'installation (script « eas-build-pre-install » de
// package.json), il arrête en une minute, avec un message clair en français,
// un build iPhone qui serait inutilisable ou dangereux :
// - sans l'adresse du serveur, ni l'adresse et la clé publique de spotto-prod
//   (variables d'environnement saisies chez Expo, BUILD-IPHONE.md) ;
// - visant encore l'ancien projet Supabase (personne ne pourrait se connecter) ;
// - avec une clé SECRÈTE de Supabase à la place de la clé publique (elle
//   serait lisible par tous dans l'app) ;
// - sans le jeton Sentry qui rend les plantages lisibles (sauf si
//   SENTRY_DISABLE_AUTO_UPLOAD vaut « true », choix assumé d'un build d'essai).
// Profils « development » : rien à vérifier (le code vient du Mac).
// Aucune valeur n'est jamais affichée : seulement les noms des réglages.
// Sans dépendance (il tourne avant l'installation) ; testé par vitest.

/** Ancien projet Supabase (« l'ancienne PRODUCTION ») : plus personne n'y a de compte. */
const ANCIEN_PROJET = "qcwnlqkxnhqpyjpkooiw";
const PROFILS_VERIFIES = ["preview", "production"];

function vide(valeur) {
  return typeof valeur !== "string" || valeur.trim() === "";
}

/** Rôle d'une clé au format JWT (anciennes clés Supabase), sinon null. */
function roleJwt(cle) {
  const parties = cle.split(".");
  if (parties.length !== 3) return null;
  try {
    const charge = JSON.parse(Buffer.from(parties[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof charge.role === "string" ? charge.role : null;
  } catch {
    return null;
  }
}

/** Problèmes du build décrit par ces variables : erreurs (build arrêté) et avertissements. */
function problemesBuild(env) {
  const profil = env.EAS_BUILD_PROFILE || "";
  const erreurs = [];
  const avertissements = [];
  if (!PROFILS_VERIFIES.includes(profil)) return { erreurs, avertissements };
  const chezExpo = `chez Expo (expo.dev → projet Spotto → Environment variables, environnement « ${profil} »)`;

  for (const nom of ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"]) {
    if (vide(env[nom])) erreurs.push(`${nom} manque : saisissez-la ${chezExpo}.`);
  }

  const supabase = (env.EXPO_PUBLIC_SUPABASE_URL || "").trim();
  if (supabase) {
    if (supabase.includes(ANCIEN_PROJET)) {
      erreurs.push("EXPO_PUBLIC_SUPABASE_URL vise l'ancien projet Supabase : mettez l'adresse de spotto-prod.");
    } else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(supabase)) {
      erreurs.push("EXPO_PUBLIC_SUPABASE_URL n'a pas la forme attendue (https://<identifiant>.supabase.co).");
    }
  }

  const api = (env.EXPO_PUBLIC_API_URL || "").trim();
  if (api && !api.startsWith("https://")) erreurs.push("EXPO_PUBLIC_API_URL doit commencer par https://.");

  const cle = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (cle && (cle.startsWith("sb_secret_") || roleJwt(cle) === "service_role")) {
    erreurs.push(
      "EXPO_PUBLIC_SUPABASE_ANON_KEY contient une clé SECRÈTE de Supabase : remplacez-la par la clé publique (« publishable » ou « anon »), puis changez cette clé secrète dans Supabase."
    );
  }

  if (env.SENTRY_DISABLE_AUTO_UPLOAD !== "true") {
    const jeton = (env.SENTRY_AUTH_TOKEN || "").trim();
    if (!jeton) {
      erreurs.push(
        `SENTRY_AUTH_TOKEN manque : saisissez ${chezExpo} le jeton d'organisation Sentry (visibilité « Secret »). Pour un build d'essai sans rapports de plantage lisibles, mettez plutôt SENTRY_DISABLE_AUTO_UPLOAD = true dans cet environnement.`
      );
    } else if (!jeton.startsWith("sntrys_")) {
      erreurs.push("SENTRY_AUTH_TOKEN doit être un jeton d'ORGANISATION Sentry (il commence par « sntrys_ ») : Sentry → Settings → Developer Settings → Organization Tokens.");
    }
  } else if (profil === "production") {
    avertissements.push("SENTRY_DISABLE_AUTO_UPLOAD vaut true : les plantages de ce build App Store seront illisibles dans Sentry.");
  }

  for (const nom of ["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_POSTHOG_KEY", "EXPO_PUBLIC_WEB_URL", "EXPO_PUBLIC_ENVIRONMENT"]) {
    if (vide(env[nom])) avertissements.push(`${nom} absente ${chezExpo} : la fonction correspondante sera coupée dans ce build.`);
  }
  return { erreurs, avertissements };
}

module.exports = { problemesBuild };

if (require.main === module) {
  const { erreurs, avertissements } = problemesBuild(process.env);
  for (const message of avertissements) console.warn(`⚠️  Spotto — ${message}`);
  if (erreurs.length > 0) {
    console.error("\n❌ Build iPhone arrêté avant de commencer : réglages à corriger chez Expo.\n");
    for (const message of erreurs) console.error(`   • ${message}`);
    console.error("\n   Marche à suivre : apps/mobile/BUILD-IPHONE.md\n");
    process.exit(1);
  }
  console.log(`✅ Spotto — réglages du build « ${process.env.EAS_BUILD_PROFILE || "?"} » vérifiés.`);
}
