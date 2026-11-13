// Recherche d'image d'iOS (« Visual Intelligence », iOS 26 et suivants) —
// mission « liens vidéo ». Dans n'importe quelle app, la personne fait une
// capture d'écran, touche « Recherche d'image », puis choisit l'app. Le Swift
// (plugins/recherche-image/SpottoRechercheImage.swift) range la capture en
// JPEG dans le dossier « recherche-image/ » du groupe d'apps, puis ouvre
// l'app par « <schéma>://recherche-image?fichier=<uuid> » (et note ce lien
// dans « recherche-image-en-attente.txt », relu si iOS ne l'a pas transmis).
// Ici : identifiant vérifié (un UUID, jamais un chemin), capture copiée dans
// le cache de l'app, fichier du groupe d'apps effacé aussitôt, puis la
// capture est mise en attente pour le Spotter, comme une image partagée
// (source « visual_intelligence », associée au lien de vidéo en attente s'il
// y en a un). Version site : visual-search-intake.web.ts (rien à recevoir).
//
// Revue de sécurité : iOS fait écrire la capture dès qu'il montre le
// résultat, avant que la personne choisisse l'app. Au lancement et à chaque
// retour au premier plan, toute capture du groupe d'apps de plus de
// 10 minutes est donc effacée (sauf celle en cours d'ouverture). Un lien dont
// la capture n'existe pas (déjà effacée, ou lien forgé par une autre app) est
// ignoré sans rien dire : l'élément qui attendait le Spotter reste en place.
// L'image préparée d'une capture est rangée dans « recherche-image/ » du
// cache, vidé à chaque lancement.
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Linking from "expo-linking";
import { Directory, File, Paths } from "expo-file-system";
import { APP_GROUP } from "../constants/brand";
import { peekSharedItem, receiveSharedItem, type SharedItem } from "./shared-item";
import { discardLocalFile } from "./video-frames";
import {
  PENDING_VISUAL_SEARCH_FILE,
  VISUAL_SEARCH_FOLDER,
  captureFileName,
  isCaptureId,
  pendingVisualSearchOpening,
  staleCaptureNames,
  visualSearchCaptureId,
} from "./visual-search-link";

export * from "./visual-search-link";

/** Copies des captures, dans le cache de l'app. */
const CACHE_FOLDER = "recherche-image";

function cacheFolder(): Directory {
  const folder = new Directory(Paths.cache, CACHE_FOLDER);
  try {
    folder.create({ idempotent: true });
    return folder;
  } catch {
    return Paths.cache;
  }
}

/** Copie la capture : son adresse, « missing » (identifiant refusé, fichier
 * absent) ou null (copie impossible). */
async function takeCapture(id: string): Promise<string | "missing" | null> {
  // Revérifié ici : seul un UUID forme le nom du fichier.
  if (!isCaptureId(id)) return "missing";
  const container = Paths.appleSharedContainers[APP_GROUP];
  if (!container) return "missing";
  let source: File;
  try {
    source = new File(container, VISUAL_SEARCH_FOLDER, captureFileName(id));
    if (!source.exists) return "missing";
  } catch {
    return "missing";
  }
  const target = new File(cacheFolder(), captureFileName(id));
  let copied = false;
  try {
    await source.copy(target);
    copied = true;
  } catch {
    copied = false;
  } finally {
    try {
      source.delete();
    } catch {
      // Effacée par le Swift à la capture suivante, ou par l'app au bout de 10 minutes.
    }
  }
  return copied ? target.uri : null;
}

/** Copie la capture dans le cache de l'app, puis efface le fichier du groupe
 * d'apps (même si la copie a échoué : rien n'y reste). Rend l'adresse de la
 * copie, ou null (identifiant refusé, fichier absent, copie impossible). */
export async function takeVisualSearchCapture(id: string): Promise<string | null> {
  const taken = await takeCapture(id);
  return taken === "missing" ? null : taken;
}

/** Image préparée d'une capture (nouveau fichier écrit par la réduction) :
 * rangée dans « recherche-image/ » du cache, vidé à chaque lancement. Rend sa
 * nouvelle adresse, ou l'ancienne si le déplacement échoue. */
