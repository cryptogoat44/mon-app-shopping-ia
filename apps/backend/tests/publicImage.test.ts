import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_REQUEST_HEADERS,
  PublicImageError,
  checkImageUrl,
  downloadPublicImage,
  isPublicAddress,
  resolvePublicHost,
  type Resolver,
} from "../src/lib/publicImage.js";

// Lot 5, 5.C : copie de l'image d'une envie partagée « comme Instagram ».
// L'adresse vient de l'app : le serveur ne doit jamais se laisser envoyer
// vers une adresse interne (attaque SSRF). Aucun appel réseau ici : les
// résolutions de noms sont simulées, chaque refus a lieu avant toute
// connexion, et les réponses des serveurs sont simulées elles aussi.
const { httpsRequest } = vi.hoisted(() => ({ httpsRequest: vi.fn() }));
vi.mock("node:https", () => ({ default: { request: httpsRequest } }));

beforeEach(() => {
  httpsRequest.mockReset();
});

const resolverTo = (...addresses: string[]): Resolver =>
  vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(":") ? (6 as const) : (4 as const) })));

describe("adresses publiques et internes", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254", // métadonnées des clouds
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe", // 169.254.169.254 écrite en IPv6
    "64:ff9b::a00:1",
    "2001:db8::1",
  ])("%s est refusée", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.215.14", "8.8.8.8", "151.101.1.140", "2606:4700::6810:84e5", "::ffff:8.8.8.8"])("%s est acceptée", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("une valeur qui n'est pas une adresse IP n'est jamais « publique »", () => {
    expect(isPublicAddress("example.com")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("forme de l'adresse de l'image", () => {
  it("https seulement, port standard, sans identifiants ni « localhost »", () => {
    expect(checkImageUrl("https://cdn.example.com/a.jpg").hostname).toBe("cdn.example.com");
    expect(checkImageUrl("https://cdn.example.com:443/a.jpg").hostname).toBe("cdn.example.com");
    for (const bad of [
      "http://cdn.example.com/a.jpg",
      "ftp://cdn.example.com/a.jpg",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "https://user:pass@cdn.example.com/a.jpg",
      "https://cdn.example.com:8443/a.jpg",
      "https://localhost/a.jpg",
      "https://app.localhost/a.jpg",
      "pas une adresse",
    ]) {
      expect(() => checkImageUrl(bad), bad).toThrow(PublicImageError);
    }
  });
});

describe("résolution du nom", () => {
  it("garde l'adresse publique sur laquelle se connecter", async () => {
    await expect(resolvePublicHost("cdn.example.com", resolverTo("93.184.215.14"))).resolves.toEqual({ address: "93.184.215.14", family: 4 });
  });

  it("refuse un nom dont UNE des adresses est interne (pas de « bonne » adresse choisie)", async () => {
    await expect(resolvePublicHost("piege.example.com", resolverTo("93.184.215.14", "10.0.0.5"))).rejects.toThrow("Adresse interne refusée");
  });

  it("refuse une adresse IP interne écrite directement, sans résolution", async () => {
    const resolver = resolverTo("93.184.215.14");
    await expect(resolvePublicHost("169.254.169.254", resolver)).rejects.toThrow("Adresse interne refusée");
    await expect(resolvePublicHost("[::1]", resolver)).rejects.toThrow("Adresse interne refusée");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("nom introuvable : refus", async () => {
    await expect(resolvePublicHost("inconnu.example.com", resolverTo())).rejects.toThrow("Nom d'hôte introuvable");
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(resolvePublicHost("inconnu.example.com", failing)).rejects.toThrow("Nom d'hôte introuvable");
  });
});

type Answer = { status: number; headers?: Record<string, string>; body?: Buffer } | Error;

/** Prochaine connexion simulée : la réponse du serveur, ou l'échec de la
 * connexion. Note l'adresse sur laquelle elle a lieu (celle déjà vérifiée). */
function answerNext(answer: Answer, connectedTo: string[] = []) {
  httpsRequest.mockImplementationOnce(
    (_url: URL, options: { lookup: (host: string, opts: object, done: (error: Error | null, address: string) => void) => void }, callback: (response: Readable) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          options.lookup("ignoré", {}, (_error, address) => connectedTo.push(address));
          setImmediate(() => {
            if (answer instanceof Error) req.emit("error", answer);
            else callback(Object.assign(Readable.from(answer.body ? [answer.body] : []), { statusCode: answer.status, headers: answer.headers ?? {} }));
          });
        },
      });
      return req;
    }
  );
  return connectedTo;
}

const JPEG = { "content-type": "image/jpeg" };

describe("téléchargement", () => {
  it("refuse avant toute connexion une adresse http, interne ou mal formée", async () => {
    const resolver = resolverTo("127.0.0.1");
    await expect(downloadPublicImage("http://cdn.example.com/a.jpg", resolver)).rejects.toThrow(PublicImageError);
    await expect(downloadPublicImage("https://127.0.0.1/a.jpg", resolver)).rejects.toThrow("Adresse interne refusée");
    await expect(downloadPublicImage("https://cdn.example.com/a.jpg", resolver)).rejects.toThrow("Adresse interne refusée");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("s'annonce honnêtement comme un robot (format standard), jamais comme un vrai navigateur", async () => {
    answerNext({ status: 200, headers: JPEG, body: Buffer.from("octets") });
    await expect(downloadPublicImage("https://cdn.example.com/a.jpg", resolverTo("93.184.215.14"))).resolves.toEqual(Buffer.from("octets"));
    const headers = httpsRequest.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers).toEqual(IMAGE_REQUEST_HEADERS);
    expect(headers["user-agent"]).toMatch(/^Mozilla\/5\.0 \(compatible; Spotto\/1\.0; \+https:\/\/[^ )]+\)$/);
    expect(headers["user-agent"]).not.toMatch(/Chrome|Safari|Firefox|Gecko|AppleWebKit|Edg/);
    expect(headers.accept).toBe("image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8");
  });

  it("réponse autre que 200 : son code est gardé (status), pour le journal", async () => {
    answerNext({ status: 403 });
    const refused = await downloadPublicImage("https://cdn.example.com/a.jpg", resolverTo("93.184.215.14")).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PublicImageError);
    expect(refused).toMatchObject({ message: "Image indisponible (403)", status: 403 });

    // Les autres refus n'ont pas de code.
    answerNext({ status: 200, headers: { "content-type": "text/html" } });
    const notImage = await downloadPublicImage("https://cdn.example.com/a.jpg", resolverTo("93.184.215.14")).catch((error: unknown) => error);
    expect(notImage).toMatchObject({ message: "Ce n'est pas une image", status: undefined });
  });

  it("redirection vers une adresse interne : refusée, sans seconde connexion", async () => {
    answerNext({ status: 302, headers: { location: "https://10.0.0.5/a.jpg" } });
    await expect(downloadPublicImage("https://cdn.example.com/a.jpg", resolverTo("93.184.215.14"))).rejects.toThrow("Adresse interne refusée");
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("une adresse injoignable : la suivante, déjà vérifiée, est essayée ; toutes injoignables : refus", async () => {
    const resolver = resolverTo("93.184.215.14", "151.101.1.140");
    const connectedTo = answerNext(new Error("ECONNREFUSED"));
    answerNext({ status: 200, headers: JPEG, body: Buffer.from("octets") }, connectedTo);
    await expect(downloadPublicImage("https://cdn.example.com/a.jpg", resolver)).resolves.toEqual(Buffer.from("octets"));
    expect(connectedTo).toEqual(["93.184.215.14", "151.101.1.140"]);

    answerNext(new Error("ECONNREFUSED"));
    answerNext(new Error("ETIMEDOUT"));
    await expect(downloadPublicImage("https://cdn.example.com/a.jpg", resolver)).rejects.toThrow("Image injoignable");
    expect(httpsRequest).toHaveBeenCalledTimes(4);
  });
});
