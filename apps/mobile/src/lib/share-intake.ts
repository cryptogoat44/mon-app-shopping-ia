// Réception d'un partage (app iPhone, lot « partager vers Spotto ») : la
// personne choisit « Spotto » dans la feuille de partage d'iOS ; l'extension
// d'expo-share-intent range l'élément dans le groupe d'apps et rouvre l'app
// par une adresse « spotto://dataUrl=…#type ». Ici : l'élément est lu, classé
// (shared-item.ts), sa copie rangée dans le cache de Spotto — effacée comme les
// autres une fois utilisée —, puis mis en attente pour le Spotter.
// Le crochet useShareIntent du module n'est pas utilisé : au retour au premier
// plan, il relit le partage avec l'adresse PRÉCÉDENTE, dont le type peut
// différer (une vidéo, puis un lien), et le module natif s'arrête alors net
// (plantage de l'app). Ici, chaque partage est lu une fois, avec l'adresse qui
// vient de l'ouvrir. Version site : share-intake.web.ts (rien à recevoir).
import { useEffect } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { File, Paths } from "expo-file-system";
import { ShareIntentModule, parseShareIntent } from "expo-share-intent";
import { discardLocalFile } from "./video-frames";
import { APP_GROUP, SHARE_KEY, classifySharedItem, isShareOpeningUrl, receiveSharedItem, type SharedItem } from "./shared-item";

// Un partage après l'autre : le nettoyage du groupe d'apps ne croise jamais un déplacement en cours.
let queue: Promise<void> = Promise.resolve();

/** Range la copie reçue dans le cache de Spotto ; illisible si elle n'y arrive pas. */
async function intoCache(item: SharedItem): Promise<SharedItem> {
  if (item.kind !== "image" && item.kind !== "video") return item;
  try {
    const file = new File(item.uri);
    await file.move(Paths.cache);
    return item.kind === "video" ? { ...item, uri: file.uri, sizeBytes: file.size || item.sizeBytes } : { ...item, uri: file.uri };
  } catch {
    return { kind: "refused", reason: "unreadable" };
  }
}

/** Le groupe d'apps ne garde rien : vignettes laissées par l'extension, copies de partages jamais ouverts. */
function clearSharedContainer(): void {
  try {
    for (const entry of Paths.appleSharedContainers[APP_GROUP]?.list() ?? []) {
      if (entry instanceof File) entry.delete();
    }
  } catch {
    // Conteneur indisponible : rien à effacer.
  }
}

async function keep(item: SharedItem): Promise<void> {
  const kept = await intoCache(item);
  clearSharedContainer();
  const replaced = receiveSharedItem(kept);
  // Un partage plus récent remplace celui qui attendait : sa copie n'a plus d'usage.
  if (replaced && (replaced.kind === "image" || replaced.kind === "video")) discardLocalFile(replaced.uri);
}

function accept(item: SharedItem): void {
  // Un échec imprévu n'arrête pas les partages suivants.
  queue = queue.then(() => keep(item)).catch(() => undefined);
}

/** Écoute les ouvertures par l'extension ; rend de quoi arrêter. */
export function startShareIntake(): () => void {
  const module = Platform.OS === "ios" ? ShareIntentModule : null;
  if (!module) return () => {};
  let lastUrl: string | null = null;
  let reading = false;
  const read = (url: string | null) => {
    if (!url || !isShareOpeningUrl(url) || url === lastUrl) return;
    lastUrl = url;
    reading = true;
    void module.getShareIntent(url);
  };
  const changes = module.addListener("onChange", ({ value }) => {
    reading = false;
    // Lu une fois : le module est vidé tout de suite.
    module.clearShareIntent(SHARE_KEY);
    let item: SharedItem;
    try {
      item = classifySharedItem(parseShareIntent(value, {}));
    } catch {
      item = { kind: "refused", reason: "unreadable" };
    }
    accept(item);
  });
  // Seules comptent les erreurs du partage en cours de lecture.
  const errors = module.addListener("onError", () => {
    if (!reading) return;
    reading = false;
    accept({ kind: "refused", reason: "unreadable" });
  });
  read(Linking.getLinkingURL());
  const links = Linking.addEventListener("url", ({ url }) => read(url));
  return () => {
    changes.remove();
    errors.remove();
    links.remove();
  };
}

/** À appeler une fois, à la racine de l'app : reçoit chaque partage, connecté ou non. */
export function useShareIntake(): void {
  useEffect(startShareIntake, []);
}
