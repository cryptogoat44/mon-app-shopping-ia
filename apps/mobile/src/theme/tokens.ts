// Tokens validés dans les maquettes Claude Design du projet "Spotto"
// (https://claude.ai/design — projet "Spotto"). Deux palettes (lot 3) :
// claire, et sombre dans l'esprit « chambre noire » de la planche B du
// Lot S (docs/lot-s-design/) — brun très profond et chaud, jamais de noir
// pur. Contrastes WCAG AA vérifiés pour chaque texte dans les deux thèmes
// (voir docs/journal-decisions.md, lot 3).

export interface Palette {
  porcelaine: string; // fond de toute l'app
  surface: string; // cartes, bandeaux, feuilles posés sur le fond
  plinthe: string; // fond derrière les pièces photographiées uniquement — ne porte jamais de texte
  encre: string; // texte principal ; aussi fond des éléments « pleins » (puces, bulles)
  acier: string; // texte secondaire (AA sur fond et surface)
  acierSurPlinthe: string; // texte exceptionnel sur plinthe (AA)
  filet: string; // séparateurs, bordures fines
  vert: string; // seul accent : action principale, liens, marque « vérifié »
  blanc: string; // texte ou icône posé sur un élément plein (vert ou encre)
  surImage: string; // texte ou icône posé sur une PHOTO : toujours clair
  danger: string; // actions destructrices uniquement
  erreur: string; // messages d'erreur uniquement (même teinte que danger, rôle distinct)
  nuit: string; // fond de l'écran d'attente du Spotter (sombre dans les deux thèmes)
  surNuit: string; // texte principal sur nuit
  brume: string; // texte secondaire sur nuit
}

export const lightPalette: Palette = {
  porcelaine: "#FBFBFA",
  surface: "#FFFFFF",
  plinthe: "#F1F1EE",
  encre: "#1D1D1F", // 16,3:1 sur porcelaine
  acier: "#6E6E73", // 4,9:1
  acierSurPlinthe: "#57575C", // 6,4:1 sur plinthe
  filet: "#E4E4E0",
  vert: "#1E3D32", // 11,5:1
  blanc: "#FFFFFF", // 11,9:1 sur vert
  surImage: "#FFFFFF",
  danger: "#B3432B", // 5,4:1
  erreur: "#B3432B",
  nuit: "#141312",
  surNuit: "#F4F2EE", // 16,6:1 sur nuit
  brume: "#A9A6A0", // 7,6:1 sur nuit
};

export const darkPalette: Palette = {
  porcelaine: "#141312",
  surface: "#1E1C1A",
  plinthe: "#24221F",
  encre: "#F4F2EE", // 16,6:1 sur porcelaine, 15,2:1 sur surface
  acier: "#A9A6A0", // 7,6:1
  acierSurPlinthe: "#B3AFA8", // 7,3:1 sur plinthe
  filet: "#35322F",
  vert: "#9CC3AE", // sauge claire : 9,6:1 sur porcelaine
  blanc: "#141312", // 9,6:1 sur vert, 16,6:1 sur encre
  surImage: "#FFFFFF",
  danger: "#E8917B", // 7,8:1
  erreur: "#E8917B",
  nuit: "#141312",
  surNuit: "#F4F2EE",
  brume: "#A9A6A0",
};

export type ColorScheme = "light" | "dark";

let activePalette: Palette = lightPalette;
let activeScheme: ColorScheme = "light";

/** Change la palette active (appelé par ThemeProvider). */
export function setActiveScheme(scheme: ColorScheme): void {
  activeScheme = scheme;
  activePalette = scheme === "dark" ? darkPalette : lightPalette;
}

export function getActiveScheme(): ColorScheme {
  return activeScheme;
}

/** Couleurs du thème actif : chaque lecture renvoie la valeur du thème en
 * cours (les usages existants « color.xxx » n'ont pas à changer). */
export const color: Readonly<Palette> = new Proxy({} as Palette, {
  get: (_target, key: string) => activePalette[key as keyof Palette],
});

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
