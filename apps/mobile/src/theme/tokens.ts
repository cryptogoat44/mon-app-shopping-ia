// Tokens validés dans les maquettes Claude Design du projet "Spotto"
// (https://claude.ai/design — projet "Spotto"). Mode clair uniquement pour
// l'instant ; la structure est prête pour un mode sombre plus tard.

export const color = {
  porcelaine: "#FBFBFA", // fond de toute l'app
  plinthe: "#F1F1EE", // fond derrière les pièces photographiées uniquement — ne porte jamais de texte
  encre: "#1D1D1F", // texte principal
  acier: "#6E6E73", // texte secondaire, sur porcelaine uniquement (4,9:1 — AA)
  acierSurPlinthe: "#57575C", // à utiliser si un texte doit exceptionnellement apparaître sur plinthe (acier y descend à 4,48:1, sous le seuil AA)
  filet: "#E4E4E0", // séparateurs, bordures fines
  vert: "#1E3D32", // seul accent : action principale et marque « vérifié ». Nulle part ailleurs.
  blanc: "#FFFFFF",
} as const;

// Cinq tailles maximum, comme validé dans les maquettes.
export const font = {
  display: 34, // logotype, écran Bienvenue
  title: 23, // titres de sous-écrans (Newsreader)
  body: 17, // texte courant (police système)
  secondary: 15, // texte secondaire (police système, Acier)
  caption: 13, // légendes, prix (police système, Acier)
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24, // padding horizontal standard des écrans
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 4, // panneau « vitrine » des pièces — volontairement presque carré
  md: 10, // boutons
  lg: 16, // feuilles (sheets) — coins hauts uniquement
  full: 999, // pastilles, avatar
} as const;

// Police éditoriale serif (logotype, titres, noms de pièces). Chargée via
// expo-font — voir src/theme/fonts.ts. SIL Open Font License.
export const serifFont = "Newsreader_500Medium";
