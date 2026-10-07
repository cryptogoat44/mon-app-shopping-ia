// Coupure simulée entre le serveur LOCAL et Supabase Auth (lot 4 ter, étude
// de la session perdue à la relance) — JAMAIS en production : chargée
// seulement par l'outil parcours-iphone (scénario relance-session-panne),
// dans le serveur local de spotto-dev.
//
// Quand l'outil crée le fichier-signal, les vérifications de session du
// serveur (GET …/auth/v1/user) échouent aussitôt pendant 1,5 s, comme lors
// de l'incident du 2026-10-07 (refus en 2 ms : la connexion vers Supabase
// avait lâché) ; le signal est consommé. Rien d'autre n'est modifié.
import { existsSync, rmSync } from "node:fs";
import { FICHIER_SIGNAL_PANNE, MARQUE_PANNE_AUTH } from "./simulation-panne-auth.js";

const DUREE_MS = 1500;
let finDePanne = 0;

const fetchReel = globalThis.fetch;
globalThis.fetch = async (entree: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  const adresse = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  if (/\/auth\/v1\/user(?:\?|$)/.test(adresse) && (init?.method ?? "GET") === "GET") {
    if (existsSync(FICHIER_SIGNAL_PANNE)) {
      rmSync(FICHIER_SIGNAL_PANNE, { force: true });
      finDePanne = Date.now() + DUREE_MS;
      process.stdout.write("[panne simulée] vérifications de session coupées 1,5 s\n");
    }
    if (Date.now() < finDePanne) throw new TypeError("fetch failed (panne simulée)");
  }
  return fetchReel(entree, init);
};
process.stdout.write(`${MARQUE_PANNE_AUTH}\n`);