export async function moveIntoCaptureCache(uri: string): Promise<string> {
  if (Platform.OS !== "ios") return uri;
  try {
    const folder = cacheFolder();
    if (folder === Paths.cache || uri.startsWith(folder.uri)) return uri;
    const file = new File(uri);
    if (!file.exists) return uri;
    const target = new File(folder, file.name);
    await file.move(target);
    return target.uri;
  } catch {
    return uri;
  }
}

/** Captures du groupe d'apps de plus de 10 minutes (jamais ouvertes : iOS les
 * fait écrire avant tout choix) : effacées, sauf celles en cours d'ouverture. */
function clearStaleCaptures(opening: Iterable<string>): void {
  try {
    const container = Paths.appleSharedContainers[APP_GROUP];
    if (!container) return;
    const folder = new Directory(container, VISUAL_SEARCH_FOLDER);
    if (!folder.exists) return;
    const files = folder.list().filter((entry): entry is File => entry instanceof File);
    const stale = new Set(staleCaptureNames(files.map((file) => ({ name: file.name, modifiedAt: file.lastModified ?? null })), opening, Date.now()));
    for (const file of files) {
      if (!stale.has(file.name)) continue;
      try {
        file.delete();
      } catch {
        // Effacement refusé : on passe au suivant.
      }
    }
  } catch {
    // Dossier indisponible : rien à effacer.
  }
}

/** Lien d'ouverture noté par le Swift, lu une seule fois (le fichier est effacé aussitôt). */
function takePendingVisualSearchUrl(): string | null {
  try {
    const container = Paths.appleSharedContainers[APP_GROUP];
    if (!container) return null;
    const file = new File(container, PENDING_VISUAL_SEARCH_FILE);
    if (!file.exists) return null;
    const content = file.textSync();
    const modifiedAt = file.lastModified;
    file.delete();
    return pendingVisualSearchOpening(content, modifiedAt, Date.now());
  } catch {
    return null;
  }
}

// Une capture après l'autre.
let queue: Promise<void> = Promise.resolve();

async function receive(id: string): Promise<void> {
  const uri = await takeCapture(id);
  // Capture absente (déjà effacée, ou lien forgé) : rien n'est mis en attente, rien n'est dit.
  if (uri === "missing") return;
  const item: SharedItem = uri ? { kind: "image", uri, width: null, height: null, origin: "visual_intelligence" } : { kind: "refused", reason: "unreadable" };
  const replaced = receiveSharedItem(item);
  // L'élément remplacé ne sera jamais ouvert : sa copie est effacée (comme share-intake.keep).
  if (replaced && (replaced.kind === "image" || replaced.kind === "video")) discardLocalFile(replaced.uri);
}

/** Au lancement : les copies qu'aucun écran n'a ouvertes la fois précédente
 * (rien n'attend encore : l'attente vit en mémoire). */
function clearOldCopies(): void {
  if (peekSharedItem()) return;
  try {
    const folder = new Directory(Paths.cache, CACHE_FOLDER);
    if (!folder.exists) return;
    for (const entry of folder.list()) {
      try {
        if (entry instanceof File) entry.delete();
      } catch {
        // Effacement refusé : on passe au suivant.
      }
    }
  } catch {
    // Dossier indisponible : rien à effacer.
  }
}

/** Écoute les ouvertures par la recherche d'image ; rend de quoi arrêter. */
export function startVisualSearchIntake(): () => void {
  if (Platform.OS !== "ios") return () => {};
  clearOldCopies();
  const seen = new Set<string>();
  const read = (url: string | null) => {
    const id = url ? visualSearchCaptureId(url) : null;
    // Chaque capture n'est lue qu'une fois (lien d'iOS et fichier d'attente, quel que soit l'ordre).
    if (!id || seen.has(id)) return;
    seen.add(id);
    queue = queue.then(() => receive(id)).catch(() => undefined);
  };
  read(Linking.getLinkingURL());
  read(takePendingVisualSearchUrl());
  // Après la lecture des liens : la capture qu'on ouvre n'est jamais effacée ici.
  clearStaleCaptures(seen);
  const links = Linking.addEventListener("url", ({ url }) => read(url));
  const returns = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    read(takePendingVisualSearchUrl());
    clearStaleCaptures(seen);
  });
  return () => {
    links.remove();
    returns.remove();
  };
}

/** À appeler une fois, à la racine de l'app (app iPhone). */
export function useVisualSearchIntake(): void {
  useEffect(startVisualSearchIntake, []);
}
