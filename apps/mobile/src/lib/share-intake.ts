// Réception d'un partage (app iPhone, lot « partager vers Spotto ») : la
// personne choisit « Spotto » dans la feuille de partage d'iOS ; l'extension
// d'expo-share-intent range l'élément dans le groupe d'apps et rouvre l'app
// par une adresse « spotto://dataUrl=…#type ». Ici : l'élément est lu, classé
// (shared-item.ts), sa copie rangée dans le cache de Spotto — effacée comme les
// autres une fois utilisée, ou au lancement suivant si rien ne l'a ouverte —,
// puis mis en attente pour le Spotter.
// Le crochet useShareIntent du module n'est pas utilisé : au retour au premier
// plan, il relit le partage avec l'adresse PRÉCÉDENTE, dont le type peut
// différer (une vidéo, puis un lien), et le module natif s'arrête alors net
// (plantage de l'app). Ici, chaque partage est lu une fois, avec l'adresse qui
// vient de l'ouvrir. Version site : share-intake.web.ts (rien à recevoir).
import { useEffect } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { Directory, File, Paths } from "expo-file-system";
import { ShareIntentModule, parseShareIntent } from "expo-share-intent";
import { discardLocalFile } from "./video-frames";
import { APP_GROUP, SHARE_KEY, classifySharedItem, isShareOpeningUrl, peekSharedItem, receiveSharedItem, type SharedItem } from "./shared-item";

// Un partage après l'autre : le nettoyage du groupe d'apps ne croise jamais un déplacement en cours.
let queue: Promise<void> = Promise.resolve();

// Copies des partages, rangées à part dans le cache de Spotto : celles qu'aucun
// écran n'a ouvertes (app fermée par iOS avant la connexion, par exemple) sont
// effacées au lancement suivant, une seule fois.
const SHARES_FOLDER = "partages";
let oldSharesCleared = false;

/** Efface les fichiers d'un dossier un par un : un fichier qui résiste n'arrête
 * pas les suivants. Les sous-dossiers et les fichiers épargnés restent. */
function deleteFiles(list: () => (File | Directory)[], spare: (file: File) => boolean): void {
  let entries: (File | Directory)[];
  try {
    entries = list();
  } catch {
    // Dossier indisponible : rien à effacer.
    return;
  }
  for (const entry of entries) {
    if (!(entry instanceof File) || spare(entry)) continue;
    try {
      entry.delete();
    } catch {
      // Effacement refusé : on passe au suivant.
    }
  }
}

/** Dossier des copies ; le cache lui-même s'il ne peut pas être créé. */
function sharesFolder(): Directory {
  const folder = new Directory(Paths.cache, SHARES_FOLDER);
  try {
    folder.create({ idempotent: true });
    return folder;
  } catch {
    return Paths.cache;
  }
}

/** Range la copie reçue dans le cache de Spotto ; illisible si elle n'y arrive pas. */
async function intoCache(item: SharedItem): Promise<SharedItem> {
  if (item.kind !== "image" && item.kind !== "video") return item;
  try {
    const file = new File(item.uri);
    await file.move(sharesFolder());
    return item.kind === "video" ? { ...item, uri: file.uri, sizeBytes: file.size || item.sizeBytes } : { ...item, uri: file.uri };
  } catch {
    return { kind: "refused", reason: "unreadable" };
  }
}

/** Le groupe d'apps ne garde rien : vignettes laissées par l'extension, copies
 * de partages jamais ouverts. Un fichier caché (nom commençant par « . ») est
 * un fichier du système, présent dans tout groupe d'apps : jamais touché. */
function clearSharedContainer(): void {
  deleteFiles(
    () => Paths.appleSharedContainers[APP_GROUP]?.list() ?? [],
    (file) => file.name.startsWith(".")
  );
}

/** Au lancement, avant de lire le moindre partage : les copies laissées par un
 * lancement précédent. Rien n'attend encore (l'attente vit en mémoire) ; si un
 * élément attendait quand même, on ne touche à rien. */
function clearOldSharesOnce(): void {
  if (oldSharesCleared) return;
  oldSharesCleared = true;
  if (peekSharedItem()) return;
  deleteFiles(
    () => {
      const folder = new Directory(Paths.cache, SHARES_FOLDER);
      return folder.exists ? folder.list() : [];
    },
    () => false
  );
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
  clearOldSharesOnce();
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
