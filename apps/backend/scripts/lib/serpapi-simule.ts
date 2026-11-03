// Simulation de SerpApi (Google Lens) pour les vérifications à l'écran sur
// iPhone (lot 4 ter) — JAMAIS en production : chargée seulement par l'outil
// parcours-iphone, dans le serveur LOCAL (spotto-dev), qui a de toute façon
// une clé SerpApi invalide. Aucun appel réel, donc aucun crédit : toute
// requête vers serpapi.com reçoit ici trois propositions fabriquées (images
// de couleur unie, prix, marchand fictif « Example »).
// Mot spécial dans la description, pour les replis : « introuvable » (aucune proposition).
// Voie C (lot c) : une recherche Google Shopping (engine=google_shopping_light,
// requête de l'IA ou vos mots) reçoit des shopping_results fabriqués, marques
// et boutiques fictives ; « introuvable » dans la requête : aucun. Leurs
// vignettes sont des adresses https fictives (les filtres du serveur écartent
// les images « data: ») : l'app montre alors son image de remplacement.
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
/** Google Shopping, plus rapide que Lens (estimation du plan de la voie C : 1,5 à 4 s). */
const DELAI_BOUTIQUES_MS = 2000;

const BOUTIQUES = [
  { title: "Exemplor suede jacket camel", source: "Boutique Exemple", prix: "179,00 €", valeur: 179 },
  { title: "Exemplor suede bomber", source: "Example Shop", prix: "229,90 €", valeur: 229.9 },
  { title: "Suede jacket brown", source: "Maison Exemple", prix: "149,00 €", valeur: 149 },
  { title: "Cropped suede jacket", source: "Example Outlet", prix: "119,00 €", valeur: 119 },
];

/** Réponse fabriquée de Google Shopping : liens directs vers des boutiques fictives. */
function reponseBoutiques(q: string): Response {
  const shopping_results = q.toLowerCase().includes("introuvable")
    ? []
    : BOUTIQUES.map((piece, index) => ({
        position: index + 1,
        title: piece.title,
        link: `https://example.com/boutiques/${index + 1}`,
        product_link: `https://www.google.fr/shopping/product/simulation-${index + 1}`,
        source: piece.source,
        price: piece.prix,
        extracted_price: piece.valeur,
        thumbnail: `https://example.com/simulation/boutique-${index + 1}.jpg`,
      }));
  // Jamais la requête dans la sortie : seulement le nombre de propositions.
  process.stdout.write(`[simulation SerpApi] Google Shopping : ${shopping_results.length} proposition(s)\n`);
  return new Response(JSON.stringify({ shopping_results }), { status: 200, headers: { "content-type": "application/json" } });
}

async function repondre(adresse: string): Promise<Response> {
  const parametres = new URL(adresse).searchParams;
  const q = parametres.get("q") ?? "";
  const boutiques = parametres.get("engine") === "google_shopping_light";
  await new Promise((resolve) => setTimeout(resolve, boutiques ? DELAI_BOUTIQUES_MS : DELAI_MS));
  if (boutiques) return reponseBoutiques(q);
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
