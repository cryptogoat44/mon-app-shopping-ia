// Erreur de test envoyée à Sentry DEPUIS l'app iPhone (lot 3bis).
// Le code ci-dessous est exécuté dans l'app par l'outil de débogage de Metro
// (Hermes, protocole Chrome DevTools) : il intercepte le paquet préparé pour
// Sentry juste avant l'envoi (après nettoyage), puis l'outil vérifie :
// adresse Sentry de la région UE, utilisateur = identifiant interne seul,
// ni adresse e-mail, ni nom d'utilisateur, ni adresse IP. Le paquet part
// réellement vers Sentry (environnement « development »), puis la file
// d'envoi de l'iPhone est contrôlée : vide = paquet transmis, Sentry a
// répondu (son affichage se vérifie dans l'interface de Sentry).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BUNDLE_ID, log, METRO_PORT, type Compte, type Outils } from "./boite-a-outils.js";

export const MESSAGE_ESSAI = "Essai lot 3bis — erreur iPhone volontaire (Spotto)";

function verifier(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification Sentry échouée : ${message}`);
}

/** Évalue une expression dans l'app (connexion au débogueur Hermes via Metro). */
async function evaluer(expression: string): Promise<unknown> {
  const cibles = CIBLES.parse(await (await fetch(`http://localhost:${METRO_PORT}/json/list`)).json());
  const cible = cibles.find((c) => c.webSocketDebuggerUrl && /hermes|react native/i.test(`${c.title} ${c.description}`));
  if (!cible?.webSocketDebuggerUrl) throw new Error("Aucune app connectée au débogueur de Metro.");
  // Metro n'accepte que sa propre origine, à l'identique (sans elle : refus
  // 401 ; avec « localhost » : connexion coupée aussitôt).
  const ws = new WebSocket(cible.webSocketDebuggerUrl, { headers: { Origin: `http://127.0.0.1:${METRO_PORT}` } });
  await new Promise<void>((ok, ko) => {
    ws.onopen = () => ok();
    ws.onerror = () => ko(new Error("Connexion au débogueur impossible."));
  });
  try {
    return await new Promise((ok, ko) => {
      ws.onmessage = (m) => {
        const r = REPONSE_CDP.parse(JSON.parse(String(m.data)));
        if (r.id !== 1) return;
        if (r.result?.exceptionDetails) ko(new Error(`Erreur dans l'app : ${r.result.exceptionDetails.text ?? "?"}`));
        else ok(r.result?.result?.value);
      };
      ws.onclose = () => ko(new Error("Connexion au débogueur fermée avant la réponse de l'app."));
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
  } finally {
    ws.close();
  }
}

const CIBLES = z.array(z.object({ webSocketDebuggerUrl: z.string().optional(), title: z.string().optional(), description: z.string().optional() }));
const REPONSE_CDP = z.object({
  id: z.number().optional(),
  result: z.object({ result: z.object({ value: z.unknown() }).optional(), exceptionDetails: z.object({ text: z.string().optional() }).optional() }).optional(),
});
const RESULTAT = z.object({ envois: z.array(z.string()), fini: z.boolean(), hote: z.string() });
// Paquet Sentry : [en-tête, [[en-tête d'élément, contenu], …]].
const PAQUET = z.tuple([z.unknown(), z.array(z.tuple([z.unknown(), z.unknown()]))]);
const EVENEMENT = z.object({ user: z.unknown(), environment: z.string().optional(), contexts: z.record(z.unknown()).optional() });

// Exécuté dans l'app : branche l'interception, lève l'erreur de test, range le résultat.
const LANCER = `(() => {
  const porteur = globalThis.__SENTRY__;
  const portee = porteur && porteur[porteur.version] && porteur[porteur.version].defaultCurrentScope;
  const client = portee && portee.getClient();
  if (!client) return "client Sentry absent";
  const dsn = client.getDsn();
  globalThis.__essaiSentry = { envois: [], fini: false, hote: dsn ? dsn.host : "" };
  client.on("beforeEnvelope", (paquet) => globalThis.__essaiSentry.envois.push(JSON.stringify(paquet)));
  client.captureException(new Error(${JSON.stringify(MESSAGE_ESSAI)}));
  client.flush(8000).then(() => { globalThis.__essaiSentry.fini = true; });
  return "lancé";
})()`;

function fileEnvoiIphone(o: Outils): number {
  const donnees = o.xcrun(["simctl", "get_app_container", o.udid, BUNDLE_ID, "data"]).trim();
  const racine = join(donnees, "Library/Caches/io.sentry");
  const compter = (dossier: string): number =>
    readdirSync(dossier).reduce((n, nom) => {
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) return n + compter(chemin);
      return n + (dossier.endsWith("envelopes") ? 1 : 0);
    }, 0);
  try {
    return compter(racine);
  } catch {
    return 0;
  }
}

export async function verifierSentry(o: Outils, compte: Compte): Promise<void> {
  verifier((await evaluer(LANCER)) === "lancé", "client Sentry introuvable dans l'app");
  let resultat: z.infer<typeof RESULTAT> = { envois: [], fini: false, hote: "" };
  for (let i = 0; i < 40 && !resultat.fini; i++) {
    await new Promise((r) => setTimeout(r, 250));
    resultat = RESULTAT.parse(JSON.parse(String(await evaluer("JSON.stringify(globalThis.__essaiSentry)"))));
  }
  const paquet = resultat.envois.find((p) => p.includes(MESSAGE_ESSAI));
  if (!paquet) throw new Error("Vérification Sentry échouée : l'erreur de test n'a pas été préparée pour l'envoi");
  const evenement = EVENEMENT.parse(PAQUET.parse(JSON.parse(paquet))[1][0]?.[1]);
  verifier(resultat.hote.endsWith(".ingest.de.sentry.io"), `adresse Sentry hors UE (${resultat.hote || "aucune"})`);
  verifier(JSON.stringify(evenement.user) === JSON.stringify({ id: compte.id }), `utilisateur = identifiant seul (${JSON.stringify(evenement.user)})`);
  // Ni code d'appareil, ni traces d'interface (lot 3bis : ajoutés par la partie native, retirés par le nettoyage).
  for (const interdit of [compte.email, compte.username, "ip_address", "@example.com", "device_app_hash", '"category":"ui.']) {
    verifier(!paquet.includes(interdit), `aucun « ${interdit} » dans l'envoi`);
  }
  log(`  paquet préparé : région UE (${resultat.hote}), environnement « ${evenement.environment ?? "?"} », utilisateur = identifiant interne seul, ni e-mail, ni nom, ni IP, ni code d'appareil, ni trace d'interface`);
  log(`  contextes joints : ${Object.keys(evenement.contexts ?? {}).join(", ")}`);
  let restants = fileEnvoiIphone(o);
  for (let i = 0; i < 30 && restants > 0; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    restants = fileEnvoiIphone(o);
  }
  verifier(restants === 0, `${restants} paquet(s) encore en attente d'envoi sur l'iPhone`);
  log("  file d'envoi de l'iPhone vide : paquet transmis, Sentry a répondu (région UE)");
}
