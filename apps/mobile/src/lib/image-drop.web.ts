// Site (mission « liens vidéo ») : une image glissée-déposée sur la page, ou
// collée (Ctrl+V / ⌘V), suit le parcours habituel d'une photo choisie :
// réduite à 1 600 px, puis « Entourez la pièce ». Écouté seulement pendant
// que l'écran est affiché. Un texte collé dans un champ (un lien) n'est
// jamais intercepté : seul un fichier image l'est. Version app : image-drop.ts.
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { prepareSharedPhoto, type ImportResult } from "./image-import";

/** Le premier fichier image d'une liste (glisser-déposer, presse-papiers) ; null s'il n'y en a pas. */
export function firstImageFile(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file && file.type.startsWith("image/")) return file;
  }
  return null;
}

const hasFiles = (transfer: DataTransfer | null) => Boolean(transfer && Array.from(transfer.types ?? []).includes("Files"));

async function prepare(file: File): Promise<ImportResult> {
  const url = URL.createObjectURL(file);
  try {
    return await prepareSharedPhoto(url, null, null);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useImageDrop(onImage: (result: ImportResult) => void, onRefused: () => void): void {
  useFocusEffect(
    useCallback(() => {
      if (typeof window === "undefined") return;
      const handle = (file: File | null, hadFiles: boolean) => {
        if (file) void prepare(file).then(onImage);
        else if (hadFiles) onRefused();
      };
      const onDragOver = (event: DragEvent) => {
        if (!hasFiles(event.dataTransfer)) return;
        // Sans cela, le navigateur ouvrirait l'image à la place de la page.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      };
      const onDrop = (event: DragEvent) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        handle(firstImageFile(event.dataTransfer?.files), true);
      };
      const onPaste = (event: ClipboardEvent) => {
        const file = firstImageFile(event.clipboardData?.files);
        // Texte collé (un lien dans le champ) : laissé au navigateur.
        if (!file) return;
        event.preventDefault();
        handle(file, true);
      };
      window.addEventListener("dragover", onDragOver);
      window.addEventListener("drop", onDrop);
      window.addEventListener("paste", onPaste);
      return () => {
        window.removeEventListener("dragover", onDragOver);
        window.removeEventListener("drop", onDrop);
        window.removeEventListener("paste", onPaste);
      };
    }, [onImage, onRefused])
  );
}
