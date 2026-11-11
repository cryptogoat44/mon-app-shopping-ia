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
// - avec la clé SECRÈTE du widget anti-robots à la place de sa clé publique ;
// - pour le profil « production » (App Store) seulement, avec un texte
//   provisoire visible dans l'app (règle 2.1 (a) d'Apple : « placeholder
//   text […] should be scrubbed before submission ») : un des cinq réglages
//   de l'identité de l'éditeur absent (les pages légales afficheraient
//   « [À compléter : …] »), ou un passage entre crochets resté dans les
//   textes légaux (apps/mobile/src/legal, lus directement dans les fichiers
//   sources). Pour « preview » (TestFlight), les mêmes constats ne sont que
//   des avertissements : le build continue.
// Profils « development » : rien à vérifier (le code vient du Mac).
// Aucune valeur n'est jamais affichée : seulement les noms des réglages et
// des fichiers. Sans dépendance (il tourne avant l'installation : seulement
// les modules de Node) ; testé par vitest.
const fs = require("node:fs");
const path = require("node:path");

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

/** L'identité de l'éditeur, affichée dans les pages légales et la page d'aide
 * (src/legal/publisher.ts). Le dépôt est public : ces coordonnées ne sont
 * saisies que chez Expo (et chez Render pour le site). */
const REGLAGES_EDITEUR = [
  "EXPO_PUBLIC_PUBLISHER_NAME",
  "EXPO_PUBLIC_PUBLISHER_STATUS",
  "EXPO_PUBLIC_PUBLISHER_ADDRESS",
  "EXPO_PUBLIC_PUBLISHER_EMAIL",
  "EXPO_PUBLIC_PUBLISHER_PHONE",
];
/** Les textes légaux de l'app (fichiers sources). */
const DOSSIER_LEGAL = path.join(__dirname, "..", "src", "legal");
/** Débuts des passages laissés au fondateur ou à son avocat : la même
 * famille que PLACEHOLDER_PATTERN (src/legal/types.ts). */
const CROCHETS = ["[À compléter", "[À décider", "[À vérifier", "[To be completed", "[To be decided", "[To be verified"];

/** Nombre de passages provisoires dans le texte d'un fichier source. Ne
 * comptent pas : les commentaires (lignes « // » et blocs « /* … *\/ » : ils
 * ne sont jamais affichés), ni, dans publisher.ts, les textes de repli des
 * cinq réglages de l'éditeur (le bloc « const PLACEHOLDERS ») : ils ne
 * s'affichent que si un réglage manque, ce que ce contrôle arrête déjà. */
function passagesProvisoires(texte, nomFichier) {
  let total = 0;
  let commentaire = false;
  let repli = false;
  for (const ligne of texte.split("\n")) {
    const debut = ligne.trim();
    if (commentaire) {
      if (debut.includes("*/")) commentaire = false;
      continue;
    }
    if (debut.startsWith("//")) continue;
    if (debut.startsWith("/*")) {
      commentaire = !debut.includes("*/");
      continue;
    }
    if (repli) {
      if (debut === "};") repli = false;
      continue;
    }
    if (nomFichier === "publisher.ts" && /^const PLACEHOLDERS\b/.test(debut)) {
      repli = true;
      continue;
    }
    for (const crochet of CROCHETS) total += ligne.split(crochet).length - 1;
  }
  return total;
}

/** Fichiers de `dossier` (sous-dossiers compris) où il reste un passage
 * provisoire, par ordre alphabétique : leur chemin dans le dossier et le
 * nombre de passages — jamais le texte lui-même. `illisible` : le dossier
 * n'a pas pu être lu (le contrôle n'a rien pu vérifier). */
function textesInacheves(dossier) {
  const fichiers = [];
  function parcourir(courant, prefixe) {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) parcourir(chemin, `${prefixe}${entree.name}/`);
      else if (/\.(ts|tsx|js|jsx|json|md|txt)$/.test(entree.name)) {
        const passages = passagesProvisoires(fs.readFileSync(chemin, "utf8"), entree.name);
        if (passages > 0) fichiers.push({ nom: `${prefixe}${entree.name}`, passages });
      }
    }
  }
  try {
    parcourir(dossier, "");
  } catch {
    return { illisible: true, fichiers: [] };
  }
  return { illisible: false, fichiers };
}

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

/** Problèmes du build décrit par ces variables : erreurs (build arrêté) et
 * avertissements. `dossierLegal` : le dossier des textes légaux à lire
 * (celui de l'app quand le script est lancé par EAS) ; sans lui, les textes
 * ne sont pas lus (tests des seuls réglages). */
function problemesBuild(env, dossierLegal) {
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

  // Textes provisoires (règle 2.1 (a) d'Apple). « production » : build
  // arrêté. « preview » : avertissement, le build continue.
  const provisoire = (message) => {
    if (profil === "production") erreurs.push(message);
    else avertissements.push(`${message} Ce build « ${profil} » continue ; un build « production » serait arrêté.`);
  };
  const refusApple = "Apple refuse tout texte provisoire (règle 2.1)";
  // Un réglage vide, ou rempli avec un texte entre crochets, laisse un texte provisoire à l'écran.
  const incomplets = REGLAGES_EDITEUR.filter((nom) => vide(env[nom]) || CROCHETS.some((crochet) => env[nom].includes(crochet)));
  if (incomplets.length > 0) {
    provisoire(
      `Identité de l'éditeur incomplète : ${incomplets.join(", ")} ${incomplets.length > 1 ? "manquent" : "manque"} ${chezExpo}. Sans ${incomplets.length > 1 ? "eux" : "lui"}, les pages légales et la page d'aide affichent « [À compléter : …] » à la place de vos coordonnées. ${refusApple}.`
    );
  }
  if (dossierLegal !== undefined) {
    const { illisible, fichiers } = textesInacheves(dossierLegal);
    if (illisible) {
      provisoire(`Le dossier des textes légaux (apps/mobile/src/legal) est introuvable ou illisible : impossible de vérifier qu'il n'y reste aucun texte provisoire.`);
    } else if (fichiers.length > 0) {
      const liste = fichiers.map(({ nom, passages }) => `${nom} (${passages} passage${passages > 1 ? "s" : ""})`).join(", ");
      provisoire(
        `Textes légaux inachevés : des passages entre crochets (« [À compléter », « [À vérifier », « [To be completed », « [To be verified »…) restent dans apps/mobile/src/legal — ${liste}. ${refusApple} : faites valider ces textes, puis faites retirer les crochets.`
      );
    }
  }
  return { erreurs, avertissements };
}

module.exports = { problemesBuild, textesInacheves, passagesProvisoires, REGLAGES_EDITEUR, DOSSIER_LEGAL };

if (require.main === module) {
  const { erreurs, avertissements } = problemesBuild(process.env, DOSSIER_LEGAL);
  for (const message of avertissements) console.warn(`⚠️  Spotto — ${message}`);
  if (erreurs.length > 0) {
    console.error("\n❌ Build iPhone arrêté avant de commencer : réglages ou textes à corriger.\n");
    for (const message of erreurs) console.error(`   • ${message}`);
    console.error("\n   Marche à suivre : apps/mobile/BUILD-IPHONE.md\n");
    process.exit(1);
  }
  console.log(`✅ Spotto — réglages et textes du build « ${process.env.EAS_BUILD_PROFILE || "?"} » vérifiés.`);
}
