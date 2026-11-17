// Fichier vidéo servi à ffmpeg depuis la mémoire, sur la boucle locale
// (127.0.0.1), le temps d'en tirer les images. Pourquoi : yt-dlp télécharge
// la vidéo en mémoire (TikTok refuse le fichier à ffmpeg directement) ; or un
// MP4 dont l'index (« moov ») est à la fin ne se lit pas depuis un tuyau.
// Servi en HTTP avec les requêtes partielles (Range), il se lit comme un
// fichier, sans jamais rien écrire sur le disque.
//
// Sécurité : écoute sur 127.0.0.1 seulement, port choisi par le système,
// chemin aléatoire de 128 bits, GET et HEAD seulement, une seule ressource ;
// le serveur est fermé (connexions comprises) dès la fin de l'extraction.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * @param {Buffer} data Le fichier, en mémoire (jamais copié).
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serveInMemory(data) {
  const path = `/${randomBytes(16).toString("hex")}.mp4`;
  const server = createServer((request, response) => {
    if (request.url !== path || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404, { "content-length": "0" }).end();
      return;
    }
    const size = data.length;
    let start = 0;
    let end = size - 1;
    let partial = false;
    const range = typeof request.headers.range === "string" ? RANGE.exec(request.headers.range.trim()) : null;
    if (range && (range[1] !== "" || range[2] !== "")) {
      if (range[1] === "") {
        // « bytes=-N » : les N derniers octets.
        start = Math.max(0, size - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
        response.writeHead(416, { "content-range": `bytes */${size}`, "content-length": "0" }).end();
        return;
      }
      partial = true;
    }
    /** @type {Record<string, string>} */
    const headers = { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": String(end - start + 1), "cache-control": "no-store" };
    if (partial) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    response.writeHead(partial ? 206 : 200, headers);
    if (request.method === "HEAD") response.end();
    else response.end(data.subarray(start, end + 1));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  let closed = false;
  return {
    url: `http://127.0.0.1:${port}${path}`,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      });
    },
  };
}
