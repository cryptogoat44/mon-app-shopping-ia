const { getSentryExpoConfig } = require("@sentry/react-native/metro");

// Expo détecte automatiquement le monorepo (pnpm workspace) et résout les
// packages partagés (@monapp/shared-types) sans configuration supplémentaire.
//
// Lot « app iPhone prête » (chantier 4, point 11) : la configuration Expo de
// Sentry ajoute un identifiant de débogage (« Debug ID ») au code de l'app et
// à ses sourcemaps ; les builds iPhone envoient ces fichiers à Sentry, qui
// rend alors les plantages lisibles. Rien n'est envoyé d'ici : seulement
// pendant un build EAS, avec le jeton SENTRY_AUTH_TOKEN saisi chez Expo.
// Le site garde sa propre version (injectReleaseForWeb coupé : inchangé).
module.exports = getSentryExpoConfig(__dirname, { injectReleaseForWeb: false });
