const { getDefaultConfig } = require("expo/metro-config");

// Expo détecte automatiquement le monorepo (pnpm workspace) et résout les
// packages partagés (@monapp/shared-types) sans configuration supplémentaire.
module.exports = getDefaultConfig(__dirname);
