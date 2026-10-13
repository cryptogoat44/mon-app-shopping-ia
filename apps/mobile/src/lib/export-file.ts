// Fichier de l'export des données (lot 5) : nom, extension, type et contenu.
// Deux formats, au choix à chaque export : « html », le fichier lisible rendu
// par le serveur dans la langue de l'app (la version technique figure à la
// fin) ; « json », le format technique, pour transférer ses données ailleurs.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import { t } from "../i18n";

export const EXPORT_FORMATS = ["html", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Réponse du serveur, telle que lue par api.ts. */
export interface ExportResponse {
  text: string;
  contentType: string | null;
}

/** Ce qui est enregistré sur l'appareil (ou téléchargé sur le site). */
export interface ExportFile {
  format: ExportFormat;
  name: string;
  content: string;
  mimeType: "text/html" | "application/json";
  /** Type de fichier pour la feuille de partage de l'iPhone. */
  uti: "public.html" | "public.json";
}

// Même règle que le serveur pour l'en-tête X-Time-Zone : au-delà, il
// l'ignore et date le fichier dans le fuseau par défaut de la langue.
const TIME_ZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;

/** Fuseau de l'appareil (« Europe/Paris »), envoyé au serveur pour dater le
 * fichier lisible ; null s'il est introuvable ou d'une forme inattendue. */
export function deviceTimeZone(read: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  try {
    const zone = read();
    return typeof zone === "string" && TIME_ZONE.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Format réellement reçu : pendant un déploiement, un serveur plus ancien
 * renvoie encore le JSON quand le fichier lisible est demandé ; il est alors
 * enregistré en .json, jamais sous une extension trompeuse. */
export function receivedFormat(requested: ExportFormat, contentType: string | null): ExportFormat {
  return requested === "html" && contentType !== null && /^\s*text\/html\s*(;|$)/i.test(contentType) ? "html" : "json";
}

const pad = (value: number) => String(value).padStart(2, "0");

/** « spotto-mes-donnees-2026-10-13-1542.html » : date et heure locales de
 * l'appareil, lues au moment de l'export (jamais au chargement du module). */
export function exportFileName(format: ExportFormat, now: Date = new Date()): string {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${t.settings.exportFileBase}-${day}-${pad(now.getHours())}${pad(now.getMinutes())}.${format}`;
}

/** Le JSON est remis en forme (lisible dans un éditeur de texte), comme les
 * exports précédents ; un texte illisible est gardé tel quel. */
function jsonContent(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Le fichier à enregistrer, à partir du format demandé et de la réponse. */
export function exportFile(requested: ExportFormat, response: ExportResponse, now: Date = new Date()): ExportFile {
  const format = receivedFormat(requested, response.contentType);
  const name = exportFileName(format, now);
  return format === "html"
    ? { format, name, content: response.text, mimeType: "text/html", uti: "public.html" }
    : { format, name, content: jsonContent(response.text), mimeType: "application/json", uti: "public.json" };
}
