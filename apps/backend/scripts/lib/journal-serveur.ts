// Réponses du serveur local lues dans son journal (lignes JSON de Fastify) :
// méthode, chemin SANS paramètres, code et durée — jamais d'en-tête, de jeton
// ni de contenu. Sert aux vérifications sur iPhone (lot 4 ter, relances).
import { z } from "zod";

const ENTREE = z.object({ reqId: z.string(), time: z.number(), req: z.object({ method: z.string(), url: z.string() }) });
const SORTIE = z.object({ reqId: z.string(), time: z.number(), res: z.object({ statusCode: z.number() }), responseTime: z.number().optional() });

export interface ReponseServeur {
  /** Heure de la réponse (ms depuis 1970). */
  temps: number;
  methode: string;
  chemin: string;
  code: number;
  dureeMs: number;
}

export function lireReponses(journal: string): ReponseServeur[] {
  const requetes = new Map<string, { methode: string; chemin: string }>();
  const reponses: ReponseServeur[] = [];
  for (const ligne of journal.split("\n")) {
    if (!ligne.startsWith("{")) continue;
    let brut: unknown;
    try {
      brut = JSON.parse(ligne);
    } catch {
      continue;
    }
    const entree = ENTREE.safeParse(brut);
    if (entree.success) {
      requetes.set(entree.data.reqId, { methode: entree.data.req.method, chemin: entree.data.req.url.split("?")[0]! });
      continue;
    }
    const sortie = SORTIE.safeParse(brut);
    if (!sortie.success) continue;
    const requete = requetes.get(sortie.data.reqId) ?? { methode: "?", chemin: "?" };
    reponses.push({ temps: sortie.data.time, ...requete, code: sortie.data.res.statusCode, dureeMs: Math.round(sortie.data.responseTime ?? 0) });
  }
  return reponses;
}
