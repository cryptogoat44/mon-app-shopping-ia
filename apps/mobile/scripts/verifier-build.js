// Contrôle au tout début d'un build EAS (lot « app iPhone prête », chantier 4).
// Lancé par EAS avant l'installation (script « eas-build-pre-install » de
// package.json), il arrête en une minute, avec un message clair en français,
// un build iPhone qui serait inutilisable ou dangereux :
// - sans l'adresse du serveur, ni l'adresse et la clé publique de spotto-prod
//   (variables d'environnement saisies chez Expo, BUILD-IPHONE.md) ;
// - visant une autre base que spotto-prod : la base de TEST (spotto-dev-2),
//   l'ancien projet Supabase (personne ne pourrait se connecter), ou n'importe
//   quel autre projet — un build destiné à Apple ne vise que spotto-prod ;
// - avec la clé publique d'un autre projet que spotto-prod (quand la clé le
//   dit : voir projetDeLaCle plus bas) ;
// - avec une clé SECRÈTE de Supabase à la place de la clé publique (elle
//   serait lisible par tous dans l'app) ;
// - sans le jeton Sentry qui rend les plantages lisibles (sauf si
//   SENTRY_DISABLE_AUTO_UPLOAD vaut « true », choix assumé d'un build d'essai) ;
// - avec la clé SECRÈTE du widget anti-robots à la place de sa clé publique.
// Profils « development » : rien à vérifier (le code vient du Mac).
// Aucune valeur n'est jamais affichée : seulement les noms des réglages.
// Sans dépendance (il tourne avant l'installation) ; testé par vitest.

/** spotto-prod : la SEULE base permise pour un build destiné à Apple
 * (TestFlight comme App Store ; BUILD-IPHONE.md, section 2). Ces identifiants
 * de projet sont publics (ils figurent dans l'adresse) : ce ne sont pas des clés. */
const PROJET_PROD = "selhqdqfrflsqivgxypf";
const ADRESSE_PROD = `https://${PROJET_PROD}.supabase.co`;
/** spotto-dev-2, la base de TEST : jamais dans un build destiné à Apple. */
const PROJET_TEST = "sedfepcpmhilaxbrgdif";
/** Ancien projet Supabase (« l'ancienne PRODUCTION ») : plus personne n'y a de compte. */
const ANCIEN_PROJET = "qcwnlqkxnhqpyjpkooiw";
/** Les deux profils des builds destinés à Apple : tous deux visent spotto-prod. */
const PROFILS_VERIFIES = ["preview", "production"];

function vide(valeur) {
  return typeof valeur !== "string" || valeur.trim() === "";
}

/** Contenu d'une clé au format JWT (anciennes clés Supabase « anon » et
 * « service_role ») : son rôle et son projet (« ref »). Autre format : null.
 * Rien n'est vérifié ni affiché : la clé est seulement lue. */
function contenuJwt(cle) {
  const parties = cle.split(".");
  if (parties.length !== 3) return null;
  try {
    const charge = JSON.parse(Buffer.from(parties[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (typeof charge !== "object" || charge === null) return null;
    return { role: typeof charge.role === "string" ? charge.role : null, ref: typeof charge.ref === "string" ? charge.ref : null };
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
    const adresseProd = "l'adresse de spotto-prod (apps/mobile/BUILD-IPHONE.md, section 2)";
    if (supabase.includes(ANCIEN_PROJET)) {
      erreurs.push(`EXPO_PUBLIC_SUPABASE_URL vise l'ancien projet Supabase : mettez ${adresseProd}.`);
    } else if (supabase.includes(PROJET_TEST)) {
      erreurs.push(
        `EXPO_PUBLIC_SUPABASE_URL vise spotto-dev-2, la base de TEST : un build « ${profil} » part chez Apple et ne doit viser que spotto-prod. Mettez ${adresseProd} ${chezExpo}.`
      );
    } else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(supabase)) {
      erreurs.push("EXPO_PUBLIC_SUPABASE_URL n'a pas la forme attendue (https://<identifiant>.supabase.co).");
    } else if (supabase.replace(/\/$/, "") !== ADRESSE_PROD) {
      erreurs.push(`EXPO_PUBLIC_SUPABASE_URL ne vise pas spotto-prod : un build « ${profil} » ne doit viser aucune autre base. Mettez ${adresseProd} ${chezExpo}.`);
    }
  }

  const api = (env.EXPO_PUBLIC_API_URL || "").trim();
  if (api && !api.startsWith("https://")) erreurs.push("EXPO_PUBLIC_API_URL doit commencer par https://.");

  // La clé publique doit être celle du même projet que l'adresse : spotto-prod.
  // - Ancienne clé « anon » (un JWT) : elle porte l'identifiant de son projet
  //   (« ref »), comparé ici à spotto-prod. Sans « ref », ce n'est pas la clé
  //   d'un projet Supabase en ligne : refusée aussi.
  // - Nouvelle clé « sb_publishable_… » : elle ne dit PAS à quel projet elle
  //   appartient ; ce contrôle ne peut donc pas la vérifier. Une clé d'un
  //   autre projet se verrait au premier essai du build (connexion impossible).
  const cle = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const jwt = cle ? contenuJwt(cle) : null;
  if (cle && (cle.startsWith("sb_secret_") || jwt?.role === "service_role")) {
    erreurs.push(
      "EXPO_PUBLIC_SUPABASE_ANON_KEY contient une clé SECRÈTE de Supabase : remplacez-la par la clé publique (« publishable » ou « anon »), puis changez cette clé secrète dans Supabase."
    );
  } else if (jwt && jwt.ref !== PROJET_PROD) {
    const projet = jwt.ref === PROJET_TEST ? "de spotto-dev-2, la base de TEST" : jwt.ref === ANCIEN_PROJET ? "de l'ancien projet Supabase" : "d'un autre projet que spotto-prod";
    erreurs.push(
      `EXPO_PUBLIC_SUPABASE_ANON_KEY est la clé publique ${projet} : mettez la clé publique de spotto-prod (Supabase → spotto-prod → Project Settings → API Keys), ${chezExpo}.`
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

  // Protection anti-robots (point 17, ANTI-ROBOTS.md) : la clé PUBLIQUE du
  // widget Cloudflare Turnstile. Une clé publique fait 24 caractères, la clé
  // secrète bien plus : celle-ci ne va que dans Supabase, jamais dans l'app.
  const turnstile = (env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
  if (!turnstile) {
    avertissements.push(
      `EXPO_PUBLIC_TURNSTILE_SITE_KEY absente ${chezExpo} : ce build n'aura pas la protection anti-robots, et ne pourra plus ni se connecter ni créer de compte le jour où elle sera activée dans Supabase (apps/mobile/ANTI-ROBOTS.md).`
    );
  } else if (turnstile.length > 30) {
    erreurs.push(
      "EXPO_PUBLIC_TURNSTILE_SITE_KEY est plus longue qu'une clé publique Turnstile (24 caractères) : c'est sans doute la clé SECRÈTE. Mettez la « Site Key » ; la « Secret Key » ne va que dans Supabase (si elle a été publiée, changez-la dans Cloudflare)."
    );
  } else if (!/^[0-9A-Za-z_-]+$/.test(turnstile)) {
    erreurs.push("EXPO_PUBLIC_TURNSTILE_SITE_KEY n'a pas la forme d'une clé Turnstile (lettres, chiffres, « - » et « _ » seulement).");
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
