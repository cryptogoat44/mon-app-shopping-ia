// Simulation de SerpApi (Google Lens) pour les vérifications à l'écran sur
// iPhone (lot 4 ter) — JAMAIS en production : chargée seulement par l'outil
// parcours-iphone, dans le serveur LOCAL (spotto-dev), qui a de toute façon
// une clé SerpApi invalide. Aucun appel réel, donc aucun crédit : toute
// requête vers serpapi.com reçoit ici trois propositions fabriquées (images
// de couleur unie, prix, marchand fictif « Example »).
// Mot spécial dans la description, pour les replis : « introuvable » (aucune proposition).
import sharp from "sharp";
import { MARQUE_SIMULATION_SERPAPI } from "./simulation-serpapi.js";

const PIECES = [
  { title: "Camel suede jacket", source: "Atelier Example", prix: 189, fond: "#8A5A3C" },
  { title: "Suede bomber", source: "Maison Example", prix: 245, fond: "#6E4B32" },
  { title: "Cropped suede jacket", source: "Example Store", prix: 159, fond: "#9C6B48" },
];

async function vignette(fond: string): Promise<string> {
  const jpeg = await sharp({ create: { width: 400, height: 500, channels: 3, background: fond } }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Délai d'une vraie recherche (quelques secondes) : l'écran d'attente reste visible. */
const DELAI_MS = 5000;

async function repondre(adresse: string): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, DELAI_MS));
  const q = new URL(adresse).searchParams.get("q") ?? "";
  const visual_matches = q.toLowerCase().includes("introuvable")
    ? []
    : await Promise.all(
        PIECES.map(async (piece, index) => ({
          position: index + 1,
          title: piece.title,
          link: `https://example.com/simulation/${index + 1}`,
          source: piece.source,
          thumbnail: await vignette(piece.fond),
          price: { value: `${piece.prix} €`, extracted_value: piece.prix, currency: "€" },
        }))
      );
  process.stdout.write(`[simulation SerpApi] ${visual_matches.length} proposition(s), description ${q ? "fournie" : "absente"}\n`);
  return new Response(JSON.stringify({ visual_matches }), { status: 200, headers: { "content-type": "application/json" } });
}

const fetchReel = globalThis.fetch;
globalThis.fetch = async (entree: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  const adresse = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  if (adresse.startsWith("https://serpapi.com/")) return repondre(adresse);
  return fetchReel(entree, init);
};
process.stdout.write(`${MARQUE_SIMULATION_SERPAPI}\n`);
