// Une vidéo ne se lit pas depuis un lien (lot 4 ter) : la personne enregistre
// son écran pendant que la vidéo passe, puis ajoute cet enregistrement. Où
// lancer l'enregistrement, selon l'appareil. Logique pure, testée.
export type RecordingDevice = "ios" | "android" | "computer";

/** `os` : Platform.OS ; sur le site, l'appareil se déduit du navigateur (un
 * iPad se présente comme un Mac, mais il a un écran tactile). */
export function recordingDevice(os: string, userAgent: string | null, touchPoints: number): RecordingDevice {
  if (os === "ios" || os === "android") return os;
  const agent = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && touchPoints > 1)) return "ios";
  return /Android/i.test(agent) ? "android" : "computer";
}
