import { useEffect } from "react";
import { useRouter } from "expo-router";

// Cet onglet n'est jamais réellement affiché : le bouton "+" central de la
// barre intercepte l'appui (voir _layout.tsx, listeners.tabPress) et ouvre
// directement Publier en modale. Ce filet de sécurité couvre le cas où
// l'interception ne se déclenche pas (ex. navigation directe par URL).
export default function PublishPlaceholderScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/post-item/new");
  }, [router]);

  return null;
}
