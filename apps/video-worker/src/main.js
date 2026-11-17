// Démarrage du service vidéo (Render, service privé, Docker) : réglages lus
// dans l'environnement, versions de yt-dlp et de ffmpeg relevées une fois,
// écoute sur PORT (10000 par défaut), arrêt propre sur SIGTERM (Render) ou
// SIGINT.
import { createWorker } from "./app.js";
import { readConfig } from "./config.js";
import { LIMITS } from "./contract.js";
import { createLogger } from "./log.js";
import { childEnvironment } from "./run.js";
import { detectVersions } from "./versions.js";

async function main() {
  const logger = createLogger();
  const config = readConfig(process.env);
  for (const problem of config.problems) logger.warn("config", { problem });
  const childEnv = childEnvironment(process.env);
  const versions = await detectVersions(childEnv);
  if (!versions.ytDlp) logger.error("tool_missing", { tool: "yt-dlp" });
  if (!versions.ffmpeg) logger.error("tool_missing", { tool: "ffmpeg" });

  const worker = createWorker({ secret: config.secret, versions, logger, childEnv });
  const port = await worker.listen(config.port);
  logger.info("listening", {
    port,
    ytDlp: versions.ytDlp,
    ffmpeg: versions.ffmpeg,
    secretConfigured: config.secret !== null,
    maxConcurrentJobs: LIMITS.maxConcurrentJobs,
    maxVideoSeconds: LIMITS.maxVideoSeconds,
  });

  let stopping = false;
  const stop = async (/** @type {string} */ signalName) => {
    if (stopping) return;
    stopping = true;
    logger.info("stopping", { signal: signalName, active: worker.limiter.active, queued: worker.limiter.queued });
    await worker.close();
    logger.info("stopped", { served: worker.totals.served, failed: worker.totals.failed });
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((error) => {
  // Jamais le détail (il pourrait contenir un réglage) : le type seulement.
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level: "error", event: "startup_failed", kind: error instanceof Error ? error.name : "unknown", code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined })}\n`);
  process.exit(1);
});
