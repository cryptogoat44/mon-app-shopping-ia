// Entrée du parcours (lot « mesure du parcours ») : où commence une recherche,
// pour l'événement « journey_started » des statistiques d'usage (catalogue
// fermé, analytics-events.ts) — jamais le lien, le fichier ni l'image.
// Envoyé une fois, dès que l'app accepte l'entrée (lien reconnu, fichier
// lisible), avant toute analyse ; une entrée refusée garde ses événements
// d'avant (video_rejected, aide « capture d'écran d'abord »…). Liste tirée
// des entrées réelles du Spotter, préfixées pour filtrer d'un mot dans
// PostHog (« link », « video », « photo »). Imports relatifs : vitest.

export const JOURNEY_ENTRIES = [
  // Lien de vidéo TikTok ou Instagram collé (ou tapé) dans le champ du Spotter, app et site.
  "link_paste",
  // Lien reçu par la feuille de partage d'iOS.
  "link_share",
  // Vidéo : photothèque (app iPhone), fichier (site), dernière vidéo de la
  // galerie proposée sur l'accueil (app iPhone), feuille de partage d'iOS
  // (les sources de spot-video.ts).
  "video_library",
  "video_file",
  "video_latest",
  "video_share",
  // Photo : photothèque (app iPhone), fichier choisi (site), image
  // glissée-déposée ou collée (site), appareil photo (app iPhone), capture ou
  // photo reçue par la feuille de partage d'iOS, capture de la recherche
  // d'image d'iOS.
  "photo_library",
  "photo_file",
  "photo_drop",
  "photo_camera",
  "photo_share",
  "photo_visual_search",
] as const;

export type JourneyEntry = (typeof JOURNEY_ENTRIES)[number];
export type PhotoJourneyEntry = Extract<JourneyEntry, `photo_${string}`>;

/** Photo choisie dans le sélecteur du système : la photothèque sur l'app iPhone, un fichier sur le site. */
export function photoPickerEntry(os: string): PhotoJourneyEntry {
  return os === "web" ? "photo_file" : "photo_library";
}
