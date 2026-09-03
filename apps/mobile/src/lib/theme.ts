/** Palette sobre "quiet luxury" — cohérente avec le document d'architecture.
 * Une seule palette claire pour l'instant ; un mode sombre pourra reprendre
 * les mêmes rôles avec des valeurs inversées quand le reste de l'app existera. */
export const theme = {
  color: {
    ground: "#F5F4F1",
    surface: "#FFFFFF",
    ink: "#1B1A17",
    muted: "#716C62",
    line: "#E1DDD4",
    accent: "#8A6A45",
    accentInk: "#6B5236",
    danger: "#9C5A3C",
    dangerSoft: "#F3E4DA",
    verified: "#4B5A43",
    verifiedSoft: "#E7EBE1",
  },
  space: { xs: 6, sm: 10, md: 16, lg: 24, xl: 36 },
  radius: { md: 10, lg: 14 },
  font: {
    display: 28,
    title: 20,
    body: 16,
    small: 13,
  },
} as const;
