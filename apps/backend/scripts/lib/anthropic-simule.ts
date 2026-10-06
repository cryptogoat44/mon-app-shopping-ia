// Simulation de l'API d'Anthropic pour les vérifications à l'écran (lot 4,
// temps 1 bis) — JAMAIS en production : chargé seulement par les outils
// parcours-ecran et parcours-iphone, dans le serveur LOCAL (spotto-dev),
// avec une clé factice. Aucun appel réel : toute requête vers
// api.anthropic.com reçoit une réponse fabriquée ici, sans quitter le Mac.
//
// « L'IA » simulée reconnaît les plans de la vidéo d'essai à leur couleur
// (scripts/lib/videos-essai.ts) : « veste » → plan Veste, « sac », « chaussures ».
// Mots spéciaux dans la description, pour les replis : « panne » (529),
// « limite » (400, limite de dépense atteinte), « rien » (pièce introuvable).
import sharp from "sharp";
import { z } from "zod";
import { CLE_SIMULATION, MARQUE_SIMULATION } from "./simulation-anthropic.js";
import { couleurProche, rgb, SEGMENTS } from "./videos-essai.js";

const CIBLES = [
  { mots: ["sac", "bag"], couleur: rgb(SEGMENTS[0].fond) },
  { mots: ["veste", "jacket"], couleur: rgb(SEGMENTS[1].fond) },
  { mots: ["chaussure", "shoe"], couleur: rgb(SEGMENTS[2].fond) },
];

const BLOC = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), source: z.object({ type: z.literal("base64"), media_type: z.literal("image/jpeg"), data: z.string() }) }),
]);
const CORPS = z.object({
  model: z.string(),
  max_tokens: z.number(),
  system: z.string(),
  messages: z.array(z.object({ role: z.literal("user"), content: z.array(BLOC) })).length(1),
  output_config: z.object({ format: z.object({ type: z.literal("json_schema") }) }).passthrough(),
});

function json(status: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });
}

async function mesurer(base64: string): Promise<{ width: number; height: number; couleur: number[] }> {
  const data = Buffer.from(base64, "base64");
  const { width = 0, height = 0 } = await sharp(data).metadata();
  const stats = await sharp(data).stats();
  return { width, height, couleur: stats.channels.slice(0, 3).map((canal) => canal.mean) };
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(...a.map((valeur, index) => valeur - (b[index] ?? 0)));
}

async function repondre(init: RequestInit | undefined): Promise<Response> {
  if (new Headers(init?.headers).get("x-api-key") !== CLE_SIMULATION) {
    return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  }
  const lu = CORPS.safeParse(JSON.parse(String(init?.body)));
  if (!lu.success) return json(400, { type: "error", error: { type: "invalid_request_error", message: "corps inattendu" } });
  const blocs = lu.data.messages[0]!.content;
  const description = blocs.flatMap((bloc) => (bloc.type === "text" ? [bloc.text] : [])).find((texte) => texte.startsWith("<description>")) ?? "";
  const mots = description.toLowerCase();
  if (mots.includes("panne")) return json(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
  if (mots.includes("limite")) {
    return json(400, { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } });
  }
  const mesures = await Promise.all(blocs.flatMap((bloc) => (bloc.type === "image" ? [mesurer(bloc.source.data)] : [])));
  const cible = mots.includes("rien") ? undefined : CIBLES.find((c) => c.mots.some((mot) => mots.includes(mot)));
  const moments = cible
    ? mesures
        .map((mesure, index) => ({ index, mesure, ecart: distance(mesure.couleur, cible.couleur) }))
        .sort((a, b) => a.ecart - b.ecart)
        .slice(0, 3)
        .map(({ index, mesure }) => ({
          image: index + 1,
          x1: Math.round(mesure.width * 0.15),
          y1: Math.round(mesure.height * 0.3),
          x2: Math.round(mesure.width * 0.85),
          y2: Math.round(mesure.height * 0.7),
        }))
    : [];
  // Coût simulé selon la règle officielle : ⌈largeur/28⌉ × ⌈hauteur/28⌉ jetons par image.
  const jetons = mesures.reduce((somme, m) => somme + Math.ceil(m.width / 28) * Math.ceil(m.height / 28), 0) + 300;
  const proche = cible ? mesures.some((m) => couleurProche(m.couleur.map(Math.round), cible.couleur, 25)) : false;
  process.stdout.write(`[simulation Anthropic] ${mesures.length} image(s), ${moments.length} moment(s), plan reconnu : ${proche ? "oui" : "non"}\n`);
  return json(200, {
    id: "msg_simulation",
    type: "message",
    role: "assistant",
    model: lu.data.model,
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ moments }) }],
    usage: { input_tokens: jetons, output_tokens: 60 },
  });
}

const fetchReel = globalThis.fetch;
globalThis.fetch = async (entree: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  const adresse = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  if (adresse.startsWith("https://api.anthropic.com/")) return repondre(init);
  return fetchReel(entree, init);
};
process.stdout.write(`${MARQUE_SIMULATION}\n`);
