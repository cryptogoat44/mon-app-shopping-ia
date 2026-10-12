// Téléchargement d'une image publique pour en faire une copie (lot 5, 5.C —
// décision du fondateur : « exactement comme Instagram »). Instagram ne montre
// jamais une image hébergée ailleurs : ses serveurs la récupèrent une fois et
// servent leur propre copie. Nous faisons de même au moment où une envie est
// partagée : plus aucun site tiers ne voit l'adresse IP de qui la regarde, et
// l'image ne peut plus changer après coup.
//
// L'adresse vient d'une envie (donc, au départ, de l'app) : c'est la porte
// d'entrée classique d'une attaque « SSRF » (faire appeler par notre serveur
// une adresse interne). Garde-fous, revérifiés à chaque redirection :
// - https seulement, port standard ;
// - le nom est résolu ici, et TOUTES ses adresses doivent être publiques
//   (jamais 127.0.0.1, réseau privé, métadonnées du cloud…) ;
// - la connexion se fait sur l'adresse vérifiée, jamais sur une nouvelle
//   résolution (parade au « DNS rebinding ») ;
// - 3 redirections au plus, 10 s au total, 8 Mo au plus, type image/*.
import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import type { IncomingMessage } from "node:http";

export const MAX_PUBLIC_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

export class PublicImageError extends Error {}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultResolver: Resolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

// Plages non publiques (RFC 6890 et suivantes) : boucle locale, réseaux
// privés, liens locaux (dont 169.254.169.254, les métadonnées des clouds),
// partage d'adresses des opérateurs, documentation, multidiffusion, réservé.
const BLOCKED = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

/** true seulement pour une adresse IP publique (ni interne, ni réservée). */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4 écrite en IPv6 (::ffff:10.0.0.1, ou ::ffff:a00:1) : on juge l'IPv4 qu'elle contient.
    const mapped = /^::ffff:(?:0{1,4}:)?(.+)$/.exec(lower);
    if (mapped) {
      const rest = mapped[1]!;
      if (net.isIPv4(rest)) return isPublicAddress(rest);
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
      if (hex) {
        const high = parseInt(hex[1]!, 16);
        const low = parseInt(hex[2]!, 16);
        return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
      return false;
    }
    return !BLOCKED.check(lower, "ipv6");
  }
  return false;
}

/** Vérifie la forme de l'adresse : https, port standard, sans identifiants. */
export function checkImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicImageError("Adresse d'image invalide");
  }
  if (url.protocol !== "https:") throw new PublicImageError("Seules les adresses https sont acceptées");
  if (url.username || url.password) throw new PublicImageError("Adresse d'image invalide");
  if (url.port && url.port !== "443") throw new PublicImageError("Port non autorisé");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new PublicImageError("Hôte non autorisé");
  }
  return url;
}

/** L'adresse publique sur laquelle se connecter, ou une erreur si le nom
 * désigne (même en partie) une adresse interne. */
export async function resolvePublicHost(hostname: string, resolver: Resolver = defaultResolver): Promise<ResolvedAddress> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const literal = net.isIP(bare);
  if (literal) {
    if (!isPublicAddress(bare)) throw new PublicImageError("Adresse interne refusée");
    return { address: bare, family: literal === 6 ? 6 : 4 };
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(bare);
  } catch {
    throw new PublicImageError("Nom d'hôte introuvable");
  }
  if (addresses.length === 0) throw new PublicImageError("Nom d'hôte introuvable");
  // Une seule adresse interne suffit à tout refuser : on ne choisit pas « la bonne ».
  if (addresses.some((a) => !isPublicAddress(a.address))) throw new PublicImageError("Adresse interne refusée");
  return addresses[0]!;
}

function request(url: URL, target: ResolvedAddress, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        signal,
        headers: { accept: "image/*", "user-agent": "Spotto/1.0 (image copy)" },
        // Connexion sur l'adresse déjà vérifiée : aucune nouvelle résolution.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: target.address, family: target.family }]);
          else callback(null, target.address, target.family);
        },
      },
      resolve
    );
    req.on("error", reject);
    req.end();
  });
}

async function readBody(response: IncomingMessage): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_PUBLIC_IMAGE_BYTES) {
    response.destroy();
    throw new PublicImageError("Image trop volumineuse");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_PUBLIC_IMAGE_BYTES) {
      response.destroy();
      throw new PublicImageError("Image trop volumineuse");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Télécharge une image publique (garde-fous ci-dessus). Le contenu n'est
 * jamais cru sur parole : l'appelant le décode et le ré-encode (sharp). */
export async function downloadPublicImage(rawUrl: string, resolver: Resolver = defaultResolver): Promise<Buffer> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = checkImageUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await resolvePublicHost(url.hostname, resolver);
    let response: IncomingMessage;
    try {
      response = await request(url, target, signal);
    } catch {
      throw new PublicImageError("Image injoignable");
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();
      if (!location) throw new PublicImageError("Redirection sans destination");
      url = checkImageUrl(new URL(location, url).toString());
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new PublicImageError(`Image indisponible (${status})`);
    }
    if (!String(response.headers["content-type"] ?? "").toLowerCase().startsWith("image/")) {
      response.resume();
      throw new PublicImageError("Ce n'est pas une image");
    }
    try {
      return await readBody(response);
    } catch (error) {
      if (error instanceof PublicImageError) throw error;
      throw new PublicImageError("Image injoignable");
    }
  }
  throw new PublicImageError("Trop de redirections");
}
