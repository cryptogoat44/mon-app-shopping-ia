// Journal : une ligne JSON par événement, des compteurs et des codes
// seulement. Jamais l'adresse d'une vidéo (ni son identifiant), jamais une
// image, jamais le secret, jamais la sortie brute de yt-dlp ou de ffmpeg.

/** @typedef {Record<string, string | number | boolean | null | undefined>} LogFields */

/**
 * @param {(line: string) => void} [write]
 */
export function createLogger(write = (line) => process.stdout.write(`${line}\n`)) {
  const emit = (/** @type {string} */ level, /** @type {string} */ event, /** @type {LogFields} */ fields = {}) => {
    /** @type {Record<string, unknown>} */
    const entry = { time: new Date().toISOString(), level, event };
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      // Des nombres, des booléens et des chaînes courtes (codes) seulement.
      entry[name] = typeof value === "string" ? value.slice(0, 200) : value;
    }
    write(JSON.stringify(entry));
  };
  return {
    info: (/** @type {string} */ event, /** @type {LogFields} */ fields) => emit("info", event, fields),
    warn: (/** @type {string} */ event, /** @type {LogFields} */ fields) => emit("warn", event, fields),
    error: (/** @type {string} */ event, /** @type {LogFields} */ fields) => emit("error", event, fields),
  };
}

/** @typedef {ReturnType<typeof createLogger>} Logger */

/** Durée d'une vidéo, par tranche (jamais la valeur exacte). */
export function durationBucket(/** @type {number | null | undefined} */ seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
  if (seconds <= 15) return "0-15";
  if (seconds <= 30) return "15-30";
  if (seconds <= 60) return "30-60";
  if (seconds <= 90) return "60-90";
  return "90+";
}
